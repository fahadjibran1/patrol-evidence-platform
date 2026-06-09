import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { getPatrolTimeParts } from '@/common/utils/patrol-time.util';
import { DesktopWorkspaceConfig, readDesktopWorkspaceConfig } from '@/desktop/desktop-config.util';

export type LicenseType = 'TRIAL' | 'FULL';
export type LicenseStatus = 'ACTIVE' | 'EXPIRED' | 'INVALID';

export interface LicenseSnapshot {
  companyName: string | null;
  licenseKey: string | null;
  licenseType: LicenseType;
  trialStartDate: string | null;
  trialEndDate: string | null;
  status: LicenseStatus;
  daysRemaining: number;
  createdAt: string | null;
  updatedAt: string | null;
  message: string;
  collectorAllowed: boolean;
  requiresActivation: boolean;
}

export interface LicenseActivationResult {
  snapshot: LicenseSnapshot;
  configPatch: Partial<DesktopWorkspaceConfig>;
}

interface ParsedTrialKey {
  companySlug: string;
  startDate: string;
  days: number;
  signature: string;
}

interface ParsedFullKey {
  companySlug: string;
  signature: string;
}

const DEVELOPMENT_TRIAL_KEY = 'TG-TRIAL-DEV';
const TRIAL_PREFIX = 'TG-TRIAL-';
const FULL_PREFIX = 'TG-FULL-';

@Injectable()
export class LicensingService {
  private readonly desktopMode: boolean;
  private readonly businessTimeZone: string;
  private readonly trialDays: number;
  private readonly signingSecret: string;

  constructor(private readonly configService: ConfigService) {
    this.desktopMode = Boolean(process.env.DESKTOP_CONFIG_PATH);
    this.businessTimeZone = this.configService.get<string>('businessTimeZone')?.trim() || 'Europe/London';
    this.trialDays = this.configService.get<number>('trialDays') ?? 30;
    this.signingSecret =
      this.configService.get<string>('licenseSigningSecret')?.trim() || 'patrol-evidence-platform-license-secret';
  }

