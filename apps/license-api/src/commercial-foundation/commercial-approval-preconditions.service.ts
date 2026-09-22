import { Inject, Injectable } from '@nestjs/common';
import { CommercialOrderState, CommercialPaymentStatus } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { ApiException } from '@/common/exceptions/api.exception';
import { ERROR_CODES } from '@/common/constants/error-codes';
import { CommercialConfigService } from './commercial-config.service';
import { COMMERCIAL_PAYMENT_PROVIDER, type CommercialPaymentProvider } from './commercial-payment-provider.port';

const APPROVAL_WINDOW_MS = 30 * 24 * 60 * 60_000;

@Injectable()
export class CommercialApprovalPreconditionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: CommercialConfigService,
    @Inject(COMMERCIAL_PAYMENT_PROVIDER) private readonly provider: CommercialPaymentProvider,
  ) {}

  async assertPaidAndEligible(publicOrderId: string, now = new Date()) {
    const order = await this.prisma.commercialOrder.findUnique({
      where: { publicOrderId },
      include: { purchaseRequest: true, payments: true, issuance: true },
    });
    if (!order) throw new ApiException(ERROR_CODES.COMMERCIAL_ORDER_NOT_FOUND, 'Commercial order was not found.', 404);
    const fail = (reason: string): never => {
      throw new ApiException(ERROR_CODES.COMMERCIAL_APPROVAL_PRECONDITION_FAILED, `Commercial approval precondition failed: ${reason}.`, 409);
    };
    const policy = this.config.getPolicy();
    if (order.state !== CommercialOrderState.PAID_AWAITING_APPROVAL && order.state !== CommercialOrderState.ISSUANCE_PENDING) fail('order is not paid and awaiting approval');
    if (order.refundedAt || order.cancelledAt || order.holdReason) fail('order is refunded, cancelled, or held');
    if (order.product !== policy.product || order.purchaseRequest.product !== policy.product) fail('product mismatch');
    if (order.plan !== 'ANNUAL' || order.purchaseRequest.plan !== 'ANNUAL') fail('plan mismatch');
    if (order.amountMinor !== policy.amountMinor || order.currency !== policy.currency) fail('commercial amount mismatch');
    if (!/^[a-f0-9]{64}$/.test(order.purchaseRequest.canonicalRequestHash)) fail('request hash invalid');
    if (order.requestHashSnapshot !== order.purchaseRequest.canonicalRequestHash) fail('request hash changed');
    if (order.purchaseRequest.createdAt.getTime() + APPROVAL_WINDOW_MS < now.getTime()) fail('request is outside the approval window');
    if (!order.customerId) fail('verified customer is missing');
    const succeeded = order.payments.find((payment) => payment.status === CommercialPaymentStatus.SUCCEEDED);
    if (!succeeded || succeeded.amountMinor !== policy.amountMinor || succeeded.currency !== policy.currency) fail('settled payment is missing');
    if (!order.providerCheckoutSessionId || !order.providerPaymentIntentId) fail('provider references are incomplete');
    const checkoutSessionId = order.providerCheckoutSessionId;
    const paymentIntentId = order.providerPaymentIntentId;
    const [checkout, payment] = await Promise.all([
      this.provider.retrieveCheckout(checkoutSessionId!),
      this.provider.retrievePayment(paymentIntentId!),
    ]);
    if (checkout.livemode || payment.livemode || this.provider.getMode() !== 'TEST') fail('provider mode mismatch');
    if (checkout.publicOrderId !== order.publicOrderId || payment.publicOrderId !== order.publicOrderId) fail('provider order mismatch');
    if (checkout.paymentIntentId !== payment.paymentIntentId || payment.paymentIntentId !== order.providerPaymentIntentId) fail('payment intent mismatch');
    if (checkout.paymentStatus !== 'paid' || payment.status !== 'succeeded') fail('payment is not authoritatively settled');
    if (checkout.amountTotal !== policy.amountMinor || payment.amount !== policy.amountMinor || payment.amountReceived < policy.amountMinor) fail('provider amount mismatch');
    if (checkout.currency !== policy.currency || payment.currency !== policy.currency) fail('provider currency mismatch');
    if (payment.amountRefunded > 0) fail('payment has been refunded');
    return order;
  }
}
