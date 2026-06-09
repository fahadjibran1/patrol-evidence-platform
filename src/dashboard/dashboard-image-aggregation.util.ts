import { PatrolSlotStatus } from '@/common/enums/patrol-slot-status.enum';
import { PatrolImage } from '@/patrol-images/entities/patrol-image.entity';

/** Sites above this receive SQL hourly aggregates instead of full in-memory image loads. */
export const HIGH_VOLUME_IMAGE_THRESHOLD = 500;

export const RECENT_PATROL_IMAGES_LIMIT = 10;

export const NON_COUNTABLE_IMAGE_STATUSES = [
  PatrolSlotStatus.DUPLICATE,
  PatrolSlotStatus.INVALID_IMAGE,
] as const;

export interface SiteHourlyImageAggregate {
  groupId: string | null;
  patrolHour: number;
  imageCount: number;
  firstSentAt: Date;
}

export interface HourBucketLike {
  hour: number;
  count: number;
  firstImage: PatrolImage | null;
}

export function buildRowKey(siteId: string, groupId: string | null): string {
  return `${siteId}::${groupId ?? 'site'}`;
}

export function rowMatchesImageGroup(rowGroupId: string | null, imageGroupId: string | null): boolean {
  if (rowGroupId === null) {
    return imageGroupId === null;
  }
  return rowGroupId === imageGroupId;
}

export function createEmptyHourBuckets(): HourBucketLike[] {
  return Array.from({ length: 24 }, (_, hour) => ({
    hour,
    count: 0,
    firstImage: null,
  }));
}

export function buildHourlyBucketsFromAggregates(
  siteId: string,
  rows: Array<{ siteId: string; groupId: string | null }>,
  aggregates: SiteHourlyImageAggregate[],
  firstImagesByBucket: Map<string, PatrolImage>,
): Map<string, HourBucketLike[]> {
  const buckets = new Map<string, HourBucketLike[]>();

  for (const row of rows) {
    if (row.siteId !== siteId) {
      continue;
    }
    buckets.set(buildRowKey(row.siteId, row.groupId), createEmptyHourBuckets());
  }

  for (const aggregate of aggregates) {
    for (const row of rows) {
      if (row.siteId !== siteId) {
        continue;
      }
      if (!rowMatchesImageGroup(row.groupId, aggregate.groupId)) {
        continue;
      }

      const rowKey = buildRowKey(row.siteId, row.groupId);
      const hourBuckets = buckets.get(rowKey) ?? createEmptyHourBuckets();
      const bucket = hourBuckets[aggregate.patrolHour];
      bucket.count = aggregate.imageCount;
      bucket.firstImage =
        firstImagesByBucket.get(buildAggregateBucketKey(aggregate.groupId, aggregate.patrolHour)) ?? null;
      buckets.set(rowKey, hourBuckets);
    }
  }

  return buckets;
}

export function buildAggregateBucketKey(groupId: string | null, patrolHour: number): string {
  return `${groupId ?? 'site'}:${patrolHour}`;
}

export function parseAggregateCount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseAggregateHour(value: unknown): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 23 ? parsed : 0;
}
