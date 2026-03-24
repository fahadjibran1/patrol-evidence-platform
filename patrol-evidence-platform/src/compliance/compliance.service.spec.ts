import { ComplianceService } from './compliance.service';
import { PatrolSlotStatus } from '@/common/enums/patrol-slot-status.enum';
import { PatrolSlot } from '@/patrol-slots/entities/patrol-slot.entity';
import { PatrolImage } from '@/patrol-images/entities/patrol-image.entity';

describe('ComplianceService', () => {
  const siteRepo = {
    find: jest.fn(),
  };

  const schedulesRepo = {
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
    siteRepo.find.mockResolvedValue([{ id: 'site-1', active: true }]);
    schedulesRepo.findOne.mockResolvedValue({
      siteId: 'site-1',
      active: true,
      activeDays: [2],
      startHour: 8,
      endHour: 10,
      frequencyMinutes: 60,
      graceMinutes: 15,
    });
    patrolSlotsService.findBySiteAndDate.mockResolvedValue([]);

    const result = await service.generateSlotsForDate('2026-03-18');

    expect(result).toEqual({ slotsCreated: 3, sitesProcessed: 1 });
  });

  it('updateSlotStatusFromImage marks ON_TIME, LATE, and DUPLICATE', async () => {
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

    patrolSlotsService.findSlotForTimestamp.mockResolvedValue({ ...baseSlot, imageId: 'img-existing' });
    status = await service.updateSlotStatusFromImage(onTimeImage);
    expect(status).toBe(PatrolSlotStatus.DUPLICATE);
    expect(patrolSlotsService.updateSlotStatus).toHaveBeenCalledTimes(2);
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
