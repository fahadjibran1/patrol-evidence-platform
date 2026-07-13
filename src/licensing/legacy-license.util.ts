import { createHash } from 'crypto';
import { getPatrolTimeParts } from '@/common/utils/patrol-time.util';
import type { DesktopWorkspaceConfig } from '@/desktop/desktop-config.util';
import { LEGACY_TRIAL_REMOVAL_DATE, type LicensePayload, type LicenseVerificationResult } from './license.types';
import { addDays, diffDaysInclusive } from './license-crypto.util';

export type LegacyLicenseType = 'TRIAL' | 'FULL';

export interface LegacyLicenseSnapshotInput {
  companyName: string | null;
  licenseKey: string;
  workspaceConfig: DesktopWorkspaceConfig;
  businessTimeZone: string;
  trialDays: number;
  signingSecret: string;
}

const DEVELOPMENT_TRIAL_KEY = 'TG-TRIAL-DEV';
const TRIAL_PREFIX = 'TG-TRIAL-';
const FULL_PREFIX = 'TG-FULL-';

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

export function isLegacyTrialKey(licenseKey: string): boolean {
  const trimmed = licenseKey.trim();
  return trimmed === DEVELOPMENT_TRIAL_KEY || trimmed.startsWith(TRIAL_PREFIX);
}

export function isSignedCommercialLicenseKey(licenseKey: string): boolean {
  return licenseKey.trim().startsWith('TG1.');
}

export function verifyLegacyLicense(input: LegacyLicenseSnapshotInput): LicenseVerificationResult {
  const licenseKey = input.licenseKey.trim();

  if (isSignedCommercialLicenseKey(licenseKey)) {
    return { valid: false, reason: 'Use commercial licence verification for TG1 keys.' };
  }

  if (licenseKey === DEVELOPMENT_TRIAL_KEY) {
    const startDate = input.workspaceConfig.trialStartDate ?? today(input.businessTimeZone);
    const endDate = input.workspaceConfig.trialEndDate ?? addDays(startDate, input.trialDays - 1);
    return buildLegacyTrialResult(input.companyName, licenseKey, startDate, endDate);
  }

  const trialKey = parseTrialKey(licenseKey);
  if (trialKey) {
    if (!companySlugMatches(trialKey.companySlug, input.companyName)) {
      return { valid: false, reason: 'This trial key was generated for a different company name.', legacy: true };
    }

    const expectedSignature = sign(['TRIAL', trialKey.companySlug, trialKey.startDate, String(trialKey.days)], input.signingSecret);
    if (trialKey.signature !== expectedSignature) {
      return { valid: false, reason: 'The trial key signature is not valid.', legacy: true };
    }

    return buildLegacyTrialResult(
      input.companyName,
      licenseKey,
      trialKey.startDate,
      addDays(trialKey.startDate, trialKey.days - 1),
    );
  }

  const fullKey = parseFullKey(licenseKey);
  if (fullKey) {
    if (!companySlugMatches(fullKey.companySlug, input.companyName)) {
      return { valid: false, reason: 'This full licence key was generated for a different company name.', legacy: true };
    }

    const expectedSignature = sign(['FULL', fullKey.companySlug], input.signingSecret);
    if (fullKey.signature !== expectedSignature) {
      return { valid: false, reason: 'The full licence key signature is not valid.', legacy: true };
    }

    return {
      valid: true,
      legacy: true,
      payload: buildLegacyFullPayload(input.companyName, licenseKey),
    };
  }

  return { valid: false, reason: 'This licence key format is not recognised.' };
}

function buildLegacyTrialResult(
  companyName: string | null,
  licenseKey: string,
  startDate: string,
  endDate: string,
): LicenseVerificationResult {
  const payload = buildLegacyTrialPayload(companyName, licenseKey, startDate, endDate);
  return {
    valid: true,
    legacy: true,
    payload,
  };
}

function buildLegacyTrialPayload(
  companyName: string | null,
  licenseKey: string,
  startDate: string,
  endDate: string,
): LicensePayload {
  return {
    version: 1,
    licenseId: `legacy-trial-${slugify(licenseKey).slice(0, 24)}`,
    companyName: companyName?.trim() || 'Unknown company',
    plan: 'trial',
    issuedAt: startDate,
    startsAt: startDate,
    expiresAt: endDate,
    maxDevices: 1,
    features: ['legacy-trial'],
    notes: `Legacy TG-TRIAL key (scheduled removal ${LEGACY_TRIAL_REMOVAL_DATE})`,
  };
}

function buildLegacyFullPayload(companyName: string | null, licenseKey: string): LicensePayload {
  const today = new Date().toISOString().slice(0, 10);
  return {
    version: 1,
    licenseId: `legacy-full-${slugify(licenseKey).slice(0, 24)}`,
    companyName: companyName?.trim() || 'Unknown company',
    plan: 'annual',
    issuedAt: today,
    startsAt: today,
    expiresAt: '2099-12-31',
    maxDevices: 1,
    features: ['legacy-full'],
    notes: `Legacy TG-FULL key (scheduled removal ${LEGACY_TRIAL_REMOVAL_DATE})`,
  };
}

export function getLegacyLicenseExpiryStatus(
  payload: LicensePayload,
  businessTimeZone: string,
): { status: 'ACTIVE' | 'EXPIRED'; daysRemaining: number } {
  const today = todayDate(businessTimeZone);
  if (today > payload.expiresAt) {
    return { status: 'EXPIRED', daysRemaining: 0 };
  }

  return {
    status: 'ACTIVE',
    daysRemaining: diffDaysInclusive(today, payload.expiresAt),
  };
}

function parseTrialKey(licenseKey: string): ParsedTrialKey | null {
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

function parseFullKey(licenseKey: string): ParsedFullKey | null {
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

function companySlugMatches(companySlug: string, companyName: string | null): boolean {
  if (companySlug === 'any' || companySlug === 'dev') {
    return true;
  }

  if (!companyName) {
    return false;
  }

  return slugify(companyName) === companySlug;
}

function sign(parts: string[], secret: string): string {
  return createHash('sha256')
    .update([...parts, secret].join('|'))
    .digest('hex')
    .slice(0, 12)
    .toUpperCase();
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'company';
}

function todayDate(businessTimeZone: string): string {
  return getPatrolTimeParts(new Date(), businessTimeZone).date;
}

function today(businessTimeZone: string): string {
  return todayDate(businessTimeZone);
}
