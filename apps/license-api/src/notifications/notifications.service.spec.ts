import { NotificationProviderKind, NotificationStatus, NotificationType } from '@prisma/client';
import { ERROR_CODES } from '@/common/constants/error-codes';
import { NotificationService } from './notifications.service';
import { NOTIFICATION_PROVIDERS } from './interfaces/notification-provider.interface';
import type { NotificationProvider } from './interfaces/notification-provider.interface';

describe('NotificationService', () => {
  const prisma = {
    notificationLog: {
      create: jest.fn(),
      update: jest.fn(),
    },
  };
  const auditService = {
    record: jest.fn(),
    sanitizeMetadata: jest.fn((metadata?: Record<string, unknown>) => metadata),
  };
  const emailProvider: NotificationProvider = {
    kind: NotificationProviderKind.EMAIL,
    supports: jest.fn().mockReturnValue(true),
    send: jest.fn(),
  };

  function buildService(providers: NotificationProvider[] = [emailProvider]): NotificationService {
    return new NotificationService(prisma as never, auditService as never, providers);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    (emailProvider.supports as jest.Mock).mockReturnValue(true);
    (emailProvider.send as jest.Mock).mockResolvedValue({
      success: true,
      providerMessageId: 'msg-1',
    });
    prisma.notificationLog.create.mockResolvedValue({
      id: 'log-1',
      status: NotificationStatus.PENDING,
    });
    prisma.notificationLog.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'log-1',
      status: data.status,
    }));
  });

  it('sends through the email provider and logs SENT with audit events', async () => {
    const service = buildService();
    const result = await service.send({
      notificationType: NotificationType.LICENSE_ISSUED,
      to: 'customer@example.com',
      subject: 'Licence issued',
      html: '<p>ok</p>',
      text: 'ok',
      actorAdminId: 'admin-1',
      customerId: 'cust-1',
      licenceId: 'lic-1',
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe(NotificationStatus.SENT);
    expect(result.logId).toBe('log-1');
    expect(emailProvider.send).toHaveBeenCalled();
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'notification.requested' }),
    );
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'notification.sent' }),
    );
    expect(JSON.stringify(auditService.record.mock.calls)).not.toContain('SMTP_PASSWORD');
    expect(JSON.stringify(auditService.record.mock.calls)).not.toContain('secret');
  });

  it('logs FAILED when provider delivery fails without throwing', async () => {
    (emailProvider.send as jest.Mock).mockResolvedValue({
      success: false,
      errorMessage: 'SMTP is not configured',
    });
    const service = buildService();

    const result = await service.send({
      notificationType: NotificationType.LICENSE_ISSUED,
      to: 'customer@example.com',
      subject: 'Licence issued',
      html: '<p>ok</p>',
      text: 'ok',
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(NotificationStatus.FAILED);
    expect(result.errorMessage).toMatch(/SMTP is not configured/i);
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'notification.failed' }),
    );
  });

  it('sendEmail renders LICENSE_ISSUED template data', async () => {
    const service = buildService();
    const result = await service.sendEmail({
      to: 'customer@example.com',
      notificationType: NotificationType.LICENSE_ISSUED,
      templateData: {
        contactName: 'Alex',
        companyName: 'ABC Security Ltd',
        licenseId: 'PEL-2026-000001',
        plan: 'ANNUAL',
        startsAtDisplay: '21/07/2026',
        expiresAtDisplay: '20/07/2027',
        maxDevices: 1,
        activationInstructions: 'Activate in desktop app.',
        supportEmail: 'support@example.com',
        fromName: 'Patrol Licence Portal',
        attachmentFilename: 'PEL-2026-000001.lic',
      },
      actorAdminId: 'admin-1',
    });

    expect(result.success).toBe(true);
    expect(emailProvider.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'customer@example.com',
        subject: expect.stringContaining('PEL-2026-000001'),
        html: expect.stringContaining('ABC Security Ltd'),
        text: expect.stringContaining('PEL-2026-000001'),
      }),
    );
  });

  it('rejects unsupported notification types without a template', async () => {
    const service = buildService();
    await expect(
      service.sendEmail({
        to: 'customer@example.com',
        notificationType: NotificationType.PASSWORD_RESET,
      }),
    ).resolves.toMatchObject({
      success: false,
      status: NotificationStatus.FAILED,
    });
  });

  it('exports provider token for DI composition', () => {
    expect(NOTIFICATION_PROVIDERS).toBeDefined();
  });

  it('surfaces stable unsupported-provider error code', async () => {
    const service = buildService([]);
    await expect(
      service.send({
        notificationType: NotificationType.LICENSE_ISSUED,
        to: 'a@b.com',
        subject: 'x',
        html: 'x',
        text: 'x',
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.NOTIFICATION_PROVIDER_UNSUPPORTED });
  });
});
