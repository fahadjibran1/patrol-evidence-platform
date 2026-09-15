import { Injectable } from '@nestjs/common';
import {
  EXPIRED_LICENCE_FEATURES,
  TRIAL_LICENCE_FEATURES,
  daysRemainingUntil,
  todayUtcDate,
  type LicenceEvaluation,
  type LicenceFeatures,
  type LocalTrialRecord,
  type SignedCommercialLicence,
} from '@patrol/license-core';
import { InstallationIdentityService } from './installation-identity.service';
import { LocalTrialService } from './local-trial.service';
import { getStoredCommercialLicence } from './commercial-licence-store.util';
import { loadLicensePublicKey } from './license-public-key.util';
import { verifyCommercialLicence } from '@patrol/license-core';

@Injectable()
export class LicenceEvaluationService {
  static readonly CACHE_TTL_MS = 2_000;
  private cachedEvaluation: { value: LicenceEvaluation; expiresAt: number; trialRevision: number } | null = null;

  constructor(
    private readonly identityService: InstallationIdentityService,
    private readonly trialService: LocalTrialService,
  ) {}

  evaluate(options?: {
    commercial?: SignedCommercialLicence | null;
    skipTrialCreation?: boolean;
  }): LicenceEvaluation {
    const cacheable = options === undefined;
    const now = Date.now();
    if (
      cacheable &&
      this.cachedEvaluation &&
      now < this.cachedEvaluation.expiresAt &&
      this.cachedEvaluation.trialRevision === this.trialService.getStateRevision()
    ) {
      return this.cachedEvaluation.value;
    }

    const evaluation = this.evaluateUncached(options);
    if (cacheable) {
      this.cachedEvaluation = {
        value: evaluation,
        expiresAt: Date.now() + LicenceEvaluationService.CACHE_TTL_MS,
        trialRevision: this.trialService.getStateRevision(),
      };
    }
    return evaluation;
  }

  /** Bypasses the short request cache for exact lifecycle-boundary enforcement. */
  evaluateFresh(): LicenceEvaluation {
    const evaluation = this.evaluateUncached();
    this.cachedEvaluation = {
      value: evaluation,
      expiresAt: Date.now() + LicenceEvaluationService.CACHE_TTL_MS,
      trialRevision: this.trialService.getStateRevision(),
    };
    return evaluation;
  }

  invalidate(): void {
    this.cachedEvaluation = null;
  }

