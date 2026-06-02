const crypto = require('crypto');
const https = require('https');
const { URL, URLSearchParams } = require('url');

const MS_AUTHORITY = 'https://login.microsoftonline.com/common';
const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0';
// Override these environment variables to use a different Azure app or redirect URI.
const DEFAULT_SCOPE = process.env.MICROSOFT_OAUTH_SCOPES || 'offline_access openid profile email Mail.Send';
const CLIENT_ID = process.env.MICROSOFT_OAUTH_CLIENT_ID || 'e9a7fea1-1cc0-4cd9-a31b-9137ca5deedd';
const REDIRECT_URI = process.env.MICROSOFT_OAUTH_REDIRECT_URI || 'com.emclient.MailClient://oauth';
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
      client_id: CLIENT_ID,
      response_type: 'code',
      redirect_uri: REDIRECT_URI,
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

    const existingRow = await getAccountRow(accountId);
    const refreshToken = result.refresh_token || (existingRow?.oauth_refresh_token ? security.decrypt(existingRow.oauth_refresh_token) : '');

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
        security.encrypt(refreshToken),
        expiresAt,
        result.scope || DEFAULT_SCOPE,
        result.token_type || 'Bearer',
        Number(accountId)
      ]
    );

    log('info', 'Token saved for account', {
      accountId,
      expiresAt,
      hasRefreshToken: Boolean(refreshToken),
      preservedRefreshToken: !result.refresh_token && Boolean(existingRow?.oauth_refresh_token),
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

  async function callGraphApi(accessToken, method, path, body = null) {
    const requestBody = body ? JSON.stringify(body) : null;
    const headers = {
      Authorization: `Bearer ${accessToken}`
    };
    if (requestBody) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(requestBody);
    }

    const parsedUrl = new URL(path, GRAPH_API_BASE);
    const options = {
      method,
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      headers
    };

    return httpRequest(options, requestBody);
  }

  function getGraphEmail(data) {
    return String(data?.mail || data?.userPrincipalName || data?.preferredEmail || data?.id || '').toLowerCase();
  }

  async function verifyGraphAccess(accountId) {
    const account = await ensureAccountHasOAuth(accountId);
    const accessToken = await getAccessToken(account);
    const response = await callGraphApi(accessToken, 'GET', `${GRAPH_API_BASE}/me`);
    const data = response.body || {};
    const email = getGraphEmail(data) || account.email;
    const ok = Boolean(email);
    await updateConnectionStatus(accountId, ok ? 'connected' : 'error', ok ? null : 'Graph verification failed');
    if (ok && email && email !== account.email) {
      await db.run(
        `UPDATE accounts SET email = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [email, Number(accountId)]
      );
    }
    return { ok, email };
  }

  async function sendGraphMail(accountId, mailPayload) {
    const account = await ensureAccountHasOAuth(accountId);
    const accessToken = await getAccessToken(account);
    const response = await callGraphApi(accessToken, 'POST', `${GRAPH_API_BASE}/me/sendMail`, mailPayload);
    return response;
  }

  async function exchangeCode(code, codeVerifier) {
    log('info', 'Exchanging authorization code for tokens');

    const params = {
      client_id: CLIENT_ID,
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
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
        client_id: CLIENT_ID,
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
      log('error', 'Token refresh failed', { error: error.message, isInvalidGrant });
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

  async function ensureAccountHasOAuth(accountId) {
    const account = await getAccountRow(accountId);
    if (!account) {
      throw new Error('Account not found.');
    }

    if ((account.primary_protocol || 'smtp').toLowerCase() !== 'graph') {
      throw new Error('Account is not configured for Microsoft OAuth.');
    }

    return account;
  }

  function buildXOAuth2TokenInternal(user, accessToken) {
    const authString = `user=${user}\x01auth=Bearer ${accessToken}\x01\x01`;
    return Buffer.from(authString, 'utf8').toString('base64');
  }

  return {
    getRedirectUri() {
      return REDIRECT_URI;
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
        redirectUri: REDIRECT_URI
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

      await ensureAccountHasOAuth(accountId);
      await updateConnectionStatus(accountId, 'connecting', null);

      let tokenResult;
      try {
        tokenResult = await exchangeCode(code, codeVerifier);
      } catch (exchangeError) {
        await updateConnectionStatus(accountId, 'error', `Token exchange failed: ${exchangeError.message}`);
        throw exchangeError;
      }

      const accessToken = tokenResult.access_token;
      const userEmail = tokenResult.id_token
        ? tryExtractEmailFromIdToken(tokenResult.id_token)
        : '';

      await saveTokenResult(accountId, tokenResult);

      if (userEmail) {
        await db.run(
          `UPDATE accounts SET email = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [userEmail.toLowerCase(), Number(accountId)]
        );
      }

      const graphVerification = await verifyGraphAccess(accountId);
      if (!graphVerification.ok) {
        log('warn', 'Graph verification failed after token exchange - tokens saved but connection may need retry', { accountId });
      } else {
        log('info', 'Graph verification successful', { accountId, email: graphVerification.email });
      }

      log('info', 'Microsoft Graph authorization completed', { accountId, email: graphVerification.email || userEmail });

      const updatedAccount = await getAccountRow(accountId);
      return {
        accountId,
        email: updatedAccount.email || userEmail,
        expiresAt: updatedAccount.oauth_expires_at,
        scope: updatedAccount.oauth_scope,
        connected: graphVerification.ok
      };
    },

    async getAccessTokenForAccount(accountId) {
      const account = await ensureAccountHasOAuth(accountId);
      return getAccessToken(account);
    },

    async verifyConnection(accountId) {
      return verifyGraphAccess(accountId);
    },

    buildXOAuth2Token(user, accessToken) {
      return buildXOAuth2TokenInternal(user, accessToken);
    },

    async getSmtpTransportConfig(accountId) {
      const account = await ensureAccountHasOAuth(accountId);
      const accessToken = await getAccessToken(account);
      return {
        host: 'smtp.office365.com',
        port: 587,
        secure: false,
        requireTLS: true,
        auth: {
          type: 'OAuth2',
          user: account.email,
          accessToken
        },
        connectionTimeout: 20000,
        greetingTimeout: 20000,
        socketTimeout: 20000,
        tls: { rejectUnauthorized: false }
      };
    },

    async getImapConfig(accountId) {
      const account = await ensureAccountHasOAuth(accountId);
      const accessToken = await getAccessToken(account);
      return {
        user: account.email,
        xoauth2: accessToken,
        host: 'outlook.office365.com',
        port: 993,
        tls: true,
        authTimeout: 30000,
        connectionTimeout: 30000,
        tlsOptions: { rejectUnauthorized: false, minVersion: 'TLSv1.2' }
      };
    },

    async sendMail(accountId, mailPayload) {
      const account = await ensureAccountHasOAuth(accountId);
      const accessToken = await getAccessToken(account);
      return callGraphApi(accessToken, 'POST', `${GRAPH_API_BASE}/me/sendMail`, mailPayload);
    }
  };
}

