import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiRequest } from '../lib/api';
import { customerErrorMessage } from '../lib/customer-errors';
import { useAuth } from '../state/auth';
import type { PatrolSlot, Site } from '../types';
import { Card, PageHeader, StatusBadge } from '../components/ui';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function PatrolOpsPage(): JSX.Element {
  const navigate = useNavigate();
  const { token, user } = useAuth();
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSiteCode, setSelectedSiteCode] = useState('');
  const [selectedDate, setSelectedDate] = useState(today());
  const [slots, setSlots] = useState<PatrolSlot[]>([]);
  const [senderName, setSenderName] = useState(user ? `${user.firstName} ${user.lastName}` : '');
  const [timestamp, setTimestamp] = useState(new Date().toISOString().slice(0, 16));
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadSites(): Promise<void> {
    const nextSites = await apiRequest<Site[]>('/sites', {}, token ?? undefined);
    setSites(nextSites);

    if (!selectedSiteCode && nextSites[0]) {
      setSelectedSiteCode(nextSites[0].siteCode);
    }
  }

  async function loadSlots(siteCode = selectedSiteCode, date = selectedDate): Promise<void> {
    if (!siteCode || !date) {
      return;
    }

    const nextSlots = await apiRequest<PatrolSlot[]>(
      `/patrol-slots?siteCode=${encodeURIComponent(siteCode)}&date=${date}`,
      {},
      token ?? undefined,
    );
    setSlots(nextSlots);
  }

  useEffect(() => {
    loadSites().catch((loadError) => setError(customerErrorMessage(loadError, 'Sites could not be loaded. Try again.')));
  }, [token]);

  useEffect(() => {
    if (selectedSiteCode) {
      loadSlots().catch((loadError) =>
        setError(customerErrorMessage(loadError, 'Patrol operations could not be loaded. Try again.')),
      );
    }
  }, [selectedDate, selectedSiteCode]);

  async function handleGenerateToday(): Promise<void> {
    setError(null);
    setMessage(null);
    try {
      await apiRequest('/compliance/generate-today', { method: 'POST' }, token ?? undefined);
      setMessage("Today's patrol times have been prepared.");
      await loadSlots();
    } catch (generationError) {
      setError(customerErrorMessage(generationError, 'The patrol schedule could not be generated. Check the details and try again.'));
    }
  }

  async function handleGenerateDate(): Promise<void> {
    setError(null);
    setMessage(null);
    try {
      await apiRequest(
        '/compliance/generate-slots',
        {
          method: 'POST',
          body: JSON.stringify({ date: selectedDate }),
        },
        token ?? undefined,
      );
      setMessage(`Patrol times prepared for ${selectedDate}.`);
      await loadSlots();
    } catch (generationError) {
      setError(customerErrorMessage(generationError, 'The patrol schedule could not be updated. Try again.'));
    }
  }

  async function handleUpload(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (!file || !selectedSiteCode) {
      setError('Choose a site and image first.');
      return;
    }

    const formData = new FormData();
    formData.append('siteCode', selectedSiteCode);
    formData.append('timestamp', new Date(timestamp).toISOString());
    if (senderName.trim()) {
      formData.append('senderName', senderName.trim());
    }
    formData.append('file', file);

    try {
      await apiRequest('/patrol-images/manual-ingest', { method: 'POST', body: formData }, token ?? undefined);
      setMessage('Patrol image saved successfully.');
      setFile(null);
      await loadSlots();
    } catch (uploadError) {
      setError(customerErrorMessage(uploadError, 'The patrol evidence could not be uploaded. The selected file is unchanged; try again.'));
    }
  }

  return (
    <div className="page-stack">
      <PageHeader
        title="Patrol Ops"
        subtitle="Review patrol activity, upload patrol images, and check expected reporting times."
      />

      {error ? <Card><p className="error-text">Something went wrong. {error}</p></Card> : null}
      {message ? <Card><p className="success-text">{message}</p></Card> : null}

      <div className="two-column-grid">
        <Card>
          <h3>Patrol day controls</h3>
          <div className="form-grid">
            <label>
              Site
              <select value={selectedSiteCode} onChange={(event) => setSelectedSiteCode(event.target.value)}>
                <option value="">Select site</option>
                {sites.map((site) => (
                  <option key={site.id} value={site.siteCode}>
                    {site.siteCode} - {site.siteName}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Date
              <input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} />
            </label>

            {user?.role !== 'GUARD' ? (
              <div className="button-row">
                <button type="button" className="primary-button" onClick={handleGenerateToday}>
                  Prepare today
                </button>
                <button type="button" className="secondary-button" onClick={handleGenerateDate}>
                  Prepare selected date
                </button>
              </div>
            ) : null}
          </div>
        </Card>

        <Card>
          <h3>Manual image upload</h3>
          <form className="form-grid" onSubmit={handleUpload}>
            <label>
              Sender name
              <input value={senderName} onChange={(event) => setSenderName(event.target.value)} maxLength={120} />
            </label>
            <label>
              Timestamp
              <input
                type="datetime-local"
                value={timestamp}
                onChange={(event) => setTimestamp(event.target.value)}
                required
              />
            </label>
            <label>
              Image
              <input
                type="file"
                accept=".jpg,.jpeg,.png,image/png,image/jpeg"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                required
              />
            </label>
            <button type="submit" className="primary-button">Upload patrol image</button>
          </form>
        </Card>
      </div>

      <Card>
        <h3>Patrol timeline</h3>
        {slots.length === 0 ? (
          <div className="stack-list">
            <strong>No patrol activity found</strong>
            <p className="muted-text">
              No patrol timeline is available for {selectedSiteCode || 'the selected site'} on {selectedDate}. Patrol images can still be uploaded and reviewed on the Evidence page.
            </p>
            <div className="button-row">
              <button type="button" className="secondary-button" onClick={() => navigate('/setup')}>
                Check your setup
              </button>
              <button type="button" className="secondary-button" onClick={() => navigate('/evidence')}>
                View images
              </button>
            </div>
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Expected</th>
                  <th>Window start</th>
                  <th>Window end</th>
                  <th>Status</th>
                  <th>Image linked</th>
                </tr>
              </thead>
              <tbody>
                {slots.map((slot) => (
                  <tr key={slot.id}>
                    <td>{new Date(slot.expectedAt).toLocaleString()}</td>
                    <td>{new Date(slot.slotStart).toLocaleString()}</td>
                    <td>{new Date(slot.slotEnd).toLocaleString()}</td>
                    <td><StatusBadge value={slot.status} /></td>
                    <td>{slot.imageId ? 'Yes' : 'No'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
