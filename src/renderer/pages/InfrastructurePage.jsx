import React, { useEffect, useMemo, useState } from 'react';
import { desktopInvoke } from '../api';
import AISettingsPanel from '../components/AISettingsPanel';

const domainInitial = {
  name: '',
  registrar: '',
  ageDays: 0,
  notes: ''
};

const poolInitial = {
  name: '',
  provider: '',
  ips: '',
  notes: ''
};

const proxyInitial = {
  name: '',
  type: 'http',
  host: '',
  port: 8080,
  username: '',
  password: '',
  status: 'active',
  notes: ''
};

const webhookInitial = {
  name: '',
  url: '',
  events: 'sent,failed,bounce,complaint,unsubscribe',
  secret: '',
  status: 'active'
};

function InfrastructurePage() {
  const [domains, setDomains] = useState([]);
  const [ipPools, setIpPools] = useState([]);
  const [proxies, setProxies] = useState([]);
  const [webhooks, setWebhooks] = useState([]);
  const [reputation, setReputation] = useState(null);
  const [hygiene, setHygiene] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [complianceEvents, setComplianceEvents] = useState([]);
  const [inspection, setInspection] = useState(null);
  const [domainForm, setDomainForm] = useState(domainInitial);
  const [poolForm, setPoolForm] = useState(poolInitial);
  const [proxyForm, setProxyForm] = useState(proxyInitial);
  const [webhookForm, setWebhookForm] = useState(webhookInitial);
  const [inspectionForm, setInspectionForm] = useState({ domain: '', dkimSelector: 'default' });
  const [error, setError] = useState('');
  const [proxyMessage, setProxyMessage] = useState('');
  const [expandedTool, setExpandedTool] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredTools = useMemo(() => {
    if (!searchQuery) return null;
    const query = searchQuery.toLowerCase();
    const results = [];
    if ('domain'.includes(query)) results.push({ type: 'domain', label: 'Domain Configuration' });
    if ('pool'.includes(query) || 'ip'.includes(query)) results.push({ type: 'pool', label: 'IP Pools' });
    if ('proxy'.includes(query)) results.push({ type: 'proxy', label: 'Proxy Profiles' });
    if ('webhook'.includes(query)) results.push({ type: 'webhook', label: 'Webhooks' });
    if ('ai'.includes(query) || 'assistant'.includes(query)) results.push({ type: 'ai', label: '🤖 AI Email Assistant' });
    return results.length > 0 ? results : null;
  }, [searchQuery]);

  async function refresh() {
    try {
      const [domainRows, poolRows, proxyRows, webhookRows, reputationSnapshot, analyticsSnapshot, complianceRows] = await Promise.all([
        desktopInvoke('ops:domains:list'),
        desktopInvoke('ops:ip-pools:list'),
        desktopInvoke('ops:proxies:list'),
        desktopInvoke('webhooks:list'),
        desktopInvoke('reputation:snapshot'),
        desktopInvoke('ops:analytics:snapshot'),
        desktopInvoke('ops:compliance:list')
      ]);
      setDomains(domainRows);
      setIpPools(poolRows);
      setProxies(proxyRows);
      setWebhooks(webhookRows);
      setReputation(reputationSnapshot);
      setAnalytics(analyticsSnapshot);
      setComplianceEvents(complianceRows);
      setError('');
    } catch (loadError) {
      setError(loadError.message);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function addDomain(event) {
    event.preventDefault();
    try {
      await desktopInvoke('ops:domains:add', domainForm);
      setDomainForm(domainInitial);
      await refresh();
    } catch (submitError) {
      setError(submitError.message);
    }
  }

  async function inspectDomain(event) {
    event.preventDefault();
    try {
      setInspection(await desktopInvoke('ops:domains:inspect', inspectionForm));
      setError('');
    } catch (inspectError) {
      setError(inspectError.message);
    }
  }

  async function addIpPool(event) {
    event.preventDefault();
    try {
      await desktopInvoke('ops:ip-pools:add', {
        ...poolForm,
        ips: poolForm.ips.split(',').map((item) => item.trim()).filter(Boolean)
      });
      setPoolForm(poolInitial);
      await refresh();
    } catch (submitError) {
      setError(submitError.message);
    }
  }

  async function addProxy(event) {
    event.preventDefault();
    try {
      setProxies(await desktopInvoke('ops:proxies:add', proxyForm));
      setProxyForm(proxyInitial);
      setProxyMessage('');
      setError('');
    } catch (submitError) {
      setError(submitError.message);
    }
  }

  async function testProxy(id) {
    try {
      const result = await desktopInvoke('ops:proxies:test', { id });
      setProxyMessage(result.message);
      await refresh();
    } catch (testError) {
      setError(testError.message);
      setProxyMessage('');
    }
  }

  async function testAllProxies() {
    if (!proxies.length) {
      setError('Add at least one proxy before running a full test.');
      return;
    }

    let passed = 0;
    for (const proxy of proxies) {
      try {
        await desktopInvoke('ops:proxies:test', { id: proxy.id });
        passed += 1;
      } catch {
        // Keep testing the rest so the operator gets a full pass/fail count.
      }
    }

    setProxyMessage(`${passed}/${proxies.length} proxies passed connection testing.`);
    await refresh();
  }

  async function deleteProxy(id) {
    try {
      setProxies(await desktopInvoke('ops:proxies:delete', { id }));
      setProxyMessage('');
    } catch (deleteError) {
      setError(deleteError.message);
    }
  }

  async function addWebhook(event) {
    event.preventDefault();
    try {
      setWebhooks(await desktopInvoke('webhooks:add', {
        ...webhookForm,
        events: webhookForm.events.split(',').map((item) => item.trim()).filter(Boolean)
      }));
      setWebhookForm(webhookInitial);
      setError('');
    } catch (submitError) {
      setError(submitError.message);
    }
  }

  async function deleteWebhook(id) {
    try {
      setWebhooks(await desktopInvoke('webhooks:delete', { id }));
    } catch (deleteError) {
      setError(deleteError.message);
    }
  }

  async function runHygiene() {
    try {
      setHygiene(await desktopInvoke('hygiene:validate'));
      setError('');
    } catch (hygieneError) {
      setError(hygieneError.message);
    }
  }

  async function recordCompliance() {
    try {
      await desktopInvoke('ops:compliance:record', {
        email: 'audit@example.com',
        type: 'audit',
        source: 'infrastructure-console',
        payload: { note: 'Manual compliance event recorded from admin console.' }
      });
      await refresh();
    } catch (recordError) {
      setError(recordError.message);
    }
  }

  return (
    <section className="page-grid">
      {error ? <p className="error-text">{error}</p> : null}
      
      <div className="filter-row" style={{ marginBottom: '24px' }}>
        <input 
          type="text"
          placeholder="Search tools... (domain, proxy, webhook, inspect, hygiene)"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          style={{ flex: 1 }}
        />
        {searchQuery && filteredTools && (
          <div style={{ fontSize: '0.9em', color: 'rgba(255,255,255,0.6)' }}>
            {filteredTools.length} tool{filteredTools.length !== 1 ? 's' : ''} found
          </div>
        )}
      </div>

      {filteredTools && (
        <div style={{ marginBottom: '32px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px' }}>
            {filteredTools.map((tool) => (
              <button
                key={tool.type}
                className="ghost-button"
                onClick={() => { setExpandedTool(tool.type); setSearchQuery(''); }}
                style={{ padding: '12px', textAlign: 'left' }}
              >
                → {tool.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="stats-grid">
        <article className="stat-card"><span>Domains</span><strong>{domains.length}</strong></article>
        <article className="stat-card"><span>IP Pools</span><strong>{ipPools.length}</strong></article>
        <article className="stat-card"><span>Proxies</span><strong>{proxies.length}</strong></article>
        <article className="stat-card"><span>Webhooks</span><strong>{webhooks.length}</strong></article>
        <article className="stat-card"><span>Bounce Rate</span><strong>{reputation ? `${reputation.aggregate.bounceRate}%` : '0%'}</strong></article>
        <article className="stat-card"><span>Compliance Events</span><strong>{complianceEvents.length}</strong></article>
      </div>

      {/* EMAIL SENDING TOOLS */}
      <div style={{ marginTop: '32px' }}>
        <h2 style={{ marginBottom: '24px', fontSize: '18px', fontWeight: 600 }}>📤 Email Sending Tools</h2>

        {/* DOMAINS */}
        <div className="panel" style={{ marginBottom: '16px' }}>
          <h3 style={{ margin: '0 0 16px 0', fontSize: '14px', cursor: 'pointer', userSelect: 'none' }} onClick={() => setExpandedTool(expandedTool === 'domain' ? null : 'domain')}>
            {expandedTool === 'domain' ? '▼' : '▶'} Domain Configuration
          </h3>
          {expandedTool === 'domain' && (
            <>
              <form className="form-grid compact-form" onSubmit={addDomain}>
                <label>Domain<input value={domainForm.name} onChange={(event) => setDomainForm({ ...domainForm, name: event.target.value })} /></label>
                <label>Registrar<input value={domainForm.registrar} onChange={(event) => setDomainForm({ ...domainForm, registrar: event.target.value })} /></label>
                <label>Age Days<input type="number" value={domainForm.ageDays} onChange={(event) => setDomainForm({ ...domainForm, ageDays: Number(event.target.value) })} /></label>
                <label className="full-span">Notes<textarea value={domainForm.notes} onChange={(event) => setDomainForm({ ...domainForm, notes: event.target.value })} /></label>
                <button className="primary-button" type="submit">Save Domain</button>
              </form>
              <div className="list-stack compact-list">
                {domains.map((domain) => (
                  <div className="list-row" key={domain.id}>
                    <div>
                      <strong>{domain.name}</strong>
                      <p>{domain.registrar || 'Unknown registrar'} | score {domain.reputationScore}</p>
                    </div>
                    <span className="pill">{domain.status}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* IP POOLS */}
        <div className="panel" style={{ marginBottom: '16px' }}>
          <h3 style={{ margin: '0 0 16px 0', fontSize: '14px', cursor: 'pointer', userSelect: 'none' }} onClick={() => setExpandedTool(expandedTool === 'pool' ? null : 'pool')}>
            {expandedTool === 'pool' ? '▼' : '▶'} IP Pools
          </h3>
          {expandedTool === 'pool' && (
            <>
              <form className="form-grid compact-form" onSubmit={addIpPool}>
                <label>Name<input value={poolForm.name} onChange={(event) => setPoolForm({ ...poolForm, name: event.target.value })} /></label>
                <label>Provider<input value={poolForm.provider} onChange={(event) => setPoolForm({ ...poolForm, provider: event.target.value })} /></label>
                <label className="full-span">IPs (comma separated)<input value={poolForm.ips} onChange={(event) => setPoolForm({ ...poolForm, ips: event.target.value })} /></label>
                <label className="full-span">Notes<textarea value={poolForm.notes} onChange={(event) => setPoolForm({ ...poolForm, notes: event.target.value })} /></label>
                <button className="primary-button" type="submit">Save IP Pool</button>
              </form>
              <div className="list-stack compact-list">
                {ipPools.map((pool) => (
                  <div className="list-row" key={pool.id}>
                    <div>
                      <strong>{pool.name}</strong>
                      <p>{pool.provider} | {pool.ips.length} IPs</p>
                    </div>
                    <span className="pill">{pool.status}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* PROXIES */}
        <div className="panel" style={{ marginBottom: '16px' }}>
          <h3 style={{ margin: '0 0 16px 0', fontSize: '14px', cursor: 'pointer', userSelect: 'none' }} onClick={() => setExpandedTool(expandedTool === 'proxy' ? null : 'proxy')}>
            {expandedTool === 'proxy' ? '▼' : '▶'} Proxy Profiles
          </h3>
          {expandedTool === 'proxy' && (
            <>
              <form className="form-grid compact-form" onSubmit={addProxy}>
                <label>Name<input value={proxyForm.name} onChange={(event) => setProxyForm({ ...proxyForm, name: event.target.value })} /></label>
                <label>Type<select value={proxyForm.type} onChange={(event) => setProxyForm({ ...proxyForm, type: event.target.value })}><option value="http">HTTP</option><option value="https">HTTPS</option><option value="socks">SOCKS</option><option value="socks4">SOCKS4</option><option value="socks5">SOCKS5</option></select></label>
                <label>Host<input value={proxyForm.host} onChange={(event) => setProxyForm({ ...proxyForm, host: event.target.value })} /></label>
                <label>Port<input type="number" value={proxyForm.port} onChange={(event) => setProxyForm({ ...proxyForm, port: Number(event.target.value) })} /></label>
                <label>User<input value={proxyForm.username} onChange={(event) => setProxyForm({ ...proxyForm, username: event.target.value })} /></label>
                <label>Pass<input type="password" value={proxyForm.password} onChange={(event) => setProxyForm({ ...proxyForm, password: event.target.value })} /></label>
                <label>Status<select value={proxyForm.status} onChange={(event) => setProxyForm({ ...proxyForm, status: event.target.value })}><option value="active">Active</option><option value="paused">Paused</option></select></label>
                <label className="full-span">Notes<textarea value={proxyForm.notes} onChange={(event) => setProxyForm({ ...proxyForm, notes: event.target.value })} /></label>
                <button className="primary-button" type="submit">Save Proxy</button>
              </form>
              {proxyMessage ? <p className="success-text">{proxyMessage}</p> : null}
              <div className="button-row">
                <button className="ghost-button sm" type="button" onClick={testAllProxies} disabled={!proxies.length}>Test All Proxies</button>
              </div>
              <div className="list-stack compact-list">
                {proxies.map((proxy) => (
                  <div className="list-row" key={proxy.id}>
                    <div>
                      <strong>{proxy.name}</strong>
                      <p>{proxy.type} | {proxy.host}:{proxy.port}</p>
                      <p className="muted-copy">{proxy.lastTestedAt ? `Last test ${proxy.lastTestedAt}` : 'Not tested yet'}</p>
                    </div>
                    <div className="button-row">
                      <span className="pill">{proxy.status}</span>
                      <button className="ghost-button sm" type="button" onClick={() => testProxy(proxy.id)}>Test</button>
                      <button className="ghost-button sm" type="button" onClick={() => deleteProxy(proxy.id)}>x</button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* WEBHOOKS */}
        <div className="panel" style={{ marginBottom: '16px' }}>
          <h3 style={{ margin: '0 0 16px 0', fontSize: '14px', cursor: 'pointer', userSelect: 'none' }} onClick={() => setExpandedTool(expandedTool === 'webhook' ? null : 'webhook')}>
            {expandedTool === 'webhook' ? '▼' : '▶'} Webhooks
          </h3>
          {expandedTool === 'webhook' && (
            <>
              <form className="form-grid compact-form" onSubmit={addWebhook}>
                <label>Name<input value={webhookForm.name} onChange={(event) => setWebhookForm({ ...webhookForm, name: event.target.value })} /></label>
                <label className="full-span">URL<input value={webhookForm.url} onChange={(event) => setWebhookForm({ ...webhookForm, url: event.target.value })} /></label>
                <label className="full-span">Events<input value={webhookForm.events} onChange={(event) => setWebhookForm({ ...webhookForm, events: event.target.value })} /></label>
                <label>Secret<input type="password" value={webhookForm.secret} onChange={(event) => setWebhookForm({ ...webhookForm, secret: event.target.value })} /></label>
                <label>Status<select value={webhookForm.status} onChange={(event) => setWebhookForm({ ...webhookForm, status: event.target.value })}><option value="active">Active</option><option value="paused">Paused</option></select></label>
                <button className="primary-button" type="submit">Save Webhook</button>
              </form>
              <div className="list-stack compact-list">
                {webhooks.map((webhook) => (
                  <div className="list-row" key={webhook.id}>
                    <div>
                      <strong>{webhook.name}</strong>
                      <p>{webhook.url}</p>
                      <p className="muted-copy">{webhook.events.join(', ')} | {webhook.lastStatus || webhook.lastError || 'No delivery yet'}</p>
                    </div>
                    <div className="button-row">
                      <span className="pill">{webhook.status}</span>
                      <button className="ghost-button sm" type="button" onClick={() => deleteWebhook(webhook.id)}>x</button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* SCANNERS & INSPECTORS */}
      <div style={{ marginTop: '32px' }}>
        <h2 style={{ marginBottom: '24px', fontSize: '18px', fontWeight: 600 }}>🔍 Scanners & Inspectors</h2>

        {/* DOMAIN INSPECTOR */}
        <div className="panel" style={{ marginBottom: '16px' }}>
          <h3 style={{ margin: '0 0 16px 0', fontSize: '14px', cursor: 'pointer', userSelect: 'none' }} onClick={() => setExpandedTool(expandedTool === 'inspect' ? null : 'inspect')}>
            {expandedTool === 'inspect' ? '▼' : '▶'} Domain Inspector
          </h3>
          {expandedTool === 'inspect' && (
            <>
              <form className="form-grid compact-form" onSubmit={inspectDomain}>
                <label>Domain<input value={inspectionForm.domain} onChange={(event) => setInspectionForm({ ...inspectionForm, domain: event.target.value })} /></label>
                <label>DKIM Selector<input value={inspectionForm.dkimSelector} onChange={(event) => setInspectionForm({ ...inspectionForm, dkimSelector: event.target.value })} /></label>
                <button className="primary-button" type="submit">Inspect</button>
              </form>
              {inspection && (
                <div className="generated-preview">
                  <strong>{inspection.domain}</strong>
                  <p>Reputation Score: {inspection.reputationScore}</p>
                  <p>SPF: {inspection.detected.spfReady ? '✓ Ready' : '✗ Missing'}</p>
                  <p>DKIM: {inspection.detected.dkimReady ? '✓ Ready' : '✗ Missing'}</p>
                  <p>DMARC: {inspection.detected.dmarcReady ? '✓ Ready' : '✗ Missing'}</p>
                  <p>BIMI: {inspection.detected.bimiReady ? '✓ Ready' : '✗ Missing'}</p>
                  <p>MTA-STS: {inspection.detected.mtaStsReady ? '✓ Ready' : '✗ Missing'}</p>
                  <p>MX Records: {inspection.dns.mxRecords.length}</p>
                </div>
              )}
            </>
          )}
        </div>

        {/* REPUTATION & HYGIENE */}
        <div className="panel" style={{ marginBottom: '16px' }}>
          <h3 style={{ margin: '0 0 16px 0', fontSize: '14px', cursor: 'pointer', userSelect: 'none' }} onClick={() => setExpandedTool(expandedTool === 'monitor' ? null : 'monitor')}>
            {expandedTool === 'monitor' ? '▼' : '▶'} Reputation & Hygiene Monitor
          </h3>
          {expandedTool === 'monitor' && (
            <>
              <div className="button-row">
                <button className="ghost-button" type="button" onClick={runHygiene}>Validate Audience</button>
                <button className="ghost-button" type="button" onClick={refresh}>Refresh Data</button>
              </div>
              <div className="generated-preview">
                <strong>📊 Reputation</strong>
                <p>Sent: {reputation ? reputation.aggregate.sent : 0}</p>
                <p>Bounces: {reputation ? reputation.aggregate.bounces : 0}</p>
                <p>Complaints: {reputation ? reputation.aggregate.complaints : 0}</p>
                <p>Complaint Rate: {reputation ? `${reputation.aggregate.complaintRate}%` : '0%'}</p>
              </div>
              {hygiene && (
                <div className="generated-preview">
                  <strong>🧹 List Hygiene</strong>
                  <p>Checked: {hygiene.checked}</p>
                  <p>Valid: {hygiene.valid} | Risky: {hygiene.risky} | Invalid: {hygiene.invalid}</p>
                </div>
              )}
            </>
          )}
        </div>

        {/* AI SETTINGS */}
        <div className="panel" style={{ marginBottom: '16px' }}>
          <h3 style={{ margin: '0 0 16px 0', fontSize: '14px', cursor: 'pointer', userSelect: 'none' }} onClick={() => setExpandedTool(expandedTool === 'ai' ? null : 'ai')}>
            {expandedTool === 'ai' ? '▼' : '▶'} 🤖 AI Email Assistant
          </h3>
          {expandedTool === 'ai' && <AISettingsPanel />}
        </div>

        {/* ANALYTICS */}
        <div className="panel">
          <h3 style={{ margin: '0 0 16px 0', fontSize: '14px', cursor: 'pointer', userSelect: 'none' }} onClick={() => setExpandedTool(expandedTool === 'analytics' ? null : 'analytics')}>
            {expandedTool === 'analytics' ? '▼' : '▶'} Analytics & Compliance
          </h3>
          {expandedTool === 'analytics' && (
            <>
              <div className="button-row">
                <button className="ghost-button" type="button" onClick={recordCompliance}>Record Audit Event</button>
                <button className="ghost-button" type="button" onClick={refresh}>Refresh Snapshot</button>
              </div>
              <div className="generated-preview">
                <strong>📈 Analytics</strong>
                <p>Delivery providers tracked: {analytics ? analytics.deliveryByProvider.length : 0}</p>
                <p>Engagement series: {analytics ? analytics.engagement.length : 0}</p>
                <p>Complaints tracked: {analytics ? analytics.complaints.length : 0}</p>
                <p>Bounces tracked: {analytics ? analytics.bounces.length : 0}</p>
              </div>
              <div className="list-stack compact-list">
                {complianceEvents.map((event) => (
                  <div className="list-row" key={event.id}>
                    <div>
                      <strong>{event.type}</strong>
                      <p>{event.email || 'No email'} | {event.source || 'Unknown source'}</p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

export default InfrastructurePage;
