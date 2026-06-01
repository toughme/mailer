const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

class DatabaseManager {
  constructor(db, dbPath) {
    this.db = db;
    this.dbPath = dbPath;
  }

  persist() {
    const data = this.db.export();
    fs.writeFileSync(this.dbPath, Buffer.from(data));
  }

  run(sql, params = []) {
    try {
      this.db.run(sql, params);
      const idResult = this.db.exec('SELECT last_insert_rowid() AS id');
      const lastID = idResult[0]?.values[0][0] ?? 0;
      const changes = this.db.getRowsModified();
      this.persist();
      return Promise.resolve({ lastID, changes });
    } catch (error) {
      return Promise.reject(error);
    }
  }

  get(sql, params = []) {
    try {
      const stmt = this.db.prepare(sql);
      stmt.bind(params);
      let row = null;
      if (stmt.step()) {
        row = stmt.getAsObject();
      }
      stmt.free();
      return Promise.resolve(row);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  all(sql, params = []) {
    try {
      const stmt = this.db.prepare(sql);
      stmt.bind(params);
      const rows = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject());
      }
      stmt.free();
      return Promise.resolve(rows);
    } catch (error) {
      return Promise.reject(error);
    }
  }
}

async function addColumnIfMissing(db, table, column, definition) {
  const columns = await db.all(`PRAGMA table_info(${table})`);
  const exists = columns.some((item) => item.name === column);
  if (!exists) {
    await db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

async function initializeDatabase(baseDataDir) {
  fs.mkdirSync(baseDataDir, { recursive: true });

  const dbPath = path.join(baseDataDir, 'phantom-mailer.db');
  const wasmPath = path.join(__dirname, '..', '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');

  const SQL = await initSqlJs({
    locateFile: () => wasmPath
  });

  let db;
  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  const manager = new DatabaseManager(db, dbPath);

  await manager.run(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      primary_protocol TEXT DEFAULT 'smtp',
      email TEXT NOT NULL UNIQUE,
      display_name TEXT DEFAULT '',
      username TEXT DEFAULT '',
      encrypted_password TEXT DEFAULT '',
      host TEXT DEFAULT '',
      port INTEGER DEFAULT 587,
      secure INTEGER DEFAULT 1,
      notes TEXT DEFAULT '',
      oauth_access_token TEXT DEFAULT '',
      oauth_refresh_token TEXT DEFAULT '',
      oauth_expires_at TEXT DEFAULT '',
      oauth_scope TEXT DEFAULT '',
      oauth_token_type TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await manager.run(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      subject TEXT NOT NULL,
      preview_text TEXT DEFAULT '',
      content TEXT DEFAULT '',
      subject_b TEXT DEFAULT '',
      content_b TEXT DEFAULT '',
      ab_enabled INTEGER DEFAULT 0,
      split_ratio INTEGER DEFAULT 50,
      status TEXT DEFAULT 'draft',
      segment_id INTEGER,
      recipient_ids TEXT DEFAULT '[]',
      use_individual_recipients INTEGER DEFAULT 0,
      scheduled_at TEXT,
      metrics TEXT DEFAULT '{}',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await manager.run(`
    CREATE TABLE IF NOT EXISTS recipients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      name TEXT DEFAULT '',
      category TEXT DEFAULT '',
      tags TEXT DEFAULT '[]',
      metadata TEXT DEFAULT '{}',
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await manager.run(`
    CREATE TABLE IF NOT EXISTS segments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT DEFAULT '',
      filters TEXT DEFAULT '{}',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await manager.run(`
    CREATE TABLE IF NOT EXISTS content_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      subject TEXT DEFAULT '',
      preview_text TEXT DEFAULT '',
      content_html TEXT DEFAULT '',
      editor_html TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await manager.run(`
    CREATE TABLE IF NOT EXISTS domain_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      status TEXT DEFAULT 'draft',
      registrar TEXT DEFAULT '',
      registered_at TEXT,
      age_days INTEGER DEFAULT 0,
      spf_ready INTEGER DEFAULT 0,
      dkim_ready INTEGER DEFAULT 0,
      dmarc_ready INTEGER DEFAULT 0,
      bimi_ready INTEGER DEFAULT 0,
      mta_sts_ready INTEGER DEFAULT 0,
      reputation_score INTEGER DEFAULT 0,
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await manager.run(`
    CREATE TABLE IF NOT EXISTS ip_pools (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      provider TEXT DEFAULT '',
      status TEXT DEFAULT 'active',
      ips TEXT DEFAULT '[]',
      assigned_domains TEXT DEFAULT '[]',
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await manager.run(`
    CREATE TABLE IF NOT EXISTS compliance_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipient_id INTEGER,
      email TEXT DEFAULT '',
      type TEXT DEFAULT 'audit',
      source TEXT DEFAULT '',
      payload TEXT DEFAULT '{}',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await manager.run(`
    CREATE TABLE IF NOT EXISTS suppression_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      reason TEXT DEFAULT '',
      source TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await manager.run(`
    CREATE TABLE IF NOT EXISTS proxy_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      type TEXT DEFAULT 'http',
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      username TEXT DEFAULT '',
      encrypted_password TEXT DEFAULT '',
      status TEXT DEFAULT 'active',
      notes TEXT DEFAULT '',
      last_tested_at TEXT,
      last_error TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await manager.run(`
    CREATE TABLE IF NOT EXISTS email_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER,
      recipient_email TEXT DEFAULT '',
      account_id INTEGER,
      provider TEXT DEFAULT '',
      event_type TEXT NOT NULL,
      category TEXT DEFAULT '',
      metadata TEXT DEFAULT '{}',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await manager.run(`
    CREATE TABLE IF NOT EXISTS webhook_endpoints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      url TEXT NOT NULL,
      events TEXT DEFAULT '[]',
      secret TEXT DEFAULT '',
      status TEXT DEFAULT 'active',
      last_status TEXT DEFAULT '',
      last_error TEXT DEFAULT '',
      last_delivered_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await manager.run(`
    CREATE TABLE IF NOT EXISTS reputation_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER,
      provider TEXT DEFAULT '',
      sender_score INTEGER DEFAULT 0,
      bounce_rate REAL DEFAULT 0,
      complaint_rate REAL DEFAULT 0,
      blacklist_status TEXT DEFAULT 'unknown',
      source TEXT DEFAULT 'local',
      notes TEXT DEFAULT '',
      measured_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await manager.run(`
    CREATE TABLE IF NOT EXISTS email_validation_cache (
      email TEXT PRIMARY KEY,
      status TEXT DEFAULT 'unknown',
      reason TEXT DEFAULT '',
      provider TEXT DEFAULT 'local',
      checked_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await addColumnIfMissing(manager, 'accounts', 'primary_protocol', "TEXT DEFAULT 'smtp'");
  await addColumnIfMissing(manager, 'accounts', 'display_name', "TEXT DEFAULT ''");
  await addColumnIfMissing(manager, 'accounts', 'username', "TEXT DEFAULT ''");
  await addColumnIfMissing(manager, 'accounts', 'encrypted_password', "TEXT DEFAULT ''");
  await addColumnIfMissing(manager, 'accounts', 'host', "TEXT DEFAULT ''");
  await addColumnIfMissing(manager, 'accounts', 'port', 'INTEGER DEFAULT 587');
  await addColumnIfMissing(manager, 'accounts', 'secure', 'INTEGER DEFAULT 1');
  await addColumnIfMissing(manager, 'accounts', 'notes', "TEXT DEFAULT ''");
  await addColumnIfMissing(manager, 'accounts', 'oauth_access_token', "TEXT DEFAULT ''");
  await addColumnIfMissing(manager, 'accounts', 'oauth_refresh_token', "TEXT DEFAULT ''");
  await addColumnIfMissing(manager, 'accounts', 'oauth_expires_at', "TEXT DEFAULT ''");
  await addColumnIfMissing(manager, 'accounts', 'oauth_scope', "TEXT DEFAULT ''");
  await addColumnIfMissing(manager, 'accounts', 'oauth_token_type', "TEXT DEFAULT ''");
  await addColumnIfMissing(manager, 'accounts', 'proxy_profile_id', 'INTEGER');
  await addColumnIfMissing(manager, 'accounts', 'connection_status', "TEXT DEFAULT 'pending'");
  await addColumnIfMissing(manager, 'campaigns', 'subject_b', "TEXT DEFAULT ''");
  await addColumnIfMissing(manager, 'campaigns', 'content_b', "TEXT DEFAULT ''");
  await addColumnIfMissing(manager, 'campaigns', 'ab_enabled', 'INTEGER DEFAULT 0');
  await addColumnIfMissing(manager, 'campaigns', 'split_ratio', 'INTEGER DEFAULT 50');
  await addColumnIfMissing(manager, 'campaigns', 'segment_id', 'INTEGER');
  await addColumnIfMissing(manager, 'campaigns', 'scheduled_at', 'TEXT');
  await addColumnIfMissing(manager, 'campaigns', 'metrics', "TEXT DEFAULT '{}'");
  await addColumnIfMissing(manager, 'campaigns', 'recipient_ids', "TEXT DEFAULT '[]'");
  await addColumnIfMissing(manager, 'campaigns', 'use_individual_recipients', 'INTEGER DEFAULT 0');
  await addColumnIfMissing(manager, 'recipients', 'category', "TEXT DEFAULT ''");

  await manager.run(`
    CREATE TABLE IF NOT EXISTS send_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      delay_min_ms INTEGER DEFAULT 45000,
      delay_max_ms INTEGER DEFAULT 120000,
      daily_cap_per_account INTEGER DEFAULT 80,
      rotation_mode TEXT DEFAULT 'random',
      jitter_percent INTEGER DEFAULT 25,
      max_retries INTEGER DEFAULT 2,
      shuffle_recipients INTEGER DEFAULT 1,
      min_spam_score INTEGER DEFAULT 55,
      warmup_enabled INTEGER DEFAULT 1,
      physical_address TEXT DEFAULT '',
      require_dns INTEGER DEFAULT 1,
      failure_pause_threshold INTEGER DEFAULT 5,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await manager.run(`
    CREATE TABLE IF NOT EXISTS ai_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      provider TEXT DEFAULT 'nvidia',
      encrypted_api_key TEXT DEFAULT '',
      model TEXT DEFAULT 'meta/llama-3.2-3b-instruct',
      base_url TEXT DEFAULT 'https://integrate.api.nvidia.com/v1',
      system_prompt TEXT DEFAULT '',
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await addColumnIfMissing(manager, 'send_settings', 'min_spam_score', 'INTEGER DEFAULT 55');
  await addColumnIfMissing(manager, 'send_settings', 'warmup_enabled', 'INTEGER DEFAULT 1');
  await addColumnIfMissing(manager, 'send_settings', 'physical_address', "TEXT DEFAULT ''");
  await addColumnIfMissing(manager, 'send_settings', 'require_dns', 'INTEGER DEFAULT 1');
  await addColumnIfMissing(manager, 'send_settings', 'failure_pause_threshold', 'INTEGER DEFAULT 5');
  await addColumnIfMissing(manager, 'ai_settings', 'system_prompt', "TEXT");

  await manager.run(`
    CREATE TABLE IF NOT EXISTS send_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      recipient_id INTEGER,
      recipient_email TEXT NOT NULL,
      recipient_name TEXT DEFAULT '',
      account_id INTEGER,
      subject TEXT NOT NULL,
      content_html TEXT DEFAULT '',
      preview_text TEXT DEFAULT '',
      variant TEXT DEFAULT 'A',
      status TEXT DEFAULT 'pending',
      attempts INTEGER DEFAULT 0,
      last_error TEXT DEFAULT '',
      scheduled_at TEXT,
      sent_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await manager.run(`
    CREATE TABLE IF NOT EXISTS account_send_stats (
      account_id INTEGER PRIMARY KEY,
      sends_today INTEGER DEFAULT 0,
      sends_today_date TEXT,
      total_sent INTEGER DEFAULT 0,
      consecutive_failures INTEGER DEFAULT 0,
      cooldown_until TEXT,
      last_sent_at TEXT
    )
  `);

  return { db: manager, dbPath };
}

module.exports = { initializeDatabase };
