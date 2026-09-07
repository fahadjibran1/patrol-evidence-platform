import { execFileSync } from 'child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import * as path from 'path';

export const HELPER_MUTEX_FILE = 'helper.mutex';
export const PROFILE_LOCK_FILES = ['SingletonLock', 'lockfile', 'SingletonCookie', 'SingletonSocket'] as const;

export interface BrowserProcessOwner {
  pid: number;
  name: string;
  commandLine: string;
}

export interface ProfileLockStatus {
  userDataDir: string;
  locked: boolean;
  lockFilesPresent: string[];
  owners: BrowserProcessOwner[];
}

export interface HelperMutexInfo {
  pid: number;
  startedAt: string;
}

export interface HelperMutexHandle {
  path: string;
  pid: number;
  release: () => void;
}

export class ProfileLockError extends Error {
  readonly owners: BrowserProcessOwner[];
  readonly userDataDir: string;

  constructor(message: string, userDataDir: string, owners: BrowserProcessOwner[]) {
    super(message);
    this.name = 'ProfileLockError';
    this.userDataDir = userDataDir;
    this.owners = owners;
  }
}

export function sessionProfileDirectory(sessionPath: string, profileDirName: string): string {
  return path.join(sessionPath, profileDirName);
}

export function helperMutexPath(sessionPath: string): string {
  return path.join(sessionPath, HELPER_MUTEX_FILE);
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    // EPERM means the process exists but we cannot signal it.
    return code === 'EPERM';
  }
}

export function readHelperMutex(sessionPath: string): HelperMutexInfo | null {
  const mutexPath = helperMutexPath(sessionPath);
  if (!existsSync(mutexPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(mutexPath, 'utf8')) as HelperMutexInfo;
    if (!Number.isFinite(parsed?.pid)) {
      return null;
    }
    return {
      pid: Number(parsed.pid),
      startedAt: typeof parsed.startedAt === 'string' ? parsed.startedAt : 'unknown',
    };
  } catch {
    return null;
  }
}

export function acquireHelperMutex(sessionPath: string): HelperMutexHandle {
  mkdirSync(sessionPath, { recursive: true });
  const mutexPath = helperMutexPath(sessionPath);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const existing = readHelperMutex(sessionPath);
    if (existing) {
      if (existing.pid === process.pid) {
        throw new Error(
          `EXISTING_HELPER_FOUND Helper mutex already held by this process (pid=${existing.pid}).`,
        );
      }

      if (isProcessAlive(existing.pid)) {
        throw new Error(
          `EXISTING_HELPER_FOUND Another WhatsApp helper is already running (pid=${existing.pid}, startedAt=${existing.startedAt}).`,
        );
      }

      try {
        unlinkSync(mutexPath);
      } catch {
        // ignore stale cleanup races
      }
    }

    try {
      const fd = openSync(mutexPath, 'wx');
      const payload: HelperMutexInfo = {
        pid: process.pid,
        startedAt: new Date().toISOString(),
      };
      writeFileSync(fd, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
      closeSync(fd);

      return {
        path: mutexPath,
        pid: process.pid,
        release: () => {
          try {
            const current = readHelperMutex(sessionPath);
            if (!current || current.pid === process.pid) {
              unlinkSync(mutexPath);
            }
          } catch {
            // ignore release races during shutdown
          }
        },
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code !== 'EEXIST') {
        throw error;
      }
    }
  }

  const leftover = readHelperMutex(sessionPath);
  throw new Error(
    `EXISTING_HELPER_FOUND Unable to acquire helper mutex${leftover ? ` (pid=${leftover.pid})` : ''}.`,
  );
}

export function listProfileLockFiles(userDataDir: string): string[] {
  if (!existsSync(userDataDir)) {
    return [];
  }

  return PROFILE_LOCK_FILES.filter((name) => existsSync(path.join(userDataDir, name)));
}

