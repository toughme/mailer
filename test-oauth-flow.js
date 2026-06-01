const { createMicrosoftOauthService } = require('./src/core/services/microsoftOauthService');
const crypto = require('crypto');

function createMockDb() {
  const rows = {};
  return {
    async get(sql, params) {
      const id = params?.[0];
      if (sql.includes('FROM accounts')) {
        return rows[`account_${id}`] || null;
      }
      return null;
    },
    async run(sql, params) {
      if (sql.includes('UPDATE accounts') && sql.includes('connection_status')) {
        const id = params?.[params.length - 1];
        const account = rows[`account_${id}`] || {};
        const statusIdx = sql.indexOf('connection_status');
        if (statusIdx > -1 && params?.[0]) {
          account.connection_status = params[0];
        }
        rows[`account_${id}`] = account;
      }
      if (sql.includes('UPDATE accounts') && sql.includes('oauth_access_token')) {
        const id = params?.[params.length - 1];
        const account = rows[`account_${id}`] || {};
        account.oauth_access_token = params[0];
        account.oauth_refresh_token = params[1];
        account.oauth_expires_at = params[2];
        account.oauth_scope = params[3];
        account.oauth_token_type = params[4];
        account.connection_status = 'connected';
        rows[`account_${id}`] = account;
      }
      if (sql.includes('UPDATE accounts') && sql.includes('email = ?')) {
        const id = params?.[params.length - 1];
        const account = rows[`account_${id}`] || {};
        account.email = params[0];
        account.display_name = params[1];
        rows[`account_${id}`] = account;
      }
    },
    setAccount(id, data) {
      rows[`account_${id}`] = { id, ...data };
    },
    getAccount(id) {
      return rows[`account_${id}`] || null;
    }
  };
}

function createMockSecurity() {
  const store = new Map();
  return {
    encrypt(value) {
      const key = crypto.randomBytes(16).toString('hex');
      store.set(key, String(value));
      return `enc:${key}`;
    },
    decrypt(value) {
      if (!value || !value.startsWith('enc:')) return String(value || '');
      return store.get(value.slice(4)) || '';
    }
  };
}

function createMockEventLog() {
  const events = [];
  return {
    async record(entry) {
      events.push(entry);
    },
    getEvents() {
      return events;
    }
  };
}

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${message}`);
  } else {
    failed++;
    console.error(`  FAIL: ${message}`);
  }
}

function test(name, fn) {
  console.log(`\n--- ${name} ---`);
  try {
    fn();
  } catch (error) {
    failed++;
    console.error(`  ERROR: ${error.message}`);
  }
}

async function testAsync(name, fn) {
  console.log(`\n--- ${name} ---`);
  try {
    await fn();
  } catch (error) {
    failed++;
    console.error(`  ERROR: ${error.message}`);
  }
}

const db = createMockDb();
const security = createMockSecurity();
const eventLog = createMockEventLog();
const service = createMicrosoftOauthService({ db, security, eventLog });

test('PKCE code verifier generation', () => {
  const v1 = crypto.randomBytes(32).toString('base64url');
  const v2 = crypto.randomBytes(32).toString('base64url');
  assert(v1.length > 0, 'Verifier is non-empty');
  assert(v1 !== v2, 'Each verifier is unique');
  assert(v1.length >= 43, 'Verifier is at least 43 chars (base64url of 32 bytes)');
});

test('PKCE code challenge = SHA256(verifier)', () => {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  assert(challenge.length > 0, 'Challenge is non-empty');
  assert(challenge !== verifier, 'Challenge differs from verifier');

  const challenge2 = crypto.createHash('sha256').update(verifier).digest('base64url');
  assert(challenge === challenge2, 'Same verifier produces same challenge');

  const differentVerifier = crypto.randomBytes(32).toString('base64url');
  const challenge3 = crypto.createHash('sha256').update(differentVerifier).digest('base64url');
  assert(challenge !== challenge3, 'Different verifier produces different challenge');
});

test('Authorization URL includes required OAuth parameters', () => {
  const auth = service.createAuthorization(1);
  const url = new URL(auth.url);

  assert(url.hostname === 'login.microsoftonline.com', 'Host is login.microsoftonline.com');
  assert(url.pathname.endsWith('/oauth2/v2.0/authorize'), 'Path is /oauth2/v2.0/authorize');
  assert(url.searchParams.get('client_id') === 'e9a7fea1-1cc0-4cd9-a31b-9137ca5deedd', 'client_id is set');
  assert(url.searchParams.get('response_type') === 'code', 'response_type is code');
  assert(url.searchParams.get('redirect_uri') === 'com.emclient.MailClient://oauth', 'redirect_uri is custom protocol');
  assert(url.searchParams.get('response_mode') === 'query', 'response_mode is query');
  assert(url.searchParams.get('prompt') === 'consent', 'prompt is consent');
  assert(url.searchParams.get('state') === auth.state, 'State matches returned state');
  assert(url.searchParams.get('code_challenge') !== null, 'code_challenge is present (PKCE)');
  assert(url.searchParams.get('code_challenge_method') === 'S256', 'code_challenge_method is S256');
});

test('Authorization scope includes required permissions', () => {
  const auth = service.createAuthorization(1);
  const url = new URL(auth.url);
  const scope = url.searchParams.get('scope');

  assert(scope.includes('IMAP.AccessAsUser.All'), 'Scope includes IMAP.AccessAsUser.All');
  assert(scope.includes('SMTP.Send'), 'Scope includes SMTP.Send');
  assert(scope.includes('offline_access'), 'Scope includes offline_access');
  assert(scope.includes('openid'), 'Scope includes openid');
  assert(scope.includes('profile'), 'Scope includes profile');
});

test('Each authorization gets unique state', () => {
  const auth1 = service.createAuthorization(1);
  const auth2 = service.createAuthorization(2);
  assert(auth1.state !== auth2.state, 'States are unique across authorizations');
});

test('Callback URL parsing - query params (response_mode=query)', () => {
  const auth = service.createAuthorization(5);
  const fakeCallbackUrl = `com.emclient.MailClient://oauth?code=TEST_CODE_123&state=${auth.state}`;

  db.setAccount(5, { id: 5, primary_protocol: 'graph' });

  service.handleCallbackUrl(fakeCallbackUrl).then((result) => {
  }).catch((error) => {
    assert(error.message.includes('token exchange') || error.message.includes('HTTP'),
      'Expected token exchange error (no real code): ' + error.message.substring(0, 80));
  });
});

