import { DashboardService } from './dashboard.service';
import { UserRole } from '@/common/enums/user-role.enum';

function createQueryBuilder(result: unknown, options?: { count?: number; rawMany?: unknown[] }) {
  const arrayResult = Array.isArray(result) ? result : [];
  return {
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    innerJoinAndSelect: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    addGroupBy: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(arrayResult),
    getOne: jest.fn().mockResolvedValue(arrayResult[0] ?? null),
    getCount: jest.fn().mockResolvedValue(options?.count ?? arrayResult.length),
    getRawMany: jest.fn().mockResolvedValue(options?.rawMany ?? []),
  };
}

describe('DashboardService hourly safety and guard reporting', () => {
  const user = {
    id: 'user-1',
    role: UserRole.ADMIN,
    companyId: null,
  };

  const site = {
    id: 'site-1',
    siteCode: 'SWI01',
    siteName: 'Corner Copse - Swindon',
    clientName: 'Trial Client',
    active: true,
    groups: [],
  };

  const guardOne = {
    id: 'guard-1',
    firstName: 'Guard',
    lastName: 'One',
  };

  const guardTwo = {
    id: 'guard-2',
    firstName: 'Guard',
    lastName: 'Two',
  };

  let siteRepo: { createQueryBuilder: jest.Mock; count: jest.Mock };
  let imageRepo: { createQueryBuilder: jest.Mock };
  let alertRepo: { createQueryBuilder: jest.Mock };
  let groupRepo: { createQueryBuilder: jest.Mock };
  let mappingRepo: { createQueryBuilder: jest.Mock };
  let scheduleRepo: { createQueryBuilder: jest.Mock };

  const defaultSchedule = {
    id: 'sched-1',
    siteId: 'site-1',
    scheduleName: 'Shift',
    startHour: 0,
    endHour: 0,
    activeDays: [0, 1, 2, 3, 4, 5, 6],
    active: true,
    expectedGuards: 1,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  function createService(options?: {
    images?: unknown[];
    groups?: unknown[];
    mappings?: unknown[];
    schedules?: unknown[];
    sites?: unknown[];
    imageCountBySite?: Record<string, number>;
    totalImageCount?: number;
  }) {
    const images = options?.images ?? [];
    const groups = options?.groups ?? [];
    const mappings = options?.mappings ?? [];
    const schedules = options?.schedules ?? [defaultSchedule];
    const sites = options?.sites ?? [site];
    const imageCountBySite = options?.imageCountBySite ?? {};
    const totalImageCount = options?.totalImageCount ?? images.length;

    siteRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(createQueryBuilder(sites)),
      count: jest.fn().mockResolvedValue(sites.length),
    };
    imageRepo = {
      createQueryBuilder: jest.fn().mockImplementation(() => {
        let siteFilter: string | undefined;
        let patrolHourFilter: number | undefined;
        let isAggregateQuery = false;

        const builder = {
          leftJoinAndSelect: jest.fn().mockReturnThis(),
          leftJoin: jest.fn().mockReturnThis(),
          innerJoinAndSelect: jest.fn().mockReturnThis(),
          innerJoin: jest.fn().mockReturnThis(),
          select: jest.fn().mockImplementation(() => {
            isAggregateQuery = true;
            return builder;
          }),
          addSelect: jest.fn().mockReturnThis(),
          groupBy: jest.fn().mockReturnThis(),
          addGroupBy: jest.fn().mockReturnThis(),
          where: jest.fn().mockImplementation((clause: string, params?: Record<string, unknown>) => {
            if (params?.siteId && typeof params.siteId === 'string') {
              siteFilter = params.siteId;
            }
            if (params?.patrolHour !== undefined && typeof params.patrolHour === 'number') {
              patrolHourFilter = params.patrolHour;
            }
            return builder;
          }),
          andWhere: jest.fn().mockImplementation((clause: string, params?: Record<string, unknown>) => {
            if (params?.siteId && typeof params.siteId === 'string') {
              siteFilter = params.siteId;
            }
            if (params?.patrolHour !== undefined && typeof params.patrolHour === 'number') {
              patrolHourFilter = params.patrolHour;
            }
            return builder;
          }),
          orderBy: jest.fn().mockReturnThis(),
          take: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockImplementation(async () => {
            if (siteFilter) {
              if ((imageCountBySite[siteFilter] ?? 0) >= 500) {
                return [];
              }
              return images.filter((image) => (image as { siteId: string }).siteId === siteFilter);
            }
            return images;
          }),
          getOne: jest.fn().mockResolvedValue(null),
          getCount: jest.fn().mockImplementation(async () => {
            if (siteFilter) {
              return imageCountBySite[siteFilter] ?? 0;
            }
            return totalImageCount;
          }),
          getRawMany: jest.fn().mockImplementation(async () => {
            if (isAggregateQuery && siteFilter) {
              return [
                {
                  groupId: null,
                  patrolHour: patrolHourFilter ?? 6,
                  imageCount: imageCountBySite[siteFilter] ?? 0,
                  firstSentAt: new Date('2026-03-31T05:20:00.000Z'),
                },
              ];
            }

            return Object.entries(imageCountBySite).map(([siteId, imageCount]) => ({
              siteId,
              imageCount,
              latestSentAt: new Date('2026-03-31T06:00:00.000Z'),
            }));
          }),
        };

        return builder;
      }),
    };
    alertRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(createQueryBuilder([])),
    };
    groupRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(createQueryBuilder(groups)),
    };
    mappingRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(createQueryBuilder(mappings)),
    };
    scheduleRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(createQueryBuilder(schedules)),
    };

    return new DashboardService(
      siteRepo as never,
      imageRepo as never,
      alertRepo as never,
      groupRepo as never,
      mappingRepo as never,
      scheduleRepo as never,
    );
  }

  it('marks an hour as Missing when no image exists', async () => {
    const service = createService();

    const rows = await service.getHourlySafety(user as never, '2026-03-31');
    const hour5 = rows[0].hourlyCells[5];

    expect(hour5.status).toBe('Missing');
    expect(hour5.safeFlag).toBe(false);
    expect(hour5.imageCount).toBe(0);
  });

  it('marks an hour as Safe when one image exists', async () => {
    const service = createService({
      images: [
        {
          id: 'img-1',
          siteId: 'site-1',
          groupId: null,
          patrolHour: 5,
          sentAt: new Date('2026-03-31T04:14:00.000Z'),
          senderName: 'Guard One',
          senderNumber: '447700000001',
          site,
          group: null,
        },
      ],
    });

    const rows = await service.getHourlySafety(user as never, '2026-03-31');
    const hour5 = rows[0].hourlyCells[5];

    expect(hour5.status).toBe('Safe');
    expect(hour5.safeFlag).toBe(true);
    expect(hour5.imageCount).toBe(1);
    expect(hour5.firstSenderName).toBe('Guard One');
  });

  it('keeps an hour Safe when multiple images exist in the same hour', async () => {
    const service = createService({
      images: [
        {
          id: 'img-2',
          siteId: 'site-1',
          groupId: null,
          patrolHour: 7,
          sentAt: new Date('2026-03-31T06:10:00.000Z'),
          senderName: 'Second Guard',
          senderNumber: '447700000001',
          site,
          group: null,
        },
        {
          id: 'img-1',
          siteId: 'site-1',
          groupId: null,
          patrolHour: 7,
          sentAt: new Date('2026-03-31T06:02:00.000Z'),
          senderName: 'First Guard',
          senderNumber: '447700000001',
          site,
          group: null,
        },
        {
          id: 'img-3',
          siteId: 'site-1',
          groupId: null,
          patrolHour: 7,
          sentAt: new Date('2026-03-31T06:40:00.000Z'),
          senderName: 'Third Guard',
          senderNumber: '447700000001',
          site,
          group: null,
        },
      ],
    });

    const rows = await service.getHourlySafety(user as never, '2026-03-31');
    const hour7 = rows[0].hourlyCells[7];

    expect(hour7.status).toBe('Safe');
    expect(hour7.imageCount).toBe(3);
    expect(hour7.firstImageId).toBe('img-1');
    expect(hour7.firstSenderName).toBe('First Guard');
  });

  it('uses first image metadata in the safety export output', async () => {
    const service = createService({
      images: [
        {
          id: 'img-1',
          siteId: 'site-1',
          groupId: null,
          patrolHour: 11,
          sentAt: new Date('2026-03-31T10:03:00.000Z'),
          senderName: 'Alhamdulilah',
          senderNumber: '447700000001',
          site,
          group: null,
        },
        {
          id: 'img-2',
          siteId: 'site-1',
          groupId: null,
          patrolHour: 11,
          sentAt: new Date('2026-03-31T10:09:00.000Z'),
          senderName: 'Backup Guard',
          senderNumber: '447700000001',
          site,
          group: null,
        },
      ],
    });

    const csv = await service.exportHourlySafetyCsv(user as never, '2026-03-31');

    expect(csv).toContain('SWI01');
    expect(csv).toContain('11:00,Safe,true,2026-03-31T10:03:00.000Z,Alhamdulilah,2');
  });

  it('marks one guard as Reported when they send one image', async () => {
    const service = createService({
      images: [
        {
          id: 'img-1',
          siteId: 'site-1',
          groupId: null,
          patrolHour: 6,
          sentAt: new Date('2026-03-31T05:10:00.000Z'),
          senderName: 'Guard One',
          senderNumber: '447700000001',
          site,
          group: null,
        },
      ],
      schedules: [
        {
          ...defaultSchedule,
          startHour: 6,
          endHour: 7,
          expectedGuards: 1,
        },
      ],
    });

    const rows = await service.getHourlyGuardStatus(user as never, '2026-03-31', 'SWI01', 6);

    expect(rows[0].siteStatus).toBe('Safe');
    expect(rows[0].expectedGuards).toEqual([
      expect.objectContaining({
        guardName: 'Guard One',
        status: 'Reported',
        totalPicturesInHour: 1,
        senderNumber: '447700000001',
      }),
    ]);
  });

  it('counts one guard as Reported once even if they send many images in the same hour', async () => {
    const service = createService({
      images: [
        {
          id: 'img-1',
          siteId: 'site-1',
          groupId: null,
          patrolHour: 8,
          sentAt: new Date('2026-03-31T07:02:00.000Z'),
          senderName: 'Guard One',
          senderNumber: '447700000001',
          site,
          group: null,
        },
        {
          id: 'img-2',
          siteId: 'site-1',
          groupId: null,
          patrolHour: 8,
          sentAt: new Date('2026-03-31T07:12:00.000Z'),
          senderName: 'Guard One',
          senderNumber: '447700000001',
          site,
          group: null,
        },
      ],
      schedules: [
        {
          ...defaultSchedule,
          startHour: 8,
          endHour: 9,
          expectedGuards: 1,
        },
      ],
    });

    const rows = await service.getHourlyGuardStatus(user as never, '2026-03-31', 'SWI01', 8);

    expect(rows[0].expectedGuards[0]).toEqual(
      expect.objectContaining({
        status: 'Reported',
        totalPicturesInHour: 2,
      }),
    );
  });

  it('marks multiple guards correctly in the same hour and leaves missing guard as Missing while site stays Safe', async () => {
    const service = createService({
      images: [
        {
          id: 'img-1',
          siteId: 'site-1',
          groupId: null,
          patrolHour: 9,
          sentAt: new Date('2026-03-31T08:03:00.000Z'),
          senderName: 'Guard One',
          senderNumber: '447700000001',
          site,
          group: null,
        },
      ],
      schedules: [
        {
          ...defaultSchedule,
          startHour: 9,
          endHour: 10,
          expectedGuards: 2,
        },
      ],
    });

    const rows = await service.getHourlyGuardStatus(user as never, '2026-03-31', 'SWI01', 9);

    expect(rows[0].siteStatus).toBe('Safe');
    expect(rows[0].expectedGuards).toEqual([
      expect.objectContaining({
        guardName: 'Guard One',
        status: 'Reported',
      }),
      expect.objectContaining({
        guardName: 'Shift · Guard 2',
        status: 'Missing',
      }),
    ]);
  });

  it('marks the 11:00 slot from sentAt in Europe/London when an image arrives at 11:52', async () => {
    const service = createService({
      images: [
        {
          id: 'img-1152',
          siteId: 'site-1',
          groupId: null,
          patrolHour: 0,
          patrolDate: '2026-05-19',
          sentAt: new Date('2026-05-19T10:52:00.000Z'),
          senderName: 'FAISU 💖',
          senderNumber: '447700000001',
          site,
          group: null,
        },
      ],
    });

    const rows = await service.getHourlySafety(user as never, '2026-05-19');

    expect(rows[0].hourlyCells[11].status).toBe('Safe');
    expect(rows[0].hourlyCells[11].imageCount).toBe(1);
    expect(rows[0].hourlyCells[10].status).not.toBe('Safe');
    expect(rows[0].hourlyCells[12].status).not.toBe('Safe');
  });

  it('does not crash when a schedule has null activeDays in all-sites aggregation', async () => {
    const service = createService({
      schedules: [
        {
          ...defaultSchedule,
          id: 'legacy-sched',
          activeDays: null as unknown as number[],
          scheduleName: null as unknown as string,
          expectedGuards: null as unknown as number,
        },
      ],
    });

    const rows = await service.getHourlyGuardStatus(user as never, '2026-03-31');

    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].expectedGuards.length).toBeGreaterThan(0);
  });

  it('uses expectedGuards from the active schedule for that hour', async () => {
    const service = createService({
      schedules: [
        {
          ...defaultSchedule,
          id: 'day',
          scheduleName: 'Day shift',
          startHour: 6,
          endHour: 18,
          expectedGuards: 3,
        },
        {
          ...defaultSchedule,
          id: 'night',
          scheduleName: 'Night shift',
          startHour: 18,
          endHour: 6,
          expectedGuards: 4,
          createdAt: new Date('2026-02-01T00:00:00.000Z'),
        },
      ],
    });

    const dayRows = await service.getHourlyGuardStatus(user as never, '2026-03-31', 'SWI01', 10);
    const nightRows = await service.getHourlyGuardStatus(user as never, '2026-03-31', 'SWI01', 22);

    expect(dayRows[0].expectedGuards).toHaveLength(3);
    expect(dayRows[0].expectedGuards.every((guard) => guard.status === 'Missing')).toBe(true);
    expect(nightRows[0].expectedGuards).toHaveLength(4);
    expect(nightRows[0].expectedGuards[0].guardName).toContain('Night shift');
  });

  it('reports one observed guard once for the same sender in the same hour', async () => {
    const service = createService({
      schedules: [],
      images: [
        {
          id: 'img-1',
          siteId: 'site-1',
          groupId: null,
          patrolHour: 9,
          sentAt: new Date('2026-03-31T08:03:00.000Z'),
          senderName: 'FAISU 💖',
          senderNumber: '447700000001',
          site,
          group: null,
        },
        {
          id: 'img-2',
          siteId: 'site-1',
          groupId: null,
          patrolHour: 9,
          sentAt: new Date('2026-03-31T08:18:00.000Z'),
          senderName: 'FAISU 💖 / Corner Copse - Swindon',
          senderNumber: '447700000001',
          site,
          group: null,
        },
      ],
    });

    const rows = await service.getHourlyGuardStatus(user as never, '2026-03-31', 'SWI01', 9);
    const observed = rows[0].expectedGuards.filter((guard) => guard.guardId.startsWith('observed:'));

    expect(observed).toHaveLength(1);
    expect(observed[0]).toEqual(
      expect.objectContaining({
        guardName: 'FAISU 💖',
        status: 'Reported',
        totalPicturesInHour: 2,
      }),
    );
  });

  it('does not double-count one saved image across site and group rows', async () => {
    const group = {
      id: 'group-1',
      siteId: 'site-1',
      groupName: 'Corner Copse - Swindon',
      active: true,
    };

    const service = createService({
      images: [
        {
          id: 'img-group',
          siteId: 'site-1',
          groupId: 'group-1',
          patrolHour: 6,
          sentAt: new Date('2026-03-31T05:20:00.000Z'),
          senderName: 'FAISU 💖',
          senderNumber: '447700000001',
          site,
          group,
        },
      ],
      groups: [group],
    });

    const rows = await service.getHourlySafety(user as never, '2026-03-31');

    expect(rows[0].hourlyCells[6].imageCount).toBe(1);
  });

  it('aggregates patrol images across WhatsApp groups into one site timeline', async () => {
    const group = {
      id: 'group-1',
      siteId: 'site-1',
      groupName: 'Corner Copse - Swindon',
      active: true,
    };

    const service = createService({
      images: [
        {
          id: 'img-group',
          siteId: 'site-1',
          groupId: 'group-1',
          patrolHour: 6,
          sentAt: new Date('2026-03-31T05:20:00.000Z'),
          senderName: 'FAISU 💖',
          senderNumber: '447700000001',
          site,
          group,
        },
      ],
      groups: [group],
    });

    const rows = await service.getHourlySafety(user as never, '2026-03-31');

    expect(rows).toHaveLength(1);
    expect(rows[0].groupId).toBeNull();
    expect(rows[0].hourlyCells[6].status).toBe('Safe');
  });

  it('keeps dashboard populated when TS001 is active with 1500 images', async () => {
    const ts001Site = {
      id: 'ts001-id',
      siteCode: 'TS001',
      siteName: 'High Volume Terminal',
      clientName: 'Trial Client',
      active: true,
      groups: [],
    };
    const otherSite = {
      id: 'site-2',
      siteCode: 'SWI01',
      siteName: 'Corner Copse - Swindon',
      clientName: 'Trial Client',
      active: true,
      groups: [],
    };
    const ts001Schedule = {
      id: 'sched-ts001',
      siteId: 'ts001-id',
      scheduleName: 'Shift',
      startHour: 0,
      endHour: 0,
      activeDays: [0, 1, 2, 3, 4, 5, 6],
      active: true,
      expectedGuards: 1,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    const otherSchedule = {
      ...defaultSchedule,
      id: 'sched-2',
      siteId: 'site-2',
    };
    const otherImage = {
      id: 'img-swi01',
      siteId: 'site-2',
      groupId: null,
      patrolHour: 6,
      sentAt: new Date('2026-03-31T05:20:00.000Z'),
      senderName: 'Guard One',
      senderNumber: '447700000001',
      site: otherSite,
      group: null,
    };

    const service = createService({
      sites: [ts001Site, otherSite],
      images: [otherImage],
      schedules: [ts001Schedule, otherSchedule],
      imageCountBySite: {
        'ts001-id': 1500,
        'site-2': 1,
      },
      totalImageCount: 1501,
    });

    const overview = await service.getOverview(user as never, '2026-03-31');
    expect(overview.siteTotals.active).toBe(2);
    expect(overview.imageTotals.received).toBe(1501);

    const hourlyRows = await service.getHourlySafety(user as never, '2026-03-31');
    expect(hourlyRows.some((row) => row.siteCode === 'TS001')).toBe(true);
    expect(hourlyRows.some((row) => row.siteCode === 'SWI01')).toBe(true);

    const ts001Row = hourlyRows.find((row) => row.siteCode === 'TS001');
    expect(ts001Row?.hourlyCells[6]?.status).toBe('Safe');
    expect(ts001Row?.hourlyCells[6]?.imageCount).toBeGreaterThan(0);
  });

  it('returns active sites on the board even when hourly safety has no rows yet', async () => {
    const ts001Site = {
      id: 'ts001-id',
      siteCode: 'TS001',
      siteName: 'High Volume Terminal',
      active: true,
    };
    const otherSite = {
      id: 'site-2',
      siteCode: 'SWI01',
      siteName: 'Corner Copse - Swindon',
      active: true,
    };

    const service = createService({
      sites: [ts001Site, otherSite],
      totalImageCount: 0,
    });

    const rows = await service.getSiteBreakdown(user as never, '2026-03-31');

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.siteCode).sort()).toEqual(['SWI01', 'TS001']);
  });
});
