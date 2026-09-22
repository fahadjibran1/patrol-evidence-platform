import { CommercialOrderState } from '@prisma/client';
import { allowedCommercialTransitions, isCommercialTransitionAllowed } from './commercial-state-machine';

const EXPECTED: Record<CommercialOrderState, CommercialOrderState[]> = {
  REQUEST_CREATED: ['CHECKOUT_PENDING', 'HELD', 'CANCELLED', 'FAILED'],
  CHECKOUT_PENDING: ['PAYMENT_PENDING', 'PAID_AWAITING_APPROVAL', 'HELD', 'CANCELLED', 'FAILED'],
  PAYMENT_PENDING: ['PAID_AWAITING_APPROVAL', 'HELD', 'CANCELLED', 'FAILED', 'REFUNDED'],
  PAID_AWAITING_APPROVAL: ['ISSUANCE_PENDING', 'HELD', 'REJECTED', 'FAILED', 'REFUNDED'],
  ISSUANCE_PENDING: ['ISSUED', 'HELD', 'FAILED', 'REFUNDED'],
  ISSUED: ['DELIVERY_PENDING', 'REFUNDED'],
  DELIVERY_PENDING: ['DELIVERED', 'FAILED', 'REFUNDED'],
  DELIVERED: ['REFUNDED'],
  FAILED: [],
  HELD: [],
  CANCELLED: [],
  REJECTED: [],
  REFUNDED: [],
};

describe('commercial order state machine', () => {
  for (const from of Object.values(CommercialOrderState)) {
    it(`permits only the declared transitions from ${from}`, () => {
      const expected = new Set(EXPECTED[from]);
      expect(new Set(allowedCommercialTransitions(from))).toEqual(expected);
      for (const to of Object.values(CommercialOrderState)) {
        expect(isCommercialTransitionAllowed(from, to)).toBe(expected.has(to));
      }
    });
  }
});
