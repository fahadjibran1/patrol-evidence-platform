import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiRequest, getApiBaseUrl } from '../lib/api';
import { formatHourLabel, formatOperatorDateTime, formatSentByLabel } from '../lib/operator-ui';
import { getPatrolToday } from '../lib/patrol-time';
import { useLiveRefresh } from '../lib/use-live-refresh';
import { EvidenceLightbox, LoadingBlock } from '../components/operator-ui';
import { RefreshBar } from '../components/refresh-bar';
import { useAuth } from '../state/auth';
import type { PatrolImageRecord, Site } from '../types';
import { Card, EmptyState, PageHeader, StatusBadge } from '../components/ui';

const EVIDENCE_POLL_MS = 120_000;

export function EvidencePage(): JSX.Element {
  const { token } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [sites, setSites] = useState<Site[]>([]);
  const [images, setImages] = useState<PatrolImageRecord[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState(searchParams.get('siteId') ?? '');
  const [selectedDate, setSelectedDate] = useState(searchParams.get('date') ?? getPatrolToday());
  const [selectedHour, setSelectedHour] = useState(searchParams.get('hour') ?? 'all');
  const [selectedSender, setSelectedSender] = useState(searchParams.get('sender') ?? '');
  const [viewMode, setViewMode] = useState<'gallery' | 'timeline'>('gallery');
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const filterKeyRef = useRef(`${selectedDate}|${selectedSiteId}|${selectedHour}`);

  useEffect(() => {
    apiRequest<Site[]>('/sites', {}, token ?? undefined)
      .then((nextSites) => {
        const activeSites = nextSites.filter((site) => site.active);
        setSites(activeSites);

        const siteCodeFromUrl = searchParams.get('siteCode')?.trim();
        if (!selectedSiteId && siteCodeFromUrl) {
          const matchingSite = activeSites.find((site) => site.siteCode === siteCodeFromUrl);
          if (matchingSite) {
            setSelectedSiteId(matchingSite.id);
          }
        }
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Failed to load sites'));
  }, [searchParams, selectedSiteId, token]);

  useEffect(() => {
    const nextParams = new URLSearchParams();
    if (selectedSiteId) {
      nextParams.set('siteId', selectedSiteId);
    }
    if (selectedDate) {
      nextParams.set('date', selectedDate);
    }
    if (selectedHour !== 'all') {
      nextParams.set('hour', selectedHour);
    }
    if (selectedSender.trim()) {
      nextParams.set('sender', selectedSender.trim());
    }
    setSearchParams(nextParams, { replace: true });
  }, [selectedDate, selectedHour, selectedSender, selectedSiteId, setSearchParams]);

  const loadImages = useCallback(async () => {
    setError(null);

    const search = new URLSearchParams();
    if (selectedSiteId) {
      search.set('siteId', selectedSiteId);
    }
    if (selectedDate) {
      search.set('date', selectedDate);
    }
    if (selectedHour !== 'all') {
      search.set('hour', selectedHour);
    }

    try {
      const nextImages = await apiRequest<PatrolImageRecord[]>(
        `/patrol-images?${search.toString()}`,
        {},
        token ?? undefined,
      );
      setImages(nextImages);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load evidence');
    }
  }, [selectedDate, selectedHour, selectedSiteId, token]);

  const { lastUpdated, isLoading, refresh, markFiltersChanged } = useLiveRefresh(
    loadImages,
    EVIDENCE_POLL_MS,
    Boolean(token),
  );

  useEffect(() => {
    const nextKey = `${selectedDate}|${selectedSiteId}|${selectedHour}`;
    if (filterKeyRef.current === nextKey) {
      return;
    }

    filterKeyRef.current = nextKey;
    markFiltersChanged();
  }, [markFiltersChanged, selectedDate, selectedHour, selectedSiteId]);

  const baseUrl = useMemo(() => getApiBaseUrl(), []);

  const filteredImages = useMemo(() => {
    if (!selectedSender.trim()) {
      return images;
    }

    const normalizedSender = selectedSender.trim().toLowerCase();
    return images.filter((image) => {
      const senderName = image.senderName?.toLowerCase() ?? '';
      const senderNumber = image.senderNumber?.toLowerCase() ?? '';
      return senderName.includes(normalizedSender) || senderNumber.includes(normalizedSender);
    });
  }, [images, selectedSender]);

  const senderOptions = useMemo(() => {
    const options = new Set<string>();
    for (const image of images) {
      if (image.senderName?.trim()) {
        options.add(image.senderName.trim());
      } else if (image.senderNumber?.trim()) {
        options.add(image.senderNumber.trim());
      }
    }
    return [...options].sort((a, b) => a.localeCompare(b));
  }, [images]);

  const groupedImages = useMemo(() => {
    const groups = new Map<number, PatrolImageRecord[]>();
    for (const image of filteredImages) {
      const bucket = groups.get(image.patrolHour) ?? [];
      bucket.push(image);
      groups.set(image.patrolHour, bucket);
    }
    return [...groups.entries()].sort((left, right) => right[0] - left[0]);
  }, [filteredImages]);

  const imageUrl = (image: PatrolImageRecord): string =>
    `${baseUrl}/patrol-images/${image.id}/content?access_token=${encodeURIComponent(token ?? '')}`;

  function renderCaption(image: PatrolImageRecord): JSX.Element {
    const sourceLabel = image.group?.groupName ?? null;
    return (
      <div className="evidence-gallery-caption">
        <strong>
          {image.site?.siteCode ?? image.siteId}
          {image.site?.siteName ? ` · ${image.site.siteName}` : ''}
        </strong>
        <span className="evidence-gallery-sent-by">
          Sent by:{' '}
          {formatSentByLabel({
            senderName: image.senderName,
            senderNumber: image.senderNumber,
            sourceLabel,
          })}
        </span>
        {sourceLabel ? <span className="muted-text">Source · {sourceLabel}</span> : null}
        <span>{formatOperatorDateTime(image.sentAt)}</span>
        <StatusBadge value={image.status} />
      </div>
    );
  }

  return (
    <div className="page-stack soc-page">
      <PageHeader
        title="Evidence"
        subtitle="Patrol photo archive with sender, source, and site context."
        actions={
          <div className="view-toggle">
            <button
              type="button"
              className={viewMode === 'gallery' ? 'primary-button' : 'secondary-button'}
              onClick={() => setViewMode('gallery')}
            >
              Gallery
            </button>
            <button
              type="button"
              className={viewMode === 'timeline' ? 'primary-button' : 'secondary-button'}
              onClick={() => setViewMode('timeline')}
            >
              Timeline
            </button>
          </div>
        }
      />

      <RefreshBar
        lastUpdated={lastUpdated}
        pollIntervalSeconds={EVIDENCE_POLL_MS / 1000}
        onRefresh={refresh}
        isRefreshing={isLoading}
      />

      <Card className="evidence-filters-card">
        <div className="filter-row evidence-filters">
          <label className="inline-field">
            <span>Site</span>
            <select value={selectedSiteId} onChange={(event) => setSelectedSiteId(event.target.value)}>
              <option value="">All sites</option>
              {sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.siteCode} — {site.siteName}
                </option>
              ))}
            </select>
          </label>
          <label className="inline-field">
            <span>Date</span>
            <input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} />
          </label>
          <label className="inline-field">
            <span>Hour</span>
            <select value={selectedHour} onChange={(event) => setSelectedHour(event.target.value)}>
              <option value="all">All hours</option>
              {Array.from({ length: 24 }, (_, hour) => (
                <option key={hour} value={String(hour)}>
                  {formatHourLabel(hour)}
                </option>
              ))}
            </select>
          </label>
          <label className="inline-field">
            <span>Guard / source</span>
            <input
              list="evidence-senders"
              value={selectedSender}
              onChange={(event) => setSelectedSender(event.target.value)}
              placeholder="All senders"
            />
            <datalist id="evidence-senders">
              {senderOptions.map((sender) => (
                <option key={sender} value={sender} />
              ))}
            </datalist>
          </label>
        </div>
        <p className="muted-text evidence-count">
          {isLoading ? 'Loading…' : `${filteredImages.length} image${filteredImages.length === 1 ? '' : 's'} matching filters`}
        </p>
      </Card>

      {error ? (
        <Card>
          <p className="error-text">{error}</p>
        </Card>
      ) : null}

      {isLoading ? (
        <LoadingBlock label="Loading evidence…" />
      ) : filteredImages.length === 0 ? (
        <EmptyState
          title="No evidence for this view"
          description="Adjust filters or confirm patrol images are being received on Monitoring."
        />
      ) : viewMode === 'gallery' ? (
        <div className="evidence-gallery">
          {filteredImages.map((image, index) => (
            <button
              key={image.id}
              type="button"
              className="evidence-gallery-item"
              onClick={() => setLightboxIndex(index)}
            >
              <img src={imageUrl(image)} alt="" className="evidence-gallery-image" loading="lazy" />
              {renderCaption(image)}
            </button>
          ))}
        </div>
      ) : (
        <div className="hourly-evidence-stack">
          {groupedImages.map(([hour, hourImages]) => (
            <Card key={hour} className="hour-block">
              <div className="hour-block-header">
                <div>
                  <h3>{formatHourLabel(hour)}</h3>
                  <p className="muted-text">
                    {hourImages.length} capture{hourImages.length === 1 ? '' : 's'}
                  </p>
                </div>
              </div>
              <div className="evidence-gallery evidence-gallery-dense">
                {hourImages.map((image) => {
                  const index = filteredImages.findIndex((entry) => entry.id === image.id);
                  return (
                    <button
                      key={image.id}
                      type="button"
                      className="evidence-gallery-item"
                      onClick={() => setLightboxIndex(index)}
                    >
                      <img src={imageUrl(image)} alt="" className="evidence-gallery-image" loading="lazy" />
                      {renderCaption(image)}
                    </button>
                  );
                })}
              </div>
            </Card>
          ))}
        </div>
      )}

      {lightboxIndex !== null && filteredImages[lightboxIndex] ? (
        <EvidenceLightbox
          image={filteredImages[lightboxIndex]}
          imageUrl={imageUrl(filteredImages[lightboxIndex])}
          onClose={() => setLightboxIndex(null)}
          onPrevious={
            lightboxIndex > 0
              ? () => setLightboxIndex((current) => (current === null ? null : current - 1))
              : undefined
          }
          onNext={
            lightboxIndex < filteredImages.length - 1
              ? () => setLightboxIndex((current) => (current === null ? null : current + 1))
              : undefined
          }
        />
      ) : null}
    </div>
  );
}
