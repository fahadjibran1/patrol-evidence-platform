import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import * as path from 'path';
import { Injectable, Logger } from '@nestjs/common';
import type { LocalTrialRecord } from '@patrol/license-core';
import { addDays, todayUtcDate } from '@patrol/license-core';
import { InstallationIdentityService } from './installation-identity.service';

const TRIAL_FILE_NAME = 'trial.dpapi';
const TRIAL_DAYS = 30;
const CLOCK_ROLLBACK_MS = 24 * 60 * 60 * 1000;
/** Limits disk/DPAPI writes while losing at most five minutes of rollback history on abrupt shutdown. */
export const TRIAL_LAST_SEEN_PERSIST_INTERVAL_MS = 5 * 60 * 1000;
const REGISTRY_KEY = 'HKCU\\Software\\TechGuard\\PatrolEvidencePlatform';
const REGISTRY_VALUE = 'TrialMarker';

export interface TrialBootstrapDiagnostics {
  dataRoot: string | null;
  trialFilePath: string | null;
  trialMarkerPresent: boolean;
  licensingDirectoryWritable: boolean | null;
  lastTrialBootstrapError: string | null;
  cryptoMode: 'dpapi' | 'test';
  trialCreationDisabled: boolean;
}

@Injectable()
export class LocalTrialService {
  private readonly logger = new Logger(LocalTrialService.name);
  private lastBootstrapError: string | null = null;
  private cachedTrialRecord: LocalTrialRecord | null = null;
  private cachedTrialPath: string | null = null;
  private lastObservedAtMs = 0;
  private persistedLastSeenAtMs = 0;
  private stateRevision = 0;

  constructor(private readonly identityService: InstallationIdentityService) {}

  getTrialFilePath(): string | null {
    const root = this.identityService.getDataRoot();
    return root ? path.join(root, TRIAL_FILE_NAME) : null;
  }

  getLastBootstrapError(): string | null {
    return this.lastBootstrapError;
  }

  getStateRevision(): number {
    return this.stateRevision;
  }

  getDiagnostics(): TrialBootstrapDiagnostics {
    const dataRoot = this.identityService.getDataRoot();
    let licensingDirectoryWritable: boolean | null = null;
    if (dataRoot) {
      try {
        licensingDirectoryWritable = this.ensureLicensingDirectoryWritable(dataRoot);
      } catch {
        licensingDirectoryWritable = false;
      }
    }

    return {
      dataRoot,
      trialFilePath: this.getTrialFilePath(),
      trialMarkerPresent: Boolean(this.readRegistryTrialMarker()),
      licensingDirectoryWritable,
      lastTrialBootstrapError: this.lastBootstrapError,
      cryptoMode: this.useTestCrypto() ? 'test' : 'dpapi',
      trialCreationDisabled: this.isTrialCreationDisabled(),
    };
  }

  /**
   * Creates a 30-day trial only when no commercial licence exists,
   * no prior trial record exists, and no consumed legacy/registry marker exists.
   */
  getOrCreateTrial(options: {
    hasCommercialLicence: boolean;
    forceSkip?: boolean;
  }): LocalTrialRecord | null {
    return this.ensureTrialIfEligible(options);
  }

