const dns = require('dns').promises;

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

function createDeliverabilityService({ accountsService }) {
  const { execSync } = require('child_process');

  function nslookupTxt(domain) {
    try {
      const out = execSync(`nslookup -type=txt ${domain}`, { encoding: 'utf8', timeout: 5000 });
      const lines = out.split(/\r?\n/);
      const records = [];
      for (const line of lines) {
        const m = line.match(/\"(.*)\"/);
        if (m) records.push(m[1]);
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
    } catch (e) {
      return [];
    }
  }

  function nslookupCname(domain) {
    try {
      const out = execSync(`nslookup -type=cname ${domain}`, { encoding: 'utf8', timeout: 5000 });
      const lines = out.split(/\r?\n/);
      const records = [];
      for (const line of lines) {
        const m = line.match(/canonical name = (.*)$/i) || line.match(/CNAME\s+(.*)$/i);
        if (m) records.push(m[1].trim());
      }
      return records;
    } catch (e) {
      return [];
    }
  }
  async function resolveRecords(domain, type) {
    try {
      return await dns.resolve(domain, type);
    } catch (error) {
      logDnsFailure(domain, type, error);
      // fallback to nslookup for MX
      if (type === 'MX') {
        return nslookupMx(domain).map((host) => ({ exchange: host }));
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
      // fallback to nslookup
      try {
        const rows = nslookupTxt(domain);
        return rows.map((r) => normalizeTxtRecord(r)).filter(Boolean);
      } catch (e) {
        return [];
      }
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

      // detect provider and pick provider-specific selectors if available
      const provider = detectProviderByMx(mxRecords) || null;
      const providerSelectors = provider?.selectors || [];

      // If no DKIM found for requested selector, try common alternative selectors
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

          // If provider suggests following CNAMEs, try resolving CNAME then resolve TXT at target
          if (provider?.cnameFollow) {
            try {
              let cnameTargets = [];
              try {
                cnameTargets = await dns.resolveCname(selectorDomain);
              } catch (e) {
                // fallback to nslookup
                cnameTargets = nslookupCname(selectorDomain) || [];
              }

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
