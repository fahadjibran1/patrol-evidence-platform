import { getPatrolTimeParts } from './patrol-time.util';

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
});
