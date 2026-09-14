import {
  businessDayOfWeek,
  enumerateScheduleHours,
  findActivePatrolSchedule,
  normalizeActiveDays,
  resolveSiteMonitoringHours,
  scheduleCoversHour,
  scheduleCrossesMidnight,
  scheduleIsActiveOnDate,
  SCHEDULE_FALLBACK_WINDOW,
} from './patrol-schedule.util';

describe('patrol-schedule.util', () => {
  it('covers a same-day window', () => {
    expect(scheduleCoversHour(6, 18, 5)).toBe(false);
    expect(scheduleCoversHour(6, 18, 6)).toBe(true);
    expect(scheduleCoversHour(6, 18, 17)).toBe(true);
    expect(scheduleCoversHour(6, 18, 18)).toBe(false);
  });

  it('covers 09:00–17:00 as hours 09 through 16', () => {
    expect(scheduleCoversHour(9, 17, 8)).toBe(false);
    expect(scheduleCoversHour(9, 17, 9)).toBe(true);
    expect(scheduleCoversHour(9, 17, 16)).toBe(true);
    expect(scheduleCoversHour(9, 17, 17)).toBe(false);
  });

  it('covers 06:00–22:00 as hours 06 through 21', () => {
    expect(enumerateScheduleHours(6, 22)).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]);
  });

  it('covers an overnight window', () => {
    expect(scheduleCoversHour(18, 6, 17)).toBe(false);
    expect(scheduleCoversHour(18, 6, 18)).toBe(true);
    expect(scheduleCoversHour(18, 6, 23)).toBe(true);
    expect(scheduleCoversHour(18, 6, 0)).toBe(true);
    expect(scheduleCoversHour(18, 6, 5)).toBe(true);
    expect(scheduleCoversHour(18, 6, 6)).toBe(false);
  });

  it('enumerates overnight hours', () => {
    expect(enumerateScheduleHours(18, 6)).toEqual([18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5]);
  });

  it('supports explicit 24-hour mode without treating 00:00–00:00 as closed', () => {
    expect(scheduleCoversHour(0, 0, 12, true)).toBe(true);
    expect(enumerateScheduleHours(9, 17, true)).toHaveLength(24);
    expect(scheduleCrossesMidnight(0, 0, true)).toBe(false);
  });

  it('treats null activeDays as all weekdays', () => {
    expect(
      scheduleIsActiveOnDate(
        {
          startHour: 6,
          endHour: 18,
          activeDays: null,
          active: true,
        },
        '2026-03-31',
      ),
    ).toBe(true);
  });

  it('uses fallback only when no schedule exists', () => {
    const fallback = resolveSiteMonitoringHours([], 'site-1', '2026-07-20');
    expect(fallback.source).toBe('fallback');
    expect(fallback.hours).toEqual(
      enumerateScheduleHours(SCHEDULE_FALLBACK_WINDOW.startHour, SCHEDULE_FALLBACK_WINDOW.endHour),
    );
  });

  it('marks disabled days without applying fallback', () => {
    const result = resolveSiteMonitoringHours(
      [
        {
          id: 'sch-1',
          siteId: 'site-1',
          startHour: 9,
          endHour: 17,
          activeDays: [1, 2, 3, 4, 5],
          active: true,
          createdAt: new Date('2026-01-01'),
        },
      ],
      'site-1',
      '2026-07-19', // Sunday
    );
    expect(result.source).toBe('configured');
    expect(result.disabledDay).toBe(true);
    expect(result.hours).toEqual([]);
  });

  it('keeps configured weekend schedules instead of fallback', () => {
    const result = resolveSiteMonitoringHours(
      [
        {
          id: 'weekday',
          siteId: 'site-1',
          startHour: 9,
          endHour: 17,
          activeDays: [1, 2, 3, 4, 5],
          active: true,
          createdAt: new Date('2026-01-01'),
        },
        {
          id: 'weekend',
          siteId: 'site-1',
          startHour: 10,
          endHour: 14,
          activeDays: [0, 6],
          active: true,
          createdAt: new Date('2026-01-02'),
        },
      ],
      'site-1',
      '2026-07-19', // Sunday
    );
    expect(result.source).toBe('configured');
    expect(result.hours).toEqual([10, 11, 12, 13]);
  });

  it('does not replace an existing valid schedule with fallback', () => {
    const result = resolveSiteMonitoringHours(
      [
        {
          id: 'sch-1',
          siteId: 'site-1',
          startHour: 9,
          endHour: 17,
          activeDays: [0, 1, 2, 3, 4, 5, 6],
          active: true,
          createdAt: new Date('2026-01-01'),
        },
      ],
      'site-1',
      '2026-07-20',
    );
    expect(result.source).toBe('configured');
    expect(result.hours[0]).toBe(9);
    expect(result.hours.at(-1)).toBe(16);
  });

  it('resolves Europe/London weekday across spring DST transition', () => {
    // 2026-03-29 is the UK spring-forward Sunday.
    expect(businessDayOfWeek('2026-03-28', 'Europe/London')).toBe(6);
    expect(businessDayOfWeek('2026-03-29', 'Europe/London')).toBe(0);
    expect(businessDayOfWeek('2026-03-30', 'Europe/London')).toBe(1);
  });

  it('uses the workspace civil date for weekday even across the international date line', () => {
    expect(businessDayOfWeek('2026-09-14', 'Pacific/Auckland')).toBe(1);
    expect(businessDayOfWeek('2026-09-14', 'America/Los_Angeles')).toBe(1);
  });

  it('normalizes active day arrays', () => {
    expect(normalizeActiveDays([1, 2, 9, 'x'])).toEqual([1, 2]);
  });

  it('finds the newest matching schedule for an hour', () => {
    const match = findActivePatrolSchedule(
      [
        {
          id: 'older',
          siteId: 'site-1',
          startHour: 6,
          endHour: 22,
          activeDays: [1],
          active: true,
          createdAt: new Date('2026-01-01'),
        },
        {
          id: 'newer',
          siteId: 'site-1',
          startHour: 9,
          endHour: 17,
          activeDays: [1],
          active: true,
          createdAt: new Date('2026-02-01'),
        },
      ],
      'site-1',
      '2026-07-20', // Monday
      10,
    );
    expect(match?.id).toBe('newer');
  });
});
