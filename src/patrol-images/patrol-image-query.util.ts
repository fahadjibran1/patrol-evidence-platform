import { Logger } from '@nestjs/common';
import { PatrolSlotStatus } from '@/common/enums/patrol-slot-status.enum';
import {
  getOperationalDateUtcBounds,
  getPatrolTimeParts,
  patrolTimeZone,
} from '@/common/utils/patrol-time.util';
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
  return getOperationalDateUtcBounds(patrolDate, timeZone);
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
