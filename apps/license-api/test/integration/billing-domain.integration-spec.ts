import { INestApplication, ValidationPipe } from '@nestjs/common';
import { BillingInterval, ManualPaymentMethod, SubscriptionStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import {
  closeIntegrationContext,
  createIntegrationContext,
  createTestCustomer,
  type IntegrationContext,
} from './integration-harness';
import { DOMAIN_EVENTS } from '@/domain-events/domain-event.types';
import { EventBus } from '@/domain-events/event-bus.service';

describe('Billing domain integration (Phase 4C)', () => {
  let context: IntegrationContext;
  let app: INestApplication;
  let accessToken: string;
  let supportToken: string;
  let published: string[];

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

    const login = await request(app.getHttpServer())
      .post('/admin/auth/login')
      .send({ email: context.admin.email, password: 'IntegrationTestPass123!' });
    expect([200, 201]).toContain(login.status);
    accessToken = login.body.tokens.accessToken;

    const passwordHash = await bcrypt.hash('IntegrationTestPass123!', 10);
    await context.prisma.admin.create({
      data: {
        email: 'support.billing@patrol.test',
        passwordHash,
        displayName: 'Support',
        role: 'SUPPORT',
        isActive: true,
      },
    });
    const supportLogin = await request(app.getHttpServer())
      .post('/admin/auth/login')
      .send({ email: 'support.billing@patrol.test', password: 'IntegrationTestPass123!' });
    expect([200, 201]).toContain(supportLogin.status);
    supportToken = supportLogin.body.tokens.accessToken;
  }, 120_000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (context) {
      await closeIntegrationContext(context);
    }
  });

  beforeEach(() => {
    published = [];
    const eventBus = context.module.get(EventBus);
    const original = eventBus.publish.bind(eventBus);
    jest.spyOn(eventBus, 'publish').mockImplementation(async (event) => {
      published.push(event.type);
      return original(event);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('manages plans, subscriptions, invoices, manual payments, and isolates organisations', async () => {
    const customerA = await createTestCustomer(context.prisma, {
      companyName: 'Billing A Ltd',
      email: 'billing-a@example.co.uk',
    });
    const customerB = await createTestCustomer(context.prisma, {
      companyName: 'Billing B Ltd',
      email: 'billing-b@example.co.uk',
    });

    const plansRes = await request(app.getHttpServer())
      .get('/admin/billing/plans')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(plansRes.body.total).toBeGreaterThanOrEqual(3);
    const starter = plansRes.body.items.find((p: { code: string }) => p.code === 'STARTER');
    expect(starter).toBeDefined();

    const createSub = await request(app.getHttpServer())
      .post('/admin/billing/subscriptions')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        organisationId: customerA.id,
        planId: starter.id,
        startTrial: false,
        billingInterval: BillingInterval.MONTHLY,
      });
    expect([200, 201]).toContain(createSub.status);
    expect(createSub.body.status).toBe(SubscriptionStatus.ACTIVE);
    expect(published).toEqual(
      expect.arrayContaining([
        DOMAIN_EVENTS.SubscriptionCreated,
        DOMAIN_EVENTS.SubscriptionActivated,
        DOMAIN_EVENTS.InvoiceCreated,
      ]),
    );

    const invoicesA = await request(app.getHttpServer())
      .get(`/admin/billing/invoices?organisationId=${customerA.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(invoicesA.body.total).toBe(1);
    const invoiceId = invoicesA.body.items[0].id;

    const payment = await request(app.getHttpServer())
      .post('/admin/billing/payments/manual')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        invoiceId,
        amount: invoicesA.body.items[0].total,
        method: ManualPaymentMethod.BANK_TRANSFER,
        providerReference: 'BT-100',
        notes: 'Wire received',
      });
    expect([200, 201]).toContain(payment.status);

    expect(published).toEqual(
      expect.arrayContaining([
        DOMAIN_EVENTS.PaymentSucceeded,
        DOMAIN_EVENTS.ManualPaymentRecorded,
        DOMAIN_EVENTS.InvoicePaid,
      ]),
    );

    const invoicesB = await request(app.getHttpServer())
      .get(`/admin/billing/invoices?organisationId=${customerB.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(invoicesB.body.total).toBe(0);

    await request(app.getHttpServer())
      .post('/admin/billing/payments/manual')
      .set('Authorization', `Bearer ${supportToken}`)
      .send({
        invoiceId,
        amount: 100,
        method: ManualPaymentMethod.CASH,
      })
      .expect(403);

    const dashboard = await request(app.getHttpServer())
      .get('/admin/dashboard')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(dashboard.body.billing).toBeDefined();
    expect(dashboard.body.billing.activeSubscriptions).toBeGreaterThanOrEqual(1);

    const csv = await request(app.getHttpServer())
      .get('/admin/exports/subscriptions.csv')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(csv.text).toContain('organisationName');
    expect(csv.text).toContain('Billing A Ltd');

    const cancel = await request(app.getHttpServer())
      .post(`/admin/billing/subscriptions/${createSub.body.id}/cancel`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ atPeriodEnd: false });
    expect([200, 201]).toContain(cancel.status);
    expect(published).toContain(DOMAIN_EVENTS.SubscriptionCancelled);
  }, 120_000);
});
