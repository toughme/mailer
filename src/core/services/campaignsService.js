function parseMetrics(value) {
  if (!value) {
    return { sent: 0, failed: 0, pending: 0, opens: 0, clicks: 0 };
  }

  try {
    const parsed = JSON.parse(value);
    return {
      sent: parsed.sent || 0,
      failed: parsed.failed || 0,
      pending: parsed.pending || 0,
      opens: parsed.opens || 0,
      clicks: parsed.clicks || 0
    };
  } catch {
    return { sent: 0, failed: 0, pending: 0, opens: 0, clicks: 0 };
  }
}

function createCampaignsService({ db, schedulerService, sendQueueService }) {
  return {
    async list() {
      const rows = await db.all(
        `SELECT campaigns.*, segments.name AS segment_name
         FROM campaigns
         LEFT JOIN segments ON segments.id = campaigns.segment_id
         ORDER BY campaigns.created_at DESC`
      );

      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        subject: row.subject,
        subjectB: row.subject_b,
        previewText: row.preview_text,
        content: row.content,
        contentB: row.content_b,
        abEnabled: Boolean(row.ab_enabled),
        splitRatio: row.split_ratio || 50,
        status: row.status,
        segmentId: row.segment_id,
        segmentName: row.segment_name,
        recipientIds: row.recipient_ids ? JSON.parse(row.recipient_ids) : [],
        useIndividualRecipients: Boolean(row.use_individual_recipients),
        scheduledAt: row.scheduled_at,
        metrics: parseMetrics(row.metrics),
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }));
    },

    async create(payload) {
      const name = String(payload.name || '').trim();
      const subject = String(payload.subject || '').trim();
      const subjectB = String(payload.subjectB || '').trim();
      const previewText = String(payload.previewText || '').trim();
      const content = String(payload.content || '').trim();
      const contentB = String(payload.contentB || '').trim();
      const abEnabled = Boolean(payload.abEnabled);
      const splitRatio = Math.min(90, Math.max(10, Number(payload.splitRatio) || 50));
      const scheduledAt = payload.scheduledAt ? String(payload.scheduledAt) : null;
      const segmentId = payload.segmentId ? Number(payload.segmentId) : null;
      const recipientIds = Array.isArray(payload.recipientIds) ? payload.recipientIds.map(Number) : [];
      const useIndividualRecipients = Boolean(payload.useIndividualRecipients);
      const status = scheduledAt ? 'scheduled' : 'draft';
      const metrics = JSON.stringify({ sent: 0, opens: 0, clicks: 0 });

      if (!name || !subject) {
        throw new Error('Campaign name and subject are required.');
      }

      if (abEnabled && (!subjectB || !contentB)) {
        throw new Error('Subject B and Content B are required when A/B testing is enabled.');
      }

      if (!useIndividualRecipients && !segmentId) {
        // Allow campaigns with no recipient targeting in draft mode
      }

      await db.run(
        `INSERT INTO campaigns
         (name, subject, preview_text, content, subject_b, content_b, ab_enabled, split_ratio, status, segment_id, recipient_ids, use_individual_recipients, scheduled_at, metrics, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [name, subject, previewText, content, subjectB, contentB, abEnabled ? 1 : 0, splitRatio, status, segmentId, JSON.stringify(recipientIds), useIndividualRecipients ? 1 : 0, scheduledAt, metrics]
      );

      if (schedulerService) {
        await schedulerService.sync();
      }

      return this.list();
    },

    async updateStatus(payload) {
      const id = Number(payload.id);
      const status = String(payload.status || '').trim();
      const scheduledAt = payload.scheduledAt ? String(payload.scheduledAt) : null;

      if (!id || !status) {
        throw new Error('Campaign id and status are required.');
      }

      if (scheduledAt !== null) {
        await db.run(
          'UPDATE campaigns SET status = ?, scheduled_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          [status, scheduledAt, id]
        );
      } else {
        await db.run(
          'UPDATE campaigns SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          [status, id]
        );
      }

      if (schedulerService) {
        await schedulerService.sync();
      }

      if (sendQueueService && (status === 'active' || status === 'draft' || status === 'paused')) {
        await sendQueueService.handleCampaignStatusChange(id, status);
      }

      return this.list();
    },

    async update(payload) {
      const id = Number(payload.id);
      const name = String(payload.name || '').trim();
      const subject = String(payload.subject || '').trim();
      const subjectB = String(payload.subjectB || '').trim();
      const previewText = String(payload.previewText || '').trim();
      const content = String(payload.content || '').trim();
      const contentB = String(payload.contentB || '').trim();
      const abEnabled = Boolean(payload.abEnabled);
      const splitRatio = Math.min(90, Math.max(10, Number(payload.splitRatio) || 50));
      const scheduledAt = payload.scheduledAt ? String(payload.scheduledAt) : null;
      const segmentId = payload.segmentId ? Number(payload.segmentId) : null;
      const recipientIds = Array.isArray(payload.recipientIds) ? payload.recipientIds.map(Number) : [];
      const useIndividualRecipients = Boolean(payload.useIndividualRecipients);

      if (!id) {
        throw new Error('Campaign id is required.');
      }

      if (!name || !subject) {
        throw new Error('Campaign name and subject are required.');
      }

      if (abEnabled && (!subjectB || !contentB)) {
        throw new Error('Subject B and Content B are required when A/B testing is enabled.');
      }

      await db.run(
        `UPDATE campaigns
         SET name = ?, subject = ?, preview_text = ?, content = ?, subject_b = ?, content_b = ?, ab_enabled = ?, split_ratio = ?, segment_id = ?, recipient_ids = ?, use_individual_recipients = ?, scheduled_at = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [name, subject, previewText, content, subjectB, contentB, abEnabled ? 1 : 0, splitRatio, segmentId, JSON.stringify(recipientIds), useIndividualRecipients ? 1 : 0, scheduledAt, id]
      );

      if (schedulerService) {
        await schedulerService.sync();
      }

      return this.list();
    },

    async delete(payload) {
      const id = Number(payload.id);

      if (!id) {
        throw new Error('Campaign id is required.');
      }

      await db.run('DELETE FROM campaigns WHERE id = ?', [id]);

      if (schedulerService) {
        await schedulerService.sync();
      }

      return this.list();
    }
  };
}

module.exports = { createCampaignsService };
