function createDeliverabilityPlannerService({ db, domainService }) {
  if (!domainService) {
    throw new Error('domainService is required for deliverability planner preflight.');
  }

  return {
    async preflight(input) {
      const sendingDomain = String(input?.sendingDomain || '').trim().toLowerCase();
      const dkimSelector = String(input?.dkimSelector || 'default').trim();
      const unsubscribeUrl = String(input?.unsubscribeUrl || '').trim();
      const unsubscribeEmail = String(input?.unsubscribeEmail || '').trim();

      if (!sendingDomain) {
        throw new Error('Sending domain is required.');
      }

      const inspection = await domainService.inspectDomain({ domain: sendingDomain, dkimSelector });
      const suppressions = await db.get('SELECT COUNT(*) AS count FROM suppression_entries');
      const recipients = await db.get('SELECT COUNT(*) AS count FROM recipients WHERE status = ?', ['active']);

      const checks = [
        {
          label: 'SPF',
          ok: inspection.detected.spfReady,
          note: inspection.detected.spfReady ? 'SPF detected.' : 'SPF not yet verified for this domain.'
        },
        {
          label: 'DKIM',
          ok: inspection.detected.dkimReady,
          note: inspection.detected.dkimReady ? 'DKIM detected.' : 'DKIM not yet verified for this domain.'
        },
        {
          label: 'DMARC',
          ok: inspection.detected.dmarcReady,
          note: inspection.detected.dmarcReady ? 'DMARC detected.' : 'DMARC not yet verified for this domain.'
        },
        {
          label: 'One-click unsubscribe',
          ok: Boolean(unsubscribeUrl || unsubscribeEmail),
          note: unsubscribeUrl || unsubscribeEmail
            ? 'List-unsubscribe path is present.'
            : 'Add an unsubscribe URL or mailbox for bulk campaigns.'
        },
        {
          label: 'Active audience',
          ok: Boolean((recipients?.count || 0) > 0),
          note: (recipients?.count || 0) > 0
            ? `${recipients.count} active recipients available.`
            : 'No active recipients available.'
        }
      ];

      const score = Math.round((checks.filter((item) => item.ok).length / checks.length) * 100);

      return {
        sendingDomain,
        dkimSelector,
        score,
        checks,
        domainProfile: inspection.profile,
        detected: inspection.detected,
        suppressionCount: suppressions?.count || 0,
        recommendations: [
          'Use aligned SPF, DKIM, and DMARC before scaling volume.',
          'Offer clear unsubscribe handling for bulk mail.',
          'Send only to active, consented recipients.',
          'Ramp volume gradually on newly activated domains.'
        ]
      };
    }
  };
}

module.exports = { createDeliverabilityPlannerService };
