import { Logger } from '@nestjs/common';
import { PatrolSlotStatus } from '@/common/enums/patrol-slot-status.enum';
import { getPatrolTimeParts, patrolTimeZone } from '@/common/utils/patrol-time.util';
import { PatrolImage } from './entities/patrol-image.entity';

export type PatrolImageAggregationLogLabel =
  | 'DASHBOARD_IMAGE_COUNT'
  | 'EVIDENCE_IMAGE_COUNT'
  | 'GUARDSAFE_SENDER_COUNT';

export function isCountablePatrolImage(image: Pick<PatrolImage, 'status'>): boolean {
  return (
    image.status !== PatrolSlotStatus.DUPLICATE &&
    image.status !== PatrolSlotStatus.INVALID_IMAGE
  );
}

export function imageSentOnPatrolDate(
  sentAt: Date,
  patrolDate: string,
  timeZone = patrolTimeZone(),
): boolean {
  return getPatrolTimeParts(sentAt, timeZone).date === patrolDate;
}

export function imagePatrolHourFromSentAt(sentAt: Date, timeZone = patrolTimeZone()): number {
  return getPatrolTimeParts(sentAt, timeZone).hour;
}

export function dedupePatrolImagesForCount<T extends Pick<PatrolImage, 'id' | 'messageExternalId' | 'status'>>(
  images: T[],
): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const image of images) {
    if (!isCountablePatrolImage(image)) {
      continue;
    }

    const dedupeKey = image.messageExternalId?.trim() || image.id;
    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    result.push(image);
  }

  return result;
}

export function filterPatrolImagesForPatrolDate<T extends Pick<PatrolImage, 'sentAt'>>(
  images: T[],
  patrolDate: string,
  timeZone = patrolTimeZone(),
): T[] {
  return images.filter((image) => imageSentOnPatrolDate(image.sentAt, patrolDate, timeZone));
}

export function getPatrolDateUtcBounds(
  patrolDate: string,
  timeZone = patrolTimeZone(),
): { startInclusive: Date; endExclusive: Date } {
  const startInclusive = resolvePatrolDateMidnightUtc(patrolDate, timeZone);
  const endExclusive = resolvePatrolDateMidnightUtc(addCalendarDays(patrolDate, 1), timeZone);
  return { startInclusive, endExclusive };
}

function addCalendarDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  const nextYear = shifted.getUTCFullYear();
  const nextMonth = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const nextDay = String(shifted.getUTCDate()).padStart(2, '0');
  return `${nextYear}-${nextMonth}-${nextDay}`;
}

function resolvePatrolDateMidnightUtc(patrolDate: string, timeZone: string): Date {
  const [year, month, day] = patrolDate.split('-').map(Number);
  const anchor = Date.UTC(year, month - 1, day, 12, 0, 0);

  for (let offsetHours = -14; offsetHours <= 14; offsetHours += 1) {
    const candidate = new Date(anchor + offsetHours * 3_600_000);
    const parts = getPatrolTimeParts(candidate, timeZone);
    if (parts.date !== patrolDate || parts.hour !== 0) {
      continue;
    }

    let start = candidate.getTime();
    let end = start + 3_600_000;
    while (end - start > 1_000) {
      const mid = new Date(Math.floor((start + end) / 2));
      const midParts = getPatrolTimeParts(mid, timeZone);
      if (midParts.date === patrolDate && midParts.hour === 0) {
        end = mid.getTime();
      } else {
        start = mid.getTime();
      }
    }

    return new Date(end);
  }

  throw new Error(`Unable to resolve patrol date midnight for ${patrolDate} (${timeZone})`);
}

export function logPatrolImagesForAggregation(
  logger: Logger,
  label: PatrolImageAggregationLogLabel,
  images: Array<
    Pick<PatrolImage, 'id' | 'siteId' | 'senderExternalId' | 'senderNumber' | 'senderName' | 'messageExternalId' | 'status'>
  >,
): number {
  const countable = dedupePatrolImagesForCount(images);
  logger.log(`${label} count=${countable.length}`);

  for (const image of countable) {
    logger.log(
      `${label} imageId=${image.id} siteId=${image.siteId} senderExternalId=${image.senderExternalId ?? ''} senderNumber=${image.senderNumber ?? ''} senderName=${image.senderName ?? ''}`,
    );
  }

  return countable.length;
}
