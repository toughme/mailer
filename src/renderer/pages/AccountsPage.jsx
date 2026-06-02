import React, { useEffect, useState } from 'react';
import { desktopInvoke } from '../api';
import Tooltip from '../components/Tooltip';
import ProcessModal from '../components/ProcessModal';
import useProcess from '../hooks/useProcess';

const initialForm = {
  provider: 'Custom provider',
  primaryProtocol: 'smtp',
  email: '',
  displayName: '',
  replyTo: '',
  username: '',
  password: '',
  host: '',
  port: 587,
  secure: true,
  proxyProfileId: '',
  notes: ''
};

const providerTemplates = [
  { id: 'custom', label: 'Custom', provider: 'Custom provider', primaryProtocol: 'smtp', host: '', port: 587, secure: true },
  { id: 'gmail', label: 'Gmail', provider: 'Gmail SMTP', primaryProtocol: 'smtp', host: 'smtp.gmail.com', port: 587, secure: true },
  { id: 'outlook', label: 'Outlook', provider: 'Outlook SMTP', primaryProtocol: 'smtp', host: 'smtp.office365.com', port: 587, secure: true },
  { id: 'microsoft', label: 'Microsoft Graph', provider: 'Microsoft Graph OAuth', primaryProtocol: 'graph', host: '', port: 0, secure: true },
  { id: 'sendgrid', label: 'SendGrid', provider: 'SendGrid SMTP', primaryProtocol: 'smtp', host: 'smtp.sendgrid.net', port: 587, secure: true },
  { id: 'ses', label: 'SES', provider: 'Amazon SES', primaryProtocol: 'smtp', host: 'email-smtp.us-east-1.amazonaws.com', port: 587, secure: true },
  { id: 'mailgun', label: 'Mailgun', provider: 'Mailgun SMTP', primaryProtocol: 'smtp', host: 'smtp.mailgun.org', port: 587, secure: true },
  { id: 'postmark', label: 'Postmark', provider: 'Postmark SMTP', primaryProtocol: 'smtp', host: 'smtp.postmarkapp.com', port: 587, secure: true }
];

