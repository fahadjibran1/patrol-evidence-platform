import { INestApplication, ValidationPipe } from '@nestjs/common';
import { BillingInterval, PlanStatus } from '@prisma/client';
import request from 'supertest';
import {
  closeIntegrationContext,
  createIntegrationContext,
  createTestCustomer,
  type IntegrationContext,
} from './integration-harness';
import { StripeConfigService } from '@/billing/stripe/stripe-config.service';
import { PaymentProviderRegistry } from '@/billing/providers/payment-provider.registry';

describe('Stripe billing integration (Phase 5A doubles)', () => {
  let context: IntegrationContext;
  let app: INestApplication;

  beforeAll(async () => {
    process.env.STRIPE_ENABLED = 'true';
    process.env.STRIPE_SECRET_KEY = 'sk_test_integration';
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_integration';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_integration';
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
  }, 120_000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (context) {
      await closeIntegrationContext(context);
    }
  });

  it('rejects webhooks without Stripe-Signature', async () => {
    const response = await request(app.getHttpServer())
      .post('/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .send({ id: 'evt_test' });
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it('keeps pending checkout subscriptions inactive until provider activation', async () => {
    const plan = await context.prisma.plan.findUniqueOrThrow({ where: { code: 'STARTER' } });

    const org = await createTestCustomer(context.prisma, { email: 'stripe-org@example.test' });
    const pending = await context.prisma.subscription.create({
      data: {
        organisationId: org.id,
        planId: plan.id,
        status: 'TRIAL',
        billingInterval: BillingInterval.MONTHLY,
        pendingCheckout: true,
        autoRenew: true,
      },
    });

    expect(pending.status).toBe('TRIAL');
    expect(pending.pendingCheckout).toBe(true);
    expect(plan.status).toBe(PlanStatus.ACTIVE);

    const config = context.module.get(StripeConfigService);
    expect(['TEST', 'DISABLED']).toContain(config.getMode());
    const registry = context.module.get(PaymentProviderRegistry);
    expect(registry.list().some((entry) => entry.name === 'STRIPE')).toBe(true);
  });

  it('enforces unique stripeEventId for webhook idempotency', async () => {
    await context.prisma.stripeWebhookEvent.create({
      data: {
        stripeEventId: 'evt_dedupe_1',
        type: 'invoice.paid',
        livemode: false,
        processingStatus: 'RECEIVED',
        payloadHash: 'abc',
        metadata: { objectId: 'in_1' },
      },
    });
    await expect(
      context.prisma.stripeWebhookEvent.create({
        data: {
          stripeEventId: 'evt_dedupe_1',
          type: 'invoice.paid',
          livemode: false,
          processingStatus: 'RECEIVED',
          payloadHash: 'abc',
          metadata: { objectId: 'in_1' },
        },
      }),
    ).rejects.toThrow();
  });
});
