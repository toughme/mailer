const PROVIDER_DKIM_PRESETS = {
  microsoft: {
    id: 'microsoft',
    label: 'Microsoft 365 / Office365',
    mxHints: ['mail.protection.outlook.com', 'outlook.com', 'office365.com'],
    selectors: ['selector1', 'selector2'],
    // CNAME targets often include tenant-specific hostnames; probe CNAMEs if present
    cnameFollow: true
  },
  google: {
    id: 'google',
    label: 'Google Workspace',
    mxHints: ['google.com', 'googlemail.com', 'aspmx.l.google.com'],
    selectors: ['google'],
    cnameFollow: false
  },
  sendgrid: {
    id: 'sendgrid',
    label: 'SendGrid',
    mxHints: ['sendgrid.net'],
    selectors: ['s1','s2'],
    cnameFollow: false
  },
  mailgun: {
    id: 'mailgun',
    label: 'Mailgun',
    mxHints: ['mailgun.org'],
    selectors: ['mailo','mail'],
    cnameFollow: false
  },
  postmark: {
    id: 'postmark',
    label: 'Postmark',
    mxHints: ['postmarkapp.com'],
    selectors: ['pm'],
    cnameFollow: false
  },
  ses: {
    id: 'ses',
    label: 'Amazon SES',
    mxHints: ['amazonses.com'],
    selectors: ['amazonses','dkim'],
    cnameFollow: false
  }
};

function detectProviderByMx(mxRecords = []) {
  const hosts = (mxRecords || []).map((r) => (typeof r === 'string' ? r : r.exchange || '')).join(' ').toLowerCase();
  for (const key of Object.keys(PROVIDER_DKIM_PRESETS)) {
    const preset = PROVIDER_DKIM_PRESETS[key];
    for (const hint of preset.mxHints) {
      if (hosts.includes(hint)) return preset;
    }
  }
  return null;
}

module.exports = { PROVIDER_DKIM_PRESETS, detectProviderByMx };
