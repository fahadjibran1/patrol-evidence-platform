import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { InstallationIdentityService } from './installation-identity.service';
import { LocalTrialService, TRIAL_LAST_SEEN_PERSIST_INTERVAL_MS } from './local-trial.service';

describe('LocalTrialService bounded persistence', () => {
  const previousEnv = { ...process.env };
  let root: string;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-03T10:00:00.000Z'));
    root = mkdtempSync(path.join(os.tmpdir(), 'patrol-trial-policy-'));
    process.env.PATROL_LICENSE_DATA_ROOT = root;
    process.env.DESKTOP_CONFIG_PATH = path.join(root, 'workspace.json');
    process.env.PATROL_LICENSE_TEST_MODE = 'true';
    process.env.PATROL_LICENSE_USE_FILE_MARKER = 'true';
  });

  afterEach(() => {
    jest.useRealTimers();
    process.env = { ...previousEnv };
    rmSync(root, { recursive: true, force: true });
  });

  function service(): LocalTrialService {
    return new LocalTrialService(new InstallationIdentityService());
  }

  it('does not decrypt or rewrite the trial for repeated status reads', () => {
    const trial = service();
    trial.getOrCreateTrial({ hasCommercialLicence: false });
    const decrypt = jest.spyOn(trial as never, 'decrypt');
    const persist = jest.spyOn(trial as never, 'persistTrialRecord');
    for (let index = 0; index < 10; index += 1) {
      expect(trial.getOrCreateTrial({ hasCommercialLicence: false })).not.toBeNull();
    }
    expect(decrypt).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });

  it('persists lastSeenAt only after the five-minute checkpoint', () => {
    const trial = service();
    const initial = trial.getOrCreateTrial({ hasCommercialLicence: false })!;
    const persist = jest.spyOn(trial as never, 'persistTrialRecord');
    jest.advanceTimersByTime(TRIAL_LAST_SEEN_PERSIST_INTERVAL_MS - 1);
    trial.getOrCreateTrial({ hasCommercialLicence: false });
    expect(persist).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    const updated = trial.getOrCreateTrial({ hasCommercialLicence: false })!;
    expect(persist).toHaveBeenCalledTimes(1);
    expect(Date.parse(updated.lastSeenAt)).toBe(Date.parse(initial.lastSeenAt) + TRIAL_LAST_SEEN_PERSIST_INTERVAL_MS);
  });

  it('reopens the same active trial after restart', () => {
    const first = service();
    const created = first.getOrCreateTrial({ hasCommercialLicence: false })!;
    const restarted = service().getOrCreateTrial({ hasCommercialLicence: false })!;
    expect(restarted.installationId).toBe(created.installationId);
    expect(restarted.startedAt).toBe(created.startedAt);
  });

  it('retains expiry and backward-clock protection', () => {
    const trial = service();
    const record = trial.getOrCreateTrial({ hasCommercialLicence: false })!;
    expect(trial.isTrialActive({ ...record, expiresAt: '2020-01-01T00:00:00.000Z' })).toBe(false);
    const future = { ...record, lastSeenAt: '2026-09-05T10:00:00.000Z' };
    expect(trial.detectClockRollback(future)).toBe(true);
    expect(trial.isTrialActive(future)).toBe(false);
  });

  it('fails safely when the persisted trial is corrupt', () => {
    const first = service();
    first.getOrCreateTrial({ hasCommercialLicence: false });
    writeFileSync(first.getTrialFilePath()!, Buffer.from('corrupt'));
    const restarted = service();
    expect(restarted.readTrialRecord()).toBeNull();
    expect(restarted.getLastBootstrapError()).toMatch(/Failed to read trial record/);
    expect(readFileSync(path.join(root, 'trial-marker.txt'), 'utf8')).not.toHaveLength(0);
  });
});
