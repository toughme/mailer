const crypto = require('crypto');
const https = require('https');
const { URL, URLSearchParams } = require('url');

const MS_AUTHORITY = 'https://login.microsoftonline.com/common';
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const DEFAULT_SCOPE = 'openid offline_access profile https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/Mail.Read';
const TOKEN_REFRESH_BUFFER_MS = 120000;

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
            reject(new Error(`Invalid JSON response from ${options.path}: ${parseError.message} - ${responseText.substring(0, 500)}`));
            return;
          }
        }

        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ statusCode: res.statusCode, headers: res.headers, body: data });
          return;
        }

        const errorMessage = data?.error_description || data?.error?.message || data?.error || `${res.statusCode} ${res.statusMessage}`;
        const error = new Error(`HTTP ${res.statusCode}: ${errorMessage}`);
        error.statusCode = res.statusCode;
        error.errorCode = data?.error;
        reject(error);
      });
    });

    req.on('error', (error) => reject(error));
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

function generateCodeVerifier() {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

function createMicrosoftOauthService({ db, security, eventLogService }) {
  const clientId = 'e9a7fea1-1cc0-4cd9-a31b-9137ca5deedd';
  const redirectUri = 'com.emclient.MailClient://oauth';
  let pendingAuthorization = null;

  function log(level, message, details) {
    const prefix = '[MicrosoftOAuth]';
    const detailStr = details ? ` ${JSON.stringify(details)}` : '';
    if (level === 'error') {
      console.error(`${prefix} ${message}${detailStr}`);
    } else if (level === 'warn') {
      console.warn(`${prefix} ${message}${detailStr}`);
    } else {
      console.log(`${prefix} ${message}${detailStr}`);
    }
    if (eventLogService && typeof eventLogService.record === 'function') {
      eventLogService.record({
        type: level === 'error' ? 'oauth_error' : 'oauth_event',
        source: 'microsoft-oauth',
        payload: { message, details: details || null }
      }).catch(() => {});
    }
  }

  function createState() {
    return crypto.randomBytes(32).toString('hex');
  }

  function buildAuthUrl(state, codeChallenge) {
    const params = {
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      response_mode: 'query',
      scope: DEFAULT_SCOPE,
      state,
      prompt: 'consent'
    };
    if (codeChallenge) {
      params.code_challenge = codeChallenge;
      params.code_challenge_method = 'S256';
    }
    return buildUrl(`${MS_AUTHORITY}/oauth2/v2.0/authorize`, params);
  }

  async function getAccountRow(accountId) {
    return db.get('SELECT * FROM accounts WHERE id = ?', [Number(accountId)]);
  }

  async function updateConnectionStatus(accountId, status, errorDetail) {
    try {
      await db.run(
        `UPDATE accounts SET connection_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [status, Number(accountId)]
      );
    } catch (dbError) {
      log('warn', 'Failed to update connection_status', { accountId, status, error: dbError.message });
    }
    if (status === 'error' && errorDetail) {
      log('error', `Account ${accountId} connection error: ${errorDetail}`);
    }
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
        connection_status = 'connected',
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
      [
        security.encrypt(result.access_token),
        security.encrypt(result.refresh_token || ''),
        expiresAt,
        result.scope || DEFAULT_SCOPE,
        result.token_type || 'Bearer',
        Number(accountId)
      ]
    );

    log('info', 'Token saved for account', {
      accountId,
      expiresAt,
      hasRefreshToken: Boolean(result.refresh_token),
      scopeCount: (result.scope || '').split(' ').length
    });
  }

  async function clearTokens(accountId) {
    await db.run(
      `UPDATE accounts SET
        oauth_access_token = '',
        oauth_refresh_token = '',
        oauth_expires_at = '',
        oauth_scope = '',
        oauth_token_type = '',
        connection_status = 'disconnected',
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
      [Number(accountId)]
    );
    log('info', 'Tokens cleared for account', { accountId });
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

  async function exchangeCode(code, codeVerifier) {
    log('info', 'Exchanging authorization code for tokens');

    const params = {
      client_id: clientId,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      scope: DEFAULT_SCOPE
    };
    if (codeVerifier) {
      params.code_verifier = codeVerifier;
    }

    try {
      const result = await postForm(`${MS_AUTHORITY}/oauth2/v2.0/token`, params);
      if (!result.access_token) {
        log('error', 'Token exchange did not return access_token', { hasRefreshToken: Boolean(result.refresh_token), error: result.error });
        throw new Error('Microsoft token exchange did not return an access token.');
      }
      log('info', 'Token exchange successful', {
        expiresIn: result.expires_in,
        hasRefreshToken: Boolean(result.refresh_token),
        tokenType: result.token_type
      });
      return result;
    } catch (error) {
      log('error', 'Token exchange failed', { error: error.message });
      throw error;
    }
  }

  async function refreshTokens(existingRefreshToken) {
    log('info', 'Refreshing access token');

    try {
      const result = await postForm(`${MS_AUTHORITY}/oauth2/v2.0/token`, {
        client_id: clientId,
        grant_type: 'refresh_token',
        refresh_token: existingRefreshToken,
        scope: DEFAULT_SCOPE
      });
      if (!result.access_token) {
        log('error', 'Token refresh did not return access_token', { error: result.error });
        throw new Error('Microsoft refresh token request did not return a new access token.');
      }
      log('info', 'Token refresh successful', {
        expiresIn: result.expires_in,
        hasNewRefreshToken: Boolean(result.refresh_token)
      });
      return result;
    } catch (error) {
      const isInvalidGrant = error.errorCode === 'invalid_grant' ||
        error.message?.includes('invalid_grant') ||
        error.message?.includes('AADSTS70000') ||
        error.message?.includes('AADSTS70008') ||
        error.message?.includes('AADSTS700082');
      if (isInvalidGrant) {
        error.isRefreshTokenRevoked = true;
      }
      log('error', 'Token refresh failed', {
        error: error.message,
        isInvalidGrant
      });
      throw error;
    }
  }

  async function verifyGraphAccess(accessToken) {
    log('info', 'Verifying Graph API access with /me endpoint');

    const parsed = new URL(`${GRAPH_BASE}/me`);
    const options = {
      method: 'GET',
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json'
      }
    };

    try {
      const response = await httpRequest(options);
      const me = response.body;
      if (!me || (!me.mail && !me.userPrincipalName)) {
        log('error', 'Graph /me response missing identity fields', { hasMail: Boolean(me?.mail), hasUpn: Boolean(me?.userPrincipalName) });
        throw new Error('Unable to verify Microsoft Graph account identity - /me response incomplete.');
      }
      log('info', 'Graph /me verification successful', {
        upn: me.userPrincipalName,
        displayName: me.displayName,
        id: me.id
      });
      return me;
    } catch (error) {
      log('error', 'Graph /me verification failed', { error: error.message });
      throw error;
    }
  }

  async function getAccessToken(account, options = {}) {
    if (!account) {
      throw new Error('Missing account record.');
    }

    const decryptedAccessToken = account.oauth_access_token ? security.decrypt(account.oauth_access_token) : '';
    const refreshToken = account.oauth_refresh_token ? security.decrypt(account.oauth_refresh_token) : '';
    const expiresAt = account.oauth_expires_at ? new Date(account.oauth_expires_at).getTime() : 0;

    if (decryptedAccessToken && Date.now() < expiresAt - TOKEN_REFRESH_BUFFER_MS) {
      log('info', 'Using cached access token', {
        accountId: account.id,
        expiresInSeconds: Math.round((expiresAt - Date.now()) / 1000)
      });
      return decryptedAccessToken;
    }

    if (!refreshToken) {
      log('error', 'No refresh token available - re-authorization required', { accountId: account.id });
      await updateConnectionStatus(account.id, 'disconnected', 'Refresh token missing');
      const error = new Error('Microsoft OAuth refresh token is missing. Please re-authorize the account.');
      error.needsReauth = true;
      throw error;
    }

    log('info', 'Access token expired or expiring soon, refreshing', {
      accountId: account.id,
      expiresInSeconds: Math.round((expiresAt - Date.now()) / 1000)
    });

    try {
      const refreshed = await refreshTokens(refreshToken);
      await saveTokenResult(account.id, refreshed);
      const updatedAccount = await getAccountRow(account.id);
      return security.decrypt(updatedAccount.oauth_access_token);
    } catch (error) {
      if (error.isRefreshTokenRevoked) {
        log('error', 'Refresh token revoked or expired - clearing tokens', { accountId: account.id });
        await clearTokens(account.id);
        const reauthError = new Error('Microsoft OAuth session expired. Please re-authorize the account.');
        reauthError.needsReauth = true;
        throw reauthError;
      }
      throw error;
    }
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

    getScope() {
      return DEFAULT_SCOPE;
    },

    createAuthorization(accountId) {
      const state = createState();
      const codeVerifier = generateCodeVerifier();
      const codeChallenge = generateCodeChallenge(codeVerifier);

      pendingAuthorization = {
        accountId: Number(accountId),
        state,
        codeVerifier,
        createdAt: Date.now()
      };

      const url = buildAuthUrl(state, codeChallenge);

      log('info', 'OAuth authorization created', {
        accountId,
        statePrefix: state.substring(0, 8),
        hasPKCE: true,
        redirectUri
      });

      return { url, state };
    },

    async handleCallbackUrl(url) {
      log('info', 'Processing OAuth callback URL', { urlPrefix: url?.substring(0, 50) });

      if (!pendingAuthorization) {
        log('error', 'No pending authorization found for callback');
        throw new Error('No pending Microsoft OAuth authorization was found. The authorization may have timed out.');
      }

      let code, state, error, errorDescription;

      try {
        const parsed = new URL(url);
        const query = parsed.searchParams;
        state = query.get('state');
        code = query.get('code');
        error = query.get('error');
        errorDescription = query.get('error_description');

        if (!code && !error && url.includes('#')) {
          const fragmentPart = url.split('#')[1];
          log('info', 'Attempting fragment parsing for callback');
          const fragmentParams = new URLSearchParams(fragmentPart);
          if (!code) code = fragmentParams.get('code');
          if (!state) state = fragmentParams.get('state');
          if (!error) error = fragmentParams.get('error');
          if (!errorDescription) errorDescription = fragmentParams.get('error_description');
        }
      } catch (parseError) {
        log('error', 'Failed to parse callback URL', { error: parseError.message });
        throw new Error(`Failed to parse Microsoft OAuth callback URL: ${parseError.message}`);
      }

      if (!state || state !== pendingAuthorization.state) {
        log('error', 'OAuth state mismatch', {
          receivedState: state?.substring(0, 8),
          expectedState: pendingAuthorization.state.substring(0, 8)
        });
        pendingAuthorization = null;
        throw new Error('Microsoft OAuth state mismatch. This may indicate a tampered request or expired session.');
      }

      if (error) {
        pendingAuthorization = null;
        const isCancelled = error === 'access_denied' || error === 'consent_required';
        if (isCancelled) {
          log('warn', 'User cancelled OAuth consent', { error, errorDescription });
          const cancelError = new Error('Microsoft OAuth authorization was cancelled by the user.');
          cancelError.cancelled = true;
          throw cancelError;
        }
        log('error', 'Microsoft OAuth error in callback', { error, errorDescription });
        throw new Error(`Microsoft OAuth error: ${errorDescription || error}`);
      }

      if (!code) {
        pendingAuthorization = null;
        log('error', 'No authorization code in callback', { urlPrefix: url?.substring(0, 80) });
        throw new Error('Microsoft OAuth callback did not include an authorization code.');
      }

      const accountId = pendingAuthorization.accountId;
      const codeVerifier = pendingAuthorization.codeVerifier;
      pendingAuthorization = null;

      log('info', 'Authorization code received, starting token exchange', { accountId });

      await ensureAccountHasGraphCredentials(accountId);
      await updateConnectionStatus(accountId, 'connecting', null);

      let tokenResult;
      try {
        tokenResult = await exchangeCode(code, codeVerifier);
      } catch (exchangeError) {
        await updateConnectionStatus(accountId, 'error', `Token exchange failed: ${exchangeError.message}`);
        throw exchangeError;
      }

      let me;
      try {
        me = await verifyGraphAccess(tokenResult.access_token);
      } catch (verifyError) {
        log('error', 'Graph /me verification failed after token exchange - tokens may be invalid', {
          accountId,
          error: verifyError.message
        });
        await updateConnectionStatus(accountId, 'error', `Graph verification failed: ${verifyError.message}`);
        throw new Error(`Microsoft Graph verification failed: ${verifyError.message}. The authorization was not saved.`);
      }

      await saveTokenResult(accountId, tokenResult);

      const emailAddress = me.mail || me.userPrincipalName || '';
      if (emailAddress) {
        await db.run(
          `UPDATE accounts SET email = ?, display_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [emailAddress.toLowerCase(), me.displayName || '', Number(accountId)]
        );
      }

      log('info', 'Microsoft Graph authorization completed successfully', {
        accountId,
        email: emailAddress,
        displayName: me.displayName
      });

      const updatedAccount = await getAccountRow(accountId);
      return {
        accountId,
        email: updatedAccount.email || emailAddress,
        displayName: me.displayName || '',
        expiresAt: updatedAccount.oauth_expires_at,
        scope: updatedAccount.oauth_scope,
        connected: true
      };
    },

    async getAccessTokenForAccount(accountId) {
      const account = await ensureAccountHasGraphCredentials(accountId);
      return getAccessToken(account);
    },

    async verifyConnection(accountId) {
      const account = await ensureAccountHasGraphCredentials(accountId);
      const accessToken = await getAccessToken(account);
      const me = await verifyGraphAccess(accessToken);
      await updateConnectionStatus(accountId, 'connected', null);
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
      const accessToken = await getAccessToken(account);

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
