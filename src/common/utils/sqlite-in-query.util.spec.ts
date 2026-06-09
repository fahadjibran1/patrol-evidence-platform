import {
  SQLITE_IN_CLAUSE_CHUNK_SIZE,
  chunkIdsForSqliteIn,
  queryWithChunkedInClause,
  requiresSqliteInChunking,
} from './sqlite-in-query.util';

describe('sqlite-in-query.util', () => {
  it('deduplicates ids and chunks large lists', () => {
    const ids = Array.from({ length: 301 }, (_, index) => `id-${index % 250}`);
    const chunks = chunkIdsForSqliteIn(ids, 150);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(150);
    expect(chunks[1]).toHaveLength(100);
  });

  it('detects when chunking is required', () => {
    const ids = Array.from({ length: SQLITE_IN_CLAUSE_CHUNK_SIZE + 1 }, (_, index) => `id-${index}`);
    expect(requiresSqliteInChunking(ids)).toBe(true);
    expect(requiresSqliteInChunking(ids.slice(0, SQLITE_IN_CLAUSE_CHUNK_SIZE))).toBe(false);
  });

  it('merges chunked query results in order', async () => {
    const ids = Array.from({ length: 250 }, (_, index) => `id-${index}`);
    const chunkingSpy = jest.fn();

    const results = await queryWithChunkedInClause(ids, {
      column: 'siteId',
      onChunking: chunkingSpy,
      queryChunk: async (chunkIds) => chunkIds.map((id) => ({ id })),
    });

    expect(results).toHaveLength(250);
    expect(chunkingSpy).toHaveBeenCalledWith({
      column: 'siteId',
      idCount: 250,
      chunkCount: 2,
      chunkSize: SQLITE_IN_CLAUSE_CHUNK_SIZE,
    });
  });
});
