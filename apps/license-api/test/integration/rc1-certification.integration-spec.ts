import { INestApplication, ValidationPipe } from '@nestjs/common';
import {
  BillingInterval,
  LicenseStatus,
  ScheduledPlanChangeType,
  SubscriptionStatus,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { SubscriptionsService } from '@/billing/subscriptions/subscriptions.service';
import { EmailProvider } from '@/notifications/providers/email.provider';
import {
  closeIntegrationContext,
  createIntegrationContext,
  createTestCustomer,
  type IntegrationContext,
} from './integration-harness';

/**
 * RC1 certification: billing domain lifecycle (Stripe webhook path simulated via provider commands).
 * Licence file issuance on activation is asserted; plan-change licence regeneration is covered by
 * unit tests on LicenceBillingSyncHandler (EventBus delivery is best-effort in-process).
 */
describe('RC1 certification scenarios', () => {
  let context: IntegrationContext;
  let app: INestApplication;
  let adminToken: string;
  let subscriptions: SubscriptionsService;
  let starterId: string;
  let professionalId: string;

  beforeAll(async () => {
    context = await createIntegrationContext();
    app = context.module.createNestApplication({ rawBody: true });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    subscriptions = context.module.get(SubscriptionsService);

    jest.spyOn(context.module.get(EmailProvider), 'send').mockResolvedValue({
      success: true,
      providerMessageId: 'mock-smtp-rc1',
    });

    const login = await request(app.getHttpServer())
      .post('/admin/auth/login')
      .send({ email: context.admin.email, password: 'IntegrationTestPass123!' });
    expect([200, 201]).toContain(login.status);
    adminToken = login.body.tokens.accessToken;

    starterId = (await context.prisma.plan.findUniqueOrThrow({ where: { code: 'STARTER' } })).id;
    professionalId = (
      await context.prisma.plan.findUniqueOrThrow({ where: { code: 'PROFESSIONAL' } })
    ).id;
  }, 120_000);

  afterAll(async () => {
    jest.restoreAllMocks();
    if (app) await app.close();
    if (context) await closeIntegrationContext(context);
  });

  async function seedOrg(prefix: string) {
    const org = await createTestCustomer(context.prisma, {
      email: `${prefix}@rc1.test`,
      companyName: `${prefix} Security Ltd`,
    });
    const passwordHash = await bcrypt.hash('Rc1OwnerPass123!', 10);
    await context.prisma.customerUser.create({
      data: {
        customerId: org.id,
        email: `owner@${prefix}.test`,
        passwordHash,
        displayName: 'Owner',
        role: 'OWNER',
        emailVerifiedAt: new Date(),
        isActive: true,
      },
    });
    const owner = await context.prisma.customerUser.findFirstOrThrow({
      where: { customerId: org.id },
    });
    await context.prisma.organisationInvitation.create({
      data: {
        customerId: org.id,
        email: `admin@${prefix}.test`,
        role: 'ADMINISTRATOR',
        tokenHash: `hash-${prefix}-${Date.now()}`,
        invitedByUserId: owner.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        status: 'PENDING',
      },
    });
    const login = await request(app.getHttpServer())
      .post('/customer/auth/login')
      .send({ email: `owner@${prefix}.test`, password: 'Rc1OwnerPass123!' });
    expect([200, 201]).toContain(login.status);
    return { org, customerToken: login.body.tokens.accessToken as string };
  }

  it('certifies scenarios 1–5 and support ops', async () => {
    // Scenario 1: trial purchase → webhook activate → licence → download → renew
    {
      const { org, customerToken } = await seedOrg('rc1-s1');
      const createSub = await request(app.getHttpServer())
        .post('/admin/billing/subscriptions')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          organisationId: org.id,
          planId: starterId,
          billingInterval: BillingInterval.MONTHLY,
          startTrial: true,
        });
      expect([200, 201]).toContain(createSub.status);
      const subscriptionId = createSub.body.id as string;
      await context.prisma.subscription.update({
        where: { id: subscriptionId },
        data: { pendingCheckout: true },
      });

      await subscriptions.activateFromProvider(subscriptionId, {
        actorAdminId: context.admin.id,
      });
      const licence = await context.prisma.licence.findFirstOrThrow({
        where: { customerId: org.id },
      });
      expect(licence.status).toBe(LicenseStatus.ACTIVE);

      const download = await request(app.getHttpServer())
        .get(`/customer/licences/${licence.id}/download`)
        .set('Authorization', `Bearer ${customerToken}`);
      expect([200, 201]).toContain(download.status);

      await subscriptions.renewFromProvider(subscriptionId, {
        actorAdminId: context.admin.id,
      });
      expect(
        (await context.prisma.subscription.findUniqueOrThrow({ where: { id: subscriptionId } }))
          .status,
      ).toBe(SubscriptionStatus.ACTIVE);
      expect(
        await context.prisma.auditLog.count({ where: { customerId: org.id } }),
      ).toBeGreaterThan(0);
    }

    // Scenario 2: payment failure → grace → recovery
    {
      const { org } = await seedOrg('rc1-s2');
      const sub = await context.prisma.subscription.create({
        data: {
          organisationId: org.id,
          planId: starterId,
          status: SubscriptionStatus.ACTIVE,
          billingInterval: BillingInterval.MONTHLY,
          autoRenew: true,
          startedAt: new Date(),
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          nextBillingDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });
      await subscriptions.activateFromProvider(sub.id, { actorAdminId: context.admin.id });
      await subscriptions.markPastDue(sub.id, 'rc1.payment_failed');
      expect(
        (await context.prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } })).status,
      ).toBe(SubscriptionStatus.PAST_DUE);
      expect(
        (await context.prisma.licence.findFirstOrThrow({ where: { customerId: org.id } })).status,
      ).toBe(LicenseStatus.ACTIVE);

      await subscriptions.renewFromProvider(sub.id, { actorAdminId: context.admin.id });
      expect(
        (await context.prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } })).status,
      ).toBe(SubscriptionStatus.ACTIVE);
    }

    // Scenario 3: upgrade
    {
      const { org } = await seedOrg('rc1-s3');
      const sub = await context.prisma.subscription.create({
        data: {
          organisationId: org.id,
          planId: starterId,
          status: SubscriptionStatus.ACTIVE,
          billingInterval: BillingInterval.MONTHLY,
          autoRenew: true,
          startedAt: new Date(),
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          nextBillingDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });
      await subscriptions.activateFromProvider(sub.id, { actorAdminId: context.admin.id });
      await subscriptions.applyCustomerPlanChange(sub.id, {
        planId: professionalId,
        billingInterval: BillingInterval.MONTHLY,
        reason: 'rc1.upgrade',
      });
      const updated = await context.prisma.subscription.findUniqueOrThrow({
        where: { id: sub.id },
        include: { plan: true },
      });
      expect(updated.planId).toBe(professionalId);
      expect(updated.plan.maxDevices).toBe(10);
      expect(
        await context.prisma.auditLog.count({
          where: { entityId: sub.id, action: 'billing.subscription_plan_changed' },
        }),
      ).toBeGreaterThan(0);
    }

    // Scenario 4: scheduled downgrade applied on renewal
    {
      const { org } = await seedOrg('rc1-s4');
      const sub = await context.prisma.subscription.create({
        data: {
          organisationId: org.id,
          planId: professionalId,
          status: SubscriptionStatus.ACTIVE,
          billingInterval: BillingInterval.MONTHLY,
          autoRenew: true,
          startedAt: new Date(),
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          nextBillingDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          pendingPlanId: starterId,
          pendingBillingInterval: BillingInterval.MONTHLY,
          scheduledChangeType: ScheduledPlanChangeType.DOWNGRADE,
          planChangeEffectiveAt: new Date(Date.now() - 60_000),
        },
      });
      await subscriptions.renewFromProvider(sub.id, { actorAdminId: context.admin.id });
      const updated = await context.prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } });
      expect(updated.planId).toBe(starterId);
      expect(updated.pendingPlanId).toBeNull();
      expect(updated.status).toBe(SubscriptionStatus.ACTIVE);
    }

    // Scenario 5: cancel at period end → expire
    {
      const { org } = await seedOrg('rc1-s5');
      const sub = await context.prisma.subscription.create({
        data: {
          organisationId: org.id,
          planId: starterId,
          status: SubscriptionStatus.ACTIVE,
          billingInterval: BillingInterval.MONTHLY,
          autoRenew: true,
          startedAt: new Date(),
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          nextBillingDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });
      await subscriptions.activateFromProvider(sub.id, { actorAdminId: context.admin.id });
      await subscriptions.cancelFromCustomer(sub.id, {
        atPeriodEnd: true,
        reason: 'rc1.cancel',
      });
      expect(
        (await context.prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } }))
          .cancelAtPeriodEnd,
      ).toBe(true);
      expect(
        (await context.prisma.licence.findFirstOrThrow({ where: { customerId: org.id } })).status,
      ).toBe(LicenseStatus.ACTIVE);

      await subscriptions.expire(context.adminActor, sub.id);
      expect(
        (await context.prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } })).status,
      ).toBe(SubscriptionStatus.EXPIRED);
      expect(
        await context.prisma.auditLog.count({
          where: { entityId: sub.id, action: 'billing.subscription_expired' },
        }),
      ).toBeGreaterThan(0);
    }

    // Support ops
    {
      const { org } = await seedOrg('rc1-support');
      const sub = await context.prisma.subscription.create({
        data: {
          organisationId: org.id,
          planId: starterId,
          status: SubscriptionStatus.PAST_DUE,
          billingInterval: BillingInterval.MONTHLY,
          autoRenew: false,
          pendingCheckout: true,
          cancelAtPeriodEnd: true,
          startedAt: new Date(),
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          nextBillingDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });
      await subscriptions.activateFromProvider(sub.id, { actorAdminId: context.admin.id });

      const unlock = await request(app.getHttpServer())
        .post('/admin/support/accounts/unlock')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          accountType: 'customer',
          email: 'owner@rc1-support.test',
          reactivate: true,
        });
      expect([200, 201]).toContain(unlock.status);

      const reset = await request(app.getHttpServer())
        .post(`/admin/support/organisations/${org.id}/reset-state`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          clearPendingCheckout: true,
          clearCancellation: true,
          clearPastDue: true,
          clearScheduledPlanChange: true,
        });
      expect([200, 201]).toContain(reset.status);

      const rebuilt = await request(app.getHttpServer())
        .post('/admin/support/licences/rebuild')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ subscriptionId: sub.id });
      expect([200, 201]).toContain(rebuilt.status);
      expect(rebuilt.body.licenceId).toBeTruthy();
    }
  }, 300_000);
});
