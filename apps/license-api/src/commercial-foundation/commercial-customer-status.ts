import { CommercialOrderState } from '@prisma/client';

export const COMMERCIAL_CUSTOMER_ORDER_STATUS = {
  AWAITING_PAYMENT: 'AWAITING_PAYMENT',
  PAYMENT_RECEIVED: 'PAYMENT_RECEIVED',
  LICENCE_PREPARING: 'LICENCE_PREPARING',
  LICENCE_READY: 'LICENCE_READY',
  LICENCE_SENT: 'LICENCE_SENT',
  CHECKOUT_CANCELLED: 'CHECKOUT_CANCELLED',
  SUPPORT_REQUIRED: 'SUPPORT_REQUIRED',
} as const;

export type CommercialCustomerOrderStatus =
  (typeof COMMERCIAL_CUSTOMER_ORDER_STATUS)[keyof typeof COMMERCIAL_CUSTOMER_ORDER_STATUS];

export function toCommercialCustomerOrderStatus(
  state: CommercialOrderState,
): CommercialCustomerOrderStatus {
  switch (state) {
    case CommercialOrderState.REQUEST_CREATED:
    case CommercialOrderState.CHECKOUT_PENDING:
    case CommercialOrderState.PAYMENT_PENDING:
      return COMMERCIAL_CUSTOMER_ORDER_STATUS.AWAITING_PAYMENT;
    case CommercialOrderState.PAID_AWAITING_APPROVAL:
      return COMMERCIAL_CUSTOMER_ORDER_STATUS.PAYMENT_RECEIVED;
    case CommercialOrderState.ISSUANCE_PENDING:
      return COMMERCIAL_CUSTOMER_ORDER_STATUS.LICENCE_PREPARING;
    case CommercialOrderState.ISSUED:
    case CommercialOrderState.DELIVERY_PENDING:
      return COMMERCIAL_CUSTOMER_ORDER_STATUS.LICENCE_READY;
    case CommercialOrderState.DELIVERED:
      return COMMERCIAL_CUSTOMER_ORDER_STATUS.LICENCE_SENT;
    case CommercialOrderState.CANCELLED:
      return COMMERCIAL_CUSTOMER_ORDER_STATUS.CHECKOUT_CANCELLED;
    case CommercialOrderState.FAILED:
    case CommercialOrderState.HELD:
    case CommercialOrderState.REJECTED:
    case CommercialOrderState.REFUNDED:
      return COMMERCIAL_CUSTOMER_ORDER_STATUS.SUPPORT_REQUIRED;
  }
}
