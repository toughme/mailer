function parseJson(value, fallback) {
  try {
    return JSON.parse(value || '');
  } catch {
    return fallback;
  }
}

function normalizeEvent(row) {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    recipientEmail: row.recipient_email,
    accountId: row.account_id,
    provider: row.provider,
    eventType: row.event_type,
    category: row.category,
    metadata: parseJson(row.metadata, {}),
    createdAt: row.created_at
  };
}

function createEventLogService({ db, webhookService }) {
  return {
    async record(input) {
      const eventType = String(input.eventType || input.type || '').trim().toLowerCase();
      if (!eventType) {
        throw new Error('Event type is required.');
      }

      const metadata = input.metadata && typeof input.metadata === 'object' ? input.metadata : {};
      await db.run(
        `INSERT INTO email_events
         (campaign_id, recipient_email, account_id, provider, event_type, category, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          input.campaignId ? Number(input.campaignId) : null,
          String(input.recipientEmail || input.email || '').trim().toLowerCase(),
          input.accountId ? Number(input.accountId) : null,
          String(input.provider || '').trim(),
          eventType,
          String(input.category || '').trim(),
          JSON.stringify(metadata)
        ]
      );

      const row = await db.get('SELECT * FROM email_events ORDER BY id DESC LIMIT 1');
      const event = normalizeEvent(row);

      if (webhookService) {
        webhookService.dispatch(event).catch((error) => {
          console.warn('Webhook dispatch failed:', error.message);
        });
      }

      return event;
    },

    async list(limit = 100) {
      const rows = await db.all(
        'SELECT * FROM email_events ORDER BY created_at DESC, id DESC LIMIT ?',
        [Number(limit) || 100]
      );
      return rows.map(normalizeEvent);
    },

    async aggregate() {
      const rows = await db.all(
        `SELECT event_type, provider, COUNT(*) AS count
         FROM email_events
         GROUP BY event_type, provider`
      );
      return rows.map((row) => ({
        eventType: row.event_type,
        provider: row.provider || 'unknown',
        count: row.count
      }));
    }
  };
}

module.exports = { createEventLogService };