  private evaluateUncached(options?: {
    commercial?: SignedCommercialLicence | null;
    skipTrialCreation?: boolean;
  }): LicenceEvaluation {
    const identity = this.identityService.getOrCreateIdentity();
    const buildMeta = readBuildMetadata();
    const commercial = options?.commercial ?? getStoredCommercialLicence();

    if (commercial) {
      const verification = verifyCommercialLicence({
        licence: commercial,
        publicKey: loadLicensePublicKey(),
        installationId: identity.installationId,
        machineFingerprint: identity.machineFingerprint,
        today: todayUtcDate(),
      });

      if (verification.valid && verification.payload) {
        const payload = verification.payload;
        return this.buildEvaluation({
          mode: 'commercial',
          status: 'active',
          displayMode: 'Licensed',
          plan: payload.plan,
          companyName: payload.companyName,
          licenceId: payload.licenceId,
          installationId: identity.installationId,
          machineFingerprint: identity.machineFingerprint,
          startsAt: payload.startsAt.slice(0, 10),
          expiresAt: payload.expiresAt,
          daysRemaining: daysRemainingUntil(payload.expiresAt),
          features: payload.features,
          message:
            payload.expiresAt === null
              ? 'Lifetime commercial licence is active on this workstation.'
              : `Commercial licence active. ${daysRemainingUntil(payload.expiresAt)} day(s) remaining.`,
          trialActive: false,
          commercialActive: true,
          collectorAllowed: payload.features.whatsappMonitoring,
          operationsAllowed: true,
          requiresActivation: false,
          legacyMigrated: false,
          activatedAt: null,
          lastSuccessfulValidationAt: new Date().toISOString(),
          buildId: buildMeta.buildId,
          appVersion: buildMeta.appVersion,
        });
      }

      if (verification.payload && verification.reason?.toLowerCase().includes('expired')) {
        return this.buildExpiredCommercial(identity, verification.payload.features, verification.payload, buildMeta);
      }

      if (verification.reason?.toLowerCase().includes('workstation') || verification.reason?.toLowerCase().includes('installation')) {
        return this.buildEvaluation({
          mode: 'invalid',
          status: 'wrong_machine',
          displayMode: 'Invalid',
          plan: commercial.payload.plan,
          companyName: commercial.payload.companyName,
          licenceId: commercial.payload.licenceId,
          installationId: identity.installationId,
          machineFingerprint: identity.machineFingerprint,
          startsAt: commercial.payload.startsAt.slice(0, 10),
          expiresAt: commercial.payload.expiresAt,
          daysRemaining: daysRemainingUntil(commercial.payload.expiresAt),
          features: EXPIRED_LICENCE_FEATURES,
          message: verification.reason ?? 'Licence is not valid for this workstation.',
          trialActive: false,
          commercialActive: false,
          collectorAllowed: false,
          operationsAllowed: false,
          requiresActivation: true,
          legacyMigrated: false,
          activatedAt: null,
          lastSuccessfulValidationAt: null,
          buildId: buildMeta.buildId,
          appVersion: buildMeta.appVersion,
        });
      }

      return this.buildEvaluation({
        mode: 'invalid',
        status: 'invalid',
        displayMode: 'Invalid',
        plan: commercial.payload.plan,
        companyName: commercial.payload.companyName,
        licenceId: commercial.payload.licenceId,
        installationId: identity.installationId,
        machineFingerprint: identity.machineFingerprint,
        startsAt: commercial.payload.startsAt.slice(0, 10),
        expiresAt: commercial.payload.expiresAt,
        daysRemaining: daysRemainingUntil(commercial.payload.expiresAt),
        features: EXPIRED_LICENCE_FEATURES,
        message: verification.reason ?? 'Commercial licence is not valid.',
        trialActive: false,
        commercialActive: false,
        collectorAllowed: false,
        operationsAllowed: false,
        requiresActivation: true,
        legacyMigrated: false,
        activatedAt: null,
        lastSuccessfulValidationAt: null,
        buildId: buildMeta.buildId,
        appVersion: buildMeta.appVersion,
      });
    }

    const trial = options?.skipTrialCreation
      ? this.trialService.readTrialRecord()
      : this.trialService.getOrCreateTrial({ hasCommercialLicence: false });

    if (trial) {
      if (this.trialService.detectClockRollback(trial)) {
        return this.buildEvaluation({
          mode: 'invalid',
          status: 'clock_rollback',
          displayMode: 'Invalid',
          plan: 'trial',
          companyName: null,
          licenceId: null,
          installationId: identity.installationId,
          machineFingerprint: identity.machineFingerprint,
          startsAt: trial.startedAt.slice(0, 10),
          expiresAt: trial.expiresAt,
          daysRemaining: 0,
          features: EXPIRED_LICENCE_FEATURES,
          message: 'System clock rollback detected. Licence evaluation is blocked until the clock is corrected.',
          trialActive: false,
          commercialActive: false,
          collectorAllowed: false,
          operationsAllowed: false,
          requiresActivation: true,
          legacyMigrated: trial.legacyMigrated === true,
          activatedAt: trial.startedAt,
          lastSuccessfulValidationAt: trial.lastSeenAt,
          buildId: buildMeta.buildId,
          appVersion: buildMeta.appVersion,
        });
      }

      if (this.trialService.isTrialActive(trial)) {
        const expiresDate = trial.expiresAt.slice(0, 10);
        const remaining = daysRemainingUntil(expiresDate) ?? 0;
        return this.buildEvaluation({
          mode: 'trial',
          status: 'active',
          displayMode: 'Trial Active',
          plan: 'trial',
          companyName: null,
          licenceId: null,
          installationId: identity.installationId,
          machineFingerprint: identity.machineFingerprint,
          startsAt: trial.startedAt.slice(0, 10),
          expiresAt: trial.expiresAt,
          daysRemaining: remaining,
          features: TRIAL_LICENCE_FEATURES,
          message: `Trial active. ${remaining} day(s) remaining.`,
          trialActive: true,
          commercialActive: false,
          collectorAllowed: true,
          operationsAllowed: true,
          requiresActivation: false,
          legacyMigrated: trial.legacyMigrated === true,
          activatedAt: trial.startedAt,
          lastSuccessfulValidationAt: trial.lastSeenAt,
          buildId: buildMeta.buildId,
          appVersion: buildMeta.appVersion,
        });
      }

      return this.buildExpiredTrial(identity, trial, buildMeta);
    }

    const bootstrapError = this.trialService.getLastBootstrapError();
    return this.buildEvaluation({
      mode: 'unlicensed',
      status: 'not_activated',
      displayMode: 'Not activated',
      plan: null,
      companyName: null,
      licenceId: null,
      installationId: identity.installationId,
      machineFingerprint: identity.machineFingerprint,
      startsAt: null,
      expiresAt: null,
      daysRemaining: 0,
      features: EXPIRED_LICENCE_FEATURES,
      message: bootstrapError
        ? `No active trial or commercial licence. ${bootstrapError}`
        : 'No active trial or commercial licence. Export a request file to obtain a licence.',
      trialActive: false,
      commercialActive: false,
      collectorAllowed: false,
      operationsAllowed: false,
      requiresActivation: true,
      legacyMigrated: false,
      activatedAt: null,
      lastSuccessfulValidationAt: null,
      buildId: buildMeta.buildId,
      appVersion: buildMeta.appVersion,
    });
  }

