/* Electron main process: frameless window + Python backend sidecar.
 *
 * Dev:     vite on http://localhost:5173, backend from `python -m backend.app`.
 * Packaged: backend from the PyInstaller bundle in resources/backend/,
 *           frontend from frontend/dist/. No browser, no localhost tabs.
 *
 * The renderer reaches the backend over HTTP (see frontend/src/api.js; the
 * port arrives via --backend-port, exposed synchronously by preload.cjs) and
 * reaches Electron-only features (folder dialog, window controls) through
 * window.electron.
 */

const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const { randomBytes } = require('node:crypto');
const { spawn } = require('node:child_process');
const path = require('node:path');
const net = require('node:net');
const fs = require('node:fs');

const isDev = !app.isPackaged;

// Single instance, like any real desktop app: a second launch just
// focuses the existing window instead of spawning a second backend.
const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();

let backendProc = null;
let backendToken = '';
let backendPort = Number(process.env.SIMPLD_PORT || 8000);
let mainWindow = null;
let quitting = false;

function backendBin() {
  if (process.env.BACKEND_BIN) return process.env.BACKEND_BIN;
  if (!app.isPackaged) return null; // dev: use `python -m backend.app`
  const exe = process.platform === 'win32' ? 'simpld-backend.exe' : 'simpld-backend';
  const bundled = path.join(process.resourcesPath, 'backend', exe);
  if (fs.existsSync(bundled)) return bundled;
  // Fallback for unpacked/portable layouts.
  const sibling = path.join(path.dirname(app.getPath('exe')), 'backend', exe);
  if (fs.existsSync(sibling)) return sibling;
  return null;
}

function findFreePort(start) {
  return new Promise((resolve) => {
    const tryPort = (port) => {
      const srv = net.createServer();
      srv.once('error', () => tryPort(port + 1));
      srv.once('listening', () => srv.close(() => resolve(port)));
      srv.listen(port, '127.0.0.1');
    };
    tryPort(start);
  });
}

function backendHealth(port) {
  return fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1000) })
    .then((r) => r.ok)
    .catch(() => false);
}

async function waitForBackend(port, timeoutMs = 45000) {
  const start = Date.now();
  for (;;) {
    if (await backendHealth(port)) return true;
    if (!backendProc || Date.now() - start > timeoutMs) return false;
    await new Promise((r) => setTimeout(r, 300));
  }
}

