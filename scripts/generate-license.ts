import { existsSync, readFileSync } from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { addDays, createSignedLicenseKey } from '../src/licensing/license-crypto.util';
import type { LicensePayload, LicensePlan } from '../src/licensing/license.types';

function readArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }

  return process.argv[index + 1];
}

function requireArg(flag: string): string {
  const value = readArg(flag)?.trim();
  if (!value) {
    console.error(`Missing required argument ${flag}`);
    process.exit(1);
  }

  return value;
}

function loadPrivateKeyPem(): string {
  const inline = process.env.LICENSE_PRIVATE_KEY?.trim();
  if (inline) {
    return inline.includes('\\n') ? inline.replace(/\\n/g, '\n') : inline;
  }

  const filePath =
    readArg('--private-key-file')?.trim() ||
    process.env.LICENSE_PRIVATE_KEY_FILE?.trim() ||
    path.join(process.cwd(), '.license-keys', 'license-private.pem');

  if (!existsSync(filePath)) {
    console.error(
      'No private key supplied. Set LICENSE_PRIVATE_KEY, LICENSE_PRIVATE_KEY_FILE, or create .license-keys/license-private.pem',
    );
    process.exit(1);
  }

  return readFileSync(filePath, 'utf8');
}

const companyName = requireArg('--company');
const plan = (readArg('--plan')?.trim().toLowerCase() || 'trial') as LicensePlan;
if (!['trial', 'monthly', 'annual'].includes(plan)) {
  console.error('--plan must be trial, monthly, or annual');
  process.exit(1);
}

const startDate = readArg('--start')?.trim() || new Date().toISOString().slice(0, 10);
const expiresArg = readArg('--expires')?.trim();
const daysArg = readArg('--days');
const expiresAt = expiresArg || addDays(startDate, Number(daysArg ?? (plan === 'trial' ? 30 : plan === 'monthly' ? 30 : 365)) - 1);
const maxDevices = Number(readArg('--max-devices') ?? 1);
const features =
  readArg('--features')
    ?.split(',')
    .map((feature) => feature.trim())
    .filter(Boolean) ?? [];
const licenseId = readArg('--license-id')?.trim() || randomUUID();
const notes = readArg('--notes')?.trim();
const email = readArg('--email')?.trim();

if (!Number.isInteger(maxDevices) || maxDevices < 1) {
  console.error('--max-devices must be an integer >= 1');
  process.exit(1);
}

const payload: LicensePayload = {
  version: 1,
  licenseId,
  companyName,
  customerEmail: email,
  plan,
  issuedAt: new Date().toISOString().slice(0, 10),
  startsAt: startDate,
  expiresAt,
  maxDevices,
  features,
  notes,
};

const privateKeyPem = loadPrivateKeyPem();
const licenseKey = createSignedLicenseKey(payload, privateKeyPem);

console.log('Licence generated successfully');
console.log(`Company:   ${companyName}`);
console.log(`Plan:      ${plan}`);
console.log(`Licence ID:${licenseId}`);
console.log(`Starts:    ${startDate}`);
console.log(`Expires:   ${expiresAt}`);
console.log(`Devices:   ${maxDevices}`);
if (features.length > 0) {
  console.log(`Features:  ${features.join(', ')}`);
}
console.log('');
console.log(licenseKey);
