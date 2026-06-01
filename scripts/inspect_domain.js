const dns = require('dns').promises;
const https = require('https');

function fetchText(url, timeout = 5000) {
  return new Promise((resolve) => {
    https.get(url, { timeout }, (response) => {
      let body = '';
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve(body));
    }).on('error', () => resolve('')).on('timeout', function() { this.destroy(); resolve(''); });
  });
}

async function resolveTxtSafe(name) {
  try {
    const rows = await dns.resolveTxt(name);
    return rows.map(parts => parts.join('')).map(r => String(r||'').trim()).filter(Boolean);
  } catch (e) {
    return [];
  }
}

async function resolveMxSafe(domain) {
  try { return await dns.resolveMx(domain); } catch (e) { return []; }
}

async function resolveA4(domain) {
  try { return await dns.resolve4(domain); } catch (e) { return []; }
}

async function inspect(domain) {
  const dkimSelectors = ['default','selector1','mail','smtp','s1'];
  const mx = await resolveMxSafe(domain);
  const txt = await resolveTxtSafe(domain);
  const dmarc = await resolveTxtSafe(`_dmarc.${domain}`);
  const mtaPolicy = await fetchText(`https://mta-sts.${domain}/.well-known/mta-sts.txt`);
  const mtaA = await resolveA4(`mta-sts.${domain}`);

  const spfRecords = txt.filter(r => r.toLowerCase().startsWith('v=spf1'));
  const dkimResults = {};
  let matchedSelector = null;
  for (const sel of dkimSelectors) {
    const records = await resolveTxtSafe(`${sel}._domainkey.${domain}`);
    dkimResults[sel] = records;
    if (!matchedSelector && records && records.length) matchedSelector = sel;
  }

  const detected = {
    spf: spfRecords.length >= 1,
    spfCount: spfRecords.length,
    dmarc: dmarc.some(r => r.toLowerCase().startsWith('v=dmarc1')),
    dkim: matchedSelector !== null,
    dkimSelector: matchedSelector
  };

  console.log(JSON.stringify({ domain, mx, spfRecords, dmarc, dkimResults, matchedSelector, mtaPolicy: mtaPolicy.slice(0,200), mtaA, detected }, null, 2));
}

const domain = process.argv[2];
if (!domain) { console.error('Usage: node inspect_domain.js example.com'); process.exit(2); }
inspect(domain).catch(err => { console.error('ERROR', err); process.exit(1); });
