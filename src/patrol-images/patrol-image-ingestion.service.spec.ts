import { PatrolImageIngestionService } from './patrol-image-ingestion.service';
import { CollectorType } from '@/common/enums/collector-type.enum';
import { PatrolSlotStatus } from '@/common/enums/patrol-slot-status.enum';
import { UserRole } from '@/common/enums/user-role.enum';

describe('PatrolImageIngestionService', () => {
  const sitesService = { findActiveByCode: jest.fn() };
  const imageRepo = {
    create: jest.fn((payload) => payload),
    save: jest.fn(),
    findOne: jest.fn(),
  };
  const storageService = { savePatrolEvidence: jest.fn() };
  const complianceService = { updateSlotStatusFromImage: jest.fn() };

  let service: PatrolImageIngestionService;
  const originalBusinessTimeZone = process.env.BUSINESS_TIMEZONE;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.BUSINESS_TIMEZONE = 'Europe/London';
    service = new PatrolImageIngestionService(
      sitesService as never,
      imageRepo as never,
      storageService as never,
      complianceService as never,
    );
  });

  afterAll(() => {
    process.env.BUSINESS_TIMEZONE = originalBusinessTimeZone;
  });

  it('ingests manual event and updates slot status', async () => {
    imageRepo.findOne.mockResolvedValue(null);
    sitesService.findActiveByCode.mockResolvedValue({ id: 'site-1', siteCode: 'OXF01', active: true });
    storageService.savePatrolEvidence.mockResolvedValue({
      storedFileName: 'OXF01_2026-03-19_09-00-00.jpg',
      filePath: '/tmp/OXF01_2026-03-19_09-00-00.jpg',
      fileSize: 100,
      mimeType: 'image/jpeg',
    });
    imageRepo.save
      .mockResolvedValueOnce({ id: 'img-1', siteId: 'site-1', sentAt: new Date('2026-03-19T09:00:00.000Z') })
      .mockResolvedValueOnce({ id: 'img-1', status: PatrolSlotStatus.RECEIVED_ON_TIME });
    complianceService.updateSlotStatusFromImage.mockResolvedValue(PatrolSlotStatus.RECEIVED_ON_TIME);

    const result = await service.ingestPatrolImage({
      collectorType: CollectorType.MANUAL,
      siteCode: 'OXF01',
      timestamp: '2026-03-19T09:00:00.000Z',
      senderName: 'Ali',
      originalFileName: 'proof.jpg',
      mimeType: 'image/jpeg',
      fileSize: 100,
      fileBuffer: Buffer.from('abc'),
    });

    expect(storageService.savePatrolEvidence).toHaveBeenCalled();
    expect(complianceService.updateSlotStatusFromImage).toHaveBeenCalled();
    expect(result.status).toBe(PatrolSlotStatus.RECEIVED_ON_TIME);
  });

  it('passes user scope when provided', async () => {
    imageRepo.findOne.mockResolvedValue(null);
    sitesService.findActiveByCode.mockResolvedValue({ id: 'site-1', siteCode: 'OXF01', active: true });
    storageService.savePatrolEvidence.mockResolvedValue({
      storedFileName: 'OXF01_2026-03-19_09-00-00.jpg',
      filePath: '/tmp/OXF01_2026-03-19_09-00-00.jpg',
      fileSize: 100,
      mimeType: 'image/jpeg',
    });
    imageRepo.save
      .mockResolvedValueOnce({ id: 'img-1', siteId: 'site-1', sentAt: new Date('2026-03-19T09:00:00.000Z') })
      .mockResolvedValueOnce({ id: 'img-1', status: PatrolSlotStatus.RECEIVED_ON_TIME });
    complianceService.updateSlotStatusFromImage.mockResolvedValue(PatrolSlotStatus.RECEIVED_ON_TIME);

    await service.ingestPatrolImage(
      {
        collectorType: CollectorType.MANUAL,
        siteCode: 'oxf01 ',
        timestamp: '2026-03-19T09:00:00.000Z',
        senderName: 'Ali',
        mimeType: 'image/jpeg',
        fileSize: 100,
        fileBuffer: Buffer.from('abc'),
      },
      {
        sub: 'user-1',
        email: 'alpha.guard@patrol.local',
        role: UserRole.GUARD,
        companyId: 'company-1',
      },
    );

    expect(sitesService.findActiveByCode).toHaveBeenCalledWith(
      'OXF01',
      expect.objectContaining({ companyId: 'company-1' }),
    );
  });

  it('rejects invalid timestamps', async () => {
    await expect(
      service.ingestPatrolImage({
        collectorType: CollectorType.MANUAL,
        siteCode: 'OXF01',
        groupId: 'group-1',
        timestamp: 'not-a-date',
        senderName: 'Ali',
        senderNumber: '+441234567890',
        messageExternalId: 'wamid-1',
        originalFileName: 'proof.jpg',
        mimeType: 'image/jpeg',
        fileSize: 100,
        fileBuffer: Buffer.from('abc'),
      }),
    ).rejects.toThrow('timestamp must be a valid ISO-8601 date');
  });

  it('persists WhatsApp metadata when provided', async () => {
    imageRepo.findOne.mockResolvedValue(null);
    sitesService.findActiveByCode.mockResolvedValue({ id: 'site-1', siteCode: 'OXF01', active: true });
    storageService.savePatrolEvidence.mockResolvedValue({
      storedFileName: 'OXF01_2026-03-19_09-00-00.jpg',
      filePath: '/tmp/OXF01_2026-03-19_09-00-00.jpg',
      fileSize: 100,
      mimeType: 'image/jpeg',
    });
    imageRepo.create.mockImplementation((payload) => payload);
    imageRepo.save
      .mockResolvedValueOnce({ id: 'img-1', siteId: 'site-1', sentAt: new Date('2026-03-19T09:00:00.000Z') })
      .mockResolvedValueOnce({ id: 'img-1', status: PatrolSlotStatus.RECEIVED_ON_TIME });
    complianceService.updateSlotStatusFromImage.mockResolvedValue(PatrolSlotStatus.RECEIVED_ON_TIME);

    await service.ingestPatrolImage({
      collectorType: CollectorType.WHATSAPP,
      siteCode: 'OXF01',
      groupId: 'group-1',
      timestamp: '2026-03-19T09:00:00.000Z',
      senderName: 'Ali',
      senderNumber: '+441234567890',
      messageExternalId: 'wamid-1',
      originalFileName: 'proof.jpg',
      mimeType: 'image/jpeg',
      fileSize: 100,
      fileBuffer: Buffer.from('abc'),
    });

    expect(imageRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        groupId: 'group-1',
        senderNumber: '+441234567890',
        messageExternalId: 'wamid-1',
      }),
    );
  });

  it('returns an existing image when the WhatsApp message was already imported', async () => {
    const existingImage = {
      id: 'img-existing',
      messageExternalId: 'wamid-1',
      status: PatrolSlotStatus.RECEIVED_ON_TIME,
    };

    imageRepo.findOne.mockResolvedValue(existingImage);

    const result = await service.ingestPatrolImage({
      collectorType: CollectorType.WHATSAPP,
      siteCode: 'OXF01',
      timestamp: '2026-03-19T09:00:00.000Z',
      messageExternalId: 'wamid-1',
      mimeType: 'image/jpeg',
      fileSize: 100,
      fileBuffer: Buffer.from('abc'),
    });

    expect(storageService.savePatrolEvidence).not.toHaveBeenCalled();
    expect(result).toBe(existingImage);
  });

  it('stores patrolDate and patrolHour in the Europe/London business timezone', async () => {
    imageRepo.findOne.mockResolvedValue(null);
    sitesService.findActiveByCode.mockResolvedValue({ id: 'site-1', siteCode: 'OXF01', active: true });
    storageService.savePatrolEvidence.mockResolvedValue({
      storedFileName: 'OXF01_2026-07-02_00-30-00.jpg',
      filePath: '/tmp/OXF01_2026-07-02_00-30-00.jpg',
      fileSize: 100,
      mimeType: 'image/jpeg',
    });
    imageRepo.create.mockImplementation((payload) => payload);
    imageRepo.save
      .mockResolvedValueOnce({ id: 'img-1', siteId: 'site-1', sentAt: new Date('2026-07-01T23:30:00.000Z') })
      .mockResolvedValueOnce({ id: 'img-1', status: PatrolSlotStatus.RECEIVED_ON_TIME });
    complianceService.updateSlotStatusFromImage.mockResolvedValue(PatrolSlotStatus.RECEIVED_ON_TIME);

    await service.ingestPatrolImage({
      collectorType: CollectorType.WHATSAPP,
      siteCode: 'OXF01',
      timestamp: '2026-07-01T23:30:00.000Z',
      senderName: 'Ali',
      mimeType: 'image/jpeg',
      fileSize: 100,
      fileBuffer: Buffer.from('abc'),
    });

    expect(imageRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        patrolDate: '2026-07-02',
        patrolHour: 0,
      }),
    );
  });
});
