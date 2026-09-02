export const LICENSE_FORMAT_PREFIX = 'TG1';
export const LICENSE_PAYLOAD_VERSION = 1;

export const LEGACY_TRIAL_REMOVAL_DATE = '2026-12-31';

export type LicensePlan = 'trial' | 'monthly' | 'annual';

export type LicenseDisplayStatus = 'ACTIVE' | 'TRIAL_ACTIVE' | 'EXPIRED' | 'INVALID' | 'NOT_ACTIVATED';

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

export interface LicenseVerificationResult {
  valid: boolean;
  reason?: string;
  payload?: LicensePayload;
  legacy?: boolean;
  signatureValid?: boolean;
}
