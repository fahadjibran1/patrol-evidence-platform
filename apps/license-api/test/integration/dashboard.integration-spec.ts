import { INestApplication, ValidationPipe } from '@nestjs/common';
import {
  AdminRole,
  CustomerStatus,
  LicensePlan,
  NotificationProviderKind,
  NotificationStatus,
  NotificationType,
  PaymentStatus,
} from '@prisma/client';
import { addDays, todayUtcDate } from '@patrol/license-core';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import {
  closeIntegrationContext,
  createIntegrationContext,
  createTestCustomer,
  resetIntegrationDatabase,
  type IntegrationContext,
} from './integration-harness';

describe('Dashboard summary integration (PostgreSQL)', () => {
  let context: IntegrationContext;
  let app: INestApplication;
  const adminPassword = 'IntegrationTestPass123!';

  beforeAll(async () => {
    context = await createIntegrationContext();
    app = context.module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (context) {
      await closeIntegrationContext(context);
    }
  });

  beforeEach(async () => {
    await resetIntegrationDatabase(context.prisma);
    const admin = await context.prisma.admin.create({
      data: {
        email: context.admin.email,
        passwordHash: await bcrypt.hash(adminPassword, 10),
        displayName: context.admin.displayName,
        role: AdminRole.SUPER_ADMIN,
        isActive: true,
      },
    });
    context.admin = admin;
    context.adminActor = {
      sub: admin.id,
      email: admin.email,
      role: admin.role,
      displayName: admin.displayName,
    };
    context.signingService.useTestKey(context.privateKeyPem, 'integration-test-key');
  });

  async function loginAs(email: string): Promise<string> {
    const login = await request(app.getHttpServer())
      .post('/admin/auth/login')
      .send({ email, password: adminPassword });
    expect([200, 201]).toContain(login.status);
    const token = (login.body as { tokens?: { accessToken?: string } }).tokens?.accessToken;
    expect(token).toBeTruthy();
    return token as string;
  }

  it('returns aggregated KPIs, renewal queue, activity, notification health, and revenue for ADMIN roles', async () => {
    const customer = await createTestCustomer(context.prisma, {
      companyName: 'Dashboard Ops Ltd',
      email: 'dashboard@example.co.uk',
      status: CustomerStatus.ACTIVE,
    });

    const today = todayUtcDate();
    const expiresSoon = addDays(today, 14);

    const issued = await context.licencesService.issueImmediately(context.adminActor, {
      customerId: customer.id,
      plan: LicensePlan.ANNUAL,
      startsAt: today,
      expiresAt: expiresSoon,
      maxDevices: 1,
      features: ['collector'],
      amountPence: 12000,
      paymentStatus: PaymentStatus.PAID,
      paymentReference: 'DASH-INT-PAID-001',
    });

    await context.prisma.paymentRecord.create({
      data: {
        customerId: customer.id,
        licenceId: issued.licence.id,
        amountPence: 2500,
        currency: 'GBP',
        paymentStatus: PaymentStatus.PENDING,
        recordedByAdminId: context.admin.id,
      },
    });

    await context.prisma.notificationLog.createMany({
      data: [
        {
          notificationType: NotificationType.LICENSE_ISSUED,
          provider: NotificationProviderKind.EMAIL,
          recipient: customer.email,
          subject: 'Issued',
          status: NotificationStatus.SENT,
          attempts: 1,
          sentAt: new Date(),
          licenceId: issued.licence.id,
          customerId: customer.id,
          actorAdminId: context.admin.id,
        },
        {
          notificationType: NotificationType.LICENSE_ISSUED,
          provider: NotificationProviderKind.EMAIL,
          recipient: customer.email,
          subject: 'Failed send',
          status: NotificationStatus.FAILED,
          attempts: 1,
          errorMessage: 'SMTP rejected',
          licenceId: issued.licence.id,
          customerId: customer.id,
          actorAdminId: context.admin.id,
        },
      ],
    });

    const token = await loginAs(context.admin.email);
    const response = await request(app.getHttpServer())
      .get('/admin/dashboard')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body.kpis.activeCustomers).toBeGreaterThanOrEqual(1);
    expect(response.body.kpis.activeLicences).toBeGreaterThanOrEqual(1);
    expect(response.body.kpis.annualLicences).toBeGreaterThanOrEqual(1);
    expect(response.body.kpis.emailsSentToday).toBeGreaterThanOrEqual(1);
    expect(response.body.kpis.failedEmailsToday).toBeGreaterThanOrEqual(1);
    expect(response.body.renewalQueue.some((row: { licenseId: string }) => row.licenseId === issued.licence.licenseId)).toBe(
      true,
    );
    expect(response.body.recentActivity.length).toBeGreaterThan(0);
    expect(response.body.notificationHealth.recentFailures.length).toBeGreaterThan(0);
    expect(response.body.revenue).toEqual(
      expect.objectContaining({
        currency: 'GBP',
        outstandingPaymentsCount: expect.any(Number),
        paidThisMonthCount: expect.any(Number),
      }),
    );
    expect(response.body.revenue.outstandingPaymentsCount).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(response.body)).not.toMatch(/TG1\./);
  });

  it('omits revenue for SUPPORT while returning operational dashboard data', async () => {
    await createTestCustomer(context.prisma, {
      email: 'support-dash@example.co.uk',
      status: CustomerStatus.ACTIVE,
    });

    await context.prisma.admin.create({
      data: {
        email: 'support.dashboard@patrol.test',
        passwordHash: await bcrypt.hash(adminPassword, 10),
        displayName: 'Support Dashboard',
        role: AdminRole.SUPPORT,
        isActive: true,
      },
    });

    const token = await loginAs('support.dashboard@patrol.test');
    const response = await request(app.getHttpServer())
      .get('/admin/dashboard')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body.kpis).toBeDefined();
    expect(response.body.renewalQueue).toBeDefined();
    expect(response.body.recentActivity).toBeDefined();
    expect(response.body.notificationHealth).toBeDefined();
    expect(response.body.revenue).toBeUndefined();
    expect(Object.keys(response.body).sort()).toEqual([
      'generatedAt',
      'kpis',
      'notificationHealth',
      'recentActivity',
      'renewalQueue',
    ]);
  });
});
