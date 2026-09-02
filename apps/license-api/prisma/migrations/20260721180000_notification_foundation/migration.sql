-- Milestone 3A: notification foundation (email provider + delivery log)

CREATE TYPE "NotificationType" AS ENUM (
  'LICENSE_ISSUED',
  'LICENSE_REISSUED',
  'LICENSE_RENEWED',
  'LICENSE_EXPIRED',
  'LICENSE_EXPIRING',
  'PAYMENT_RECEIVED',
  'PAYMENT_FAILED',
  'WELCOME',
  'PASSWORD_RESET',
  'ADMIN_ALERT'
);

CREATE TYPE "NotificationStatus" AS ENUM (
  'PENDING',
  'SENT',
  'FAILED'
);

CREATE TYPE "NotificationProviderKind" AS ENUM (
  'EMAIL'
);

CREATE TABLE "NotificationLog" (
  "id" TEXT NOT NULL,
  "notificationType" "NotificationType" NOT NULL,
  "provider" "NotificationProviderKind" NOT NULL,
  "recipient" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "sentAt" TIMESTAMP(3),
  "errorMessage" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "NotificationLog_notificationType_idx" ON "NotificationLog"("notificationType");
CREATE INDEX "NotificationLog_status_idx" ON "NotificationLog"("status");
CREATE INDEX "NotificationLog_recipient_idx" ON "NotificationLog"("recipient");
CREATE INDEX "NotificationLog_createdAt_idx" ON "NotificationLog"("createdAt");
