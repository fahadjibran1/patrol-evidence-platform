import {
  enumerateScheduleHours,
  findActivePatrolSchedule,
  normalizeActiveDays,
  scheduleCoversHour,
  scheduleIsActiveOnDate,
} from './patrol-schedule.util';

describe('patrol-schedule.util', () => {
  it('covers a same-day window', () => {
    expect(scheduleCoversHour(6, 18, 5)).toBe(false);
    expect(scheduleCoversHour(6, 18, 6)).toBe(true);
    expect(scheduleCoversHour(6, 18, 17)).toBe(true);
    expect(scheduleCoversHour(6, 18, 18)).toBe(false);
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
    expect(normalizeActiveDays(null)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('picks the schedule that covers the hour', () => {
    const schedules = [
      {
        id: 'day',
        siteId: 'site-1',
        scheduleName: 'Day shift',
        startHour: 6,
        endHour: 18,
        activeDays: [1, 2, 3, 4, 5],
        active: true,
        expectedGuards: 3,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'night',
        siteId: 'site-1',
        scheduleName: 'Night shift',
        startHour: 18,
        endHour: 6,
        activeDays: [1, 2, 3, 4, 5],
        active: true,
        expectedGuards: 4,
        createdAt: '2026-01-02T00:00:00.000Z',
      },
    ];

    expect(findActivePatrolSchedule(schedules, 'site-1', '2026-03-31', 10)?.id).toBe('day');
    expect(findActivePatrolSchedule(schedules, 'site-1', '2026-03-31', 20)?.id).toBe('night');
    expect(findActivePatrolSchedule(schedules, 'site-1', '2026-03-31', 3)?.expectedGuards).toBe(4);
  });
});
