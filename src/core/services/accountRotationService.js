function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function createAccountRotationService({ db, sendSettingsService }) {
  function resolveCap(totalSent, settings) {
    if (sendSettingsService?.getWarmupCap) {
      return sendSettingsService.getWarmupCap(totalSent, settings);
    }
    return Number(settings.dailyCapPerAccount) || 80;
  }
  async function ensureStatsRow(accountId) {
    const existing = await db.get('SELECT account_id FROM account_send_stats WHERE account_id = ?', [accountId]);
    if (!existing) {
      await db.run(
        `INSERT INTO account_send_stats (account_id, sends_today, sends_today_date, total_sent, consecutive_failures)
         VALUES (?, 0, ?, 0, 0)`,
        [accountId, todayKey()]
      );
    }
  }

  async function resetDailyIfNeeded(accountId) {
    await ensureStatsRow(accountId);
    const stats = await db.get('SELECT * FROM account_send_stats WHERE account_id = ?', [accountId]);
    if (stats.sends_today_date !== todayKey()) {
      await db.run(
        'UPDATE account_send_stats SET sends_today = 0, sends_today_date = ? WHERE account_id = ?',
        [todayKey(), accountId]
      );
    }
  }

  async function getEligibleAccounts(settings) {
    const accounts = await db.all(
      `SELECT accounts.*, account_send_stats.sends_today, account_send_stats.sends_today_date,
              account_send_stats.consecutive_failures, account_send_stats.cooldown_until,
              account_send_stats.last_sent_at,
              reputation_metrics.sender_score, reputation_metrics.bounce_rate,
              reputation_metrics.complaint_rate, reputation_metrics.blacklist_status
       FROM accounts
       LEFT JOIN account_send_stats ON account_send_stats.account_id = accounts.id
       LEFT JOIN reputation_metrics ON reputation_metrics.id = (
         SELECT id FROM reputation_metrics rm
         WHERE rm.account_id = accounts.id
         ORDER BY rm.measured_at DESC, rm.id DESC
         LIMIT 1
       )
       WHERE (accounts.primary_protocol = 'smtp' AND accounts.encrypted_password != '')
         OR (accounts.primary_protocol = 'graph' AND (accounts.oauth_refresh_token != '' OR accounts.oauth_access_token != ''))
       ORDER BY accounts.id ASC`
    );

    const now = Date.now();
    const baseCap = Number(settings.dailyCapPerAccount) || 80;
    const eligible = [];

    for (const row of accounts) {
      await resetDailyIfNeeded(row.id);
      const fresh = await db.get('SELECT * FROM account_send_stats WHERE account_id = ?', [row.id]);
      const sendsToday = fresh.sends_today_date === todayKey() ? fresh.sends_today : 0;
      const totalSent = fresh.total_sent || 0;
      const warmupCap = resolveCap(totalSent, settings);
      const cap = Math.min(baseCap, warmupCap);

      if (fresh.cooldown_until && new Date(fresh.cooldown_until).getTime() > now) {
        continue;
      }

      if (fresh.consecutive_failures >= 3) {
        continue;
      }

      if (sendsToday >= cap) {
        continue;
      }

      eligible.push({
        id: row.id,
        email: row.email,
        provider: row.provider,
        displayName: row.display_name,
        sendsToday,
        dailyCap: cap,
        totalSent,
        lastSentAt: fresh.last_sent_at,
        reputationScore: Math.max(
          0,
          (Number(row.sender_score) || 75) -
            (Number(row.bounce_rate) || 0) * 2 -
            (Number(row.complaint_rate) || 0) * 10 -
            (row.blacklist_status === 'listed' ? 50 : 0)
        )
      });
    }

    return eligible;
  }

  function pickAccount(eligible, mode) {
    if (!eligible.length) {
      return null;
    }

    if (mode === 'reputation') {
      return [...eligible].sort((a, b) => {
        if (b.reputationScore !== a.reputationScore) {
          return b.reputationScore - a.reputationScore;
        }
        return a.sendsToday - b.sendsToday;
      })[0];
    }

    if (mode === 'round_robin') {
      const sorted = [...eligible].sort((a, b) => {
        const aTime = a.lastSentAt ? new Date(a.lastSentAt).getTime() : 0;
        const bTime = b.lastSentAt ? new Date(b.lastSentAt).getTime() : 0;
        if (aTime !== bTime) {
          return aTime - bTime;
        }
        return a.sendsToday - b.sendsToday;
      });
      return sorted[0];
    }

    const index = Math.floor(Math.random() * eligible.length);
    return eligible[index];
  }

  return {
    async pickNextAccount(settings) {
      const eligible = await this.getEligibleAccounts(settings);
      return pickAccount(eligible, settings.rotationMode || 'random');
    },

    getEligibleAccounts,

    async recordSuccess(accountId) {
      await resetDailyIfNeeded(accountId);
      await db.run(
        `UPDATE account_send_stats
         SET sends_today = CASE WHEN sends_today_date = ? THEN sends_today + 1 ELSE 1 END,
             sends_today_date = ?,
             total_sent = total_sent + 1,
             consecutive_failures = 0,
             cooldown_until = NULL,
             last_sent_at = CURRENT_TIMESTAMP
         WHERE account_id = ?`,
        [todayKey(), todayKey(), accountId]
      );
    },

    async recordFailure(accountId) {
      await resetDailyIfNeeded(accountId);
      const stats = await db.get('SELECT consecutive_failures FROM account_send_stats WHERE account_id = ?', [accountId]);
      const failures = (stats?.consecutive_failures || 0) + 1;
      const cooldownUntil = failures >= 3
        ? new Date(Date.now() + 60 * 60 * 1000).toISOString()
        : null;

      await db.run(
        `UPDATE account_send_stats
         SET consecutive_failures = ?,
             cooldown_until = COALESCE(?, cooldown_until)
         WHERE account_id = ?`,
        [failures, cooldownUntil, accountId]
      );

      return failures;
    },

    async listAccountHealth(settings) {
      const eligible = await this.getEligibleAccounts(settings);
      const eligibleIds = new Set(eligible.map((item) => item.id));
      const accounts = await db.all(
        `SELECT accounts.id, accounts.email, accounts.display_name,
                account_send_stats.sends_today, account_send_stats.sends_today_date,
                account_send_stats.total_sent, account_send_stats.consecutive_failures,
                account_send_stats.cooldown_until, account_send_stats.last_sent_at,
                reputation_metrics.sender_score, reputation_metrics.bounce_rate,
                reputation_metrics.complaint_rate, reputation_metrics.blacklist_status
         FROM accounts
         LEFT JOIN account_send_stats ON account_send_stats.account_id = accounts.id
         LEFT JOIN reputation_metrics ON reputation_metrics.id = (
           SELECT id FROM reputation_metrics rm
           WHERE rm.account_id = accounts.id
           ORDER BY rm.measured_at DESC, rm.id DESC
           LIMIT 1
         )
         WHERE accounts.primary_protocol IN ('smtp', 'graph')
         ORDER BY accounts.created_at DESC`
      );

      return accounts.map((row) => {
        const sendsToday = row.sends_today_date === todayKey() ? row.sends_today : 0;
        const totalSent = row.total_sent || 0;
        const warmupCap = resolveCap(totalSent, settings);
        const cap = Math.min(Number(settings.dailyCapPerAccount) || 80, warmupCap);
        const inCooldown = row.cooldown_until && new Date(row.cooldown_until).getTime() > Date.now();
        let status = 'ready';
        if (inCooldown) {
          status = 'cooldown';
        } else if (row.consecutive_failures >= 3) {
          status = 'limited';
        } else if (sendsToday >= cap) {
          status = 'capped';
        } else if (!eligibleIds.has(row.id)) {
          status = 'unavailable';
        }

        return {
          id: row.id,
          email: row.email,
          displayName: row.display_name,
          sendsToday,
          dailyCap: cap,
          warmupCap,
          totalSent: row.total_sent || 0,
          reputationScore: Math.max(
            0,
            (Number(row.sender_score) || 75) -
              (Number(row.bounce_rate) || 0) * 2 -
              (Number(row.complaint_rate) || 0) * 10 -
              (row.blacklist_status === 'listed' ? 50 : 0)
          ),
          blacklistStatus: row.blacklist_status || 'unknown',
          consecutiveFailures: row.consecutive_failures || 0,
          cooldownUntil: row.cooldown_until,
          lastSentAt: row.last_sent_at,
          status
        };
      });
    }
  };
}

module.exports = { createAccountRotationService };
