import { BillingInterval } from '@prisma/client';

/** Provider-agnostic checkout creation input (internal IDs only). */
export interface CreateCheckoutSessionInput {
  organisationId: string;
  stripeCustomerId: string;
  stripePriceId: string;
  successUrl: string;
  cancelUrl: string;
  clientReferenceId: string;
  idempotencyKey: string;
  metadata: Record<string, string>;
  trialPeriodDays?: number;
}

export interface CheckoutSessionResult {
  providerSessionId: string;
  url: string;
  expiresAt: Date | null;
  livemode: boolean;
  status: string;
}

export interface ProviderCustomerResult {
  providerCustomerId: string;
  livemode: boolean;
  email: string | null;
}

export interface ProviderSubscriptionResult {
  providerSubscriptionId: string;
  providerCustomerId: string;
  status: string;
  livemode: boolean;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  cancelledAt: Date | null;
  latestInvoiceId: string | null;
  priceId: string | null;
}

export interface ProviderInvoiceResult {
  providerInvoiceId: string;
  providerCustomerId: string | null;
  providerSubscriptionId: string | null;
  status: string;
  amountDue: number;
  amountPaid: number;
  currency: string;
  livemode: boolean;
  paymentIntentId: string | null;
  hostedInvoiceUrl: string | null;
}

export interface ProviderPriceValidation {
  stripePriceId: string;
  stripeProductId: string;
  active: boolean;
  currency: string;
  unitAmount: number;
  interval: BillingInterval | null;
  livemode: boolean;
}

export interface BillingPortalSessionResult {
  url: string;
}

export interface VerifiedWebhookEvent {
  id: string;
  type: string;
  apiVersion: string | null;
  livemode: boolean;
  created: number;
  dataObject: Record<string, unknown>;
  rawType: string;
}

export interface ProviderPaymentMethodSummary {
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  isDefault: boolean;
}

/**
 * Payment provider port. Billing Domain depends on this interface — never on Stripe SDK.
 */
export interface PaymentProviderPort {
  readonly name: string;

  isEnabled(): boolean;

  getMode(): 'TEST' | 'LIVE' | 'DISABLED';

  createCheckoutSession(input: CreateCheckoutSessionInput): Promise<CheckoutSessionResult>;

  createPaymentCheckoutSession(input: {
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
  }): Promise<CheckoutSessionResult>;

  retrieveCheckoutSession(sessionId: string): Promise<CheckoutSessionResult & {
    metadata: Record<string, string>;
    subscriptionId: string | null;
    customerId: string | null;
    paymentStatus: string | null;
    amountTotal: number | null;
  }>;

  retrieveCustomer(customerId: string): Promise<ProviderCustomerResult>;

  createCustomer(input: {
    email: string;
    name: string;
    metadata: Record<string, string>;
    idempotencyKey: string;
  }): Promise<ProviderCustomerResult>;

  retrieveSubscription(subscriptionId: string): Promise<ProviderSubscriptionResult>;

  updateSubscriptionPrice(input: {
    stripeSubscriptionId: string;
    stripePriceId: string;
    prorationBehavior: 'none' | 'create_prorations' | 'always_invoice';
    idempotencyKey: string;
  }): Promise<ProviderSubscriptionResult>;

  setSubscriptionCancelAtPeriodEnd(input: {
    stripeSubscriptionId: string;
    cancelAtPeriodEnd: boolean;
    idempotencyKey: string;
  }): Promise<ProviderSubscriptionResult>;

  cancelSubscriptionNow(input: {
    stripeSubscriptionId: string;
    idempotencyKey: string;
  }): Promise<ProviderSubscriptionResult>;

  retrieveDefaultPaymentMethod(stripeCustomerId: string): Promise<ProviderPaymentMethodSummary | null>;

  retrieveInvoice(invoiceId: string): Promise<ProviderInvoiceResult>;

  retrievePrice(priceId: string): Promise<ProviderPriceValidation>;

  createBillingPortalSession(input: {
    stripeCustomerId: string;
    returnUrl: string;
    flow?: 'payment_method_update';
  }): Promise<BillingPortalSessionResult>;

  verifyWebhookSignature(rawBody: Buffer, signature: string): VerifiedWebhookEvent;

  mapProviderSubscriptionStatus(status: string): string;
}
