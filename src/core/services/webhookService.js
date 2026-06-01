const crypto = require('crypto');
const https = require('https');

function parseJson(value, fallback) {
  try {
    return JSON.parse(value || '');
  } catch {
    return fallback;
  }
}

function normalizeEndpoint(row) {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    events: parseJson(row.events, []),
    status: row.status,
    lastStatus: row.last_status,
    lastError: row.last_error,
    lastDeliveredAt: row.last_delivered_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function validateWebhookUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Webhook URL is not a valid URL.');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('Webhook URL must use HTTPS.');
  }

  const hostname = parsed.hostname.toLowerCase();
  const blockedPatterns = [
    /^127\./,
    /^10\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
    /^192\.168\./,
    /^169\.254\./,
    /^0\./,
    /^localhost$/i,
    /\.local$/i,
    /\.internal$/i,
    /^fc00:/i,
    /^fe80:/i,
    /^::1$/i,
    /^fd/i
  ];

  for (const pattern of blockedPatterns) {
    if (pattern.test(hostname)) {
      throw new Error('Webhook URL must point to a public internet address.');
    }
  }
}

function postJson(url, payload, secret) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const body = JSON.stringify(payload);
    const signature = secret
      ? crypto.createHmac('sha256', secret).update(body).digest('hex')
      : '';
    const request = https.request(
      {
        method: 'POST',
        hostname: target.hostname,
        port: target.port || 443,
        path: `${target.pathname}${target.search}`,
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          ...(signature ? { 'X-Phantom-Signature': signature } : {})
        }
      },
      (response) => {
        response.resume();
        response.on('end', () => resolve(response.statusCode));
        response.on('error', () => resolve(response.statusCode));
      }
    );
    request.on('timeout', () => {
      request.destroy(new Error('Webhook request timed out.'));
    });
    request.on('error', reject);
    request.write(body);
    request.end();
  });
}

function createWebhookService({ db, security }) {
  return {
    async list() {
      const rows = await db.all('SELECT * FROM webhook_endpoints ORDER BY created_at DESC');
      return rows.map(normalizeEndpoint);
    },

    async create(payload) {
      const name = String(payload.name || '').trim();
      const url = String(payload.url || '').trim();
      const events = Array.isArray(payload.events) ? payload.events : ['sent', 'failed', 'bounce', 'complaint', 'unsubscribe'];
      const secret = String(payload.secret || '').trim();
      const status = payload.status === 'paused' ? 'paused' : 'active';

      if (!name || !url) {
        throw new Error('Webhook name and URL are required.');
      }

      validateWebhookUrl(url);

      const encryptedSecret = secret && security ? security.encrypt(secret) : '';

      await db.run(
        `INSERT INTO webhook_endpoints (name, url, events, secret, status, updated_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(name) DO UPDATE SET
        url = excluded.url,
        events = excluded.events,
        secret = CASE WHEN excluded.secret != '' THEN excluded.secret ELSE webhook_endpoints.secret END,
        status = excluded.status,
        updated_at = CURRENT_TIMESTAMP`,
        [name, url, JSON.stringify(events), encryptedSecret, status]
      );

      return this.list();
    },

    async remove(id) {
      await db.run('DELETE FROM webhook_endpoints WHERE id = ?', [Number(id)]);
      return this.list();
    },

    async dispatch(event) {
      const rows = await db.all('SELECT * FROM webhook_endpoints WHERE status = ?', ['active']);

      const dispatches = rows.map(async (row) => {
        const events = parseJson(row.events, []);
        if (events.length && !events.includes(event.eventType)) {
          return;
        }

        const decryptedSecret = row.secret && security ? security.decrypt(row.secret) : '';

        try {
          const statusCode = await postJson(row.url, { event }, decryptedSecret);
          await db.run(
            `UPDATE webhook_endpoints
            SET last_status = ?, last_error = '', last_delivered_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?`,
            [String(statusCode), row.id]
          );
        } catch (error) {
          await db.run(
            `UPDATE webhook_endpoints
            SET last_error = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?`,
            [error.message || 'Webhook delivery failed.', row.id]
          );
        }
      });

      await Promise.allSettled(dispatches);
    }
  };
}

module.exports = { createWebhookService };
