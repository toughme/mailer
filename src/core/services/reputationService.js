function normalizeMetric(row) {
  return {
    id: row.id,
    accountId: row.account_id,
    provider: row.provider,
    senderScore: row.sender_score,
    bounceRate: row.bounce_rate,
    complaintRate: row.complaint_rate,
    blacklistStatus: row.blacklist_status,
    source: row.source,
    notes: row.notes,
    measuredAt: row.measured_at
  };
}

function createReputationService({ db }) {
  return {
    async snapshot() {
      const latest = await db.all(
        `SELECT reputation_metrics.*
         FROM reputation_metrics
         INNER JOIN (
           SELECT COALESCE(account_id, 0) AS account_key, MAX(id) AS max_id
           FROM reputation_metrics
           GROUP BY COALESCE(account_id, 0)
         ) latest ON latest.max_id = reputation_metrics.id
         ORDER BY reputation_metrics.measured_at DESC`
      );

      const eventCounts = await db.get(
        `SELECT
           SUM(CASE WHEN event_type = 'sent' THEN 1 ELSE 0 END) AS sent,
           SUM(CASE WHEN event_type = 'bounce' THEN 1 ELSE 0 END) AS bounces,
           SUM(CASE WHEN event_type = 'complaint' THEN 1 ELSE 0 END) AS complaints
         FROM email_events`
      );

      const sent = eventCounts?.sent || 0;
      const bounces = eventCounts?.bounces || 0;
      const complaints = eventCounts?.complaints || 0;

      return {
        latest: latest.map(normalizeMetric),
        aggregate: {
          sent,
          bounces,
          complaints,
          bounceRate: sent ? Number(((bounces / sent) * 100).toFixed(2)) : 0,
          complaintRate: sent ? Number(((complaints / sent) * 100).toFixed(2)) : 0
        }
      };
    },

    async record(payload) {
      await db.run(
        `INSERT INTO reputation_metrics
         (account_id, provider, sender_score, bounce_rate, complaint_rate, blacklist_status, source, notes, measured_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [
          payload.accountId ? Number(payload.accountId) : null,
          String(payload.provider || '').trim(),
          Math.max(0, Math.min(100, Number(payload.senderScore) || 0)),
          Math.max(0, Number(payload.bounceRate) || 0),
          Math.max(0, Number(payload.complaintRate) || 0),
          String(payload.blacklistStatus || 'unknown').trim(),
          String(payload.source || 'manual').trim(),
          String(payload.notes || '').trim()
        ]
      );

      return this.snapshot();
    }
  };
}

module.exports = { createReputationService };
