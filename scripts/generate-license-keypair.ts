import { existsSync, mkdirSync, writeFileSync } from 'fs';
import * as path from 'path';
import { generateKeyPairSync } from 'crypto';

const DEFAULT_KEY_DIR = path.join(process.cwd(), '.license-keys');
const FORCE = process.argv.includes('--force');

function readArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }

  return process.argv[index + 1];
}

const keyDir = readArg('--out-dir')?.trim() || DEFAULT_KEY_DIR;
const privateKeyPath = path.join(keyDir, 'license-private.pem');
const publicKeyPath = path.join(keyDir, 'license-public.pem');

if (existsSync(privateKeyPath) || existsSync(publicKeyPath)) {
  if (!FORCE) {
    console.error('Key files already exist. Use --force to overwrite.');
    process.exit(1);
  }
}

mkdirSync(keyDir, { recursive: true });

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

writeFileSync(privateKeyPath, privatePem, { mode: 0o600 });
writeFileSync(publicKeyPath, publicPem, 'utf8');

console.log('Ed25519 licence key pair generated.');
console.log(`Public key:  ${publicKeyPath}`);
console.log(`Private key: ${privateKeyPath}`);
console.log('');
console.log('IMPORTANT:');
console.log('- Back up the private key securely outside this repository.');
console.log('- Never commit, package, or log the private key.');
console.log('- Copy the public key into resources/license-public.pem before packaging the desktop app.');
