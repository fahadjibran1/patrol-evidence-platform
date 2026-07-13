import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getPatrolTimeParts } from '@/common/utils/patrol-time.util';
import { DesktopWorkspaceConfig, readDesktopWorkspaceConfig } from '@/desktop/desktop-config.util';
import { diffDaysInclusive, verifySignedLicenseKey } from './license-crypto.util';
import {
  getLegacyLicenseExpiryStatus,
  isLegacyTrialKey,
  isSignedCommercialLicenseKey,
  verifyLegacyLicense,
} from './legacy-license.util';
import { isLicensePublicKeyConfigured, loadLicensePublicKey } from './license-public-key.util';
import {
  clearActivatedLicense,
  ensureInstallationId,
  getStoredLicenseRecord,
  saveActivatedLicense,
} from './license-store.util';
import type {
  LicenseDisplayStatus,
  LicensePayload,
  LicensePlan,
  LicenseStatusResponse,
  LicenseVerificationResult,
  StoredLicenseRecord,
} from './license.types';

@Injectable()
export class LicenseService {
  private readonly logger = new Logger(LicenseService.name);
  private readonly desktopMode: boolean;
  private readonly businessTimeZone: string;
  private readonly trialDays: number;
  private readonly signingSecret: string;
  private readonly clockToleranceHours: number;

  constructor(private readonly configService: ConfigService) {
    this.desktopMode = Boolean(process.env.DESKTOP_CONFIG_PATH);
    this.businessTimeZone = this.configService.get<string>('businessTimeZone')?.trim() || 'Europe/London';
    this.trialDays = this.configService.get<number>('trialDays') ?? 30;
    this.signingSecret =
      this.configService.get<string>('licenseSigningSecret')?.trim() || 'patrol-evidence-platform-license-secret';
    this.clockToleranceHours = this.configService.get<number>('licenseClockToleranceHours') ?? 48;
  }

  getStatus(workspaceConfig: DesktopWorkspaceConfig = readDesktopWorkspaceConfig()): LicenseStatusResponse {
    if (!this.desktopMode) {
      return this.buildBrowserModeStatus();
    }

    const installationId = ensureInstallationId();
    this.logger.log('LICENSE_STATUS_CHECK');

    const stored = getStoredLicenseRecord();
    if (stored) {
      return this.buildStatusFromStoredRecord(stored, workspaceConfig);
    }

    const workspaceKey = workspaceConfig.licenseKey?.trim();
    if (workspaceKey) {
      return this.buildStatusFromWorkspaceFallback(workspaceKey, workspaceConfig, installationId);
    }

    return this.buildNotActivatedStatus(installationId);
  }

  activateLicense(licenseKey: string, workspaceConfig: DesktopWorkspaceConfig = readDesktopWorkspaceConfig()): LicenseStatusResponse {
    if (!this.desktopMode) {
      return this.buildBrowserModeStatus();
    }

    const normalizedKey = licenseKey.trim();
    if (!normalizedKey) {
      this.logger.warn('LICENSE_ACTIVATION_FAILED reason=empty-key');
      throw new BadRequestException('Enter a licence key to continue.');
    }

    const verification = this.verifyLicenseKey(normalizedKey, workspaceConfig);
    if (!verification.valid || !verification.payload) {
      this.logger.warn(`LICENSE_ACTIVATION_FAILED reason=${verification.reason ?? 'invalid'}`);
      throw new BadRequestException(verification.reason ?? 'Licence key is not valid.');
    }

    if (verification.legacy && verification.payload.plan !== 'trial') {
      this.logger.warn('LICENSE_ACTIVATION_FAILED reason=legacy-non-trial');
      throw new BadRequestException('Legacy full licence keys cannot be activated as commercial licences.');
    }

    const installationId = ensureInstallationId();
    const timestamp = new Date().toISOString();
    const record: StoredLicenseRecord = {
      licenseKey: normalizedKey,
      payload: verification.payload,
      activatedAt: timestamp,
      installationId,
      lastSuccessfulValidationAt: timestamp,
      legacy: verification.legacy === true,
    };

    saveActivatedLicense(record);
    this.logger.log(
      `LICENSE_ACTIVATION_SUCCESS licenseId=${verification.payload.licenseId} companyName=${verification.payload.companyName}`,
    );

    return this.buildStatusFromStoredRecord(record, workspaceConfig);
  }