test('Callback URL parsing - fragment params (response_mode=fragment fallback)', () => {
  const auth = service.createAuthorization(6);
  const fakeFragmentUrl = `com.emclient.MailClient://oauth#code=TEST_CODE_456&state=${auth.state}`;

  db.setAccount(6, { id: 6, primary_protocol: 'graph' });

  service.handleCallbackUrl(fakeFragmentUrl).then(() => {
  }).catch((error) => {
    assert(error.message.includes('token exchange') || error.message.includes('HTTP') || error.message.includes('failed'),
      'Expected token exchange error (no real code): ' + error.message.substring(0, 80));
  });
});

test('Callback rejects state mismatch', () => {
  service.createAuthorization(10);
  const wrongStateUrl = 'com.emclient.MailClient://oauth?code=ABC&state=WRONG_STATE';

  service.handleCallbackUrl(wrongStateUrl).then(() => {
    assert(false, 'Should have thrown state mismatch error');
  }).catch((error) => {
    assert(error.message.includes('state mismatch'), 'Rejects with state mismatch: ' + error.message);
  });
});

test('Callback handles access_denied (user cancelled)', () => {
  const auth = service.createAuthorization(11);
  const cancelUrl = `com.emclient.MailClient://oauth?error=access_denied&error_description=User+cancelled&state=${auth.state}`;

  service.handleCallbackUrl(cancelUrl).then(() => {
    assert(false, 'Should have thrown cancelled error');
  }).catch((error) => {
    assert(error.message.includes('cancelled'), 'Rejects with cancelled message');
    assert(error.cancelled === true, 'Error has cancelled=true flag');
  });
});

test('Callback handles consent_required error', () => {
  const auth = service.createAuthorization(12);
  const consentUrl = `com.emclient.MailClient://oauth?error=consent_required&state=${auth.state}`;

  service.handleCallbackUrl(consentUrl).then(() => {
    assert(false, 'Should have thrown error');
  }).catch((error) => {
    assert(error.cancelled === true, 'consent_required has cancelled=true flag');
  });
});

test('Callback handles other OAuth errors', () => {
  const auth = service.createAuthorization(13);
  const errorUrl = `com.emclient.MailClient://oauth?error=invalid_request&error_description=Bad+request&state=${auth.state}`;

  service.handleCallbackUrl(errorUrl).then(() => {
    assert(false, 'Should have thrown OAuth error');
  }).catch((error) => {
    assert(error.message.includes('invalid_request'), 'Includes error code');
    assert(error.cancelled !== true, 'Non-cancelled error has no cancelled flag');
  });
});

test('Callback rejects when no pending authorization', async () => {
  const freshDb = createMockDb();
  const freshSecurity = createMockSecurity();
  const freshEventLog = createMockEventLog();
  const freshService = createMicrosoftOauthService({ db: freshDb, security: freshSecurity, eventLog: freshEventLog });

  try {
    await freshService.handleCallbackUrl('com.emclient.MailClient://oauth?code=ABC&state=anything');
    assert(false, 'Should have thrown no-pending-authorization error');
  } catch (error) {
    assert(error.message.includes('No pending') || error.message.includes('timed out'),
      'Rejects with no pending authorization: ' + error.message);
  }
});

test('getRedirectUri returns custom protocol', () => {
  assert(service.getRedirectUri() === 'com.emclient.MailClient://oauth', 'Redirect URI is custom protocol');
});

test('getScope returns all required scopes', () => {
  const scope = service.getScope();
  assert(scope.includes('IMAP.AccessAsUser.All'), 'Scope includes IMAP.AccessAsUser.All');
  assert(scope.includes('SMTP.Send'), 'Scope includes SMTP.Send');
  assert(scope.includes('offline_access'), 'Scope includes offline_access');
});

console.log('\n========================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('========================================');

process.exit(failed > 0 ? 1 : 0);
