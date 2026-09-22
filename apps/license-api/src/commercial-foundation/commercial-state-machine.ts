import { CommercialOrderState } from '@prisma/client';

const NORMAL_TRANSITIONS: Readonly<Record<CommercialOrderState, ReadonlySet<CommercialOrderState>>> = {
  REQUEST_CREATED: new Set(['CHECKOUT_PENDING', 'HELD', 'CANCELLED', 'FAILED']),
  CHECKOUT_PENDING: new Set(['PAYMENT_PENDING', 'PAID_AWAITING_APPROVAL', 'HELD', 'CANCELLED', 'FAILED']),
  PAYMENT_PENDING: new Set(['PAID_AWAITING_APPROVAL', 'HELD', 'CANCELLED', 'FAILED', 'REFUNDED']),
  PAID_AWAITING_APPROVAL: new Set(['ISSUANCE_PENDING', 'HELD', 'FAILED', 'REFUNDED']),
  ISSUANCE_PENDING: new Set(['ISSUED', 'HELD', 'FAILED', 'REFUNDED']),
  ISSUED: new Set(['DELIVERY_PENDING', 'REFUNDED']),
  DELIVERY_PENDING: new Set(['DELIVERED', 'FAILED', 'REFUNDED']),
  DELIVERED: new Set(['REFUNDED']),
  FAILED: new Set(),
  HELD: new Set(),
  CANCELLED: new Set(),
  REFUNDED: new Set(),
};

export function isCommercialTransitionAllowed(
  from: CommercialOrderState,
  to: CommercialOrderState,
): boolean {
  return NORMAL_TRANSITIONS[from].has(to);
}

export function allowedCommercialTransitions(from: CommercialOrderState): CommercialOrderState[] {
  return [...NORMAL_TRANSITIONS[from]];
}

export function isTerminalCommercialState(state: CommercialOrderState): boolean {
  return state === CommercialOrderState.CANCELLED || state === CommercialOrderState.REFUNDED;
}
