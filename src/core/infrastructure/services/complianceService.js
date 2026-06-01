const { createComplianceEvent } = require('../schemas');

function normalizeEventRow(row) {
  return {
    id: row.id,
    recipientId: row.recipient_id,
    email: row.email,
    type: row.type,
    source: row.source,
    payload: JSON.parse(row.payload || '{}'),
    createdAt: row.created_at
  };
}

function createComplianceService({ db }) {
  return {
    async listEvents() {
      const rows = await db.all('SELECT * FROM compliance_events ORDER BY created_at DESC LIMIT 100');
      return rows.map(normalizeEventRow);
    },

    async record(input) {
      const event = createComplianceEvent(input);
      await db.run(
        `INSERT INTO compliance_events (recipient_id, email, type, source, payload)
         VALUES (?, ?, ?, ?, ?)`,
        [
          event.recipientId,
          event.email,
          event.type,
          event.source,
          JSON.stringify(event.payload)
        ]
      );

      if (event.type === 'unsubscribe' || event.type === 'suppressed') {
        await db.run(
          `INSERT INTO suppression_entries (email, reason, source)
           VALUES (?, ?, ?)
           ON CONFLICT(email) DO UPDATE SET
             reason = excluded.reason,
             source = excluded.source`,
          [event.email, event.type, event.source]
        );
      }

      const row = await db.get('SELECT * FROM compliance_events ORDER BY id DESC LIMIT 1');
      return normalizeEventRow(row);
    },
  };
}

module.exports = { createComplianceService };
