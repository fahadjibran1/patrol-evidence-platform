import { NotificationStatus, NotificationType } from '@prisma/client';
import { SupportOpsService } from './support-ops.service';

describe('SupportOpsService', () => {
  const prisma = {
    notificationLog: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    subscription: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    licence: {
      findFirst: jest.fn(),
    },
    customer: {
      findUnique: jest.fn(),
    },
    admin: {
      findUnique: jest.fn(),
    },
    customerUser: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  };

  const auditService = { record: jest.fn() };
  const notifications = { send: jest.fn() };
  const authService = { clearLoginRateLimit: jest.fn().mockReturnValue(1) };
  const customerAuthService = { clearLoginRateLimit: jest.fn().mockReturnValue(2) };
  const eventBus = { publish: jest.fn() };

  const admin = {
    sub: 'admin-1',
    email: 'admin@test',
    role: 'SUPER_ADMIN' as const,
    displayName: 'Admin',
  };

  let service: SupportOpsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SupportOpsService(
      prisma as never,
      auditService as never,
      notifications as never,
      authService as never,
      customerAuthService as never,
      eventBus as never,
    );
  });

  it('resends a notification from an existing log', async () => {
    prisma.notificationLog.findUnique.mockResolvedValue({
      id: 'log-1',
      recipient: 'a@b.com',
      subject: 'Hello',
      notificationType: NotificationType.PAYMENT_FAILED,
      status: NotificationStatus.FAILED,
      customerId: 'org-1',
      licenceId: null,
    });
    notifications.send.mockResolvedValue({ logId: 'log-2', success: true, status: 'SENT' });

    const result = await service.resendNotification(admin, 'log-1');
    expect(notifications.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'a@b.com',
        source: 'support.resend',
        notificationType: NotificationType.ADMIN_ALERT,
      }),
    );
    expect(result.resend.logId).toBe('log-2');
  });

  it('unlocks a customer account and clears rate limits', async () => {
    prisma.customerUser.findFirst.mockResolvedValue({
      id: 'user-1',
      email: 'owner@test',
      customerId: 'org-1',
      isActive: false,
    });
    prisma.customerUser.update.mockResolvedValue({});

    const result = await service.unlockAccount(admin, {
      accountType: 'customer',
      email: 'owner@test',
      reactivate: true,
    });

    expect(customerAuthService.clearLoginRateLimit).toHaveBeenCalledWith('owner@test');
    expect(prisma.customerUser.update).toHaveBeenCalled();
    expect(result.clearedRateLimitKeys).toBe(2);
  });
});
