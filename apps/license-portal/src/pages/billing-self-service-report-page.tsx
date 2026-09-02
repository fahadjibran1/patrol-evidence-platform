import { useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Card, ErrorBanner, LoadingState, PageHeader } from '../components/ui';

interface SelfServiceReport {
  periodStart: string;
  upgradeRateEvents: number;
  downgradeRateEvents: number;
  renewalSuccessEvents: number;
  renewalFailureCandidates: number;
  averageSubscriptionLengthDays: string;
  monthlyChurnPercent: number;
  gracePeriodRecoveryCandidates: number;
  activeSubscriptions: number;
  creditsIssuedMinor: number;
}

export function BillingSelfServiceReportPage(): JSX.Element {
  const { accessToken } = useAuth();
  const [report, setReport] = useState<SelfServiceReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    void apiRequest<SelfServiceReport>('/admin/billing/reporting/self-service', {}, accessToken)
      .then(setReport)
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Failed to load report'));
  }, [accessToken]);

  return (
    <div className="page-stack">
      <PageHeader title="Self-service billing report" subtitle="Upgrade, downgrade, renewal, and churn indicators." />
      {error ? <ErrorBanner message={error} /> : null}
      {!report && !error ? <LoadingState label="Loading report…" /> : null}
      {report ? (
        <Card>
          <div className="detail-grid">
            <div className="detail-item"><span>Period start</span><strong>{report.periodStart}</strong></div>
            <div className="detail-item"><span>Upgrade events</span><strong>{report.upgradeRateEvents}</strong></div>
            <div className="detail-item"><span>Downgrade events</span><strong>{report.downgradeRateEvents}</strong></div>
            <div className="detail-item"><span>Renewal successes</span><strong>{report.renewalSuccessEvents}</strong></div>
            <div className="detail-item"><span>Past due (failure proxy)</span><strong>{report.renewalFailureCandidates}</strong></div>
            <div className="detail-item"><span>Avg subscription days</span><strong>{report.averageSubscriptionLengthDays}</strong></div>
            <div className="detail-item"><span>Monthly churn %</span><strong>{report.monthlyChurnPercent}</strong></div>
            <div className="detail-item"><span>Grace recovery candidates</span><strong>{report.gracePeriodRecoveryCandidates}</strong></div>
            <div className="detail-item"><span>Active subscriptions</span><strong>{report.activeSubscriptions}</strong></div>
            <div className="detail-item"><span>Credits issued (minor)</span><strong>{report.creditsIssuedMinor}</strong></div>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
