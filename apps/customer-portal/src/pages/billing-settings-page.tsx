import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Card, ErrorBanner, InfoBanner, LoadingState, PageHeader } from '../components/ui';

interface BillingSettings {
  billingEmail: string;
  invoiceRecipients: string[];
  allowFinancePurchases: boolean;
  taxId: string | null;
}

export function BillingSettingsPage(): JSX.Element {
  const { accessToken } = useAuth();
  const [settings, setSettings] = useState<BillingSettings | null>(null);
  const [recipientsText, setRecipientsText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!accessToken) return;
    void apiRequest<BillingSettings>('/customer/billing/settings', {}, accessToken)
      .then((response) => {
        setSettings(response);
        setRecipientsText(response.invoiceRecipients.join(', '));
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Failed to load settings'));
  }, [accessToken]);

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!accessToken || !settings) return;
    setBusy(true);
    setSaved(false);
    setError(null);
    try {
      const response = await apiRequest<BillingSettings>(
        '/customer/billing/settings',
        {
          method: 'POST',
          body: JSON.stringify({
            billingEmail: settings.billingEmail,
            invoiceRecipients: recipientsText
              .split(',')
              .map((entry) => entry.trim())
              .filter(Boolean),
            allowFinancePurchases: settings.allowFinancePurchases,
            taxId: settings.taxId,
          }),
        },
        accessToken,
      );
      setSettings(response);
      setRecipientsText(response.invoiceRecipients.join(', '));
      setSaved(true);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save settings');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-stack">
      <PageHeader
        title="Billing settings"
        subtitle="Billing email, invoice recipients, and purchase permissions."
        actions={<Link to="/billing" className="secondary-button">Back to billing</Link>}
      />
      {error ? <ErrorBanner message={error} /> : null}
      {saved ? <InfoBanner title="Saved" message="Billing settings updated." /> : null}
      {!settings && !error ? <LoadingState label="Loading settings…" /> : null}
      {settings ? (
        <Card>
          <form className="form-grid" onSubmit={(event) => void onSubmit(event)}>
            <label>
              Billing email
              <input
                type="email"
                value={settings.billingEmail}
                onChange={(e) => setSettings({ ...settings, billingEmail: e.target.value })}
                required
              />
            </label>
            <label>
              Invoice recipients (comma-separated)
              <input value={recipientsText} onChange={(e) => setRecipientsText(e.target.value)} />
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={settings.allowFinancePurchases}
                onChange={(e) => setSettings({ ...settings, allowFinancePurchases: e.target.checked })}
              />
              <span>Allow Finance role to purchase</span>
            </label>
            <label>
              Tax / VAT ID (placeholder)
              <input
                value={settings.taxId ?? ''}
                onChange={(e) => setSettings({ ...settings, taxId: e.target.value || null })}
              />
            </label>
            <button type="submit" className="primary-button" disabled={busy}>
              {busy ? 'Saving…' : 'Save settings'}
            </button>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
