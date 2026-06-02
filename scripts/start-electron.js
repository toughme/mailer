const path = require('path');
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const env = { ...process.env };

delete env.ELECTRON_RUN_AS_NODE;

const isWin32 = process.platform === 'win32';
const localElectronZip = path.join(projectRoot, 'electron-v42.0.1-win32-x64.zip');
const localElectronDir = path.join(projectRoot, 'electron-local');
const localElectronExe = path.join(localElectronDir, 'electron.exe');

let electronBinary = null;

if (isWin32 && fs.existsSync(localElectronZip)) {
  if (!fs.existsSync(localElectronExe)) {
    console.log('Extracting local Electron ZIP from', localElectronZip);
    const command = `Expand-Archive -Force -Path "${localElectronZip}" -DestinationPath "${localElectronDir}"`;
    const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', command], {
      cwd: projectRoot,
      stdio: 'inherit'
    });

    if (result.status !== 0) {
      console.error('Failed to extract local Electron ZIP. Falling back to installed Electron package.');
    }
  }

  if (fs.existsSync(localElectronExe)) {
    electronBinary = localElectronExe;
  }
}

if (!electronBinary) {
  try {
    electronBinary = require('electron');
  } catch (error) {
    console.error('Unable to resolve installed electron package:', error.message);
    process.exit(1);
  }
}

console.log('Launching Electron binary:', electronBinary);
const child = spawn(electronBinary, [projectRoot], {
  cwd: projectRoot,
  stdio: 'inherit',
  env,
  windowsHide: true
});

child.on('exit', (code, signal) => {
  if (signal) {
    if (isWin32) {
      process.exit(1);
    } else {
      process.kill(process.pid, signal);
    }
    return;
  }

  process.exit(code ?? 0);
});

child.on('error', (error) => {
  console.error('Failed to launch Electron:', error);
  process.exit(1);
});
