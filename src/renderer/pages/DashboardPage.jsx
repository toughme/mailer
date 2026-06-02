import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { desktopInvoke } from '../api';
import Tooltip from '../components/Tooltip';

function DashboardPage() {
  const [summary, setSummary] = useState(null);
  const [sendStatus, setSendStatus] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      desktopInvoke('dashboard:get'),
      desktopInvoke('sends:global-status')
    ])
      .then(([dashboardData, statusData]) => {
        setSummary(dashboardData);
        setSendStatus(statusData);
      })
      .catch((loadError) => setError(loadError.message));
  }, []);

  const counts = summary?.counts || { accounts: 0, campaigns: 0, recipients: 0, segments: 0 };
  const delivery = summary?.delivery || sendStatus?.deliveryStats || {};

  return (
    <section className="page-grid">
      <div className="stats-grid">
        <article className="stat-card"><span>Accounts</span><strong>{counts.accounts}</strong></article>
        <article className="stat-card"><span>Sent</span><strong>{delivery.sent || 0}</strong></article>
        <article className="stat-card"><span>Failed</span><strong>{delivery.failed || 0}</strong></article>
        <article className="stat-card"><span>Queue</span><strong>{delivery.pending || 0}</strong></article>
        <article className="stat-card"><span>Fail rate</span><strong>{delivery.failureRate || 0}%</strong></article>
      </div>

      <div className="button-row dashboard-actions">
        <Tooltip label="Manage SMTP accounts">
          <Link className="primary-button" to="/accounts">Accounts</Link>
        </Tooltip>
        <Tooltip label="Create emails">
          <Link className="ghost-button" to="/campaigns">Emails</Link>
        </Tooltip>
        <Tooltip label="Send with rotation & delays">
          <Link className="primary-button" to="/send">Send</Link>
        </Tooltip>
      </div>

      {error ? <p className="error-text">{error}</p> : null}
      {summary?.recentCampaigns?.length ? (
        <div className="panel">
          <div className="list-stack">
            {summary.recentCampaigns.map((campaign) => (
              <div className="list-row" key={campaign.id}>
                <div>
                  <strong>{campaign.name}</strong>
                  <p>{campaign.scheduledAt || '—'}</p>
                </div>
                <span className={`pill pill-${campaign.status}`}>{campaign.status}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

export default DashboardPage;
