const { execSync } = require('child_process');

function nslookupTxt(name) {
  try {
    const out = execSync(`nslookup -type=txt ${name}`, { encoding: 'utf8', timeout: 5000 });
    const lines = out.split(/\r?\n/);
    const records = [];
    for (const line of lines) {
      const m = line.match(/"(.*)"/);
      if (m) records.push(m[1]);
    }
    return records;
  } catch (e) {
    return [];
  }
}

function nslookupCname(name) {
  try {
    const out = execSync(`nslookup -type=cname ${name}`, { encoding: 'utf8', timeout: 5000 });
    const lines = out.split(/\r?\n/);
    const records = [];
    for (const line of lines) {
      const m = line.match(/canonical name = (.*)$/i);
      if (m) records.push(m[1].trim());
    }
    return records;
  } catch (e) {
    return [];
  }
}

function nslookupMx(domain) {
  try {
    const out = execSync(`nslookup -type=mx ${domain}`, { encoding: 'utf8', timeout: 5000 });
    const lines = out.split(/\r?\n/);
    const records = [];
    for (const line of lines) {
      const m = line.match(/mail exchanger = (.*)$/i);
      if (m) records.push(m[1].trim());
    }
    return records;
  } catch (e) { return []; }
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
    // Microsoft/Office365 often uses selector1._domainkey.domain -> selector1-domain-com._domainkey.<tenant>.onmicrosoft.com or similar
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
