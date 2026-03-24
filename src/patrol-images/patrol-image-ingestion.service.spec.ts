import { PatrolImageIngestionService } from './patrol-image-ingestion.service';
import { CollectorType } from '@/common/enums/collector-type.enum';
import { PatrolSlotStatus } from '@/common/enums/patrol-slot-status.enum';

describe('PatrolImageIngestionService', () => {
  const siteRepo = { findOne: jest.fn() };
  const imageRepo = {
    create: jest.fn((payload) => payload),
    save: jest.fn(),
  };
  const storageService = { savePatrolEvidence: jest.fn() };
  const complianceService = { updateSlotStatusFromImage: jest.fn() };

  let service: PatrolImageIngestionService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PatrolImageIngestionService(
      siteRepo as never,
      imageRepo as never,
      storageService as never,
      complianceService as never,
    );
  });

  it('ingests manual event and updates slot status', async () => {
    siteRepo.findOne.mockResolvedValue({ id: 'site-1', siteCode: 'OXF01', active: true });
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
});
