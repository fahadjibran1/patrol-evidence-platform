import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  formatHourLabel,
  formatOperatorDateTime,
  formatSentByLabel,
  siteOpsLabel,
  timelineCellCaption,
  timelineCellSymbol,
  timelineCellTone,
  type OpsTone,
} from '../lib/operator-ui';
import type { PatrolGroup, PatrolImageRecord } from '../types';
import { StatusBadge } from './ui';

export function LoadingBlock({ label }: { label: string }): JSX.Element {
  return (
    <div className="loading-block" aria-busy="true">
      <span className="loading-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function OpsStatusPill({ tone, label }: { tone: OpsTone; label: string }): JSX.Element {
  return <span className={`ops-pill ops-pill-${tone}`}>{label}</span>;
}

export interface PatrolTimelineCell {
  hour: number;
  status: 'Safe' | 'Missing' | 'Pending';
  firstPictureTime: string | null;
  senderLabel?: string | null;
}

export function PatrolTimeline({
  cells,
  onSelectHour,
  compact = false,
}: {
  cells: PatrolTimelineCell[];
  onSelectHour?: (hour: number) => void;
  compact?: boolean;
}): JSX.Element {
  // Compact is a denser layout only — never clip to a hard-coded 06:00–22:00 window.
  // Cells already reflect each site's configured (or fallback) monitoring hours from the API.
  const visible = cells;

  return (
    <ol className={`patrol-timeline${compact ? ' patrol-timeline-compact' : ''}`}>
      {visible.map((cell) => {
        const tone = timelineCellTone(cell.status, cell.firstPictureTime);
        const symbol = timelineCellSymbol(cell.status, cell.firstPictureTime);
        const caption = timelineCellCaption(cell.status, cell.firstPictureTime);
        const timeLabel = cell.firstPictureTime ? formatOperatorDateTime(cell.firstPictureTime) : null;
        const senderLabel =
          cell.status === 'Safe' && cell.senderLabel?.trim() ? cell.senderLabel.trim() : null;

        const content = (
          <>
            <span className="patrol-timeline-time">{formatHourLabel(cell.hour)}</span>
            <span className="patrol-timeline-symbol" aria-hidden="true">
              {symbol}
            </span>
            <span className="patrol-timeline-caption">{caption}</span>
            {senderLabel ? <span className="patrol-timeline-meta">{senderLabel}</span> : null}
            {timeLabel ? <span className="patrol-timeline-meta">{timeLabel}</span> : null}
          </>
        );

        return (
          <li key={cell.hour} className={`patrol-timeline-item patrol-timeline-${tone}`}>
            {onSelectHour ? (
              <button type="button" className="patrol-timeline-button" onClick={() => onSelectHour(cell.hour)}>
                {content}
              </button>
            ) : (
              <div className="patrol-timeline-static">{content}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function SiteControlCard({
  siteCode,
  siteName,
  sourceLabel,
  tone,
  compliancePercent,
  lastPatrolLabel,
  nextPatrolLabel,
  imagesToday,
  alertsOpen,
  timelineCells,
  actions,
  dense = false,
  scheduleDiagnostics,
}: {
  siteCode: string;
  siteName: string;
  sourceLabel: string;
  tone: OpsTone;
  compliancePercent: number;
  lastPatrolLabel: string;
  nextPatrolLabel: string;
  imagesToday: number;
  alertsOpen: number;
  timelineCells: PatrolTimelineCell[];
  actions?: ReactNode;
  dense?: boolean;
  scheduleDiagnostics?: string;
}): JSX.Element {
  return (
    <article className={`site-control-card site-control-${tone}${dense ? ' site-control-dense' : ''}`}>
      <header className="site-control-header">
        <div>
          <p className="site-control-code">{siteCode}</p>
          <h3>{siteName}</h3>
          <p className="muted-text">Source · {sourceLabel}</p>
          {scheduleDiagnostics ? <p className="muted-text">Schedule · {scheduleDiagnostics}</p> : null}
        </div>
        <OpsStatusPill tone={tone} label={siteOpsLabel(tone)} />
      </header>

      <div className="site-control-metrics">
        <div>
          <span>Compliance</span>
          <strong>{compliancePercent}%</strong>
        </div>
        <div>
          <span>Last patrol</span>
          <strong>{lastPatrolLabel}</strong>
        </div>
        <div>
          <span>Next expected</span>
          <strong>{nextPatrolLabel}</strong>
        </div>
        <div>
          <span>Images today</span>
          <strong>{imagesToday}</strong>
        </div>
        <div>
          <span>Open alerts</span>
          <strong>{alertsOpen}</strong>
        </div>
      </div>

      <PatrolTimeline cells={timelineCells} compact={dense} />

      {actions ? <footer className="site-control-actions">{actions}</footer> : null}
    </article>
  );
}

export function EvidenceLightbox({
  image,
  imageUrl,
  onClose,
  onPrevious,
  onNext,
}: {
  image: PatrolImageRecord;
  imageUrl: string;
  onClose: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
}): JSX.Element {
  return (
    <div className="lightbox-backdrop" role="dialog" aria-modal="true" aria-label="Evidence preview" onClick={onClose}>
      <div className="lightbox-panel" onClick={(event) => event.stopPropagation()}>
        <header className="lightbox-header">
          <div>
            <p className="eyebrow">{image.site?.siteCode ?? image.siteId}</p>
            <h3>{image.site?.siteName ?? 'Patrol evidence'}</h3>
            <p className="muted-text">{formatOperatorDateTime(image.sentAt)}</p>
          </div>
          <button type="button" className="secondary-button" onClick={onClose}>
            Close
          </button>
        </header>

        <img src={imageUrl} alt={`Patrol evidence for ${image.site?.siteCode ?? 'site'}`} className="lightbox-image" />

        <dl className="lightbox-meta">
          <div>
            <dt>Sent by</dt>
            <dd>
              {formatSentByLabel({
                senderName: image.senderName,
                senderNumber: image.senderNumber,
                sourceLabel: image.group?.groupName,
              })}
            </dd>
          </div>
          <div>
            <dt>Patrol hour</dt>
            <dd>{formatHourLabel(image.patrolHour)}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{image.status.replace(/_/g, ' ')}</dd>
          </div>
          <div>
            <dt>WhatsApp source</dt>
            <dd>{image.group?.groupName || 'Unmapped'}</dd>
          </div>
        </dl>

        <footer className="lightbox-actions">
          {onPrevious ? (
            <button type="button" className="secondary-button" onClick={onPrevious}>
              Previous
            </button>
          ) : null}
          {onNext ? (
            <button type="button" className="secondary-button" onClick={onNext}>
              Next
            </button>
          ) : null}
          <Link
            className="primary-button lightbox-link-button"
            to={`/guard-safe?siteCode=${encodeURIComponent(image.site?.siteCode ?? '')}`}
          >
            Open Guard Safe
          </Link>
        </footer>
      </div>
    </div>
  );
}

export function LatestEvidenceList({
  images,
  imageUrl,
  groups,
  onSelect,
}: {
  images: PatrolImageRecord[];
  imageUrl: (image: PatrolImageRecord) => string;
  groups: PatrolGroup[];
  onSelect?: (image: PatrolImageRecord) => void;
}): JSX.Element {
  if (images.length === 0) {
    return <p className="muted-text">No images received yet for this date.</p>;
  }

  return (
    <div className="latest-evidence-list">
      {images.map((image) => {
        const sourceLabel =
          image.group?.groupName ?? groups.find((group) => group.id === image.groupId)?.groupName ?? null;

        return (
          <article key={image.id} className="latest-evidence-row">
            <button
              type="button"
              className="latest-evidence-thumb-button"
              onClick={() => onSelect?.(image)}
              aria-label={`Open evidence for ${image.site?.siteCode ?? 'site'}`}
            >
              <img src={imageUrl(image)} alt="" className="latest-evidence-thumb" loading="lazy" />
            </button>
            <div className="latest-evidence-copy">
              <strong>
                {image.site?.siteCode ?? '—'} · {image.site?.siteName ?? 'Site'}
              </strong>
              <p className="latest-evidence-sent-by">
                Sent by:{' '}
                {formatSentByLabel({
                  senderName: image.senderName,
                  senderNumber: image.senderNumber,
                  sourceLabel,
                })}
              </p>
              <p className="muted-text">Received {formatOperatorDateTime(image.sentAt)}</p>
              {sourceLabel ? <p className="muted-text">Source · {sourceLabel}</p> : null}
            </div>
            <StatusBadge
              value={
                image.status === 'RECEIVED_ON_TIME' || image.status === 'RECEIVED_LATE' ? image.status : 'Safe'
              }
            />
          </article>
        );
      })}
    </div>
  );
}
