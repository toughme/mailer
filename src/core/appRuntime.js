const fs = require('fs');
const path = require('path');
const { dialog, BrowserWindow, shell } = require('electron');

const { initializeDatabase } = require('./database');
const { createSecurityManager } = require('./security');
const { createAccountsService } = require('./services/accountsService');
const { createAccountsDiagnosticsService } = require('./services/accountsDiagnosticsService');
const { createCampaignsService } = require('./services/campaignsService');
const { createCampaignSchedulerService } = require('./services/campaignSchedulerService');
const { createRecipientsService } = require('./services/recipientsService');
const { createSegmentsService } = require('./services/segmentsService');
const { createContentService } = require('./services/contentService');
const { createAiRewriteService } = require('./services/aiRewriteService');
const { createDeliverabilityService } = require('./services/deliverabilityService');
const { createDashboardService } = require('./services/dashboardService');
const { createEmailSendService } = require('./services/emailSendService');
const { createAccountRotationService } = require('./services/accountRotationService');
const { createSendSettingsService } = require('./services/sendSettingsService');
const { createSendQueueService } = require('./services/sendQueueService');
const { createSendPreflightService } = require('./services/sendPreflightService');
const { createWebhookService } = require('./services/webhookService');
const { createEventLogService } = require('./services/eventLogService');
const { createListHygieneService } = require('./services/listHygieneService');
const { createReputationService } = require('./services/reputationService');
const { createMicrosoftOauthService } = require('./services/microsoftOauthService');
const { createOperationsCore } = require('./infrastructure');

function getMimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.jpg' || extension === '.jpeg') {
    return 'image/jpeg';
  }
  if (extension === '.gif') {
    return 'image/gif';
  }
  if (extension === '.webp') {
    return 'image/webp';
  }
  if (extension === '.svg') {
    return 'image/svg+xml';
  }
  if (extension === '.pdf') {
    return 'application/pdf';
  }
  if (extension === '.txt') {
    return 'text/plain';
  }
  if (extension === '.csv') {
    return 'text/csv';
  }
  if (extension === '.doc') {
    return 'application/msword';
  }
  if (extension === '.docx') {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  if (extension === '.xls') {
    return 'application/vnd.ms-excel';
  }
  if (extension === '.xlsx') {
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }
  if (extension === '.zip') {
    return 'application/zip';
  }
  if (extension === '.png') {
    return 'image/png';
  }
  return 'application/octet-stream';
}

async function initializeRuntime(app) {
  const baseDataDir = app.isPackaged
    ? path.join(app.getPath('userData'), 'data')
    : path.resolve(__dirname, '..', '..', 'data', 'app');

  fs.mkdirSync(baseDataDir, { recursive: true });

  const { db, dbPath } = await initializeDatabase(baseDataDir);
  const security = createSecurityManager(baseDataDir);

  const webhookService = createWebhookService({ db });
  const eventLogService = createEventLogService({ db, webhookService });
  const listHygieneService = createListHygieneService({ db });
  const reputationService = createReputationService({ db });
  const operations = createOperationsCore({ db, security });
  const accountsService = createAccountsService({ db, security });
  const deliverabilityService = createDeliverabilityService({ accountsService });
  const microsoftOauthService = createMicrosoftOauthService({ db, security });
  const accountsDiagnosticsService = createAccountsDiagnosticsService({
    db,
    security,
    proxyService: operations.proxyService,
    deliverabilityService,
    microsoftOauthService
  });
  const emailSendService = createEmailSendService({ db, security, proxyService: operations.proxyService, microsoftOauthService });
  const sendSettingsService = createSendSettingsService({ db });
  const accountRotationService = createAccountRotationService({ db, sendSettingsService });
  const sendPreflightService = createSendPreflightService({ db, deliverabilityService });
  const segmentsService = createSegmentsService({ db });
  const sendQueueService = createSendQueueService({
    db,
    emailSendService,
    accountRotationService,
    sendSettingsService,
    sendPreflightService,
    segmentsService,
    eventLogService,
    listHygieneService
  });
  const schedulerService = createCampaignSchedulerService({ db, sendQueueService });
  const campaignsService = createCampaignsService({ db, schedulerService, sendQueueService });
  const recipientsService = createRecipientsService({ db });
  const contentService = createContentService({ db });
  const aiRewriteService = createAiRewriteService({ db, security });
  const dashboardService = createDashboardService({ db, sendQueueService });

  await schedulerService.sync();
  await sendSettingsService.get();
  sendQueueService.startWorker();

  return {
    baseDataDir,
    dbPath,
    services: {
      accountsService,
      accountsDiagnosticsService,
      campaignsService,
      schedulerService,
      recipientsService,
      segmentsService,
      contentService,
      aiRewriteService,
      dashboardService,
      deliverabilityService,
      sendSettingsService,
      sendQueueService,
      sendPreflightService,
      accountRotationService,
      eventLogService,
      webhookService,
      listHygieneService,
      reputationService,
      microsoftOauthService,
      operations
    }
  };
}

