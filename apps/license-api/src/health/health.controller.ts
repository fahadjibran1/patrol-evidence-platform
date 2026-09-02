import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { NotificationStatus } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { QueueService } from '@/queue/queue.service';
import { EmailProvider } from '@/notifications/providers/email.provider';

const startedAt = Date.now();

/**
 * Unauthenticated health/readiness endpoints, intended for load balancer health checks and
 * platform monitoring (e.g. Render). Never returns secrets — only booleans/counts/versions.
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
    private readonly emailProvider: EmailProvider,
  ) {}

  @Get('live')
  live() {
    return {
      status: 'ok',
      uptime: this.uptimeSeconds(),
    };
  }

  @Get('ready')
  async ready() {
    const [databaseOk, queueStats] = await Promise.all([this.checkDatabase(), this.queueService.getQueueStats()]);
    const redisEnabled = this.queueService.isRedisEnabled();
    const smtpConfigured = this.emailProvider.getSafeStatus().configured;

    const status = databaseOk ? 'ok' : 'degraded';

    return {
      status,
      uptime: this.uptimeSeconds(),
      checks: {
        database: databaseOk,
        redis: {
          configured: redisEnabled || Boolean(process.env.REDIS_URL),
          connected: redisEnabled,
        },
        smtp: {
          configured: smtpConfigured,
        },
        queue: {
          mode: this.queueService.getMode(),
        },
      },
      queues: queueStats,
    };
  }

  @Get('startup')
  async startup() {
    const [queueStats, pendingEmails] = await Promise.all([
      this.queueService.getQueueStats(),
      this.prisma.notificationLog.count({ where: { status: NotificationStatus.QUEUED } }).catch(() => 0),
    ]);

    return {
      version: process.env.APP_VERSION ?? '0.0.0',
      buildNumber: process.env.BUILD_NUMBER ?? 'local',
      environment: process.env.NODE_ENV ?? 'development',
      uptime: this.uptimeSeconds(),
      queues: queueStats,
      pendingEmails,
    };
  }

  private uptimeSeconds(): number {
    return Math.round((Date.now() - startedAt) / 1000);
  }

  private async checkDatabase(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
