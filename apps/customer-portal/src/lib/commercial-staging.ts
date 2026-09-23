import { ApiError, getApiBaseUrl } from './api';

export const PURCHASE_REFERENCE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const PUBLIC_ORDER_PATTERN = /^ord_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface CommercialPurchasePreview {
  publicOrderId: string;
  product: 'PatrolSafe Annual Licence';
  plan: 'annual';
  companyName: string;
  amountMinor: 29900;
  currency: 'GBP';
  maxDevices: 1;
  taxPolicy: string;
  expiresAt: string;
  orderState: string;
}

export interface CommercialCheckoutResponse {
  publicOrderId: string;
  checkoutUrl: string;
  amountMinor: 29900;
  currency: 'GBP';
  duplicate: boolean;
}

export function commercialStagingEnabled(): boolean {
  return import.meta.env.MODE === 'test'
    || (import.meta.env.VITE_COMMERCIAL_STAGING_ENABLED as string | undefined) === 'true';
}

export function validateOpaqueReference(value: string | undefined): string {
  if (!value || !PURCHASE_REFERENCE_PATTERN.test(value)) throw new Error('This purchase link is invalid.');
  return value;
}

export function validateStripeCheckoutUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('The secure checkout destination is invalid.'); }
  const testHarness = import.meta.env.MODE === 'test' && url.hostname === 'checkout.stripe.test';
  if (url.protocol !== 'https:' || url.username || url.password || (url.hostname !== 'checkout.stripe.com' && !testHarness)) {
    throw new Error('The secure checkout destination is not approved.');
  }
  return url.toString();
}

export function purchaseSessionKey(publicOrderId: string): string {
  if (!PUBLIC_ORDER_PATTERN.test(publicOrderId)) throw new Error('This order reference is invalid.');
  return `patrolsafe-commercial-reference:${publicOrderId}`;
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  const body = text ? JSON.parse(text) as { message?: string; code?: string } : {};
  if (!response.ok) throw new ApiError(body.message ?? 'The commercial licensing service is unavailable.', response.status, body.code);
  return body as T;
}

export async function inspectCommercialPurchase(reference: string): Promise<CommercialPurchasePreview> {
  const response = await fetch(`${getApiBaseUrl()}/commercial/purchase`, {
    headers: { Authorization: `Bearer ${validateOpaqueReference(reference)}` },
    redirect: 'error',
  });
  return readJson<CommercialPurchasePreview>(response);
}

export async function createCommercialCheckout(input: {
  reference: string;
  customerEmail: string;
  contactName?: string;
}): Promise<CommercialCheckoutResponse> {
  const response = await fetch(`${getApiBaseUrl()}/commercial/checkout`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${validateOpaqueReference(input.reference)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ customerEmail: input.customerEmail, contactName: input.contactName || undefined }),
    redirect: 'error',
  });
  const result = await readJson<CommercialCheckoutResponse>(response);
  validateStripeCheckoutUrl(result.checkoutUrl);
  if (!PUBLIC_ORDER_PATTERN.test(result.publicOrderId) || result.amountMinor !== 29900 || result.currency !== 'GBP') {
    throw new Error('The checkout response did not match the PatrolSafe annual licence policy.');
  }
  return result;
}

export function customerStatus(orderState: string): string {
  if (['REQUEST_CREATED', 'CHECKOUT_PENDING', 'PAYMENT_PENDING'].includes(orderState)) return 'Awaiting payment';
  if (orderState === 'PAID_AWAITING_APPROVAL') return 'Payment received — awaiting approval';
  if (orderState === 'ISSUANCE_PENDING') return 'Licence being prepared';
  if (['ISSUED', 'DELIVERY_PENDING', 'DELIVERED'].includes(orderState)) return 'Licence ready — check your email';
  return 'Support required';
}
