const { app, BrowserWindow, Menu, ipcMain, shell, screen, session, protocol } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { initializeRuntime, registerIpcHandlers } = require('./core/appRuntime');

const isDevelopment = process.env.NODE_ENV !== 'production';
const devUserDataPath = path.resolve(os.tmpdir(), 'phantom-mailer-dev', 'desktop');
const devCachePath = path.join(devUserDataPath, 'Cache');
let mainWindow = null;
let runtime = null;

global._pendingProtocolUrls = global._pendingProtocolUrls || [];

const protocolPrefix = 'com.emclient.MailClient://';
const extractProtocolUrl = (arg) => {
  if (!arg) {
    return null;
  }

  const value = String(arg).trim();
  const lowerValue = value.toLowerCase();
  const lowerPrefix = protocolPrefix.toLowerCase();
  const index = lowerValue.indexOf(lowerPrefix);
  if (index === -1) {
    return null;
  }

  return value.substring(index);
};

global.processProtocolUrl = (url) => {
  const extractedUrl = extractProtocolUrl(url);
  if (!extractedUrl) {
    console.log('[Main] Received non-protocol or malformed URL; ignoring:', url);
    return;
  }

  if (global.oauthCallbackHandler) {
    console.log('[Main] Processing protocol callback directly with handler ready:', extractedUrl);
    global.oauthCallbackHandler(extractedUrl);
  } else {
    global._pendingProtocolUrls = global._pendingProtocolUrls || [];
    console.log('[Main] Queuing protocol URL until handler is ready:', extractedUrl);
    global._pendingProtocolUrls.push(extractedUrl);
    console.log('[Main] Pending protocol queue length:', global._pendingProtocolUrls.length);
  }
};

if (!app.isPackaged && isDevelopment) {
  fs.mkdirSync(devCachePath, { recursive: true });
  app.setPath('userData', devUserDataPath);
  app.commandLine.appendSwitch('disk-cache-dir', devCachePath);
}

app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('disable-accelerated-2d-canvas');
app.commandLine.appendSwitch('disable-application-cache');
app.commandLine.appendSwitch('disable-cache');
app.commandLine.appendSwitch('disable-threaded-animation');
app.commandLine.appendSwitch('disable-threaded-scrolling');
app.commandLine.appendSwitch('ignore-gpu-blacklist');
app.commandLine.appendSwitch('disable-gpu-driver-bug-workarounds');
app.commandLine.appendSwitch('disable-features', 'VizDisplayCompositor');
app.commandLine.appendSwitch('use-gl', 'swiftshader');
app.disableHardwareAcceleration();

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
}

app.on('ready', () => {
  try {
    protocol.registerFileProtocol('app', (request, callback) => {
      const url = request.url.substring('app://'.length);
      const decodedPath = decodeURIComponent(url);
      const filePath = path.join(__dirname, decodedPath);
      callback(filePath);
    });
  } catch (error) {
    console.warn('[Main] Could not register app:// protocol:', error.message);
  }
});

// Queue protocol URLs that may arrive before an OAuth handler is registered
global._pendingProtocolUrls = global._pendingProtocolUrls || [];
try {
  if (app.isPackaged) {
    app.setAsDefaultProtocolClient('com.emclient.MailClient');
  } else {
    const appPath = path.resolve(process.argv[1] || path.join(__dirname, '..', 'main.js'));
    app.setAsDefaultProtocolClient('com.emclient.MailClient', process.execPath, [appPath]);
  }
} catch (error) {
  console.warn('Unable to register custom protocol handler:', error.message);
}