function tryExtractEmailFromIdToken(idToken) {
  try {
    const parts = idToken.split('.');
    if (parts.length < 2) return '';
    const payload = Buffer.from(parts[1], 'base64url').toString('utf8');
    const decoded = JSON.parse(payload);
    return decoded.preferred_username || decoded.email || decoded.upn || '';
  } catch {
    return '';
  }
}

async function verifyImapXOAuth2(email, accessToken) {
  const imaps = require('imap-simple');
  const xoauth2Token = buildXOAuth2TokenStatic(email, accessToken);

  try {
    const connection = await imaps.connect({
      imap: {
        user: email,
        xoauth2: accessToken,
        host: 'outlook.office365.com',
        port: 993,
        tls: true,
        authTimeout: 30000,
        connectionTimeout: 30000,
        tlsOptions: { rejectUnauthorized: false, minVersion: 'TLSv1.2' }
      }
    });

    try {
      await connection.openBox('INBOX');
      return true;
    } finally {
      if (connection && connection.end) {
        try { await connection.end(); } catch {}
      }
    }
  } catch (error) {
    console.error('[MicrosoftOAuth] IMAP XOAUTH2 verification failed:', error.message);
    return false;
  }
}

function buildXOAuth2TokenStatic(user, accessToken) {
  const authString = `user=${user}\x01auth=Bearer ${accessToken}\x01\x01`;
  return Buffer.from(authString, 'utf8').toString('base64');
}

module.exports = { createMicrosoftOauthService };
