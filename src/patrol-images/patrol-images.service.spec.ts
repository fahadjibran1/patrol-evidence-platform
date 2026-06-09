import { PatrolImagesService } from './patrol-images.service';
import { PatrolSlotStatus } from '@/common/enums/patrol-slot-status.enum';
import { CollectorType } from '@/common/enums/collector-type.enum';
import { UserRole } from '@/common/enums/user-role.enum';

describe('PatrolImagesService', () => {
  const imageRepo = {
    save: jest.fn(),
    create: jest.fn((payload) => payload),
    createQueryBuilder: jest.fn(),
    findOne: jest.fn(),
  };
  const sitesService = {
    findActiveById: jest.fn(),
  };
  const complianceService = {
    updateSlotStatusFromImage: jest.fn(),
  };

  const user = {
    sub: 'user-1',
    email: 'alpha.admin@patrol.local',
    role: UserRole.ADMIN,
    companyId: null,
  };

  let service: PatrolImagesService;
  const originalBusinessTimeZone = process.env.BUSINESS_TIMEZONE;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.BUSINESS_TIMEZONE = 'Europe/London';
    service = new PatrolImagesService(imageRepo as never, sitesService as never, complianceService as never);
  });

  afterAll(() => {
    process.env.BUSINESS_TIMEZONE = originalBusinessTimeZone;
  });

  it('recomputes patrolDate and patrolHour from sentAt using the business timezone', async () => {
    sitesService.findActiveById.mockResolvedValue({ id: 'site-1', active: true });
    imageRepo.save
      .mockResolvedValueOnce({
        id: 'img-1',
        siteId: 'site-1',
        sentAt: new Date('2026-07-01T23:30:00.000Z'),
        patrolDate: '2026-07-02',
        patrolHour: 0,
      })
      .mockResolvedValueOnce({
        id: 'img-1',
        status: PatrolSlotStatus.RECEIVED_ON_TIME,
        patrolDate: '2026-07-02',
        patrolHour: 0,
      });
    complianceService.updateSlotStatusFromImage.mockResolvedValue(PatrolSlotStatus.RECEIVED_ON_TIME);

    await service.create(
      {
        siteId: 'site-1',
        collectorType: CollectorType.MANUAL,
        sentAt: '2026-07-01T23:30:00.000Z',
        receivedAt: '2026-07-01T23:35:00.000Z',
        patrolDate: '2026-07-01',
        patrolHour: 23,
        storedFileName: 'proof.jpg',
        filePath: '/tmp/proof.jpg',
        fileSize: '100',
        mimeType: 'image/jpeg',
      },
      user as never,
    );

    expect(imageRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        patrolDate: '2026-07-02',
        patrolHour: 0,
      }),
    );
  });
});
