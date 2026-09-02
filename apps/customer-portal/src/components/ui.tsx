import type { PropsWithChildren, ReactNode } from 'react';

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}): JSX.Element {
  return (
    <header className="page-header">
      <div>
        <p className="eyebrow">Customer portal</p>
        <h2>{title}</h2>
        {subtitle ? <p className="page-subtitle">{subtitle}</p> : null}
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
  tone?: 'default' | 'danger' | 'success' | 'warning';
}): JSX.Element {
  return (
    <Card className={`metric-card ${tone}`}>
      <p>{label}</p>
      <strong>{value}</strong>
    </Card>
  );
}

export function StatusBadge({ value }: { value: string }): JSX.Element {
  const normalized = value.toUpperCase().replace(/\s+/g, '_');
  const success = new Set(['ACTIVE', 'SENT', 'PAID', 'SCHEDULED', 'READY', 'TRUE', 'TRIAL', 'SUCCEEDED']);
  const danger = new Set(['EXPIRED', 'REVOKED', 'FAILED', 'CLOSED', 'SUSPENDED']);
  const warning = new Set(['PENDING', 'QUEUED', 'DRAFT', 'EXPIRING_SOON', 'PROSPECT']);
  const tone = success.has(normalized)
    ? 'success'
    : danger.has(normalized)
      ? 'danger'
      : warning.has(normalized)
        ? 'warning'
        : 'default';
  const display = value.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
  return <span className={`status-badge ${tone}`}>{display}</span>;
}

export function EmptyState({ title, description }: { title: string; description: string }): JSX.Element {
  return (
    <Card className="empty-state">
      <h3>{title}</h3>
      <p>{description}</p>
    </Card>
  );
}

export function ErrorBanner({ message }: { message: string }): JSX.Element {
  return (
    <div className="banner banner-danger" role="alert">
      <strong>Error</strong>
      <p>{message}</p>
    </div>
  );
}

export function InfoBanner({ title, message }: { title: string; message: string }): JSX.Element {
  return (
    <div className="banner banner-info" role="status">
      <strong>{title}</strong>
      <p>{message}</p>
    </div>
  );
}

export function LoadingState({ label = 'Loading…' }: { label?: string }): JSX.Element {
  return (
    <Card>
      <p className="muted">{label}</p>
      <div className="skeleton-grid" aria-hidden>
        <div className="skeleton" />
        <div className="skeleton" />
        <div className="skeleton" />
      </div>
    </Card>
  );
}

export function DashboardSkeleton(): JSX.Element {
  return (
    <div className="metric-grid" aria-busy>
      {Array.from({ length: 6 }).map((_, index) => (
        <Card key={index} className="metric-card">
          <div className="skeleton" />
          <div className="skeleton" style={{ width: '40%' }} />
        </Card>
      ))}
    </div>
  );
}
