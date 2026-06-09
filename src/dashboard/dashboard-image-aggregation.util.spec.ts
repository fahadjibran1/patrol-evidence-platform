import {
  buildHourlyBucketsFromAggregates,
  createEmptyHourBuckets,
  HIGH_VOLUME_IMAGE_THRESHOLD,
  parseAggregateCount,
} from './dashboard-image-aggregation.util';
import { PatrolImage } from '@/patrol-images/entities/patrol-image.entity';

describe('dashboard-image-aggregation.util', () => {
  it('marks high volume threshold at 500 images', () => {
    expect(HIGH_VOLUME_IMAGE_THRESHOLD).toBe(500);
  });

  it('builds hourly buckets from SQL aggregates', () => {
    const rows = [
      { siteId: 'site-1', groupId: null },
      { siteId: 'site-1', groupId: 'group-1' },
    ];
    const firstImage = {
      id: 'img-1',
      siteId: 'site-1',
      groupId: null,
      sentAt: new Date('2026-03-31T05:20:00.000Z'),
      senderName: 'Guard One',
    } as unknown as PatrolImage;
    const firstImagesByBucket = new Map([['site:6', firstImage]]);

    const buckets = buildHourlyBucketsFromAggregates(
      'site-1',
      rows,
      [
        {
          groupId: null,
          patrolHour: 6,
          imageCount: 1500,
          firstSentAt: new Date('2026-03-31T05:20:00.000Z'),
        },
      ],
      firstImagesByBucket,
    );

    const siteBuckets = buckets.get('site-1::site') ?? createEmptyHourBuckets();
    expect(siteBuckets[6].count).toBe(1500);
    expect(siteBuckets[6].firstImage?.id).toBe('img-1');
    expect(parseAggregateCount('1500')).toBe(1500);
  });
});
