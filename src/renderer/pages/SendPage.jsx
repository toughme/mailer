import React, { useCallback, useEffect, useState } from 'react';
import { desktopInvoke } from '../api';
import Tooltip from '../components/Tooltip';

function formatDelay(ms) {
  if (ms >= 60000) {
    return `${Math.round(ms / 60000)}m`;
  }
  return `${Math.round(ms / 1000)}s`;
}

function SendPage() {
  const [settings, setSettings] = useState(null);
  const [providerPresets, setProviderPresets] = useState([]);
  const [globalStatus, setGlobalStatus] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [preflightMap, setPreflightMap] = useState({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [addressSuggestions, setAddressSuggestions] = useState([]);

  const refresh = useCallback(async () => {
    try {
      const [settingsData, statusData, campaignRows, presets] = await Promise.all([
        desktopInvoke('sends:settings-get'),
        desktopInvoke('sends:global-status'),
        desktopInvoke('campaigns:list'),
        desktopInvoke('sends:provider-presets')
      ]);
      setSettings((current) => (settingsDirty && current ? current : settingsData));
      setGlobalStatus(statusData);
      setCampaigns(campaignRows);
      setProviderPresets(presets);
      setError('');
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [settingsDirty]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 4000);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    const handler = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        if (settings && settingsDirty) {
          saveSettings(settings);
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [settings, settingsDirty]);

  async function saveSettings(patch) {
    setSaving(true);
    try {
      const updated = await desktopInvoke('sends:settings-update', patch);
      setSettings(updated);
      setSettingsDirty(false);
      setError('');
      await refresh();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  function updateSettingsDraft(patch) {
    setSettings((current) => ({ ...current, ...patch }));
    setSettingsDirty(true);
  }

  async function loadAddressSuggestions(query) {
    try {
      setAddressSuggestions(await desktopInvoke('sends:address-suggestions', { query }));
    } catch {
      setAddressSuggestions([]);
    }
  }

  async function applyProviderPreset(presetId) {
    const preset = providerPresets.find((item) => item.id === presetId);
    if (!preset || !settings) {
      return;
    }
    await saveSettings({
      delayMinMs: preset.delayMinMs,
      delayMaxMs: preset.delayMaxMs,
      dailyCapPerAccount: preset.dailyCapPerAccount,
      jitterPercent: preset.jitterPercent
    });
  }

  async function runPreflight(campaignId) {
    const result = await desktopInvoke('sends:preflight', { campaignId });
    setPreflightMap((current) => ({ ...current, [campaignId]: result }));
    return result;
  }

  async function startCampaign(id) {
    try {
      const preflight = await runPreflight(id);
      if (!preflight.canSend) {
        setError(preflight.errors.join(' '));
        return;
      }
      await desktopInvoke('sends:start-campaign', { campaignId: id });
      await refresh();
      setCampaigns(await desktopInvoke('campaigns:list'));
      setError('');
    } catch (startError) {
      setError(startError.message);
    }
  }

  async function pauseCampaign(id) {
    try {
      await desktopInvoke('sends:pause-campaign', { campaignId: id });
      await desktopInvoke('campaigns:update-status', { id, status: 'paused' });
      await refresh();
    } catch (pauseError) {
      setError(pauseError.message);
    }
  }

  async function resumeCampaign(id) {
    try {
      await desktopInvoke('sends:resume-campaign', { campaignId: id });
      await refresh();
    } catch (resumeError) {
      setError(resumeError.message);
    }
  }

  const breakdown = globalStatus?.breakdown || {};
  const accountHealth = globalStatus?.accountHealth || [];
  const recentLog = globalStatus?.recentLog || [];
  const readyAccounts = accountHealth.filter((item) => item.status === 'ready').length;
  const deliveryStats = globalStatus?.deliveryStats || {};

  return (
    <section className="send-workspace">
      <div className="send-stats-row">
        <article className="stat-card compact">
          <span>Queue</span>
          <strong>{(breakdown.pending || 0) + (breakdown.sending || 0)}</strong>
        </article>
        <article className="stat-card compact">
          <span>Sent</span>
          <strong>{breakdown.sent || 0}</strong>
        </article>
        <article className="stat-card compact">
          <span>Failed</span>
          <strong>{breakdown.failed || 0}</strong>
        </article>
        <article className="stat-card compact">
          <span>Fail %</span>
          <strong>{deliveryStats.failureRate || 0}%</strong>
        </article>
        <article className="stat-card compact">
          <span>Ready</span>
          <strong>{readyAccounts}/{accountHealth.length}</strong>
        </article>
        <article className="stat-card compact">
          <span>Worker</span>
          <strong className={globalStatus?.processing ? 'status-live' : 'status-idle'}>
            {globalStatus?.workerPaused ? 'Paused' : globalStatus?.processing ? 'On' : 'Idle'}
          </strong>
        </article>
      </div>

      <div className="two-column-grid send-grid">
        <div className="panel send-settings-panel">
          <div className="panel-toolbar send-preset-row">
            {providerPresets.map((preset) => (
              <Tooltip key={preset.id} label={`${preset.label}: ${formatDelay(preset.delayMinMs)}–${formatDelay(preset.delayMaxMs)}, cap ${preset.dailyCapPerAccount}/day`}>
                <button
                  className="ghost-button sm"
                  type="button"
                  disabled={saving}
                  onClick={() => applyProviderPreset(preset.id)}
                >
                  {preset.label}
                </button>
              </Tooltip>
            ))}
          </div>

          {settings ? (
            <div className="send-settings-form">
              <label className="field-inline">
                <span>Min delay</span>
                <input type="number" min="5" value={Math.round(settings.delayMinMs / 1000)} onChange={(event) => updateSettingsDraft({ delayMinMs: Number(event.target.value) * 1000 })} />
              </label>
              <label className="field-inline">
                <span>Max delay</span>
                <input type="number" min="10" value={Math.round(settings.delayMaxMs / 1000)} onChange={(event) => updateSettingsDraft({ delayMaxMs: Number(event.target.value) * 1000 })} />
              </label>
              <label className="field-inline">
                <span>Daily cap</span>
                <input type="number" min="1" max="10000" value={settings.dailyCapPerAccount} onChange={(event) => updateSettingsDraft({ dailyCapPerAccount: Number(event.target.value) })} />
              </label>
              <label className="field-inline">
                <span>Rotation</span>
                <select value={settings.rotationMode} onChange={(event) => updateSettingsDraft({ rotationMode: event.target.value })}>
                  <option value="reputation">Reputation</option>
                  <option value="round_robin">Round robin</option>
                  <option value="random">Random</option>
                </select>
              </label>
              <label className="field-inline">
                <span>Min spam</span>
                <input type="number" min="0" max="95" value={settings.minSpamScore} onChange={(event) => updateSettingsDraft({ minSpamScore: Number(event.target.value) })} />
              </label>
              <label className="field-inline full-span">
                <span>Physical address</span>
                <input
                  value={settings.physicalAddress}
                  onFocus={() => loadAddressSuggestions(settings.physicalAddress)}
                  onChange={(event) => {
                    updateSettingsDraft({ physicalAddress: event.target.value });
                    loadAddressSuggestions(event.target.value);
                  }}
                  placeholder="123 Main St, City"
                />
                {addressSuggestions.length ? (
                  <div className="address-suggestion-list">
                    {addressSuggestions.map((address) => (
                      <button
                        key={address}
                        type="button"
                        onClick={() => {
                          updateSettingsDraft({ physicalAddress: address });
                          setAddressSuggestions([]);
                        }}
                      >
                        {address}
                      </button>
                    ))}
                  </div>
                ) : null}
              </label>
        <label className="checkbox-row compact-check">
          <input type="checkbox" checked={settings.warmupEnabled} onChange={(event) => updateSettingsDraft({ warmupEnabled: event.target.checked })} />
          Warmup ramp
        </label>
        <label className="checkbox-row compact-check">
          <input type="checkbox" checked={settings.requireDns} onChange={(event) => updateSettingsDraft({ requireDns: event.target.checked })} />
          Require DNS auth
        </label>
        {settings.requireDns ? (
          <div className="dns-check-group">
            <label className="checkbox-row compact-check">
              <input type="checkbox" checked={settings.dnsRequireSpf} onChange={(event) => updateSettingsDraft({ dnsRequireSpf: event.target.checked })} />
              SPF
            </label>
            <label className="checkbox-row compact-check">
              <input type="checkbox" checked={settings.dnsRequireDkim} onChange={(event) => updateSettingsDraft({ dnsRequireDkim: event.target.checked })} />
              DKIM
            </label>
            <label className="checkbox-row compact-check">
              <input type="checkbox" checked={settings.dnsRequireDmarc} onChange={(event) => updateSettingsDraft({ dnsRequireDmarc: event.target.checked })} />
              DMARC
            </label>
          </div>
        ) : null}
        <label className="field-inline">
          <span>Max retries</span>
          <input type="number" min="0" max="5" value={settings.maxRetries} onChange={(event) => updateSettingsDraft({ maxRetries: Number(event.target.value) })} />
        </label>
        <label className="field-inline">
          <span>Jitter %</span>
          <input type="number" min="0" max="50" value={settings.jitterPercent} onChange={(event) => updateSettingsDraft({ jitterPercent: Number(event.target.value) })} />
        </label>
<label className="checkbox-row compact-check">
<input type="checkbox" checked={settings.shuffleRecipients} onChange={(event) => updateSettingsDraft({ shuffleRecipients: event.target.checked })} />
Shuffle recipients
</label>
<label className="field-inline">
<span>Pause after N fails</span>
<input type="number" min="3" max="20" value={settings.failurePauseThreshold} onChange={(event) => updateSettingsDraft({ failurePauseThreshold: Number(event.target.value) })} />
</label>
{(() => {
const dailyCap = settings.dailyCapPerAccount || 100;
const usedPct = accountHealth.length ? Math.round((accountHealth.reduce((sum, a) => sum + (a.sendsToday || 0), 0) / (accountHealth.length * dailyCap)) * 100) : 0;
const gaugeColor = usedPct > 80 ? '#ef4444' : usedPct > 50 ? '#f59e0b' : '#10b981';
return (
<div className="throttle-gauge">
<div className="throttle-gauge-label">
<span>Daily send utilization</span>
<span>{usedPct}%</span>
</div>
<div className="throttle-gauge-bar">
<div className="throttle-gauge-fill" style={{ width: `${Math.min(usedPct, 100)}%`, background: gaugeColor }} />
</div>
</div>
);
})()}
<div className="button-row">
                <Tooltip label="Save send settings">
                  <button className="primary-button sm" type="button" disabled={saving} onClick={() => saveSettings(settings)}>Apply</button>
                </Tooltip>
              </div>
            </div>
          ) : null}
        </div>

        <div className="panel send-accounts-panel">
          <div className="list-stack compact-list">
            {accountHealth.map((account) => (
              <div className="send-account-row" key={account.id}>
                <div>
                  <strong>{account.email}</strong>
                  <span className="muted-copy">{account.sendsToday}/{account.dailyCap} · rep {account.reputationScore || 0} · {account.totalSent} total</span>
                </div>
                <span className={`pill pill-${account.status}`}>{account.status}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="panel send-log-panel">
        <div className="send-log-list">
          {recentLog.length === 0 ? <span className="muted-copy">No sends yet</span> : null}
          {recentLog.map((entry) => (
            <div className="send-log-row" key={entry.id}>
              <span className={`pill pill-${entry.status}`}>{entry.status}</span>
              <span className="log-email">{entry.recipientEmail}</span>
              <span className="muted-copy">{entry.accountEmail || '—'}</span>
              <span className="muted-copy">{entry.lastError || entry.sentAt || ''}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="panel send-campaigns-panel">
        <div className="list-stack">
          {campaigns.map((campaign) => {
            const metrics = campaign.metrics || {};
            const total = (metrics.sent || 0) + (metrics.failed || 0) + (metrics.pending || 0);
            const progress = total ? Math.round(((metrics.sent || 0) / total) * 100) : 0;
            const preflight = preflightMap[campaign.id];

            return (
              <div className="send-campaign-row" key={campaign.id}>
                <div className="send-campaign-main">
                  <strong>{campaign.name}</strong>
                  <span className="muted-copy">{campaign.subject}</span>
                  {preflight ? (
                    <span className={`spam-grade-pill tone-${preflight.spamTone}`}>
                      {preflight.spamScore} · {preflight.spamGrade} {preflight.canSend ? '' : '· blocked'}
                    </span>
                  ) : null}
                  {total > 0 ? (
                    <div className="progress-bar">
                      <div className="progress-fill" style={{ width: `${progress}%` }} />
                    </div>
                  ) : null}
                  <span className="muted-copy send-metrics">
                    {metrics.sent || 0} sent · {metrics.pending || 0} pending · {metrics.failed || 0} failed
                  </span>
                </div>
                <span className={`pill pill-${campaign.status}`}>{campaign.status}</span>
                <div className="button-row">
                  <Tooltip label="Scan spam score and DNS before send">
                    <button className="ghost-button sm" type="button" onClick={() => runPreflight(campaign.id).catch((e) => setError(e.message))}>Scan</button>
                  </Tooltip>
                  {['draft', 'scheduled', 'paused', 'completed'].includes(campaign.status) ? (
                    <Tooltip label="Preflight check then send">
                      <button className="primary-button sm" type="button" onClick={() => startCampaign(campaign.id)}>Send</button>
                    </Tooltip>
                  ) : null}
                  {campaign.status === 'active' ? (
                    <Tooltip label="Pause queue">
                      <button className="ghost-button sm" type="button" onClick={() => pauseCampaign(campaign.id)}>Pause</button>
                    </Tooltip>
                  ) : null}
                  {campaign.status === 'paused' ? (
                    <Tooltip label="Resume">
                      <button className="ghost-button sm" type="button" onClick={() => resumeCampaign(campaign.id)}>Resume</button>
                    </Tooltip>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
        {error ? <p className="error-text">{error}</p> : null}
      </div>
    </section>
  );
}

export default SendPage;
