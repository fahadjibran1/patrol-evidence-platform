import {
  assertIanaTimeZone,
  getOperationalDateUtcBounds,
  getPatrolTimeParts,
  operationalDateTimeToUtc,
} from './patrol-time.util';

describe('getPatrolTimeParts', () => {
  const originalBusinessTimeZone = process.env.BUSINESS_TIMEZONE;

  beforeEach(() => {
    process.env.BUSINESS_TIMEZONE = 'Europe/London';
  });

  afterAll(() => {
    process.env.BUSINESS_TIMEZONE = originalBusinessTimeZone;
  });

  it('derives the correct patrol date and hour in Europe/London during winter', () => {
    const result = getPatrolTimeParts(new Date('2026-01-15T23:30:00.000Z'));

    expect(result.date).toBe('2026-01-15');
    expect(result.hour).toBe(23);
  });

  it('derives the correct patrol date and hour in Europe/London during summer time', () => {
    const result = getPatrolTimeParts(new Date('2026-07-01T23:30:00.000Z'));

    expect(result.date).toBe('2026-07-02');
    expect(result.hour).toBe(0);
  });

  it.each([
    ['Europe/London', '2026-09-14'],
    ['America/New_York', '2026-09-13'],
    ['Asia/Dubai', '2026-09-14'],
    ['Asia/Kolkata', '2026-09-14'],
    ['Pacific/Auckland', '2026-09-14'],
    ['America/Los_Angeles', '2026-09-13'],
  ])('classifies the same UTC instant in %s as %s', (timeZone, expectedDate) => {
    expect(getPatrolTimeParts(new Date('2026-09-14T00:30:00.000Z'), timeZone).date).toBe(expectedDate);
  });

  it('resolves half-hour day boundaries for India', () => {
    const bounds = getOperationalDateUtcBounds('2026-09-14', 'Asia/Kolkata');
    expect(bounds.startInclusive.toISOString()).toBe('2026-09-13T18:30:00.000Z');
    expect(bounds.endExclusive.toISOString()).toBe('2026-09-14T18:30:00.000Z');
  });

  it.each([
    ['Europe/London', '2026-03-29', 1, '2026-03-29T01:00:00.000Z', 2],
    ['America/New_York', '2026-03-08', 2, '2026-03-08T07:00:00.000Z', 3],
  ])('moves a nonexistent %s spring time to the first valid local instant', (timeZone, date, hour, iso, localHour) => {
    const resolved = operationalDateTimeToUtc({ date, hour }, timeZone);
    expect(resolved.toISOString()).toBe(iso);
    expect(getPatrolTimeParts(resolved, timeZone).hour).toBe(localHour);
  });

  it.each([
    ['Europe/London', '2026-10-25', 1, '2026-10-25T00:00:00.000Z'],
    ['America/New_York', '2026-11-01', 1, '2026-11-01T05:00:00.000Z'],
  ])('selects the earlier occurrence of an ambiguous %s autumn time', (timeZone, date, hour, iso) => {
    expect(operationalDateTimeToUtc({ date, hour }, timeZone).toISOString()).toBe(iso);
  });

  it('rejects invalid timezone identifiers instead of silently falling back', () => {
    expect(() => assertIanaTimeZone('UTC+5')).toThrow('Choose a valid time zone');
  });
});
