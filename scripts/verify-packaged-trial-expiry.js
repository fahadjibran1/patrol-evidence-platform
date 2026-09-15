const fs = require('fs');
const path = require('path');

function fail(message) {
  throw new Error(`PACKAGED_TRIAL_EXPIRY_VERIFY_FAILED ${message}`);
}

const packagedRoot = path.resolve(process.argv[2] || path.join(__dirname, '..', 'out', 'PatrolSafe by S4-win32-x64'));
const appRoot = path.join(packagedRoot, 'resources', 'app');
const packageMetadata = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
const buildInfo = JSON.parse(fs.readFileSync(path.join(appRoot, 'build-info.json'), 'utf8'));
if (packageMetadata.version !== '1.0.1' || buildInfo.version !== '1.0.1') {
  fail(`expected v1.0.1 metadata, got package=${packageMetadata.version} build=${buildInfo.version}`);
}

const lifecyclePath = path.join(appRoot, 'dist', 'collectors', 'whatsapp-entitlement-lifecycle.util.js');
if (!fs.existsSync(lifecyclePath)) {
  fail(`missing compiled lifecycle utility: ${lifecyclePath}`);
}
const lifecycle = require(lifecyclePath);
const expiry = '2026-10-15T12:01:00.000Z';
if (lifecycle.entitlementExpiryBoundaryMs({ expiresAt: expiry }) !== Date.parse(expiry) + 1) {
  fail('compiled exact entitlement boundary is incorrect');
}
if (
  lifecycle.monitoringEntitlementRestriction({
    mode: 'trial',
    status: 'expired',
    collectorAllowed: false,
  }) !== 'TRIAL_EXPIRED'
) {
  fail('compiled expired-trial classification is incorrect');
}

const collectorPath = path.join(appRoot, 'dist', 'collectors', 'whatsapp-collector.service.js');
const collector = fs.readFileSync(collectorPath, 'utf8');
for (const marker of [
  'assertEntitlementForHelperIngest',
  'scheduleEntitlementRecheck',
  'set-production-monitoring',
  'Your 30-day PatrolSafe trial has ended.',
]) {
  if (!collector.includes(marker)) {
    fail(`compiled collector is missing ${marker}`);
  }
}
const transitionStart = collector.lastIndexOf('applyEntitlementRestriction(');
const transitionEnd = collector.indexOf('clearEntitlementRestriction(', transitionStart);
const transition = collector.slice(transitionStart, transitionEnd);
if (transition.includes('stopHelperProcess') || transition.includes('archiveCurrentSession') || transition.includes('.logout(')) {
  fail('expiry transition contains a destructive WhatsApp-session action');
}

console.log(`PACKAGED_TRIAL_EXPIRY_VERIFY_PASSED version=${packageMetadata.version} buildId=${buildInfo.displayBuild}`);
