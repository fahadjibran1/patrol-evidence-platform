/**
 * Development-only local trial reset. Refuses to run when NODE_ENV=production.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to reset trial markers while NODE_ENV=production.');
  process.exit(1);
}

const dataRoot =
  process.env.PATROL_LICENSE_DATA_ROOT?.trim() ||
  (process.env.DESKTOP_CONFIG_PATH?.trim()
    ? path.dirname(process.env.DESKTOP_CONFIG_PATH.trim())
    : path.join(process.env.APPDATA || os.homedir(), 'Patrol Evidence Platform'));

for (const relative of ['trial.dpapi', 'trial-marker.txt']) {
  const target = path.join(dataRoot, relative);
  if (fs.existsSync(target)) {
    fs.unlinkSync(target);
    console.log(`Removed ${target}`);
  }
}

if (process.platform === 'win32') {
  try {
    execFileSync(
      'reg',
      ['delete', 'HKCU\\Software\\TechGuard\\PatrolEvidencePlatform', '/v', 'TrialMarker', '/f'],
      { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true },
    );
    console.log('Removed HKCU TrialMarker');
  } catch {
    console.log('HKCU TrialMarker was not present');
  }
}

console.log(
  'Development trial markers cleared. Restart the desktop app to mint a new trial only if no commercial licence is present.',
);