  assertFeature(feature: keyof LicenceFeatures, evaluation?: LicenceEvaluation): void {
    const current = evaluation ?? this.evaluate();
    if (!current.features[feature]) {
      throw new Error(
        current.status === 'expired'
          ? `Licence expired — ${feature} is disabled. Existing evidence and configuration are preserved.`
          : `A valid licence is required for ${feature}.`,
      );
    }
  }

  private buildExpiredCommercial(
    identity: { installationId: string; machineFingerprint: string },
    features: LicenceFeatures,
    payload: SignedCommercialLicence['payload'],
    buildMeta: { buildId: string | null; appVersion: string | null },
  ): LicenceEvaluation {
    return this.buildEvaluation({
      mode: 'commercial',
      status: 'expired',
      displayMode: 'Expired',
      plan: payload.plan,
      companyName: payload.companyName,
      licenceId: payload.licenceId,
      installationId: identity.installationId,
      machineFingerprint: identity.machineFingerprint,
      startsAt: payload.startsAt.slice(0, 10),
      expiresAt: payload.expiresAt,
      daysRemaining: 0,
      features: { ...EXPIRED_LICENCE_FEATURES, evidence: true },
      message:
        'Commercial licence has expired. Existing evidence, configuration, database and images are preserved.',
      trialActive: false,
      commercialActive: false,
      collectorAllowed: false,
      operationsAllowed: false,
      requiresActivation: true,
      legacyMigrated: false,
      activatedAt: null,
      lastSuccessfulValidationAt: null,
      buildId: buildMeta.buildId,
      appVersion: buildMeta.appVersion,
    });
  }

  private buildExpiredTrial(
    identity: { installationId: string; machineFingerprint: string },
    trial: LocalTrialRecord,
    buildMeta: { buildId: string | null; appVersion: string | null },
  ): LicenceEvaluation {
    return this.buildEvaluation({
      mode: 'trial',
      status: 'expired',
      displayMode: 'Expired',
      plan: 'trial',
      companyName: null,
      licenceId: null,
      installationId: identity.installationId,
      machineFingerprint: identity.machineFingerprint,
      startsAt: trial.startedAt.slice(0, 10),
      expiresAt: trial.expiresAt,
      daysRemaining: 0,
      features: EXPIRED_LICENCE_FEATURES,
      message:
        'Trial has expired and will not reset automatically. Import a commercial licence to restore full operation. Existing data is preserved.',
      trialActive: false,
      commercialActive: false,
      collectorAllowed: false,
      operationsAllowed: false,
      requiresActivation: true,
      legacyMigrated: trial.legacyMigrated === true,
      activatedAt: trial.startedAt,
      lastSuccessfulValidationAt: trial.lastSeenAt,
      buildId: buildMeta.buildId,
      appVersion: buildMeta.appVersion,
    });
  }

  private buildEvaluation(partial: LicenceEvaluation): LicenceEvaluation {
    return partial;
  }
}

function readBuildMetadata(): { buildId: string | null; appVersion: string | null } {
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
