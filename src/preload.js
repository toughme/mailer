const { contextBridge, ipcRenderer } = require('electron');

const allowedChannels = new Set([
  'app:bootstrap',
  'dashboard:get',
  'accounts:list',
  'accounts:create',
  'accounts:graph-authorize',
  'accounts:test',
  'accounts:delete',
  'campaigns:list',
  'campaigns:create',
  'campaigns:update-status',
  'campaigns:update',
  'campaigns:delete',
  'recipients:list',
  'recipients:create',
  'recipients:import-csv',
  'recipients:import-csv-file',
  'recipients:export-csv',
  'recipients:delete',
  'recipients:delete-multiple',
  'recipients:list-by-category',
  'segments:list',
  'segments:create',
  'segments:preview',
  'segments:delete',
  'segments:delete-multiple',
  'content:list-documents',
  'content:save-document',
  'content:delete-document',
  'content:pick-image',
  'content:pick-attachment',
  'content:analyze',
  'deliverability:analyze',
  'ops:domains:list',
  'ops:domains:add',
  'ops:domains:inspect',
  'ops:ip-pools:list',
  'ops:ip-pools:add',
  'ops:analytics:snapshot',
  'ops:compliance:list',
  'ops:compliance:record',
  'ops:deliverability:preflight',
  'ops:proxies:list',
  'ops:proxies:add',
  'ops:proxies:test',
  'ops:proxies:delete',
  'sends:settings-get',
  'sends:settings-update',
  'sends:global-status',
  'sends:campaign-status',
  'sends:start-campaign',
  'sends:send-now',
  'sends:pause-campaign',
  'sends:resume-campaign',
  'sends:preflight',
  'sends:queue-log',
  'sends:provider-presets',
  'accounts:auth-health',
  'events:list',
  'webhooks:list',
  'webhooks:add',
  'webhooks:delete',
  'hygiene:validate',
  'hygiene:suppressions',
  'reputation:snapshot',
  'reputation:record',
  'ai:settings-get',
  'ai:settings-update',
  'ai:provider-presets',
  'ai:test-connection',
  'ai:rewrite-email',
  'ai:process-email'
]);

contextBridge.exposeInMainWorld('phantomDesktop', {
  invoke(channel, payload) {
    if (!allowedChannels.has(channel)) {
      throw new Error(`Unauthorized channel: ${channel}`);
    }

    return ipcRenderer.invoke(channel, payload);
  },
  on(channel, handler) {
    // Only allow listening to specific system channels
    if (!channel.startsWith('process:')) {
      throw new Error(`Unauthorized channel: ${channel}`);
    }
    ipcRenderer.on(channel, handler);
  },
  off(channel, handler) {
    if (!channel.startsWith('process:')) {
      throw new Error(`Unauthorized channel: ${channel}`);
    }
    ipcRenderer.off(channel, handler);
  }
});
