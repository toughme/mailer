import React, { useEffect, useMemo, useState } from 'react';
import { desktopInvoke } from '../api';

const recipientInitial = { email: '', name: '', category: '', tags: '', status: 'active' };
const segmentInitial = { name: '', description: '', tagIncludes: '', status: '' };

function AudiencePage() {
  const [recipients, setRecipients] = useState([]);
  const [segments, setSegments] = useState([]);
  const [preview, setPreview] = useState([]);
  const [recipientForm, setRecipientForm] = useState(recipientInitial);
  const [segmentForm, setSegmentForm] = useState(segmentInitial);
  const [searchText, setSearchText] = useState('');
  const [csvText, setCsvText] = useState('');
  const [exportText, setExportText] = useState('');
  const [error, setError] = useState('');
  const [selectedRecipients, setSelectedRecipients] = useState(new Set());
  const [selectedSegments, setSelectedSegments] = useState(new Set());

  const filteredRecipients = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    if (!query) {
      return recipients;
    }

    return recipients.filter((recipient) => {
      const name = String(recipient.name || '').toLowerCase();
      const email = String(recipient.email || '').toLowerCase();
      const tags = Array.isArray(recipient.tags) ? recipient.tags.join(' ') : String(recipient.tags || '');
      return name.includes(query) || email.includes(query) || tags.toLowerCase().includes(query);
    });
  }, [recipients, searchText]);

  const duplicateRecipientIds = useMemo(() => {
    const emailMap = new Map();
    recipients.forEach((recipient) => {
      const email = String(recipient.email || '').trim().toLowerCase();
      if (!email) {
        return;
      }
      emailMap.set(email, [...(emailMap.get(email) || []), recipient.id]);
    });

    return new Set(
      Array.from(emailMap.values())
        .filter((ids) => ids.length > 1)
        .flat()
    );
  }, [recipients]);

  async function refresh() {
    try {
      const [recipientRows, segmentRows] = await Promise.all([
        desktopInvoke('recipients:list'),
        desktopInvoke('segments:list')
      ]);
      setRecipients(recipientRows);
      setSegments(segmentRows);
      setSelectedRecipients(new Set());
      setSelectedSegments(new Set());
      setError('');
    } catch (loadError) {
      setError(loadError.message);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function addRecipient(event) {
    event.preventDefault();
    try {
      setRecipients(await desktopInvoke('recipients:create', recipientForm));
      setRecipientForm(recipientInitial);
      setError('');
    } catch (submitError) {
      setError(submitError.message);
    }
  }

  async function addSegment(event) {
    event.preventDefault();
    try {
      const payload = {
        name: segmentForm.name,
        description: segmentForm.description,
        filters: {
          tagIncludes: segmentForm.tagIncludes,
          status: segmentForm.status
        }
      };
      setSegments(await desktopInvoke('segments:create', payload));
      setSegmentForm(segmentInitial);
      setError('');
    } catch (submitError) {
      setError(submitError.message);
    }
  }

  async function previewSegment() {
    try {
      const data = await desktopInvoke('segments:preview', {
        tagIncludes: segmentForm.tagIncludes,
        status: segmentForm.status
      });
      setPreview(data);
    } catch (previewError) {
      setError(previewError.message);
    }
  }

  async function importCsv() {
    try {
      setRecipients(await desktopInvoke('recipients:import-csv', { csvText }));
      setError('');
    } catch (importError) {
      setError(importError.message);
    }
  }

  async function importCsvFile() {
    try {
      setRecipients(await desktopInvoke('recipients:import-csv-file'));
      setError('');
    } catch (importError) {
      setError(importError.message);
    }
  }

  async function exportCsv() {
    try {
      setExportText(await desktopInvoke('recipients:export-csv'));
      setError('');
    } catch (exportError) {
      setError(exportError.message);
    }
  }

  function toggleRecipientSelection(id) {
    const newSet = new Set(selectedRecipients);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedRecipients(newSet);
  }

  function toggleSelectAllRecipients() {
    if (selectedRecipients.size === filteredRecipients.length) {
      setSelectedRecipients(new Set());
    } else {
      setSelectedRecipients(new Set(filteredRecipients.map((r) => r.id)));
    }
  }

  function selectDuplicateRecipients() {
    if (!duplicateRecipientIds.size) {
      setError('No duplicate recipient emails found.');
      return;
    }

    setSelectedRecipients(new Set(duplicateRecipientIds));
    setError('');
  }

  function toggleSegmentSelection(id) {
    const newSet = new Set(selectedSegments);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedSegments(newSet);
  }

  function toggleSelectAllSegments() {
    if (selectedSegments.size === segments.length) {
      setSelectedSegments(new Set());
    } else {
      setSelectedSegments(new Set(segments.map((s) => s.id)));
    }
  }

  async function deleteSelectedRecipients() {
    if (selectedRecipients.size === 0) {
      setError('Please select at least one recipient to delete.');
      return;
    }
    try {
      const ids = Array.from(selectedRecipients);
      setRecipients(await desktopInvoke('recipients:delete-multiple', { ids }));
      setSelectedRecipients(new Set());
      setError('');
    } catch (deleteError) {
      setError(deleteError.message);
    }
  }

  async function deleteSelectedSegments() {
    if (selectedSegments.size === 0) {
      setError('Please select at least one segment to delete.');
      return;
    }
    try {
      const ids = Array.from(selectedSegments);
      setSegments(await desktopInvoke('segments:delete-multiple', { ids }));
      setSelectedSegments(new Set());
      setError('');
    } catch (deleteError) {
      setError(deleteError.message);
    }
  }

  return (
    <section className="audience-grid">
      <div className="panel">
        <form className="form-grid compact-form" onSubmit={addRecipient}>
          <label>Email<input value={recipientForm.email} onChange={(event) => setRecipientForm({ ...recipientForm, email: event.target.value })} /></label>
          <label>Name<input value={recipientForm.name} onChange={(event) => setRecipientForm({ ...recipientForm, name: event.target.value })} /></label>
          <label>Category<input value={recipientForm.category} onChange={(event) => setRecipientForm({ ...recipientForm, category: event.target.value })} placeholder="VIP, Newsletter, etc." /></label>
          <label className="full-span">Tags<input value={recipientForm.tags} onChange={(event) => setRecipientForm({ ...recipientForm, tags: event.target.value })} placeholder="finance, vip, webinar" /></label>
          <label>Status
            <select value={recipientForm.status} onChange={(event) => setRecipientForm({ ...recipientForm, status: event.target.value })}>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
            </select>
          </label>
          <button className="primary-button" type="submit">Save</button>
        </form>
      </div>
      <div className="panel">
        <div className="filter-row">
          <input
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Search"
          />
          {duplicateRecipientIds.size > 0 ? (
            <button className="ghost-button sm" type="button" onClick={selectDuplicateRecipients}>
              Duplicates {duplicateRecipientIds.size}
            </button>
          ) : null}
          {selectedRecipients.size > 0 && (
            <button className="ghost-button sm" type="button" onClick={deleteSelectedRecipients}>
              Delete {selectedRecipients.size}
            </button>
          )}
        </div>
        <div className="list-stack compact-list">
          {filteredRecipients.length > 0 && (
            <div className="list-row" style={{ alignItems: 'center', gap: '12px', backgroundColor: 'rgba(255,255,255,0.05)', paddingRight: '16px' }}>
              <input
                type="checkbox"
                checked={selectedRecipients.size === filteredRecipients.length && filteredRecipients.length > 0}
                onChange={toggleSelectAllRecipients}
                style={{ cursor: 'pointer' }}
              />
              <span>Select All</span>
            </div>
          )}
          {filteredRecipients.map((recipient) => (
            <div className="list-row" key={recipient.id} style={{ alignItems: 'center', gap: '12px', display: 'grid', gridTemplateColumns: 'auto 1fr auto auto' }}>
              <input
                type="checkbox"
                checked={selectedRecipients.has(recipient.id)}
                onChange={() => toggleRecipientSelection(recipient.id)}
                style={{ cursor: 'pointer' }}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
                <strong style={{ fontSize: '0.95em' }}>{recipient.email}</strong>
                {recipient.name && <span style={{ fontSize: '0.85em', color: 'rgba(255,255,255,0.6)' }}>{recipient.name}</span>}
              </div>
              {recipient.category && (
                <span style={{ fontSize: '0.8em', padding: '2px 8px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px', whiteSpace: 'nowrap' }}>
                  {recipient.category}
                </span>
              )}
              <span className={`pill pill-${recipient.status}`} style={{ whiteSpace: 'nowrap' }}>{recipient.status}</span>
            </div>
          ))}
          {filteredRecipients.length === 0 ? <p className="muted-copy empty-hint">No matches</p> : null}
        </div>
      </div>
      <div className="panel">
        <form className="form-grid compact-form" onSubmit={addSegment}>
          <label>Name<input value={segmentForm.name} onChange={(event) => setSegmentForm({ ...segmentForm, name: event.target.value })} /></label>
          <label>Description<input value={segmentForm.description} onChange={(event) => setSegmentForm({ ...segmentForm, description: event.target.value })} /></label>
          <label>Tag Includes<input value={segmentForm.tagIncludes} onChange={(event) => setSegmentForm({ ...segmentForm, tagIncludes: event.target.value })} /></label>
          <label>Status
            <select value={segmentForm.status} onChange={(event) => setSegmentForm({ ...segmentForm, status: event.target.value })}>
              <option value="">Any</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
            </select>
          </label>
          <div className="button-row">
            <button className="primary-button" type="submit">Save Segment</button>
            <button className="ghost-button" type="button" onClick={previewSegment}>Preview</button>
          </div>
        </form>
        {error ? <p className="error-text">{error}</p> : null}
      </div>
      <div className="panel">
        <div className="panel-header"><h3>CSV Import / Export</h3></div>
        <div className="form-grid">
          <div className="button-row full-span">
            <button className="primary-button" type="button" onClick={importCsvFile}>Import CSV From Computer</button>
            <button className="ghost-button" type="button" onClick={exportCsv}>Export CSV</button>
          </div>
          <label className="full-span">
            Paste CSV
            <textarea
              rows="8"
              value={csvText}
              onChange={(event) => setCsvText(event.target.value)}
              placeholder={'email,name,tags,status\nalex@example.com,Alex,finance|vip,active'}
            />
          </label>
          <div className="button-row full-span">
            <button className="ghost-button" type="button" onClick={importCsv}>Import Pasted CSV</button>
          </div>
          <label className="full-span">
            Export Output
            <textarea rows="8" value={exportText} readOnly />
          </label>
        </div>
      </div>
      <div className="panel">
        <div className="filter-row">
          {selectedSegments.size > 0 && (
            <button className="ghost-button sm" type="button" onClick={deleteSelectedSegments}>
              Delete {selectedSegments.size}
            </button>
          )}
        </div>
        <div className="list-stack compact-list">
          {segments.length > 0 && (
            <div className="list-row" style={{ alignItems: 'center', gap: '12px', backgroundColor: 'rgba(255,255,255,0.05)', paddingRight: '16px' }}>
              <input
                type="checkbox"
                checked={selectedSegments.size === segments.length && segments.length > 0}
                onChange={toggleSelectAllSegments}
                style={{ cursor: 'pointer' }}
              />
              <span>Select All</span>
            </div>
          )}
          {segments.map((segment) => (
            <div className="list-row" key={segment.id} style={{ alignItems: 'flex-start', gap: '12px' }}>
              <input
                type="checkbox"
                checked={selectedSegments.has(segment.id)}
                onChange={() => toggleSegmentSelection(segment.id)}
                style={{ marginTop: '4px', flexShrink: 0, cursor: 'pointer' }}
              />
              <div style={{ flex: 1 }}>
                <strong>{segment.name}</strong>
                <p>{segment.description || 'No description'}</p>
              </div>
            </div>
          ))}
          {segments.length === 0 ? <p className="muted-copy empty-hint">No segments created</p> : null}
        </div>
        <div className="preview-box">
          <strong>Preview Matches</strong>
          <p>{preview.length} recipients match the current draft filters.</p>
        </div>
      </div>
    </section>
  );
}

export default AudiencePage;
