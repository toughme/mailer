const nodemailer = require('nodemailer');
const imaps = require('imap-simple');
const net = require('net');
const tls = require('tls');
const dns = require('dns').promises;
const { isProviderManagedDomain } = require('./providerManagedDomains');

async function verifyImapConnection({ host, port, secure, username, password, onProgress }) {
  // Optional DNS pre-check (non-blocking - if it fails, connection attempt will still happen)
  try {
    if (onProgress) onProgress('Resolving host...');
    console.log(`[IMAP] Attempting DNS resolution for ${host}...`);
    await dns.resolve4(host);
    console.log(`[IMAP] DNS resolved successfully`);
  } catch (dnsError) {
    console.warn(`[IMAP] DNS resolution failed (continuing anyway): ${dnsError.message}`);
  }

  if (onProgress) onProgress('Connecting to IMAP server...');
  console.log(`[IMAP] Connecting to ${host}:${port} (secure: ${secure})`);
  
  const connection = await imaps.connect({
    imap: {
      user: username,
      password,
      host,
      port,
      tls: secure,
      authTimeout: 60000,
      connectionTimeout: 60000,
      socketTimeout: 60000,
      tlsOptions: { 
        rejectUnauthorized: false,
        minVersion: 'TLSv1.2'
      }
    }
  });

  try {
    if (onProgress) onProgress('Authenticating...');
    console.log(`[IMAP] Connected, opening INBOX...`);
    await connection.openBox('INBOX');
    if (onProgress) onProgress('Testing mailbox access...');
    console.log(`[IMAP] INBOX opened successfully`);
  } finally {
    if (connection && connection.end) {
      console.log(`[IMAP] Closing connection...`);
      await connection.end();
    }
  }
}

function verifyPop3Connection({ host, port, secure, username, password, onProgress }) {
  return new Promise(async (resolve, reject) => {
    // Optional DNS pre-check (non-blocking - if it fails, connection attempt will still happen)
    try {
      if (onProgress) onProgress('Resolving host...');
      console.log(`[POP3] Attempting DNS resolution for ${host}...`);
      await dns.resolve4(host);
      console.log(`[POP3] DNS resolved successfully`);
    } catch (dnsError) {
      console.warn(`[POP3] DNS resolution failed (continuing anyway): ${dnsError.message}`);
    }

    if (onProgress) onProgress('Connecting to POP3 server...');
    console.log(`[POP3] Connecting to ${host}:${port} (secure: ${secure})`);
    
    const socket = secure
      ? tls.connect({ host, port, rejectUnauthorized: false, timeout: 60000 })
      : net.createConnection({ host, port, timeout: 60000 });

    // Enable TCP keepalive to detect dead connections
    socket.setKeepAlive(true, 30000);

    let buffer = '';
    let stage = 'connecting';
    let finished = false;
    let timeoutHandle = setTimeout(() => {
      if (!finished) {
        finishError(new Error(`Connection timeout during ${stage} phase (60s exceeded)`));
      }
    }, 65000);

    function finishError(error) {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timeoutHandle);
      socket.destroy();
      console.error(`[POP3] Error during ${stage}: ${error.message}`);
      reject(error);
    }

    function finishSuccess() {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timeoutHandle);
      console.log(`[POP3] Successfully verified`);
      socket.end();
      resolve();
    }

    function send(command) {
      console.log(`[POP3] Sending: ${command.includes('PASS') ? 'PASS ****' : command}`);
      socket.write(`${command}\r\n`);
    }

    socket.setEncoding('utf8');
    socket.on('error', (err) => {
      console.error(`[POP3] Socket error during ${stage}: ${err.message}`);
      finishError(new Error(`Connection error during ${stage}: ${err.message}`));
    });
    socket.on('timeout', () => {
      console.error(`[POP3] Timeout during ${stage}`);
      finishError(new Error(`Timeout during ${stage} (socket idle for 60s)`));
    });
    
    socket.on('connect', () => {
      console.log(`[POP3] Connected`);
      stage = 'greeting';
      if (onProgress) onProgress('Waiting for server greeting...');
    });

    socket.on('data', (chunk) => {
      console.log(`[POP3] Received: ${chunk.toString().slice(0, 100)}`);
      buffer += chunk;
      while (buffer.includes('\r\n')) {
        const index = buffer.indexOf('\r\n');
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);

        if (!line.startsWith('+OK')) {
          finishError(new Error(`POP3 server error during ${stage}: ${line}`));
          return;
        }

        if (stage === 'greeting') {
          stage = 'sending USER command';
          if (onProgress) onProgress('Sending username...');
          send(`USER ${username}`);
          return;
        }

        if (stage === 'sending USER command') {
          stage = 'sending PASS command';
          if (onProgress) onProgress('Authenticating...');
          send(`PASS ${password}`);
          return;
        }

        if (stage === 'sending PASS command') {
          stage = 'sending QUIT command';
          if (onProgress) onProgress('Finalizing...');
          send('QUIT');
          return;
        }

        if (stage === 'sending QUIT command') {
          finishSuccess();
        }
      }
    });
  });
}