  getLicenseSnapshot(
    companyName?: string | null,
    workspaceConfig: DesktopWorkspaceConfig = readDesktopWorkspaceConfig(),
  ): LicenseSnapshot {
    const resolvedCompanyName = companyName?.trim() || workspaceConfig.companyName?.trim() || null;
    const licenseKey = workspaceConfig.licenseKey?.trim() || null;

    if (!this.desktopMode) {
      return {
        companyName: resolvedCompanyName,
        licenseKey,
        licenseType: 'FULL',
        trialStartDate: null,
        trialEndDate: null,
        status: 'ACTIVE',
        daysRemaining: 9999,
        createdAt: workspaceConfig.licenseCreatedAt ?? null,
        updatedAt: workspaceConfig.licenseUpdatedAt ?? null,
        message: 'Desktop licensing is not required in browser/development mode.',
        collectorAllowed: true,
        requiresActivation: false,
      };
    }

    if (!licenseKey) {
      return {
        companyName: resolvedCompanyName,
        licenseKey: null,
        licenseType: 'TRIAL',
        trialStartDate: null,
        trialEndDate: null,
        status: 'INVALID',
        daysRemaining: 0,
        createdAt: workspaceConfig.licenseCreatedAt ?? null,
        updatedAt: workspaceConfig.licenseUpdatedAt ?? null,
        message: 'Enter a trial or full licence key to activate the collector for this workstation.',
        collectorAllowed: false,
        requiresActivation: true,
      };
    }

    if (licenseKey === DEVELOPMENT_TRIAL_KEY) {
      const startDate = workspaceConfig.trialStartDate ?? this.today();
      const endDate = workspaceConfig.trialEndDate ?? this.addDays(startDate, this.trialDays - 1);
      return this.buildTrialSnapshot({
        companyName: resolvedCompanyName,
        licenseKey,
        createdAt: workspaceConfig.licenseCreatedAt ?? null,
        updatedAt: workspaceConfig.licenseUpdatedAt ?? null,
        startDate,
        endDate,
      });
    }

    const trialKey = this.parseTrialKey(licenseKey);
    if (trialKey) {
      if (!this.companySlugMatches(trialKey.companySlug, resolvedCompanyName)) {
        return this.buildInvalidSnapshot(
          resolvedCompanyName,
          licenseKey,
          workspaceConfig,
          'This trial key was generated for a different company name.',
        );
      }

      const expectedSignature = this.sign(['TRIAL', trialKey.companySlug, trialKey.startDate, String(trialKey.days)]);
      if (trialKey.signature !== expectedSignature) {
        return this.buildInvalidSnapshot(
          resolvedCompanyName,
          licenseKey,
          workspaceConfig,
          'The trial key signature is not valid.',
        );
      }

      return this.buildTrialSnapshot({
        companyName: resolvedCompanyName,
        licenseKey,
        createdAt: workspaceConfig.licenseCreatedAt ?? null,
        updatedAt: workspaceConfig.licenseUpdatedAt ?? null,
        startDate: trialKey.startDate,
        endDate: this.addDays(trialKey.startDate, trialKey.days - 1),
      });
    }

    const fullKey = this.parseFullKey(licenseKey);
    if (fullKey) {
      if (!this.companySlugMatches(fullKey.companySlug, resolvedCompanyName)) {
        return this.buildInvalidSnapshot(
          resolvedCompanyName,
          licenseKey,
          workspaceConfig,
          'This full licence key was generated for a different company name.',
        );
      }

      const expectedSignature = this.sign(['FULL', fullKey.companySlug]);
      if (fullKey.signature !== expectedSignature) {
        return this.buildInvalidSnapshot(
          resolvedCompanyName,
          licenseKey,
          workspaceConfig,
          'The full licence key signature is not valid.',
        );
      }

      return {
        companyName: resolvedCompanyName,
        licenseKey,
        licenseType: 'FULL',
        trialStartDate: null,
        trialEndDate: null,
        status: 'ACTIVE',
        daysRemaining: 9999,
        createdAt: workspaceConfig.licenseCreatedAt ?? null,
        updatedAt: workspaceConfig.licenseUpdatedAt ?? null,
        message: 'Full licence active.',
        collectorAllowed: true,
        requiresActivation: false,
      };
    }

    return this.buildInvalidSnapshot(
      resolvedCompanyName,
      licenseKey,
      workspaceConfig,
      'This licence key format is not recognised.',
    );
  }

  activateLicense(
    companyName: string,
    licenseKey: string,
    workspaceConfig: DesktopWorkspaceConfig = readDesktopWorkspaceConfig(),
  ): LicenseActivationResult {
    const normalizedKey = licenseKey.trim();
    if (!normalizedKey) {
      throw new BadRequestException('Enter a licence key to continue.');
    }

    const currentSnapshot = this.getLicenseSnapshot(companyName, {
      ...workspaceConfig,
      companyName,
      licenseKey: normalizedKey,
    });

    if (currentSnapshot.status === 'INVALID') {
      throw new BadRequestException(currentSnapshot.message);
    }

    const timestamp = new Date().toISOString();

    return {
      snapshot: {
        ...currentSnapshot,
        licenseKey: normalizedKey,
        createdAt: workspaceConfig.licenseCreatedAt ?? timestamp,
        updatedAt: timestamp,
      },
      configPatch: {
        licenseKey: normalizedKey,
        licenseType: currentSnapshot.licenseType,
        trialStartDate: currentSnapshot.trialStartDate ?? undefined,
        trialEndDate: currentSnapshot.trialEndDate ?? undefined,
        licenseStatus: currentSnapshot.status,
        licenseCreatedAt: workspaceConfig.licenseCreatedAt ?? timestamp,
        licenseUpdatedAt: timestamp,
      },
    };
  }

  assertCollectorStartAllowed(companyName?: string | null): void {
    const snapshot = this.getLicenseSnapshot(companyName);
    if (!snapshot.collectorAllowed) {
      throw new BadRequestException(
        snapshot.status === 'EXPIRED'
          ? 'Trial expired - activate a licence to start the WhatsApp collector.'
          : 'A valid trial or full licence key is required before the WhatsApp collector can start.',
      );
    }
  }