  deactivateLicense(): LicenseStatusResponse {
    if (!this.desktopMode) {
      return this.buildBrowserModeStatus();
    }

    clearActivatedLicense();
    this.logger.log('LICENSE_DEACTIVATED');
    return this.buildNotActivatedStatus(ensureInstallationId());
  }

  verifyLicenseKey(
    licenseKey: string,
    workspaceConfig: DesktopWorkspaceConfig = readDesktopWorkspaceConfig(),
  ): LicenseVerificationResult {
    const normalizedKey = licenseKey.trim();
    const companyName = workspaceConfig.companyName?.trim() || null;
    const today = this.today();

    if (isSignedCommercialLicenseKey(normalizedKey)) {
      const publicKey = loadLicensePublicKey();
      if (!publicKey) {
        this.logger.warn('LICENSE_PUBLIC_KEY_MISSING');
        return { valid: false, reason: 'Licence public key is not configured on this installation.' };
      }

      const result = verifySignedLicenseKey({
        licenseKey: normalizedKey,
        publicKey,
        today,
        clockToleranceHours: this.clockToleranceHours,
      });

      if (result.signatureValid === false) {
        this.logger.warn('LICENSE_SIGNATURE_INVALID');
      } else if (result.reason === 'Licence has expired.') {
        this.logger.warn('LICENSE_EXPIRED');
      } else if (result.reason === 'Licence is not yet valid.') {
        this.logger.warn('LICENSE_NOT_YET_VALID');
      }

      return result;
    }

    if (isLegacyTrialKey(normalizedKey) || normalizedKey.startsWith('TG-FULL-') || normalizedKey === 'TG-TRIAL-DEV') {
      return verifyLegacyLicense({
        companyName,
        licenseKey: normalizedKey,
        workspaceConfig,
        businessTimeZone: this.businessTimeZone,
        trialDays: this.trialDays,
        signingSecret: this.signingSecret,
      });
    }

    return { valid: false, reason: 'This licence key format is not recognised.' };
  }

  assertCollectorStartAllowed(workspaceConfig: DesktopWorkspaceConfig = readDesktopWorkspaceConfig()): void {
    const status = this.getStatus(workspaceConfig);
    if (!status.collectorAllowed) {
      throw new Error(
        status.status === 'EXPIRED'
          ? 'Trial or licence expired - activate a licence to start the WhatsApp collector.'
          : 'A valid licence key is required before the WhatsApp collector can start.',
      );
    }
  }

  private buildStatusFromStoredRecord(
    record: StoredLicenseRecord,
    workspaceConfig: DesktopWorkspaceConfig,
  ): LicenseStatusResponse {
    const verification = this.verifyLicenseKey(record.licenseKey, workspaceConfig);
    const payload = verification.payload ?? record.payload;
    const timestamp = new Date().toISOString();

    if (verification.valid) {
      saveActivatedLicense({
        ...record,
        payload,
        lastSuccessfulValidationAt: timestamp,
      });
    }

    return this.buildStatusResponse({
      verification,
      payload,
      installationId: record.installationId,
      activatedAt: record.activatedAt,
      lastSuccessfulValidationAt: verification.valid ? timestamp : record.lastSuccessfulValidationAt,
      legacy: record.legacy === true || verification.legacy === true,
    });
  }

  private buildStatusFromWorkspaceFallback(
    licenseKey: string,
    workspaceConfig: DesktopWorkspaceConfig,
    installationId: string,
  ): LicenseStatusResponse {
    const verification = this.verifyLicenseKey(licenseKey, workspaceConfig);
    if (!verification.payload) {
      if (!verification.valid && verification.reason) {
        return {
          ...this.buildNotActivatedStatus(installationId, verification.reason),
          status: 'INVALID',
          requiresActivation: true,
          collectorAllowed: false,
          operationsAllowed: false,
        };
      }

      return this.buildNotActivatedStatus(installationId, verification.reason);
    }

    return this.buildStatusResponse({
      verification,
      payload: verification.payload,
      installationId,
      activatedAt: workspaceConfig.licenseCreatedAt ?? null,
      lastSuccessfulValidationAt: workspaceConfig.licenseUpdatedAt ?? null,
      legacy: verification.legacy === true,
    });
  }

