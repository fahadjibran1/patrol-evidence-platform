import { LicenceVersionAction, LicensePlan, LicenseStatus, Prisma } from '@prisma/client';

/** Prisma transaction client type as passed into `$transaction(async (tx) => ...)` callbacks. */
export type PrismaTransactionClient = Omit<
  Prisma.TransactionClient,
  '$transaction' | '$connect' | '$disconnect' | '$on' | '$use' | '$extends'
>;

export interface CreateVersionAndUpdateCurrentInput {
  licenceId: string;
  actionType: LicenceVersionAction;
  /** Snapshot of the entitlement at this version (always recorded, even for status-only actions). */
  plan: LicensePlan;
  maxDevices: number;
  features: unknown;
  validFrom: string | Date;
  validUntil: string | Date;
  statusSnapshot: LicenseStatus;
  issuedByAdminId: string;
  reason?: string | null;
  metadata?: Prisma.InputJsonValue | null;
  /**
   * Whether this action produced a fresh TG1 licence key. When true, the newly signed
   * material is stored on the version AND the denormalized fields on the parent Licence
   * (plan/maxDevices/features/dates/signedLicenseEnc/payloadHash/signingKeyId) are updated
   * to match. When false (e.g. SUSPENDED/REACTIVATED/REVOKED status-only transitions), the
   * version is recorded without any signed material and the Licence's existing TG1 fields
   * are left untouched.
   */
  producesNewTg1: boolean;
  signedLicenseEnc?: string | null;
  payloadHash?: string | null;
  signingKeyId?: string | null;
}

/**
 * Determine the next version number for a licence. Locks the parent Licence row
 * (`SELECT ... FOR UPDATE`) for the remainder of the transaction so that concurrent
 * lifecycle mutations against the same licence cannot allocate the same version number.
 */
export async function nextVersionNumber(tx: PrismaTransactionClient, licenceId: string): Promise<number> {
  await tx.$queryRaw`SELECT "id" FROM "Licence" WHERE "id" = ${licenceId} FOR UPDATE`;

  const aggregate = await tx.licenceVersion.aggregate({
    where: { licenceId },
    _max: { versionNumber: true },
  });

  return (aggregate._max.versionNumber ?? 0) + 1;
}

/**
 * Creates the next LicenceVersion row for a licence (chained to the previous current
 * version, if any) and updates `Licence.currentVersionId` to point at it. When
 * `producesNewTg1` is true, also refreshes the denormalized entitlement + signed key
 * fields on the Licence row itself.
 *
 * Must be called within a Prisma transaction (`tx`) so that version-number allocation,
 * version creation, and the Licence pointer update are atomic.
 */
export async function createVersionAndUpdateCurrent(
  tx: PrismaTransactionClient,
  input: CreateVersionAndUpdateCurrentInput,
) {
  const versionNumber = await nextVersionNumber(tx, input.licenceId);

  const parent = await tx.licence.findUniqueOrThrow({
    where: { id: input.licenceId },
    select: { currentVersionId: true },
  });

  const version = await tx.licenceVersion.create({
    data: {
      licenceId: input.licenceId,
      versionNumber,
      actionType: input.actionType,
      plan: input.plan,
      maxDevices: input.maxDevices,
      features: (input.features ?? []) as Prisma.InputJsonValue,
      validFrom: toDateOnlyValue(input.validFrom),
      validUntil: toDateOnlyValue(input.validUntil),
      statusSnapshot: input.statusSnapshot,
      signedLicenseEnc: input.producesNewTg1 ? input.signedLicenseEnc ?? null : null,
      payloadHash: input.producesNewTg1 ? input.payloadHash ?? null : null,
      signingKeyId: input.producesNewTg1 ? input.signingKeyId ?? null : null,
      issuedByAdminId: input.issuedByAdminId,
      previousVersionId: parent.currentVersionId ?? null,
      reason: input.reason ?? null,
      metadata: input.metadata ?? undefined,
    },
  });

  const licenceUpdateData: Prisma.LicenceUncheckedUpdateInput = {
    currentVersionId: version.id,
  };

  if (input.producesNewTg1) {
    licenceUpdateData.plan = input.plan;
    licenceUpdateData.maxDevices = input.maxDevices;
    licenceUpdateData.features = (input.features ?? []) as Prisma.InputJsonValue;
    licenceUpdateData.startsAt = toDateOnlyValue(input.validFrom);
    licenceUpdateData.expiresAt = toDateOnlyValue(input.validUntil);
    licenceUpdateData.signedLicenseEnc = input.signedLicenseEnc ?? null;
    licenceUpdateData.payloadHash = input.payloadHash ?? null;
    licenceUpdateData.signingKeyId = input.signingKeyId ?? null;
  }

  await tx.licence.update({
    where: { id: input.licenceId },
    data: licenceUpdateData,
  });

  return version;
}

function toDateOnlyValue(value: string | Date): Date {
  if (value instanceof Date) {
    return value;
  }
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}
