import type { LicenseSnapshot, LicenseStatusResponse } from '../../web/src/types';
import { projectAuthoritativeLicenceStatus } from '../../web/src/state/entitlement-state';

function snapshot(status: LicenseSnapshot['status']): LicenseSnapshot {
  return {
    companyName: 'Tech Guards Security',
    licenseKey: null,
    licenseId: status === 'ACTIVE' ? 'lic-active' : null,
    licenseType: status === 'ACTIVE' ? 'ANNUAL' : 'TRIAL',
    plan: status === 'ACTIVE' ? 'annual' : 'trial',
    displayMode: status === 'ACTIVE' ? 'Licensed' : 'Trial',
    legacy: false,
    trialStartDate: null,
    trialEndDate: null,
    startsAt: null,
    expiresAt: null,
    status,
    daysRemaining: 0,
    installationId: 'installation-public-id',
    maxDevices: 1,
    features: [],
    activatedAt: null,
    lastSuccessfulValidationAt: null,
    createdAt: null,
    updatedAt: null,
    message: '',
    collectorAllowed: status === 'ACTIVE',
    operationsAllowed: status === 'ACTIVE',
    requiresActivation: status !== 'ACTIVE',
  };
}

function response(status: 'ACTIVE' | 'EXPIRED'): LicenseStatusResponse {
  return {
    status,
    displayMode: status === 'ACTIVE' ? 'Licensed' : 'Not activated',
    uiState: status === 'ACTIVE' ? 'Licensed' : 'Expired',
    plan: status === 'ACTIVE' ? 'annual' : null,
    companyName: 'Tech Guards Security',
    licenseId: status === 'ACTIVE' ? 'lic-active' : null,
    customerEmail: null,
    startsAt: status === 'ACTIVE' ? '2026-09-18T00:00:00.000Z' : null,
    expiresAt: status === 'ACTIVE' ? '2027-09-18T23:59:59.000Z' : null,
    daysRemaining: status === 'ACTIVE' ? 364 : 0,
    maxDevices: status === 'ACTIVE' ? 1 : null,
    features: status === 'ACTIVE' ? ['whatsappMonitoring'] : [],
    installationId: 'installation-public-id',
    activatedAt: status === 'ACTIVE' ? '2026-09-18T00:00:00.000Z' : null,
    lastSuccessfulValidationAt: status === 'ACTIVE' ? '2026-09-19T00:00:00.000Z' : null,
    legacy: false,
    message: status === 'ACTIVE' ? 'Licensed' : 'Licence expired',
    collectorAllowed: status === 'ACTIVE',
    operationsAllowed: status === 'ACTIVE',
    requiresActivation: status !== 'ACTIVE',
  };
}

describe('frontend entitlement live state transitions', () => {
  it('projects EXPIRED to annual Licensed in the same renderer state', () => {
    const projected = projectAuthoritativeLicenceStatus(snapshot('EXPIRED'), response('ACTIVE'));
    expect(projected).toMatchObject({
      status: 'ACTIVE',
      displayMode: 'Licensed',
      licenseType: 'ANNUAL',
      plan: 'annual',
      collectorAllowed: true,
      operationsAllowed: true,
      requiresActivation: false,
    });
  });

  it('projects the inverse transition without leaving a licensed summary behind', () => {
    const projected = projectAuthoritativeLicenceStatus(snapshot('ACTIVE'), response('EXPIRED'));
    expect(projected).toMatchObject({
      status: 'EXPIRED',
      displayMode: 'Not activated',
      collectorAllowed: false,
      operationsAllowed: false,
      requiresActivation: true,
    });
  });
});
