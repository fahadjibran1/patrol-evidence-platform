import type { PropsWithChildren } from 'react';

export function PageHeader({
  eyebrow = 'Security operations',
  title,
  subtitle,
  actions,
}: {
  eyebrow?: string;
  title: string;
  subtitle: string;
  actions?: JSX.Element;
}): JSX.Element {
  return (
    <header className="page-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        <p className="page-subtitle">{subtitle}</p>
      </div>
      {actions}
    </header>
  );
}

export function Card({ children, className = '' }: PropsWithChildren<{ className?: string }>): JSX.Element {
  return <section className={`card ${className}`.trim()}>{children}</section>;
}

export function MetricCard({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string | number;
  tone?: 'default' | 'danger' | 'success';
}): JSX.Element {
  return (
    <Card className={`metric-card ${tone}`}>
      <p>{label}</p>
      <strong>{value}</strong>
    </Card>
  );
}

export function StatusBadge({ value }: { value: string | boolean }): JSX.Element {
  const normalized = String(value);
  const successValues = new Set([
    'true',
    'RECEIVED_ON_TIME',
    'RESOLVED',
    'Safe',
    'READY',
    'CONNECTED',
    'ACTIVE',
    'TRIAL_ACTIVE',
    'TRIAL ACTIVE',
    'Trial Active',
    'FULL',
    'Reported',
  ]);
  const dangerValues = new Set([
    'MISSING',
    'EMERGENCY',
    'CRITICAL',
    'Missing',
    'EXPIRED',
    'INVALID',
    'Trial expired',
  ]);
  const warningValues = new Set([
    'IN_REVIEW',
    'RECEIVED_LATE',
    'Pending',
    'BACKFILLING',
    'STARTING',
    'QR',
    'PENDING',
    'Missing setup',
  ]);

  const tone = successValues.has(normalized)
    ? 'success'
    : dangerValues.has(normalized)
      ? 'danger'
      : warningValues.has(normalized)
        ? 'warning'
        : 'default';

  const displayValue =
    {
      READY: 'Ready',
      CONNECTED: 'Connected',
      ACTIVE: 'Active',
      INACTIVE: 'Inactive',
      PENDING: 'Pending',
      STARTING: 'Starting',
      BACKFILLING: 'Receiving history',
      QR: 'Scan QR',
      Missing: 'Missing',
      'Missing setup': 'Setup needed',
      RECEIVED_ON_TIME: 'On time',
      RECEIVED_LATE: 'Late',
      RESOLVED: 'Resolved',
      IN_REVIEW: 'In review',
      EXPIRED: 'Expired',
      INVALID: 'Invalid',
      FULL: 'Full',
      Reported: 'Reported',
    }[normalized] ?? normalized;

  return <span className={`status-badge ${tone}`}>{displayValue}</span>;
}

export function EmptyState({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: JSX.Element;
}): JSX.Element {
  return (
    <Card className="empty-state">
      <h3>{title}</h3>
      <p>{description}</p>
      {actions ? <div className="empty-state-actions">{actions}</div> : null}
    </Card>
  );
}