  /**
   * @deprecated Prefer getOrCreateTrial — kept as an explicit alias used by evaluation.
   */
  ensureTrialIfEligible(options: {
    hasCommercialLicence: boolean;
    forceSkip?: boolean;
  }): LocalTrialRecord | null {
    this.lastBootstrapError = null;

    if (options.forceSkip || options.hasCommercialLicence) {
      return this.readTrialRecord();
    }

    if (this.isTrialCreationDisabled()) {
      const message =
        'Local trial creation is disabled by PATROL_DISABLE_LOCAL_TRIAL. Production builds must not set this flag.';
      this.lastBootstrapError = message;
      this.logger.error(`TRIAL_CREATE_FAILURE ${message}`);
      return this.readTrialRecord();
    }

    const existing = this.readTrialRecord();
    if (existing) {
      return this.touchTrialRecord(existing);
    }

    const marker = this.readRegistryTrialMarker();
    if (marker) {
      this.logger.log('TRIAL_MARKER_FOUND');
      const message =
        'Prior trial marker exists on this workstation (registry or local marker). A new 30-day trial will not be issued.';
      this.lastBootstrapError = message;
      this.logger.warn('TRIAL_MARKER_PRESENT_WITHOUT_RECORD treating as consumed');
      return null;
    }

    this.logger.log('TRIAL_MARKER_NOT_FOUND');
    this.logger.log('TRIAL_CREATE_START');

    try {
      const dataRoot = this.identityService.getDataRoot();
      if (!dataRoot) {
        throw new Error(
          'Licensing data root is unavailable (DESKTOP_CONFIG_PATH / PATROL_LICENSE_DATA_ROOT missing).',
        );
      }

      if (!this.ensureLicensingDirectoryWritable(dataRoot)) {
        throw new Error(`Licensing directory is not writable: ${dataRoot}`);
      }

      const identity = this.identityService.getOrCreateIdentity();
      const startedAt = new Date().toISOString();
      const expiresAt = `${addDays(todayUtcDate(), TRIAL_DAYS)}T23:59:59.000Z`;
      const record: LocalTrialRecord = {
        installationId: identity.installationId,
        machineFingerprint: identity.machineFingerprint,
        startedAt,
        expiresAt,
        lastSeenAt: startedAt,
        consumed: false,
        legacyMigrated: false,
      };

      this.persistTrialRecord(record);
      this.writeRegistryTrialMarker(record);
      this.logger.log(`TRIAL_CREATE_SUCCESS expiresAt=${record.expiresAt}`);
      this.logger.log(`LOCAL_TRIAL_STARTED expiresAt=${record.expiresAt}`);
      return record;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastBootstrapError = message;
      this.logger.error(`TRIAL_CREATE_FAILURE ${message}`);
      return null;
    }
  }

  readTrialRecord(): LocalTrialRecord | null {
    const filePath = this.getTrialFilePath();
    if (!filePath || !existsSync(filePath)) {
      return null;
    }

    if (this.cachedTrialRecord && this.cachedTrialPath === filePath) {
      return { ...this.cachedTrialRecord };
    }

    try {
      const encrypted = readFileSync(filePath);
      const plain = this.decrypt(encrypted);
      const record = JSON.parse(plain.toString('utf8')) as LocalTrialRecord;
      this.cachedTrialPath = filePath;
      this.cachedTrialRecord = { ...record };
      this.persistedLastSeenAtMs = Date.parse(record.lastSeenAt) || 0;
      this.lastObservedAtMs = Math.max(this.lastObservedAtMs, this.persistedLastSeenAtMs);
      return { ...record };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastBootstrapError = `Failed to read trial record: ${message}`;
      this.logger.warn(`TRIAL_RECORD_READ_FAILED ${message}`);
      return null;
    }
  }

  markTrialConsumed(reason: string, legacyMigrated = false): LocalTrialRecord | null {
    const existing = this.readTrialRecord();
    const identity = this.identityService.getOrCreateIdentity();
    const now = new Date().toISOString();
    const record: LocalTrialRecord = existing
      ? {
          ...existing,
          consumed: true,
          lastSeenAt: now,
          legacyMigrated: legacyMigrated || existing.legacyMigrated === true,
        }
      : {
          installationId: identity.installationId,
          machineFingerprint: identity.machineFingerprint,
          startedAt: now,
          expiresAt: now,
          lastSeenAt: now,
          consumed: true,
          legacyMigrated,
        };

    this.persistTrialRecord(record);
    this.writeRegistryTrialMarker(record);
    this.logger.log(`LOCAL_TRIAL_CONSUMED reason=${reason}`);
    return record;
  }

  detectClockRollback(record: LocalTrialRecord, now = new Date()): boolean {
    const lastSeen = Math.max(Date.parse(record.lastSeenAt), this.lastObservedAtMs);
    if (!Number.isFinite(lastSeen)) {
      return false;
    }

    return lastSeen - now.getTime() > CLOCK_ROLLBACK_MS;
  }