export function findBrowserProcessesUsingProfile(userDataDir: string): BrowserProcessOwner[] {
  if (process.platform !== 'win32' || !userDataDir.trim()) {
    return [];
  }

  const normalizedNeedle = path.normalize(userDataDir).toLowerCase();
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$needle = ${JSON.stringify(normalizedNeedle)}
Get-CimInstance Win32_Process |
  Where-Object {
    $_.Name -match '^(msedge|chrome|chromium|opera|brave)\\.exe$' -and
    $_.CommandLine -and
    ($_.CommandLine.ToLower().Contains($needle) -or $_.CommandLine.ToLower().Contains('session-patrol-evidence-platform'))
  } |
  Select-Object ProcessId, Name, CommandLine |
  ConvertTo-Json -Compress
`;

  try {
    const output = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 15_000 },
    ).trim();

    if (!output) {
      return [];
    }

    const parsed = JSON.parse(output) as
      | { ProcessId: number; Name: string; CommandLine?: string }
      | Array<{ ProcessId: number; Name: string; CommandLine?: string }>;
    const rows = Array.isArray(parsed) ? parsed : [parsed];

    return rows
      .map((row) => ({
        pid: Number(row.ProcessId),
        name: String(row.Name || 'unknown'),
        commandLine: String(row.CommandLine || ''),
      }))
      .filter((row) => Number.isFinite(row.pid) && row.pid > 0);
  } catch {
    return [];
  }
}

export function detectProfileLock(userDataDir: string): ProfileLockStatus {
  const lockFilesPresent = listProfileLockFiles(userDataDir);
  const owners = findBrowserProcessesUsingProfile(userDataDir);
  return {
    userDataDir,
    locked: lockFilesPresent.length > 0 || owners.length > 0,
    lockFilesPresent,
    owners,
  };
}

export function formatBrowserOwners(owners: BrowserProcessOwner[]): string {
  if (owners.length === 0) {
    return 'none';
  }

  return owners
    .map((owner) => `pid=${owner.pid} name=${owner.name}`)
    .join(' | ');
}

export function isProfileLockErrorMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('browser is already running') ||
    normalized.includes('profile appears to be in use') ||
    normalized.includes('profile is in use') ||
    normalized.includes('singletonlock') ||
    (normalized.includes('userdatadir') && normalized.includes('already')) ||
    normalized.includes('the browser is already running for') ||
    normalized.includes('opening in existing browser session') ||
    normalized.includes('profile_lock') ||
    normalized.includes('existing_helper_found')
  );
}

export function buildProfileLockFailureMessage(
  userDataDir: string,
  owners: BrowserProcessOwner[],
  details?: string,
): string {
  const ownerText =
    owners.length > 0
      ? owners.map((owner) => `${owner.name} (pid ${owner.pid})`).join(', ')
      : 'unknown process (lock files present)';
  const suffix = details?.trim() ? ` Details: ${details.trim()}` : '';
  return `WhatsApp browser profile is locked at ${userDataDir}. Holding process: ${ownerText}.${suffix}`;
}

export async function terminateBrowserOwners(
  owners: BrowserProcessOwner[],
  options?: { forceAfterMs?: number },
): Promise<void> {
  const forceAfterMs = options?.forceAfterMs ?? 5_000;
  const uniquePids = [...new Set(owners.map((owner) => owner.pid).filter((pid) => pid > 0))];

  for (const pid of uniquePids) {
    if (pid === process.pid) {
      continue;
    }

    try {
      if (process.platform === 'win32') {
        // Ask Windows to terminate the owned process tree together. A browser
        // root can exit while renderer/storage descendants continue holding
        // Chromium's Singleton* locks, so killing only the root is insufficient.
        execFileSync('taskkill', ['/PID', String(pid), '/T'], {
          encoding: 'utf8',
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } else {
        process.kill(pid, 'SIGTERM');
      }
    } catch {
      // process may already have exited
    }
  }

  const deadline = Date.now() + forceAfterMs;
  while (Date.now() < deadline) {
    if (uniquePids.every((pid) => !isProcessAlive(pid))) {
      return;
    }
    await sleep(250);
  }

  for (const pid of uniquePids) {
    if (!isProcessAlive(pid) || pid === process.pid) {
      continue;
    }

    try {
      if (process.platform === 'win32') {
        execFileSync('taskkill', ['/PID', String(pid), '/F', '/T'], {
          encoding: 'utf8',
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } else {
        process.kill(pid, 'SIGKILL');
      }
    } catch {
      // ignore
    }
  }
}

function releaseProbe(userDataDir: string): boolean {
  if (!existsSync(userDataDir)) {
    return true;
  }

  const probe = path.join(userDataDir, `.patrol-profile-release-${process.pid}-${Date.now()}`);
  const renamed = `${probe}.renamed`;
  try {
    writeFileSync(probe, 'release-probe', 'utf8');
    renameSync(probe, renamed);
    unlinkSync(renamed);
    return true;
  } catch {
    try {
      if (existsSync(probe)) unlinkSync(probe);
      if (existsSync(renamed)) unlinkSync(renamed);
    } catch {
      // best-effort cleanup only
    }
    return false;
  }
}

/**
 * Stops only browser processes identified as using this profile and waits for
 * the profile to become genuinely reusable. The repeated settle checks are
 * intentional: Windows can publish renderer/storage descendants shortly after
 * the Puppeteer root exits.
 */
export async function releaseProfileOwnership(
  userDataDir: string,
  log?: (event: string, details: string) => void,
  options?: { timeoutMs?: number; forceAfterMs?: number },
): Promise<ProfileLockStatus> {
  const timeoutMs = options?.timeoutMs ?? 30_000;
  const forceAfterMs = options?.forceAfterMs ?? 5_000;
  const startedAt = Date.now();
  let last = detectProfileLock(userDataDir);
  let cleanChecks = 0;

  while (Date.now() - startedAt < timeoutMs) {
    if (last.owners.length > 0) {
      log?.('PROFILE_OWNERS_DETECTED', `userDataDir=${userDataDir} owners=${formatBrowserOwners(last.owners)}`);
      await terminateBrowserOwners(last.owners, { forceAfterMs });
      cleanChecks = 0;
    }

    if (last.owners.length === 0 && last.lockFilesPresent.length > 0) {
      for (const name of last.lockFilesPresent) {
        try {
          unlinkSync(path.join(userDataDir, name));
        } catch {
          // A live owner may recreate the marker; the next probe will catch it.
        }
      }
    }

    last = detectProfileLock(userDataDir);
    if (!last.locked && releaseProbe(userDataDir)) {
      cleanChecks += 1;
      if (cleanChecks >= 3) {
        log?.('PROFILE_OWNERSHIP_RELEASED', `userDataDir=${userDataDir} settleChecks=${cleanChecks}`);
        return last;
      }
    } else {
      cleanChecks = 0;
    }

    await sleep(400);
  }

  last = detectProfileLock(userDataDir);
  throw new ProfileLockError(
    buildProfileLockFailureMessage(
      userDataDir,
      last.owners,
      'Profile ownership was not released within the bounded relink barrier.',
    ),
    userDataDir,
    last.owners,
  );
}

export async function waitForProfileUnlock(
  userDataDir: string,
  timeoutMs = 20_000,
): Promise<ProfileLockStatus> {
  const startedAt = Date.now();
  let last = detectProfileLock(userDataDir);

  while (last.locked && Date.now() - startedAt < timeoutMs) {
    await sleep(400);
    last = detectProfileLock(userDataDir);
  }

  return last;
}

export async function ensureProfileUnlocked(
  userDataDir: string,
  log: (event: string, details: string) => void,
): Promise<ProfileLockStatus> {
  let status = detectProfileLock(userDataDir);
  if (!status.locked) {
    return status;
  }

  log(
    'PROFILE_LOCK_DETECTED',
    `userDataDir=${userDataDir} lockFiles=${status.lockFilesPresent.join(',') || 'none'} owners=${formatBrowserOwners(status.owners)}`,
  );

  if (status.owners.length > 0) {
    log('EXISTING_BROWSER_FOUND', formatBrowserOwners(status.owners));
    await terminateBrowserOwners(status.owners);
  }

  status = await waitForProfileUnlock(userDataDir, 20_000);
  if (status.locked) {
    // Stale lock files with no living owner — clear Chromium singleton markers only.
    if (status.owners.length === 0 && status.lockFilesPresent.length > 0) {
      for (const name of status.lockFilesPresent) {
        try {
          unlinkSync(path.join(userDataDir, name));
        } catch {
          // ignore
        }
      }
      status = detectProfileLock(userDataDir);
    }
  }

  if (status.locked) {
    throw new ProfileLockError(
      buildProfileLockFailureMessage(userDataDir, status.owners, 'Profile lock did not clear after closing the existing browser.'),
      userDataDir,
      status.owners,
    );
  }

  log('PROFILE_LOCK_RELEASED', `userDataDir=${userDataDir}`);
  return status;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
