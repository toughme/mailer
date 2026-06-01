const dns = require('dns').promises;
const https = require('https');
const { execFile } = require('child_process');
const { createDomainRecord, createIpPoolRecord } = require('../schemas');

const HOSTNAME_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

function isValidHostname(domain) {
  return HOSTNAME_REGEX.test(domain) && domain.length <= 253;
}

async function resolveMx(domain) {
  try {
    return await dns.resolveMx(domain);
  } catch {
    return [];
  }
}

async function nslookupFallback(type, domain) {
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
    resolve(records.map((r) => normalizeTxtRecord(r)).filter(Boolean));
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

async function resolveTxt(domain) {
  try {
    const rows = await dns.resolveTxt(domain);
    return rows.map((parts) => normalizeTxtRecord(parts.join(''))).filter(Boolean);
  } catch (error) {
    console.warn(`DNS TXT lookup failed for ${domain}: ${error?.message || error}`);
    return nslookupFallback('txt', domain);
  }
}
async function resolveCname(domain) {
  try {
    return await dns.resolveCname(domain);
  } catch (error) {
    return nslookupFallback('cname', domain);
  }
}
async function resolveA(domain) {
  try {
    return await dns.resolve4(domain);
  } catch {
    return [];
  }
}

function fetchText(url) {
  return new Promise((resolve) => {
    https.get(url, { timeout: 5000 }, (response) => {
      let body = '';
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        resolve(body);
      });
    }).on('error', () => resolve('')).on('timeout', function onTimeout() {
      this.destroy();
      resolve('');
    });
  });
}

function normalizeTxtRecord(record) {
  return String(record || '').trim();
}

function normalizeDomainRow(row) {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    registrar: row.registrar,
    registeredAt: row.registered_at,
    ageDays: row.age_days,
    spfReady: Boolean(row.spf_ready),
    dkimReady: Boolean(row.dkim_ready),
    dmarcReady: Boolean(row.dmarc_ready),
    bimiReady: Boolean(row.bimi_ready),
    mtaStsReady: Boolean(row.mta_sts_ready),
    reputationScore: row.reputation_score,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value || '');
  } catch {
    return fallback;
  }
}