function AccountsPage() {
  const [accounts, setAccounts] = useState([]);
  const [authHealth, setAuthHealth] = useState([]);
  const [proxies, setProxies] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [providerTemplate, setProviderTemplate] = useState('custom');
  const [error, setError] = useState('');
  const [testResult, setTestResult] = useState('');
  const [accountTestResults, setAccountTestResults] = useState({});
  const [loadingAuth, setLoadingAuth] = useState(false);
  const [authorizingAccountId, setAuthorizingAccountId] = useState(null);
  const { process, startProcess, updateProcess, completeProcess, cancelProcess } = useProcess();

  function applyProviderTemplate(templateId) {
    const template = providerTemplates.find((item) => item.id === templateId);
    if (!template) {
      return;
    }

    setProviderTemplate(templateId);
    setForm((current) => ({
      ...current,
      provider: template.provider,
      primaryProtocol: template.primaryProtocol,
      host: template.host,
      port: template.port,
      secure: template.secure
    }));
  }

  async function loadAccounts() {
    try {
      setAccounts(await desktopInvoke('accounts:list'));
      setProxies(await desktopInvoke('ops:proxies:list'));
      setError('');
    } catch (loadError) {
      setError(loadError.message);
    }
  }

  async function loadAuthHealth() {
    setLoadingAuth(true);
    try {
      setAuthHealth(await desktopInvoke('accounts:auth-health'));
    } catch {
      setAuthHealth([]);
    } finally {
      setLoadingAuth(false);
    }
  }

  useEffect(() => {
    loadAccounts();
    loadAuthHealth();
  }, []);

  function getAuthForAccount(accountId) {
    return authHealth.find((item) => item.id === accountId);
  }

  const isGraphProtocol = form.primaryProtocol === 'graph';

  async function handleAuthorize(accountId, accountData = null) {
    try {
      startProcess('Authorizing Microsoft OAuth', { message: 'Opening authentication window... A browser window will open for you to sign in to Microsoft.' });
      setAuthorizingAccountId(accountId);
      
      // If accountData provided (new account), pass it to create and authorize together
      const payload = accountData ? { ...accountData, create: true } : { id: accountId };
      
      const result = await desktopInvoke('accounts:graph-authorize', payload);
      completeProcess('Microsoft OAuth authorization completed');
      setError('');
      setTestResult(result.connected
        ? `Microsoft OAuth account authorized successfully. Connected as ${result.email || 'user'}.`
        : 'Microsoft OAuth account authorized successfully.'
      );
      await loadAccounts();
      await loadAuthHealth();
    } catch (authorizeError) {
      const isCancelled = authorizeError.message?.includes('cancelled');
      completeProcess(isCancelled ? 'Authorization cancelled' : 'Microsoft OAuth authorization failed');
      if (isCancelled) {
        setError('Microsoft authorization was cancelled. Click Authorize to try again.');
        setTestResult('');
      } else {
        setError(authorizeError.message);
        setTestResult('');
      }
    } finally {
      setAuthorizingAccountId(null);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    try {
      if (isGraphProtocol) {
        // For OAuth accounts, start authorization directly (account created during auth)
        await handleAuthorize(null, form);
        setForm(initialForm);
        return;
      }
      
      // For non-OAuth accounts, save normally
      const createdAccounts = await desktopInvoke('accounts:create', form);
      setAccounts(createdAccounts);
      setForm(initialForm);
      setError('');
      setTestResult('Account saved successfully.');
      await loadAuthHealth();
    } catch (submitError) {
      setError(submitError.message);
    }
  }

  async function handleTestDraft() {
    if (isGraphProtocol) {
      setError('Save the Microsoft OAuth account first, then authorize it before testing.');
      setTestResult('');
      return;
    }

    try {
      startProcess('Testing Account', { message: 'Initializing connection test...' });
      const result = await desktopInvoke('accounts:test', form);
      completeProcess('Account test completed successfully');
      setTestResult(result.message);
      if (result.dnsAuth) {
        await loadAuthHealth();
      }
      setError('');
    } catch (testError) {
      completeProcess('Account test failed');
      setError(testError.message);
      setTestResult('');
    }
  }

  async function handleTestSaved(id) {
    try {
      startProcess('Testing Account', { message: 'Initializing connection test...' });
      const result = await desktopInvoke('accounts:test', { id });
      completeProcess('Account test completed successfully');
      setAccountTestResults((current) => ({ ...current, [id]: { ok: true, message: result.message } }));
      setTestResult(result.message);
      if (result.dnsAuth) {
        await loadAuthHealth();
      }
      setError('');
    } catch (testError) {
      completeProcess('Account test failed');
      setAccountTestResults((current) => ({ ...current, [id]: { ok: false, message: testError.message } }));
      setError(testError.message);
      setTestResult('');
    }
  }

  async function handleTestAllSaved() {
    if (!accounts.length) {
      setError('Add at least one account before running a full test.');
      return;
    }

    const results = {};
    startProcess('Testing All Accounts', {
      message: `Testing 1 of ${accounts.length}`,
      progress: 0,
      total: accounts.length
    });

    for (let index = 0; index < accounts.length; index += 1) {
      const account = accounts[index];
      updateProcess({
        message: `Testing ${account.email || account.provider} (${index + 1} of ${accounts.length})`,
        progress: index,
        total: accounts.length
      });

      try {
        const result = await desktopInvoke('accounts:test', { id: account.id });
        results[account.id] = { ok: true, message: result.message };
        setAccountTestResults((current) => ({ ...current, [account.id]: results[account.id] }));
      } catch (testError) {
        results[account.id] = { ok: false, message: testError.message };
        setAccountTestResults((current) => ({ ...current, [account.id]: results[account.id] }));
      }
    }

    const passed = Object.values(results).filter((result) => result.ok).length;
    completeProcess(`Tested ${accounts.length} accounts`);
    setTestResult(`${passed}/${accounts.length} accounts connected successfully.`);
    setError(passed === accounts.length ? '' : `${accounts.length - passed} account(s) need attention.`);
    await loadAuthHealth();
  }

  async function handleDelete(id) {
    try {
      setAccounts(await desktopInvoke('accounts:delete', { id }));
      await loadAuthHealth();
    } catch (deleteError) {
      setError(deleteError.message);
    }
  }

  return (
    <>
    <section className="two-column-grid">
      <div className="panel account-panel">
        <form className="account-form compact-form" onSubmit={handleSubmit}>
          <div className="section-grid">
            <label>
              Template
              <select value={providerTemplate} onChange={(event) => applyProviderTemplate(event.target.value)}>
                {providerTemplates.map((template) => (
                  <option key={template.id} value={template.id}>{template.label}</option>
                ))}
              </select>
            </label>
            <label>
              Title
              <input value={form.provider} onChange={(event) => setForm({ ...form, provider: event.target.value })} />
            </label>
            <label>
              Email
              <input value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
            </label>
<label>
Name
<input value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} />
</label>
<label className="reply-to-field">
Reply-to
<input type="email" value={form.replyTo} onChange={(event) => setForm({ ...form, replyTo: event.target.value })} placeholder="Optional reply-to address" />
</label>
            <label>
              Protocol
              <select value={form.primaryProtocol} onChange={(event) => setForm({ ...form, primaryProtocol: event.target.value })}>
                <option value="smtp">SMTP</option>
                <option value="imap">IMAP</option>
                <option value="pop3">POP3</option>
                <option value="graph">Microsoft Graph</option>
              </select>
            </label>
            {!isGraphProtocol ? (
              <>
                <label>
                  Host
                  <input value={form.host} onChange={(event) => setForm({ ...form, host: event.target.value })} />
                </label>
                <label>
                  Port
                  <input type="number" value={form.port} onChange={(event) => setForm({ ...form, port: Number(event.target.value) })} />
                </label>
                <label className="checkbox-row">
                  <input type="checkbox" checked={form.secure} onChange={(event) => setForm({ ...form, secure: event.target.checked })} />
                  TLS
                </label>
              </>
            ) : null}
            <label>
              Proxy
              <select value={form.proxyProfileId} onChange={(event) => setForm({ ...form, proxyProfileId: event.target.value })}>
                <option value="">Direct</option>
                {proxies.map((proxy) => (
                  <option key={proxy.id} value={proxy.id}>
                    {proxy.name} ({proxy.type})
                  </option>
                ))}
              </select>
            </label>
            {!isGraphProtocol ? (
              <>
                <label>
                  User
                  <input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} />
                </label>
                <label>
                  Pass
                  <input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
                </label>
              </>
            ) : (
              <p className="muted-copy">Microsoft Graph accounts use OAuth authorization and send mail through the Microsoft Graph API.</p>
            )}
          </div>
          <div className="button-row">
            <Tooltip label={isGraphProtocol ? 'Authorize with Microsoft' : 'Save account'}>
              <button className="primary-button" type="submit">
                {isGraphProtocol ? 'Authorize' : 'Save'}
              </button>
            </Tooltip>
            {!isGraphProtocol && (
              <Tooltip label="Test SMTP connection">
                <button className="ghost-button" type="button" onClick={handleTestDraft}>Test</button>
              </Tooltip>
            )}
            <Tooltip label="Refresh SPF/DKIM/DMARC status">
              <button className="ghost-button sm" type="button" onClick={loadAuthHealth} disabled={loadingAuth}>DNS</button>
            </Tooltip>
          </div>
          {error ? <p className="error-text">{error}</p> : null}
          {testResult ? <p className="success-text">{testResult}</p> : null}
        </form>
      </div>

      <div className="panel account-summary-panel">
        <div className="panel-toolbar account-summary-toolbar">
          <div>
            <strong>Saved Accounts</strong>
            <p className="muted-copy">Connection, DNS, and proxy readiness.</p>
          </div>
          <Tooltip label="Test every saved SMTP account">
            <button className="primary-button sm" type="button" onClick={handleTestAllSaved} disabled={!accounts.length}>Test All</button>
          </Tooltip>
        </div>
        <div className="list-stack">
          {accounts.map((account) => {
            const auth = getAuthForAccount(account.id);
            const test = accountTestResults[account.id];
            return (
              <div className="list-row account-list-row" key={account.id}>
                <div>
                  <strong>{account.displayName || account.email}</strong>
                  <p>{account.email}</p>
                  <p className="muted-copy">{account.primaryProtocol.toUpperCase()} {account.primaryProtocol === 'graph' ? '' : `${account.host}:${account.port}`}</p>
                  <p className="muted-copy">
                    Proxy: {proxies.find((proxy) => proxy.id === account.proxyProfileId)?.name || 'Direct'}
                  </p>
                  {auth ? (
                    <div className="auth-chips">
                      {auth.providerManaged ? (
                        <span className="checklist-chip ok" title={auth.note || 'Provider-managed authentication'}>Managed</span>
                      ) : (
                        <>
                          <span className={`checklist-chip ${auth.spf ? 'ok' : 'fix'}`} title="SPF">SPF</span>
                          <span className={`checklist-chip ${auth.dkim ? 'ok' : 'fix'}`} title="DKIM">DKIM</span>
                          <span className={`checklist-chip ${auth.dmarc ? 'ok' : 'fix'}`} title="DMARC">DMARC</span>
                        </>
                      )}
                    </div>
                  ) : null}
                </div>
                <div className="account-status-block">
                  {auth ? (
                    <span className={`pill ${auth.authOk ? 'pill-pass' : 'pill-review'}`}>
                      {auth.providerManaged ? 'managed' : auth.authOk ? 'auth ok' : 'auth fix'}
                    </span>
                  ) : null}
                  {account.primaryProtocol === 'graph' ? (
                    <span className={`pill ${account.connectionStatus === 'connected' ? 'pill-pass' : account.connectionStatus === 'pending' ? 'pill-review' : 'pill-fail'}`}>
                      {account.connectionStatus === 'connected' ? 'authorized' : account.connectionStatus === 'pending' ? 'auth needed' : account.connectionStatus === 'connecting' ? 'connecting' : 're-auth'}
                    </span>
                  ) : null}
                  {test ? (
                    <span className={`pill ${test.ok ? 'pill-pass' : 'pill-fail'}`} title={test.message}>
                      {test.ok ? 'connected' : 'failed'}
                    </span>
                  ) : null}
                  <div className="button-row">
                    {account.primaryProtocol === 'graph' && account.connectionStatus !== 'connected' ? (
                      <Tooltip label="Authorize Microsoft OAuth">
                        <button className="ghost-button sm" type="button" onClick={() => handleAuthorize(account.id)} disabled={authorizingAccountId === account.id}>
                          {authorizingAccountId === account.id ? 'Authorizing…' : 'Authorize'}
                        </button>
                      </Tooltip>
                    ) : null}
                    {account.primaryProtocol === 'graph' && account.connectionStatus === 'connected' && account.tokenExpired ? (
                      <Tooltip label="Re-authorize Microsoft OAuth (token expired)">
                        <button className="ghost-button sm" type="button" onClick={() => handleAuthorize(account.id)} disabled={authorizingAccountId === account.id}>
                          {authorizingAccountId === account.id ? 'Re-authorizing…' : 'Re-auth'}
                        </button>
                      </Tooltip>
                    ) : null}
                    {account.primaryProtocol !== 'graph' ? (
                      <Tooltip label="Test connection">
                        <button className="ghost-button sm" type="button" onClick={() => handleTestSaved(account.id)}>Test</button>
                      </Tooltip>
                    ) : null}
                    <Tooltip label="Remove account">
                      <button className="ghost-button sm" type="button" onClick={() => handleDelete(account.id)}>×</button>
                    </Tooltip>
                  </div>
                </div>
              </div>
            );
          })}
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

export default AccountsPage;
