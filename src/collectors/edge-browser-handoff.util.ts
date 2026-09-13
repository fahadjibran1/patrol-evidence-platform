import * as path from "path";
import type { Browser, ConnectOptions, LaunchOptions } from "puppeteer";
import {
  type BrowserProcessOwner,
  type DevToolsEndpointStatus,
  type ProfileLockStatus,
} from "./browser-profile-lock.util";

const CLEAN_EDGE_HANDOFF_ERROR =
  /Failed to launch the browser process:\s+Code:\s*0\b/i;
const DEFAULT_HANDOFF_WAIT_MS = 5_000;
const DEFAULT_POLL_MS = 100;

export interface EdgeHandoffInspection {
  endpoint: DevToolsEndpointStatus;
  lock: ProfileLockStatus;
}

export interface EdgeHandoffLogger {
  (event: string, details: string): void;
}

export interface EdgeHandoffAdapterDependencies {
  launch: (options: LaunchOptions) => Promise<Browser>;
  connect: (options: ConnectOptions) => Promise<Browser>;
  inspect: (userDataDir: string) => EdgeHandoffInspection;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  waitMs?: number;
  pollMs?: number;
  log?: EdgeHandoffLogger;
  onAdoptedOwners?: (owners: BrowserProcessOwner[]) => void;
}

function isMicrosoftEdgeExecutable(
  executablePath: string | undefined,
): boolean {
  return Boolean(
    executablePath &&
    path.basename(executablePath).toLowerCase() === "msedge.exe",
  );
}

function endpointIdentity(endpoint: DevToolsEndpointStatus): string | null {
  if (!endpoint.ready || !endpoint.port || !endpoint.websocketPath) {
    return null;
  }
  return `${endpoint.port}:${endpoint.websocketPath}`;
}

function newlyOwnedProcesses(
  baselineOwners: BrowserProcessOwner[],
  currentOwners: BrowserProcessOwner[],
): BrowserProcessOwner[] {
  const baselinePids = new Set(baselineOwners.map((owner) => owner.pid));
  return currentOwners.filter((owner) => !baselinePids.has(owner.pid));
}

function buildConnectOptions(
  options: LaunchOptions,
  browserWSEndpoint: string,
): ConnectOptions {
  return {
    browserWSEndpoint,
    defaultViewport: options.defaultViewport,
    protocolTimeout: options.protocolTimeout,
    slowMo: options.slowMo,
    acceptInsecureCerts: options.acceptInsecureCerts,
  };
}

/**
 * Adopts an Edge browser only for the narrowly observed Windows ProcessSingleton
 * handoff: Puppeteer's original root exits with code 0, a new DevTools endpoint
 * is written, and a previously unlocked profile gains new Edge owners. Existing
 * owners or a stale endpoint always fail closed.
 */
export function createEdgeBrowserHandoffLaunchAdapter(
  dependencies: EdgeHandoffAdapterDependencies,
): (options: LaunchOptions) => Promise<Browser> {
  const sleep =
    dependencies.sleep ??
    ((milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const now = dependencies.now ?? Date.now;
  const waitMs = dependencies.waitMs ?? DEFAULT_HANDOFF_WAIT_MS;
  const pollMs = dependencies.pollMs ?? DEFAULT_POLL_MS;

  return async (options: LaunchOptions): Promise<Browser> => {
    const userDataDir = options.userDataDir;
    if (
      process.platform !== "win32" ||
      !isMicrosoftEdgeExecutable(options.executablePath) ||
      !userDataDir
    ) {
      return dependencies.launch(options);
    }

    const baseline = dependencies.inspect(userDataDir);
    const baselineEndpoint = endpointIdentity(baseline.endpoint);

    try {
      return await dependencies.launch(options);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!CLEAN_EDGE_HANDOFF_ERROR.test(message) || baseline.lock.locked) {
        throw error;
      }

      const deadline = now() + waitMs;
      while (now() <= deadline) {
        const current = dependencies.inspect(userDataDir);
        const currentEndpoint = endpointIdentity(current.endpoint);
        const owners = newlyOwnedProcesses(
          baseline.lock.owners,
          current.lock.owners,
        );
        const endpointWasReplaced = Boolean(
          currentEndpoint && currentEndpoint !== baselineEndpoint,
        );

        if (
          endpointWasReplaced &&
          owners.length > 0 &&
          owners.length === current.lock.owners.length
        ) {
          const browserWSEndpoint = `ws://127.0.0.1:${current.endpoint.port}${current.endpoint.websocketPath}`;
          dependencies.log?.(
            "EDGE_DEVTOOLS_HANDOFF_ADOPTING",
            `endpoint=${browserWSEndpoint} owners=${owners.map((owner) => owner.pid).join(",")}`,
          );
          try {
            const browser = await dependencies.connect(
              buildConnectOptions(options, browserWSEndpoint),
            );
            if (!browser.isConnected()) {
              await browser.close().catch(() => undefined);
              throw new Error(
                "Edge DevTools handoff connected but the browser is not operational.",
              );
            }
            dependencies.onAdoptedOwners?.(owners);
            dependencies.log?.(
              "EDGE_DEVTOOLS_HANDOFF_ADOPTED",
              `endpoint=${browserWSEndpoint} owners=${owners.map((owner) => owner.pid).join(",")}`,
            );
            return browser;
          } catch (connectError) {
            dependencies.log?.(
              "EDGE_DEVTOOLS_HANDOFF_REJECTED",
              `reason=connect-failed error=${connectError instanceof Error ? connectError.message : String(connectError)}`,
            );
            throw error;
          }
        }

        if (now() >= deadline) {
          break;
        }
        await sleep(pollMs);
      }

      dependencies.log?.(
        "EDGE_DEVTOOLS_HANDOFF_REJECTED",
        "reason=no-new-owned-ready-endpoint",
      );
      throw error;
    }
  };
}

export function isCleanEdgeProcessHandoffError(error: unknown): boolean {
  return CLEAN_EDGE_HANDOFF_ERROR.test(
    error instanceof Error ? error.message : String(error),
  );
}