function normalizeIpPoolRow(row) {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    status: row.status,
    ips: safeJsonParse(row.ips, []),
    assignedDomains: safeJsonParse(row.assigned_domains, []),
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function createDomainService({ db }) {
  return {
    async listDomains() {
      const rows = await db.all('SELECT * FROM domain_profiles ORDER BY created_at DESC');
      return rows.map(normalizeDomainRow);
    },

    async addDomain(input) {
      const record = createDomainRecord(input);
      if (!record.name) {
        throw new Error('Domain name is required.');
      }

      await db.run(
        `INSERT INTO domain_profiles
         (name, status, registrar, registered_at, age_days, spf_ready, dkim_ready, dmarc_ready, bimi_ready, mta_sts_ready, reputation_score, notes, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(name) DO UPDATE SET
           status = excluded.status,
           registrar = excluded.registrar,
           registered_at = excluded.registered_at,
           age_days = excluded.age_days,
           reputation_score = excluded.reputation_score,
           notes = excluded.notes,
           updated_at = CURRENT_TIMESTAMP`,
        [
          record.name,
          record.status,
          record.registrar,
          record.registeredAt,
          record.ageDays,
          record.spfReady ? 1 : 0,
          record.dkimReady ? 1 : 0,
          record.dmarcReady ? 1 : 0,
          record.bimiReady ? 1 : 0,
          record.mtaStsReady ? 1 : 0,
          record.reputationScore,
          record.notes
        ]
      );

      const row = await db.get('SELECT * FROM domain_profiles WHERE name = ?', [record.name]);
      return normalizeDomainRow(row);
    },

    async inspectDomain(input) {
      const domain = String(input?.domain || '').trim().toLowerCase();
      const requestedSelector = String(input?.dkimSelector || 'default').trim();
      let dkimSelector = requestedSelector;

      if (!domain) {
        throw new Error('Domain is required.');
      }

      const [mxRecords, txtRecords, dmarcRecords, dkimRecords, bimiRecords, mtaStsPolicy, mtaStsA] = await Promise.all([
        resolveMx(domain),
        resolveTxt(domain),
        resolveTxt(`_dmarc.${domain}`),
        resolveTxt(`${dkimSelector}._domainkey.${domain}`),
        resolveTxt(`default._bimi.${domain}`),
        fetchText(`https://mta-sts.${domain}/.well-known/mta-sts.txt`),
        resolveA(`mta-sts.${domain}`)
      ]);

      // If DKIM not found for requested selector, try common alternatives
      if (domain && (!dkimRecords || dkimRecords.length === 0)) {
        const trySelectors = ['default', 'selector1', 'mail', 'smtp', 's1'];
        for (const sel of trySelectors) {
          if (sel === dkimSelector) continue;
          const rows = await resolveTxt(`${sel}._domainkey.${domain}`);
          if (rows && rows.length) {
            dkimSelector = sel;
            dkimRecords = rows;
            break;
          }
        }
      }

      const spfRecords = txtRecords.filter((record) => record.toLowerCase().startsWith('v=spf1'));
      // detect provider by MX and use provider-specific selectors first
      const { detectProviderByMx } = require('../../services/providerDkimPresets');
      const provider = detectProviderByMx(mxRecords) || null;
      const providerSelectors = provider?.selectors || [];

      // If DKIM not found for requested selector, try provider-specific then general alternatives
      if (domain && (!dkimRecords || dkimRecords.length === 0)) {
        const trySelectors = Array.from(new Set([...(providerSelectors || []), 'default', 'selector1', 'selector2', 'mail', 'smtp', 's1', 's2', 'google', 'amazonses']));
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
              let cnameTargets = [];
              try {
                cnameTargets = await resolveCname(selectorDomain);
              } catch (e) {
                cnameTargets = [];
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
              // ignore
            }
          }
        }
      }

      const detected = {
        spfReady: spfRecords.length >= 1,
        dmarcReady: dmarcRecords.some((record) => record.toLowerCase().startsWith('v=dmarc1')),
        dkimReady: dkimRecords.some((record) => {
          const lower = record.toLowerCase();
          return lower.includes('v=dkim1') || lower.includes('k=rsa');
        }),
        bimiReady: bimiRecords.some((record) => record.toLowerCase().includes('v=bimi1')),
        mtaStsReady: Boolean(mtaStsA.length) || /version:\s*stsv1/i.test(mtaStsPolicy)
      };

      const reputationScore = [
        detected.spfReady,
        detected.dmarcReady,
        detected.dkimReady,
        detected.bimiReady,
        detected.mtaStsReady,
        mxRecords.length > 0
      ].filter(Boolean).length * 16;

      await db.run(
        `INSERT INTO domain_profiles
         (name, status, spf_ready, dkim_ready, dmarc_ready, bimi_ready, mta_sts_ready, reputation_score, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(name) DO UPDATE SET
           spf_ready = excluded.spf_ready,
           dkim_ready = excluded.dkim_ready,
           dmarc_ready = excluded.dmarc_ready,
           bimi_ready = excluded.bimi_ready,
           mta_sts_ready = excluded.mta_sts_ready,
           reputation_score = excluded.reputation_score,
           updated_at = CURRENT_TIMESTAMP`,
        [
          domain,
          reputationScore >= 64 ? 'ready' : 'draft',
          detected.spfReady ? 1 : 0,
          detected.dkimReady ? 1 : 0,
          detected.dmarcReady ? 1 : 0,
          detected.bimiReady ? 1 : 0,
          detected.mtaStsReady ? 1 : 0,
          reputationScore
        ]
      );

      const persisted = await db.get('SELECT * FROM domain_profiles WHERE name = ?', [domain]);

      return {
        profile: persisted ? normalizeDomainRow(persisted) : null,
        domain,
        dkimSelector,
        detected,
        reputationScore,
        dns: {
          mxRecords,
          spfRecords,
          dmarcRecords,
          dkimRecords,
          bimiRecords,
          mtaStsPolicy,
          mtaStsA
        }
      };
    },

    async listIpPools() {
      const rows = await db.all('SELECT * FROM ip_pools ORDER BY created_at DESC');
      return rows.map(normalizeIpPoolRow);
    },

    async addIpPool(input) {
      const record = createIpPoolRecord(input);
      if (!record.name) {
        throw new Error('IP pool name is required.');
      }

      await db.run(
        `INSERT INTO ip_pools
         (name, provider, status, ips, assigned_domains, notes, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(name) DO UPDATE SET
           provider = excluded.provider,
           status = excluded.status,
           ips = excluded.ips,
           assigned_domains = excluded.assigned_domains,
           notes = excluded.notes,
           updated_at = CURRENT_TIMESTAMP`,
        [
          record.name,
          record.provider,
          record.status,
          JSON.stringify(record.ips),
          JSON.stringify(record.assignedDomains),
          record.notes
        ]
      );

      const row = await db.get('SELECT * FROM ip_pools WHERE name = ?', [record.name]);
      return normalizeIpPoolRow(row);
    }
  };
}

module.exports = { createDomainService };
