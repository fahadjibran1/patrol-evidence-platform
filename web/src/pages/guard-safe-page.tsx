import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiRequest } from '../lib/api';
import { customerErrorMessage } from '../lib/customer-errors';
import { buildSenderPersonKey, buildSiteSenderMergeKey, canonicalSenderKey, senderIdentityKeysOverlap, stripSourceFromSenderName } from '../lib/sender-identity';
import { formatPatrolTime, getPatrolTimeParts, getPatrolToday } from '../lib/patrol-time';
import { useLiveRefresh } from '../lib/use-live-refresh';
import { LoadingBlock, PatrolTimeline } from '../components/operator-ui';
import { RefreshBar } from '../components/refresh-bar';
import { useAuth } from '../state/auth';
import type { DashboardHourlyGuardStatusRow, PatrolGroup, PatrolImageRecord, Site } from '../types';
import { Card, EmptyState, PageHeader } from '../components/ui';

const GUARD_SAFE_POLL_MS = 180_000;

function today(): string {
  return getPatrolToday();
}

function formatHour(hour: number): string {
  return String(hour).padStart(2, '0');
}

type GuardHourCellStatus = 'Safe' | 'Missing' | 'Pending';

interface GuardSafeHourCell {
  hour: number;
  status: GuardHourCellStatus;
  firstPictureTime: string | null;
  totalPicturesInHour: number;
  senderLabel: string | null;
}

interface GuardSafeGridRow {
  siteId: string;
  siteCode: string;
  siteName: string;
  personKey: string;
  guardName: string;
  sourceLabel: string | null;
  senderKey: string | null;
  senderExternalId: string | null;
  senderNumber: string | null;
  hourlyCells: GuardSafeHourCell[];
  safeCount: number;
  missingCount: number;
}

interface GuardSafeGridRowSeed {
  siteId: string;
  siteCode: string;
  siteName: string;
  personKey: string;
  guardName: string;
  sourceLabel: string | null;
  senderKey: string | null;
  senderExternalId: string | null;
  senderNumber: string | null;
  hourlyCells: GuardSafeHourCell[];
}

interface GuardOption {
  value: string;
  label: string;
}

