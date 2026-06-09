import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiRequest, getApiBaseUrl } from '../lib/api';
import {
  findPatrolGroup,
  formatOperatorDateTime,
  nextPatrolHint,
  patrolCompliancePercent,
  siteOpsTone,
} from '../lib/operator-ui';
import { findActivePatrolSchedule } from '../lib/patrol-schedule';
import { getPatrolTimeParts, getPatrolToday } from '../lib/patrol-time';
import { useLiveRefresh } from '../lib/use-live-refresh';
import { LatestEvidenceList, LoadingBlock, SiteControlCard, type PatrolTimelineCell } from '../components/operator-ui';
import { RefreshBar } from '../components/refresh-bar';
import { useAuth } from '../state/auth';
import type {
  DashboardHourlySafetyRow,
  DashboardOverview,
  DashboardSiteRow,
  PatrolGroup,
  PatrolImageRecord,
  PatrolSchedule,
} from '../types';
import { MonitoringStatusBar } from '../components/monitoring-status-bar';
import { Card, EmptyState, MetricCard, PageHeader } from '../components/ui';

const DASHBOARD_POLL_MS = 60_000;

export function DashboardPage(): JSX.Element {
  const navigate = useNavigate();
  const { token, user } = useAuth();
  const [date, setDate] = useState(getPatrolToday());
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [rows, setRows] = useState<DashboardSiteRow[]>([]);
  const [hourlySafetyRows, setHourlySafetyRows] = useState<DashboardHourlySafetyRow[]>([]);
  const [groups, setGroups] = useState<PatrolGroup[]>([]);
  const [schedules, setSchedules] = useState<PatrolSchedule[]>([]);
  const [latestImages, setLatestImages] = useState<PatrolImageRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const boardRef = useRef<HTMLDivElement>(null);
  const dateFilterRef = useRef(date);

  const baseUrl = useMemo(() => getApiBaseUrl(), []);

  const loadDashboard = useCallback(async () => {
    if (user?.role === 'GUARD') {
      return;
    }

    setError(null);

    try {
    const [nextOverview, nextRows, nextHourly, nextGroups, nextSchedules, nextImages] = await Promise.all([
      apiRequest<DashboardOverview>(`/dashboard/overview?date=${date}`, {}, token ?? undefined),
      apiRequest<DashboardSiteRow[]>(`/dashboard/sites?date=${date}`, {}, token ?? undefined),
      apiRequest<DashboardHourlySafetyRow[]>(`/dashboard/hourly-safety?date=${date}`, {}, token ?? undefined),
      apiRequest<PatrolGroup[]>('/patrol-groups', {}, token ?? undefined),
      apiRequest<PatrolSchedule[]>('/patrol-schedules', {}, token ?? undefined),
      apiRequest<PatrolImageRecord[]>(`/patrol-images?date=${date}`, {}, token ?? undefined),
    ]);

    setOverview(nextOverview);
    setRows(nextRows);
    setHourlySafetyRows(nextHourly);
    setGroups(nextGroups);
    setSchedules(nextSchedules);
    setLatestImages(
      [...nextImages].sort((left, right) => new Date(right.sentAt).getTime() - new Date(left.sentAt).getTime()).slice(0, 6),
    );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load dashboard');
    }
  }, [date, token, user?.role]);

  const { lastUpdated, isLoading, refresh, markFiltersChanged } = useLiveRefresh(
    loadDashboard,
    DASHBOARD_POLL_MS,
    user?.role !== 'GUARD',
  );

  useEffect(() => {
    if (dateFilterRef.current === date) {
      return;
    }

    dateFilterRef.current = date;
    markFiltersChanged();
  }, [date, markFiltersChanged]);

  useEffect(() => {
    function onFullscreenChange(): void {
      const active = document.fullscreenElement === boardRef.current;
      setIsFullscreen(active);
    }

    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  const hourlyBySite = useMemo(() => {
    const map = new Map<string, DashboardHourlySafetyRow>();
    for (const row of hourlySafetyRows) {
      map.set(row.siteId, row);
    }
    return map;
  }, [hourlySafetyRows]);

  const activeScheduleBySite = useMemo(() => {
    const now = getPatrolTimeParts(new Date());
    const map = new Map<string, PatrolSchedule>();
    const siteIds = [...new Set(schedules.map((schedule) => schedule.siteId))];

    for (const siteId of siteIds) {
      const active = findActivePatrolSchedule(schedules, siteId, date, now.hour);
      if (active) {
        map.set(siteId, active);
      }
    }

    return map;
  }, [date, schedules]);

  const showOnboarding =
    (overview?.siteTotals.active ?? 0) === 0 || (overview?.imageTotals.received ?? 0) === 0;

  const imageUrl = (image: PatrolImageRecord): string =>
    `${baseUrl}/patrol-images/${image.id}/content?access_token=${encodeURIComponent(token ?? '')}`;

  async function toggleControlRoomView(): Promise<void> {
    if (!boardRef.current) {
      return;
    }

    if (document.fullscreenElement === boardRef.current) {
      await document.exitFullscreen();
      return;
    }

    await boardRef.current.requestFullscreen();
  }

  if (user?.role === 'GUARD') {
    return (
      <EmptyState
        title="Operations dashboard is for supervisors"
        description="Use Patrol Ops, Evidence, and Alerts for your shift."
      />
    );
  }

  return (
    <div
      ref={boardRef}
      className={`control-room-board dashboard-shell soc-page dashboard-density-compact${isFullscreen ? ' control-room-fullscreen-active' : ''}`}
    >
      <div className="control-room-toolbar">
        <PageHeader
          title="Operations Control Room"
          subtitle="Live patrol compliance across all secured sites."
          actions={
            <div className="control-room-toolbar-actions">
              <label className="inline-field">
                <span>Operations date</span>
                <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
              </label>
              <button type="button" className="secondary-button" onClick={() => void toggleControlRoomView()}>
                {isFullscreen ? 'Exit fullscreen' : 'Control Room View'}
              </button>
            </div>
          }
        />
        <RefreshBar
          lastUpdated={lastUpdated}
          pollIntervalSeconds={DASHBOARD_POLL_MS / 1000}
          onRefresh={refresh}
          isRefreshing={isLoading}
        />
        <MonitoringStatusBar compact />
      </div>

      {isFullscreen ? (
        <button type="button" className="primary-button control-room-exit" onClick={() => void toggleControlRoomView()}>
          Exit Control Room
        </button>
      ) : null}

      {error ? (
        <Card>
          <p className="error-text">{error}</p>
        </Card>
      ) : null}

      {isLoading && !overview ? (
        <LoadingBlock label="Loading operations dashboard…" />
      ) : overview ? (
        <>
          <div className="metrics-grid compact control-room-kpis">
            <MetricCard label="Active sites" value={overview.siteTotals.active} />
            <MetricCard label="Patrol images" value={overview.imageTotals.received} tone="success" />
            <MetricCard label="Open alerts" value={overview.alerts.unresolved} tone="danger" />
            <MetricCard label="Scheduled coverage" value={overview.siteTotals.withScheduledSlots} />
          </div>

          {showOnboarding && !isFullscreen ? (
            <Card className="onboarding-card onboarding-card-compact">
              <p className="muted-text">
                Complete setup on <Link to="/collector">Monitoring</Link> and <Link to="/setup">Setup</Link> to populate
                this board.
              </p>
            </Card>
          ) : null}

          <div className="control-room-main">
            <section className="site-control-grid">
              {rows.length === 0 ? (
                <EmptyState
                  title="No sites on the board"
                  description="Create a site and map a WhatsApp source to see live compliance cards."
                />
              ) : (
                rows.map((row) => {
                  const hourly = hourlyBySite.get(row.siteId);
                  const group = findPatrolGroup(groups, row.siteId);
                  const schedule = activeScheduleBySite.get(row.siteId);
                  const tone = siteOpsTone(row);
                  const timelineCells: PatrolTimelineCell[] =
                    hourly?.hourlyCells.map((cell) => ({
                      hour: cell.hour,
                      status: cell.status,
                      firstPictureTime: cell.firstPictureTime,
                      senderLabel: cell.firstSenderName,
                    })) ??
                    Array.from({ length: 24 }, (_, hour) => ({
                      hour,
                      status: 'Pending' as const,
                      firstPictureTime: null,
                    }));

                  return (
                    <SiteControlCard
                      key={row.siteId}
                      dense
                      siteCode={row.siteCode}
                      siteName={row.siteName}
                      sourceLabel={group?.groupName ?? hourly?.groupName ?? 'Not mapped'}
                      tone={tone}
                      compliancePercent={patrolCompliancePercent(row)}
                      lastPatrolLabel={formatOperatorDateTime(row.latestImageAt)}
                      nextPatrolLabel={nextPatrolHint(schedule, hourly?.hourlyCells, date)}
                      imagesToday={row.imagesReceived}
                      alertsOpen={row.unresolvedAlerts}
                      timelineCells={timelineCells}
                      actions={
                        !isFullscreen ? (
                          <>
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() =>
                                navigate(
                                  `/evidence?siteCode=${encodeURIComponent(row.siteCode)}&date=${encodeURIComponent(date)}`,
                                )
                              }
                            >
                              Evidence
                            </button>
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() =>
                                navigate(
                                  `/guard-safe?siteCode=${encodeURIComponent(row.siteCode)}&date=${encodeURIComponent(date)}`,
                                )
                              }
                            >
                              Guard Safe
                            </button>
                          </>
                        ) : null
                      }
                    />
                  );
                })
              )}
            </section>

            <aside className="control-room-evidence-panel">
              <Card>
                <div className="section-header">
                  <div>
                    <h3>Latest evidence</h3>
                    <p className="muted-text">Recent patrol captures</p>
                  </div>
                  {!isFullscreen ? (
                    <Link className="secondary-button" to={`/evidence?date=${encodeURIComponent(date)}`}>
                      View all
                    </Link>
                  ) : null}
                </div>
                <LatestEvidenceList
                  images={latestImages}
                  imageUrl={imageUrl}
                  groups={groups}
                  onSelect={(image) =>
                    navigate(
                      `/evidence?siteCode=${encodeURIComponent(image.site?.siteCode ?? '')}&date=${encodeURIComponent(date)}`,
                    )
                  }
                />
              </Card>

              {!isFullscreen ? (
                <Card className="slot-summary-compact">
                  <h3>Patrol slots</h3>
                  <div className="metric-list">
                    {Object.entries(overview.slotTotals).map(([key, value]) => (
                      <div key={key} className="metric-list-row">
                        <span>{key}</span>
                        <strong>{value}</strong>
                      </div>
                    ))}
                  </div>
                </Card>
              ) : null}
            </aside>
          </div>
        </>
      ) : null}
    </div>
  );
}
