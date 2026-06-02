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
      warnings.push(`Spam score ${spam.score} is below recommended minimum ${minScore}. You can still send if desired.`);
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
      `SELECT email, primary_protocol, connection_status, oauth_access_token, oauth_refresh_token FROM accounts
      WHERE (primary_protocol = 'smtp' AND encrypted_password != '')
      OR (primary_protocol = 'graph' AND (oauth_refresh_token != '' OR oauth_access_token != ''))`
    );

    const graphOAuthDomains = new Set(
      accounts
        .filter((row) => {
          const protocol = String(row.primary_protocol || '').toLowerCase();
          const hasToken = String(row.oauth_refresh_token || row.oauth_access_token || '').trim() !== '';
          return protocol === 'graph' && hasToken;
        })
        .map((row) => extractDomain(row.email))
        .filter(Boolean)
    );

    const domains = [...new Set(accounts.map((row) => extractDomain(row.email)).filter(Boolean))];
    const dnsChecks = [];
    for (const domain of domains) {
      if (graphOAuthDomains.has(domain)) {
        dnsChecks.push({
          domain,
          spf: true,
          dkim: true,
          dmarc: true,
          ok: true,
          providerManaged: true,
          note: 'Microsoft OAuth sender domain is treated as provider-managed for sending.'
        });
        continue;
      }
      dnsChecks.push(await checkDomainAuth(domain));
    }
    const customDomains = domains.filter(
      (domain) => !isProviderManagedDomain(domain) && !graphOAuthDomains.has(domain)
    );
    const requireDns = settings.requireDns !== false;
    const requireSpf = settings.dnsRequireSpf !== false;
    const requireDkim = settings.dnsRequireDkim !== false;
    const requireDmarc = settings.dnsRequireDmarc !== false;

    let dnsOk = true;
    if (requireDns && customDomains.length) {
      for (const domain of customDomains) {
        const check = dnsChecks.find((item) => item.domain === domain && !item.providerManaged);
        if (!check) {
          dnsOk = false;
          break;
        }
        const checks = [];
        if (requireSpf && !check.spf) checks.push('SPF');
        if (requireDkim && !check.dkim) checks.push('DKIM');
        if (requireDmarc && !check.dmarc) checks.push('DMARC');
        if (checks.length) {
          dnsOk = false;
          break;
        }
      }
    }
      const errors = [...contentScan.errors];
      const warnings = [...contentScan.warnings];

    if (requireDns && customDomains.length && !dnsOk) {
      const required = [requireSpf && 'SPF', requireDkim && 'DKIM', requireDmarc && 'DMARC'].filter(Boolean);
      errors.push(`DNS auth incomplete (${required.join(', ')} required on sending domains).`);
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
        requireDns: settings.require_dns !== 0,
        dnsRequireSpf: settings.dns_require_spf !== 0,
        dnsRequireDkim: settings.dns_require_dkim !== 0,
        dnsRequireDmarc: settings.dns_require_dmarc !== 0
      }
      : { minSpamScore: 55, requireDns: true, dnsRequireSpf: true, dnsRequireDkim: true, dnsRequireDmarc: true };
      return this.validateCampaign(campaignId, mapped);
    },

    async getAccountAuthHealth() {
      const accounts = await db.all(
        `SELECT id, email, provider, primary_protocol, connection_status FROM accounts ORDER BY created_at DESC`
      );

      const results = [];
      for (const account of accounts) {
        const protocol = String(account.primary_protocol || 'smtp').toLowerCase();
        const domain = extractDomain(account.email);

        if (protocol === 'graph') {
          const connStatus = account.connection_status || 'pending';
          results.push({
            id: account.id,
            email: account.email,
            provider: account.provider,
            domain,
            spf: true,
            dkim: true,
            dmarc: true,
            authOk: connStatus === 'connected',
            providerManaged: true,
        note: connStatus === 'connected'
          ? 'Microsoft IMAP OAuth account connected.'
          : connStatus === 'pending'
            ? 'Microsoft IMAP OAuth account needs authorization.'
            : `Microsoft IMAP OAuth account status: ${connStatus}`
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
