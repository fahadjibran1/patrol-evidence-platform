import type {
  LicenceFeatures,
  LicenceMode,
  LicenseDisplayStatus,
  LicensePayload,
  LicensePlan,
} from '@patrol/license-core';
import type { DesktopWorkspaceConfig } from '@/desktop/desktop-config.util';

export * from '@patrol/license-core';

export type LicenseType = 'TRIAL' | 'FULL' | 'MONTHLY' | 'ANNUAL' | 'THREE_YEAR' | 'LIFETIME';
export type LicenseStatus = 'ACTIVE' | 'TRIAL_ACTIVE' | 'EXPIRED' | 'INVALID' | 'NOT_ACTIVATED';

export interface StoredLicenseRecord {
  licenseKey: string;
  payload: LicensePayload;
  activatedAt: string;
  installationId: string;
  lastSuccessfulValidationAt: string;
  legacy?: boolean;
}

export interface LicenseStoreFile {
  installationId: string;
  license: StoredLicenseRecord | null;
}

export interface LicenseSnapshot {
  companyName: string | null;
  licenseKey: string | null;
  licenseId: string | null;
  licenseType: LicenseType;
  plan: LicensePlan | null;
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

export interface LicenseVerificationResult {
  valid: boolean;
  reason?: string;
  payload?: LicensePayload;
  legacy?: boolean;
  signatureValid?: boolean;
}

export interface LicenseStatusResponse {
  status: LicenseDisplayStatus;
  displayMode: 'Trial' | 'Licensed' | 'Not activated';
  /** User-facing commercial UI state. */
  uiState?: 'Trial Active' | 'Licensed' | 'Expired' | 'Invalid' | 'Not activated';
  plan: LicensePlan | null;
  companyName: string | null;
  licenseId: string | null;
  customerEmail: string | null;
  startsAt: string | null;
  expiresAt: string | null;
  daysRemaining: number;
  maxDevices: number | null;
  features: string[];
  featureFlags?: LicenceFeatures;
  installationId: string | null;
  machineFingerprint?: string | null;
  activatedAt: string | null;
  lastSuccessfulValidationAt: string | null;
  legacy: boolean;
  message: string;
  collectorAllowed: boolean;
  operationsAllowed: boolean;
  requiresActivation: boolean;
  mode?: LicenceMode;
  buildId?: string | null;
  appVersion?: string | null;
  diagnostics?: {
    dataRoot: string | null;
    trialFilePath: string | null;
    trialMarkerPresent: boolean;
    licensingDirectoryWritable: boolean | null;
    lastTrialBootstrapError: string | null;
    cryptoMode: 'dpapi' | 'test';
    trialCreationDisabled: boolean;
  };
}
