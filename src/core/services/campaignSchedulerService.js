function createCampaignSchedulerService({ db, sendQueueService }) {
  const activeTimers = new Map();
  const failedActivations = new Map(); // Track failed activations for retry

  function clearTimer(id) {
    const existing = activeTimers.get(id);
    if (existing) {
      clearTimeout(existing);
      activeTimers.delete(id);
    }
  }

  async function activateCampaign(id) {
    await db.run(
      'UPDATE campaigns SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      ['active', Number(id)]
    );
    clearTimer(id);
    failedActivations.delete(id); // Clear failed activation tracking

    if (sendQueueService) {
      try {
        await sendQueueService.enqueueCampaign(id);
      } catch (error) {
        console.error(`Failed to enqueue campaign ${id}:`, error);
        
        // Track failed activation for retry
        const failCount = (failedActivations.get(id) || 0) + 1;
        failedActivations.set(id, failCount);
        
        // Retry with exponential backoff: 5s, 10s, 20s, 30s
        const retryDelay = Math.min(5000 * Math.pow(2, failCount - 1), 30000);
        console.log(`Retrying campaign ${id} enqueue in ${retryDelay}ms (attempt ${failCount})`);
        
        setTimeout(() => {
          activateCampaign(id).catch((retryError) => {
            console.error(`Retry ${failCount} failed for campaign ${id}:`, retryError);
          });
        }, retryDelay);
      }
    }
  }

  async function sync() {
    const scheduledCampaigns = await db.all(
      'SELECT id, scheduled_at, status FROM campaigns WHERE status = ? AND scheduled_at IS NOT NULL',
      ['scheduled']
    );

    const validIds = new Set(scheduledCampaigns.map((campaign) => campaign.id));
    Array.from(activeTimers.keys()).forEach((id) => {
      if (!validIds.has(id)) {
        clearTimer(id);
      }
    });

    for (const campaign of scheduledCampaigns) {
      clearTimer(campaign.id);

      const targetTime = new Date(campaign.scheduled_at).getTime();
      if (Number.isNaN(targetTime)) {
        continue;
      }

      const delay = targetTime - Date.now();
      if (delay <= 0) {
        await activateCampaign(campaign.id);
        continue;
      }

      const timer = setTimeout(() => {
        activateCampaign(campaign.id).catch((error) => {
          console.error(`Failed to activate scheduled campaign ${campaign.id}:`, error);
        });
      }, delay);

      activeTimers.set(campaign.id, timer);
    }
  }

  return {
    sync
  };
}

module.exports = { createCampaignSchedulerService };
