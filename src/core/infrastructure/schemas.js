const DOMAIN_STATUSES = ['draft', 'ready', 'warming', 'active', 'paused'];
const IP_POOL_STATUSES = ['active', 'warming', 'cooldown', 'disabled'];
const COMPLIANCE_EVENT_TYPES = ['consent_granted', 'consent_revoked', 'unsubscribe', 'suppressed', 'audit'];

function createDomainRecord(input = {}) {
  return {
    id: input.id || null,
    name: String(input.name || '').trim().toLowerCase(),
    status: DOMAIN_STATUSES.includes(input.status) ? input.status : 'draft',
    registrar: String(input.registrar || '').trim(),
    registeredAt: input.registeredAt || null,
    ageDays: Number(input.ageDays || 0),
    spfReady: Boolean(input.spfReady),
    dkimReady: Boolean(input.dkimReady),
    dmarcReady: Boolean(input.dmarcReady),
    bimiReady: Boolean(input.bimiReady),
    mtaStsReady: Boolean(input.mtaStsReady),
    reputationScore: Number(input.reputationScore || 0),
    notes: String(input.notes || '').trim()
  };
}

function createIpPoolRecord(input = {}) {
  return {
    id: input.id || null,
    name: String(input.name || '').trim(),
    provider: String(input.provider || '').trim(),
    status: IP_POOL_STATUSES.includes(input.status) ? input.status : 'active',
    ips: Array.isArray(input.ips) ? input.ips.map((item) => String(item).trim()).filter(Boolean) : [],
    assignedDomains: Array.isArray(input.assignedDomains) ? input.assignedDomains : [],
    notes: String(input.notes || '').trim()
  };
}

function createComplianceEvent(input = {}) {
  return {
    id: input.id || null,
    recipientId: input.recipientId || null,
    email: String(input.email || '').trim().toLowerCase(),
    type: COMPLIANCE_EVENT_TYPES.includes(input.type) ? input.type : 'audit',
    source: String(input.source || '').trim(),
    payload: input.payload && typeof input.payload === 'object' ? input.payload : {},
    createdAt: input.createdAt || new Date().toISOString()
  };
}

module.exports = {
  DOMAIN_STATUSES,
  IP_POOL_STATUSES,
  COMPLIANCE_EVENT_TYPES,
  createDomainRecord,
  createIpPoolRecord,
  createComplianceEvent
};
