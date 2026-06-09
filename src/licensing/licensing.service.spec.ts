import { ConfigService } from '@nestjs/config';
import { LicensingService } from './licensing.service';

describe('LicensingService', () => {
  function createConfigService(overrides?: Record<string, unknown>): ConfigService {
    const config = {
      businessTimeZone: 'Europe/London',
      trialDays: 30,
      licenseSigningSecret: 'patrol-evidence-platform-license-secret',
      ...overrides,
    };

    return {
      get: jest.fn((key: string) => config[key as keyof typeof config]),
    } as never;
  }

  const originalDesktopConfigPath = process.env.DESKTOP_CONFIG_PATH;

  beforeEach(() => {
    process.env.DESKTOP_CONFIG_PATH = 'C:\\tmp\\desktop-config.json';
    jest.useFakeTimers().setSystemTime(new Date('2026-05-10T09:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  afterAll(() => {
    process.env.DESKTOP_CONFIG_PATH = originalDesktopConfigPath;
  });

  it('accepts the development trial key and computes days remaining', () => {
    const service = new LicensingService(createConfigService());
    const snapshot = service.getLicenseSnapshot('Tech Guards Security', {
      companyName: 'Tech Guards Security',
      licenseKey: 'TG-TRIAL-DEV',
    });

    expect(snapshot.status).toBe('ACTIVE');
    expect(snapshot.licenseType).toBe('TRIAL');
    expect(snapshot.daysRemaining).toBe(30);
    expect(snapshot.collectorAllowed).toBe(true);
  });

  it('rejects a key generated for a different company', () => {
    const service = new LicensingService(createConfigService());
    const snapshot = service.getLicenseSnapshot('Tech Guards Security', {
      companyName: 'Tech Guards Security',
      licenseKey: 'TG-TRIAL-another-company-20260510-30-ABCDEF123456',
    });

    expect(snapshot.status).toBe('INVALID');
    expect(snapshot.collectorAllowed).toBe(false);
  });

  it('treats an old development trial as expired when stored dates are past', () => {
    const service = new LicensingService(createConfigService());
    const snapshot = service.getLicenseSnapshot('Tech Guards Security', {
      companyName: 'Tech Guards Security',
      licenseKey: 'TG-TRIAL-DEV',
      trialStartDate: '2026-03-01',
      trialEndDate: '2026-03-30',
    });

    expect(snapshot.status).toBe('EXPIRED');
    expect(snapshot.collectorAllowed).toBe(false);
  });
});
