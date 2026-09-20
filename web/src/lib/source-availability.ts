export type SourceAvailabilityStatus = 'available' | 'mapped-here' | 'mapped-elsewhere';

export type SourceAvailabilityEntry = {
  sourceId: string;
  status: SourceAvailabilityStatus;
};

// The backend deliberately limits each availability request to 500 source IDs.
// Keep well below that bound so large connected accounts can be checked safely.
export const SOURCE_AVAILABILITY_BATCH_SIZE = 200;

export async function loadSourceAvailabilityBatched(
  sourceIds: string[],
  requestBatch: (ids: string[]) => Promise<SourceAvailabilityEntry[]>,
): Promise<{ statuses: Record<string, SourceAvailabilityStatus>; unavailableCount: number }> {
  const ids = [...new Set(sourceIds.map((id) => id.trim()).filter(Boolean))];
  const statuses: Record<string, SourceAvailabilityStatus> = Object.create(null);
  let unavailableCount = 0;

  for (let offset = 0; offset < ids.length; offset += SOURCE_AVAILABILITY_BATCH_SIZE) {
    const batch = ids.slice(offset, offset + SOURCE_AVAILABILITY_BATCH_SIZE);
    try {
      const response = await requestBatch(batch);
      const requested = new Set(batch);
      const batchStatuses = new Map<string, SourceAvailabilityStatus>();
      if (!Array.isArray(response) || response.length !== batch.length) {
        throw new Error('Incomplete source availability response');
      }
      for (const entry of response) {
        if (!entry || !requested.has(entry.sourceId) || batchStatuses.has(entry.sourceId)
          || !['available', 'mapped-here', 'mapped-elsewhere'].includes(entry.status)) {
          throw new Error('Invalid source availability response');
        }
        batchStatuses.set(entry.sourceId, entry.status);
      }
      for (const sourceId of batch) {
        const status = batchStatuses.get(sourceId);
        if (!status) throw new Error('Missing source availability status');
        statuses[sourceId] = status;
      }
    } catch {
      // A failed batch leaves only those sources unknown; none become selectable.
      for (const sourceId of batch) delete statuses[sourceId];
      unavailableCount += batch.length;
    }
  }

  return { statuses, unavailableCount };
}
