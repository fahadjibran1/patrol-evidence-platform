import { useEffect, useMemo, useState } from 'react';
import { fetchApiBlobUrl } from './api';

const EMPTY_IMAGE = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

export function useAuthenticatedPatrolImageUrls(imageIds: string[], token: string | null): (imageId: string) => string {
  const stableIds = useMemo(() => [...new Set(imageIds)].sort(), [imageIds.join('|')]);
  const [urls, setUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    const allocated: string[] = [];
    setUrls({});

    void Promise.all(
      stableIds.map(async (imageId) => {
        try {
          const url = await fetchApiBlobUrl(`/patrol-images/${encodeURIComponent(imageId)}/content`, token ?? undefined);
          if (cancelled) {
            window.URL.revokeObjectURL(url);
            return;
          }
          allocated.push(url);
          setUrls((current) => ({ ...current, [imageId]: url }));
        } catch {
          // Existing broken-file UI remains responsible for presenting unavailable evidence.
        }
      }),
    );

    return () => {
      cancelled = true;
      for (const url of allocated) window.URL.revokeObjectURL(url);
    };
  }, [stableIds, token]);

  return (imageId: string) => urls[imageId] ?? EMPTY_IMAGE;
}
