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
          contentType: attachment.contentType || 'application/octet-stream'
        });
      }
    } catch {
      // Ignore malformed attachment metadata and leave the visible fallback out of the sent body.
    }
    return '';
  });

  cleanHtml = cleanHtml.replace(/<div\b[^>]*data-pm-attachment-card=["']true["'][^>]*>[\s\S]*?<\/div>/gi, '');

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
      const unsubscribeMailto = `<mailto:${fromAddress}?subject=unsubscribe>`;

      const transporter = protocol === 'graph'
        ? await buildOAuthTransport(account)
        : await buildTransport(account, password);

      const info = await transporter.sendMail({
        from: `"${fromName}" <${fromAddress}>`,
        to: recipient.name ? `"${recipient.name}" <${recipient.email}>` : recipient.email,
        subject: personalizedSubject,
        text,
        html: personalizedHtml,
        headers: {
          'List-Unsubscribe': unsubscribeMailto,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          Precedence: 'bulk',
          'X-Auto-Response-Suppress': 'All',
          ...(directives.confidential ? {
            Sensitivity: 'Company-Confidential',
            Importance: 'high',
            'X-PM-Confidential': 'true'
          } : {})
        },
        ...(directives.attachments.length ? { attachments: directives.attachments } : {}),
        ...(previewText ? { 'X-Preview-Text': applyTokens(previewText, recipient) } : {})
      });

      return {
        messageId: info.messageId,
        accountEmail: fromAddress
      };
    }
  };
}

module.exports = { createEmailSendService, applyTokens, stripHtml, extractSendDirectives };
