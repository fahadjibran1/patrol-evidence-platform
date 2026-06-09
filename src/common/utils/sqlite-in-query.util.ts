/** SQLite expression trees overflow around ~1000 bound IDs; stay safely under that limit. */
export const SQLITE_IN_CLAUSE_CHUNK_SIZE = 150;

export function chunkIdsForSqliteIn<T extends string>(
  ids: readonly T[],
  chunkSize = SQLITE_IN_CLAUSE_CHUNK_SIZE,
): T[][] {
  const unique = [...new Set(ids.filter((id): id is T => Boolean(id)))];
  if (unique.length === 0) {
    return [];
  }

  const chunks: T[][] = [];
  for (let index = 0; index < unique.length; index += chunkSize) {
    chunks.push(unique.slice(index, index + chunkSize));
  }

  return chunks;
}

export function requiresSqliteInChunking(
  ids: readonly unknown[],
  chunkSize = SQLITE_IN_CLAUSE_CHUNK_SIZE,
): boolean {
  return new Set(ids.filter(Boolean)).size > chunkSize;
}

export interface SqliteInChunkingDetails {
  column: string;
  idCount: number;
  chunkCount: number;
  chunkSize: number;
}

export async function queryWithChunkedInClause<T, TId extends string>(
  ids: readonly TId[],
  options: {
    column: string;
    chunkSize?: number;
    onChunking?: (details: SqliteInChunkingDetails) => void;
    queryChunk: (chunkIds: TId[]) => Promise<T[]>;
  },
): Promise<T[]> {
  const chunkSize = options.chunkSize ?? SQLITE_IN_CLAUSE_CHUNK_SIZE;
  const chunks = chunkIdsForSqliteIn(ids, chunkSize);
  const idCount = new Set(ids.filter(Boolean)).size;

  if (chunks.length === 0) {
    return [];
  }

  if (chunks.length > 1 && options.onChunking) {
    options.onChunking({
      column: options.column,
      idCount,
      chunkCount: chunks.length,
      chunkSize,
    });
  }

  const results = await Promise.all(chunks.map((chunkIds) => options.queryChunk(chunkIds)));
  return results.flat();
}
