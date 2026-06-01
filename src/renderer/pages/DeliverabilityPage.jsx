import React, { useState } from 'react';
import { desktopInvoke } from '../api';

function DeliverabilityPage() {
  const [form, setForm] = useState({
    domain: '',
    dkimSelector: 'default',
    warmupEnabled: true
  });
  const [report, setReport] = useState(null);
  const [preflight, setPreflight] = useState(null);
  const [error, setError] = useState('');
  const [preflightForm, setPreflightForm] = useState({
    sendingDomain: '',
    unsubscribeUrl: '',
    unsubscribeEmail: ''
  });

  const deliverabilityStatus = React.useMemo(() => {
    if (!report) return null;
    const score = report.score || 0;
    if (score >= 80) {
      return {
        label: 'Ready to send',
        className: 'pill-pass',
        message: 'This sending domain is in a strong state for delivery.'
      };
    }
    if (score >= 60) {
      return {
        label: 'Review recommended',
        className: 'pill-review',
        message: 'Some authentication or domain checks should be improved.'
      };
    }
    return {
      label: 'High delivery risk',
      className: 'pill-bad',
      message: 'Delivery may be blocked or filtered. Resolve DNS and account issues.'
    };
  }, [report]);

  async function analyze() {
    try {
      setReport(await desktopInvoke('deliverability:analyze', form));
      setError('');
    } catch (analyzeError) {
      setError(analyzeError.message);
    }
  }

  async function runPreflight() {
    try {
      setPreflight(await desktopInvoke('ops:deliverability:preflight', preflightForm));
      setError('');
    } catch (preflightError) {
      setError(preflightError.message);
    }
  }

  return (
    <section className="two-column-grid">
      <div className="panel">
        {deliverabilityStatus ? (
          <div className="summary-callout compact-callout">
            <span className={`pill ${deliverabilityStatus.className}`}>{deliverabilityStatus.label}</span>
          </div>
        ) : null}
        <div className="form-grid compact-form">
          <label>Domain<input value={form.domain} onChange={(event) => setForm({ ...form, domain: event.target.value })} placeholder="example.com" /></label>
          <label>DKIM<input value={form.dkimSelector} onChange={(event) => setForm({ ...form, dkimSelector: event.target.value })} placeholder="default" /></label>
          <label className="checkbox-row"><input type="checkbox" checked={form.warmupEnabled} onChange={(event) => setForm({ ...form, warmupEnabled: event.target.checked })} />Warmup</label>
          <button className="primary-button" type="button" onClick={analyze}>Analyze</button>
          {error ? <p className="error-text">{error}</p> : null}
        </div>
        <div className="generated-preview">
          <strong>Pre-Send Readiness</strong>
          <div className="form-grid">
            <label>Sending Domain<input value={preflightForm.sendingDomain} onChange={(event) => setPreflightForm({ ...preflightForm, sendingDomain: event.target.value })} placeholder="example.com" /></label>
            <label>Unsubscribe Email<input value={preflightForm.unsubscribeEmail} onChange={(event) => setPreflightForm({ ...preflightForm, unsubscribeEmail: event.target.value })} placeholder="unsubscribe@example.com" /></label>
            <label className="full-span">Unsubscribe URL<input value={preflightForm.unsubscribeUrl} onChange={(event) => setPreflightForm({ ...preflightForm, unsubscribeUrl: event.target.value })} placeholder="https://example.com/unsubscribe" /></label>
            <button className="ghost-button" type="button" onClick={runPreflight}>Run Preflight</button>
          </div>
          {preflight ? (
            <div className="list-stack compact-list">
              <p><strong>Score:</strong> {preflight.score}</p>
              <p><strong>Suppression Count:</strong> {preflight.suppressionCount}</p>
              {preflight.checks.map((check) => (
                <div className="list-row" key={check.label}>
                  <div>
                    <strong>{check.label}</strong>
                    <p>{check.note}</p>
                  </div>
                  <span className="pill">{check.ok ? 'Pass' : 'Review'}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <div className="panel">
        {report ? (
          <div className="report-stack">
            <div className="score-ring">
              <span>{report.score}</span>
            </div>
            <div className="list-stack compact-list">
              {report.findings.map((finding) => (
                <div className="list-row" key={finding}>
                  <p>{finding}</p>
                </div>
              ))}
            </div>
            <div className="generated-preview">
              <strong>DNS Results</strong>
              <p>MX: {report.dns.mxRecords.length ? report.dns.mxRecords.map((entry) => `${entry.exchange}:${entry.priority}`).join(', ') : 'None found'}</p>
              <p>SPF: {report.dns.spfRecords.length ? report.dns.spfRecords.join(' | ') : 'No SPF record found'}</p>
              <p>DMARC: {report.dns.dmarcRecords.length ? report.dns.dmarcRecords.join(' | ') : 'No DMARC record found'}</p>
              <p>DKIM: {report.dns.dkimRecords.length ? report.dns.dkimRecords.join(' | ') : 'No DKIM record found for selector'}</p>
            </div>
            <div className="list-stack compact-list">
              {report.accountChecks.map((account) => (
                <div className="list-row" key={account.email}>
                  <div>
                    <strong>{account.email}</strong>
                    <p>{account.host}:{account.port}</p>
                  </div>
                  <span className="pill">{account.hasCredentials ? 'Ready' : 'Missing credentials'}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export default DeliverabilityPage;
