function createDashboardService({ db, sendQueueService }) {
  return {
    async getSummary() {
      const [accounts, campaigns, recipients, segments] = await Promise.all([
        db.get('SELECT COUNT(*) AS count FROM accounts'),
        db.get('SELECT COUNT(*) AS count FROM campaigns'),
        db.get('SELECT COUNT(*) AS count FROM recipients'),
        db.get('SELECT COUNT(*) AS count FROM segments')
      ]);

      const recentCampaigns = await db.all(
        'SELECT id, name, status, scheduled_at, created_at FROM campaigns ORDER BY created_at DESC LIMIT 5'
      );

      let delivery = { sent: 0, failed: 0, pending: 0, failureRate: 0 };
      if (sendQueueService) {
        const status = await sendQueueService.getGlobalStatus();
        delivery = {
          sent: status.breakdown.sent || 0,
          failed: status.breakdown.failed || 0,
          pending: (status.breakdown.pending || 0) + (status.breakdown.sending || 0),
          failureRate: status.deliveryStats?.failureRate || 0
        };
      }

      return {
        counts: {
          accounts: accounts ? accounts.count : 0,
          campaigns: campaigns ? campaigns.count : 0,
          recipients: recipients ? recipients.count : 0,
          segments: segments ? segments.count : 0
        },
        delivery,
        recentCampaigns: recentCampaigns.map((item) => ({
          id: item.id,
          name: item.name,
          status: item.status,
          scheduledAt: item.scheduled_at,
          createdAt: item.created_at
        }))
      };
    }
  };
}

module.exports = { createDashboardService };
