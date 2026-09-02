import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import {
  NotificationProviderKind,
  NotificationStatus,
  NotificationType,
  Prisma,
} from '@prisma/client';
import { AuditService } from '@/audit/audit.service';
import { ERROR_CODES } from '@/common/constants/error-codes';
import { ApiException } from '@/common/exceptions/api.exception';
import { PrismaService } from '@/prisma/prisma.service';
import { QueueService } from '@/queue/queue.service';
import { QUEUE_NAMES } from '@/queue/queue.constants';
import type { EmailJobPayload, EmailJobResult } from '@/queue/queue.types';
import { EventBus } from '@/domain-events/event-bus.service';
import { createDomainEvent } from '@/domain-events/domain-event';
import { DOMAIN_EVENTS } from '@/domain-events/domain-event.types';
import {
  LicenceIssuedTemplateData,
  SendEmailDto,
} from './dto/send-email.dto';
import {
  NOTIFICATION_PROVIDERS,
  type NotificationAttachment,
  type NotificationMessage,
  type NotificationProvider,
  type NotificationSendResult,
} from './interfaces/notification-provider.interface';
import { renderLicenceIssuedTemplate } from './templates/licence-issued.template';
import { renderLicenceRenewedTemplate } from './templates/licence-renewed.template';
import { renderLicenceReissuedTemplate } from './templates/licence-reissued.template';
import type { RenderedNotificationTemplate } from './templates/base.template';

export interface NotificationSendInput {
  notificationType: NotificationType;
  provider?: NotificationProviderKind;
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: NotificationAttachment[];
  actorAdminId?: string | null;
  customerId?: string | null;
  licenceId?: string | null;
  source?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface NotificationServiceResult {
  success: boolean;
  logId: string;
  status: NotificationStatus;
  errorMessage?: string;
  errorCode?: string;
  providerMessageId?: string;
}

interface DeliverAuditContext {
  actorAdminId?: string | null;
  customerId?: string | null;
  licenceId?: string | null;
  notificationType: NotificationType;
  provider: NotificationProviderKind;
  recipient: string;
  subject: string;
  source?: string | null;
}

interface PendingEmailJob {
  message: NotificationMessage;
  providerKind: NotificationProviderKind;
  auditContext: DeliverAuditContext;
}

@Injectable()
export class NotificationService implements OnModuleInit {
  private readonly logger = new Logger(NotificationService.name);
  /**
   * Transient in-memory store of the actual email payload (html/text/attachments) for a
   * QUEUED NotificationLog, keyed by log id. NotificationLog itself intentionally never
   * persists message bodies (attachments can contain the plaintext TG1 licence key), so
   * the inline queue and same-process BullMQ workers pull the payload from here instead.
   * If the process restarts before a Redis-backed job is picked up, delivery is reported
   * as failed rather than guessing at lost content — see processQueuedEmail().
   */
  private readonly pendingJobs = new Map<string, PendingEmailJob>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    @Inject(NOTIFICATION_PROVIDERS)
    private readonly providers: NotificationProvider[],
    @Optional() private readonly queueService?: QueueService,
    @Optional() private readonly eventBus?: EventBus,
  ) {}

  onModuleInit(): void {
    this.queueService?.registerProcessor<EmailJobPayload, EmailJobResult>(QUEUE_NAMES.EMAIL, async (payload) => {
      const result = await this.processQueuedEmail(payload.notificationLogId);
      return {
        success: result.success,
        logId: result.logId,
        status: result.status,
        errorMessage: result.errorMessage,
        errorCode: result.errorCode,
        providerMessageId: result.providerMessageId,
      };
    });
  }

