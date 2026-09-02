/**
 * Prisma-backed notification delivery log.
 * Canonical schema: apps/license-api/prisma/schema.prisma → NotificationLog
 *
 * Re-export Prisma enums so module code and docs share one source of truth.
 */
export {
  NotificationType,
  NotificationStatus as NotificationDeliveryStatus,
  NotificationProviderKind,
  type NotificationLog as NotificationLogEntity,
} from '@prisma/client';
