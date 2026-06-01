const { execFileSync } = require('child_process');

const HOSTNAME_REGEX = /^[a-zA-Z0-9]([a-zA-Z0-9\-.*]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*$/;

function isValidHost(host) {
  if (!host || typeof host !== 'string') return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const parts = host.split('.').map(Number);
    return parts.every((p) => p >= 0 && p <= 255);
  }
  return HOSTNAME_REGEX.test(host);
}

function nslookup(args) {
  try {
    return execFileSync('nslookup', args, {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true
    });
  } catch {
    return '';
  }
}

function nslookupTxt(name) {
  if (!isValidHost(name)) return [];
  const out = nslookup(['-type=txt', name]);
  const lines = out.split(/\r?\n/);
  const records = [];
  for (const line of lines) {
    const m = line.match(/"(.*)"/) || line.match(/text\s*=\s*(.+)/i);
    if (m) records.push(m[1].trim());
  }
  return records;
}

function nslookupCname(name) {
  if (!isValidHost(name)) return [];
  const out = nslookup(['-type=cname', name]);
  const lines = out.split(/\r?\n/);
  const records = [];
  for (const line of lines) {
    const m = line.match(/canonical name = (.*)$/i)
      || line.match(/CNAME\s+(.*)$/i)
      || line.match(/Aliases?:\s+(.*)$/i);
    if (m) records.push(m[1].trim());
  }
  return records;
}

function nslookupMx(domain) {
  if (!isValidHost(domain)) return [];
  const out = nslookup(['-type=mx', domain]);
  const lines = out.split(/\r?\n/);
  const records = [];
  for (const line of lines) {
    const m = line.match(/mail exchanger = (.*)$/i)
      || line.match(/MX\s+preference\s*=\s*\d+,\s*mail exchanger\s*=\s*(.*)$/i);
    if (m) records.push(m[1].trim());
  }
  return records;
}

async function probe(domain) {
  const selectors = [
    'default','selector1','selector2','s1','s2','mail','smtp','ms','google','google1','google2','mailo','smtpapi','k1','k2','selector','mx','mailserver','dkim'
  ];

  console.log('Domain:', domain);
  console.log('MX:', nslookupMx(domain));
  console.log('\nProbing selectors (TXT + CNAME):\n');

  const results = [];
  for (const sel of selectors) {
    const name = `${sel}._domainkey.${domain}`;
    const txt = nslookupTxt(name);
    const cname = nslookupCname(name);
    results.push({ selector: sel, name, txt, cname });
    console.log('Selector:', sel);
    console.log('  Name:', name);
    console.log('  TXT:', txt.length ? txt : '(none)');
    console.log('  CNAME:', cname.length ? cname : '(none)');
    console.log('');
  }

  console.log('Also probing common provider CNAME patterns (example):');
  const patterns = [
    `selector1._domainkey.${domain}`,
    `selector2._domainkey.${domain}`
  ];
  for (const p of patterns) {
    const txt = nslookupTxt(p);
    const cname = nslookupCname(p);
    console.log(p, '\n  TXT:', txt.length ? txt : '(none)', '\n  CNAME:', cname.length ? cname : '(none)');
  }

  return results;
}

const domain = process.argv[2];
if (!domain) { console.error('Usage: node probe_dkim_selectors.js example.com'); process.exit(2); }
probe(domain);
