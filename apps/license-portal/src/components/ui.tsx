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
        <p className="eyebrow">Licence administration</p>
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
  const success = new Set([
    'ACTIVE',
    'PAID',
    'TRIAL',
    'SCHEDULED',
    'READY',
    'TRUE',
    'SUCCEEDED',
  ]);
  const danger = new Set([
    'EXPIRED',
    'REVOKED',
    'FAILED',
    'BLOCKED',
    'CLOSED',
    'SUSPENDED',
  ]);
  const warning = new Set([
    'PENDING',
    'DRAFT',
    'EXPIRING_SOON',
    'PROSPECT',
    'DEACTIVATED',
    'IN_REVIEW',
  ]);

  const tone = success.has(normalized)
    ? 'success'
    : danger.has(normalized)
      ? 'danger'
      : warning.has(normalized)
        ? 'warning'
        : 'default';

  const display = value
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());

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

export function WarningBanner({ title, message }: { title: string; message: string }): JSX.Element {
  return (
    <div className="banner banner-warning" role="status">
      <strong>{title}</strong>
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

export function DataTable({
  caption,
  columns,
  rows,
  emptyMessage = 'No records found.',
}: {
  caption: string;
  columns: Array<{ key: string; label: string; align?: 'left' | 'right' }>;
  rows: Array<{ id: string; cells: Record<string, ReactNode> }>;
  emptyMessage?: string;
}): JSX.Element {
  if (rows.length === 0) {
    return <EmptyState title="Nothing to show" description={emptyMessage} />;
  }

  return (
    <div className="table-wrap">
      <table className="data-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" className={column.align === 'right' ? 'align-right' : undefined}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              {columns.map((column) => (
                <td key={column.key} className={column.align === 'right' ? 'align-right' : undefined}>
                  {row.cells[column.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Field({
  label,
  children,
  hint,
}: PropsWithChildren<{ label: string; hint?: string }>): JSX.Element {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function TabList({
  tabs,
  active,
  onChange,
}: {
  tabs: Array<{ id: string; label: string }>;
  active: string;
  onChange: (id: string) => void;
}): JSX.Element {
  return (
    <div className="tab-list" role="tablist" aria-label="Detail sections">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          className={active === tab.id ? 'tab active' : 'tab'}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function LoadingState({ label = 'Loading…' }: { label?: string }): JSX.Element {
  return (
    <Card className="loading-state">
      <p>{label}</p>
    </Card>
  );
}

export function SkeletonBlock({ className = '' }: { className?: string }): JSX.Element {
  return <div className={`skeleton-block ${className}`.trim()} aria-hidden="true" />;
}

export function DashboardSkeleton(): JSX.Element {
  return (
    <div className="page-stack" aria-busy="true" aria-live="polite">
      <p className="sr-only">Loading dashboard…</p>
      <div className="metrics-grid">
        {Array.from({ length: 10 }).map((_, index) => (
          <Card key={`kpi-skel-${index}`} className="metric-card">
            <SkeletonBlock className="skeleton-line short" />
            <SkeletonBlock className="skeleton-line value" />
          </Card>
        ))}
      </div>
      <div className="two-column-grid">
        <Card>
          <SkeletonBlock className="skeleton-line title" />
          <SkeletonBlock className="skeleton-table" />
        </Card>
        <Card>
          <SkeletonBlock className="skeleton-line title" />
          <SkeletonBlock className="skeleton-table" />
        </Card>
      </div>
      <Card>
        <SkeletonBlock className="skeleton-line title" />
        <SkeletonBlock className="skeleton-table" />
      </Card>
    </div>
  );
}

export function ButtonRow({ children }: PropsWithChildren): JSX.Element {
  return <div className="button-row">{children}</div>;
}
