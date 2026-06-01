const path = require('path');
const { spawn } = require('child_process');

const electronBinary = require('electron');
const projectRoot = path.resolve(__dirname, '..');
const env = { ...process.env };

delete env.ELECTRON_RUN_AS_NODE;

const isWin32 = process.platform === 'win32';

const child = spawn(electronBinary, [projectRoot], {
  cwd: projectRoot,
  stdio: 'inherit',
  env,
  shell: isWin32,
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
