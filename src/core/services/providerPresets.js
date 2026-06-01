const PROVIDER_PRESETS = {
  gmail: {
    id: 'gmail',
    label: 'Gmail',
    delayMinMs: 90000,
    delayMaxMs: 240000,
    dailyCapPerAccount: 40,
    jitterPercent: 30
  },
  outlook: {
    id: 'outlook',
    label: 'Outlook',
    delayMinMs: 60000,
    delayMaxMs: 150000,
    dailyCapPerAccount: 80,
    jitterPercent: 25
  },
  ses: {
    id: 'ses',
    label: 'Amazon SES',
    delayMinMs: 15000,
    delayMaxMs: 45000,
    dailyCapPerAccount: 200,
    jitterPercent: 15
  },
  mailgun: {
    id: 'mailgun',
    label: 'Mailgun',
    delayMinMs: 20000,
    delayMaxMs: 60000,
    dailyCapPerAccount: 150,
    jitterPercent: 20
  },
  postmark: {
    id: 'postmark',
    label: 'Postmark',
    delayMinMs: 15000,
    delayMaxMs: 45000,
    dailyCapPerAccount: 200,
    jitterPercent: 15
  },
  sendgrid: {
    id: 'sendgrid',
    label: 'SendGrid',
    delayMinMs: 15000,
    delayMaxMs: 45000,
    dailyCapPerAccount: 200,
    jitterPercent: 15
  },
  default: {
    id: 'default',
    label: 'Balanced',
    delayMinMs: 45000,
    delayMaxMs: 120000,
    dailyCapPerAccount: 80,
    jitterPercent: 25
  }
};

module.exports = { PROVIDER_PRESETS };
