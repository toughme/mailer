function shuffleArray(items) {
  const list = [...items];
  for (let index = list.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [list[index], list[swap]] = [list[swap], list[index]];
  }
  return list;
}

function parseMetrics(value) {
  try {
    return JSON.parse(value || '{}');
  } catch {
    return { sent: 0, failed: 0, pending: 0 };
  }
}

function createSendQueueService({
  db,
  emailSendService,
  accountRotationService,
  sendSettingsService,
  sendPreflightService,
  segmentsService,
  eventLogService,
  listHygieneService
}) {
  let workerRunning = false;
  let globalFailureStreak = 0;
  let workerPausedUntil = 0;
  const pausedCampaigns = new Set();

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function resolveRecipients(campaign) {
    let recipients = await db.all('SELECT * FROM recipients WHERE status = ?', ['active']);

    if (campaign.use_individual_recipients) {
      let selectedIds = [];
      try {
        const parsed = JSON.parse(campaign.recipient_ids || '[]');
        selectedIds = Array.isArray(parsed) ? parsed : [];
      } catch {
        selectedIds = [];
      }
      const selectedSet = new Set(selectedIds.map(Number).filter(Boolean));
      recipients = recipients.filter((recipient) => selectedSet.has(Number(recipient.id)));
    }

    if (!campaign.use_individual_recipients && campaign.segment_id) {
      const segment = await db.get('SELECT * FROM segments WHERE id = ?', [campaign.segment_id]);
    if (segment) {
      let filters = {};
      try {
        filters = JSON.parse(segment.filters || '{}');
        if (!filters || typeof filters !== 'object' || Array.isArray(filters)) filters = {};
      } catch {
        filters = {};
      }
        recipients = await segmentsService.preview(filters);
        const ids = new Set(recipients.map((item) => item.id));
        const fullRows = await db.all('SELECT * FROM recipients WHERE status = ?', ['active']);
        recipients = fullRows
          .filter((row) => ids.has(row.id))
          .map((row) => {
            let tags = [];
            try {
              const parsed = JSON.parse(row.tags || '[]');
              tags = Array.isArray(parsed) ? parsed : [];
            } catch {
              tags = [];
            }
            return {
              id: row.id,
              email: row.email,
              name: row.name,
              tags,
              status: row.status
            };
          });
      }
    }

    const suppressed = await db.all('SELECT email FROM suppression_entries');
    const suppressedSet = new Set(suppressed.map((row) => row.email.toLowerCase()));

    return recipients
      .filter((recipient) => recipient.email && !suppressedSet.has(recipient.email.toLowerCase()))
      .map((recipient) => ({
        id: recipient.id,
        email: recipient.email,
        name: recipient.name || ''
      }));
  }

  async function resolveHygienicRecipients(campaign) {
    const recipients = await resolveRecipients(campaign);
    if (!listHygieneService) {
      return recipients;
    }

    const clean = [];
    for (const recipient of recipients) {
      const validation = await listHygieneService.validateEmail(recipient.email);
      if (validation.status === 'invalid') {
        continue;
      }
      clean.push(recipient);
    }
    return clean;
  }

  function pickVariant(campaign, recipientIndex) {
    if (!campaign.ab_enabled) {
      return {
        subject: campaign.subject,
        content: campaign.content,
        variant: 'A'
      };
    }

    const ratio = Math.min(90, Math.max(10, campaign.split_ratio || 50));
    const useB = (recipientIndex % 100) < ratio;
    return {
      subject: useB ? campaign.subject_b : campaign.subject,
      content: useB ? campaign.content_b : campaign.content,
      variant: useB ? 'B' : 'A'
    };
  }

  async function updateCampaignMetrics(campaignId) {
    const counts = await db.get(
      `SELECT
         SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
         SUM(CASE WHEN status IN ('pending', 'sending') THEN 1 ELSE 0 END) AS pending
       FROM send_queue WHERE campaign_id = ?`,
      [campaignId]
    );

    const metrics = {
      sent: counts?.sent || 0,
      failed: counts?.failed || 0,
      pending: counts?.pending || 0
    };

    await db.run(
      'UPDATE campaigns SET metrics = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [JSON.stringify(metrics), campaignId]
    );

    return metrics;
  }

  return {
    async getQueueLog(limit = 30) {
      const rows = await db.all(
        `SELECT send_queue.*, accounts.email AS account_email
         FROM send_queue
         LEFT JOIN accounts ON accounts.id = send_queue.account_id
         ORDER BY send_queue.id DESC
         LIMIT ?`,
        [Number(limit)]
      );

      return rows.map((row) => ({
        id: row.id,
        campaignId: row.campaign_id,
        recipientEmail: row.recipient_email,
        accountEmail: row.account_email,
        status: row.status,
        sentAt: row.sent_at,
        lastError: row.last_error,
        variant: row.variant
      }));
    },

    async enqueueCampaign(campaignId) {
      const campaign = await db.get('SELECT * FROM campaigns WHERE id = ?', [Number(campaignId)]);
      if (!campaign) {
        throw new Error('Campaign not found.');
      }

      const settings = await sendSettingsService.get();

      if (sendPreflightService) {
        const preflight = await sendPreflightService.validateCampaign(campaignId, settings);
        if (!preflight.canSend) {
          throw new Error(preflight.errors.join(' '));
        }
      }
      const eligible = await accountRotationService.getEligibleAccounts(settings);
      if (!eligible.length) {
        throw new Error('No eligible SMTP accounts. Add accounts or wait for cooldown/daily cap reset.');
      }

      const existingPending = await db.get(
        `SELECT COUNT(*) AS count FROM send_queue
         WHERE campaign_id = ? AND status IN ('pending', 'sending')`,
        [campaignId]
      );

      if (existingPending?.count > 0) {
        pausedCampaigns.delete(campaignId);
        this.startWorker();
        return this.getCampaignStatus(campaignId);
      }

      let recipients = await resolveHygienicRecipients(campaign);
      if (!recipients.length) {
        throw new Error('No active recipients found for this campaign audience.');
      }

      if (settings.shuffleRecipients) {
        recipients = shuffleArray(recipients);
      }

      const insertBatchSize = 100;
      for (let index = 0; index < recipients.length; index += 1) {
        const recipient = recipients[index];
        const variant = pickVariant(campaign, index);
        await db.run(
          `INSERT INTO send_queue
           (campaign_id, recipient_id, recipient_email, recipient_name, subject, content_html, preview_text, variant, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
          [
            campaignId,
            recipient.id,
            recipient.email,
            recipient.name,
            variant.subject,
            variant.content,
            campaign.preview_text,
            variant.variant
          ]
        );

        if (index > 0 && index % insertBatchSize === 0) {
          await sleep(0);
        }
      }

      await db.run(
        'UPDATE campaigns SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        ['active', campaignId]
      );

      pausedCampaigns.delete(campaignId);
      await updateCampaignMetrics(campaignId);
      this.startWorker();
      return this.getCampaignStatus(campaignId);
    },

    pauseCampaign(campaignId) {
      pausedCampaigns.add(Number(campaignId));
      return this.getCampaignStatus(campaignId);
    },

    async resumeCampaign(campaignId) {
      pausedCampaigns.delete(Number(campaignId));
      await db.run(
        'UPDATE campaigns SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        ['active', Number(campaignId)]
      );
      this.startWorker();
      return this.getCampaignStatus(campaignId);
    },

    async purgeCampaign(campaignId) {
      const id = Number(campaignId);
      if (!id) {
        throw new Error('Campaign id is required.');
      }

      pausedCampaigns.delete(id);
      await db.run('DELETE FROM send_queue WHERE campaign_id = ?', [id]);
      return updateCampaignMetrics(id).catch(() => null);
    },

    async getCampaignStatus(campaignId) {
      const campaign = await db.get('SELECT * FROM campaigns WHERE id = ?', [Number(campaignId)]);
      if (!campaign) {
        return null;
      }

      const rows = await db.all(
        `SELECT status, COUNT(*) AS count FROM send_queue WHERE campaign_id = ? GROUP BY status`,
        [campaignId]
      );

      const breakdown = { pending: 0, sending: 0, sent: 0, failed: 0 };
      rows.forEach((row) => {
        breakdown[row.status] = row.count;
      });

      const recent = await db.all(
        `SELECT recipient_email, status, account_id, sent_at, last_error
         FROM send_queue WHERE campaign_id = ? ORDER BY id DESC LIMIT 8`,
        [campaignId]
      );

      return {
        campaignId,
        name: campaign.name,
        status: campaign.status,
        paused: pausedCampaigns.has(Number(campaignId)),
        metrics: parseMetrics(campaign.metrics),
        breakdown,
        recent
      };
    },

    async getGlobalStatus() {
      const settings = await sendSettingsService.get();
      const queue = await db.all(
        `SELECT status, COUNT(*) AS count FROM send_queue GROUP BY status`
      );
      const breakdown = { pending: 0, sending: 0, sent: 0, failed: 0 };
      queue.forEach((row) => {
        breakdown[row.status] = row.count;
      });

      const activeCampaigns = await db.all(
        `SELECT DISTINCT campaign_id FROM send_queue WHERE status IN ('pending', 'sending')`
      );

      const accountHealth = await accountRotationService.listAccountHealth(settings);
      const recentLog = await this.getQueueLog(12);
      const failureStats = await db.get(
        `SELECT
           SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
           SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent
         FROM send_queue`
      );

      return {
        processing: workerRunning && Date.now() >= workerPausedUntil,
        workerPaused: Date.now() < workerPausedUntil,
        breakdown,
        activeCampaignCount: activeCampaigns.length,
        accountHealth,
        recentLog,
        deliveryStats: {
          sent: failureStats?.sent || 0,
          failed: failureStats?.failed || 0,
          failureRate: failureStats?.sent
            ? Math.round(((failureStats.failed || 0) / failureStats.sent) * 100)
            : 0
        },
        settings
      };
    },

    async fetchNextJob() {
      const rows = await db.all(
        `SELECT * FROM send_queue WHERE status = 'pending' ORDER BY id ASC LIMIT 20`
      );
      return rows.find((job) => !pausedCampaigns.has(job.campaign_id)) || null;
    },

    startWorker() {
      if (workerRunning) {
        return;
      }

      workerRunning = true;

      const loop = async () => {
        try {
          while (true) {
            if (Date.now() < workerPausedUntil) {
              await sleep(5000);
              continue;
            }

            const job = await this.fetchNextJob();
            if (!job) {
              break;
            }

        const settings = await sendSettingsService.get();
        const account = await accountRotationService.pickNextAccount(settings);

        if (!account) {
          await sleep(15000);
          continue;
        }

        const campaign = await db.get('SELECT * FROM campaigns WHERE id = ?', [job.campaign_id]);

        await db.run(
          `UPDATE send_queue SET status = 'sending', account_id = ?, attempts = attempts + 1 WHERE id = ?`,
          [account.id, job.id]
        );

        try {
          await emailSendService.sendMessage({
            accountId: account.id,
            recipient: {
              email: job.recipient_email,
              name: job.recipient_name
            },
            subject: job.subject,
            html: job.content_html,
            previewText: job.preview_text,
            settings: {
              ...settings,
              replyTo: campaign?.reply_to || settings.replyTo || ''
            }
          });

              await db.run(
                `UPDATE send_queue SET status = 'sent', sent_at = CURRENT_TIMESTAMP, last_error = '' WHERE id = ?`,
                [job.id]
              );
              await accountRotationService.recordSuccess(account.id);
              if (eventLogService) {
                await eventLogService.record({
                  campaignId: job.campaign_id,
                  recipientEmail: job.recipient_email,
                  accountId: account.id,
                  provider: account.provider || account.email,
                  eventType: 'sent',
                  metadata: { variant: job.variant }
                });
              }
              globalFailureStreak = 0;
            } catch (sendError) {
              const failures = await accountRotationService.recordFailure(account.id);
              globalFailureStreak += 1;
              const maxRetries = Number(settings.maxRetries) || 0;
              const pauseThreshold = Number(settings.failurePauseThreshold) || 5;
              const attemptCount = Number(job.attempts || 0) + 1;

              if (globalFailureStreak >= pauseThreshold) {
                workerPausedUntil = Date.now() + 30 * 60 * 1000;
                globalFailureStreak = 0;
                console.warn('Send worker paused for 30 minutes due to failure streak.');
              }

              if (attemptCount <= maxRetries) {
                await db.run(
                  `UPDATE send_queue SET status = 'pending', account_id = NULL, last_error = ? WHERE id = ?`,
                  [sendError.message || 'Send failed', job.id]
                );
              } else {
                await db.run(
                  `UPDATE send_queue SET status = 'failed', last_error = ? WHERE id = ?`,
                  [sendError.message || 'Send failed', job.id]
                );
                if (eventLogService) {
                  await eventLogService.record({
                    campaignId: job.campaign_id,
                    recipientEmail: job.recipient_email,
                    accountId: account.id,
                    provider: account.provider || account.email,
                    eventType: 'failed',
                    category: failures >= 3 ? 'provider-cooldown' : 'send-error',
                    metadata: { error: sendError.message || 'Send failed' }
                  });
                }
              }

              if (failures >= 3) {
                console.warn(`Account ${account.id} entered cooldown after repeated failures.`);
              }
            }

            await updateCampaignMetrics(job.campaign_id);

            const remaining = await db.get(
              `SELECT COUNT(*) AS count FROM send_queue
               WHERE campaign_id = ? AND status IN ('pending', 'sending')`,
              [job.campaign_id]
            );

            if (!remaining?.count) {
              await db.run(
                'UPDATE campaigns SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                ['completed', job.campaign_id]
              );
            }

            const delay = sendSettingsService.computeDelay(settings);
            await sleep(delay);
          }
  } catch (error) {
    console.error('Send worker error:', error);
    if (eventLogService) {
      await eventLogService.record({
        eventType: 'worker-error',
        category: 'system',
        metadata: { error: error.message || 'Unknown worker error' }
      }).catch(() => {});
    }
  } finally {
          workerRunning = false;
        }
      };

      loop();
    },

    async handleCampaignStatusChange(campaignId, status) {
      if (status === 'active') {
        return this.enqueueCampaign(campaignId);
      }

      if (status === 'draft' || status === 'paused' || status === 'scheduled') {
        return this.pauseCampaign(campaignId);
      }

      return null;
    }
  };
}

module.exports = { createSendQueueService };