  private buildTrialSnapshot(input: {
    companyName: string | null;
    licenseKey: string;
    createdAt: string | null;
    updatedAt: string | null;
    startDate: string;
    endDate: string;
  }): LicenseSnapshot {
    const today = this.today();
    const status: LicenseStatus = today > input.endDate ? 'EXPIRED' : 'ACTIVE';
    const daysRemaining = status === 'ACTIVE' ? this.diffDaysInclusive(today, input.endDate) : 0;

    return {
      companyName: input.companyName,
      licenseKey: input.licenseKey,
      licenseType: 'TRIAL',
      trialStartDate: input.startDate,
      trialEndDate: input.endDate,
      status,
      daysRemaining,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
      message:
        status === 'ACTIVE'
          ? `Trial active - ${daysRemaining} day${daysRemaining === 1 ? '' : 's'} remaining.`
          : 'Trial expired - activate a licence to restart the collector.',
      collectorAllowed: status === 'ACTIVE',
      requiresActivation: status !== 'ACTIVE',
    };
  }

  private buildInvalidSnapshot(
    companyName: string | null,
    licenseKey: string,
    workspaceConfig: DesktopWorkspaceConfig,
    message: string,
  ): LicenseSnapshot {
    return {
      companyName,
      licenseKey,
      licenseType: workspaceConfig.licenseType ?? 'TRIAL',
      trialStartDate: workspaceConfig.trialStartDate ?? null,
      trialEndDate: workspaceConfig.trialEndDate ?? null,
      status: 'INVALID',
      daysRemaining: 0,
      createdAt: workspaceConfig.licenseCreatedAt ?? null,
      updatedAt: workspaceConfig.licenseUpdatedAt ?? null,
      message,
      collectorAllowed: false,
      requiresActivation: true,
    };
  }

  private parseTrialKey(licenseKey: string): ParsedTrialKey | null {
    if (!licenseKey.startsWith(TRIAL_PREFIX)) {
      return null;
    }

    const parts = licenseKey.slice(TRIAL_PREFIX.length).split('-');
    if (parts.length < 4) {
      return null;
    }

    const signature = parts[parts.length - 1].toUpperCase();
    const days = Number(parts[parts.length - 2]);
    const rawDate = parts[parts.length - 3];
    const companySlug = parts.slice(0, -3).join('-').toLowerCase();

    if (!/^\d{8}$/.test(rawDate) || !Number.isInteger(days) || days <= 0 || !companySlug) {
      return null;
    }

    return {
      companySlug,
      startDate: `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`,
      days,
      signature,
    };
  }

  private parseFullKey(licenseKey: string): ParsedFullKey | null {
    if (!licenseKey.startsWith(FULL_PREFIX)) {
      return null;
    }

    const parts = licenseKey.slice(FULL_PREFIX.length).split('-');
    if (parts.length < 2) {
      return null;
    }

    return {
      companySlug: parts.slice(0, -1).join('-').toLowerCase(),
      signature: parts[parts.length - 1].toUpperCase(),
    };
  }

  private companySlugMatches(companySlug: string, companyName: string | null): boolean {
    if (companySlug === 'any' || companySlug === 'dev') {
      return true;
    }

    if (!companyName) {
      return false;
    }

    return this.slugify(companyName) === companySlug;
  }

  private sign(parts: string[]): string {
    return createHash('sha256')
      .update([...parts, this.signingSecret].join('|'))
      .digest('hex')
      .slice(0, 12)
      .toUpperCase();
  }

  private slugify(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'company';
  }

  private today(): string {
    return getPatrolTimeParts(new Date(), this.businessTimeZone).date;
  }

  private addDays(date: string, days: number): string {
    const next = new Date(`${date}T00:00:00.000Z`);
    next.setUTCDate(next.getUTCDate() + days);
    return next.toISOString().slice(0, 10);
  }

  private diffDaysInclusive(fromDate: string, toDate: string): number {
    const from = new Date(`${fromDate}T00:00:00.000Z`);
    const to = new Date(`${toDate}T00:00:00.000Z`);
    return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1);
  }
}
