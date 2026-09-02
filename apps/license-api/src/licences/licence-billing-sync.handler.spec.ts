import { LicenceBillingSyncHandler } from './licence-billing-sync.handler';
import { DOMAIN_EVENTS } from '@/domain-events/domain-event.types';

describe('LicenceBillingSyncHandler (RC1)', () => {
  it('handles activation, renewal, plan change, and access-end events', () => {
    const handler = new LicenceBillingSyncHandler(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    expect(handler.handles).toEqual(
      expect.arrayContaining([
        DOMAIN_EVENTS.SubscriptionActivated,
        DOMAIN_EVENTS.SubscriptionRenewed,
        DOMAIN_EVENTS.PlanChanged,
        DOMAIN_EVENTS.DeviceLimitChanged,
        DOMAIN_EVENTS.SubscriptionCancelled,
        DOMAIN_EVENTS.SubscriptionExpired,
        DOMAIN_EVENTS.SubscriptionSuspended,
      ]),
    );
  });
});
