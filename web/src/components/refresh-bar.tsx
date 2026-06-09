import { formatLastUpdated } from '../lib/use-live-refresh';

export function RefreshBar({
  lastUpdated,
  pollIntervalSeconds,
  onRefresh,
  isRefreshing = false,
}: {
  lastUpdated: Date | null;
  pollIntervalSeconds: number;
  onRefresh: () => void;
  isRefreshing?: boolean;
}): JSX.Element {
  return (
    <div className="refresh-bar">
      <span className="refresh-bar-status">
        Last updated: <strong>{formatLastUpdated(lastUpdated)}</strong>
        <span className="muted-text"> · auto every {pollIntervalSeconds}s when visible</span>
      </span>
      <button type="button" className="secondary-button" disabled={isRefreshing} onClick={() => void onRefresh()}>
        {isRefreshing ? 'Refreshing…' : 'Refresh'}
      </button>
    </div>
  );
}