function createAccountsDiagnosticsService({ db, security, proxyService, deliverabilityService, microsoftOauthService }) {
  return {
    async testConnection(payload, onProgress) {
      const protocol = String(payload.primaryProtocol || payload.protocol || 'smtp').trim().toLowerCase();
      const host = String(payload.host || '').trim();
      const port = Number(payload.port) || 587;
      const secure = Boolean(payload.secure);
      const username = String(payload.username || payload.email || '').trim();
      const password = String(payload.password || '').trim();
      const proxyProfileId = payload.proxyProfileId ? Number(payload.proxyProfileId) : null;

      if (protocol === 'graph') {
        if (!payload.id && !payload.email) {
          throw new Error('Microsoft Graph testing requires a saved account or email to verify.');
        }
      } else if (!host || !username || !password) {
        throw new Error('Host, username/email, and password are required for account testing.');
      }

      // Retry logic with exponential backoff
      const maxRetries = 3;
      let lastError = null;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          console.log(`[Account Test] Attempt ${attempt}/${maxRetries} for ${protocol.toUpperCase()} ${host}:${port}`);

          if (protocol === 'smtp') {
            // Optional DNS pre-check (non-blocking - if it fails, connection attempt will still happen)
            try {
              if (onProgress) onProgress('Resolving host...');
              console.log(`[Account Test] Attempting DNS resolution for ${host}...`);
              await dns.resolve4(host);
              console.log(`[Account Test] DNS resolved successfully`);
            } catch (dnsError) {
              console.warn(`[Account Test] DNS resolution failed (continuing anyway): ${dnsError.message}`);
            }

            if (onProgress) onProgress('Creating SMTP connection...');
            console.log(`[Account Test] Creating SMTP transporter...`);
            const proxy = proxyProfileId && proxyService
              ? await proxyService.getTransportProxyUrl(proxyProfileId)
              : '';

            const transporter = nodemailer.createTransport({
              host,
              port,
              secure,
              auth: {
                user: username,
                pass: password
              },
              connectionTimeout: 60000,
              greetingTimeout: 60000,
              socketTimeout: 60000,
              pool: {
                maxConnections: 1,
                maxMessages: 1
              },
              tls: {
                rejectUnauthorized: false,
                minVersion: 'TLSv1.2'
              },
              logger: true,
              debug: true,
              ...(proxy ? { proxy } : {})
            });

            if (onProgress) onProgress('Authenticating...');
            console.log(`[Account Test] Verifying SMTP connection...`);
            // Try to verify connection
            await transporter.verify();
            if (onProgress) onProgress('SMTP connection verified!');
            console.log(`[Account Test] SMTP verification successful`);

          } else if (protocol === 'graph') {
            if (!microsoftOauthService) {
              throw new Error('Microsoft OAuth diagnostics are not configured in the app.');
            }
            if (!payload.id) {
              throw new Error('Graph account diagnostics require a saved account.');
            }
            if (onProgress) onProgress('Verifying Microsoft Graph credentials...');
            console.log(`[Account Test] Verifying Microsoft Graph account ${payload.id}`);
            await microsoftOauthService.verifyConnection(Number(payload.id));
            if (onProgress) onProgress('Microsoft Graph account verified!');
            console.log(`[Account Test] Microsoft Graph verification successful`);

          } else if (protocol === 'imap') {
            if (proxyProfileId) {
              throw new Error('Proxy diagnostics are currently supported for SMTP accounts only.');
            }
            if (onProgress) onProgress('Testing IMAP connection...');
            console.log(`[Account Test] Verifying IMAP connection...`);
            await verifyImapConnection({ host, port, secure, username, password, onProgress });
            console.log(`[Account Test] IMAP verification successful`);

          } else if (protocol === 'pop3') {
            if (proxyProfileId) {
              throw new Error('Proxy diagnostics are currently supported for SMTP accounts only.');
            }
            if (onProgress) onProgress('Testing POP3 connection...');
            console.log(`[Account Test] Verifying POP3 connection...`);
            await verifyPop3Connection({ host, port, secure, username, password, onProgress });
            console.log(`[Account Test] POP3 verification successful`);

          } else {
            throw new Error('Unsupported protocol. Use smtp, imap, or pop3.');
          }

          // After a successful connection, fetch DNS auth for the account domain if possible
          let dnsAuth = null;
          try {
            const emailDomain = String(username || payload.email || '').toLowerCase().split('@')[1] || '';
            if (emailDomain && deliverabilityService && !isProviderManagedDomain(emailDomain)) {
              const report = await deliverabilityService.analyze({ domain: emailDomain, dkimSelector: 'default' });
              dnsAuth = {
                domain: emailDomain,
                spf: Array.isArray(report.dns?.spfRecords) && report.dns.spfRecords.length === 1,
                dkim: Boolean(report.dns?.dkimRecords?.length),
                dmarc: Boolean(report.dns?.dmarcRecords?.length),
                score: report.score
              };
            }
          } catch (dnsError) {
            console.warn('Failed to obtain DNS auth during account test:', dnsError?.message || dnsError);
          }

          return {
            success: true,
            message: `${protocol.toUpperCase()} connection to ${host}:${port} succeeded on attempt ${attempt}.`,
            details: {
              protocol,
              host,
              port,
              secure,
              proxyProfileId,
              attempts: attempt
            },
            dnsAuth
          };

        } catch (error) {
          lastError = error;
          console.error(`[Account Test] Attempt ${attempt}/${maxRetries} failed:`, error.message);

          // Don't retry on validation errors
          if (error.message.includes('Cannot resolve host') || 
              error.message.includes('Unsupported protocol')) {
            throw error;
          }

          // If this was the last attempt, throw the error
          if (attempt === maxRetries) {
            throw error;
          }

          // Exponential backoff: 2s, 4s, 8s
          const waitMs = Math.pow(2, attempt) * 1000;
          console.log(`[Account Test] Waiting ${waitMs}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, waitMs));
        }
      }

      // Fallback error (shouldn't reach here)
      throw lastError || new Error('Connection test failed after retries');
    },

    async testSavedAccount(id, onProgress) {
      const account = await db.get('SELECT * FROM accounts WHERE id = ?', [Number(id)]);

      if (!account) {
        throw new Error('Account not found.');
      }
      const payload = {
        primaryProtocol: account.primary_protocol || 'smtp',
        host: account.host,
        port: account.port,
        secure: Boolean(account.secure),
        username: account.username || account.email,
        email: account.email,
        password: security.decrypt(account.encrypted_password),
        proxyProfileId: account.proxy_profile_id
      };

      const result = await this.testConnection(payload, onProgress);

      // If we obtained DNS auth, update row in accounts table for quick UI refresh
      if (result && result.dnsAuth) {
        try {
          await db.run('UPDATE accounts SET last_dns_spf = ?, last_dns_dkim = ?, last_dns_dmarc = ? WHERE id = ?', [
            result.dnsAuth.spf ? 1 : 0,
            result.dnsAuth.dkim ? 1 : 0,
            result.dnsAuth.dmarc ? 1 : 0,
            Number(id)
          ]);
        } catch (e) {
          console.warn('Failed to persist account DNS auth flags:', e?.message || e);
        }
      }

      return result;
    }
  };
}

module.exports = { createAccountsDiagnosticsService };
