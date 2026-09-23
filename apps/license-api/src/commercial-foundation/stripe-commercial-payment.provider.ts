import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { ApiException } from '@/common/exceptions/api.exception';
import { ERROR_CODES } from '@/common/constants/error-codes';
import { CommercialConfigService } from './commercial-config.service';
import type {
  CommercialCheckoutSnapshot,
  CommercialPaymentProvider,
  CommercialPaymentSnapshot,
  CreateCommercialCheckoutCommand,
  VerifiedCommercialProviderEvent,
} from './commercial-payment-provider.port';

@Injectable()
export class StripeCommercialPaymentProvider implements CommercialPaymentProvider {
  readonly name = 'STRIPE' as const;
  private readonly logger = new Logger(StripeCommercialPaymentProvider.name);
  private client: Stripe | null = null;

  constructor(private readonly commercialConfig: CommercialConfigService) {}

  getMode(): 'TEST' | 'DISABLED' {
    const config = this.commercialConfig.getStripeTestConfig();
    return config.enabled && config.secretKey?.startsWith('sk_test_') ? 'TEST' : 'DISABLED';
  }

  async createCheckout(command: Readonly<CreateCommercialCheckoutCommand>): Promise<CommercialCheckoutSnapshot> {
    const stripe = this.getStripe();
    const config = this.commercialConfig.assertStripeTestReady();
    const policy = this.commercialConfig.getPolicy();
    if (
      command.productDisplayName !== policy.displayName
      || command.amountMinor !== policy.amountMinor
      || command.currency !== policy.currency
    ) {
      throw new ApiException(
        ERROR_CODES.COMMERCIAL_CHECKOUT_FAILED,
        'Commercial Checkout does not match the server-owned product policy.',
        409,
      );
    }

    const price = await stripe.prices.retrieve(config.priceId!, { expand: ['product'] });
    const productId = typeof price.product === 'string' ? price.product : price.product.id;
    const productActive = typeof price.product !== 'string'
      && !('deleted' in price.product)
      && price.product.active;
    const productName = typeof price.product !== 'string' && !('deleted' in price.product)
      ? price.product.name
      : null;
    if (
      price.livemode
      || !price.active
      || !productActive
      || price.type !== 'one_time'
      || price.recurring !== null
      || price.currency.toUpperCase() !== policy.currency
      || price.unit_amount !== policy.amountMinor
      || price.tax_behavior !== config.priceTaxBehavior
      || price.lookup_key !== config.priceLookupKey
      || productId !== config.productId
      || productName !== policy.displayName
    ) {
      throw new ApiException(
        ERROR_CODES.COMMERCIAL_STRIPE_NOT_CONFIGURED,
        'Configured Stripe sandbox Product/Price does not match the server-owned commercial policy.',
        503,
      );
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_creation: 'always',
      customer_email: command.customerEmail,
      client_reference_id: command.publicOrderId,
      success_url: command.successUrl,
      cancel_url: command.cancelUrl,
      billing_address_collection: 'required',
      tax_id_collection: { enabled: false },
      automatic_tax: { enabled: false },
      invoice_creation: { enabled: false },
      allow_promotion_codes: false,
      metadata: { ...command.metadata },
      payment_intent_data: { metadata: { ...command.metadata } },
      line_items: [{
        quantity: 1,
        price: config.priceId!,
      }],
    }, { idempotencyKey: command.commandId });
    if (!session.url) {
      throw new ApiException(ERROR_CODES.COMMERCIAL_CHECKOUT_FAILED, 'Stripe Checkout did not return a redirect URL.', 502);
    }
    return this.mapCheckout(session);
  }

  async retrieveCheckout(providerSessionId: string): Promise<CommercialCheckoutSnapshot> {
    return this.mapCheckout(await this.getStripe().checkout.sessions.retrieve(providerSessionId));
  }

  async retrievePayment(paymentIntentId: string): Promise<CommercialPaymentSnapshot> {
    const intent = await this.getStripe().paymentIntents.retrieve(paymentIntentId, { expand: ['latest_charge'] });
    const charge = typeof intent.latest_charge === 'object' ? intent.latest_charge : null;
    return {
      paymentIntentId: intent.id,
      livemode: Boolean(intent.livemode),
      status: intent.status,
      amount: intent.amount,
      amountReceived: intent.amount_received,
      amountRefunded: charge?.amount_refunded ?? 0,
      currency: intent.currency.toUpperCase(),
      providerCustomerId: typeof intent.customer === 'string' ? intent.customer : intent.customer?.id ?? null,
      publicOrderId: intent.metadata?.commercial_order_ref ?? null,
    };
  }

  verifyWebhook(rawBody: Buffer, signature: string): VerifiedCommercialProviderEvent {
    const config = this.commercialConfig.assertStripeTestReady();
    let event: Stripe.Event;
    try {
      event = this.getStripe().webhooks.constructEvent(rawBody, signature, config.webhookSecret!);
    } catch {
      this.logger.warn('Commercial Stripe webhook signature verification failed.');
      throw new ApiException(ERROR_CODES.COMMERCIAL_WEBHOOK_INVALID, 'Stripe webhook signature is invalid.', 400);
    }
    return this.normalizeEvent(event);
  }

  private getStripe(): Stripe {
    const config = this.commercialConfig.assertStripeTestReady();
    if (!this.client) {
      this.client = new Stripe(config.secretKey!, {
        apiVersion: config.apiVersion as Stripe.LatestApiVersion,
        typescript: true,
      });
    }
    return this.client;
  }

  private mapCheckout(session: Stripe.Checkout.Session): CommercialCheckoutSnapshot {
    return {
      providerSessionId: session.id,
      url: session.url ?? null,
      expiresAt: session.expires_at ? new Date(session.expires_at * 1000) : null,
      livemode: Boolean(session.livemode),
      status: session.status ?? 'unknown',
      paymentStatus: session.payment_status ?? null,
      paymentIntentId: typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id ?? null,
      providerCustomerId: typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null,
      amountTotal: session.amount_total ?? null,
      currency: session.currency?.toUpperCase() ?? null,
      publicOrderId: session.metadata?.commercial_order_ref ?? session.client_reference_id ?? null,
    };
  }

  private normalizeEvent(event: Stripe.Event): VerifiedCommercialProviderEvent {
    const object = event.data.object as unknown as Record<string, unknown>;
    const metadata = this.stringRecord(object.metadata);
    const objectType = typeof object.object === 'string' ? object.object : null;
    const objectId = typeof object.id === 'string' ? object.id : null;
    const checkoutSessionId = objectType === 'checkout.session' ? objectId : null;
    const paymentIntentId = objectType === 'payment_intent'
      ? objectId
      : this.externalId(object.payment_intent);
    return {
      providerEventId: event.id,
      type: event.type,
      livemode: Boolean(event.livemode),
      createdAt: new Date(event.created * 1000),
      objectId,
      objectType,
      publicOrderId: metadata.commercial_order_ref ?? this.optionalString(object.client_reference_id),
      checkoutSessionId,
      paymentIntentId,
      providerCustomerId: this.externalId(object.customer),
      status: this.optionalString(object.status),
      paymentStatus: this.optionalString(object.payment_status),
      amountMinor: this.optionalNumber(object.amount_total) ?? this.optionalNumber(object.amount),
      currency: this.optionalString(object.currency)?.toUpperCase() ?? null,
    };
  }

  private stringRecord(value: unknown): Record<string, string> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  }

  private externalId(value: unknown): string | null {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object' && 'id' in value && typeof value.id === 'string') return value.id;
    return null;
  }

  private optionalString(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
  }

  private optionalNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
  }
}
