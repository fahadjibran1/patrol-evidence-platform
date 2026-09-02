import { EventBus } from './event-bus.service';
import { createDomainEvent } from './domain-event';
import type { DomainEventHandler } from './domain-event-handler';
import { DOMAIN_EVENTS } from './domain-event.types';

describe('EventBus', () => {
  function buildHandler(handles: string[], impl: (event: unknown) => Promise<void> = async () => undefined) {
    const handle = jest.fn(impl);
    const handler: DomainEventHandler = { handles, handle };
    return { handler, handle };
  }

  it('dispatches to handlers subscribed to the matching event type', async () => {
    const bus = new EventBus();
    const { handler, handle } = buildHandler([DOMAIN_EVENTS.LicenceIssued]);
    bus.subscribe(handler);

    const event = createDomainEvent(DOMAIN_EVENTS.LicenceIssued, { licenceId: 'lic-1' });
    await bus.publish(event);

    expect(handle).toHaveBeenCalledWith(event);
  });

  it('does not dispatch to handlers for non-matching event types', async () => {
    const bus = new EventBus();
    const { handler, handle } = buildHandler([DOMAIN_EVENTS.LicenceRenewed]);
    bus.subscribe(handler);

    await bus.publish(createDomainEvent(DOMAIN_EVENTS.LicenceIssued, {}));

    expect(handle).not.toHaveBeenCalled();
  });

  it('dispatches to wildcard handlers for every event', async () => {
    const bus = new EventBus();
    const { handler, handle } = buildHandler(['*']);
    bus.subscribe(handler);

    await bus.publish(createDomainEvent(DOMAIN_EVENTS.PaymentRecorded, {}));
    await bus.publish(createDomainEvent(DOMAIN_EVENTS.CustomerCreated, {}));

    expect(handle).toHaveBeenCalledTimes(2);
  });

  it('invokes multiple matching handlers for the same event', async () => {
    const bus = new EventBus();
    const { handler: handlerA, handle: handleA } = buildHandler([DOMAIN_EVENTS.NotificationSent]);
    const { handler: handlerB, handle: handleB } = buildHandler([DOMAIN_EVENTS.NotificationSent]);
    bus.subscribe(handlerA);
    bus.subscribe(handlerB);

    await bus.publish(createDomainEvent(DOMAIN_EVENTS.NotificationSent, {}));

    expect(handleA).toHaveBeenCalledTimes(1);
    expect(handleB).toHaveBeenCalledTimes(1);
  });

  it('does not throw and still runs other handlers when one handler throws', async () => {
    const bus = new EventBus();
    const { handler: failing } = buildHandler([DOMAIN_EVENTS.LicenceSuspended], async () => {
      throw new Error('boom');
    });
    const { handler: healthy, handle: healthyHandle } = buildHandler([DOMAIN_EVENTS.LicenceSuspended]);
    bus.subscribe(failing);
    bus.subscribe(healthy);

    await expect(bus.publish(createDomainEvent(DOMAIN_EVENTS.LicenceSuspended, {}))).resolves.toBeUndefined();
    expect(healthyHandle).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe stops further dispatch to that handler', async () => {
    const bus = new EventBus();
    const { handler, handle } = buildHandler([DOMAIN_EVENTS.LicenceRevoked]);
    bus.subscribe(handler);
    bus.unsubscribe(handler);

    await bus.publish(createDomainEvent(DOMAIN_EVENTS.LicenceRevoked, {}));

    expect(handle).not.toHaveBeenCalled();
  });

  it('exposes handlerCount for diagnostics', () => {
    const bus = new EventBus();
    const { handler } = buildHandler([DOMAIN_EVENTS.LicenceReactivated]);
    expect(bus.handlerCount).toBe(0);
    bus.subscribe(handler);
    expect(bus.handlerCount).toBe(1);
  });
});
