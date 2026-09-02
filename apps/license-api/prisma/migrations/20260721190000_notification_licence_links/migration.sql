-- Milestone 3B: link notification logs to licence/customer/actor and source

ALTER TABLE "NotificationLog" ADD COLUMN "source" TEXT;
ALTER TABLE "NotificationLog" ADD COLUMN "licenceId" TEXT;
ALTER TABLE "NotificationLog" ADD COLUMN "customerId" TEXT;
ALTER TABLE "NotificationLog" ADD COLUMN "actorAdminId" TEXT;

CREATE INDEX "NotificationLog_licenceId_idx" ON "NotificationLog"("licenceId");
CREATE INDEX "NotificationLog_customerId_idx" ON "NotificationLog"("customerId");
CREATE INDEX "NotificationLog_actorAdminId_idx" ON "NotificationLog"("actorAdminId");

ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_licenceId_fkey" FOREIGN KEY ("licenceId") REFERENCES "Licence"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_actorAdminId_fkey" FOREIGN KEY ("actorAdminId") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;
