import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  acquireHelperMutex,
  buildProfileLockFailureMessage,
  detectProfileLock,
  isProfileLockErrorMessage,
  readHelperMutex,
  releaseProfileOwnership,
} from './browser-profile-lock.util';

describe('browser-profile-lock.util', () => {
  const tempRoot = path.join(os.tmpdir(), `patrol-profile-lock-${process.pid}-${Date.now()}`);

  beforeEach(() => {
    mkdirSync(tempRoot, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('detects profile lock files', () => {
    const userDataDir = path.join(tempRoot, 'session-patrol-evidence-platform');
    mkdirSync(userDataDir, { recursive: true });
    writeFileSync(path.join(userDataDir, 'SingletonLock'), 'lock', 'utf8');

    const status = detectProfileLock(userDataDir);
    expect(status.locked).toBe(true);
    expect(status.lockFilesPresent).toContain('SingletonLock');
  });

  it('acquires and releases helper mutex with single-instance semantics', () => {
    const first = acquireHelperMutex(tempRoot);
    expect(readHelperMutex(tempRoot)?.pid).toBe(process.pid);

    expect(() => acquireHelperMutex(tempRoot)).toThrow(/EXISTING_HELPER_FOUND/);

    first.release();
    expect(existsSync(path.join(tempRoot, 'helper.mutex'))).toBe(false);

    const second = acquireHelperMutex(tempRoot);
    expect(second.pid).toBe(process.pid);
    second.release();
  });

  it('recognises puppeteer profile-lock errors', () => {
    expect(
      isProfileLockErrorMessage(
        'The browser is already running for C:\\data\\session-patrol-evidence-platform',
      ),
    ).toBe(true);
    expect(isProfileLockErrorMessage('net::ERR_CONNECTION_REFUSED')).toBe(false);
  });

  it('formats locking process details for diagnostics', () => {
    const message = buildProfileLockFailureMessage(
      'C:\\profile',
      [{ pid: 4242, name: 'msedge.exe', commandLine: '--user-data-dir=C:\\profile' }],
      'The browser is already running',
    );
    expect(message).toContain('pid 4242');
    expect(message).toContain('msedge.exe');
    expect(message).toContain('C:\\profile');
  });

  it('proves a clean profile remains reusable across bounded settle checks', async () => {
    const userDataDir = path.join(tempRoot, 'session-patrol-evidence-platform');
    mkdirSync(userDataDir, { recursive: true });

    const released = await releaseProfileOwnership(userDataDir);

    expect(released.locked).toBe(false);
    expect(
      (readdirSync(userDataDir) as string[]).some((name) =>
        name.startsWith(`.patrol-profile-release-${process.pid}`),
      ),
    ).toBe(false);
  });

  it('clears stale singleton markers only after no owning process is present', async () => {
    const userDataDir = path.join(tempRoot, 'session-patrol-evidence-platform');
    mkdirSync(userDataDir, { recursive: true });
    writeFileSync(path.join(userDataDir, 'SingletonLock'), 'stale', 'utf8');

    const released = await releaseProfileOwnership(userDataDir);

    expect(released.locked).toBe(false);
    expect(existsSync(path.join(userDataDir, 'SingletonLock'))).toBe(false);
  }, 30_000);
});
