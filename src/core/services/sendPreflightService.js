const { analyzeSpamContent } = require('./spamScoringService');
const { isProviderManagedDomain } = require('./providerManagedDomains');

function extractDomain(email) {
  const match = String(email || '').toLowerCase().match(/@([^>\s]+)/);
  return match ? match[1] : '';
}

function createSendPreflightService({ db, deliverabilityService }) {
  async function checkDomainAuth(domain, dkimSelector = 'default') {
    if (!domain) {
      return { domain: '', spf: false, dkim: false, dmarc: false, ok: false };
    }

    if (isProviderManagedDomain(domain)) {
      return {
        domain,
        spf: true,
        dkim: true,
        dmarc: true,
        ok: true,
        providerManaged: true,
        note: 'Personal mailbox provider handles SPF, DKIM, and DMARC.'
      };
    }

    const report = await deliverabilityService.analyze({ domain, dkimSelector });
    const spf = Array.isArray(report.dns?.spfRecords) && report.dns.spfRecords.length >= 1;
    const dkim = Boolean(report.dns?.dkimRecords?.length);
    const dmarc = Boolean(report.dns?.dmarcRecords?.length);
    return {
      domain,
      spf,
      dkim,
      dmarc,
      ok: spf && dkim && dmarc,
      score: report.score
    };
  }

  async function scanCampaignContent(campaign, settings) {
    const html = campaign.content || '';
    const spam = analyzeSpamContent({
      subject: campaign.subject,
      previewText: campaign.preview_text,
      contentHtml: html,
      editorHtml: html
    });

    const minScore = Number(settings.minSpamScore) || 55;
    const errors = [];
    const warnings = [];

    if (spam.score < minScore) {
      errors.push(`Spam score ${spam.score} is below minimum ${minScore}.`);
    }

    if (!campaign.subject?.trim()) {
      errors.push('Campaign subject is required.');
    }

    if (!html.trim()) {
      errors.push('Campaign body is empty.');
    }

    if (spam.metrics.triggerCount > 2) {
      warnings.push(`${spam.metrics.triggerCount} spam trigger phrases detected.`);
    }

    if (!String(settings.physicalAddress || '').trim()) {
      errors.push('Physical mailing address is required for commercial email compliance.');
    }

    if (!/unsubscribe/i.test(html)) {
      warnings.push('No unsubscribe language or link detected in campaign body.');
    }

    return { spam, errors, warnings, canSend: errors.length === 0 };
  }

  return {
    async validateCampaign(campaignId, settings) {
      const campaign = await db.get('SELECT * FROM campaigns WHERE id = ?', [Number(campaignId)]);
      if (!campaign) {
        throw new Error('Campaign not found.');
      }

      const contentScan = await scanCampaignContent(campaign, settings);
      const accounts = await db.all(
        `SELECT email FROM accounts
         WHERE (primary_protocol = 'smtp' AND encrypted_password != '')
            OR (primary_protocol = 'graph' AND oauth_refresh_token != '')`
      );

      const domains = [...new Set(accounts.map((row) => extractDomain(row.email)).filter(Boolean))];
      const dnsChecks = [];
      for (const domain of domains) {
        dnsChecks.push(await checkDomainAuth(domain));
      }
      const customDomains = domains.filter((domain) => !isProviderManagedDomain(domain));

      const requireDns = settings.requireDns !== false;
      const dnsOk = customDomains.length === 0 || customDomains.every((domain) =>
        dnsChecks.some((item) => item.domain === domain && item.ok && !item.providerManaged)
      );
      const errors = [...contentScan.errors];
      const warnings = [...contentScan.warnings];

      if (requireDns && customDomains.length && !dnsOk) {
        errors.push('DNS auth incomplete (SPF, DKIM, DMARC required on sending domains).');
      }

      const eligibleCount = accounts.length;
      if (!eligibleCount) {
        errors.push('No sending accounts configured.');
      }

      const suppression = await db.get('SELECT COUNT(*) AS count FROM suppression_entries');

      return {
        campaignId: Number(campaignId),
        canSend: errors.length === 0,
        spamScore: contentScan.spam.score,
        spamGrade: contentScan.spam.grade,
        spamLabel: contentScan.spam.gradeLabel,
        spamTone: contentScan.spam.gradeTone,
        signals: contentScan.spam.signals,
        dnsChecks,
        dnsOk,
        errors,
        warnings,
        accountCount: eligibleCount,
        suppressionCount: suppression?.count || 0
      };
    },

    async scanCampaign(campaignId) {
      const settings = await db.get('SELECT * FROM send_settings WHERE id = 1');
      const mapped = settings
        ? {
            minSpamScore: settings.min_spam_score ?? 55,
            requireDns: settings.require_dns !== 0
          }
        : { minSpamScore: 55, requireDns: true };
      return this.validateCampaign(campaignId, mapped);
    },

    async getAccountAuthHealth() {
      const accounts = await db.all(
        `SELECT id, email, provider, primary_protocol FROM accounts ORDER BY created_at DESC`
      );

      const results = [];
      for (const account of accounts) {
        const protocol = String(account.primary_protocol || 'smtp').toLowerCase();
        const domain = extractDomain(account.email);

        if (protocol === 'graph') {
          results.push({
            id: account.id,
            email: account.email,
            provider: account.provider,
            domain,
            spf: true,
            dkim: true,
            dmarc: true,
            authOk: true,
            providerManaged: true,
            note: 'Microsoft Graph accounts use OAuth and are provider managed.'
          });
          continue;
        }

        const auth = await checkDomainAuth(domain);
        results.push({
          id: account.id,
          email: account.email,
          provider: account.provider,
          domain,
          spf: auth.spf,
          dkim: auth.dkim,
          dmarc: auth.dmarc,
          authOk: auth.ok,
          providerManaged: Boolean(auth.providerManaged),
          note: auth.note || ''
        });
      }
      return results;
    }
  };
}

module.exports = { createSendPreflightService, extractDomain };
