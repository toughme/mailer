import React, { useEffect, useRef, useState } from 'react';
import { desktopInvoke } from '../api';
import Tooltip from '../components/Tooltip';
import ProcessModal from '../components/ProcessModal';
import useProcess from '../hooks/useProcess';

const initialForm = {
  name: '',
  subject: '',
  subjectB: '',
  previewText: '',
  content: '',
  contentB: '',
  abEnabled: false,
  splitRatio: 50,
  segmentId: '',
  recipientIds: [],
  useIndividualRecipients: false,
  scheduledAt: ''
};

function CampaignsPage() {
  const [campaigns, setCampaigns] = useState([]);
  const [campaignStatusMap, setCampaignStatusMap] = useState({});
  const [segments, setSegments] = useState([]);
  const [recipients, setRecipients] = useState([]);
  const [contentDocuments, setContentDocuments] = useState([]);
  const [selectedContentId, setSelectedContentId] = useState('');
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState('');
  const [scanMap, setScanMap] = useState({});
  const [showRecipientPicker, setShowRecipientPicker] = useState(false);
  const [recipientSearch, setRecipientSearch] = useState('');
  const [editingCampaignId, setEditingCampaignId] = useState(null);
  const formPanelRef = useRef(null);
  const { process, startProcess, updateProcess, completeProcess, cancelProcess } = useProcess();

  const filteredRecipients = recipients.filter((r) => {
    const query = recipientSearch.toLowerCase();
    return r.email.toLowerCase().includes(query) || r.name.toLowerCase().includes(query);
  });

  async function refreshCampaignStatuses(campaignRows) {
    const candidates = campaignRows.filter((campaign) => {
      const metrics = campaign.metrics || {};
      return campaign.status === 'active' || campaign.status === 'paused' || (metrics.pending || metrics.sent || metrics.failed);
    });

    if (!candidates.length) {
      setCampaignStatusMap({});
      return;
    }

    const statusEntries = await Promise.all(
      candidates.map(async (campaign) => {
        const status = await desktopInvoke('sends:campaign-status', { campaignId: campaign.id });
        return [campaign.id, status];
      })
    );

    setCampaignStatusMap(Object.fromEntries(statusEntries.filter(([, status]) => status)));
  }

  async function refresh() {
    try {
      const [campaignRows, segmentRows, contentRows, recipientRows] = await Promise.all([
        desktopInvoke('campaigns:list'),
        desktopInvoke('segments:list'),
        desktopInvoke('content:list-documents'),
        desktopInvoke('recipients:list')
      ]);
      setCampaigns(campaignRows);
      setSegments(segmentRows);
      setContentDocuments(contentRows);
      setRecipients(recipientRows);
      await refreshCampaignStatuses(campaignRows);
      setError('');
    } catch (loadError) {
      setError(loadError.message);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    const hasActiveWork = campaigns.some((campaign) => {
      const liveStatus = campaignStatusMap[campaign.id];
      const metrics = liveStatus?.metrics || campaign.metrics || {};
      const status = liveStatus?.status || campaign.status;
      return status === 'active' || metrics.pending > 0;
    });

    if (!hasActiveWork) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      refresh();
    }, 4000);

    return () => window.clearInterval(timer);
  }, [campaigns, campaignStatusMap]);

  function importFromContentStudio() {
    const selectedDocument = contentDocuments.find((item) => String(item.id) === String(selectedContentId));
    if (!selectedDocument) {
      setError('Select content first.');
      return;
    }

    setForm((current) => ({
      ...current,
      name: current.name || selectedDocument.name,
      subject: selectedDocument.subject || current.subject,
      previewText: selectedDocument.previewText || current.previewText,
      content: selectedDocument.contentHtml || selectedDocument.editorHtml || current.content
    }));
    setError('');
  }

  async function handleSubmit(event) {
    event.preventDefault();
    try {
      let nextCampaigns;
      if (editingCampaignId) {
        nextCampaigns = await desktopInvoke('campaigns:update', { ...form, id: editingCampaignId });
        setEditingCampaignId(null);
      } else {
        nextCampaigns = await desktopInvoke('campaigns:create', form);
      }
      setCampaigns(nextCampaigns);
      await refreshCampaignStatuses(nextCampaigns);
      setForm(initialForm);
      setError('');
    } catch (submitError) {
      setError(submitError.message);
    }
  }

  function editCampaign(campaign) {
    setForm({
      name: campaign.name,
      subject: campaign.subject,
      subjectB: campaign.subjectB,
      previewText: campaign.previewText,
      content: campaign.content,
      contentB: campaign.contentB,
      abEnabled: campaign.abEnabled,
      splitRatio: campaign.splitRatio,
      segmentId: campaign.segmentId || '',
      recipientIds: campaign.recipientIds || [],
      useIndividualRecipients: campaign.useIndividualRecipients,
      scheduledAt: campaign.scheduledAt || ''
    });
    setEditingCampaignId(campaign.id);
    
    // Scroll to form when editing
    if (formPanelRef.current) {
      setTimeout(() => {
        formPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 50);
    }
  }

  function cancelEdit() {
    setForm(initialForm);
    setEditingCampaignId(null);
    setError('');
  }

  async function deleteCampaign(id) {
    if (!window.confirm('Delete this campaign?')) {
      return;
    }
    try {
      const nextCampaigns = await desktopInvoke('campaigns:delete', { id });
      setCampaigns(nextCampaigns);
      await refreshCampaignStatuses(nextCampaigns);
      setError('');
    } catch (deleteError) {
      setError(deleteError.message);
    }
  }

  async function scanCampaign(id) {
    try {
      startProcess('Scanning Campaign', { message: 'Running spam score and DNS checks...' });
      const result = await desktopInvoke('sends:preflight', { campaignId: id });
      completeProcess('Scan completed');
      setScanMap((current) => ({ ...current, [id]: result }));
      return result;
    } catch (scanError) {
      completeProcess('Scan failed');
      throw scanError;
    }
  }

  async function scanAllCampaigns() {
    const candidates = campaigns.filter((campaign) => ['draft', 'scheduled', 'paused'].includes(campaign.status));
    if (!candidates.length) {
      setError('No draft, scheduled, or paused campaigns are available to scan.');
      return;
    }

    startProcess('Scanning Campaigns', {
      message: `Scanning 1 of ${candidates.length}`,
      progress: 0,
      total: candidates.length
    });

    const nextMap = {};
    for (let index = 0; index < candidates.length; index += 1) {
      const campaign = candidates[index];
      updateProcess({
        message: `Scanning ${campaign.name} (${index + 1} of ${candidates.length})`,
        progress: index,
        total: candidates.length
      });
      try {
        nextMap[campaign.id] = await desktopInvoke('sends:preflight', { campaignId: campaign.id });
        setScanMap((current) => ({ ...current, [campaign.id]: nextMap[campaign.id] }));
      } catch (scanError) {
        nextMap[campaign.id] = { canSend: false, errors: [scanError.message], spamScore: 0, spamGrade: 'Error', spamTone: 'danger' };
        setScanMap((current) => ({ ...current, [campaign.id]: nextMap[campaign.id] }));
      }
    }

    const blocked = Object.values(nextMap).filter((scan) => !scan.canSend).length;
    completeProcess(`Scanned ${candidates.length} campaigns`);
    setError(blocked ? `${blocked} campaign(s) need fixes before sending.` : '');
  }

  async function moveTo(status, id) {
    try {
      if (status === 'active') {
        const preflight = await desktopInvoke('sends:preflight', { campaignId: id });
        if (!preflight.canSend) {
          setError(preflight.errors.join(' '));
          setScanMap((current) => ({ ...current, [id]: preflight }));
          return;
        }
        await desktopInvoke('sends:start-campaign', { campaignId: id });
        await refresh();
        setError('');
        return;
      }
      const nextCampaigns = await desktopInvoke('campaigns:update-status', { id, status });
      setCampaigns(nextCampaigns);
      await refreshCampaignStatuses(nextCampaigns);
      setError('');
    } catch (updateError) {
      setError(updateError.message);
    }
  }

  async function handleSendNow(id) {
    try {
      startProcess('Sending Campaign', { message: 'Preparing campaign for immediate send...' });
      await desktopInvoke('sends:send-now', { campaignId: id });
      completeProcess('Campaign queued and sending started');
      await refresh();
      setError('');
    } catch (sendError) {
      completeProcess('Send failed');
      setError(sendError.message);
    }
  }

  function renderCampaignActions(campaign) {
    const { status, id } = campaign;
    const scan = scanMap[id];
    if (status === 'draft') {
      return (
        <>
          <Tooltip label="Edit campaign">
            <button className="ghost-button sm" type="button" onClick={() => editCampaign(campaign)}>Edit</button>
          </Tooltip>
          <Tooltip label="Delete campaign">
            <button className="ghost-button sm" type="button" onClick={() => deleteCampaign(id)}>Delete</button>
          </Tooltip>
          <Tooltip label="Spam + DNS scan">
            <button className="ghost-button sm" type="button" onClick={() => scanCampaign(id).catch((e) => setError(e.message))}>Scan</button>
          </Tooltip>
          <Tooltip label="Schedule for later">
            <button className="ghost-button sm" type="button" onClick={() => moveTo('scheduled', id)}>Schedule</button>
          </Tooltip>
          <Tooltip label={scan && !scan.canSend ? scan.errors[0] : 'Preflight check then send'}>
            <button className="primary-button sm" type="button" onClick={() => moveTo('active', id)}>Send</button>
          </Tooltip>
        </>
      );
    }

    if (status === 'scheduled') {
      return (
        <>
          <Tooltip label="Edit campaign">
            <button className="ghost-button sm" type="button" onClick={() => editCampaign(campaign)}>Edit</button>
          </Tooltip>
          <Tooltip label="Delete campaign">
            <button className="ghost-button sm" type="button" onClick={() => deleteCampaign(id)}>Delete</button>
          </Tooltip>
          <Tooltip label="Spam + DNS scan">
            <button className="ghost-button sm" type="button" onClick={() => scanCampaign(id).catch((e) => setError(e.message))}>Scan</button>
          </Tooltip>
          <Tooltip label="Return to draft">
            <button className="ghost-button sm" type="button" onClick={() => moveTo('draft', id)}>Draft</button>
          </Tooltip>
          <Tooltip label="Send immediately without waiting for scheduled time">
            <button className="primary-button sm" type="button" onClick={() => handleSendNow(id)}>Send Now</button>
          </Tooltip>
          <Tooltip label="Keep scheduled - send at appointed time">
            <button className="ghost-button sm" type="button" onClick={() => moveTo('active', id)}>Activate</button>
          </Tooltip>
        </>
      );
    }

    if (status === 'active') {
      return (
        <>
          <Tooltip label="Edit campaign">
            <button className="ghost-button sm" type="button" onClick={() => editCampaign(campaign)}>Edit</button>
          </Tooltip>
          <Tooltip label="Delete campaign">
            <button className="ghost-button sm" type="button" onClick={() => deleteCampaign(id)}>Delete</button>
          </Tooltip>
          <Tooltip label="Pause sending">
            <button className="ghost-button sm" type="button" onClick={() => moveTo('paused', id)}>Pause</button>
          </Tooltip>
        </>
      );
    }

    if (status === 'paused') {
      return (
        <>
          <Tooltip label="Edit campaign">
            <button className="ghost-button sm" type="button" onClick={() => editCampaign(campaign)}>Edit</button>
          </Tooltip>
          <Tooltip label="Delete campaign">
            <button className="ghost-button sm" type="button" onClick={() => deleteCampaign(id)}>Delete</button>
          </Tooltip>
          <Tooltip label="Resume sending">
            <button className="primary-button sm" type="button" onClick={() => desktopInvoke('sends:resume-campaign', { campaignId: id }).then(refresh)}>Resume</button>
          </Tooltip>
        </>
      );
    }

    if (status === 'completed') {
      return (
        <>
          <Tooltip label="Edit campaign">
            <button className="ghost-button sm" type="button" onClick={() => editCampaign(campaign)}>Edit</button>
          </Tooltip>
          <Tooltip label="Delete campaign">
            <button className="ghost-button sm" type="button" onClick={() => deleteCampaign(id)}>Delete</button>
          </Tooltip>
        </>
      );
    }

    return null;
  }

  return (
    <>
    <section className="two-column-grid">
      <div className="panel campaign-panel" ref={formPanelRef}>
        <div className="panel-toolbar">
          <select value={selectedContentId} onChange={(event) => setSelectedContentId(event.target.value)} aria-label="Content">
            <option value="">Content</option>
            {contentDocuments.map((documentRow) => (
              <option key={documentRow.id} value={documentRow.id}>{documentRow.name}</option>
            ))}
          </select>
          <Tooltip label="Import saved content">
            <button className="ghost-button sm" type="button" onClick={importFromContentStudio}>Import</button>
          </Tooltip>
        </div>

        <form className="account-form compact-form" onSubmit={handleSubmit}>
          <div className="section-grid">
            <label>
              Name
              <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </label>
            <label>
              Subject
              <input value={form.subject} onChange={(event) => setForm({ ...form, subject: event.target.value })} />
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={form.abEnabled} onChange={(event) => setForm({ ...form, abEnabled: event.target.checked })} />
              A/B
            </label>
            <label className="full-span">
              Preview
              <input value={form.previewText} onChange={(event) => setForm({ ...form, previewText: event.target.value })} />
            </label>
            <label className="full-span">
              Body
              <textarea rows="8" value={form.content} onChange={(event) => setForm({ ...form, content: event.target.value })} />
            </label>
          </div>
          {form.abEnabled ? (
            <div className="section-grid">
              <label>
                Subject B
                <input value={form.subjectB} onChange={(event) => setForm({ ...form, subjectB: event.target.value })} />
              </label>
              <label>
                Split %
                <input type="number" min="10" max="90" value={form.splitRatio} onChange={(event) => setForm({ ...form, splitRatio: Number(event.target.value) })} />
              </label>
              <label className="full-span">
                Body B
                <textarea rows="6" value={form.contentB} onChange={(event) => setForm({ ...form, contentB: event.target.value })} />
              </label>
            </div>
          ) : null}
          <div className="section-grid">
            <label>
              Targeting
              <select 
                value={form.useIndividualRecipients ? 'individual' : 'segment'} 
                onChange={(event) => {
                  const useIndividual = event.target.value === 'individual';
                  setForm({ 
                    ...form, 
                    useIndividualRecipients: useIndividual,
                    segmentId: useIndividual ? '' : form.segmentId,
                    recipientIds: useIndividual ? form.recipientIds : []
                  });
                }}
              >
                <option value="segment">Segment or All</option>
                <option value="individual">Individual Recipients</option>
              </select>
            </label>
            {form.useIndividualRecipients ? (
              <button 
                className="primary-button sm" 
                type="button" 
                onClick={() => setShowRecipientPicker(!showRecipientPicker)}
              >
                {form.recipientIds.length > 0 ? `${form.recipientIds.length} Selected` : 'Select Recipients'}
              </button>
            ) : (
              <label>
                Segment
                <select value={form.segmentId} onChange={(event) => setForm({ ...form, segmentId: event.target.value })}>
                  <option value="">All</option>
                  {segments.map((segment) => (
                    <option key={segment.id} value={segment.id}>{segment.name}</option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Schedule
              <input type="datetime-local" value={form.scheduledAt} onChange={(event) => setForm({ ...form, scheduledAt: event.target.value })} />
            </label>
          </div>
          {showRecipientPicker && form.useIndividualRecipients && (
            <div className="section-grid" style={{ border: '1px solid rgba(255,255,255,0.1)', padding: '12px', borderRadius: '4px', marginBottom: '12px' }}>
              <input 
                type="text"
                placeholder="Search recipients..."
                value={recipientSearch}
                onChange={(event) => setRecipientSearch(event.target.value)}
                className="full-span"
              />
              <div style={{ maxHeight: '300px', overflowY: 'auto', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '4px', padding: '8px' }}>
                {filteredRecipients.map((recipient) => (
                  <label key={recipient.id} style={{ display: 'block', padding: '6px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={form.recipientIds.includes(recipient.id)}
                      onChange={(event) => {
                        if (event.target.checked) {
                          setForm({ ...form, recipientIds: [...form.recipientIds, recipient.id] });
                        } else {
                          setForm({ ...form, recipientIds: form.recipientIds.filter((id) => id !== recipient.id) });
                        }
                      }}
                    />
                    {' '}{recipient.email} {recipient.name ? `(${recipient.name})` : ''}
                  </label>
                ))}
                {filteredRecipients.length === 0 && <p style={{ padding: '6px', color: 'rgba(255,255,255,0.5)' }}>No recipients found</p>}
              </div>
            </div>
          )}
          <div className="button-row">
            <Tooltip label="Save campaign">
              <button className="primary-button" type="submit">{editingCampaignId ? 'Update' : 'Save'}</button>
            </Tooltip>
            {editingCampaignId && (
              <Tooltip label="Cancel editing">
                <button className="ghost-button" type="button" onClick={cancelEdit}>Cancel</button>
              </Tooltip>
            )}
          </div>
          {editingCampaignId && <p style={{ color: 'rgba(255,165,0,0.8)', fontSize: '0.9em', margin: '8px 0 0 0' }}>Editing campaign...</p>}
          {error ? <p className="error-text">{error}</p> : null}
        </form>
      </div>

      <div className="panel campaign-summary-panel">
        <div className="panel-toolbar account-summary-toolbar">
          <div>
            <strong>Campaigns</strong>
            <p className="muted-copy">Preflight status and send controls.</p>
          </div>
          <Tooltip label="Scan every draft, scheduled, and paused campaign">
            <button className="primary-button sm" type="button" onClick={scanAllCampaigns}>Scan All</button>
          </Tooltip>
        </div>
        <div className="list-stack">
          {campaigns.map((campaign) => (
            <div className="campaign-card compact" key={campaign.id}>
              {(() => {
                const liveStatus = campaignStatusMap[campaign.id];
                const effectiveStatus = liveStatus?.status || campaign.status;
                const effectiveMetrics = liveStatus?.metrics || campaign.metrics || { sent: 0, pending: 0, failed: 0 };
                const total = (effectiveMetrics.sent || 0) + (effectiveMetrics.pending || 0) + (effectiveMetrics.failed || 0);
                const sendingNow = liveStatus?.breakdown?.sending || 0;
                const campaignView = {
                  ...campaign,
                  status: effectiveStatus,
                  metrics: effectiveMetrics
                };

                return (
                  <>
              <div className="campaign-head">
                <div>
                  <strong>{campaign.name}</strong>
                  <p>{campaign.subject}</p>
                  {campaign.useIndividualRecipients ? (
                    <p style={{ fontSize: '0.85em', color: 'rgba(255,255,255,0.6)', marginTop: '4px' }}>
                      {campaign.recipientIds.length} recipients selected
                    </p>
                  ) : campaign.segmentName ? (
                    <p style={{ fontSize: '0.85em', color: 'rgba(255,255,255,0.6)', marginTop: '4px' }}>
                      Segment: {campaign.segmentName}
                    </p>
                  ) : (
                    <p style={{ fontSize: '0.85em', color: 'rgba(255,255,255,0.6)', marginTop: '4px' }}>
                      All recipients
                    </p>
                  )}
                </div>
                <span className={`pill pill-${effectiveStatus}`}>{effectiveStatus}</span>
              </div>
              {scanMap[campaign.id] ? (
                <span className={`spam-grade-pill tone-${scanMap[campaign.id].spamTone}`}>
                  {scanMap[campaign.id].spamScore} · {scanMap[campaign.id].spamGrade}
                </span>
              ) : null}
              {total ? (
                <p className="muted-copy send-metrics">
                  {effectiveMetrics.sent || 0} / {total}
                </p>
              ) : null}
              {sendingNow ? (
                <p className="muted-copy send-metrics">
                  Sending now: {sendingNow} | Pending: {liveStatus?.breakdown?.pending || 0} | Failed: {effectiveMetrics.failed || 0}
                </p>
              ) : null}
              <div className="button-row campaign-actions">
                {renderCampaignActions(campaignView)}
              </div>
                  </>
                );
              })()}
            </div>
          ))}
        </div>
      </div>
    </section>
    {process && (
      <ProcessModal
        isOpen={process.isOpen}
        title={process.title}
        message={process.message}
        progress={process.progress}
        total={process.total}
        onCancel={cancelProcess}
      />
    )}
    </>
  );
}

export default CampaignsPage;
