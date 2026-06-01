import React, { useState } from 'react';
import { desktopInvoke } from '../api';

function AIAssistantPanel({ editorContent, onApplyChanges, onClose }) {
  const [mode, setMode] = useState('improve');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [selectedResult, setSelectedResult] = useState(null);

  const modes = [
    { value: 'write', label: 'Write with AI', icon: '✍️', desc: 'Generate new email from scratch' },
    { value: 'improve', label: 'Improve with AI', icon: '✨', desc: 'Polish existing content' },
    { value: 'spam_check', label: 'Check for Spam Risk', icon: '🛡️', desc: 'Analyze and reduce spam risk' }
  ];

  async function handleAiRequest() {
    setLoading(true);
    setError('');
    setResult(null);

    try {
      const payload = {
        mode,
        html: editorContent.html || '',
        subject: editorContent.subject || '',
        previewText: editorContent.previewText || ''
      };

      const data = await desktopInvoke('ai:process-email', payload);

      setResult(data);
      setSelectedResult('improved');
    } catch (err) {
      setError(err.message || 'Error calling AI assistant');
    } finally {
      setLoading(false);
    }
  }

  function handleApplyResult() {
    if (!result) return;

    const content = result.improvedHtml || result.improved || result.originalHtml || result.original;
    if (onApplyChanges) {
      onApplyChanges({
        html: content,
        subject: result.subject,
        previewText: result.previewText
      });
    }

    // Close the panel
    if (onClose) {
      onClose();
    }
  }

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <h3 style={{ margin: 0 }}>AI Assistant</h3>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            fontSize: '20px',
            cursor: 'pointer',
            padding: '0 8px'
          }}
        >
          ×
        </button>
      </div>

      {!result ? (
        <div style={styles.content}>
          <p style={styles.description}>Select an AI action to help with your email:</p>

          <div style={styles.modeSelector}>
            {modes.map((m) => (
              <button
                key={m.value}
                onClick={() => setMode(m.value)}
                style={{
                  ...styles.modeButton,
                  ...(mode === m.value ? styles.modeButtonActive : {})
                }}
              >
                <div style={{ fontSize: '24px', marginBottom: '8px' }}>{m.icon}</div>
                <div style={{ fontWeight: 'bold', fontSize: '13px' }}>{m.label}</div>
                <div style={{ fontSize: '11px', color: '#666', marginTop: '4px' }}>{m.desc}</div>
              </button>
            ))}
          </div>

          {error && <div style={styles.error}>{error}</div>}

          <button
            onClick={handleAiRequest}
            disabled={loading || (mode !== 'write' && !editorContent.html)}
            style={{
              ...styles.submitButton,
              opacity: loading || (mode !== 'write' && !editorContent.html) ? 0.6 : 1,
              cursor: loading || (mode !== 'write' && !editorContent.html) ? 'not-allowed' : 'pointer'
            }}
          >
            {loading ? 'Thinking...' : 'Generate'}
          </button>

          {mode !== 'write' && !editorContent.html && (
            <p style={{ fontSize: '12px', color: '#999', marginTop: '12px', textAlign: 'center' }}>
              Add email content first to use AI assistant
            </p>
          )}
        </div>
      ) : (
        <div style={styles.content}>
          <div style={styles.resultHeader}>
            <h4 style={{ margin: '0 0 12px 0' }}>Review Changes</h4>
            <button
              onClick={() => setResult(null)}
              style={{
                padding: '4px 12px',
                background: 'none',
                border: '1px solid #ddd',
                borderRadius: '3px',
                cursor: 'pointer',
                fontSize: '12px'
              }}
            >
              Try Again
            </button>
          </div>

          {/* Tab selection for before/after */}
          <div style={styles.tabs}>
            <button
              onClick={() => setSelectedResult('original')}
              style={{
                ...styles.tab,
                ...(selectedResult === 'original' ? styles.tabActive : {})
              }}
            >
              Before
            </button>
            <button
              onClick={() => setSelectedResult('improved')}
              style={{
                ...styles.tab,
                ...(selectedResult === 'improved' ? styles.tabActive : {})
              }}
            >
              After
            </button>
            {result.spamAnalysis && (
              <button
                onClick={() => setSelectedResult('analysis')}
                style={{
                  ...styles.tab,
                  ...(selectedResult === 'analysis' ? styles.tabActive : {})
                }}
              >
                Analysis
              </button>
            )}
          </div>

          {/* Content preview */}
          <div style={styles.preview}>
            {selectedResult === 'original' && (
              <div>
                <p style={{ fontSize: '12px', color: '#666', marginBottom: '12px' }}>Original email content:</p>
                <div style={styles.previewText}>{result.original}</div>
              </div>
            )}

            {selectedResult === 'improved' && (
              <div>
                <p style={{ fontSize: '12px', color: '#666', marginBottom: '12px' }}>AI-improved email content:</p>
                {(result.subject || result.previewText) && (
                  <div style={{ ...styles.previewText, marginBottom: '12px' }}>
                    {result.subject && <div><strong>Subject:</strong> {result.subject}</div>}
                    {result.previewText && <div><strong>Preview:</strong> {result.previewText}</div>}
                  </div>
                )}
                <div style={styles.previewText}>{result.improved}</div>
                {Array.isArray(result.notes) && result.notes.length > 0 && (
                  <ul style={{ marginTop: '12px', paddingLeft: '20px', fontSize: '12px', color: '#666' }}>
                    {result.notes.map((note, i) => (
                      <li key={i}>{note}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {selectedResult === 'analysis' && result.spamAnalysis && (
              <div>
                <p style={{ fontSize: '12px', color: '#666', marginBottom: '12px' }}>Spam Risk Analysis:</p>
                {result.spamAnalysis.spamScore !== undefined && (
                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ fontSize: '13px', fontWeight: 'bold', marginBottom: '4px' }}>
                      Spam Score: {result.spamAnalysis.spamScore}/100
                    </div>
                    <div
                      style={{
                        height: '8px',
                        backgroundColor: '#eee',
                        borderRadius: '4px',
                        overflow: 'hidden'
                      }}
                    >
                      <div
                        style={{
                          height: '100%',
                          width: `${result.spamAnalysis.spamScore}%`,
                          backgroundColor:
                            result.spamAnalysis.spamScore > 70
                              ? '#d32f2f'
                              : result.spamAnalysis.spamScore > 40
                                ? '#f57c00'
                                : '#388e3c'
                        }}
                      />
                    </div>
                  </div>
                )}

                {result.spamAnalysis.risks && (
                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: '8px' }}>Identified Risks:</div>
                    <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '12px' }}>
                      {result.spamAnalysis.risks.map((risk, i) => (
                        <li key={i} style={{ marginBottom: '4px' }}>
                          {risk}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {result.spamAnalysis.suggestions && (
                  <div>
                    <div style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: '8px' }}>Suggestions:</div>
                    <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '12px' }}>
                      {result.spamAnalysis.suggestions.map((suggestion, i) => (
                        <li key={i} style={{ marginBottom: '4px' }}>
                          {suggestion}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div style={styles.actionButtons}>
            <button
              onClick={handleApplyResult}
              style={{
                ...styles.acceptButton
              }}
            >
              ✓ Accept Changes
            </button>
            <button
              onClick={() => setResult(null)}
              style={{
                ...styles.rejectButton
              }}
            >
              ✕ Decline
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  panel: {
    position: 'fixed',
    right: 0,
    top: 0,
    width: '420px',
    height: '100vh',
    backgroundColor: '#fff',
    boxShadow: '-2px 0 8px rgba(0,0,0,0.1)',
    display: 'flex',
    flexDirection: 'column',
    zIndex: 1000
  },
  header: {
    padding: '16px 20px',
    borderBottom: '1px solid #eee',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  content: {
    flex: 1,
    overflow: 'auto',
    padding: '16px 20px',
    display: 'flex',
    flexDirection: 'column'
  },
  description: {
    fontSize: '13px',
    color: '#666',
    marginBottom: '16px'
  },
  modeSelector: {
    display: 'grid',
    gridTemplateColumns: '1fr',
    gap: '8px',
    marginBottom: '20px'
  },
  modeButton: {
    padding: '12px 16px',
    backgroundColor: '#f5f5f5',
    border: '2px solid #eee',
    borderRadius: '6px',
    cursor: 'pointer',
    textAlign: 'center',
    transition: 'all 0.2s',
    fontSize: '13px'
  },
  modeButtonActive: {
    backgroundColor: '#e3f2fd',
    borderColor: '#1a73e8'
  },
  error: {
    padding: '12px',
    backgroundColor: '#ffebee',
    color: '#c62828',
    borderRadius: '4px',
    fontSize: '12px',
    marginBottom: '12px'
  },
  submitButton: {
    padding: '12px 16px',
    backgroundColor: '#1a73e8',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    fontSize: '13px',
    fontWeight: 'bold',
    cursor: 'pointer',
    marginTop: 'auto'
  },
  resultHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '16px'
  },
  tabs: {
    display: 'flex',
    gap: '8px',
    borderBottom: '1px solid #eee',
    marginBottom: '16px'
  },
  tab: {
    padding: '8px 16px',
    background: 'none',
    border: 'none',
    borderBottom: '2px solid transparent',
    cursor: 'pointer',
    fontSize: '12px',
    color: '#666'
  },
  tabActive: {
    color: '#1a73e8',
    borderBottomColor: '#1a73e8'
  },
  preview: {
    flex: 1,
    backgroundColor: '#f9f9f9',
    padding: '12px',
    borderRadius: '4px',
    fontSize: '12px',
    overflow: 'auto',
    marginBottom: '16px'
  },
  previewText: {
    fontSize: '13px',
    lineHeight: '1.6',
    color: '#333',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word'
  },
  actionButtons: {
    display: 'flex',
    gap: '8px'
  },
  acceptButton: {
    flex: 1,
    padding: '10px 16px',
    backgroundColor: '#388e3c',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: 'bold'
  },
  rejectButton: {
    flex: 1,
    padding: '10px 16px',
    backgroundColor: '#f5f5f5',
    color: '#333',
    border: '1px solid #ddd',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: 'bold'
  }
};

export default AIAssistantPanel;
