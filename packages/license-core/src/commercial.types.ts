/** Commercial offline licensing schemas for Patrol Evidence Platform. */

export type LicenceMode = 'trial' | 'commercial' | 'unlicensed' | 'invalid';

export type LicencePlan = 'trial' | 'annual' | 'three_year' | 'lifetime';

export type LicenceStatus =
  | 'active'
  | 'expired'
  | 'invalid'
  | 'not_activated'
  | 'clock_rollback'
  | 'wrong_machine';

export interface LicenceFeatures {
  whatsappMonitoring: boolean;
  guardSafe: boolean;
  evidence: boolean;
  alerts: boolean;
  incidents: boolean;
  exports: boolean;
}

export const COMMERCIAL_LICENCE_PAYLOAD_VERSION = 1;
export const LICENCE_REQUEST_FILE_VERSION = 1;
export const LICENCE_PRODUCT_NAME = 'Patrol Evidence Platform';

export const ALL_LICENCE_FEATURES: LicenceFeatures = {
  whatsappMonitoring: true,
  guardSafe: true,
  evidence: true,
  alerts: true,
  incidents: true,
  exports: true,
};

export const TRIAL_LICENCE_FEATURES: LicenceFeatures = {
  ...ALL_LICENCE_FEATURES,
};

export const EXPIRED_LICENCE_FEATURES: LicenceFeatures = {
  whatsappMonitoring: false,
  guardSafe: false,
  evidence: true, // preserve read access to existing evidence
  alerts: false,
  incidents: false,
  exports: false,
};

export interface CommercialLicencePayload {
  version: number;
  licenceId: string;
  installationId: string;
  machineFingerprint: string;
  companyName: string;
  plan: Exclude<LicencePlan, 'trial'>;
  issuedAt: string;
  startsAt: string;
  /** ISO date (YYYY-MM-DD) or null for lifetime. */
  expiresAt: string | null;
  features: LicenceFeatures;
  product: string;
  maxDevices: number;
  notes?: string;
}

export interface SignedCommercialLicence {
  payload: CommercialLicencePayload;
  /** Base64url Ed25519 signature over canonical JSON of payload. */
  signature: string;
}

export interface LicenceRequestFile {
  version: number;
  installationId: string;
  machineFingerprint: string;
  companyName: string;
  product: string;
  appVersion: string;
  buildId: string;
  requestedPlan: Exclude<LicencePlan, 'trial'>;
  requestedAt: string;
}

export interface LicenceEvaluation {
  mode: LicenceMode;
  status: LicenceStatus;
  plan: LicencePlan | null;
  displayMode: 'Trial Active' | 'Licensed' | 'Expired' | 'Invalid' | 'Not activated';
  companyName: string | null;
  licenceId: string | null;
  installationId: string;
  machineFingerprint: string;
  startsAt: string | null;
  expiresAt: string | null;
  daysRemaining: number | null;
  features: LicenceFeatures;
  message: string;
  trialActive: boolean;
  commercialActive: boolean;
  collectorAllowed: boolean;
  operationsAllowed: boolean;
  requiresActivation: boolean;
  legacyMigrated: boolean;
  activatedAt: string | null;
  lastSuccessfulValidationAt: string | null;
  buildId: string | null;
  appVersion: string | null;
}

export interface LocalTrialRecord {
  installationId: string;
  machineFingerprint: string;
  startedAt: string;
  expiresAt: string;
  lastSeenAt: string;
  consumed: boolean;
  legacyMigrated?: boolean;
}
