import {
  auditAggregationData,
  dedupeGroupsById,
  dedupeSchedulesById,
  normalizeScheduleRecord,
} from './dashboard-aggregation.util';

describe('dashboard-aggregation.util', () => {
  it('dedupes schedules and normalizes missing fields', () => {
    const schedules = dedupeSchedulesById([
      {
        id: 'sched-1',
        siteId: 'site-1',
        scheduleName: null as unknown as string,
        expectedGuards: null as unknown as number,
        frequencyMinutes: 60,
        startHour: 6,
        endHour: 18,
        graceMinutes: 15,
        activeDays: null as unknown as number[],
        active: true,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
      } as never,
      {
        id: 'sched-1',
        siteId: 'site-1',
        scheduleName: 'Night shift',
        expectedGuards: 4,
        frequencyMinutes: 60,
        startHour: 18,
        endHour: 6,
        graceMinutes: 15,
        activeDays: [1, 2, 3, 4, 5],
        active: true,
        createdAt: new Date('2026-02-01'),
        updatedAt: new Date('2026-02-01'),
      } as never,
    ]);

    expect(schedules).toHaveLength(1);
    expect(schedules[0].scheduleName).toBe('Shift');
    expect(schedules[0].expectedGuards).toBe(1);
    expect(schedules[0].activeDays).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('dedupes groups by id', () => {
    const groups = dedupeGroupsById([
      { id: 'g-1', groupName: 'A', siteId: 's-1', active: true } as never,
      { id: 'g-1', groupName: 'A duplicate', siteId: 's-1', active: true } as never,
      { id: 'g-2', groupName: 'B', siteId: 's-1', active: true } as never,
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0].groupName).toBe('A');
  });

  it('normalizes invalid expectedGuards to 1', () => {
    const schedule = normalizeScheduleRecord({
      id: 'sched-2',
      siteId: 'site-2',
      scheduleName: '  ',
      expectedGuards: 0,
      frequencyMinutes: 60,
      startHour: 6,
      endHour: 18,
      graceMinutes: 15,
      activeDays: '[1,2,3]' as unknown as number[],
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    expect(schedule.scheduleName).toBe('Shift');
    expect(schedule.expectedGuards).toBe(1);
    expect(schedule.activeDays).toEqual([1, 2, 3]);
  });

  it('flags duplicate site codes and orphan schedules', () => {
    const issues = auditAggregationData({
      sites: [
        {
          id: 'site-1',
          siteCode: 'SWI01',
          siteName: 'A',
          groups: [],
        } as never,
        {
          id: 'site-2',
          siteCode: 'SWI01',
          siteName: 'B',
          groups: [],
        } as never,
      ],
      schedules: [
        {
          id: 'sched-orphan',
          siteId: 'missing-site',
          scheduleName: 'Shift',
          expectedGuards: null,
          activeDays: null,
          active: true,
        } as never,
      ],
      images: [
        {
          id: 'img-orphan',
          siteId: 'missing-site',
          groupId: 'missing-group',
        } as never,
      ],
      rowDefinitions: [
        {
          siteId: 'site-1',
          siteCode: 'SWI01',
          groupId: null,
          groupName: null,
        },
      ],
    });

    expect(issues.some((issue) => issue.code === 'duplicate-site-code')).toBe(true);
    expect(issues.some((issue) => issue.code === 'orphan-schedule')).toBe(true);
    expect(issues.some((issue) => issue.code === 'invalid-expected-guards')).toBe(true);
    expect(issues.some((issue) => issue.code === 'invalid-active-days')).toBe(true);
  });
});