  async send(input: NotificationSendInput): Promise<NotificationServiceResult> {
    const providerKind = input.provider ?? NotificationProviderKind.EMAIL;
    const provider = this.providers.find((entry) => entry.kind === providerKind);

    if (!provider) {
      throw new ApiException(
        ERROR_CODES.NOTIFICATION_PROVIDER_UNSUPPORTED,
        `Notification provider ${providerKind} is not registered`,
        501,
      );
    }

    if (!provider.supports(input.notificationType)) {
      throw new ApiException(
        ERROR_CODES.NOTIFICATION_TYPE_UNSUPPORTED,
        `Notification type ${input.notificationType} is not supported by ${providerKind}`,
        400,
      );
    }

    const safeMetadata = this.auditService.sanitizeMetadata({
      ...(input.metadata ?? {}),
      humanLicenseId:
        typeof input.metadata?.humanLicenseId === 'string' ? input.metadata.humanLicenseId : undefined,
      source: input.source ?? undefined,
    });

    const log = await this.prisma.notificationLog.create({
      data: {
        notificationType: input.notificationType,
        provider: providerKind,
        recipient: input.to,
        subject: input.subject,
        status: this.queueService ? NotificationStatus.QUEUED : NotificationStatus.PENDING,
        attempts: 0,
        source: input.source ?? null,
        licenceId: input.licenceId ?? null,
        customerId: input.customerId ?? null,
        actorAdminId: input.actorAdminId ?? null,
        metadata: safeMetadata as Prisma.InputJsonValue | undefined,
      },
    });

    await this.auditService.record({
      actorAdminId: input.actorAdminId,
      action: 'notification.requested',
      entityType: 'NotificationLog',
      entityId: log.id,
      customerId: input.customerId,
      licenceId: input.licenceId,
      metadata: {
        notificationType: input.notificationType,
        provider: providerKind,
        recipient: input.to,
        subject: input.subject,
        source: input.source,
      },
    });

    const message: NotificationMessage = {
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      notificationType: input.notificationType,
      attachments: input.attachments,
    };

    const auditContext: DeliverAuditContext = {
      actorAdminId: input.actorAdminId,
      customerId: input.customerId,
      licenceId: input.licenceId,
      notificationType: input.notificationType,
      provider: providerKind,
      recipient: input.to,
      subject: input.subject,
      source: input.source,
    };

    if (this.queueService) {
      // Stash the payload in-memory (never persisted — may contain a plaintext TG1 licence
      // key as an attachment) and hand off a lightweight job. In inline mode (no REDIS_URL,
      // including every test environment) the registered processor runs synchronously
      // before enqueueEmail resolves, so SMTP has already been attempted by the time we
      // return here — preserving the previous direct-delivery behaviour for callers/tests.
      this.pendingJobs.set(log.id, { message, providerKind, auditContext });
      const jobResult = await this.queueService.enqueueEmail({ notificationLogId: log.id });
      return {
        success: jobResult.success,
        logId: jobResult.logId,
        status: jobResult.status as NotificationStatus,
        errorMessage: jobResult.errorMessage,
        errorCode: jobResult.errorCode,
        providerMessageId: jobResult.providerMessageId,
      };
    }

    return this.deliver(provider, message, log.id, auditContext);
  }

  /**
   * Delivers a previously queued email by notificationLogId. Called by the QueueService's
   * EMAIL processor (both inline and BullMQ-worker-in-process modes). Never throws —
   * failures are recorded on the NotificationLog and returned, matching send()'s contract.
   */
  async processQueuedEmail(logId: string): Promise<NotificationServiceResult> {
    const pending = this.pendingJobs.get(logId);
    if (!pending) {
      this.logger.warn(
        `processQueuedEmail: no in-memory payload found for NotificationLog ${logId} (process restarted before delivery?).`,
      );
      const updated = await this.prisma.notificationLog
        .update({
          where: { id: logId },
          data: {
            status: NotificationStatus.FAILED,
            errorMessage: 'Notification job payload was lost before delivery (process restarted).',
          },
        })
        .catch(() => null);
      return {
        success: false,
        logId,
        status: updated?.status ?? NotificationStatus.FAILED,
        errorMessage: 'Notification job payload was lost before delivery (process restarted).',
      };
    }

    this.pendingJobs.delete(logId);

    const provider = this.providers.find((entry) => entry.kind === pending.providerKind);
    if (!provider) {
      const updated = await this.prisma.notificationLog.update({
        where: { id: logId },
        data: {
          status: NotificationStatus.FAILED,
          errorMessage: `Notification provider ${pending.providerKind} is not registered`,
        },
      });
      return {
        success: false,
        logId,
        status: updated.status,
        errorMessage: updated.errorMessage ?? undefined,
      };
    }

    return this.deliver(provider, pending.message, logId, pending.auditContext);
  }