  isTrialActive(record: LocalTrialRecord, now = new Date()): boolean {
    if (record.consumed) {
      return false;
    }

    if (this.detectClockRollback(record, now)) {
      return false;
    }

    return now.getTime() <= Date.parse(record.expiresAt);
  }

  /** Development-only reset — blocked when NODE_ENV === production. */
  resetTrialForDevelopment(): void {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Trial reset is not available in production.');
    }

    const filePath = this.getTrialFilePath();
    if (filePath && existsSync(filePath)) {
      unlinkSync(filePath);
    }

    this.deleteRegistryTrialMarker();
    this.cachedTrialRecord = null;
    this.cachedTrialPath = null;
    this.lastObservedAtMs = 0;
    this.persistedLastSeenAtMs = 0;
    this.stateRevision += 1;
    this.lastBootstrapError = null;
    this.logger.warn('LOCAL_TRIAL_DEV_RESET');
  }

  private isTrialCreationDisabled(): boolean {
    const raw = process.env.PATROL_DISABLE_LOCAL_TRIAL?.trim().toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes';
  }

  private ensureLicensingDirectoryWritable(dataRoot: string): boolean {
    mkdirSync(dataRoot, { recursive: true });
    const probePath = path.join(dataRoot, `.license-write-probe-${process.pid}`);
    writeFileSync(probePath, 'ok', 'utf8');
    unlinkSync(probePath);
    return true;
  }

  private touchTrialRecord(record: LocalTrialRecord): LocalTrialRecord {
    if (this.detectClockRollback(record)) {
      this.logger.warn('TRIAL_CLOCK_ROLLBACK_DETECTED');
      return record;
    }

    const now = Date.now();
    this.lastObservedAtMs = Math.max(this.lastObservedAtMs, now);
    const updated: LocalTrialRecord = {
      ...record,
      lastSeenAt: new Date(now).toISOString(),
    };
    const persistedAt = this.persistedLastSeenAtMs || Date.parse(record.lastSeenAt);
    if (!Number.isFinite(persistedAt) || now - persistedAt >= TRIAL_LAST_SEEN_PERSIST_INTERVAL_MS) {
      this.persistTrialRecord(updated);
    } else {
      this.cachedTrialRecord = { ...updated };
      this.cachedTrialPath = this.getTrialFilePath();
    }
    return updated;
  }

  private persistTrialRecord(record: LocalTrialRecord): void {
    const filePath = this.getTrialFilePath();
    if (!filePath) {
      throw new Error('Cannot persist trial record: licensing data root is unavailable.');
    }

    mkdirSync(path.dirname(filePath), { recursive: true });
    const encrypted = this.encrypt(Buffer.from(JSON.stringify(record), 'utf8'));
    writeFileSync(filePath, encrypted);
    this.cachedTrialPath = filePath;
    this.cachedTrialRecord = { ...record };
    this.persistedLastSeenAtMs = Date.parse(record.lastSeenAt) || 0;
    this.lastObservedAtMs = Math.max(this.lastObservedAtMs, this.persistedLastSeenAtMs);
    this.stateRevision += 1;
  }

  private encrypt(plain: Buffer): Buffer {
    if (this.useTestCrypto()) {
      return this.testEncrypt(plain);
    }

    return this.dpapiProtect(plain);
  }

  private decrypt(encrypted: Buffer): Buffer {
    if (this.useTestCrypto()) {
      return this.testDecrypt(encrypted);
    }

    return this.dpapiUnprotect(encrypted);
  }

  private useTestCrypto(): boolean {
    // Production packaged Windows builds must use DPAPI. Never treat NODE_ENV=production as a disable flag.
    return (
      process.env.PATROL_LICENSE_TEST_MODE === 'true' ||
      process.platform !== 'win32' ||
      process.env.NODE_ENV === 'test'
    );
  }

  private useFileTrialMarker(): boolean {
    // Isolate smoke / explicit data-root runs from the machine-wide HKCU anti-reset marker.
    if (process.env.PATROL_LICENSE_USE_FILE_MARKER === 'true') {
      return true;
    }

    if (process.env.PATROL_LICENSE_DATA_ROOT?.trim()) {
      return true;
    }

    return this.useTestCrypto();
  }

  private testKey(): Buffer {
    return createHash('sha256')
      .update(`patrol-trial-test|${process.env.PATROL_LICENSE_TEST_SECRET ?? 'test'}`)
      .digest();
  }

  private testEncrypt(plain: Buffer): Buffer {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.testKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([Buffer.from('TEST'), iv, tag, ciphertext]);
  }

  private testDecrypt(encrypted: Buffer): Buffer {
    if (!encrypted.subarray(0, 4).equals(Buffer.from('TEST'))) {
      throw new Error('Unexpected trial record encoding.');
    }

    const iv = encrypted.subarray(4, 16);
    const tag = encrypted.subarray(16, 32);
    const ciphertext = encrypted.subarray(32);
    const decipher = createDecipheriv('aes-256-gcm', this.testKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  private dpapiProtect(plain: Buffer): Buffer {
    const script = `
Add-Type -AssemblyName System.Security
$bytes = [Convert]::FromBase64String('${plain.toString('base64')}')
$protected = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[Convert]::ToBase64String($protected)
`;
    const output = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();
    if (!output) {
      throw new Error('DPAPI Protect returned empty output.');
    }
    return Buffer.from(output, 'base64');
  }

  private dpapiUnprotect(encrypted: Buffer): Buffer {
    const script = `
Add-Type -AssemblyName System.Security
$bytes = [Convert]::FromBase64String('${encrypted.toString('base64')}')
$plain = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[Convert]::ToBase64String($plain)
`;
    const output = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();
    if (!output) {
      throw new Error('DPAPI Unprotect returned empty output.');
    }
    return Buffer.from(output, 'base64');
  }

  private markerValue(record: LocalTrialRecord): string {
    return createHash('sha256')
      .update(
        `${record.installationId}|${record.startedAt}|${record.expiresAt}|consumed=${record.consumed}`,
        'utf8',
      )
      .digest('hex');
  }

  private writeRegistryTrialMarker(record: LocalTrialRecord): void {
    if (process.platform !== 'win32' || this.useFileTrialMarker()) {
      const root = this.identityService.getDataRoot();
      if (!root) {
        throw new Error('Cannot write trial marker: licensing data root is unavailable.');
      }
      writeFileSync(path.join(root, 'trial-marker.txt'), this.markerValue(record), 'utf8');
      return;
    }

    try {
      execFileSync(
        'reg',
        ['add', REGISTRY_KEY, '/v', REGISTRY_VALUE, '/t', 'REG_SZ', '/d', this.markerValue(record), '/f'],
        { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
      );
    } catch (error) {
      throw new Error(
        `TRIAL_REGISTRY_WRITE_FAILED ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private readRegistryTrialMarker(): string | null {
    if (process.platform !== 'win32' || this.useFileTrialMarker()) {
      const root = this.identityService.getDataRoot();
      if (!root) {
        return null;
      }
      const markerPath = path.join(root, 'trial-marker.txt');
      return existsSync(markerPath) ? readFileSync(markerPath, 'utf8').trim() : null;
    }

    try {
      const output = execFileSync('reg', ['query', REGISTRY_KEY, '/v', REGISTRY_VALUE], {
        encoding: 'utf8',
        windowsHide: true,
        // Suppress "ERROR: The system was unable to find the specified registry key" on first run.
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const match = output.match(new RegExp(`${REGISTRY_VALUE}\\s+REG_SZ\\s+([^\\r\\n]+)`, 'i'));
      return match?.[1]?.trim() || null;
    } catch {
      return null;
    }
  }

  private deleteRegistryTrialMarker(): void {
    if (process.platform !== 'win32' || this.useFileTrialMarker()) {
      const root = this.identityService.getDataRoot();
      if (!root) {
        return;
      }
      const markerPath = path.join(root, 'trial-marker.txt');
      if (existsSync(markerPath)) {
        unlinkSync(markerPath);
      }
      return;
    }

    try {
      execFileSync('reg', ['delete', REGISTRY_KEY, '/v', REGISTRY_VALUE, '/f'], {
        encoding: 'utf8',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      // ignore missing key
    }
  }
}
