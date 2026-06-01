const path = require('path');
const electronInstaller = require('electron-winstaller');

async function createInstaller() {
  const appDirectory = path.join(__dirname, '..', 'dist', 'PhantomMailer 2026-win32-x64');
  const outputDirectory = path.join(__dirname, '..', 'dist', 'windows-installer');

  console.log('Creating Windows installer from:', appDirectory);
  console.log('Installer output directory:', outputDirectory);

  try {
    await electronInstaller.createWindowsInstaller({
      appDirectory,
      outputDirectory,
      authors: 'PhantomMailer Team',
      exe: 'PhantomMailer 2026.exe',
      noMsi: true,
      setupExe: 'PhantomMailer2026-Setup.exe'
    });

    console.log('Windows installer created successfully.');
  } catch (error) {
    console.error('Failed to create Windows installer:', error);
    process.exit(1);
  }
}

createInstaller();
