import React, { useEffect, useState } from 'react';
import { desktopInvoke } from '../api';

const panelStyles = {
  panelContainer: {
    padding: '20px',
    borderRadius: '8px',
    backgroundColor: '#fafafa',
    border: '1px solid #eee'
  },
  settingSection: {
    marginBottom: '20px'
  },
  label: {
    display: 'block',
    fontSize: '13px',
    fontWeight: '600',
    marginBottom: '8px',
    color: '#333'
  },
  input: {
    width: '100%',
    padding: '10px 12px',
    fontSize: '13px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    boxSizing: 'border-box',
    fontFamily: 'system-ui, -apple-system, sans-serif'
  }
};

function AISettingsPanel() {
  const [settings, setSettings] = useState({
    provider: 'nvidia',
    model: 'meta/llama-3.2-3b-instruct',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    apiKeyPreview: '',
    hasApiKey: false,
    systemPrompt: ''
  });
  const [newApiKey, setNewApiKey] = useState('');
  const [providerPresets, setProviderPresets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState('');
  const [showApiKeyForm, setShowApiKeyForm] = useState(false);

  useEffect(() => {
    loadInitialData();
  }, []);

  async function loadInitialData() {
    try {
      const [presets, result] = await Promise.all([
        desktopInvoke('ai:provider-presets'),
        desktopInvoke('ai:settings-get')
      ]);
      setProviderPresets(presets);
      setSettings(result);
    } catch (error) {
      setMessage(`Error loading settings: ${error.message}`);
    }
  }

  async function handleUpdateSettings(event) {
    event.preventDefault();
    setLoading(true);
    setMessage('');

    try {
      const payload = {
        provider: settings.provider,
        model: settings.model,
        baseUrl: settings.baseUrl,
        systemPrompt: settings.systemPrompt
      };
      if (newApiKey.trim()) {
        payload.apiKey = newApiKey;
      }

      const result = await desktopInvoke('ai:settings-update', payload);
      setSettings(result);
      setNewApiKey('');
      setShowApiKeyForm(false);
      setMessage('✓ Settings saved successfully');
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      setMessage(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }

  function handleProviderChange(provider) {
    const preset = providerPresets.find((item) => item.id === provider);
    setSettings({
      ...settings,
      provider,
      model: preset?.model || settings.model,
      baseUrl: preset?.baseUrl || settings.baseUrl
    });
  }

  async function handleTestConnection() {
    setTesting(true);
    setMessage('');

    try {
      const result = await desktopInvoke('ai:test-connection', {
        provider: settings.provider,
        model: settings.model,
        baseUrl: settings.baseUrl,
        apiKey: newApiKey
      });
      setMessage(`✓ ${result.providerLabel} connected in ${result.latencyMs}ms (${result.model})`);
    } catch (error) {
      setMessage(`Error: ${error.message}`);
    } finally {
      setTesting(false);
    }
  }

  const selectedPreset = providerPresets.find((item) => item.id === settings.provider);

  return (
    <div style={panelStyles.panelContainer}>
      <h2>AI Infrastructure Settings</h2>
      <p style={{ color: '#666', fontSize: '14px', marginBottom: '24px' }}>
        Configure your AI provider and customize the system prompt for email writing.
      </p>

      <form onSubmit={handleUpdateSettings} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* Provider Section */}
        <div style={panelStyles.settingSection}>
          <label style={panelStyles.label}>AI Provider</label>
          <select
            value={settings.provider}
            onChange={(e) => handleProviderChange(e.target.value)}
            style={panelStyles.input}
          >
            {providerPresets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>
          <p style={{ fontSize: '12px', color: '#999', marginTop: '8px' }}>
            Choose any OpenAI-compatible endpoint. Presets fill in the default base URL and model.
          </p>
        </div>

        {/* API Key Section */}
        <div style={panelStyles.settingSection}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <label style={panelStyles.label}>API Key</label>
            {settings.hasApiKey && (
              <span style={{ fontSize: '12px', color: '#28a745', fontWeight: 'bold' }}>✓ Configured</span>
            )}
          </div>

          {!showApiKeyForm ? (
            <button
              type="button"
              onClick={() => setShowApiKeyForm(true)}
              style={{
                padding: '10px 16px',
                backgroundColor: '#f5f5f5',
                border: '1px solid #ddd',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '14px'
              }}
            >
              {settings.hasApiKey ? `Update API Key (${settings.apiKeyPreview})` : 'Add API Key'}
            </button>
          ) : (
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="password"
                placeholder={selectedPreset?.apiKeyPlaceholder || 'Paste your API key here'}
                value={newApiKey}
                onChange={(e) => setNewApiKey(e.target.value)}
                style={panelStyles.input}
              />
              <button
                type="button"
                onClick={() => {
                  setShowApiKeyForm(false);
                  setNewApiKey('');
                }}
                style={{
                  padding: '10px 16px',
                  backgroundColor: '#f5f5f5',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
            </div>
          )}
          <p style={{ fontSize: '12px', color: '#999', marginTop: '8px' }}>
            Keys are encrypted and stored locally. You can also use {selectedPreset?.apiKeyEnv || 'a provider-specific environment variable'}.
          </p>
        </div>

        {/* Model Section */}
        <div style={panelStyles.settingSection}>
          <label style={panelStyles.label}>Default AI Model</label>
          <input
            type="text"
            value={settings.model}
            onChange={(e) => setSettings({ ...settings, model: e.target.value })}
            placeholder="e.g., meta/llama-3.2-3b-instruct"
            style={panelStyles.input}
          />
          <p style={{ fontSize: '12px', color: '#999', marginTop: '8px' }}>
            Preset default: {selectedPreset?.model || 'Set a model supported by your endpoint'}
          </p>
        </div>

        {/* Base URL Section */}
        <div style={panelStyles.settingSection}>
          <label style={panelStyles.label}>API Base URL</label>
          <input
            type="text"
            value={settings.baseUrl}
            onChange={(e) => setSettings({ ...settings, baseUrl: e.target.value })}
            placeholder="https://integrate.api.nvidia.com/v1"
            style={panelStyles.input}
          />
          <p style={{ fontSize: '12px', color: '#999', marginTop: '8px' }}>
            Preset default: {selectedPreset?.baseUrl || 'Enter your OpenAI-compatible /v1 endpoint'}
          </p>
        </div>

        {/* System Prompt Section */}
        <div style={panelStyles.settingSection}>
          <label style={panelStyles.label}>System Prompt for Email Writing</label>
          <textarea
            value={settings.systemPrompt}
            onChange={(e) => setSettings({ ...settings, systemPrompt: e.target.value })}
            placeholder="Enter the system prompt that will guide AI email writing..."
            style={{
              ...panelStyles.input,
              fontFamily: 'monospace',
              fontSize: '12px',
              minHeight: '180px',
              resize: 'vertical'
            }}
          />
          <p style={{ fontSize: '12px', color: '#999', marginTop: '8px' }}>
            This prompt is prepended to all AI requests. Include guidelines for compliance, tone, and email best practices.
          </p>
        </div>

        {/* Status Message */}
        {message && (
          <div
            style={{
              padding: '12px 16px',
              backgroundColor: message.includes('Error') ? '#ffebee' : '#e8f5e9',
              color: message.includes('Error') ? '#c62828' : '#2e7d32',
              borderRadius: '4px',
              fontSize: '14px'
            }}
          >
            {message}
          </div>
        )}

        {/* Submit Button */}
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button
            type="submit"
            disabled={loading || testing}
            style={{
              padding: '12px 24px',
              backgroundColor: loading ? '#ccc' : '#1a73e8',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: loading || testing ? 'not-allowed' : 'pointer',
              fontSize: '14px',
              fontWeight: 'bold'
            }}
          >
            {loading ? 'Saving...' : 'Save Settings'}
          </button>
          <button
            type="button"
            onClick={handleTestConnection}
            disabled={loading || testing}
            style={{
              padding: '12px 24px',
              backgroundColor: '#f5f5f5',
              color: '#333',
              border: '1px solid #ddd',
              borderRadius: '4px',
              cursor: loading || testing ? 'not-allowed' : 'pointer',
              fontSize: '14px',
              fontWeight: 'bold'
            }}
          >
            {testing ? 'Testing...' : 'Test Connection'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default AISettingsPanel;
