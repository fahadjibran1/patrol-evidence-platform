#!/usr/bin/env node
/**
 * Offline commercial licence generator (operator machine only).
 *
 * Private key is loaded ONLY from LICENSE_PRIVATE_KEY_FILE (external path).
 * Never copy the private key into dist/, out/, resources/, or packaged apps.
 *
 * Usage:
 *   set LICENSE_PRIVATE_KEY_FILE=C:\secure\license-private.pem
 *   node tools/licence-generator/generate-licence.js --request path\to\file.tgreq --plan annual --out out.tglic
 */
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

function fail(message) {
  console.error(`LICENCE GENERATOR FAILED: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {
    request: null,
    plan: 'annual',
    out: null,
    company: null,
    startsAt: null,
    days: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];
    if (token === '--request') {
      args.request = next;
      i += 1;
    } else if (token === '--plan') {
      args.plan = next;
      i += 1;
    } else if (token === '--out') {
      args.out = next;
      i += 1;
    } else if (token === '--company') {
      args.company = next;
      i += 1;
    } else if (token === '--starts-at') {
      args.startsAt = next;
      i += 1;
    } else if (token === '--days') {
      args.days = Number(next);
      i += 1;
    }
  }

  return args;
}

function addDays(date, days) {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function resolveCore() {
  const candidates = [
    path.join(__dirname, '..', '..', 'packages', 'license-core', 'dist'),
    path.join(__dirname, '..', '..', 'packages', 'license-core', 'src'),
  ];

  for (const candidate of candidates) {
    const indexJs = path.join(candidate, 'index.js');
    if (fs.existsSync(indexJs)) {
      return require(indexJs);
    }
  }

  fail('Build @patrol/license-core first (npm --prefix packages/license-core run build).');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.request) {
    fail('Missing --request path to .tgreq file.');
  }

  if (!['annual', 'three_year', 'lifetime'].includes(args.plan)) {
    fail('--plan must be annual, three_year, or lifetime.');
  }

  const privateKeyPath = process.env.LICENSE_PRIVATE_KEY_FILE?.trim();
  if (!privateKeyPath) {
    fail('Set LICENSE_PRIVATE_KEY_FILE to an external Ed25519 private key PEM path.');
  }

  if (!fs.existsSync(privateKeyPath)) {
    fail(`Private key file not found: ${privateKeyPath}`);
  }

  // Refuse known packaging locations.
  const normalized = path.resolve(privateKeyPath).toLowerCase();
  for (const banned of ['\\dist\\', '\\out\\', '\\resources\\', '/dist/', '/out/', '/resources/']) {
    if (normalized.includes(banned)) {
      fail('Private key must not live under dist/, out/, or resources/.');
    }
  }

  const privateKeyPem = fs.readFileSync(privateKeyPath, 'utf8');
  const request = JSON.parse(fs.readFileSync(args.request, 'utf8'));
  const core = resolveCore();

  const startsAt = (args.startsAt || new Date().toISOString().slice(0, 10)).slice(0, 10);
  let expiresAt = null;
  if (args.plan === 'annual') {
    expiresAt = addDays(startsAt, args.days || 365);
  } else if (args.plan === 'three_year') {
    expiresAt = addDays(startsAt, args.days || 365 * 3);
  }

  const payload = {
    version: 1,
    licenceId: `lic-${randomUUID()}`,
    installationId: request.installationId,
    machineFingerprint: request.machineFingerprint,
    companyName: args.company?.trim() || request.companyName,
    plan: args.plan,
    issuedAt: new Date().toISOString().slice(0, 10),
    startsAt,
    expiresAt,
    features: core.ALL_LICENCE_FEATURES || core.defaultFeaturesForPlan(args.plan),
    product: request.product || 'Patrol Evidence Platform',
    maxDevices: 1,
    notes: `Generated for build ${request.buildId || 'unknown'}`,
  };

  const signed = core.signCommercialLicencePayload(payload, privateKeyPem);
  const outPath =
    args.out ||
    path.join(process.cwd(), `${payload.companyName.replace(/[^a-zA-Z0-9-_]+/g, '-')}-${args.plan}.tglic`);

  fs.writeFileSync(outPath, `${JSON.stringify(signed, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${outPath}`);
  console.log(`licenceId=${payload.licenceId} plan=${payload.plan} expiresAt=${payload.expiresAt}`);
}

main();
