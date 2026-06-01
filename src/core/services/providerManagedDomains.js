const PROVIDER_MANAGED_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'ymail.com',
  'aol.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'proton.me',
  'protonmail.com',
  'zoho.com',
  'mail.com',
  'gmx.com'
]);

function isProviderManagedDomain(domain) {
  return PROVIDER_MANAGED_DOMAINS.has(String(domain || '').trim().toLowerCase());
}

module.exports = { PROVIDER_MANAGED_DOMAINS, isProviderManagedDomain };