function escapeCsv(value: string): string {
  if (!/[,"\n]/.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '""')}"`;
}

function downloadCsv(fileName: string, rows: string[][]): void {
  const csv = rows.map((row) => row.map((value) => escapeCsv(value)).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const blobUrl = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = blobUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(blobUrl);
}

function derivePending(date: string, hour: number): boolean {
  const currentPatrolTime = getPatrolTimeParts(new Date());
  return date === currentPatrolTime.date && hour >= currentPatrolTime.hour;
}

function defaultHourStatus(date: string, hour: number): GuardHourCellStatus {
  return derivePending(date, hour) ? 'Pending' : 'Missing';
}

function buildEmptyCells(date: string, senderLabel: string | null): GuardSafeHourCell[] {
  return Array.from({ length: 24 }, (_, hour) => ({
    hour,
    status: defaultHourStatus(date, hour),
    firstPictureTime: null,
    totalPicturesInHour: 0,
    senderLabel,
  }));
}

function statusRank(status: GuardHourCellStatus): number {
  if (status === 'Safe') {
    return 3;
  }

  if (status === 'Pending') {
    return 2;
  }

  return 1;
}

function mergeHourCell(left: GuardSafeHourCell, right: GuardSafeHourCell): GuardSafeHourCell {
  if (statusRank(right.status) > statusRank(left.status)) {
    return { ...right };
  }

  if (statusRank(right.status) < statusRank(left.status)) {
    return { ...left };
  }

  if (left.status === 'Safe') {
    const firstPictureTime =
      left.firstPictureTime && right.firstPictureTime
        ? left.firstPictureTime < right.firstPictureTime
          ? left.firstPictureTime
          : right.firstPictureTime
        : left.firstPictureTime ?? right.firstPictureTime;

    return {
      hour: left.hour,
      status: 'Safe',
      firstPictureTime,
      totalPicturesInHour: left.totalPicturesInHour + right.totalPicturesInHour,
      senderLabel: left.senderLabel ?? right.senderLabel,
    };
  }

  return { ...left };
}

function rowMergeKey(row: Pick<GuardSafeGridRowSeed, 'siteId' | 'senderExternalId' | 'senderNumber' | 'personKey'>): string {
  return (
    buildSiteSenderMergeKey(row.siteId, {
      senderExternalId: row.senderExternalId,
      senderNumber: row.senderNumber,
    }) ?? `${row.siteId}:unknown:${row.personKey}`
  );
}

function findOverlappingRowKey(
  rowMap: Map<string, GuardSafeGridRowSeed>,
  row: GuardSafeGridRowSeed,
): string | null {
  for (const [key, existing] of rowMap.entries()) {
    if (existing.siteId !== row.siteId) {
      continue;
    }

    if (
      senderIdentityKeysOverlap(
        {
          senderExternalId: existing.senderExternalId,
          senderNumber: existing.senderNumber,
        },
        {
          senderExternalId: row.senderExternalId,
          senderNumber: row.senderNumber,
        },
      )
    ) {
      return key;
    }
  }

  return null;
}

function mergeGridRows(primary: GuardSafeGridRow[], secondary: GuardSafeGridRow[]): GuardSafeGridRow[] {
  const rowMap = new Map<string, GuardSafeGridRowSeed>();

  const upsert = (row: GuardSafeGridRow): void => {
    const overlappingKey = findOverlappingRowKey(rowMap, row);
    const mapKey = overlappingKey ?? rowMergeKey(row);
    const existing = rowMap.get(mapKey);

    if (!existing) {
      rowMap.set(mapKey, {
        siteId: row.siteId,
        siteCode: row.siteCode,
        siteName: row.siteName,
        personKey: row.personKey,
        guardName: row.guardName,
        sourceLabel: row.sourceLabel,
        senderKey: row.senderKey,
        senderExternalId: row.senderExternalId,
        senderNumber: row.senderNumber,
        hourlyCells: row.hourlyCells.map((cell) => ({ ...cell })),
      });
      return;
    }

    for (let hour = 0; hour < 24; hour += 1) {
      existing.hourlyCells[hour] = mergeHourCell(existing.hourlyCells[hour], row.hourlyCells[hour]);
    }

    if (existing.guardName === 'Unknown sender' && row.guardName !== 'Unknown sender') {
      existing.guardName = row.guardName;
    }

    if (!existing.sourceLabel && row.sourceLabel) {
      existing.sourceLabel = row.sourceLabel;
    }

    if (!existing.senderExternalId && row.senderExternalId) {
      existing.senderExternalId = row.senderExternalId;
    }

    if (!existing.senderNumber && row.senderNumber) {
      existing.senderNumber = row.senderNumber;
    }
  };

  for (const row of primary) {
    upsert(row);
  }

  for (const row of secondary) {
    upsert(row);
  }

  return [...rowMap.values()]
    .sort((left, right) => {
      const siteOrder = left.siteCode.localeCompare(right.siteCode);
      if (siteOrder !== 0) {
        return siteOrder;
      }

      return left.guardName.localeCompare(right.guardName);
    })
    .map((row) => ({
      ...row,
      safeCount: row.hourlyCells.filter((cell) => cell.status === 'Safe').length,
      missingCount: row.hourlyCells.filter((cell) => cell.status === 'Missing').length,
    }));
}

function resolveImageSender(image: PatrolImageRecord, groups: PatrolGroup[]): {
  personKey: string;
  guardName: string;
  sourceLabel: string | null;
  senderKey: string | null;
  senderExternalId: string | null;
  senderNumber: string | null;
  senderLabel: string | null;
} {
  const senderName = image.senderName?.trim();
  const senderNumber = image.senderNumber?.trim() ?? null;
  const senderExternalId = image.senderExternalId?.trim() ?? null;
  const sourceLabel = image.group?.groupName ?? groups.find((group) => group.id === image.groupId)?.groupName ?? null;
  const senderKey = canonicalSenderKey({ senderExternalId, senderNumber, senderName });
  const guardName = stripSourceFromSenderName(senderName) || senderNumber || 'Unknown sender';

  return {
    personKey: senderKey ? buildSenderPersonKey(senderKey) : `unknown:${image.id}`,
    guardName,
    sourceLabel,
    senderKey,
    senderExternalId,
    senderNumber,
    senderLabel: guardName,
  };
}

function personKeyForGuard(guard: DashboardHourlyGuardStatusRow['expectedGuards'][number]): string {
  const senderKey = canonicalSenderKey({ senderNumber: guard.senderNumber });
  if (senderKey) {
    return buildSenderPersonKey(senderKey);
  }

  return `guard:${guard.guardId}`;
}

export function GuardSafePage(): JSX.Element {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { token, user } = useAuth();
  const [sites, setSites] = useState<Site[]>([]);
  const [groups, setGroups] = useState<PatrolGroup[]>([]);
  const [guardRows, setGuardRows] = useState<DashboardHourlyGuardStatusRow[]>([]);
  const [patrolImages, setPatrolImages] = useState<PatrolImageRecord[]>([]);
  const [selectedDate, setSelectedDate] = useState(searchParams.get('date') ?? today());
  const [selectedSiteId, setSelectedSiteId] = useState('');
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [selectedPersonKey, setSelectedPersonKey] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const siteCodeFromUrl = searchParams.get('siteCode')?.trim();
    if (!siteCodeFromUrl || selectedSiteId || sites.length === 0) {
      return;
    }

    const matchingSite = sites.find((site) => site.siteCode === siteCodeFromUrl);
    if (matchingSite) {
      setSelectedSiteId(matchingSite.id);
    }
  }, [searchParams, selectedSiteId, sites]);

  useEffect(() => {
    async function loadLookups(): Promise<void> {
      const [nextSites, nextGroups] = await Promise.all([
        apiRequest<Site[]>('/sites', {}, token ?? undefined),
        apiRequest<PatrolGroup[]>('/patrol-groups', {}, token ?? undefined),
      ]);

      setSites(nextSites.filter((site) => site.active));
      setGroups(nextGroups);
    }

    void loadLookups().catch((loadError) =>
      setError(customerErrorMessage(loadError, 'Guard Safe filters could not be loaded. Try again.')),
    );
  }, [token]);

  const loadGuardSafeData = useCallback(async () => {
    setError(null);

    try {
    const structuredSearch = new URLSearchParams({ date: selectedDate });
    const selectedSite = sites.find((site) => site.id === selectedSiteId);
    if (selectedSiteId) {
      structuredSearch.set('siteCode', selectedSite?.siteCode ?? '');
    }
    if (selectedGroupId) {
      structuredSearch.set('groupId', selectedGroupId);
    }

    const evidenceSearch = new URLSearchParams({ date: selectedDate });
    if (selectedSiteId) {
      evidenceSearch.set('siteId', selectedSiteId);
    }

    const [nextRows, nextImages] = await Promise.all([
      apiRequest<DashboardHourlyGuardStatusRow[]>(
        `/dashboard/hourly-guard-status?${structuredSearch.toString()}`,
        {},
        token ?? undefined,
      ),
      apiRequest<PatrolImageRecord[]>(`/patrol-images?${evidenceSearch.toString()}`, {}, token ?? undefined),
    ]);

    setGuardRows(nextRows);
    setPatrolImages(nextImages);
    } catch (loadError) {
      setError(customerErrorMessage(loadError, 'The Guard Safe report could not be loaded. Try again.'));
    }
  }, [selectedDate, selectedGroupId, selectedSiteId, sites, token]);

  const { lastUpdated, isLoading, refresh, markFiltersChanged } = useLiveRefresh(
    loadGuardSafeData,
    GUARD_SAFE_POLL_MS,
    Boolean(token) && user?.role !== 'GUARD',
  );

  const filterKeyRef = useRef(`${selectedDate}|${selectedSiteId}|${selectedGroupId}`);

  useEffect(() => {
    const nextKey = `${selectedDate}|${selectedSiteId}|${selectedGroupId}`;
    if (filterKeyRef.current === nextKey) {
      return;
    }

    filterKeyRef.current = nextKey;
    markFiltersChanged();
  }, [markFiltersChanged, selectedDate, selectedGroupId, selectedSiteId]);

  const visibleGroups = useMemo(() => {
    if (!selectedSiteId) {
      return groups;
    }

    return groups.filter((group) => group.siteId === selectedSiteId);
  }, [groups, selectedSiteId]);

  const siteById = useMemo(() => {
    const map = new Map<string, Site>();
    for (const site of sites) {
      map.set(site.id, site);
    }
    return map;
  }, [sites]);

  const filteredPatrolImages = useMemo(() => {
    return patrolImages.filter((image) => {
      if (selectedSiteId && image.siteId !== selectedSiteId) {
        return false;
      }

      if (selectedGroupId && (image.groupId ?? '') !== selectedGroupId) {
        return false;
      }

      return true;
    });
  }, [patrolImages, selectedGroupId, selectedSiteId]);

  const structuredGridRows = useMemo<GuardSafeGridRow[]>(() => {
    const rowMap = new Map<string, GuardSafeGridRowSeed>();

    for (const row of guardRows) {
      for (const guard of row.expectedGuards) {
        const personKey = personKeyForGuard(guard);
        const senderNumber = guard.senderNumber?.trim() ?? null;
        const senderKey = canonicalSenderKey({ senderNumber });
        const guardName =
          stripSourceFromSenderName(guard.guardName) || senderNumber || guard.guardName || 'Unknown sender';
        const sourceLabel = row.groupName;
        const seed: GuardSafeGridRowSeed = {
          siteId: row.siteId,
          siteCode: row.siteCode,
          siteName: row.siteName,
          personKey,
          guardName,
          sourceLabel,
          senderKey,
          senderExternalId: null,
          senderNumber,
          hourlyCells: buildEmptyCells(selectedDate, guardName),
        };
        const mapKey = findOverlappingRowKey(rowMap, seed) ?? rowMergeKey(seed);
        const existing = rowMap.get(mapKey) ?? seed;

        existing.hourlyCells[row.hour] = {
          hour: row.hour,
          status:
            guard.status === 'Reported'
              ? 'Safe'
              : row.siteStatus === 'Pending'
                ? 'Pending'
                : 'Missing',
          firstPictureTime: guard.firstPictureTime,
          totalPicturesInHour: guard.totalPicturesInHour,
          senderLabel: guardName,
        };

        rowMap.set(mapKey, existing);
      }
    }

    return [...rowMap.values()].map((row) => ({
      ...row,
      safeCount: row.hourlyCells.filter((cell) => cell.status === 'Safe').length,
      missingCount: row.hourlyCells.filter((cell) => cell.status === 'Missing').length,
    }));
  }, [guardRows, selectedDate]);

  const observedGridRows = useMemo<GuardSafeGridRow[]>(() => {
    const rowMap = new Map<string, GuardSafeGridRowSeed>();

    for (const image of filteredPatrolImages) {
      const site = image.site ?? siteById.get(image.siteId);
      if (!site) {
        continue;
      }

      const sender = resolveImageSender(image, groups);
      const seed: GuardSafeGridRowSeed = {
        siteId: image.siteId,
        siteCode: site.siteCode,
        siteName: site.siteName,
        personKey: sender.personKey,
        guardName: sender.guardName,
        sourceLabel: sender.sourceLabel,
        senderKey: sender.senderKey,
        senderExternalId: sender.senderExternalId,
        senderNumber: sender.senderNumber,
        hourlyCells: buildEmptyCells(selectedDate, sender.senderLabel),
      };
      const mapKey = findOverlappingRowKey(rowMap, seed) ?? rowMergeKey(seed);
      const existing = rowMap.get(mapKey) ?? seed;
      const patrolHour = getPatrolTimeParts(new Date(image.sentAt)).hour;
      const currentCell = existing.hourlyCells[patrolHour];
      existing.hourlyCells[patrolHour] = {
        hour: patrolHour,
        status: 'Safe',
        firstPictureTime:
          currentCell.firstPictureTime && currentCell.firstPictureTime < image.sentAt
            ? currentCell.firstPictureTime
            : image.sentAt,
        totalPicturesInHour: currentCell.totalPicturesInHour + 1,
        senderLabel: sender.senderLabel,
      };

      rowMap.set(mapKey, existing);
    }

    return [...rowMap.values()].map((row) => ({
      ...row,
      safeCount: row.hourlyCells.filter((cell) => cell.status === 'Safe').length,
      missingCount: row.hourlyCells.filter((cell) => cell.status === 'Missing').length,
    }));
  }, [filteredPatrolImages, groups, selectedDate, siteById]);

  const combinedGridRows = useMemo(
    () => mergeGridRows(observedGridRows, structuredGridRows),
    [observedGridRows, structuredGridRows],
  );

  const activeGridRows = useMemo(() => {
    return combinedGridRows.filter((row) => !selectedPersonKey || row.personKey === selectedPersonKey);
  }, [combinedGridRows, selectedPersonKey]);

  const siteGroupedRows = useMemo(() => {
    const groups = new Map<string, GuardSafeGridRow[]>();

    for (const row of activeGridRows) {
      const bucket = groups.get(row.siteCode) ?? [];
      bucket.push(row);
      groups.set(row.siteCode, bucket);
    }

    return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [activeGridRows]);

  const personOptions = useMemo<GuardOption[]>(() => {
    const optionMap = new Map<string, GuardOption>();

    for (const row of combinedGridRows) {
      if (!optionMap.has(row.personKey)) {
        optionMap.set(row.personKey, {
          value: row.personKey,
          label: `${row.guardName} (${row.siteCode})`,
        });
      }
    }

    return [...optionMap.values()].sort((left, right) => left.label.localeCompare(right.label));
  }, [combinedGridRows]);

  useEffect(() => {
    if (selectedPersonKey && !personOptions.some((option) => option.value === selectedPersonKey)) {
      setSelectedPersonKey('');
    }
  }, [personOptions, selectedPersonKey]);

  function handleExport(): void {
    const rows = [
      [
        'Date',
        'Site Code',
        'Site Name',
        'Sender / Guard',
        'Hour',
        'Status',
        'First Picture Time',
        'Total Pictures In Hour',
      ],
      ...activeGridRows.flatMap((row) =>
        row.hourlyCells.map((cell) => [
          selectedDate,
          row.siteCode,
          row.siteName,
          row.guardName,
          `${formatHour(cell.hour)}:00`,
          cell.status,
          cell.firstPictureTime ?? '',
          String(cell.totalPicturesInHour),
        ]),
      ),
    ];

    downloadCsv(`guard-safe-${selectedDate}.csv`, rows);
  }

  function openEvidence(row: GuardSafeGridRow, cell: GuardSafeHourCell): void {
    const senderFilter = cell.senderLabel || row.guardName;
    navigate(
      `/evidence?siteCode=${encodeURIComponent(row.siteCode)}&date=${encodeURIComponent(selectedDate)}&hour=${encodeURIComponent(
        String(cell.hour),
      )}&sender=${encodeURIComponent(senderFilter)}`,
    );
  }

  if (user?.role === 'GUARD') {
    return (
      <EmptyState
        title="Guard Safe is for supervisors"
        description="Use Patrol Ops and Evidence for field activity."
      />
    );
  }

  const hasEvidence = filteredPatrolImages.length > 0;
  const senderCount = combinedGridRows.length;

  return (
    <div className="page-stack soc-page">
      <PageHeader
        title="Guard Safe"
        subtitle="All observed senders and assigned guards by site and hour."
        actions={
          <button type="button" className="secondary-button" onClick={handleExport}>
            Export CSV
          </button>
        }
      />

      <RefreshBar
        lastUpdated={lastUpdated}
        pollIntervalSeconds={GUARD_SAFE_POLL_MS / 1000}
        onRefresh={refresh}
        isRefreshing={isLoading}
      />

      <Card>
        <div className="filter-row">
          <label className="inline-field">
            <span>Date</span>
            <input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} />
          </label>
          <label className="inline-field">
            <span>Site</span>
            <select
              value={selectedSiteId}
              onChange={(event) => {
                setSelectedSiteId(event.target.value);
                setSelectedGroupId('');
              }}
            >
              <option value="">All sites</option>
              {sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.siteCode} — {site.siteName}
                </option>
              ))}
            </select>
          </label>
          <label className="inline-field">
            <span>Group</span>
            <select value={selectedGroupId} onChange={(event) => setSelectedGroupId(event.target.value)}>
              <option value="">All groups</option>
              {visibleGroups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.groupName}
                </option>
              ))}
            </select>
          </label>
          <label className="inline-field">
            <span>Sender / guard</span>
            <select value={selectedPersonKey} onChange={(event) => setSelectedPersonKey(event.target.value)}>
              <option value="">All senders ({senderCount})</option>
              {personOptions.map((guard) => (
                <option key={guard.value} value={guard.value}>
                  {guard.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Card>

      {error ? (
        <Card>
          <p className="error-text">{error}</p>
        </Card>
      ) : null}

      {isLoading && combinedGridRows.length === 0 ? (
        <LoadingBlock label="Loading Guard Safe board…" />
      ) : combinedGridRows.length === 0 ? (
        <EmptyState
          title="No guard activity for this view"
          description={
            hasEvidence
              ? 'Evidence exists but no sender rows could be built. Check site mapping on images.'
              : 'No patrol evidence was found for the selected date.'
          }
        />
      ) : (
        <div className="guard-safe-board">
          <p className="muted-text guard-safe-mode-label">
            {senderCount} sender{senderCount === 1 ? '' : 's'} across {siteGroupedRows.length} site
            {siteGroupedRows.length === 1 ? '' : 's'} · click an hour to open evidence
          </p>
          {siteGroupedRows.map(([siteCode, siteRows]) => (
            <section key={siteCode} className="guard-safe-site-group">
              <header className="guard-safe-site-header">
                <h3>
                  {siteCode} · {siteRows[0]?.siteName}
                </h3>
                <span className="soft-chip">
                  {siteRows.length} sender{siteRows.length === 1 ? '' : 's'}
                </span>
              </header>
              <div className="guard-safe-site-rows">
                {siteRows.map((row) => (
                  <Card className="guard-safe-person-card" key={`${row.siteId}-${row.personKey}`}>
                    <div className="guard-safe-person-summary">
                      <div>
                        <strong>{row.guardName}</strong>
                        {row.sourceLabel ? (
                          <span className="muted-text">Source: {row.sourceLabel}</span>
                        ) : null}
                        <span>Hourly patrol timeline</span>
                      </div>
                      <div className="guard-safe-counts">
                        <span className="ops-pill ops-pill-green">{row.safeCount} ✓</span>
                        <span className="ops-pill ops-pill-red">{row.missingCount} missed</span>
                      </div>
                    </div>
                    <PatrolTimeline
                      cells={row.hourlyCells.map((cell) => ({
                        hour: cell.hour,
                        status: cell.status,
                        firstPictureTime: cell.firstPictureTime,
                        senderLabel:
                          cell.status === 'Safe'
                            ? cell.senderLabel || row.guardName
                            : null,
                      }))}
                      onSelectHour={(hour) => {
                        const cell = row.hourlyCells[hour];
                        if (cell) {
                          openEvidence(row, cell);
                        }
                      }}
                    />
                  </Card>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
