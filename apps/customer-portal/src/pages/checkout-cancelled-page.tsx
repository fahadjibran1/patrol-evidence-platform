import { Link } from 'react-router-dom';
import { Card, InfoBanner, PageHeader } from '../components/ui';

export function CheckoutCancelledPage(): JSX.Element {
  return (
    <div className="page-stack">
      <PageHeader
        title="Checkout cancelled"
        subtitle="No confirmed payment was recorded for this attempt."
      />
      <Card>
        <InfoBanner
          title="Checkout was not completed"
          message="You can restart checkout from Billing at any time. Stripe session details are not stored in your browser."
        />
        <div className="button-row" style={{ marginTop: '1.25rem' }}>
          <Link to="/billing" className="primary-button">Return to billing</Link>
        </div>
      </Card>
    </div>
  );
}
