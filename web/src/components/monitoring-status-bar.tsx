import { formatLastUpdated } from '../lib/use-live-refresh';
import { formatMonitoringStateUpdateTime } from '../lib/monitoring-state';
import { useMonitoring } from '../state/monitoring';
import { OpsStatusPill } from './operator-ui';
import { StatusBadge } from './ui';

export function MonitoringStatusBar({
  showRefresh = false,
  compact = false,
}: {
  showRefresh?: boolean;
  compact?: boolean;
}): JSX.Element | null {
  const { view, status, lastFetchedAt, lastStateUpdateAt, refresh, isLoading, isBusy, pollIntervalMs } =
    useMonitoring();

  if (!status) {
    return null;
  }

  return (
    <div className={`monitoring-status-bar${compact ? ' monitoring-status-bar-compact' : ''}`}>
      <div className="monitoring-status-bar-main">
        <OpsStatusPill tone={view.opsTone} label={view.label} />
        <StatusBadge value={view.statusBadge} />
        {!compact ? <span className="muted-text">{view.stageLabel}</span> : null}
      </div>
      <div className="monitoring-status-bar-meta muted-text">
        <span>
          State updated: <strong>{formatMonitoringStateUpdateTime(lastStateUpdateAt)}</strong>
        </span>
        <span>
          Polled: <strong>{formatLastUpdated(lastFetchedAt)}</strong>
          {!compact ? ` · every ${pollIntervalMs / 1000}s` : ''}
        </span>
        {showRefresh ? (
          <button type="button" className="secondary-button" disabled={isLoading || isBusy} onClick={() => void refresh()}>
            Refresh
          </button>
        ) : null}
      </div>
    </div>
  );
}
