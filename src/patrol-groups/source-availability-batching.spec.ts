import { validateSync } from 'class-validator';
import { CheckSourceAvailabilityDto } from './dto/check-source-availability.dto';
import {
  loadSourceAvailabilityBatched,
  SOURCE_AVAILABILITY_BATCH_SIZE,
} from '../../web/src/lib/source-availability';

describe('customer source availability at real discovered-account scale', () => {
  const foreignSource = '120363000000000001@g.us';
  const sources = [
    foreignSource,
    ...Array.from({ length: 117 }, (_, index) => `group-${index}@g.us`),
    ...Array.from({ length: 422 }, (_, index) => `contact-${index}@c.us`),
  ];

  it('checks 118 groups and 422 contacts within the packaged backend DTO limit', async () => {
    const requestBatch = jest.fn(async (sourceIds: string[]) => {
      const dto = new CheckSourceAvailabilityDto();
      dto.sourceIds = sourceIds;
      expect(validateSync(dto)).toEqual([]);
      return sourceIds.map((sourceId) => ({
        sourceId,
        status: sourceId === foreignSource ? 'mapped-elsewhere' as const : 'available' as const,
      }));
    });

    const result = await loadSourceAvailabilityBatched(sources, requestBatch);

    expect(sources).toHaveLength(540);
    expect(SOURCE_AVAILABILITY_BATCH_SIZE).toBeLessThanOrEqual(500);
    expect(requestBatch.mock.calls.map(([batch]) => batch.length)).toEqual([200, 200, 140]);
    expect(result.statuses[foreignSource]).toBe('mapped-elsewhere');
    expect(Object.keys(result.statuses)).toHaveLength(540);
    expect(result.unavailableCount).toBe(0);
  });

  it('never marks a failed batch available and permits a targeted retry', async () => {
    const requestBatch = jest.fn(async (sourceIds: string[]) => {
      if (sourceIds.includes(foreignSource)) throw new Error('lookup unavailable');
      return sourceIds.map((sourceId) => ({ sourceId, status: 'available' as const }));
    });

    const result = await loadSourceAvailabilityBatched(sources, requestBatch);
    expect(result.statuses[foreignSource]).toBeUndefined();
    expect(result.unavailableCount).toBe(200);
    expect(result.statuses[sources[201]]).toBe('available');

    const retry = await loadSourceAvailabilityBatched([foreignSource], async (sourceIds) =>
      sourceIds.map((sourceId) => ({ sourceId, status: 'mapped-elsewhere' as const })),
    );
    expect(retry.statuses[foreignSource]).toBe('mapped-elsewhere');
  });

  it('treats incomplete or unexpected backend responses as unavailable', async () => {
    const incomplete = await loadSourceAvailabilityBatched([foreignSource], async () => []);
    expect(incomplete.statuses[foreignSource]).toBeUndefined();
    expect(incomplete.unavailableCount).toBe(1);

    const unexpected = await loadSourceAvailabilityBatched([foreignSource], async () => [
      { sourceId: 'another-source', status: 'available' },
    ]);
    expect(unexpected.statuses[foreignSource]).toBeUndefined();
    expect(unexpected.unavailableCount).toBe(1);
  });
});