function wrapHandler(handler) {
  return async (_event, payload) => {
    try {
      return await handler(payload);
    } catch (error) {
      return {
        ok: false,
        error: error.message || 'Unexpected error'
      };
    }
  };
}

function registerIpcHandlers(ipcMain, runtime, app, mainWindow) {
  const { services } = runtime;

  // Helper to send progress updates to renderer
  function emitProgress(event, data) {
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send(event, data);
    }
  }

  ipcMain.handle('app:bootstrap', async () => ({
    ok: true,
    appName: 'PhantomMailer 2026',
    version: app.getVersion(),
    isPackaged: app.isPackaged,
    dataPath: runtime.baseDataDir
  }));

  ipcMain.handle('dashboard:get', wrapHandler(async () => ({
    ok: true,
    data: await services.dashboardService.getSummary()
  })));

  ipcMain.handle('accounts:list', wrapHandler(async () => ({
    ok: true,
    data: await services.accountsService.list()
  })));

  ipcMain.handle('accounts:create', wrapHandler(async (payload) => ({
    ok: true,
    data: await services.accountsService.create(payload || {})
  })));

  ipcMain.handle('accounts:graph-authorize', wrapHandler(async (payload) => {
    if (!payload?.id) {
      throw new Error('Account id is required for Microsoft Graph authorization.');
    }

    const account = await services.accountsService.getById(payload.id);
    if (!account) {
      throw new Error('Account not found.');
    }

    if (String(account.primaryProtocol || '').toLowerCase() !== 'graph') {
      throw new Error('Microsoft Graph authorization is only available for Graph accounts.');
    }

    const authorization = services.microsoftOauthService.createAuthorization(payload.id);
    const callbackUri = services.microsoftOauthService.getRedirectUri();

    const result = await new Promise((resolve, reject) => {
      let completed = false;
      const authWindow = new BrowserWindow({
        parent: mainWindow || null,
        modal: Boolean(mainWindow),
        show: false,
        width: 900,
        height: 760,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true
        }
      });

      authWindow.removeMenu();
      authWindow.once('ready-to-show', () => authWindow.show());

      // Force Microsoft auth popup URLs to load in the same auth window
      authWindow.webContents.setWindowOpenHandler(({ url }) => {
        console.log('[OAuth] Window open requested for:', url.split('?')[0]);
        const isMicrosoftAuthUrl = typeof url === 'string' && (
          url.includes('login.microsoftonline.com') ||
          url.includes('login.live.com') ||
          url.includes('consent.microsoftonline.com')
        );

        if (isMicrosoftAuthUrl) {
          console.log('[OAuth] Loading Microsoft auth popup URL in same window');
          authWindow.loadURL(url).catch((loadError) => {
            console.error('[OAuth] Failed to load auth popup URL:', loadError.message);
          });
          return { action: 'deny' };
        }

        console.log('[OAuth] Opening external URL:', url.split('?')[0]);
        shell.openExternal(url).catch(() => {});
        return { action: 'deny' };
      });

      const cleanup = () => {
        try {
          if (!authWindow.isDestroyed()) {
            authWindow.close();
          }
        } catch (cleanupError) {
          console.warn('Cleanup error after Microsoft OAuth:', cleanupError.message);
        }
        global.oauthCallbackHandler = null;
      };

      const handleCallbackUrl = async (url) => {
        if (!url || !url.startsWith(callbackUri)) {
          return false;
        }

        console.log('[OAuth] Intercepted callback URL:', url.split('?')[0]);
        try {
          const authResult = await services.microsoftOauthService.handleCallbackUrl(url);
          completed = true;
          resolve(authResult);
          cleanup();
          return true;
        } catch (error) {
          completed = true;
          reject(error);
          cleanup();
          return true;
        }
      };

      // Register the global OAuth callback handler for Windows protocol redirect
      global.oauthCallbackHandler = (url) => {
        handleCallbackUrl(url);
      };

      const webContents = authWindow.webContents;
      
      // Intercept will-redirect
      webContents.on('will-redirect', (event, url) => {
        console.log('[OAuth] will-redirect event:', url.split('?')[0]);
        if (handleCallbackUrl(url)) {
          event.preventDefault();
        }
      });

      // Intercept will-navigate
      webContents.on('will-navigate', (event, url) => {
        console.log('[OAuth] will-navigate event:', url.split('?')[0]);
        if (handleCallbackUrl(url)) {
          event.preventDefault();
        }
      });

      // Handle navigation failures (custom protocol redirect will fail to load)
      webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame, frameProcessId, frameRoutingId) => {
        console.log('[OAuth] did-fail-load:', { errorCode, errorDescription, url: validatedURL?.split('?')[0], isMainFrame });
        if (validatedURL && validatedURL.startsWith(callbackUri)) {
          console.log('[OAuth] Callback URL failed to load (expected for protocol), processing callback');
          if (!completed) {
            handleCallbackUrl(validatedURL);
          }
        }
      });

      // Timeout after 5 minutes - if no callback by then, something went wrong
      const timeoutHandle = setTimeout(() => {
        if (!completed) {
          console.error('[OAuth] Authorization timeout - no callback received within 5 minutes');
          completed = true;
          cleanup();
          reject(new Error('Microsoft Graph authorization timed out. Please try again.'));
        }
      }, 300000);

      authWindow.on('closed', () => {
        clearTimeout(timeoutHandle);
        if (!completed) {
          reject(new Error('Microsoft Graph authorization window was closed before completion.'));
        }
      });

      console.log('[OAuth] Loading authorization URL:', authorization.url.split('?')[0]);
      authWindow.loadURL(authorization.url).catch((loadError) => {
        if (!completed) {
          clearTimeout(timeoutHandle);
          completed = true;
          cleanup();
          reject(new Error(`Failed to open Microsoft Graph authorization window: ${loadError.message}`));
        }
      });
    });

    return { ok: true, data: result };
  }));

  ipcMain.handle('accounts:test', wrapHandler(async (payload) => {
    try {
      const progressCallback = (message) => {
        emitProgress('process:update', {
          title: 'Testing Connection',
          message,
          progress: 0,
          total: 0  // Indeterminate progress
        });
      };

      let result;
      if (payload?.id) {
        result = await services.accountsDiagnosticsService.testSavedAccount(payload.id, progressCallback);
      } else {
        result = await services.accountsDiagnosticsService.testConnection(payload || {}, progressCallback);
      }

      return {
        ok: true,
        data: result
      };
    } catch (error) {
      emitProgress('process:error', {
        title: 'Test Failed',
        message: error.message
      });
      throw error;
    }
  }));

  ipcMain.handle('accounts:delete', wrapHandler(async (payload) => ({
    ok: true,
    data: await services.accountsService.remove(payload.id)
  })));

  ipcMain.handle('campaigns:list', wrapHandler(async () => ({
    ok: true,
    data: await services.campaignsService.list()
  })));

  ipcMain.handle('campaigns:create', wrapHandler(async (payload) => ({
    ok: true,
    data: await services.campaignsService.create(payload || {})
  })));

  ipcMain.handle('campaigns:update-status', wrapHandler(async (payload) => ({
    ok: true,
    data: await services.campaignsService.updateStatus(payload || {})
  })));

  ipcMain.handle('campaigns:update', wrapHandler(async (payload) => ({
    ok: true,
    data: await services.campaignsService.update(payload || {})
  })));

  ipcMain.handle('campaigns:delete', wrapHandler(async (payload) => ({
    ok: true,
    data: await services.campaignsService.delete(payload || {})
  })));

  ipcMain.handle('recipients:list', wrapHandler(async () => ({
    ok: true,
    data: await services.recipientsService.list()
  })));

  ipcMain.handle('recipients:create', wrapHandler(async (payload) => ({
    ok: true,
    data: await services.recipientsService.create(payload || {})
  })));

  ipcMain.handle('recipients:import-csv', wrapHandler(async (payload) => ({
    ok: true,
    data: await services.recipientsService.importCsv(payload?.csvText || '')
  })));

  ipcMain.handle('recipients:import-csv-file', wrapHandler(async () => {
    const result = await dialog.showOpenDialog({
      title: 'Import Recipients CSV',
      properties: ['openFile'],
      filters: [
        { name: 'CSV Files', extensions: ['csv', 'txt'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });

    if (result.canceled || !result.filePaths.length) {
      return { ok: true, data: await services.recipientsService.list() };
    }

    const csvText = fs.readFileSync(result.filePaths[0], 'utf8');
    return {
      ok: true,
      data: await services.recipientsService.importCsv(csvText)
    };
  }));

  ipcMain.handle('recipients:export-csv', wrapHandler(async () => ({
    ok: true,
    data: await services.recipientsService.exportCsv()
  })));

  ipcMain.handle('recipients:delete', wrapHandler(async (payload) => ({
    ok: true,
    data: await services.recipientsService.deleteRecipient(payload?.id)
  })));

  ipcMain.handle('recipients:delete-multiple', wrapHandler(async (payload) => ({
    ok: true,
    data: await services.recipientsService.deleteRecipients(payload?.ids || [])
  })));

  ipcMain.handle('recipients:list-by-category', wrapHandler(async () => ({
    ok: true,
    data: await services.recipientsService.listByCategory()
  })));

  ipcMain.handle('segments:list', wrapHandler(async () => ({
    ok: true,
    data: await services.segmentsService.list()
  })));

  ipcMain.handle('segments:create', wrapHandler(async (payload) => ({
    ok: true,
    data: await services.segmentsService.create(payload || {})
  })));

  ipcMain.handle('segments:preview', wrapHandler(async (payload) => ({
    ok: true,
    data: await services.segmentsService.preview(payload || {})
  })));

  ipcMain.handle('segments:delete', wrapHandler(async (payload) => ({
    ok: true,
    data: await services.segmentsService.deleteSegment(payload?.id)
  })));

  ipcMain.handle('segments:delete-multiple', wrapHandler(async (payload) => ({
    ok: true,
    data: await services.segmentsService.deleteSegments(payload?.ids || [])
  })));

  ipcMain.handle('content:list-documents', wrapHandler(async () => ({
    ok: true,
    data: await services.contentService.listDocuments()
  })));

  ipcMain.handle('content:save-document', wrapHandler(async (payload) => ({
    ok: true,
    data: await services.contentService.saveDocument(payload || {})
  })));

  ipcMain.handle('content:delete-document', wrapHandler(async (payload) => ({
    ok: true,
    data: await services.contentService.deleteDocument(payload?.id)
  })));

  ipcMain.handle('content:pick-image', wrapHandler(async () => {
    const result = await dialog.showOpenDialog({
      title: 'Insert Image',
      properties: ['openFile'],
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }
      ]
    });

    if (result.canceled || !result.filePaths.length) {
      return { src: '', name: '' };
    }

    const filePath = result.filePaths[0];
    const mimeType = getMimeType(filePath);
    const base64 = fs.readFileSync(filePath).toString('base64');
    return {
      src: `data:${mimeType};base64,${base64}`,
      name: path.basename(filePath)
    };
  }));

  ipcMain.handle('content:pick-attachment', wrapHandler(async () => {
    const result = await dialog.showOpenDialog({
      title: 'Add Attachment',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Common Files', extensions: ['pdf', 'txt', 'csv', 'doc', 'docx', 'xls', 'xlsx', 'zip', 'png', 'jpg', 'jpeg'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });

    if (result.canceled || !result.filePaths.length) {
      return [];
    }

    return result.filePaths.map((filePath) => {
      const content = fs.readFileSync(filePath).toString('base64');
      const stats = fs.statSync(filePath);
      return {
        filename: path.basename(filePath),
        content,
        contentType: getMimeType(filePath),
        size: stats.size
      };
    });
  }));

  ipcMain.handle('content:analyze', wrapHandler(async (payload) => ({
    ok: true,
    data: services.contentService.analyze(payload || {})
  })));

  ipcMain.handle('ai:settings-get', wrapHandler(async () => ({
    ok: true,
    data: await services.aiRewriteService.getSettings()
  })));

  ipcMain.handle('ai:settings-update', wrapHandler(async (payload) => ({
    ok: true,
    data: await services.aiRewriteService.updateSettings(payload || {})
  })));

  ipcMain.handle('ai:provider-presets', wrapHandler(async () => ({
    ok: true,
    data: services.aiRewriteService.getProviderPresets()
  })));

  ipcMain.handle('ai:test-connection', wrapHandler(async (payload) => ({
    ok: true,
    data: await services.aiRewriteService.testConnection(payload || {})
  })));

  ipcMain.handle('ai:rewrite-email', wrapHandler(async (payload) => ({
    ok: true,
    data: await services.aiRewriteService.rewriteEmail(payload || {})
  })));

  ipcMain.handle('ai:process-email', wrapHandler(async (payload) => ({
    ok: true,
    data: await services.aiRewriteService.processEmail(payload || {})
  })));

  ipcMain.handle('deliverability:analyze', wrapHandler(async (payload) => ({
    ok: true,
    data: await services.deliverabilityService.analyze(payload || {})
  })));

  ipcMain.handle('ops:domains:list', wrapHandler(async () => ({
    ok: true,
    data: services.operations.domainService.listDomains()
  })));

  ipcMain.handle('ops:domains:add', wrapHandler(async (payload) => ({
    ok: true,
    data: services.operations.domainService.addDomain(payload || {})
  })));

  ipcMain.handle('ops:domains:inspect', wrapHandler(async (payload) => ({
    ok: true,
    data: await services.operations.domainService.inspectDomain(payload || {})
  })));

  ipcMain.handle('ops:ip-pools:list', wrapHandler(async () => ({
    ok: true,
    data: services.operations.domainService.listIpPools()
  })));

  ipcMain.handle('ops:ip-pools:add', wrapHandler(async (payload) => ({
    ok: true,
    data: services.operations.domainService.addIpPool(payload || {})
  })));

  ipcMain.handle('ops:analytics:snapshot', wrapHandler(async () => ({
    ok: true,
    data: await services.operations.analyticsService.snapshot()
  })));

  ipcMain.handle('ops:compliance:list', wrapHandler(async () => ({
    ok: true,
    data: services.operations.complianceService.listEvents()
  })));

  ipcMain.handle('ops:compliance:record', wrapHandler(async (payload) => ({
    ok: true,
    data: services.operations.complianceService.record(payload || {})
  })));

  ipcMain.handle('ops:deliverability:preflight', wrapHandler(async (payload) => ({
    ok: true,
    data: await services.operations.deliverabilityPlannerService.preflight(payload || {})
  })));

  ipcMain.handle('ops:proxies:list', wrapHandler(async () => ({
    ok: true,
    data: await services.operations.proxyService.list()
  })));

  ipcMain.handle('ops:proxies:add', wrapHandler(async (payload) => ({
    ok: true,
    data: await services.operations.proxyService.create(payload || {})
  })));

  ipcMain.handle('ops:proxies:test', wrapHandler(async (payload) => ({
    ok: true,
    data: await services.operations.proxyService.test(payload?.id)
  })));

  ipcMain.handle('ops:proxies:delete', wrapHandler(async (payload) => ({
    ok: true,
    data: await services.operations.proxyService.remove(payload?.id)
  })));

  ipcMain.handle('sends:settings-get', wrapHandler(async () => ({
    ok: true,
    data: await services.sendSettingsService.get()
  })));

  ipcMain.handle('sends:settings-update', wrapHandler(async (payload) => ({
    ok: true,
    data: await services.sendSettingsService.update(payload || {})
  })));

  ipcMain.handle('sends:address-suggestions', wrapHandler(async (payload) => ({
    ok: true,
    data: services.sendSettingsService.getAddressSuggestions(payload?.query || '')
  })));

  ipcMain.handle('sends:global-status', wrapHandler(async () => ({
    ok: true,
    data: await services.sendQueueService.getGlobalStatus()
  })));

  ipcMain.handle('sends:campaign-status', wrapHandler(async (payload) => ({
    ok: true,
    data: await services.sendQueueService.getCampaignStatus(payload?.campaignId)
  })));

  ipcMain.handle('sends:start-campaign', wrapHandler(async (payload) => ({
    ok: true,
    data: await services.sendQueueService.enqueueCampaign(payload?.campaignId)
  })));

  ipcMain.handle('sends:send-now', wrapHandler(async (payload) => {
    const campaignId = payload?.campaignId;
    
    try {
      emitProgress('process:update', {
        title: 'Starting Campaign Send',
        message: 'Preparing campaign for sending...',
        progress: 0,
        total: 0
      });

      emitProgress('process:update', {
        title: 'Sending Campaign',
        message: 'Enqueueing recipients...',
        progress: 0,
        total: 0
      });

      const result = await services.sendQueueService.enqueueCampaign(campaignId);
      
      return {
        ok: true,
        data: result
      };
    } catch (error) {
      emitProgress('process:error', {
        title: 'Send Failed',
        message: error.message
      });
      throw error;
    }
  }));

  ipcMain.handle('sends:pause-campaign', wrapHandler(async (payload) => ({
    ok: true,
    data: await services.sendQueueService.pauseCampaign(payload?.campaignId)
  })));

  ipcMain.handle('sends:resume-campaign', wrapHandler(async (payload) => ({
    ok: true,
    data: await services.sendQueueService.resumeCampaign(payload?.campaignId)
  })));

  ipcMain.handle('sends:preflight', wrapHandler(async (payload) => ({
    ok: true,
    data: await services.sendPreflightService.validateCampaign(
      payload?.campaignId,
      await services.sendSettingsService.get()
    )
  })));

  ipcMain.handle('sends:queue-log', wrapHandler(async (payload) => ({
    ok: true,
    data: await services.sendQueueService.getQueueLog(payload?.limit || 40)
  })));

  ipcMain.handle('sends:provider-presets', wrapHandler(async () => ({
    ok: true,
    data: services.sendSettingsService.getProviderPresets()
  })));

  ipcMain.handle('events:list', wrapHandler(async (payload) => ({
    ok: true,
    data: await services.eventLogService.list(payload?.limit || 100)
  })));

  ipcMain.handle('webhooks:list', wrapHandler(async () => ({
    ok: true,
    data: await services.webhookService.list()
  })));

  ipcMain.handle('webhooks:add', wrapHandler(async (payload) => ({
    ok: true,
    data: await services.webhookService.create(payload || {})
  })));

  ipcMain.handle('webhooks:delete', wrapHandler(async (payload) => ({
    ok: true,
    data: await services.webhookService.remove(payload?.id)
  })));

  ipcMain.handle('hygiene:validate', wrapHandler(async () => ({
    ok: true,
    data: await services.listHygieneService.validateRecipients()
  })));

  ipcMain.handle('hygiene:suppressions', wrapHandler(async () => ({
    ok: true,
    data: await services.listHygieneService.getSuppressionList()
  })));

  ipcMain.handle('reputation:snapshot', wrapHandler(async () => ({
    ok: true,
    data: await services.reputationService.snapshot()
  })));

  ipcMain.handle('reputation:record', wrapHandler(async (payload) => ({
    ok: true,
    data: await services.reputationService.record(payload || {})
  })));

  ipcMain.handle('accounts:auth-health', wrapHandler(async () => ({
    ok: true,
    data: await services.sendPreflightService.getAccountAuthHealth()
  })));
}

module.exports = { initializeRuntime, registerIpcHandlers };
