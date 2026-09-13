import { formatMonitoringStateUpdateTime } from '../lib/monitoring-state';
import { useMonitoring } from '../state/monitoring';

export function MonitoringStatusBar({
  showRefresh = false,
  compact = false,
}: {
  showRefresh?: boolean;
  compact?: boolean;
}): JSX.Element | null {
  const { view, status, lastStateUpdateAt, refresh, isLoading, isBusy } =
    useMonitoring();

  if (!status) {
    return null;
  }

  return (
    <div className={`monitoring-status-bar${compact ? ' monitoring-status-bar-compact' : ''}`}>
      <div className="monitoring-status-bar-main">
        <div className="monitoring-state-summary">
          <span>WhatsApp</span>
          <strong>{view.connectionLabel}</strong>
        </div>
        <div className="monitoring-state-summary">
          <span>Monitoring</span>
          <strong>{view.label}</strong>
        </div>
      </div>
      <div className="monitoring-status-bar-meta muted-text">
        <span>
          Last update: <strong>{formatMonitoringStateUpdateTime(lastStateUpdateAt)}</strong>
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
