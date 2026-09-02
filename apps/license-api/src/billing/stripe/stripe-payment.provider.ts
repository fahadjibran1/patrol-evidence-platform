import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { BillingInterval } from '@prisma/client';
import { ApiException } from '@/common/exceptions/api.exception';
import { ERROR_CODES } from '@/common/constants/error-codes';
import { StripeConfigService } from './stripe-config.service';
import type {
  BillingPortalSessionResult,
  CheckoutSessionResult,
  CreateCheckoutSessionInput,
  PaymentProviderPort,
  ProviderCustomerResult,
  ProviderInvoiceResult,
  ProviderPriceValidation,
  ProviderSubscriptionResult,
  VerifiedWebhookEvent,
} from '../providers/payment-provider.port';

@Injectable()
export class StripePaymentProvider implements PaymentProviderPort {
  readonly name = 'STRIPE';
  private readonly logger = new Logger(StripePaymentProvider.name);
  private client: Stripe | null = null;

  constructor(private readonly stripeConfig: StripeConfigService) {}

  isEnabled(): boolean {
    return this.stripeConfig.getConfig().enabled && Boolean(this.stripeConfig.getConfig().secretKey);
  }

  getMode(): 'TEST' | 'LIVE' | 'DISABLED' {
    return this.stripeConfig.getMode();
  }

  private getStripe(): Stripe {
    const cfg = this.stripeConfig.assertReadyForCheckout();
    if (!this.client) {
      this.client = new Stripe(cfg.secretKey!, {
        apiVersion: cfg.apiVersion as Stripe.LatestApiVersion,
        typescript: true,
      });
    }
    return this.client;
  }

  async createCheckoutSession(input: CreateCheckoutSessionInput): Promise<CheckoutSessionResult> {
    const stripe = this.getStripe();
    const session = await stripe.checkout.sessions.create(
      {
        mode: 'subscription',
        customer: input.stripeCustomerId,
        line_items: [{ price: input.stripePriceId, quantity: 1 }],
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        client_reference_id: input.clientReferenceId,
        metadata: input.metadata,
        subscription_data: {
          metadata: input.metadata,
          ...(input.trialPeriodDays && input.trialPeriodDays > 0
            ? { trial_period_days: input.trialPeriodDays }
            : {}),
        },
        allow_promotion_codes: false,
      },
      { idempotencyKey: input.idempotencyKey },
    );

    if (!session.url) {
      throw new ApiException(ERROR_CODES.STRIPE_CHECKOUT_FAILED, 'Checkout session missing URL', 502);
    }

    return {
      providerSessionId: session.id,
      url: session.url,
      expiresAt: session.expires_at ? new Date(session.expires_at * 1000) : null,
      livemode: Boolean(session.livemode),
      status: session.status ?? 'open',
    };
  }

  async retrieveCheckoutSession(sessionId: string) {
    const session = await this.getStripe().checkout.sessions.retrieve(sessionId);
    return {
      providerSessionId: session.id,
      url: session.url ?? '',
      expiresAt: session.expires_at ? new Date(session.expires_at * 1000) : null,
      livemode: Boolean(session.livemode),
      status: session.status ?? 'open',
      metadata: (session.metadata ?? {}) as Record<string, string>,
      subscriptionId: typeof session.subscription === 'string'
        ? session.subscription
        : session.subscription?.id ?? null,
      customerId: typeof session.customer === 'string'
        ? session.customer
        : session.customer?.id ?? null,
      paymentStatus: session.payment_status ?? null,
      amountTotal: session.amount_total ?? null,
    };
  }

