const { PROVIDER_PRESETS } = require('./providerPresets');

const DEFAULT_SETTINGS = {
  delayMinMs: 1000,
  delayMaxMs: 5000,
  dailyCapPerAccount: 50,
  rotationMode: 'reputation',
  jitterPercent: 25,
  maxRetries: 2,
  shuffleRecipients: 1,
  minSpamScore: 55,
  warmupEnabled: true,
  physicalAddress: '',
  requireDns: true,
  failurePauseThreshold: 5
};

const DEFAULT_US_ADDRESSES = [
  '126 James St, Seattle, WA 98104',
  '126 James St, Morristown, NJ 07960',
  '126 James St, Worcester, MA 01603',
  '412 Market St, San Diego, CA 92101',
  '88 Broad St, Boston, MA 02110',
  '1400 Main St, Dallas, TX 75202',
  '215 W Ohio St, Chicago, IL 60654',
  '600 Congress Ave, Austin, TX 78701'
];

function pickRandomUsAddress() {
  return DEFAULT_US_ADDRESSES[Math.floor(Math.random() * DEFAULT_US_ADDRESSES.length)];
}

function createSendSettingsService({ db }) {
  async function ensureRow() {
    const row = await db.get('SELECT id FROM send_settings WHERE id = 1');
      if (!row) {
      const defaultAddress = pickRandomUsAddress();
      await db.run(
        `INSERT INTO send_settings
         (id, delay_min_ms, delay_max_ms, daily_cap_per_account, rotation_mode, jitter_percent,
          max_retries, shuffle_recipients, min_spam_score, warmup_enabled, physical_address,
          require_dns, failure_pause_threshold)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          DEFAULT_SETTINGS.delayMinMs,
          DEFAULT_SETTINGS.delayMaxMs,
          DEFAULT_SETTINGS.dailyCapPerAccount,
          DEFAULT_SETTINGS.rotationMode,
          DEFAULT_SETTINGS.jitterPercent,
          DEFAULT_SETTINGS.maxRetries,
          DEFAULT_SETTINGS.shuffleRecipients,
          DEFAULT_SETTINGS.minSpamScore,
          DEFAULT_SETTINGS.warmupEnabled ? 1 : 0,
          defaultAddress,
          DEFAULT_SETTINGS.requireDns ? 1 : 0,
          DEFAULT_SETTINGS.failurePauseThreshold
        ]
      );
      return;
    }

    const existing = await db.get('SELECT physical_address FROM send_settings WHERE id = 1');
    if (!String(existing?.physical_address || '').trim()) {
      await db.run('UPDATE send_settings SET physical_address = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1', [pickRandomUsAddress()]);
    }
  }

  function mapRow(row) {
    return {
      delayMinMs: row.delay_min_ms,
      delayMaxMs: row.delay_max_ms,
      dailyCapPerAccount: row.daily_cap_per_account,
      rotationMode: row.rotation_mode,
      jitterPercent: row.jitter_percent,
      maxRetries: row.max_retries,
      shuffleRecipients: Boolean(row.shuffle_recipients),
      minSpamScore: row.min_spam_score ?? 55,
      warmupEnabled: row.warmup_enabled !== 0,
      physicalAddress: row.physical_address || '',
      requireDns: row.require_dns !== 0,
      failurePauseThreshold: row.failure_pause_threshold ?? 5,
      updatedAt: row.updated_at
    };
  }

  return {
    getProviderPresets() {
      return Object.values(PROVIDER_PRESETS);
    },

    getAddressSuggestions(query = '') {
      const normalized = String(query || '').trim().toLowerCase();
      if (!normalized) {
        return DEFAULT_US_ADDRESSES;
      }
      return DEFAULT_US_ADDRESSES.filter((address) => address.toLowerCase().includes(normalized)).slice(0, 6);
    },

    async get() {
      await ensureRow();
      const row = await db.get('SELECT * FROM send_settings WHERE id = 1');
      return mapRow(row);
    },

    async update(payload) {
      await ensureRow();
      const current = await this.get();

      const delayMinMs = Math.max(1000, Number(payload.delayMinMs ?? current.delayMinMs));
      const delayMaxMs = Math.max(delayMinMs + 1000, Number(payload.delayMaxMs ?? current.delayMaxMs));
      const dailyCapPerAccount = Math.min(10000, Math.max(1, Number(payload.dailyCapPerAccount ?? current.dailyCapPerAccount)));
      const rotationMode = ['random', 'round_robin', 'reputation'].includes(payload.rotationMode)
        ? payload.rotationMode
        : current.rotationMode;
      const jitterPercent = Math.min(50, Math.max(0, Number(payload.jitterPercent ?? current.jitterPercent)));
      const maxRetries = Math.min(5, Math.max(0, Number(payload.maxRetries ?? current.maxRetries)));
      const shuffleRecipients = payload.shuffleRecipients === false ? 0 : 1;
      const minSpamScore = Math.min(95, Math.max(0, Number(payload.minSpamScore ?? current.minSpamScore)));
      const warmupEnabled = payload.warmupEnabled === false ? 0 : 1;
      const physicalAddress = String(payload.physicalAddress ?? current.physicalAddress).trim();
      const requireDns = payload.requireDns === false ? 0 : 1;
      const failurePauseThreshold = Math.min(20, Math.max(3, Number(payload.failurePauseThreshold ?? current.failurePauseThreshold)));

      await db.run(
        `UPDATE send_settings SET
         delay_min_ms = ?,
         delay_max_ms = ?,
         daily_cap_per_account = ?,
         rotation_mode = ?,
         jitter_percent = ?,
         max_retries = ?,
         shuffle_recipients = ?,
         min_spam_score = ?,
         warmup_enabled = ?,
         physical_address = ?,
         require_dns = ?,
         failure_pause_threshold = ?,
         updated_at = CURRENT_TIMESTAMP
         WHERE id = 1`,
        [
          delayMinMs,
          delayMaxMs,
          dailyCapPerAccount,
          rotationMode,
          jitterPercent,
          maxRetries,
          shuffleRecipients,
          minSpamScore,
          warmupEnabled,
          physicalAddress,
          requireDns,
          failurePauseThreshold
        ]
      );

      return this.get();
    },

    applyProviderPreset(presetId) {
      const preset = PROVIDER_PRESETS[presetId] || PROVIDER_PRESETS.default;
      return {
        delayMinMs: preset.delayMinMs,
        delayMaxMs: preset.delayMaxMs,
        dailyCapPerAccount: preset.dailyCapPerAccount,
        jitterPercent: preset.jitterPercent
      };
    },

    computeDelay(settings) {
      const min = Number(settings.delayMinMs) || 1000;
      const max = Number(settings.delayMaxMs) || 5000;
      const base = min + Math.random() * (max - min);
      const jitterRange = base * ((Number(settings.jitterPercent) || 0) / 100);
      const jitter = jitterRange * (Math.random() * 2 - 1);
      return Math.max(min, Math.round(base + jitter));
    },

    getWarmupCap(totalSent, settings) {
      if (!settings.warmupEnabled) {
        return Number(settings.dailyCapPerAccount) || 80;
      }
      const sent = Number(totalSent) || 0;
      if (sent < 1500) {
        return 50;
      }
      if (sent < 3500) {
        return 150;
      }
      if (sent < 7000) {
        return 500;
      }
      if (sent < 15000) {
        return 1500;
      }
      if (sent < 30000) {
        return 5000;
      }
      return Number(settings.dailyCapPerAccount) || 80;
    }
  };
}

module.exports = { createSendSettingsService, DEFAULT_SETTINGS };