  async sendEmail(dto: SendEmailDto): Promise<NotificationServiceResult> {
    try {
      const rendered = this.resolveEmailContent(dto);
      return await this.send({
        notificationType: dto.notificationType,
        provider: NotificationProviderKind.EMAIL,
        to: dto.to,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        actorAdminId: dto.actorAdminId,
        customerId: dto.customerId,
        licenceId: dto.licenceId,
        metadata: {
          channel: 'email',
          hasTemplateData: Boolean(dto.templateData),
        },
      });
    } catch (error) {
      this.logger.warn(
        `sendEmail failed before delivery: ${error instanceof Error ? error.message : String(error)}`,
      );

      const failureMessage = this.formatErrorMessage(error);
      const failureLog = await this.prisma.notificationLog.create({
        data: {
          notificationType: dto.notificationType,
          provider: NotificationProviderKind.EMAIL,
          recipient: dto.to,
          subject: dto.subject ?? dto.notificationType,
          status: NotificationStatus.FAILED,
          attempts: 0,
          errorMessage: failureMessage,
          licenceId: dto.licenceId ?? null,
          customerId: dto.customerId ?? null,
          actorAdminId: dto.actorAdminId ?? null,
        },
      });

      await this.auditService.record({
        actorAdminId: dto.actorAdminId,
        action: 'notification.failed',
        entityType: 'NotificationLog',
        entityId: failureLog.id,
        customerId: dto.customerId,
        licenceId: dto.licenceId,
        metadata: {
          notificationType: dto.notificationType,
          provider: NotificationProviderKind.EMAIL,
          recipient: dto.to,
          reason: 'pre_delivery_error',
        },
      });

      return {
        success: false,
        logId: failureLog.id,
        status: NotificationStatus.FAILED,
        errorMessage: failureMessage,
      };
    }
  }

  async listForLicence(licenceId: string, take = 50) {
    const rows = await this.prisma.notificationLog.findMany({
      where: { licenceId },
      orderBy: { createdAt: 'desc' },
      take,
      include: {
        actorAdmin: {
          select: { id: true, displayName: true, email: true },
        },
      },
    });

    return rows.map((row) => ({
      id: row.id,
      notificationType: row.notificationType,
      provider: row.provider,
      recipient: row.recipient,
      subject: row.subject,
      status: row.status,
      attempts: row.attempts,
      sentAt: row.sentAt?.toISOString() ?? null,
      errorMessage: row.errorMessage,
      source: row.source,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      actorDisplayName: row.actorAdmin?.displayName ?? null,
      actorAdminId: row.actorAdminId,
    }));
  }

  resolveEmailContent(dto: SendEmailDto): RenderedNotificationTemplate {
    if (dto.notificationType === NotificationType.LICENSE_ISSUED) {
      if (dto.templateData) {
        return renderLicenceIssuedTemplate(dto.templateData as unknown as LicenceIssuedTemplateData);
      }
      if (dto.subject && dto.html && dto.text) {
        return { subject: dto.subject, html: dto.html, text: dto.text };
      }
      throw new ApiException(
        ERROR_CODES.VALIDATION_ERROR,
        'LICENSE_ISSUED email requires templateData or subject/html/text',
        400,
      );
    }

    if (dto.notificationType === NotificationType.LICENSE_RENEWED) {
      if (dto.templateData) {
        return renderLicenceRenewedTemplate(dto.templateData as unknown as LicenceIssuedTemplateData);
      }
      if (dto.subject && dto.html && dto.text) {
        return { subject: dto.subject, html: dto.html, text: dto.text };
      }
      throw new ApiException(
        ERROR_CODES.VALIDATION_ERROR,
        'LICENSE_RENEWED email requires templateData or subject/html/text',
        400,
      );
    }

    if (dto.notificationType === NotificationType.LICENSE_REISSUED) {
      if (dto.templateData) {
        return renderLicenceReissuedTemplate(dto.templateData as unknown as LicenceIssuedTemplateData);
      }
      if (dto.subject && dto.html && dto.text) {
        return { subject: dto.subject, html: dto.html, text: dto.text };
      }
      throw new ApiException(
        ERROR_CODES.VALIDATION_ERROR,
        'LICENSE_REISSUED email requires templateData or subject/html/text',
        400,
      );
    }

    if (dto.subject && dto.html && dto.text) {
      return { subject: dto.subject, html: dto.html, text: dto.text };
    }

    throw new ApiException(
      ERROR_CODES.NOTIFICATION_TYPE_UNSUPPORTED,
      `No email template implemented for ${dto.notificationType}`,
      501,
    );
  }

