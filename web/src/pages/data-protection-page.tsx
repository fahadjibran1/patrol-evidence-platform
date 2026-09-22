import { useState } from 'react';
import { createDesktopDataBackup, restoreDesktopDataBackup } from '../lib/desktop';
import { Card, PageHeader } from '../components/ui';

export function DataProtectionPage(): JSX.Element {
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function createBackup(): Promise<void> {
    setIsBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await createDesktopDataBackup();
      if (result) {
        setMessage(`Backup verified: ${result.evidenceFileCount} evidence file${result.evidenceFileCount === 1 ? '' : 's'} protected.`);
      }
    } catch {
      setError('The backup could not be completed. Your current PatrolSafe data is unchanged. Check the destination and available disk space, then try again.');
    } finally {
      setIsBusy(false);
    }
  }

  async function restoreBackup(): Promise<void> {
    if (!window.confirm('Restore a PatrolSafe backup? This replaces the current workspace data after the backup is verified.')) return;
    setIsBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await restoreDesktopDataBackup();
      if (result) {
        setMessage(
          result.requiresLicenceRecovery
            ? `Backup restored with ${result.evidenceFileCount} evidence files. This workstation needs licence recovery before monitoring can resume.`
            : result.requiresWhatsAppRelink
              ? `Backup restored with ${result.evidenceFileCount} evidence files. Relink WhatsApp and recover the licence before restarting monitoring.`
              : `Backup restored with ${result.evidenceFileCount} evidence files. PatrolSafe has safely restarted.`,
        );
      }
    } catch {
      setError('The backup was not restored. The existing workspace remains protected. Check that this is a valid PatrolSafe backup and try again.');
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="page-stack settings-page">
      <PageHeader
        eyebrow="Settings"
        title="Backup and restore"
        subtitle="Protect your company setup, sites, mappings and patrol evidence with a verified local backup."
      />

      {error ? <div className="banner banner-danger" role="alert">{error}</div> : null}
      {message ? <div className="banner banner-success" role="status">{message}</div> : null}

      <div className="settings-grid">
        <Card className="action-card">
          <p className="eyebrow">Recommended</p>
          <h3>Backup PatrolSafe data</h3>
          <p className="muted-text">Includes the company workspace, sites, mappings, evidence records and managed evidence files.</p>
          <p className="help-text">Keep backups on a separate, protected drive. Weekly backups are recommended.</p>
          <button type="button" className="primary-button" disabled={isBusy} onClick={() => void createBackup()}>
            {isBusy ? 'Please wait…' : 'Choose backup folder'}
          </button>
        </Card>

        <Card className="action-card">
          <p className="eyebrow">Use with care</p>
          <h3>Restore from backup</h3>
          <p className="muted-text">PatrolSafe verifies the selected backup before replacing current data.</p>
          <p className="help-text">On a replacement PC, sites and evidence are restored but WhatsApp must be linked again.</p>
          <button type="button" className="secondary-button" disabled={isBusy} onClick={() => void restoreBackup()}>
            Choose backup to restore
          </button>
        </Card>
      </div>

      <Card>
        <h3>What your backup protects</h3>
        <div className="check-list" role="list">
          <span role="listitem">Company and site setup</span>
          <span role="listitem">WhatsApp group-to-site mappings</span>
          <span role="listitem">Patrol evidence and integrity information</span>
          <span role="listitem">Monitoring preference and workstation settings</span>
        </div>
      </Card>
    </div>
  );
}
