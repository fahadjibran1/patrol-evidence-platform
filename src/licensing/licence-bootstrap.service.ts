import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { getStoredCommercialLicence } from './commercial-licence-store.util';
import { InstallationIdentityService } from './installation-identity.service';
import { LicenceEvaluationService } from './licence-evaluation.service';
import { LocalTrialService } from './local-trial.service';

/**
 * Runs first-run commercial/trial licensing bootstrap as soon as the Nest backend starts.
 * Trial creation is delegated to LocalTrialService.getOrCreateTrial() via evaluation.
 */
@Injectable()
export class LicenceBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(LicenceBootstrapService.name);

  constructor(
    private readonly identityService: InstallationIdentityService,
    private readonly trialService: LocalTrialService,
    private readonly evaluationService: LicenceEvaluationService,
  ) {}

  onModuleInit(): void {
    this.bootstrapFirstRunLicensing();
  }

  bootstrapFirstRunLicensing(): void {
    this.logger.log('LICENCE_BOOTSTRAP_START');

    const desktopMode = Boolean(
      process.env.DESKTOP_CONFIG_PATH?.trim() || process.env.PATROL_LICENSE_DATA_ROOT?.trim(),
    );
    if (!desktopMode) {
      this.logger.log('LICENCE_BOOTSTRAP_SKIP reason=not-desktop-mode');
      return;
    }

    if (process.env.PATROL_DISABLE_LOCAL_TRIAL?.trim()) {
      this.logger.warn(
        `LICENCE_BOOTSTRAP_WARNING PATROL_DISABLE_LOCAL_TRIAL=${process.env.PATROL_DISABLE_LOCAL_TRIAL} — production builds must not disable trial creation`,
      );
    }

    try {
      const identity = this.identityService.getOrCreateIdentity();
      this.logger.log(
        `INSTALLATION_IDENTITY_READY id=${identity.installationId} dataRoot=${this.identityService.getDataRoot() ?? 'null'}`,
      );

      const commercial = getStoredCommercialLicence();
      if (commercial) {
        this.logger.log('COMMERCIAL_LICENCE_FOUND');
      } else {
        this.logger.log('COMMERCIAL_LICENCE_NOT_FOUND');
      }

      const evaluation = this.evaluationService.evaluate({
        commercial,
        // Evaluation itself calls getOrCreateTrial when commercial is absent.
      });

      const diagnostics = this.trialService.getDiagnostics();
      if (diagnostics.lastTrialBootstrapError) {
        this.logger.warn(`LICENCE_BOOTSTRAP_DIAGNOSTIC ${diagnostics.lastTrialBootstrapError}`);
      }

      this.logger.log(
        `LICENCE_EVALUATION_RESULT status=${evaluation.status} mode=${evaluation.mode} displayMode=${evaluation.displayMode} trialActive=${evaluation.trialActive} daysRemaining=${evaluation.daysRemaining ?? 0}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`LICENCE_BOOTSTRAP_FAILURE ${message}`);
    }
  }
}
