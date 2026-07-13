export const LICENSE_FORMAT_PREFIX = 'TG1';
export const LICENSE_PAYLOAD_VERSION = 1;

/** TODO: Remove legacy TG-TRIAL support after this date. */
export const LEGACY_TRIAL_REMOVAL_DATE = '2026-12-31';

export type LicensePlan = 'trial' | 'monthly' | 'annual';

export type LicenseDisplayStatus = 'ACTIVE' | 'EXPIRED' | 'INVALID' | 'NOT_ACTIVATED';

export interface LicensePayload {
  version: number;
  licenseId: string;
  companyName: string;
  customerEmail?: string;
  plan: LicensePlan;
  issuedAt: string;
  startsAt: string;
  expiresAt: string;
  maxDevices: number;
  features: string[];
  notes?: string;
}

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
  plan: LicensePlan | null;
  companyName: string | null;
  licenseId: string | null;
  customerEmail: string | null;
  startsAt: string | null;
  expiresAt: string | null;
  daysRemaining: number;
  maxDevices: number | null;
  features: string[];
  installationId: string | null;
  activatedAt: string | null;
  lastSuccessfulValidationAt: string | null;
  legacy: boolean;
  message: string;
  collectorAllowed: boolean;
  operationsAllowed: boolean;
  requiresActivation: boolean;
}
