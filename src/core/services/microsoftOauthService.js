const crypto = require('crypto');
const https = require('https');
const { URL, URLSearchParams } = require('url');

function buildUrl(base, params) {
  const url = new URL(base);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  });
  return url.toString();
}

function httpRequest(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let rawData = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { rawData += chunk; });
      res.on('end', () => {
        const responseText = rawData.trim();
        let data = null;
        if (responseText) {
          try {
            data = JSON.parse(responseText);
          } catch (parseError) {
            reject(new Error(`Invalid JSON response from ${options.path}: ${parseError.message} - ${responseText}`));
            return;
          }
        }

        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ statusCode: res.statusCode, headers: res.headers, body: data });
          return;
        }

        const errorMessage = data?.error_description || data?.error || `${res.statusCode} ${res.statusMessage}`;
        reject(new Error(`HTTP ${res.statusCode}: ${errorMessage}`));
      });
    });

    req.on('error', (error) => reject(error));
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

function createMicrosoftOauthService({ db, security }) {
  const clientId = 'e9a7fea1-1cc0-4cd9-a31b-9137ca5deedd';
  const authority = 'https://login.microsoftonline.com/common';
  const redirectUri = 'com.emclient.MailClient://oauth';
  const scope = 'openid offline_access profile https://graph.microsoft.com/Mail.Send';
  let pendingAuthorization = null;

  function createState() {
    return crypto.randomBytes(16).toString('hex');
  }

  function buildAuthUrl(state) {
    return buildUrl(`${authority}/oauth2/v2.0/authorize`, {
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      response_mode: 'query',
      scope,
      state
    });
  }

  async function getAccountRow(accountId) {
    return db.get('SELECT * FROM accounts WHERE id = ?', [Number(accountId)]);
  }

  async function saveTokenResult(accountId, result) {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + Number(result.expires_in || 3600) * 1000).toISOString();

    await db.run(
      `UPDATE accounts SET
         oauth_access_token = ?,
         oauth_refresh_token = ?,
         oauth_expires_at = ?,
         oauth_scope = ?,
         oauth_token_type = ?,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        security.encrypt(result.access_token),
        security.encrypt(result.refresh_token || ''),
        expiresAt,
        result.scope || scope,
        result.token_type || 'Bearer',
        Number(accountId)
      ]
    );
  }

  async function postForm(url, params) {
    const body = new URLSearchParams(params).toString();
    const parsed = new URL(url);

    const options = {
      method: 'POST',
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const response = await httpRequest(options, body);
    return response.body;
  }

  async function postJson(url, json, accessToken) {
    const payload = JSON.stringify(json);
    const parsed = new URL(url);
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    };
    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
    }

    const options = {
      method: 'POST',
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      headers
    };

    const response = await httpRequest(options, payload);
    return response.body;
  }

  async function exchangeCode(code) {
    const result = await postForm(`${authority}/oauth2/v2.0/token`, {
      client_id: clientId,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      scope
    });
    if (!result.access_token) {
      throw new Error('Microsoft token exchange did not return an access token.');
    }
    return result;
  }

  async function refreshTokens(existingRefreshToken) {
    const result = await postForm(`${authority}/oauth2/v2.0/token`, {
      client_id: clientId,
      grant_type: 'refresh_token',
      refresh_token: existingRefreshToken,
      scope
    });
    if (!result.access_token) {
      throw new Error('Microsoft refresh token request did not return a new access token.');
    }
    return result;
  }

  async function getAccessToken(account) {
    if (!account) {
      throw new Error('Missing account record.');
    }

    const expiresAt = account.oauth_expires_at ? new Date(account.oauth_expires_at).getTime() : 0;
    const decryptedAccessToken = security.decrypt(account.oauth_access_token);
    const refreshToken = security.decrypt(account.oauth_refresh_token);

    if (decryptedAccessToken && Date.now() < expiresAt - 60000) {
      return decryptedAccessToken;
    }

    if (!refreshToken) {
      throw new Error('Microsoft OAuth refresh token is missing. Authorize the account again.');
    }

    const refreshed = await refreshTokens(refreshToken);
    await saveTokenResult(account.id, refreshed);
    return security.decrypt((await getAccountRow(account.id)).oauth_access_token);
  }

  async function ensureAccountHasGraphCredentials(accountId) {
    const account = await getAccountRow(accountId);
    if (!account) {
      throw new Error('Account not found.');
    }

    if ((account.primary_protocol || 'smtp').toLowerCase() !== 'graph') {
      throw new Error('Account is not configured for Microsoft Graph OAuth sending.');
    }

    return account;
  }

  return {
    getRedirectUri() {
      return redirectUri;
    },

    createAuthorization(accountId) {
      const state = createState();
      pendingAuthorization = { accountId: Number(accountId), state, createdAt: Date.now() };
      return {
        url: buildAuthUrl(state),
        state
      };
    },

    async handleCallbackUrl(url) {
      if (!pendingAuthorization) {
        throw new Error('No pending Microsoft OAuth authorization was found.');
      }

      const parsed = new URL(url);
      const query = parsed.searchParams;
      const state = query.get('state');
      const code = query.get('code');
      const error = query.get('error');
      const errorDescription = query.get('error_description');

      if (!state || state !== pendingAuthorization.state) {
        throw new Error('Microsoft OAuth state mismatch.');
      }

      if (error) {
        throw new Error(`Microsoft OAuth error: ${errorDescription || error}`);
      }

      if (!code) {
        throw new Error('Microsoft OAuth callback did not include a code.');
      }

      const accountId = pendingAuthorization.accountId;
      pendingAuthorization = null;

      await ensureAccountHasGraphCredentials(accountId);
      const tokenResult = await exchangeCode(code);
      await saveTokenResult(accountId, tokenResult);
      const updatedAccount = await getAccountRow(accountId);

      return {
        accountId,
        email: updatedAccount.email,
        expiresAt: updatedAccount.oauth_expires_at,
        scope: updatedAccount.oauth_scope
      };
    },

    async getAccessTokenForAccount(accountId) {
      const account = await ensureAccountHasGraphCredentials(accountId);
      return getAccessToken(account);
    },

    async verifyConnection(accountId) {
      const account = await ensureAccountHasGraphCredentials(accountId);
      const accessToken = await getAccessToken(account);
      const me = await this.callGraphApi(accountId, 'https://graph.microsoft.com/v1.0/me', 'GET');
      if (!me || !me.mail && !me.userPrincipalName) {
        throw new Error('Unable to verify Microsoft Graph account identity.');
      }
      return { ok: true, user: me };
    },

    async callGraphApi(accountId, url, method = 'GET', body = null) {
      const accessToken = await this.getAccessTokenForAccount(accountId);
      const parsed = new URL(url);
      const headers = {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json'
      };
      let payload = null;
      if (body !== null) {
        payload = JSON.stringify(body);
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = Buffer.byteLength(payload);
      }

      const options = {
        method,
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        headers
      };

      const response = await httpRequest(options, payload);
      return response.body;
    },

    async sendMail({ accountId, fromAddress, recipient, subject, html, previewText, attachments = [], settings = {} }) {
      const account = await ensureAccountHasGraphCredentials(accountId);
      const accessToken = await this.getAccessToken(account);

      const message = {
        subject,
        body: {
          contentType: 'HTML',
          content: html
        },
        toRecipients: [
          {
            emailAddress: {
              address: recipient.email,
              name: recipient.name || recipient.email
            }
          }
        ],
        internetMessageHeaders: [
          { name: 'List-Unsubscribe', value: `<mailto:${fromAddress}?subject=unsubscribe>` },
          { name: 'Precedence', value: 'bulk' },
          { name: 'X-Auto-Response-Suppress', value: 'All' }
        ]
      };

      if (attachments.length) {
        message.attachments = attachments.map((attachment) => ({
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: attachment.filename,
          contentType: attachment.contentType || 'application/octet-stream',
          contentBytes: attachment.content.toString('base64')
        }));
      }

      const payload = {
        message,
        saveToSentItems: true
      };

      return this.callGraphApi(accountId, 'https://graph.microsoft.com/v1.0/me/sendMail', 'POST', payload);
    }
  };
}

module.exports = { createMicrosoftOauthService };