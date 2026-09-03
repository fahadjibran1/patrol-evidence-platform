import type { LocalTrialRecord } from '@patrol/license-core';
import { LicenceEvaluationService } from './licence-evaluation.service';

describe('LicenceEvaluationService cache', () => {
  const record: LocalTrialRecord = {
    installationId: 'installation',
    machineFingerprint: 'fingerprint',
    startedAt: '2026-09-01T00:00:00.000Z',
    expiresAt: '2026-10-01T23:59:59.000Z',
    lastSeenAt: '2026-09-03T00:00:00.000Z',
    consumed: false,
    legacyMigrated: false,
  };

  beforeEach(() => jest.useFakeTimers().setSystemTime(new Date('2026-09-03T12:00:00.000Z')));
  afterEach(() => jest.useRealTimers());

  function harness() {
    let revision = 0;
    const identity = {
      getOrCreateIdentity: jest.fn(() => ({ installationId: 'installation', machineFingerprint: 'fingerprint' })),
    };
    const trial = {
      getStateRevision: jest.fn(() => revision),
      getOrCreateTrial: jest.fn(() => ({ ...record })),
      readTrialRecord: jest.fn(() => ({ ...record })),
      detectClockRollback: jest.fn(() => false),
      isTrialActive: jest.fn(() => true),
      getLastBootstrapError: jest.fn(() => null),
    };
    const service = new LicenceEvaluationService(identity as never, trial as never);
    return { service, identity, trial, mutate: () => { revision += 1; } };
  }

  it('shares one evaluation across concurrent callers', async () => {
    const { service, identity } = harness();
    const values = await Promise.all([Promise.resolve(service.evaluate()), Promise.resolve(service.evaluate())]);
    expect(values[0]).toBe(values[1]);
    expect(identity.getOrCreateIdentity).toHaveBeenCalledTimes(1);
  });

  it('expires after the explicit two-second TTL', () => {
    const { service, identity } = harness();
    service.evaluate();
    jest.advanceTimersByTime(LicenceEvaluationService.CACHE_TTL_MS + 1);
    service.evaluate();
    expect(identity.getOrCreateIdentity).toHaveBeenCalledTimes(2);
  });

  it('invalidates on explicit and trial-state mutations', () => {
    const { service, identity, mutate } = harness();
    service.evaluate();
    service.invalidate();
    service.evaluate();
    mutate();
    service.evaluate();
    expect(identity.getOrCreateIdentity).toHaveBeenCalledTimes(3);
  });

  it('does not cache a failed evaluation', () => {
    const { service, identity } = harness();
    identity.getOrCreateIdentity.mockImplementationOnce(() => { throw new Error('probe failed'); });
    expect(() => service.evaluate()).toThrow('probe failed');
    expect(service.evaluate().status).toBe('active');
    expect(identity.getOrCreateIdentity).toHaveBeenCalledTimes(2);
  });

  it('makes rollback changes visible no later than the TTL', () => {
    const { service, trial } = harness();
    expect(service.evaluate().status).toBe('active');
    trial.detectClockRollback.mockReturnValue(true);
    expect(service.evaluate().status).toBe('active');
    jest.advanceTimersByTime(LicenceEvaluationService.CACHE_TTL_MS + 1);
    expect(service.evaluate().status).toBe('clock_rollback');
  });
});
