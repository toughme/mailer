const net = require('net');

const ALLOWED_PROXY_TYPES = new Set(['http', 'https', 'socks', 'socks4', 'socks5']);

const HOST_REGEX = /^[a-zA-Z0-9]([a-zA-Z0-9\-.*]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*$/;

function isValidHost(host) {
  if (!host || typeof host !== 'string') return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const parts = host.split('.').map(Number);
    return parts.every((p) => p >= 0 && p <= 255);
  }
  return HOST_REGEX.test(host);
}

function sanitizeType(type) {
  const value = String(type || 'http').trim().toLowerCase();
  return ALLOWED_PROXY_TYPES.has(value) ? value : 'http';
}

function normalizeProxyRow(row) {
  return {
    id: row.id,
    name: row.name,
    type: row.type || 'http',
    host: row.host,
    port: row.port,
    username: row.username,
    hasPassword: Boolean(row.encrypted_password),
    status: row.status || 'active',
    notes: row.notes || '',
    lastTestedAt: row.last_tested_at,
    lastError: row.last_error || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function buildProxyUrl(proxy, password = '') {
  if (!proxy || !proxy.host || !proxy.port) {
    return '';
  }

  const protocol = sanitizeType(proxy.type);
  const auth = proxy.username
    ? `${encodeURIComponent(proxy.username)}${password ? `:${encodeURIComponent(password)}` : ''}@`
    : '';

  return `${protocol}://${auth}${proxy.host}:${proxy.port}`;
}

function createProxyService({ db, security }) {
  return {
    async list() {
      const rows = await db.all('SELECT * FROM proxy_profiles ORDER BY created_at DESC');
      return rows.map(normalizeProxyRow);
    },

    async create(payload) {
      const name = String(payload.name || '').trim();
      const type = sanitizeType(payload.type);
      const host = String(payload.host || '').trim();
      const port = Number(payload.port) || 0;
      const username = String(payload.username || '').trim();
      const password = String(payload.password || '').trim();
      const status = ['active', 'paused'].includes(payload.status) ? payload.status : 'active';
      const notes = String(payload.notes || '').trim();

    if (!name || !host || !port) {
      throw new Error('Proxy name, host, and port are required.');
    }

    if (!isValidHost(host)) {
      throw new Error('Invalid proxy host.');
    }

    if (port < 1 || port > 65535) {
      throw new Error('Proxy port must be between 1 and 65535.');
    }

      await db.run(
        `INSERT INTO proxy_profiles
         (name, type, host, port, username, encrypted_password, status, notes, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(name) DO UPDATE SET
           type = excluded.type,
           host = excluded.host,
           port = excluded.port,
           username = excluded.username,
           encrypted_password = CASE
             WHEN excluded.encrypted_password != '' THEN excluded.encrypted_password
             ELSE proxy_profiles.encrypted_password
           END,
           status = excluded.status,
           notes = excluded.notes,
           updated_at = CURRENT_TIMESTAMP`,
        [name, type, host, port, username, password ? security.encrypt(password) : '', status, notes]
      );

      return this.list();
    },

    async remove(id) {
      const proxyId = Number(id);
      await db.run('UPDATE accounts SET proxy_profile_id = NULL WHERE proxy_profile_id = ?', [proxyId]);
      await db.run('DELETE FROM proxy_profiles WHERE id = ?', [proxyId]);
      return this.list();
    },

    async getById(id) {
      if (!id) {
        return null;
      }

      const row = await db.get('SELECT * FROM proxy_profiles WHERE id = ?', [Number(id)]);
      return row ? normalizeProxyRow(row) : null;
    },

    async getTransportProxyUrl(id) {
      if (!id) {
        return '';
      }

      const row = await db.get('SELECT * FROM proxy_profiles WHERE id = ? AND status = ?', [Number(id), 'active']);
      if (!row) {
        return '';
      }

      return buildProxyUrl(row, security.decrypt(row.encrypted_password));
    },

    async test(id) {
      const proxy = await db.get('SELECT * FROM proxy_profiles WHERE id = ?', [Number(id)]);
    if (!proxy) {
      throw new Error('Proxy profile not found.');
    }

    if (!isValidHost(proxy.host)) {
      throw new Error('Invalid proxy host — cannot test connection.');
    }

      const startedAt = Date.now();
      await new Promise((resolve, reject) => {
        const socket = net.createConnection({ host: proxy.host, port: proxy.port, timeout: 10000 });
        socket.once('connect', () => {
          socket.end();
          resolve();
        });
        socket.once('timeout', () => {
          socket.destroy();
          reject(new Error('Proxy connection timed out.'));
        });
        socket.once('error', reject);
      });

      const latencyMs = Date.now() - startedAt;
      await db.run(
        `UPDATE proxy_profiles
         SET last_tested_at = CURRENT_TIMESTAMP, last_error = '', updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [proxy.id]
      );

      return {
        success: true,
        message: `Proxy ${proxy.name} accepted a TCP connection in ${latencyMs}ms.`,
        latencyMs
      };
    }
  };
}

module.exports = { createProxyService, buildProxyUrl };
