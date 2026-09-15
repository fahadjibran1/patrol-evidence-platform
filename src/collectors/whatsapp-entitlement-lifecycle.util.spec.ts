import {
  ENTITLEMENT_SAFETY_RECHECK_MS,
  entitlementExpiryBoundaryMs,
  monitoringEntitlementRestriction,
  nextEntitlementRecheckDelayMs,
} from './whatsapp-entitlement-lifecycle.util';

describe('WhatsApp monitoring entitlement lifecycle', () => {
  it('classifies active, expired trial and other licence restrictions without a second authority', () => {
    expect(monitoringEntitlementRestriction({ mode: 'trial', status: 'active', collectorAllowed: true })).toBeNull();
    expect(monitoringEntitlementRestriction({ mode: 'trial', status: 'expired', collectorAllowed: false })).toBe('TRIAL_EXPIRED');
    expect(monitoringEntitlementRestriction({ mode: 'commercial', status: 'expired', collectorAllowed: false })).toBe('LICENCE_REQUIRED');
    expect(monitoringEntitlementRestriction({ mode: 'invalid', status: 'clock_rollback', collectorAllowed: false })).toBe('LICENCE_REQUIRED');
  });

  it('uses an exact ISO trial instant and an inclusive UTC date for commercial expiry', () => {
    expect(entitlementExpiryBoundaryMs({ expiresAt: '2026-10-15T12:01:00.000Z' })).toBe(
      Date.parse('2026-10-15T12:01:00.001Z'),
    );
    expect(entitlementExpiryBoundaryMs({ expiresAt: '2026-10-15' })).toBe(
      Date.parse('2026-10-16T00:00:00.000Z'),
    );
    expect(entitlementExpiryBoundaryMs({ expiresAt: null })).toBeNull();
  });

  it.each([
    ['T-60 seconds', '2026-10-15T12:00:00.001Z', 60_000],
    ['T-1 second', '2026-10-15T12:00:59.001Z', 1_000],
    ['T', '2026-10-15T12:01:00.001Z', 1],
    ['T+1 second', '2026-10-15T12:01:01.001Z', 1],
    ['T+5 minutes', '2026-10-15T12:06:00.001Z', 1],
  ])('schedules the deterministic boundary at %s', (_label, now, expected) => {
    expect(
      nextEntitlementRecheckDelayMs(
        { expiresAt: '2026-10-15T12:01:00.000Z' },
        Date.parse(now),
      ),
    ).toBe(expected);
  });

  it('uses one modest safety check for non-expiring legacy licences and distant boundaries', () => {
    expect(nextEntitlementRecheckDelayMs({ expiresAt: null }, 0)).toBe(ENTITLEMENT_SAFETY_RECHECK_MS);
    expect(
      nextEntitlementRecheckDelayMs(
        { expiresAt: '2027-10-15' },
        Date.parse('2026-10-15T00:00:00.000Z'),
      ),
    ).toBe(ENTITLEMENT_SAFETY_RECHECK_MS);
  });

  it('is timezone-independent because entitlement boundaries are absolute UTC values', () => {
    const instant = '2026-10-15T12:01:00.000Z';
    expect(entitlementExpiryBoundaryMs({ expiresAt: instant })).toBe(Date.parse(instant) + 1);
  });
});