  async createPaymentCheckoutSession(input: {
    organisationId: string;
    stripeCustomerId: string;
    amountMinor: number;
    currency: string;
    description: string;
    successUrl: string;
    cancelUrl: string;
    clientReferenceId: string;
    idempotencyKey: string;
    metadata: Record<string, string>;
  }): Promise<CheckoutSessionResult> {
    const stripe = this.getStripe();
    const session = await stripe.checkout.sessions.create(
      {
        mode: 'payment',
        customer: input.stripeCustomerId,
        client_reference_id: input.clientReferenceId,
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        metadata: input.metadata,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: input.currency.toLowerCase(),
              unit_amount: input.amountMinor,
              product_data: {
                name: input.description,
              },
            },
          },
        ],
        allow_promotion_codes: false,
      },
      { idempotencyKey: input.idempotencyKey },
    );
    if (!session.url) {
      throw new ApiException(ERROR_CODES.STRIPE_CHECKOUT_FAILED, 'Checkout session missing URL', 502);
    }
    return {
      providerSessionId: session.id,
      url: session.url,
      expiresAt: session.expires_at ? new Date(session.expires_at * 1000) : null,
      livemode: Boolean(session.livemode),
      status: session.status ?? 'open',
    };
  }

  async retrieveCustomer(customerId: string): Promise<ProviderCustomerResult> {
    const customer = await this.getStripe().customers.retrieve(customerId);
    if (customer.deleted) {
      throw new ApiException(ERROR_CODES.STRIPE_CUSTOMER_NOT_FOUND, 'Stripe customer deleted', 404);
    }
    return {
      providerCustomerId: customer.id,
      livemode: Boolean(customer.livemode),
      email: customer.email ?? null,
    };
  }

  async createCustomer(input: {
    email: string;
    name: string;
    metadata: Record<string, string>;
    idempotencyKey: string;
  }): Promise<ProviderCustomerResult> {
    const customer = await this.getStripe().customers.create(
      {
        email: input.email,
        name: input.name,
        metadata: input.metadata,
      },
      { idempotencyKey: input.idempotencyKey },
    );
    return {
      providerCustomerId: customer.id,
      livemode: Boolean(customer.livemode),
      email: customer.email ?? null,
    };
  }

  async retrieveSubscription(subscriptionId: string): Promise<ProviderSubscriptionResult> {
    const sub = await this.getStripe().subscriptions.retrieve(subscriptionId);
    return this.mapSubscription(sub);
  }

  async updateSubscriptionPrice(input: {
    stripeSubscriptionId: string;
    stripePriceId: string;
    prorationBehavior: 'none' | 'create_prorations' | 'always_invoice';
    idempotencyKey: string;
  }): Promise<ProviderSubscriptionResult> {
    const stripe = this.getStripe();
    const existing = await stripe.subscriptions.retrieve(input.stripeSubscriptionId);
    const itemId = existing.items.data[0]?.id;
    if (!itemId) {
      throw new ApiException(ERROR_CODES.STRIPE_MAPPING_INVALID, 'Stripe subscription has no items', 502);
    }
    const sub = await stripe.subscriptions.update(
      input.stripeSubscriptionId,
      {
        items: [{ id: itemId, price: input.stripePriceId }],
        proration_behavior: input.prorationBehavior,
        metadata: existing.metadata ?? undefined,
      },
      { idempotencyKey: input.idempotencyKey },
    );
    return this.mapSubscription(sub);
  }

  async setSubscriptionCancelAtPeriodEnd(input: {
    stripeSubscriptionId: string;
    cancelAtPeriodEnd: boolean;
    idempotencyKey: string;
  }): Promise<ProviderSubscriptionResult> {
    const sub = await this.getStripe().subscriptions.update(
      input.stripeSubscriptionId,
      { cancel_at_period_end: input.cancelAtPeriodEnd },
      { idempotencyKey: input.idempotencyKey },
    );
    return this.mapSubscription(sub);
  }

  async cancelSubscriptionNow(input: {
    stripeSubscriptionId: string;
    idempotencyKey: string;
  }): Promise<ProviderSubscriptionResult> {
    const sub = await this.getStripe().subscriptions.cancel(
      input.stripeSubscriptionId,
      undefined,
      { idempotencyKey: input.idempotencyKey },
    );
    return this.mapSubscription(sub);
  }

  async retrieveDefaultPaymentMethod(stripeCustomerId: string) {
    const stripe = this.getStripe();
    const customer = await stripe.customers.retrieve(stripeCustomerId, {
      expand: ['invoice_settings.default_payment_method'],
    });
    if (customer.deleted) {
      return null;
    }
    const defaultPm = customer.invoice_settings?.default_payment_method;
    let pm =
      typeof defaultPm === 'object' && defaultPm && 'card' in defaultPm
        ? defaultPm
        : null;
    if (!pm) {
      const list = await stripe.paymentMethods.list({
        customer: stripeCustomerId,
        type: 'card',
        limit: 1,
      });
      pm = list.data[0] ?? null;
    }
    if (!pm || !('card' in pm) || !pm.card) {
      return null;
    }
    return {
      brand: pm.card.brand ?? null,
      last4: pm.card.last4 ?? null,
      expMonth: pm.card.exp_month ?? null,
      expYear: pm.card.exp_year ?? null,
      isDefault: true,
    };
  }

  async retrieveInvoice(invoiceId: string): Promise<ProviderInvoiceResult> {
    const invoice = await this.getStripe().invoices.retrieve(invoiceId);
    const paymentIntentId = typeof invoice.payment_intent === 'string'
      ? invoice.payment_intent
      : invoice.payment_intent?.id ?? null;
    return {
      providerInvoiceId: invoice.id,
      providerCustomerId: typeof invoice.customer === 'string'
        ? invoice.customer
        : invoice.customer?.id ?? null,
      providerSubscriptionId: typeof invoice.subscription === 'string'
        ? invoice.subscription
        : invoice.subscription?.id ?? null,
      status: invoice.status ?? 'unknown',
      amountDue: invoice.amount_due ?? 0,
      amountPaid: invoice.amount_paid ?? 0,
      currency: (invoice.currency ?? 'gbp').toUpperCase(),
      livemode: Boolean(invoice.livemode),
      paymentIntentId,
      hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
    };
  }

  async retrievePrice(priceId: string): Promise<ProviderPriceValidation> {
    const price = await this.getStripe().prices.retrieve(priceId);
    const interval = price.recurring?.interval;
    let mapped: BillingInterval | null = null;
    if (interval === 'month') {
      mapped = BillingInterval.MONTHLY;
    } else if (interval === 'year') {
      mapped = BillingInterval.ANNUAL;
    }
    return {
      stripePriceId: price.id,
      stripeProductId: typeof price.product === 'string' ? price.product : price.product.id,
      active: Boolean(price.active),
      currency: (price.currency ?? 'gbp').toUpperCase(),
      unitAmount: price.unit_amount ?? 0,
      interval: mapped,
      livemode: Boolean(price.livemode),
    };
  }

  async createBillingPortalSession(input: {
    stripeCustomerId: string;
    returnUrl: string;
    flow?: 'payment_method_update';
  }): Promise<BillingPortalSessionResult> {
    const session = await this.getStripe().billingPortal.sessions.create({
      customer: input.stripeCustomerId,
      return_url: input.returnUrl,
      ...(input.flow === 'payment_method_update'
        ? {
            flow_data: {
              type: 'payment_method_update',
            },
          }
        : {}),
    });
    return { url: session.url };
  }

  private mapSubscription(sub: Stripe.Subscription): ProviderSubscriptionResult {
    const priceId = sub.items.data[0]?.price?.id ?? null;
    return {
      providerSubscriptionId: sub.id,
      providerCustomerId: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
      status: sub.status,
      livemode: Boolean(sub.livemode),
      currentPeriodStart: sub.current_period_start
        ? new Date(sub.current_period_start * 1000)
        : null,
      currentPeriodEnd: sub.current_period_end ? new Date(sub.current_period_end * 1000) : null,
      cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
      cancelledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
      latestInvoiceId: typeof sub.latest_invoice === 'string'
        ? sub.latest_invoice
        : sub.latest_invoice?.id ?? null,
      priceId,
    };
  }

  verifyWebhookSignature(rawBody: Buffer, signature: string): VerifiedWebhookEvent {
    const cfg = this.stripeConfig.getConfig();
    if (!cfg.webhookSecret || !cfg.secretKey) {
      throw new ApiException(ERROR_CODES.STRIPE_WEBHOOK_INVALID, 'Stripe webhook not configured', 503);
    }
    const stripe = new Stripe(cfg.secretKey, {
      apiVersion: cfg.apiVersion as Stripe.LatestApiVersion,
    });
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, cfg.webhookSecret);
    } catch {
      this.logger.warn('Stripe webhook signature verification failed');
      throw new ApiException(ERROR_CODES.STRIPE_WEBHOOK_INVALID, 'Invalid Stripe signature', 400);
    }

    const dataObject = (event.data?.object ?? {}) as unknown as Record<string, unknown>;
    return {
      id: event.id,
      type: event.type,
      apiVersion: event.api_version ?? null,
      livemode: Boolean(event.livemode),
      created: event.created,
      dataObject,
      rawType: event.type,
    };
  }

  mapProviderSubscriptionStatus(status: string): string {
    switch (status) {
      case 'trialing':
        return 'TRIAL';
      case 'active':
        return 'ACTIVE';
      case 'past_due':
        return 'PAST_DUE';
      case 'canceled':
        return 'CANCELLED';
      case 'unpaid':
        return 'PAST_DUE';
      case 'incomplete':
      case 'incomplete_expired':
        return 'EXPIRED';
      default:
        return status.toUpperCase();
    }
  }
}
