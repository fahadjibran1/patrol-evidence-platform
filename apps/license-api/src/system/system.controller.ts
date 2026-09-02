import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminRole, NotificationStatus } from '@prisma/client';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/auth/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { PrismaService } from '@/prisma/prisma.service';
import { QueueService } from '@/queue/queue.service';
import { EmailProvider } from '@/notifications/providers/email.provider';
import { DashboardService } from '@/dashboard/dashboard.service';
import { VersionService } from './version.service';
import { ErrorReportingService } from '@/error-reporting/error-reporting.service';
import { cpus, freemem, loadavg, totalmem } from 'os';
import { statfs } from 'fs/promises';

const processStartedAt = Date.now();

@ApiTags('system')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/system')
export class SystemController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
    private readonly emailProvider: EmailProvider,
    private readonly dashboardService: DashboardService,
    private readonly versionService: VersionService,
    private readonly errorReporting: ErrorReportingService,
  ) {}

  @Get('status')
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  async getStatus() {
    const [databaseOk, queues, pendingEmails, failedEmails, version, disk, stripeWebhookStats] =
      await Promise.all([
      this.checkDatabase(),
      this.queueService.getQueueStats(),
      this.prisma.notificationLog.count({ where: { status: NotificationStatus.QUEUED } }).catch(() => 0),
      this.prisma.notificationLog.count({ where: { status: NotificationStatus.FAILED } }).catch(() => 0),
      this.versionService.getVersion(),
      this.readDiskUsage(),
      this.loadStripeWebhookStats(),
    ]);

    const smtpStatus = this.emailProvider.getSafeStatus();
    const pendingJobs = queues.reduce((sum, q) => sum + q.waiting + q.delayed, 0);
    const failedJobs = queues.reduce((sum, q) => sum + q.failed, 0);
    const mem = process.memoryUsage();
    const cpuCount = cpus().length;

    return {
      version: version.apiVersion,
      buildNumber: version.buildNumber,
      environment: version.environment,
      health: databaseOk ? 'healthy' : 'degraded',
      uptimeSeconds: Math.round((Date.now() - processStartedAt) / 1000),
      versions: version,
      database: { ok: databaseOk, migrationVersion: version.databaseMigrationVersion },
      redis: {
        configured: Boolean(process.env.REDIS_URL),
        connected: this.queueService.isRedisEnabled(),
      },
      queue: {
        mode: this.queueService.getMode(),
        queues,
        pendingEmails,
        failedEmails,
        pendingJobs,
        failedJobs,
        workers: this.queueService.isRedisEnabled() ? 'external-or-colocated' : 'inline-api-process',
      },
      smtp: {
        configured: smtpStatus.configured,
        host: smtpStatus.host,
        fromEmail: smtpStatus.fromEmail,
      },
      cache: {
        dashboardCachedRoles: this.dashboardService.cacheSize,
      },
      errorReporting: {
        provider: this.errorReporting.providerName,
      },
      stripe: {
        ...this.getStripeSafeStatus(),
        ...stripeWebhookStats,
      },
      runtime: {
        nodeVersion: process.version,
        pid: process.pid,
        memory: {
          rssBytes: mem.rss,
          heapUsedBytes: mem.heapUsed,
          heapTotalBytes: mem.heapTotal,
          systemTotalBytes: totalmem(),
          systemFreeBytes: freemem(),
        },
        cpu: {
          cores: cpuCount,
          loadAverage: loadavg(),
        },
        disk,
      },
    };
  }

  private getStripeSafeStatus() {
    const enabled = ['1', 'true', 'yes', 'on'].includes(
      (process.env.STRIPE_ENABLED ?? '').trim().toLowerCase(),
    );
    const secretKey = process.env.STRIPE_SECRET_KEY?.trim() ?? '';
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim() ?? '';
    const configured = Boolean(secretKey && webhookSecret);
    let mode: 'TEST' | 'LIVE' | 'DISABLED' = 'DISABLED';
    if (enabled && configured) {
      mode = secretKey.startsWith('sk_live_') ? 'LIVE' : 'TEST';
    }
    return { enabled, mode, configured };
  }

  private async loadStripeWebhookStats() {
    try {
      const [failed, deadLetter, lastProcessed, openAlerts] = await Promise.all([
        this.prisma.stripeWebhookEvent.count({ where: { processingStatus: 'FAILED' } }),
        this.prisma.stripeWebhookEvent.count({ where: { processingStatus: 'DEAD_LETTER' } }),
        this.prisma.stripeWebhookEvent.findFirst({
          where: { processingStatus: 'PROCESSED' },
          orderBy: { processedAt: 'desc' },
          select: { processedAt: true, type: true },
        }),
        this.prisma.stripeReconciliationAlert.count({ where: { status: 'OPEN' } }),
      ]);
      return {
        failedWebhooks: failed,
        deadLetterWebhooks: deadLetter,
        lastProcessedWebhookAt: lastProcessed?.processedAt?.toISOString() ?? null,
        lastProcessedWebhookType: lastProcessed?.type ?? null,
        openReconciliationAlerts: openAlerts,
      };
    } catch {
      return {
        failedWebhooks: 0,
        deadLetterWebhooks: 0,
        lastProcessedWebhookAt: null,
        lastProcessedWebhookType: null,
        openReconciliationAlerts: 0,
      };
    }
  }

  private async checkDatabase(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  private async readDiskUsage(): Promise<{
    available: boolean;
    totalBytes?: number;
    freeBytes?: number;
    usedBytes?: number;
  }> {
    try {
      const stats = await statfs(process.cwd());
      const totalBytes = Number(stats.bsize) * Number(stats.blocks);
      const freeBytes = Number(stats.bsize) * Number(stats.bfree);
      return {
        available: true,
        totalBytes,
        freeBytes,
        usedBytes: totalBytes - freeBytes,
      };
    } catch {
      return { available: false };
    }
  }
}
