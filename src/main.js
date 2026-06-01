const { app, BrowserWindow, Menu, ipcMain, shell, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');

const { initializeRuntime, registerIpcHandlers } = require('./core/appRuntime');

const isDevelopment = process.env.NODE_ENV !== 'production';
let mainWindow = null;
let runtime = null;

if (!app.isPackaged && isDevelopment) {
  const devUserDataPath = path.resolve(__dirname, '..', 'data', 'desktop');
  fs.mkdirSync(devUserDataPath, { recursive: true });
  app.setPath('userData', devUserDataPath);
}

app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('disable-accelerated-2d-canvas');
app.commandLine.appendSwitch('disk-cache-dir', path.join(os.tmpdir(), 'phantom-electron-cache'));
app.disableHardwareAcceleration();

if (!app.isPackaged && isDevelopment) {
  const devUserDataPath = path.resolve(__dirname, '..', 'data', 'desktop');
  fs.mkdirSync(devUserDataPath, { recursive: true });
  app.setPath('userData', devUserDataPath);
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
}

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
      sandbox: false
    }
  };

  mainWindow = new BrowserWindow(windowOptions);

  if (savedState?.isMaximized) {
    mainWindow.maximize();
  }

  Menu.setApplicationMenu(null);
  const rendererIndexPath = path.resolve(__dirname, 'renderer', 'index.html');
  const rendererIndexUrl = pathToFileURL(rendererIndexPath).toString();
  mainWindow.loadURL(rendererIndexUrl).catch((error) => {
    console.error('Failed to load renderer:', error, rendererIndexUrl);
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
    if (!url.startsWith('file://')) {
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
  if (!mainWindow) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.focus();

  // Handle protocol redirect on Windows: check if argv contains our custom protocol
  const protocolUrl = argv.find((arg) => arg.startsWith('com.emclient.MailClient://'));
  if (protocolUrl && global.oauthCallbackHandler) {
    global.oauthCallbackHandler(protocolUrl);
  }
});

// Handle protocol redirect on macOS
if (process.platform === 'darwin') {
  app.on('open-url', (event, url) => {
    event.preventDefault();
    if (url && url.startsWith('com.emclient.MailClient://') && global.oauthCallbackHandler) {
      global.oauthCallbackHandler(url);
    }
  });
}

app.whenReady().then(async () => {
  runtime = await initializeRuntime(app);
  createWindow();
  registerIpcHandlers(ipcMain, runtime, app, mainWindow);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
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
