const path = require('path');
const { execFile } = require('child_process');
const { isProviderManagedDomain } = require('./providerManagedDomains');

function extractDomain(email) {
  const match = String(email || '').toLowerCase().match(/@([^>\s]+)/);
  return match ? match[1] : '';
}

function runPythonLookup(email) {
  const scriptPath = path.resolve(__dirname, '..', '..', '..', 'scripts', 'dns_auth_lookup.py');
  const commands = [
    { command: 'python', args: [scriptPath, email] },
    { command: 'py', args: ['-3', scriptPath, email] }
  ];

  function attempt(index) {
    if (index >= commands.length) {
      return Promise.reject(new Error('Python was not found. Install Python or run scripts/dns_auth_lookup.py manually.'));
    }

    const item = commands[index];
    return new Promise((resolve, reject) => {
      execFile(item.command, item.args, { timeout: 20000, windowsHide: true }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
          return;
        }

        try {
          resolve(JSON.parse(String(stdout || '').trim()));
        } catch (parseError) {
          reject(new Error(`DNS script returned invalid JSON: ${parseError.message}`));
        }
      });
    }).catch(() => attempt(index + 1));
  }

  return attempt(0);
}

async function persistDnsAuth(db, email) {
  const domain = extractDomain(email);
  if (!domain) {
    return null;
  }

  if (isProviderManagedDomain(domain)) {
    await db.run(
      `INSERT INTO domain_profiles
       (name, status, spf_ready, dkim_ready, dmarc_ready, reputation_score, notes, updated_at)
       VALUES (?, 'provider-managed', 1, 1, 1, 95, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(name) DO UPDATE SET
         spf_ready = 1,
         dkim_ready = 1,
         dmarc_ready = 1,
         status = 'provider-managed',
         reputation_score = 95,
         notes = excluded.notes,
         updated_at = CURRENT_TIMESTAMP`,
      [
        domain,
        JSON.stringify({
          source: 'provider-managed-domain',
          checkedAt: new Date().toISOString(),
          note: 'Personal mailbox provider handles SPF, DKIM, and DMARC for this domain.'
        })
      ]
    );
    return { domain, spf: true, dkim: true, dmarc: true, ok: true, providerManaged: true };
  }

  try {
    const result = await runPythonLookup(email);
    const notes = JSON.stringify({
      source: 'scripts/dns_auth_lookup.py',
      checkedAt: new Date().toISOString(),
      records: result.records || {},
      errors: result.errors || {}
    });

    await db.run(
      `INSERT INTO domain_profiles
       (name, status, spf_ready, dkim_ready, dmarc_ready, reputation_score, notes, updated_at)
       VALUES (?, 'active', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(name) DO UPDATE SET
         spf_ready = excluded.spf_ready,
         dkim_ready = excluded.dkim_ready,
         dmarc_ready = excluded.dmarc_ready,
         status = 'active',
         reputation_score = excluded.reputation_score,
         notes = excluded.notes,
         updated_at = CURRENT_TIMESTAMP`,
      [
        domain,
        result.spf ? 1 : 0,
        result.dkim ? 1 : 0,
        result.dmarc ? 1 : 0,
        result.ok ? 90 : 45,
        notes
      ]
    );

    return result;
  } catch (error) {
    await db.run(
      `INSERT INTO domain_profiles
       (name, status, notes, updated_at)
       VALUES (?, 'review', ?, CURRENT_TIMESTAMP)
       ON CONFLICT(name) DO UPDATE SET
         status = 'review',
         notes = excluded.notes,
         updated_at = CURRENT_TIMESTAMP`,
      [
        domain,
        JSON.stringify({
          source: 'scripts/dns_auth_lookup.py',
          checkedAt: new Date().toISOString(),
          error: error.message
        })
      ]
    );
    return null;
  }
}