  private async deliver(
    provider: NotificationProvider,
    message: NotificationMessage,
    logId: string,
    auditContext: DeliverAuditContext,
  ): Promise<NotificationServiceResult> {
    const result: NotificationSendResult = await provider.send(message);

    if (result.success) {
      const updated = await this.prisma.notificationLog.update({
        where: { id: logId },
        data: {
          status: NotificationStatus.SENT,
          attempts: { increment: 1 },
          sentAt: new Date(),
          errorMessage: null,
        },
      });

      await this.auditService.record({
        actorAdminId: auditContext.actorAdminId,
        action: 'notification.sent',
        entityType: 'NotificationLog',
        entityId: logId,
        customerId: auditContext.customerId,
        licenceId: auditContext.licenceId,
        metadata: {
          notificationType: auditContext.notificationType,
          provider: auditContext.provider,
          recipient: auditContext.recipient,
          subject: auditContext.subject,
          source: auditContext.source,
          providerMessageId: result.providerMessageId,
        },
      });

      await this.eventBus?.publish(
        createDomainEvent(DOMAIN_EVENTS.NotificationSent, {
          logId: updated.id,
          notificationType: auditContext.notificationType,
          recipient: auditContext.recipient,
          customerId: auditContext.customerId,
          licenceId: auditContext.licenceId,
        }),
      );

      return {
        success: true,
        logId: updated.id,
        status: updated.status,
        providerMessageId: result.providerMessageId,
      };
    }

    const errorMessage = result.errorMessage || 'Notification delivery failed';
    const updated = await this.prisma.notificationLog.update({
      where: { id: logId },
      data: {
        status: NotificationStatus.FAILED,
        attempts: { increment: 1 },
        errorMessage,
      },
    });

    await this.auditService.record({
      actorAdminId: auditContext.actorAdminId,
      action: 'notification.failed',
      entityType: 'NotificationLog',
      entityId: logId,
      customerId: auditContext.customerId,
      licenceId: auditContext.licenceId,
      metadata: {
        notificationType: auditContext.notificationType,
        provider: auditContext.provider,
        recipient: auditContext.recipient,
        subject: auditContext.subject,
        source: auditContext.source,
        reason: errorMessage,
        errorCode: result.errorCode,
      },
    });

    await this.eventBus?.publish(
      createDomainEvent(DOMAIN_EVENTS.NotificationFailed, {
        logId: updated.id,
        notificationType: auditContext.notificationType,
        recipient: auditContext.recipient,
        customerId: auditContext.customerId,
        licenceId: auditContext.licenceId,
        reason: errorMessage,
      }),
    );

    return {
      success: false,
      logId: updated.id,
      status: updated.status,
      errorMessage,
      errorCode: result.errorCode,
    };
  }

  private formatErrorMessage(error: unknown): string {
    if (error instanceof ApiException) {
      const response = error.getResponse();
      return typeof response === 'object' && response !== null && 'message' in response
        ? String((response as { message: string }).message)
        : error.message;
    }
    return error instanceof Error ? error.message : 'Email notification failed';
  }
}
