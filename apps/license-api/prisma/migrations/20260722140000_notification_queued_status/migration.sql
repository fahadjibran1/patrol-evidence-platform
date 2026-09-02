-- Phase 3E: async notification queue status
ALTER TYPE "NotificationStatus" ADD VALUE IF NOT EXISTS 'QUEUED';
