const nodemailer = require('nodemailer');

function stripHtml(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function applyTokens(template, recipient) {
  const firstName = String(recipient.name || recipient.email || '')
    .split(' ')[0]
    .trim();

  return String(template || '')
    .replace(/\{\{\s*first_name\s*\}\}/gi, firstName)
    .replace(/\{\{\s*name\s*\}\}/gi, recipient.name || firstName)
    .replace(/\{\{\s*email\s*\}\}/gi, recipient.email || '');
}

function decodeHtmlAttribute(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function extractSendDirectives(html) {
  const attachments = [];
  let cleanHtml = String(html || '');

  cleanHtml = cleanHtml.replace(/<a\b[^>]*data-pm-attachment=["']([^"']+)["'][^>]*>[\s\S]*?<\/a>/gi, (match, encodedJson) => {
    try {
      const rawValue = decodeHtmlAttribute(encodedJson);
      const attachment = JSON.parse(rawValue.startsWith('%7B') ? decodeURIComponent(rawValue) : rawValue);
      if (attachment.filename && attachment.content) {
        attachments.push({
          filename: attachment.filename,
          content: Buffer.from(attachment.content, 'base64'),
          contentType: attachment.contentType || 'application/octet-stream',
          url: attachment.url || ''
        });
      }
    } catch {
      // Ignore malformed attachment metadata
    }
    return '';
  });

  cleanHtml = cleanHtml.replace(/<div\b[^>]*data-pm-attachment-card=["']true["'][^>]*>[\s\S]*?<\/div>/gi, '');

  const attachmentLinkHtml = attachments
    .filter((attachment) => attachment.url)
    .map((attachment) => {
      const label = String(attachment.filename || 'Attachment').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      return `<p style="margin:6px 0;"><a href="${String(attachment.url).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}" target="_blank" rel="noreferrer noopener" style="color:#0066cc;text-decoration:underline;">${label}</a></p>`;
    })
    .join('');

  if (attachmentLinkHtml) {
    const insertion = `<div style="border-top:1px solid #e1e5e9;margin-top:24px;padding-top:12px;"><strong style="font-size:13px;color:#374151;">Attachments</strong>${attachmentLinkHtml}</div>`;
    const bodyClose = cleanHtml.lastIndexOf('</body>');
    if (bodyClose !== -1) {
      cleanHtml = cleanHtml.slice(0, bodyClose) + insertion + cleanHtml.slice(bodyClose);
    } else {
      cleanHtml += insertion;
    }
  }

  const confidential = /data-pm-confidential=["']true["']|pm-confidential:true/i.test(cleanHtml);

  return {
    html: cleanHtml,
    attachments,
    confidential
  };
}

function createEmailSendService({ db, security, proxyService, microsoftOauthService }) {
  async function getAccountRow(accountId) {
    return db.get('SELECT * FROM accounts WHERE id = ?', [Number(accountId)]);
  }

  async function buildTransport(account, password) {
    const proxy = proxyService && account.proxy_profile_id
      ? await proxyService.getTransportProxyUrl(account.proxy_profile_id)
      : '';

    return nodemailer.createTransport({
      host: account.host,
      port: account.port,
      secure: Boolean(account.secure),
      auth: {
        user: account.username || account.email,
        pass: password
      },
      connectionTimeout: 20000,
      greetingTimeout: 20000,
      socketTimeout: 20000,
      tls: { rejectUnauthorized: false },
      ...(proxy ? { proxy } : {})
    });
  }

  async function buildOAuthTransport(account) {
    if (!microsoftOauthService) {
      throw new Error('Microsoft OAuth service is not configured.');
    }

    const transportConfig = await microsoftOauthService.getSmtpTransportConfig(account.id);
    const proxy = proxyService && account.proxy_profile_id
      ? await proxyService.getTransportProxyUrl(account.proxy_profile_id)
      : '';

    return nodemailer.createTransport({
      ...transportConfig,
      ...(proxy ? { proxy } : {})
    });
  }

  async function sendGraphMessage(account, personalizedSubject, personalizedHtml, text, directives, previewText, recipient, fromAddress) {
    const message = {
      message: {
        subject: personalizedSubject,
        body: {
          contentType: 'HTML',
          content: personalizedHtml
        },
        toRecipients: [
          {
            emailAddress: {
              address: recipient.email,
              name: recipient.name || undefined
            }
          }
        ]
      },
      saveToSentItems: false
    };

    if (directives.confidential) {
      message.message.sensitivity = 'companyConfidential';
      message.message.importance = 'high';
    }

    const headers = [];
    if (previewText) {
      headers.push({ name: 'X-Preview-Text', value: applyTokens(previewText, recipient) });
    }
    if (headers.length) {
      message.message.internetMessageHeaders = headers;
    }

    if (directives.attachments.length) {
      message.message.attachments = directives.attachments.map((attachment) => ({
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: attachment.filename,
        contentType: attachment.contentType,
        contentBytes: attachment.content.toString('base64')
      }));
    }

    const response = await microsoftOauthService.sendMail(account.id, message);
    return {
      messageId: response.headers?.['request-id'] || response.headers?.['x-ms-request-id'] || null,
      accountEmail: fromAddress
    };
  }

  return {
    applyTokens,

    async sendMessage({ accountId, recipient, subject, html, previewText, settings = {} }) {
      const account = await getAccountRow(accountId);
      if (!account) {
        throw new Error('Sending account not found.');
      }

      const protocol = String(account.primary_protocol || 'smtp').toLowerCase();
      if (protocol !== 'smtp' && protocol !== 'graph') {
        throw new Error('Account is not configured for SMTP or Microsoft OAuth sending.');
      }

      if (protocol === 'graph' && !microsoftOauthService) {
        throw new Error('Microsoft OAuth service is not configured.');
      }

      const password = protocol === 'smtp' ? security.decrypt(account.encrypted_password) : null;
      if (protocol === 'smtp' && !password) {
        throw new Error('Account password is missing.');
      }

      const personalizedSubject = applyTokens(subject, recipient);
      let personalizedHtml = applyTokens(html, recipient);
      const directives = extractSendDirectives(personalizedHtml);
      personalizedHtml = directives.html;
      const physicalAddress = String(settings.physicalAddress || '').trim();
      if (physicalAddress && !personalizedHtml.includes(physicalAddress)) {
        personalizedHtml += `<p style="font-size:11px;color:#888;margin-top:24px;">${physicalAddress}</p>`;
      }
      const text = stripHtml(personalizedHtml);
      const fromName = account.display_name || account.provider || account.email;
      const fromAddress = account.email;

      if (protocol === 'graph') {
        return sendGraphMessage(account, personalizedSubject, personalizedHtml, text, directives, previewText, recipient, fromAddress);
      }

    const transporter = await buildTransport(account, password);
    const mailOptions = {
      from: `"${fromName}" <${fromAddress}>`,
      to: recipient.name ? `"${recipient.name}" <${recipient.email}>` : recipient.email,
      subject: personalizedSubject,
      text,
      html: personalizedHtml,
      headers: {
        ...(directives.confidential ? {
          Sensitivity: 'Company-Confidential',
          Importance: 'high',
          'X-PM-Confidential': 'true'
        } : {})
      },
      ...(directives.attachments.length ? { attachments: directives.attachments } : {}),
      ...(previewText ? { 'X-Preview-Text': applyTokens(previewText, recipient) } : {})
    };
    const replyTo = settings.replyTo || account.reply_to;
    if (replyTo) {
      mailOptions.replyTo = replyTo;
    }
    const info = await transporter.sendMail(mailOptions);

      return {
        messageId: info.messageId,
        accountEmail: fromAddress
      };
    }
  };
}

module.exports = { createEmailSendService, applyTokens, stripHtml, extractSendDirectives };
