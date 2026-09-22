export const COMMERCIAL_PAYMENT_PROVIDER = Symbol('COMMERCIAL_PAYMENT_PROVIDER');

export interface CreateCommercialCheckoutCommand {
  commandId: string;
  publicOrderId: string;
  customerEmail: string;
  customerName: string;
  productDisplayName: string;
  amountMinor: number;
  currency: string;
  successUrl: string;
  cancelUrl: string;
  metadata: Readonly<Record<string, string>>;
}

export interface CommercialCheckoutSnapshot {
  providerSessionId: string;
  url: string | null;
  expiresAt: Date | null;
  livemode: boolean;
  status: string;
  paymentStatus: string | null;
  paymentIntentId: string | null;
  providerCustomerId: string | null;
  amountTotal: number | null;
  currency: string | null;
  publicOrderId: string | null;
}

export interface CommercialPaymentSnapshot {
  paymentIntentId: string;
  livemode: boolean;
  status: string;
  amount: number;
  amountReceived: number;
  amountRefunded: number;
  currency: string;
  providerCustomerId: string | null;
  publicOrderId: string | null;
}

export interface VerifiedCommercialProviderEvent {
  providerEventId: string;
  type: string;
  livemode: boolean;
  createdAt: Date;
  objectId: string | null;
  objectType: string | null;
  publicOrderId: string | null;
  checkoutSessionId: string | null;
  paymentIntentId: string | null;
  providerCustomerId: string | null;
  status: string | null;
  paymentStatus: string | null;
  amountMinor: number | null;
  currency: string | null;
}

export interface CommercialPaymentProvider {
  readonly name: 'STRIPE';
  getMode(): 'TEST' | 'DISABLED';
  createCheckout(command: Readonly<CreateCommercialCheckoutCommand>): Promise<CommercialCheckoutSnapshot>;
  retrieveCheckout(providerSessionId: string): Promise<CommercialCheckoutSnapshot>;
  retrievePayment(paymentIntentId: string): Promise<CommercialPaymentSnapshot>;
  verifyWebhook(rawBody: Buffer, signature: string): VerifiedCommercialProviderEvent;
}
