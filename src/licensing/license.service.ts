import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  LICENCE_PRODUCT_NAME,
  LICENCE_REQUEST_FILE_VERSION,
  canonicalizeJson,
  parseSignedCommercialLicenceJson,
  verifyCommercialLicence,
  type LicenceEvaluation,
  type LicenceFeatures,
  type LicencePlan,
  type LicenceRequestFile,
} from '@patrol/license-core';
import { DesktopWorkspaceConfig, readDesktopWorkspaceConfig } from '@/desktop/desktop-config.util';
import {
  clearCommercialLicence,
  getStoredCommercialLicence,
  saveCommercialLicence,
} from './commercial-licence-store.util';
import { InstallationIdentityService } from './installation-identity.service';
import { LicenceEvaluationService } from './licence-evaluation.service';
import { LocalTrialService, type TrialBootstrapDiagnostics } from './local-trial.service';
import { loadLicensePublicKey } from './license-public-key.util';
import {
  clearActivatedLicense,
  ensureInstallationId,
  getStoredLicenseRecord,
} from './license-store.util';
import type { LicenseStatusResponse } from './license.types';

@Injectable()
export class LicenseService {
  private readonly logger = new Logger(LicenseService.name);
  private readonly desktopMode: boolean;
  private legacyMigrationDone = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly identityService: InstallationIdentityService,
    private readonly trialService: LocalTrialService,
    private readonly evaluationService: LicenceEvaluationService,
  ) {
    this.desktopMode = Boolean(process.env.DESKTOP_CONFIG_PATH || process.env.PATROL_LICENSE_DATA_ROOT);
  }

  getStatus(workspaceConfig: DesktopWorkspaceConfig = readDesktopWorkspaceConfig()): LicenseStatusResponse {
    if (!this.desktopMode) {
      return this.buildBrowserModeStatus();
    }

    this.runLegacyMigrationOnce();
    const evaluation = this.evaluationService.evaluate();
    return this.mapEvaluationToStatusResponse(evaluation, workspaceConfig);
  }

  getEvaluation(): LicenceEvaluation {
    if (!this.desktopMode) {
      return this.evaluationFromBrowserStatus(this.buildBrowserModeStatus());
    }

    this.runLegacyMigrationOnce();
    return this.evaluationService.evaluate();
  }

  getTrialDiagnostics(): TrialBootstrapDiagnostics {
    return this.trialService.getDiagnostics();
  }

  createRequestFile(input: {
    companyName: string;
    requestedPlan?: Exclude<LicencePlan, 'trial'>;
  }): { request: LicenceRequestFile; fileName: string; contents: string } {
    if (!this.desktopMode) {
      throw new BadRequestException('Licence request files are only available in the desktop application.');
    }

    const companyName = input.companyName?.trim();
    if (!companyName) {
      throw new BadRequestException('Company name is required to create a licence request file.');
    }

    const identity = this.identityService.getOrCreateIdentity();
    const buildMeta = this.readBuildMetadata();
    const request: LicenceRequestFile = {
      version: LICENCE_REQUEST_FILE_VERSION,
      installationId: identity.installationId,
      machineFingerprint: identity.machineFingerprint,
      companyName,
      product: LICENCE_PRODUCT_NAME,
      appVersion: buildMeta.appVersion ?? '0.0.0',
      buildId: buildMeta.buildId ?? 'unknown',
      requestedPlan: input.requestedPlan ?? 'annual',
      requestedAt: new Date().toISOString(),
    };

    const contents = `${canonicalizeJson(request)}\n`;
    const safeCompany = companyName.replace(/[^a-zA-Z0-9-_]+/g, '-').slice(0, 40) || 'company';
    return {
      request,
      fileName: `patrol-${safeCompany}-${identity.installationId.slice(0, 8)}.tgreq`,
      contents,
    };
  }

  importCommercialLicence(raw: string): LicenseStatusResponse {
    if (!this.desktopMode) {
      throw new BadRequestException('Licence import is only available in the desktop application.');
    }

    const trimmed = raw.trim();
    if (!trimmed) {
      throw new BadRequestException('Licence file contents are empty.');
    }

    const licence = parseSignedCommercialLicenceJson(trimmed);
    if (!licence) {
      throw new BadRequestException('Licence file is not valid JSON (.tglic).');
    }

    const identity = this.identityService.getOrCreateIdentity();
    const verification = verifyCommercialLicence({
      licence,
      publicKey: loadLicensePublicKey(),
      installationId: identity.installationId,
      machineFingerprint: identity.machineFingerprint,
    });

    if (!verification.valid || !verification.payload) {
      this.logger.warn(`LICENSE_IMPORT_FAILED reason=${verification.reason ?? 'invalid'}`);
      throw new BadRequestException(verification.reason ?? 'Licence import failed.');
    }

    saveCommercialLicence(licence);
    // Clear legacy TG1 store so commercial evaluation takes priority cleanly.
    clearActivatedLicense();
    this.evaluationService.invalidate();
    this.logger.log(
      `LICENSE_IMPORT_SUCCESS licenceId=${verification.payload.licenceId} plan=${verification.payload.plan}`,
    );
    return this.getStatus();
  }

  /** @deprecated Prefer importCommercialLicence for .tglic files. Kept for TG1 paste/activate UX. */
  activateLicense(licenseKey: string, workspaceConfig: DesktopWorkspaceConfig = readDesktopWorkspaceConfig()): LicenseStatusResponse {
    if (!this.desktopMode) {
      return this.buildBrowserModeStatus();
    }

    const normalized = licenseKey.trim();
    if (!normalized) {
      throw new BadRequestException('Enter a licence key or import a .tglic file.');
    }

    // Allow pasting full .tglic JSON into the activate box.
    if (normalized.startsWith('{')) {
      return this.importCommercialLicence(normalized);
    }

    throw new BadRequestException(
      'Paste a commercial .tglic file (JSON) or use Import licence. Legacy development keys are no longer accepted.',
    );
  }

  deactivateLicense(): LicenseStatusResponse {
    if (!this.desktopMode) {
      return this.buildBrowserModeStatus();
    }

    clearCommercialLicence();
    clearActivatedLicense();
    this.evaluationService.invalidate();
    this.logger.log('LICENSE_DEACTIVATED');
    return this.getStatus();
  }

  assertCollectorStartAllowed(workspaceConfig: DesktopWorkspaceConfig = readDesktopWorkspaceConfig()): void {
    void workspaceConfig;
    this.evaluationService.assertFeature('whatsappMonitoring');
  }

  assertFeature(feature: keyof LicenceFeatures): void {
    this.evaluationService.assertFeature(feature);
  }

  resetTrialForDevelopment(): { ok: true } {
    if (process.env.NODE_ENV === 'production') {
      throw new BadRequestException('Trial reset is not available in production.');
    }

    this.trialService.resetTrialForDevelopment();
    this.evaluationService.invalidate();
    return { ok: true };
  }

  private runLegacyMigrationOnce(): void {
    if (this.legacyMigrationDone) {
      return;
    }

    this.legacyMigrationDone = true;
    const stored = getStoredLicenseRecord();
    const legacyId = stored?.payload?.licenseId ?? '';
    if (legacyId.startsWith('legacy-trial-')) {
      this.trialService.markTrialConsumed('legacy-trial-migration', true);
      clearActivatedLicense();
      this.logger.warn(`LEGACY_TRIAL_MIGRATED licenseId=${legacyId} new-trial-not-issued=true`);
    }

    // Ensure installation identity exists and stays aligned with legacy store ID when present.
    const identity = this.identityService.getOrCreateIdentity();
    if (stored?.installationId && stored.installationId !== identity.installationId) {
      ensureInstallationId();
    }
  }

  private mapEvaluationToStatusResponse(
    evaluation: LicenceEvaluation,
    workspaceConfig: DesktopWorkspaceConfig,
  ): LicenseStatusResponse {
    const statusMap: Record<LicenceEvaluation['status'], LicenseStatusResponse['status']> = {
      active: evaluation.mode === 'trial' ? 'TRIAL_ACTIVE' : 'ACTIVE',
      expired: 'EXPIRED',
      invalid: 'INVALID',
      not_activated: 'NOT_ACTIVATED',
      clock_rollback: 'INVALID',
      wrong_machine: 'INVALID',
    };

    const displayModeMap: Record<LicenceEvaluation['displayMode'], LicenseStatusResponse['displayMode']> = {
      'Trial Active': 'Trial',
      Licensed: 'Licensed',
      Expired: 'Not activated',
      Invalid: 'Not activated',
      'Not activated': 'Not activated',
    };

    // Extend display for UI: keep Licensed/Trial; Expired/Invalid surface via status + message.
    let displayMode: LicenseStatusResponse['displayMode'] = displayModeMap[evaluation.displayMode];
    if (evaluation.displayMode === 'Expired') {
      displayMode = evaluation.mode === 'trial' ? 'Trial' : 'Licensed';
    }

    const plan = this.mapPlan(evaluation.plan);
    const diagnostics = this.trialService.getDiagnostics();

    return {
      status: statusMap[evaluation.status],
      displayMode,
      uiState: evaluation.displayMode,
      plan,
      companyName: evaluation.companyName ?? workspaceConfig.companyName?.trim() ?? null,
      licenseId: evaluation.licenceId,
      customerEmail: null,
      startsAt: evaluation.startsAt,
      expiresAt: evaluation.expiresAt,
      daysRemaining: evaluation.daysRemaining ?? 0,
      maxDevices: 1,
      features: this.featuresToList(evaluation.features),
      featureFlags: evaluation.features,
      installationId: evaluation.installationId,
      machineFingerprint: evaluation.machineFingerprint,
      activatedAt: evaluation.activatedAt,
      lastSuccessfulValidationAt: evaluation.lastSuccessfulValidationAt,
      legacy: evaluation.legacyMigrated,
      message: evaluation.message,
      collectorAllowed: evaluation.collectorAllowed,
      operationsAllowed: evaluation.operationsAllowed,
      requiresActivation: evaluation.requiresActivation,
      mode: evaluation.mode,
      buildId: evaluation.buildId,
      appVersion: evaluation.appVersion,
      diagnostics: {
        dataRoot: diagnostics.dataRoot,
        trialFilePath: diagnostics.trialFilePath,
        trialMarkerPresent: diagnostics.trialMarkerPresent,
        licensingDirectoryWritable: diagnostics.licensingDirectoryWritable,
        lastTrialBootstrapError: diagnostics.lastTrialBootstrapError,
        cryptoMode: diagnostics.cryptoMode,
        trialCreationDisabled: diagnostics.trialCreationDisabled,
      },
    };
  }

  private mapPlan(plan: LicencePlan | null): LicenseStatusResponse['plan'] {
    if (plan === 'trial') {
      return 'trial';
    }

    if (plan === 'annual' || plan === 'three_year' || plan === 'lifetime') {
      return 'annual';
    }

    return null;
  }

  private featuresToList(features: LicenceFeatures): string[] {
    return (Object.keys(features) as (keyof LicenceFeatures)[]).filter((key) => features[key]);
  }

  private buildBrowserModeStatus(): LicenseStatusResponse {
    return {
      status: 'ACTIVE',
      displayMode: 'Licensed',
      uiState: 'Licensed',
      plan: 'annual',
      companyName: null,
      licenseId: null,
      customerEmail: null,
      startsAt: null,
      expiresAt: null,
      daysRemaining: 0,
      maxDevices: null,
      features: ['evidence'],
      featureFlags: {
        whatsappMonitoring: false,
        guardSafe: false,
        evidence: true,
        alerts: false,
        incidents: false,
        exports: false,
      },
      installationId: null,
      machineFingerprint: null,
      activatedAt: null,
      lastSuccessfulValidationAt: null,
      legacy: false,
      message: 'Browser mode — commercial desktop licensing is not active in this environment.',
      collectorAllowed: false,
      operationsAllowed: true,
      requiresActivation: false,
      mode: 'unlicensed',
      buildId: null,
      appVersion: null,
    };
  }

  private evaluationFromBrowserStatus(status: LicenseStatusResponse): LicenceEvaluation {
    return {
      mode: 'unlicensed',
      status: 'not_activated',
      plan: null,
      displayMode: 'Not activated',
      companyName: status.companyName,
      licenceId: null,
      installationId: 'browser',
      machineFingerprint: 'browser',
      startsAt: null,
      expiresAt: null,
      daysRemaining: 0,
      features: status.featureFlags!,
      message: status.message,
      trialActive: false,
      commercialActive: false,
      collectorAllowed: false,
      operationsAllowed: true,
      requiresActivation: false,
      legacyMigrated: false,
      activatedAt: null,
      lastSuccessfulValidationAt: null,
      buildId: null,
      appVersion: null,
    };
  }

  private readBuildMetadata(): { buildId: string | null; appVersion: string | null } {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const pkg = require('../../package.json') as { version?: string; buildId?: string };
      return {
        buildId: process.env.PATROL_BUILD_ID?.trim() || pkg.buildId || null,
        appVersion: process.env.PATROL_APP_VERSION?.trim() || pkg.version || null,
      };
    } catch {
      return {
        buildId: process.env.PATROL_BUILD_ID?.trim() || null,
        appVersion: process.env.PATROL_APP_VERSION?.trim() || null,
      };
    }
  }
}
