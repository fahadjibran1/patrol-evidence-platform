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

  it.each([
    ['America/New_York', '2026-09-14T04:00:00.000Z', '2026-09-15T04:00:00.000Z'],
    ['Asia/Dubai', '2026-09-13T20:00:00.000Z', '2026-09-14T20:00:00.000Z'],
    ['Pacific/Auckland', '2026-09-13T12:00:00.000Z', '2026-09-14T12:00:00.000Z'],
  ])('builds %s date-filter bounds in workspace civil time', (timeZone, start, end) => {
    const bounds = getPatrolDateUtcBounds('2026-09-14', timeZone);
    expect(bounds.startInclusive.toISOString()).toBe(start);
    expect(bounds.endExclusive.toISOString()).toBe(end);
  });

  it('keeps a canonical instant unchanged when display timezone changes', () => {
    const instant = new Date('2026-09-14T00:30:00.000Z');
    const original = instant.toISOString();
    expect(imageSentOnPatrolDate(instant, '2026-09-13', 'America/New_York')).toBe(true);
    expect(imageSentOnPatrolDate(instant, '2026-09-14', 'Asia/Dubai')).toBe(true);
    expect(instant.toISOString()).toBe(original);
  });
});