  private buildStatusResponse(input: {
    verification: LicenseVerificationResult;
    payload: LicensePayload;
    installationId: string;
    activatedAt: string | null;
    lastSuccessfulValidationAt: string | null;
    legacy: boolean;
    overrideMessage?: string;
  }): LicenseStatusResponse {
    const today = this.today();
    const expiry = getLegacyLicenseExpiryStatus(input.payload, this.businessTimeZone);
    const daysRemaining =
      input.verification.valid || today <= input.payload.expiresAt
        ? diffDaysInclusive(today, input.payload.expiresAt)
        : 0;

    let status: LicenseDisplayStatus = 'INVALID';
    if (!input.verification.valid) {
      if (input.verification.reason === 'Licence has expired.') {
        status = 'EXPIRED';
      } else if (input.verification.signatureValid === false) {
        status = 'INVALID';
      } else if (input.verification.reason === 'Licence is not yet valid.') {
        status = 'INVALID';
      } else {
        status = 'INVALID';
      }
    } else if (expiry.status === 'EXPIRED') {
      status = 'EXPIRED';
    } else {
      status = 'ACTIVE';
    }

    const plan = input.payload.plan;
    const displayMode: LicenseStatusResponse['displayMode'] =
      plan === 'trial' ? 'Trial' : plan === 'monthly' || plan === 'annual' ? 'Licensed' : 'Not activated';
    const collectorAllowed = status === 'ACTIVE';
    const operationsAllowed = status === 'ACTIVE';

    const message =
      input.overrideMessage ??
      input.verification.reason ??
      (status === 'ACTIVE'
        ? plan === 'trial'
          ? `Trial active - ${daysRemaining} day${daysRemaining === 1 ? '' : 's'} remaining.`
          : 'Commercial licence active.'
        : status === 'EXPIRED'
          ? 'Licence expired - activate a valid licence to restore full operation.'
          : 'Licence is not valid.');

    return {
      status,
      displayMode,
      plan,
      companyName: input.payload.companyName,
      licenseId: input.payload.licenseId,
      customerEmail: input.payload.customerEmail ?? null,
      startsAt: input.payload.startsAt,
      expiresAt: input.payload.expiresAt,
      daysRemaining: status === 'ACTIVE' ? daysRemaining : 0,
      maxDevices: input.payload.maxDevices,
      features: input.payload.features,
      installationId: input.installationId,
      activatedAt: input.activatedAt,
      lastSuccessfulValidationAt: input.lastSuccessfulValidationAt,
      legacy: input.legacy,
      message,
      collectorAllowed,
      operationsAllowed,
      requiresActivation: status !== 'ACTIVE',
    };
  }

  private buildNotActivatedStatus(installationId: string, message?: string): LicenseStatusResponse {
    return {
      status: 'NOT_ACTIVATED',
      displayMode: 'Not activated',
      plan: null,
      companyName: null,
      licenseId: null,
      customerEmail: null,
      startsAt: null,
      expiresAt: null,
      daysRemaining: 0,
      maxDevices: null,
      features: [],
      installationId,
      activatedAt: null,
      lastSuccessfulValidationAt: null,
      legacy: false,
      message: message ?? 'Enter a licence key to activate this workstation.',
      collectorAllowed: false,
      operationsAllowed: false,
      requiresActivation: true,
    };
  }

  private buildBrowserModeStatus(): LicenseStatusResponse {
    return {
      status: 'ACTIVE',
      displayMode: 'Licensed',
      plan: 'annual',
      companyName: this.configService.get<string>('securityCompanyName') ?? null,
      licenseId: 'browser-dev',
      customerEmail: null,
      startsAt: this.today(),
      expiresAt: '2099-12-31',
      daysRemaining: 9999,
      maxDevices: 999,
      features: ['development'],
      installationId: null,
      activatedAt: null,
      lastSuccessfulValidationAt: null,
      legacy: false,
      message: 'Desktop licensing is not required in browser/development mode.',
      collectorAllowed: true,
      operationsAllowed: true,
      requiresActivation: false,
    };
  }

  private today(): string {
    return getPatrolTimeParts(new Date(), this.businessTimeZone).date;
  }

  isPublicKeyConfigured(): boolean {
    return isLicensePublicKeyConfigured();
  }
}
