import { ComplianceService } from './compliance.service';
import { PatrolSlotStatus } from '@/common/enums/patrol-slot-status.enum';
import { PatrolSlot } from '@/patrol-slots/entities/patrol-slot.entity';
import { PatrolImage } from '@/patrol-images/entities/patrol-image.entity';

describe('ComplianceService', () => {
  const siteRepo = {
    find: jest.fn(),
    createQueryBuilder: jest.fn(),
  };

  const schedulesRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
  };

  const patrolSlotsService = {
    findBySiteAndDate: jest.fn(),
    createMany: jest.fn(),
    findSlotForTimestamp: jest.fn(),
    updateSlotStatus: jest.fn(),
    findPendingPastCutoff: jest.fn(),
  };

  const alertsService = {
    createMissingAlert: jest.fn(),
  };

  let service: ComplianceService;

  function mockActiveSites(sites: Array<{ id: string; active?: boolean; companyId?: string }>): void {
    const builder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(sites),
    };
    siteRepo.createQueryBuilder.mockReturnValue(builder);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ComplianceService(
      siteRepo as never,
      schedulesRepo as never,
      patrolSlotsService as never,
      alertsService as never,
    );
  });

  it('generates hourly slots and returns slotsCreated + sitesProcessed', async () => {
    mockActiveSites([{ id: 'site-1', active: true }]);
    schedulesRepo.find.mockResolvedValue([
      {
        siteId: 'site-1',
        active: true,
        activeDays: [3],
        startHour: 8,
        endHour: 10,
        frequencyMinutes: 60,
        graceMinutes: 15,
      },
    ]);
    patrolSlotsService.findBySiteAndDate.mockResolvedValue([]);

    const result = await service.generateSlotsForDate('2026-03-18');

    expect(result).toEqual({ slotsCreated: 2, sitesProcessed: 1 });
  });

  it('interprets overnight schedules in workspace time across the calendar boundary', async () => {
    process.env.BUSINESS_TIMEZONE = 'Europe/London';
    mockActiveSites([{ id: 'site-1', active: true }]);
    schedulesRepo.find.mockResolvedValue([{
      siteId: 'site-1', active: true, activeDays: [1], startHour: 22, endHour: 2,
      frequencyMinutes: 60, graceMinutes: 15, is24Hours: false,
    }]);
    patrolSlotsService.findBySiteAndDate.mockResolvedValue([]);

    await service.generateSlotsForDate('2026-09-14');

    const slots = patrolSlotsService.createMany.mock.calls[0][0] as Array<Partial<PatrolSlot>>;
    expect(slots.map((slot) => slot.expectedAt?.toISOString())).toEqual([
      '2026-09-14T21:00:00.000Z',
      '2026-09-14T22:00:00.000Z',
      '2026-09-14T23:00:00.000Z',
      '2026-09-15T00:00:00.000Z',
    ]);
  });

  it('handles a spring DST gap deterministically without duplicate slots', async () => {
    process.env.BUSINESS_TIMEZONE = 'Europe/London';
    mockActiveSites([{ id: 'site-1', active: true }]);
    schedulesRepo.find.mockResolvedValue([{
      siteId: 'site-1', active: true, activeDays: [0], startHour: 1, endHour: 3,
      frequencyMinutes: 60, graceMinutes: 15, is24Hours: false,
    }]);
    patrolSlotsService.findBySiteAndDate.mockResolvedValue([]);

    await service.generateSlotsForDate('2026-03-29');

    const slots = patrolSlotsService.createMany.mock.calls[0][0] as Array<Partial<PatrolSlot>>;
    expect(slots).toHaveLength(1);
    expect(slots[0].expectedAt?.toISOString()).toBe('2026-03-29T01:00:00.000Z');
  });

  it('updateSlotStatusFromImage marks ON_TIME, LATE, and accepts extra same-slot evidence', async () => {
    const baseSlot = {
      id: 'slot-1',
      siteId: 'site-1',
      expectedAt: new Date('2026-03-18T09:00:00.000Z'),
      slotEnd: new Date('2026-03-18T10:00:00.000Z'),
      imageId: null,
    } as PatrolSlot;

    schedulesRepo.findOne.mockResolvedValue({ graceMinutes: 15, siteId: 'site-1', active: true });

    const onTimeImage = {
      id: 'img-1',
      siteId: 'site-1',
      sentAt: new Date('2026-03-18T09:10:00.000Z'),
    } as PatrolImage;

    patrolSlotsService.findSlotForTimestamp.mockResolvedValue(baseSlot);
    let status = await service.updateSlotStatusFromImage(onTimeImage);
    expect(status).toBe(PatrolSlotStatus.RECEIVED_ON_TIME);

    const lateImage = {
      id: 'img-2',
      siteId: 'site-1',
      sentAt: new Date('2026-03-18T09:40:00.000Z'),
    } as PatrolImage;
    patrolSlotsService.findSlotForTimestamp.mockResolvedValue({ ...baseSlot, id: 'slot-2' });
    status = await service.updateSlotStatusFromImage(lateImage);
    expect(status).toBe(PatrolSlotStatus.RECEIVED_LATE);

    patrolSlotsService.findSlotForTimestamp.mockResolvedValue({
      ...baseSlot,
      imageId: 'img-existing',
      status: PatrolSlotStatus.RECEIVED_ON_TIME,
    });
    status = await service.updateSlotStatusFromImage(onTimeImage);
    expect(status).toBe(PatrolSlotStatus.RECEIVED_ON_TIME);
  });

  it('creates missing slots for the image date before marking Guard Safe', async () => {
    const image = {
      id: 'img-1',
      siteId: 'site-1',
      sentAt: new Date('2026-03-18T09:10:00.000Z'),
    } as PatrolImage;

    const generatedSlot = {
      id: 'slot-generated',
      siteId: 'site-1',
      expectedAt: new Date('2026-03-18T09:00:00.000Z'),
      slotEnd: new Date('2026-03-18T10:00:00.000Z'),
      imageId: null,
    } as PatrolSlot;

    schedulesRepo.find.mockResolvedValue([
      {
        graceMinutes: 15,
        siteId: 'site-1',
        active: true,
        activeDays: [3],
        startHour: 9,
        endHour: 9,
        frequencyMinutes: 60,
      },
    ]);
    patrolSlotsService.findSlotForTimestamp.mockResolvedValueOnce(null).mockResolvedValueOnce(generatedSlot);
    mockActiveSites([{ id: 'site-1', active: true }]);
    patrolSlotsService.findBySiteAndDate.mockResolvedValue([]);

    const status = await service.updateSlotStatusFromImage(image);

    expect(patrolSlotsService.createMany).toHaveBeenCalledTimes(1);
    expect(patrolSlotsService.updateSlotStatus).toHaveBeenCalledWith(
      'slot-generated',
      PatrolSlotStatus.RECEIVED_ON_TIME,
      'img-1',
    );
    expect(status).toBe(PatrolSlotStatus.RECEIVED_ON_TIME);
  });

  it('markMissingSlots marks overdue pending slots and creates alerts', async () => {
    const now = new Date('2026-03-18T12:00:00.000Z');
    patrolSlotsService.findPendingPastCutoff.mockResolvedValue([
      {
        id: 'slot-1',
        siteId: 'site-1',
        slotEnd: new Date('2026-03-18T10:00:00.000Z'),
        expectedAt: new Date('2026-03-18T09:00:00.000Z'),
      },
    ]);
    schedulesRepo.findOne.mockResolvedValue({ graceMinutes: 15, siteId: 'site-1', active: true });

    const marked = await service.markMissingSlots(now);

    expect(marked).toBe(1);
    expect(patrolSlotsService.updateSlotStatus).toHaveBeenCalledWith('slot-1', PatrolSlotStatus.MISSING);
    expect(alertsService.createMissingAlert).toHaveBeenCalledTimes(1);
  });
});
