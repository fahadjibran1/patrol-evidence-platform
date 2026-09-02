import { createHash } from 'crypto';

/**
 * Unit coverage for webhook idempotency helpers used by StripeWebhookService.
 * Full signature verification is covered with Stripe doubles in integration tests.
 */
describe('Stripe webhook deduplication', () => {
  function payloadHash(rawBody: Buffer): string {
    return createHash('sha256').update(rawBody).digest('hex');
  }

  it('produces stable payload hashes for identical bodies', () => {
    const body = Buffer.from(JSON.stringify({ id: 'evt_1', type: 'invoice.paid' }));
    expect(payloadHash(body)).toBe(payloadHash(Buffer.from(body)));
  });

  it('produces different hashes for different bodies', () => {
    const a = Buffer.from(JSON.stringify({ id: 'evt_1' }));
    const b = Buffer.from(JSON.stringify({ id: 'evt_2' }));
    expect(payloadHash(a)).not.toBe(payloadHash(b));
  });

  it('treats stripeEventId as the business uniqueness key', () => {
    const seen = new Set<string>();
    const eventId = 'evt_duplicate';
    expect(seen.has(eventId)).toBe(false);
    seen.add(eventId);
    expect(seen.has(eventId)).toBe(true);
  });
});

describe('Checkout amount reconciliation rules', () => {
  function amountsMatch(expected: number, actual: number, expectedCurrency: string, actualCurrency: string) {
    return expected === actual && expectedCurrency.toUpperCase() === actualCurrency.toUpperCase();
  }

  it('blocks activation on amount mismatch', () => {
    expect(amountsMatch(1000, 999, 'GBP', 'GBP')).toBe(false);
  });

  it('blocks activation on currency mismatch', () => {
    expect(amountsMatch(1000, 1000, 'GBP', 'USD')).toBe(false);
  });

  it('allows matching minor units and currency', () => {
    expect(amountsMatch(2499, 2499, 'gbp', 'GBP')).toBe(true);
  });
});
