import {
  dedupePatrolImagesForCount,
  getPatrolDateUtcBounds,
  imageSentOnPatrolDate,
  isCountablePatrolImage,
} from './patrol-image-query.util';
import { PatrolSlotStatus } from '@/common/enums/patrol-slot-status.enum';

describe('patrol-image-query.util', () => {
  const originalBusinessTimeZone = process.env.BUSINESS_TIMEZONE;

  beforeEach(() => {
    process.env.BUSINESS_TIMEZONE = 'Europe/London';
  });

  afterAll(() => {
    process.env.BUSINESS_TIMEZONE = originalBusinessTimeZone;
  });

  it('dedupes patrol images by messageExternalId for counting', () => {
    const images = dedupePatrolImagesForCount([
      {
        id: 'img-1',
        messageExternalId: 'msg-1',
        status: PatrolSlotStatus.RECEIVED_ON_TIME,
      },
      {
        id: 'img-2',
        messageExternalId: 'msg-1',
        status: PatrolSlotStatus.RECEIVED_ON_TIME,
      },
      {
        id: 'img-3',
        messageExternalId: 'msg-2',
        status: PatrolSlotStatus.RECEIVED_ON_TIME,
      },
    ]);

    expect(images).toHaveLength(2);
    expect(images.map((image) => image.id)).toEqual(['img-1', 'img-3']);
  });

  it('excludes duplicate and invalid image statuses from counts', () => {
    const images = dedupePatrolImagesForCount([
      { id: 'img-1', status: PatrolSlotStatus.RECEIVED_ON_TIME },
      { id: 'img-2', status: PatrolSlotStatus.DUPLICATE },
      { id: 'img-3', status: PatrolSlotStatus.INVALID_IMAGE },
    ]);

    expect(images).toHaveLength(1);
    expect(images[0].id).toBe('img-1');
    expect(isCountablePatrolImage({ status: PatrolSlotStatus.DUPLICATE })).toBe(false);
  });

  it('filters images by sentAt in Europe/London', () => {
    const sentAt = new Date('2026-05-19T10:52:00.000Z');
    const { startInclusive, endExclusive } = getPatrolDateUtcBounds('2026-05-19');

    expect(imageSentOnPatrolDate(sentAt, '2026-05-19')).toBe(true);
    expect(sentAt.getTime()).toBeGreaterThanOrEqual(startInclusive.getTime());
    expect(sentAt.getTime()).toBeLessThan(endExclusive.getTime());
  });
});