function createAccountsService({ db, security }) {
  return {
    async list() {
      const rows = await db.all('SELECT * FROM accounts ORDER BY created_at DESC');
      return rows.map((row) => {
        const connectionStatus = row.connection_status || 'pending';
        const hasOAuth = connectionStatus === 'connected' && Boolean(row.oauth_refresh_token);
        return {
          id: row.id,
          provider: row.provider,
          primaryProtocol: row.primary_protocol || 'smtp',
          email: row.email,
          displayName: row.display_name,
          username: row.username,
          host: row.host,
          port: row.port,
          secure: Boolean(row.secure),
          proxyProfileId: row.proxy_profile_id || null,
          notes: row.notes,
          hasPassword: Boolean(row.encrypted_password) && row.encrypted_password !== '',
          hasOAuth,
          connectionStatus,
          oauthExpiresAt: row.oauth_expires_at || null,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        };
      });
    },

    async create(payload) {
      const provider = String(payload.provider || '').trim();
      const primaryProtocol = String(payload.primaryProtocol || 'smtp').trim().toLowerCase();
      const email = String(payload.email || '').trim().toLowerCase();
      const displayName = String(payload.displayName || '').trim();
      const username = String(payload.username || email).trim();
      const password = String(payload.password || '').trim();
      const host = String(payload.host || '').trim();
      const port = Number(payload.port) || (primaryProtocol === 'graph' ? 0 : 587);
      const secure = payload.secure === false ? 0 : 1;
      const proxyProfileId = payload.proxyProfileId ? Number(payload.proxyProfileId) : null;
      const notes = String(payload.notes || '').trim();

      if (!provider || !email || (primaryProtocol !== 'graph' && !host)) {
        throw new Error('Provider, email, and host are required for non-Graph accounts.');
      }

      if (!['smtp', 'imap', 'pop3', 'graph'].includes(primaryProtocol)) {
        throw new Error('Primary protocol must be smtp, imap, pop3, or graph.');
      }

      const connectionStatus = primaryProtocol === 'graph' ? 'pending' : 'connected';

      try {
        await db.run(
          `INSERT INTO accounts
          (provider, primary_protocol, email, display_name, username, encrypted_password, host, port, secure, proxy_profile_id, notes, connection_status, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
          [
            provider,
            primaryProtocol,
            email,
            displayName,
            username,
            primaryProtocol === 'graph' ? '' : security.encrypt(password),
            host,
            port,
            secure,
            proxyProfileId,
            notes,
            connectionStatus
          ]
        );
      } catch (error) {
        if (error.message && error.message.includes('UNIQUE constraint failed: accounts.email')) {
          throw new Error('An account with this email already exists.');
        }
        throw error;
      }

      await persistDnsAuth(db, email);
      return this.list();
    },

    async remove(id) {
      await db.run('DELETE FROM accounts WHERE id = ?', [Number(id)]);
      return this.list();
    },

    async getById(id) {
      const row = await db.get('SELECT * FROM accounts WHERE id = ?', [Number(id)]);
      if (!row) {
        return null;
      }

      const connectionStatus = row.connection_status || 'pending';
      const hasOAuth = connectionStatus === 'connected' && Boolean(row.oauth_refresh_token);
      return {
        id: row.id,
        provider: row.provider,
        primaryProtocol: row.primary_protocol || 'smtp',
        email: row.email,
        displayName: row.display_name,
        username: row.username,
        host: row.host,
        port: row.port,
        secure: Boolean(row.secure),
        proxyProfileId: row.proxy_profile_id || null,
        notes: row.notes,
        hasPassword: Boolean(row.encrypted_password) && row.encrypted_password !== '',
        hasOAuth,
        connectionStatus,
        oauthExpiresAt: row.oauth_expires_at || null,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
    },

    async getForDiagnostics() {
      const rows = await db.all('SELECT * FROM accounts');
      return rows.map((row) => ({
        provider: row.provider,
        primaryProtocol: row.primary_protocol || 'smtp',
        email: row.email,
        host: row.host,
        port: row.port,
        secure: Boolean(row.secure),
        hasCredentials: Boolean(security.decrypt(row.encrypted_password)) || Boolean(row.oauth_refresh_token || row.oauth_access_token)
      }));
    }
  };
}

module.exports = { createAccountsService };