function getWindowStateFile() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function loadWindowState() {
  try {
    const filePath = getWindowStateFile();
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch (error) {
    console.error('Failed to load window state:', error);
  }
  return null;
}

function saveWindowState(window) {
  try {
    const bounds = window.getBounds();
    const state = {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      isMaximized: window.isMaximized(),
    };
    fs.writeFileSync(getWindowStateFile(), JSON.stringify(state));
  } catch (error) {
    console.error('Failed to save window state:', error);
  }
}

function createWindow() {

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

  const savedState = loadWindowState();
  const defaultWidth = Math.round(screenWidth * 0.6);
  const defaultHeight = Math.round(screenHeight * 0.6);

  const windowOptions = {
    width: savedState?.width || defaultWidth,
    height: savedState?.height || defaultHeight,
    x: savedState?.x,
    y: savedState?.y,
    minWidth: 1024,
    minHeight: 600,
    backgroundColor: '#f3efe6',
    show: false,
    title: 'PhantomMailer 2026',
    autoHideMenuBar: true,
    menuBarVisible: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  };

  mainWindow = new BrowserWindow(windowOptions);

  if (savedState?.isMaximized) {
    mainWindow.maximize();
  }

  Menu.setApplicationMenu(null);
  const rendererIndexPath = path.resolve(__dirname, 'renderer', 'index.html');
  const rendererRelativePath = path.relative(__dirname, rendererIndexPath).replace(/\\/g, '/');
  console.log('[Main] Renderer index path:', rendererIndexPath, 'exists:', fs.existsSync(rendererIndexPath));
  try {
    const html = fs.readFileSync(rendererIndexPath, 'utf8');
    console.log('[Main] Read index.html length:', html.length);
  } catch (readError) {
    console.error('[Main] Failed to read index.html:', readError);
  }
  const appUrl = `app://${rendererRelativePath}`;
  console.log('[Main] Renderer index URL:', appUrl);
  mainWindow.loadURL(appUrl).catch((error) => {
    console.error('Failed to load renderer via app:// protocol:', error);
    console.log('[Main] Falling back to loadFile...');
    mainWindow.loadFile(rendererIndexPath).catch((fallbackError) => {
      console.error('Failed to load renderer file (fallback):', fallbackError, rendererIndexPath);
    });
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('close', () => {
    saveWindowState(mainWindow);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://') && !url.startsWith('app://')) {
      event.preventDefault();
      shell.openExternal(url).catch(() => {});
    }
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error('Renderer failed to load:', {
      errorCode,
      errorDescription,
      validatedURL
    });
  });

  mainWindow.webContents.on('render-process-gone', (event, details) => {
    console.error('Renderer process gone:', details);
  });

  mainWindow.webContents.on('crashed', () => {
    console.error('Renderer process crashed');
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.on('second-instance', (event, argv) => {
  console.log('[Main] second-instance event received:', { argvLength: argv.length });
  argv.forEach((arg, index) => console.log(`[Main] second-instance argv[${index}]=`, arg));

  if (!mainWindow) {
    console.log('[Main] second-instance received but mainWindow is not available yet');
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.focus();

  const protocolUrl = argv.map(extractProtocolUrl).find(Boolean);
  if (protocolUrl) {
    console.log('[Main] second-instance protocol URL detected:', protocolUrl);
    global.processProtocolUrl(protocolUrl);
  } else {
    console.log('[Main] second-instance no protocol URL found');
  }
});

// Handle protocol redirect on macOS
if (process.platform === 'darwin') {
  app.on('open-url', (event, url) => {
    console.log('[Main] macOS open-url event received:', url);
    event.preventDefault();
    global.processProtocolUrl(url);
  });
}

app.whenReady().then(async () => {
  runtime = await initializeRuntime(app);
  createWindow();
  registerIpcHandlers(ipcMain, runtime, app, mainWindow);

  // Process protocol callback URLs passed when this instance started.
  console.log('[Main] Startup argv count:', process.argv.length);
  process.argv.forEach((arg, index) => console.log(`[Main] startup argv[${index}]=`, arg));

  const protocolArgs = process.argv.map(extractProtocolUrl).filter(Boolean);
  console.log('[Main] Startup protocol arguments count:', protocolArgs.length);
  protocolArgs.forEach((arg) => {
    console.log('[Main] Startup protocol argument:', arg);
    global.processProtocolUrl(arg);
  });
}).catch((error) => {
  console.error('Application failed to start:', error);
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
