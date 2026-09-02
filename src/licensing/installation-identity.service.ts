import { createHash, randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { execFileSync } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import { Injectable, Logger } from '@nestjs/common';
import { getDesktopConfigPath } from '@/desktop/desktop-config.util';

const IDENTITY_FILE = 'installation-identity.json';

export interface InstallationIdentity {
  installationId: string;
  machineFingerprint: string;
  createdAt: string;
}

@Injectable()
export class InstallationIdentityService {
  private readonly logger = new Logger(InstallationIdentityService.name);

  getDataRoot(): string | null {
    const configPath = getDesktopConfigPath();
    if (configPath) {
      return path.dirname(configPath);
    }

    if (process.env.PATROL_LICENSE_DATA_ROOT?.trim()) {
      return process.env.PATROL_LICENSE_DATA_ROOT.trim();
    }

    return null;
  }

  getIdentityPath(): string | null {
    const root = this.getDataRoot();
    return root ? path.join(root, IDENTITY_FILE) : null;
  }

  getOrCreateIdentity(): InstallationIdentity {
    const existing = this.readIdentity();
    if (existing) {
      // Refresh fingerprint in memory for evaluation, but keep stable installationId.
      const fingerprint = this.computeMachineFingerprint();
      if (fingerprint !== existing.machineFingerprint) {
        this.logger.warn('INSTALLATION_FINGERPRINT_CHANGED preserving installationId');
        const updated: InstallationIdentity = { ...existing, machineFingerprint: fingerprint };
        this.writeIdentity(updated);
        return updated;
      }
      return existing;
    }

    const identity: InstallationIdentity = {
      installationId: randomUUID(),
      machineFingerprint: this.computeMachineFingerprint(),
      createdAt: new Date().toISOString(),
    };
    this.writeIdentity(identity);
    this.logger.log(`INSTALLATION_IDENTITY_CREATED id=${identity.installationId}`);
    return identity;
  }

  readIdentity(): InstallationIdentity | null {
    const identityPath = this.getIdentityPath();
    if (!identityPath || !existsSync(identityPath)) {
      return null;
    }

    try {
      const parsed = JSON.parse(readFileSync(identityPath, 'utf8')) as InstallationIdentity;
      if (!parsed.installationId?.trim() || !parsed.machineFingerprint?.trim()) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  writeIdentity(identity: InstallationIdentity): void {
    const identityPath = this.getIdentityPath();
    if (!identityPath) {
      throw new Error(
        'Cannot write installation identity: licensing data root is unavailable (DESKTOP_CONFIG_PATH / PATROL_LICENSE_DATA_ROOT).',
      );
    }

    mkdirSync(path.dirname(identityPath), { recursive: true });
    writeFileSync(identityPath, JSON.stringify(identity, null, 2), 'utf8');
  }

  /**
   * Stable Windows machine identity hashed with SHA-256.
   * Raw serials/MachineGuid are never returned or written to request files.
   */
  computeMachineFingerprint(): string {
    const material = [
      this.readWindowsMachineGuid(),
      os.hostname(),
      os.arch(),
      os.platform(),
      process.env.PROCESSOR_IDENTIFIER ?? '',
    ]
      .map((part) => part.trim())
      .filter(Boolean)
      .join('|');

    return createHash('sha256').update(material, 'utf8').digest('hex');
  }

  private readWindowsMachineGuid(): string {
    if (process.platform !== 'win32') {
      return `non-windows-${os.hostname()}`;
    }

    try {
      const output = execFileSync(
        'reg',
        ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'],
        { encoding: 'utf8', windowsHide: true },
      );
      const match = output.match(/MachineGuid\s+REG_SZ\s+([^\r\n]+)/i);
      return match?.[1]?.trim() || `fallback-${os.hostname()}`;
    } catch {
      return `fallback-${os.hostname()}`;
    }
  }
}
