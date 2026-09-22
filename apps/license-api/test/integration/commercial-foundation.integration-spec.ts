import {
  CommercialActorType,
  CommercialOrderState,
  CommercialPaymentStatus,
  CommercialProvider,
  CustomerStatus,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { AuditService } from '@/audit/audit.service';
import { EncryptionService } from '@/crypto/encryption.service';
import { CommercialPurchaseService } from '@/commercial-foundation/commercial-purchase.service';
import { CommercialOrderService } from '@/commercial-foundation/commercial-order.service';
import { CommercialIssuanceService } from '@/commercial-foundation/commercial-issuance.service';
import type {
  CommercialLicenceIssuer,
  IssueCommercialLicenceCommand,
} from '@/commercial-foundation/commercial-issuer.port';
import {
  closeIntegrationContext,
  createIntegrationContext,
  type IntegrationContext,
} from './integration-harness';

function request(overrides: Record<string, unknown> = {}) {
  return {
    requestId: randomUUID(),
    schemaVersion: 2,
    product: 'Patrol Evidence Platform',
    plan: 'annual',
    installationId: randomUUID(),
    machineFingerprint: 'b'.repeat(64),
    companyName: 'Northstar Security Ltd',
    appVersion: '1.0.3',
    buildId: '2026.09.22.phase1',
    clientNonce: `nonce_${randomUUID().replace(/-/g, '')}`,
    ...overrides,
  };
}

class RecordingFakeIssuer implements CommercialLicenceIssuer {
  commands: Readonly<IssueCommercialLicenceCommand>[] = [];

  async issue(command: Readonly<IssueCommercialLicenceCommand>) {
    this.commands.push(command);
    return {
      licenceId: `lic-${randomUUID()}`,
      payloadHash: 'c'.repeat(64),
      signingKeyId: 'phase1-fake-key',
      artifact: {
        artifactId: randomUUID(),
        fileName: 'PatrolSafe-test.tglic',
        storageKey: `phase1-test/${command.commandId}.tglic`,
        sha256: 'd'.repeat(64),
        byteSize: 512n,
        contentType: 'application/json' as const,
      },
    };
  }
}

describe('commercial Phase 1 persistence foundation', () => {
  let context: IntegrationContext;
  let purchase: CommercialPurchaseService;
  let orders: CommercialOrderService;

  beforeAll(async () => {
    context = await createIntegrationContext();
    purchase = context.module.get(CommercialPurchaseService);
    orders = context.module.get(CommercialOrderService);
  });

  afterAll(async () => closeIntegrationContext(context));

  it('creates an opaque one-time request with safe audit and atomic outbox', async () => {
    const raw = request();
    const created = await purchase.createPurchaseRequest(raw);
    expect(created.purchaseReference).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const stored = await context.prisma.commercialPurchaseRequest.findUniqueOrThrow({
      where: { requestId: raw.requestId as string },
      include: { references: true, orders: true },
    });
    expect(stored.machineFingerprintEnc).not.toContain(raw.machineFingerprint as string);
    expect(stored.machineFingerprintHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.references[0].referenceHash).not.toBe(created.purchaseReference);
    expect(stored.orders).toHaveLength(1);
    expect(await context.prisma.commercialOutboxEvent.count({ where: { aggregateId: stored.id } })).toBe(1);

    const audit = await context.prisma.auditLog.findFirstOrThrow({
      where: { entityId: stored.id, action: 'commercial.purchase_request.created' },
    });
    expect(JSON.stringify(audit.metadata)).not.toContain(raw.machineFingerprint as string);
    expect(JSON.stringify(audit.metadata)).not.toContain(created.purchaseReference);

    const exchanged = await purchase.exchangePurchaseReference(created.purchaseReference);
    expect(exchanged.publicOrderId).toBe(created.publicOrderId);
    await expect(purchase.exchangePurchaseReference(created.purchaseReference)).rejects.toMatchObject({
      code: 'COMMERCIAL_REFERENCE_REPLAYED',
    });
  });

  it('enforces duplicate request IDs, canonical requests, and nonces in the database', async () => {
    const input = request();
    await purchase.createPurchaseRequest(input);
    await expect(purchase.createPurchaseRequest(input)).rejects.toMatchObject({
      code: 'COMMERCIAL_REQUEST_DUPLICATE',
    });
    await expect(purchase.createPurchaseRequest(request({ clientNonce: input.clientNonce }))).rejects.toMatchObject({
      code: 'COMMERCIAL_REQUEST_DUPLICATE',
    });
  });

  it('expires references and rejects malformed opaque references', async () => {
    const created = await purchase.createPurchaseRequest(request(), new Date('2025-01-01T00:00:00.000Z'));
    await expect(purchase.exchangePurchaseReference(created.purchaseReference)).rejects.toMatchObject({
      code: 'COMMERCIAL_REFERENCE_EXPIRED',
    });
    await expect(purchase.exchangePurchaseReference('not-a-reference')).rejects.toMatchObject({
      code: 'COMMERCIAL_REFERENCE_INVALID',
    });
  });

  it('moves through paid approval and invokes only the isolated fake issuer once', async () => {
    const created = await purchase.createPurchaseRequest(request());
    const customer = await context.prisma.customer.create({
      data: {
        companyName: 'Northstar Security Ltd',
        contactName: 'UAT Admin',
        email: `commercial-${randomUUID()}@example.test`,
        status: CustomerStatus.ACTIVE,
        country: 'GB',
      },
    });
    await context.prisma.commercialPurchaseRequest.update({
      where: { requestId: created.requestId },
      data: { customerId: customer.id },
    });
    await context.prisma.commercialOrder.update({
      where: { publicOrderId: created.publicOrderId },
      data: { customerId: customer.id },
    });
    const actor = { actorType: CommercialActorType.SYSTEM };
    await orders.transition({ publicOrderId: created.publicOrderId, to: CommercialOrderState.CHECKOUT_PENDING, actor });
    await orders.transition({ publicOrderId: created.publicOrderId, to: CommercialOrderState.PAYMENT_PENDING, actor });
    await orders.transition({ publicOrderId: created.publicOrderId, to: CommercialOrderState.PAID_AWAITING_APPROVAL, actor });
    expect(await context.prisma.commercialOutboxEvent.count({
      where: { aggregateId: (await context.prisma.commercialOrder.findUniqueOrThrow({ where: { publicOrderId: created.publicOrderId } })).id },
    })).toBe(3);

    const fake = new RecordingFakeIssuer();
    const issuance = new CommercialIssuanceService(
      context.prisma,
      context.module.get(EncryptionService),
      context.module.get(AuditService),
      fake,
    );
    await issuance.approve({
      publicOrderId: created.publicOrderId,
      startsAt: '2026-10-01',
      expiresAt: '2027-10-01',
      actor: { actorType: CommercialActorType.OPERATOR, actorAdminId: context.admin.id },
    });
    const issued = await issuance.processApproved(created.publicOrderId);
    const repeated = await issuance.processApproved(created.publicOrderId);

    expect(issued.idempotent).toBe(false);
    expect(repeated.idempotent).toBe(true);
    expect(fake.commands).toHaveLength(1);
    expect(fake.commands[0]).toMatchObject({
      product: 'Patrol Evidence Platform',
      plan: 'annual',
      companyName: 'Northstar Security Ltd',
      maxDevices: 1,
    });
    expect(Object.keys(fake.commands[0]).sort()).toEqual([
      'commandId', 'companyName', 'correlationId', 'expiresAt', 'installationId',
      'machineFingerprint', 'maxDevices', 'plan', 'predecessorLicenceId', 'product',
      'publicOrderId', 'requestHash', 'startsAt',
    ]);

    await context.prisma.commercialDeliveryAttempt.create({
      data: {
        artifactId: issued.artifact.id,
        idempotencyKey: `deliver:${issued.artifact.artifactId}:initial`,
        channel: 'TEST',
        recipient: 'customer@example.test',
      },
    });
    await expect(context.prisma.commercialDeliveryAttempt.create({
      data: {
        artifactId: issued.artifact.id,
        idempotencyKey: `deliver:${issued.artifact.artifactId}:initial`,
        channel: 'TEST',
        recipient: 'customer@example.test',
      },
    })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('uses explicit recovery for FAILED and HELD and keeps terminal states closed', async () => {
    const actor = { actorType: CommercialActorType.SYSTEM };

    const failedCreated = await purchase.createPurchaseRequest(request());
    await orders.transition({
      publicOrderId: failedCreated.publicOrderId,
      to: CommercialOrderState.FAILED,
      actor,
      failureCode: 'CHECKOUT_TEMPORARY_FAILURE',
      failureMessage: 'temporary failure\nwithout secrets',
    });
    const retried = await orders.retryFailed(failedCreated.publicOrderId, actor);
    expect(retried.state).toBe(CommercialOrderState.REQUEST_CREATED);
    expect(retried.failureCode).toBeNull();

    const heldCreated = await purchase.createPurchaseRequest(request());
    await orders.transition({
      publicOrderId: heldCreated.publicOrderId,
      to: CommercialOrderState.HELD,
      actor,
      holdReason: 'operator review',
    });
    const released = await orders.releaseHeld(heldCreated.publicOrderId, actor);
    expect(released.state).toBe(CommercialOrderState.REQUEST_CREATED);

    const cancelledCreated = await purchase.createPurchaseRequest(request());
    await orders.transition({
      publicOrderId: cancelledCreated.publicOrderId,
      to: CommercialOrderState.CANCELLED,
      actor,
    });
    await expect(orders.transition({
      publicOrderId: cancelledCreated.publicOrderId,
      to: CommercialOrderState.CHECKOUT_PENDING,
      actor,
    })).rejects.toMatchObject({ code: 'COMMERCIAL_TRANSITION_INVALID' });
  });

  it('fails closed before payment/approval and audits prohibited transitions', async () => {
    const created = await purchase.createPurchaseRequest(request());
    const fake = new RecordingFakeIssuer();
    const issuance = new CommercialIssuanceService(
      context.prisma,
      context.module.get(EncryptionService),
      context.module.get(AuditService),
      fake,
    );
    await expect(issuance.processApproved(created.publicOrderId)).rejects.toMatchObject({
      code: 'COMMERCIAL_ISSUANCE_NOT_ALLOWED',
    });
    await expect(orders.transition({
      publicOrderId: created.publicOrderId,
      to: CommercialOrderState.ISSUED,
      actor: { actorType: CommercialActorType.SYSTEM },
    })).rejects.toMatchObject({ code: 'COMMERCIAL_TRANSITION_INVALID' });
    expect(fake.commands).toHaveLength(0);
    expect(await context.prisma.auditLog.count({
      where: { entityType: 'CommercialOrder', action: 'commercial.order.transition_rejected' },
    })).toBeGreaterThan(0);
  });

  it('enforces provider, payment, order, issuance, artifact, delivery and FK uniqueness', async () => {
    const created = await purchase.createPurchaseRequest(request());
    const order = await context.prisma.commercialOrder.findUniqueOrThrow({ where: { publicOrderId: created.publicOrderId } });
    await context.prisma.commercialPayment.create({
      data: {
        orderId: order.id,
        provider: CommercialProvider.TEST,
        providerReference: 'payment-unique-1',
        status: CommercialPaymentStatus.SUCCEEDED,
        amountMinor: 29900,
        currency: 'GBP',
      },
    });
    await expect(context.prisma.commercialPayment.create({
      data: {
        orderId: order.id,
        provider: CommercialProvider.TEST,
        providerReference: 'payment-unique-1',
        amountMinor: 29900,
        currency: 'GBP',
      },
    })).rejects.toMatchObject({ code: 'P2002' });

    await context.prisma.commercialProviderEvent.create({
      data: { provider: CommercialProvider.TEST, providerEventId: 'event-1', eventType: 'test', payloadHash: 'e'.repeat(64) },
    });
    await expect(context.prisma.commercialProviderEvent.create({
      data: { provider: CommercialProvider.TEST, providerEventId: 'event-1', eventType: 'test', payloadHash: 'e'.repeat(64) },
    })).rejects.toMatchObject({ code: 'P2002' });

    const requestRow = await context.prisma.commercialPurchaseRequest.findUniqueOrThrow({ where: { requestId: created.requestId } });
    await expect(context.prisma.commercialOrder.create({
      data: {
        publicOrderId: `ord_${randomUUID()}`,
        purchaseRequestId: requestRow.id,
        purpose: order.purpose,
        product: order.product,
        plan: order.plan,
      },
    })).rejects.toMatchObject({ code: 'P2002' });
    await expect(context.prisma.commercialPayment.create({
      data: {
        orderId: randomUUID(),
        provider: CommercialProvider.TEST,
        providerReference: 'orphan-payment',
        amountMinor: 1,
        currency: 'GBP',
      },
    })).rejects.toMatchObject({ code: 'P2003' });
  });

  it('rolls back domain state when its transactional outbox write fails', async () => {
    const created = await purchase.createPurchaseRequest(request());
    const order = await context.prisma.commercialOrder.findUniqueOrThrow({ where: { publicOrderId: created.publicOrderId } });
    await context.prisma.commercialOutboxEvent.create({
      data: {
        eventId: randomUUID(),
        idempotencyKey: `commercial-order:${order.id}:state:1`,
        aggregateType: 'test',
        aggregateId: order.id,
        eventType: 'forced.conflict',
        payload: {},
        correlationId: randomUUID(),
      },
    });
    await expect(orders.transition({
      publicOrderId: order.publicOrderId,
      to: CommercialOrderState.CHECKOUT_PENDING,
      actor: { actorType: CommercialActorType.SYSTEM },
    })).rejects.toMatchObject({ code: 'P2002' });
    const unchanged = await context.prisma.commercialOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(unchanged.state).toBe(CommercialOrderState.REQUEST_CREATED);
    expect(unchanged.stateVersion).toBe(0);
  });

  it('enforces Phase 1 database checks independently of application validation', async () => {
    const created = await purchase.createPurchaseRequest(request());
    const order = await context.prisma.commercialOrder.findUniqueOrThrow({ where: { publicOrderId: created.publicOrderId } });
    await expect(context.prisma.commercialPayment.create({
      data: {
        orderId: order.id,
        provider: CommercialProvider.TEST,
        providerReference: 'negative-payment',
        amountMinor: -1,
        currency: 'GBP',
      },
    })).rejects.toBeDefined();
    await expect(context.prisma.commercialOrder.update({
      where: { id: order.id },
      data: { product: 'Wrong Product' },
    })).rejects.toBeDefined();
    await expect(context.prisma.commercialOutboxEvent.create({
      data: {
        eventId: randomUUID(),
        idempotencyKey: `invalid-attempts:${randomUUID()}`,
        aggregateType: 'test',
        aggregateId: order.id,
        eventType: 'invalid',
        payload: {},
        correlationId: randomUUID(),
        attempts: -1,
      },
    })).rejects.toBeDefined();
  });
});
