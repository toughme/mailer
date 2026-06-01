function createAnalyticsService({ db }) {
  return {
    async snapshot() {
      const deliveryByProvider = await db.all(
        `SELECT provider, event_type, COUNT(*) AS count
         FROM email_events
         GROUP BY provider, event_type
         ORDER BY provider ASC`
      );
      const engagement = await db.all(
        `SELECT date(created_at) AS day, event_type, COUNT(*) AS count
         FROM email_events
         WHERE event_type IN ('open', 'click', 'sent')
         GROUP BY date(created_at), event_type
         ORDER BY day ASC`
      );
      const complaints = await db.all(
        `SELECT * FROM email_events WHERE event_type = 'complaint' ORDER BY created_at DESC LIMIT 25`
      );
      const bounces = await db.all(
        `SELECT * FROM email_events WHERE event_type = 'bounce' ORDER BY created_at DESC LIMIT 25`
      );

      return {
        deliveryByProvider: deliveryByProvider.map((row) => ({
          provider: row.provider || 'unknown',
          eventType: row.event_type,
          count: row.count
        })),
        engagement: engagement.map((row) => ({
          day: row.day,
          eventType: row.event_type,
          count: row.count
        })),
        complaints,
        bounces
      };
    }
  };
}

module.exports = { createAnalyticsService };