function startBackend(port) {
  const projectRoot = path.join(__dirname, '..');
  backendToken = randomBytes(32).toString('hex');
  const env = {
    ...process.env,
    SIMPLD_PORT: String(port),
    SIMPLD_WATCH_STDIN: '1',
    SIMPLD_BACKEND_TOKEN: backendToken,
  };
  const bin = backendBin();
  if (bin) {
    console.log(`starting backend: ${bin}`);
    backendProc = spawn(bin, [], { env, stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true });
  } else {
    const py = process.platform === 'win32' ? 'python' : 'python3';
    console.log(`starting backend: ${py} -m backend.app`);
    backendProc = spawn(py, ['-m', 'backend.app'], { cwd: projectRoot, env, stdio: ['pipe', 'inherit', 'inherit'], windowsHide: true });
  }
  backendProc.once('close', () => { backendProc = null; });
  backendProc.on('error', (err) => console.error('backend failed to start:', err));
  backendProc.stdin.on('error', (err) => {
    if (err.code !== 'EPIPE') console.error('backend stdin failed:', err);
  });
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    // Hidden title bar with native caption buttons: the web page keeps drawing
    // its own header (TopBar/SettingsPage), -webkit-app-region strips give the
    // native drag, and Windows paints the system minimize/maximize/close
    // buttons in the header's top-right. The overlay color matches --bg so the
    // native strip blends into the pane instead of reading as a separate bar.
    titleBarStyle: 'hidden',
    ...(process.platform === 'win32'
      ? { titleBarOverlay: { color: '#00000000', symbolColor: '#c9c9c6', height: 40 } }
      : {}),
    backgroundColor: '#232323',
    icon: path.join(__dirname, '..', 'Logo.png'),
    show: false, // show when ready, no white flash
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      // Sync channel for the backend port; preload parses this. Keeps the
      // file:// renderer working with zero race (no executeJavaScript timing).
      additionalArguments: [`--backend-port=${port}`, `--backend-token=${backendToken}`],
    },
  });

  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (['https:', 'http:'].includes(new URL(url).protocol)) {
      shell.openExternal(url).catch(console.error);
    }
    return { action: 'deny' };
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'frontend', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => { mainWindow = null; });
  // Zoom shortcuts: Electron has no default menu/accelerators, so Ctrl/Cmd
  // +/-/0 do nothing unless we handle them here. Also covers the numpad.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (!(input.control || input.meta)) return;
    const wc = mainWindow.webContents;
    const key = input.key;
    if (key === '=' || key === '+' || key === 'Add') {
      wc.setZoomFactor(Math.min(3, Math.round((wc.getZoomFactor() + 0.1) * 10) / 10));
      event.preventDefault();
    } else if (key === '-' || key === 'Subtract') {
      wc.setZoomFactor(Math.max(0.25, Math.round((wc.getZoomFactor() - 0.1) * 10) / 10));
      event.preventDefault();
    } else if (key === '0' || key === 'NumPad0') {
      wc.setZoomFactor(1.0);
      event.preventDefault();
    }
  });
}

ipcMain.handle('dialog:open-folder', async () => {
  const res = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (res.canceled || res.filePaths.length === 0) return null;
  return res.filePaths[0];
});

let updateStatus = { phase: 'idle' };

function publishUpdate(phase, fields = {}) {
  updateStatus = { phase, ...fields };
  mainWindow?.webContents.send('update:status', updateStatus);
}

async function checkForUpdates() {
  if (['checking', 'available', 'downloading', 'ready'].includes(updateStatus.phase)) return;
  publishUpdate('checking');
  try {
    const result = await autoUpdater.checkForUpdates();
    if (result === null && updateStatus.phase === 'checking') {
      publishUpdate('failed', { error: 'Updates are available in packaged builds.' });
    }
  } catch (err) {
    publishUpdate('failed', { error: err.message });
  }
}

ipcMain.handle('update:status', () => updateStatus);
ipcMain.handle('update:check', checkForUpdates);
ipcMain.handle('update:install', () => {
  if (updateStatus.phase === 'ready') autoUpdater.quitAndInstall();
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

if (ownsInstance) app.whenReady().then(async () => {
  if (!(isDev && process.env.SIMPLD_PORT && await backendHealth(backendPort))) {
    backendPort = await findFreePort(backendPort);
    startBackend(backendPort);
    if (!(await waitForBackend(backendPort))) console.error('backend did not become healthy in time');
  }
  createWindow(backendPort);

  // Auto-update from GitHub Releases (published by the release workflow).
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-available', (info) => publishUpdate('available', { version: info.version }));
  autoUpdater.on('update-not-available', () => publishUpdate('current'));
  autoUpdater.on('download-progress', (info) => publishUpdate('downloading', {
    version: updateStatus.version, progress: Math.round(info.percent),
  }));
  autoUpdater.on('update-downloaded', (info) => publishUpdate('ready', { version: info.version }));
  autoUpdater.on('error', (err) => publishUpdate('failed', { error: err.message }));
  if (!isDev) void checkForUpdates();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(backendPort);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', (event) => {
  if (!backendProc) return;
  event.preventDefault();
  if (quitting) return;
  quitting = true;
  const child = backendProc;
  const timer = setTimeout(() => child.kill(), 8000);
  child.once('close', () => {
    clearTimeout(timer);
    app.quit();
  });
  child.stdin.end();
});
