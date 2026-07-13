import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DesktopWorkspaceConfig, readDesktopWorkspaceConfig } from '@/desktop/desktop-config.util';
import { LicenseService } from './license.service';

export type LicenseType = 'TRIAL' | 'FULL' | 'MONTHLY' | 'ANNUAL';
export type LicenseStatus = 'ACTIVE' | 'EXPIRED' | 'INVALID' | 'NOT_ACTIVATED';

export interface LicenseSnapshot {
  companyName: string | null;
  licenseKey: string | null;
  licenseId: string | null;
  licenseType: LicenseType;
  plan: 'trial' | 'monthly' | 'annual' | null;
  displayMode: 'Trial' | 'Licensed' | 'Not activated';
  legacy: boolean;
  trialStartDate: string | null;
  trialEndDate: string | null;
  startsAt: string | null;
  expiresAt: string | null;
  status: LicenseStatus;
  daysRemaining: number;
  installationId: string | null;
  maxDevices: number | null;
  features: string[];
  activatedAt: string | null;
  lastSuccessfulValidationAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  message: string;
  collectorAllowed: boolean;
  operationsAllowed: boolean;
  requiresActivation: boolean;
}

export interface LicenseActivationResult {
  snapshot: LicenseSnapshot;
  configPatch: Partial<DesktopWorkspaceConfig>;
}

@Injectable()
export class LicensingService {
  constructor(
    private readonly configService: ConfigService,
    private readonly licenseService: LicenseService,
  ) {}

  getLicenseSnapshot(
    companyName?: string | null,
    workspaceConfig: DesktopWorkspaceConfig = readDesktopWorkspaceConfig(),
  ): LicenseSnapshot {
    const resolvedCompanyName = companyName?.trim() || workspaceConfig.companyName?.trim() || null;
    const status = this.licenseService.getStatus({
      ...workspaceConfig,
      companyName: resolvedCompanyName ?? workspaceConfig.companyName,
    });

    return this.mapStatusToSnapshot(status, workspaceConfig);
  }

  activateLicense(
    companyName: string,
    licenseKey: string,
    workspaceConfig: DesktopWorkspaceConfig = readDesktopWorkspaceConfig(),
  ): LicenseActivationResult {
    try {
      const status = this.licenseService.activateLicense(licenseKey, {
        ...workspaceConfig,
        companyName: companyName.trim(),
      });
      const snapshot = this.mapStatusToSnapshot(status, workspaceConfig, licenseKey.trim());
      const timestamp = new Date().toISOString();

      return {
        snapshot,
        configPatch: {
          licenseKey: licenseKey.trim(),
          licenseType: snapshot.licenseType,
          trialStartDate: snapshot.trialStartDate ?? undefined,
          trialEndDate: snapshot.trialEndDate ?? undefined,
          licenseStatus: snapshot.status === 'NOT_ACTIVATED' ? 'INVALID' : snapshot.status,
          licenseCreatedAt: workspaceConfig.licenseCreatedAt ?? timestamp,
          licenseUpdatedAt: timestamp,
        },
      };
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Licence activation failed.');
    }
  }

  assertCollectorStartAllowed(companyName?: string | null): void {
    const workspace = readDesktopWorkspaceConfig();
    const resolvedCompanyName = companyName?.trim() || workspace.companyName?.trim() || null;
    try {
      this.licenseService.assertCollectorStartAllowed({
        ...workspace,
        companyName: resolvedCompanyName ?? workspace.companyName,
      });
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Collector start is not allowed.');
    }
  }

  private mapStatusToSnapshot(
    status: ReturnType<LicenseService['getStatus']>,
    workspaceConfig: DesktopWorkspaceConfig,
    licenseKeyOverride?: string | null,
  ): LicenseSnapshot {
    const licenseType = this.resolveLicenseType(status.plan, status.legacy);
    const trialStartDate = status.plan === 'trial' ? status.startsAt : null;
    const trialEndDate = status.plan === 'trial' ? status.expiresAt : null;

    return {
      companyName: status.companyName ?? workspaceConfig.companyName?.trim() ?? null,
      licenseKey: licenseKeyOverride ?? workspaceConfig.licenseKey?.trim() ?? null,
      licenseId: status.licenseId,
      licenseType,
      plan: status.plan,
      displayMode: status.displayMode,
      legacy: status.legacy,
      trialStartDate,
      trialEndDate,
      startsAt: status.startsAt,
      expiresAt: status.expiresAt,
      status: status.status,
      daysRemaining: status.daysRemaining,
      installationId: status.installationId,
      maxDevices: status.maxDevices,
      features: status.features,
      activatedAt: status.activatedAt,
      lastSuccessfulValidationAt: status.lastSuccessfulValidationAt,
      createdAt: status.activatedAt ?? workspaceConfig.licenseCreatedAt ?? null,
      updatedAt: status.lastSuccessfulValidationAt ?? workspaceConfig.licenseUpdatedAt ?? null,
      message: status.message,
      collectorAllowed: status.collectorAllowed,
      operationsAllowed: status.operationsAllowed,
      requiresActivation: status.requiresActivation,
    };
  }

  private resolveLicenseType(plan: 'trial' | 'monthly' | 'annual' | null, legacy: boolean): LicenseType {
    if (plan === 'trial') {
      return 'TRIAL';
    }

    if (plan === 'monthly') {
      return 'MONTHLY';
    }

    if (plan === 'annual') {
      return legacy ? 'FULL' : 'ANNUAL';
    }

    return 'TRIAL';
  }
}
