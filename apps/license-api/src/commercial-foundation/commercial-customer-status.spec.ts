import { CommercialOrderState, CommercialPaymentStatus } from '@prisma/client';
import { CommercialCheckoutService } from './commercial-checkout.service';
import { toCommercialCustomerOrderStatus } from './commercial-customer-status';

describe('customer-safe commercial order status', () => {
  it.each([
    [CommercialOrderState.REQUEST_CREATED, 'AWAITING_PAYMENT'],
    [CommercialOrderState.CHECKOUT_PENDING, 'AWAITING_PAYMENT'],
    [CommercialOrderState.PAYMENT_PENDING, 'AWAITING_PAYMENT'],
    [CommercialOrderState.PAID_AWAITING_APPROVAL, 'PAYMENT_RECEIVED'],
    [CommercialOrderState.ISSUANCE_PENDING, 'LICENCE_PREPARING'],
    [CommercialOrderState.ISSUED, 'LICENCE_READY'],
    [CommercialOrderState.DELIVERY_PENDING, 'LICENCE_READY'],
    [CommercialOrderState.DELIVERED, 'LICENCE_SENT'],
    [CommercialOrderState.CANCELLED, 'CHECKOUT_CANCELLED'],
    [CommercialOrderState.FAILED, 'SUPPORT_REQUIRED'],
    [CommercialOrderState.HELD, 'SUPPORT_REQUIRED'],
    [CommercialOrderState.REJECTED, 'SUPPORT_REQUIRED'],
    [CommercialOrderState.REFUNDED, 'SUPPORT_REQUIRED'],
  ])('maps %s without exposing the internal state', (state, expected) => {
    expect(toCommercialCustomerOrderStatus(state)).toBe(expected);
  });

  it('returns only the stable public identifier and customer-safe facts', async () => {
    const publicOrderId = 'ord_74cc812c-4abf-4f06-a57e-3a4c1ad6ce27';
    const prisma = {
      commercialOrder: {
        findUnique: jest.fn().mockResolvedValue({
          publicOrderId,
          state: CommercialOrderState.PAID_AWAITING_APPROVAL,
          payments: [{ id: 'private-payment-id' }],
        }),
      },
    };
    const config = {
      getPolicy: () => ({ displayName: 'PatrolSafe Annual Licence', amountMinor: 29900, currency: 'GBP' }),
    };
    const service = new CommercialCheckoutService(prisma as never, {} as never, config as never, {} as never);
    const result = await service.getPublicOrderStatus(publicOrderId);

    expect(prisma.commercialOrder.findUnique).toHaveBeenCalledWith({
      where: { publicOrderId },
      select: {
        publicOrderId: true,
        state: true,
        payments: {
          where: { status: CommercialPaymentStatus.SUCCEEDED },
          select: { id: true },
          take: 1,
        },
      },
    });
    expect(result).toEqual({
      publicOrderId,
      product: 'PatrolSafe Annual Licence',
      amountMinor: 29900,
      currency: 'GBP',
      paymentReceived: true,
      status: 'PAYMENT_RECEIVED',
    });
    expect(JSON.stringify(result)).not.toMatch(/PAID_AWAITING_APPROVAL|private-payment-id|fingerprint|email|stripe/i);
  });

  it('fails closed for invalid and unknown public order identifiers', async () => {
    const prisma = { commercialOrder: { findUnique: jest.fn().mockResolvedValue(null) } };
    const service = new CommercialCheckoutService(prisma as never, {} as never, { getPolicy: jest.fn() } as never, {} as never);

    await expect(service.getPublicOrderStatus('not-an-order')).rejects.toMatchObject({ status: 404 });
    expect(prisma.commercialOrder.findUnique).not.toHaveBeenCalled();
    await expect(service.getPublicOrderStatus('ord_74cc812c-4abf-4f06-a57e-3a4c1ad6ce27')).rejects.toMatchObject({ status: 404 });
  });
});
