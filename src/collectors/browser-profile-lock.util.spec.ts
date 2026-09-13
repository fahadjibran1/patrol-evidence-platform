import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  acquireHelperMutex,
  buildProfileLockFailureMessage,
  classifyProfileOwners,
  detectProfileLock,
  inspectDevToolsEndpoint,
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

  it('requires a complete DevTools endpoint marker before reporting readiness', () => {
    const userDataDir = path.join(tempRoot, 'session-patrol-evidence-platform');
    mkdirSync(userDataDir, { recursive: true });

    expect(inspectDevToolsEndpoint(userDataDir)).toMatchObject({
      ready: false,
      port: null,
      websocketPath: null,
    });

    writeFileSync(path.join(userDataDir, 'DevToolsActivePort'), 'not-a-port\n', 'utf8');
    expect(inspectDevToolsEndpoint(userDataDir).ready).toBe(false);

    writeFileSync(
      path.join(userDataDir, 'DevToolsActivePort'),
      '61234\n/devtools/browser/patrol-generation\n',
      'utf8',
    );
    expect(inspectDevToolsEndpoint(userDataDir)).toMatchObject({
      ready: true,
      port: 61234,
      websocketPath: '/devtools/browser/patrol-generation',
    });
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
  }, 30_000);

  it('clears stale singleton markers only after no owning process is present', async () => {
    const userDataDir = path.join(tempRoot, 'session-patrol-evidence-platform');
    mkdirSync(userDataDir, { recursive: true });
    writeFileSync(path.join(userDataDir, 'SingletonLock'), 'stale', 'utf8');

    const released = await releaseProfileOwnership(userDataDir);

    expect(released.locked).toBe(false);
    expect(existsSync(path.join(userDataDir, 'SingletonLock'))).toBe(false);
  }, 30_000);

  it('keeps current descendants owned when the original browser root has already exited', () => {
    const currentTree = [
      { pid: 100, parentPid: 1, name: 'msedge.exe', commandLine: '--user-data-dir=P1' },
      { pid: 101, parentPid: 100, name: 'msedge.exe', commandLine: '--type=renderer P1' },
      { pid: 102, parentPid: 101, name: 'msedge.exe', commandLine: '--type=gpu-process P1' },
    ];
    const allowed = classifyProfileOwners(currentTree, 100);
    expect(allowed.currentGenerationOwners.map((owner) => owner.pid)).toEqual([100, 101, 102]);
    expect(allowed.conflictingOwners).toHaveLength(0);

    const prior = classifyProfileOwners(
      [{ pid: 90, parentPid: 9, name: 'msedge.exe', commandLine: '--user-data-dir=P1' }],
      100,
    );
    expect(prior.currentGenerationOwners).toHaveLength(0);
    expect(prior.conflictingOwners.map((owner) => owner.pid)).toEqual([90]);

    const mixed = classifyProfileOwners(
      [...currentTree, { pid: 200, parentPid: 2, name: 'chrome.exe', commandLine: '--user-data-dir=P1' }],
      100,
    );
    expect(mixed.conflictingOwners.map((owner) => owner.pid)).toEqual([200]);

    const unknown = classifyProfileOwners(
      [{ pid: 300, name: 'msedge.exe', commandLine: '--user-data-dir=P1' }],
      100,
    );
    expect(unknown.conflictingOwners.map((owner) => owner.pid)).toEqual([300]);

    const handedOff = classifyProfileOwners(
      [
        { pid: 401, parentPid: 40, name: 'msedge.exe', commandLine: '--user-data-dir=P1' },
        { pid: 402, parentPid: 401, name: 'msedge.exe', commandLine: '--type=renderer P1' },
      ],
      null,
      [401],
    );
    expect(handedOff.currentGenerationOwners.map((owner) => owner.pid)).toEqual([401, 402]);
    expect(handedOff.conflictingOwners).toHaveLength(0);
  });
});
