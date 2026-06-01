const dns = require('dns').promises;
const { execFile } = require('child_process');

const HOSTNAME_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

function isValidHostname(domain) {
  return HOSTNAME_REGEX.test(domain) && domain.length <= 253;
}

function logDnsFailure(domain, type, error) {
  console.warn(`DNS ${type} lookup failed for ${domain}: ${error?.message || error}`);
}

function normalizeTxtRecord(record) {
  return String(record || '').trim();
}

function scoreConfiguration(payload) {
  let score = 40;
  const findings = [];

  if (payload.domain && payload.domain.includes('.')) {
    score += 15;
    findings.push('Domain format looks valid.');
  } else {
    findings.push('Domain is missing or malformed.');
  }

  if (payload.hasDkim) {
    score += 20;
    findings.push('DKIM is enabled.');
  } else {
    findings.push('Enable DKIM signing before scaling sends.');
  }

  if (payload.hasSpf) {
    score += 15;
    findings.push('SPF is present.');
  } else {
    findings.push('Add an SPF record for your sending provider.');
  }

  if (payload.hasDmarc) {
    score += 10;
    findings.push('DMARC policy is present.');
  } else {
    findings.push('Add a DMARC policy with reporting before warmup ramps.');
  }

  if (payload.warmupEnabled) {
    score += 10;
    findings.push('Warmup is planned.');
  } else {
    findings.push('Warmup is not enabled yet.');
  }

  return {
    score: Math.min(score, 100),
    findings,
    recommendations: [
      'Keep one primary domain per sending cluster.',
      'Align visible From domain with SPF/DKIM signing domain.',
      'Ramp volume gradually over 14 days.',
      'Monitor replies and list hygiene before increasing daily caps.'
    ]
  };
}

function nslookupFallback(type, domain) {
  if (!isValidHostname(domain)) {
    return [];
  }
  return new Promise((resolve) => {
    execFile('nslookup', [`-type=${type}`, domain], { encoding: 'utf8', timeout: 5000, windowsHide: true }, (error, stdout) => {
      if (error) {
        resolve([]);
        return;
      }
      const lines = stdout.split(/\r?\n/);
      if (type === 'txt') {
        const records = [];
        for (const line of lines) {
      const m = line.match(/"(.*)"/) || line.match(/text\s*=\s*(.+)/i);
      if (m) records.push(m[1]);
    }
    resolve(records);
  } else if (type === 'mx') {
    const records = [];
    for (const line of lines) {
      const m = line.match(/mail exchanger = (.*)$/i)
        || line.match(/MX\s+preference\s*=\s*\d+,\s*mail exchanger\s*=\s*(.*)$/i);
      if (m) records.push(m[1].trim());
    }
    resolve(records);
  } else if (type === 'cname') {
    const records = [];
    for (const line of lines) {
      const m = line.match(/canonical name = (.*)$/i) || line.match(/CNAME\s+(.*)$/i) || line.match(/Aliases?:\s+(.*)$/i);
          if (m) records.push(m[1].trim());
        }
        resolve(records);
      } else {
        resolve([]);
      }
    });
  });
}

function createDeliverabilityService({ accountsService }) {
  async function resolveRecords(domain, type) {
    try {
      return await dns.resolve(domain, type);
    } catch (error) {
      logDnsFailure(domain, type, error);
      if (type === 'MX') {
        const hosts = await nslookupFallback('mx', domain);
        return hosts.map((host) => ({ exchange: host }));
      }
      return [];
    }
  }

  async function resolveTxt(domain) {
    try {
      const records = await dns.resolveTxt(domain);
      return records.map((parts) => normalizeTxtRecord(parts.join(''))).filter(Boolean);
    } catch (error) {
      logDnsFailure(domain, 'TXT', error);
      const rows = await nslookupFallback('txt', domain);
      return rows.map((r) => normalizeTxtRecord(r)).filter(Boolean);
    }
  }

  async function resolveCname(domain) {
    try {
      return await dns.resolveCname(domain);
    } catch (error) {
      logDnsFailure(domain, 'CNAME', error);
      return nslookupFallback('cname', domain);
    }
  }

  const { detectProviderByMx } = require('./providerDkimPresets');

  return {
    async analyze(payload) {
      const diagnostics = await accountsService.getForDiagnostics();
      const domain = String(payload?.domain || '').trim().toLowerCase();
      const mxRecords = domain ? await resolveRecords(domain, 'MX') : [];
      const txtRecords = domain ? await resolveTxt(domain) : [];
      const dmarcRecords = domain ? await resolveTxt(`_dmarc.${domain}`) : [];
      const requestedSelector = String(payload?.dkimSelector || 'default').trim();
      let dkimSelector = requestedSelector;
      let dkimRecords = domain ? await resolveTxt(`${dkimSelector}._domainkey.${domain}`) : [];

      const provider = detectProviderByMx(mxRecords) || null;
      const providerSelectors = provider?.selectors || [];

      if (domain && (!dkimRecords || dkimRecords.length === 0)) {
        const trySelectors = Array.from(new Set([...(providerSelectors || []), 'default', 'selector1', 'selector2', 'mail', 'smtp', 's1', 's2', 'google', 'amazonses', 'samsung']));
        for (const sel of trySelectors) {
          if (sel === dkimSelector) continue;
          const selectorDomain = `${sel}._domainkey.${domain}`;
          const rows = await resolveTxt(selectorDomain);
          if (rows && rows.length) {
            dkimSelector = sel;
            dkimRecords = rows;
            break;
          }

          if (provider?.cnameFollow) {
            try {
              const cnameTargets = await resolveCname(selectorDomain);

              for (const target of cnameTargets) {
                const trows = await resolveTxt(target);
                if (trows && trows.length) {
                  dkimSelector = sel;
                  dkimRecords = trows;
                  break;
                }
              }

              if (dkimRecords && dkimRecords.length) break;
            } catch (e) {
              // ignore failures following CNAMEs
            }
          }
        }
      }

      const spfRecords = txtRecords.filter((record) => record.toLowerCase().startsWith('v=spf1'));
      const detectedSpf = spfRecords.length >= 1;
      const detectedDmarc = dmarcRecords.some((record) => record.toLowerCase().startsWith('v=dmarc1'));
      const detectedDkim = dkimRecords.some((record) => {
        const lower = record.toLowerCase();
        return lower.includes('v=dkim1') || lower.includes('k=rsa');
      });

      const effectivePayload = {
        ...payload,
        hasSpf: domain ? detectedSpf : Boolean(payload?.hasSpf),
        hasDkim: domain ? detectedDkim : Boolean(payload?.hasDkim),
        hasDmarc: domain ? detectedDmarc : Boolean(payload?.hasDmarc)
      };

      return {
        ...scoreConfiguration(effectivePayload || {}),
        dns: {
          domain,
          mxRecords,
          spfRecords,
          dmarcRecords,
          dkimRecords,
          dkimSelector,
          provider: provider?.id || null
        },
        accountChecks: diagnostics
      };
    }
  };
}

module.exports = { createDeliverabilityService };
