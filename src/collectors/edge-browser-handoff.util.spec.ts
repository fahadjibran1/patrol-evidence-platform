import type { Browser, LaunchOptions } from "puppeteer";
import {
  createEdgeBrowserHandoffLaunchAdapter,
  isCleanEdgeProcessHandoffError,
} from "./edge-browser-handoff.util";
import type {
  BrowserProcessOwner,
  DevToolsEndpointStatus,
  ProfileLockStatus,
} from "./browser-profile-lock.util";

const options: LaunchOptions = {
  executablePath:
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  userDataDir: "C:\\UAT Data\\session-patrol-evidence-platform",
  headless: false,
};

function endpoint(
  port: number | null,
  websocketPath: string | null,
): DevToolsEndpointStatus {
  return {
    path: `${options.userDataDir}\\DevToolsActivePort`,
    ready: Boolean(port && websocketPath),
    port,
    websocketPath,
  };
}

function lock(
  owners: BrowserProcessOwner[] = [],
  lockFilesPresent: string[] = [],
): ProfileLockStatus {
  return {
    userDataDir: options.userDataDir!,
    locked: owners.length > 0 || lockFilesPresent.length > 0,
    owners,
    lockFilesPresent,
  };
}

function browser(connected = true): Browser {
  return {
    isConnected: () => connected,
    close: jest.fn().mockResolvedValue(undefined),
  } as unknown as Browser;
}

const cleanExit = new Error(
  "Failed to launch the browser process:  Code: 0\nstderr:",
);

describe("Edge browser DevTools handoff", () => {
  it("recognises only the observed clean Edge launcher exit", () => {
    expect(isCleanEdgeProcessHandoffError(cleanExit)).toBe(true);
    expect(isCleanEdgeProcessHandoffError(new Error("Code: 1"))).toBe(false);
  });

  it("adopts a newly owned ready endpoint after the original root exits", async () => {
    const survivingOwners = [
      {
        pid: 5448,
        parentPid: 1,
        name: "msedge.exe",
        commandLine: `--user-data-dir=${options.userDataDir}`,
      },
      {
        pid: 8916,
        parentPid: 5448,
        name: "msedge.exe",
        commandLine: "--type=renderer",
      },
    ];
    const inspections = [
      { endpoint: endpoint(null, null), lock: lock() },
      {
        endpoint: endpoint(50485, "/devtools/browser/current-generation"),
        lock: lock(survivingOwners),
      },
    ];
    const adopted = browser();
    const connect = jest.fn().mockResolvedValue(adopted);
    const onAdoptedOwners = jest.fn();
    const launch = createEdgeBrowserHandoffLaunchAdapter({
      launch: jest.fn().mockRejectedValue(cleanExit),
      connect,
      inspect: jest.fn(() => inspections.shift() ?? inspections[0]),
      onAdoptedOwners,
    });

    await expect(launch(options)).resolves.toBe(adopted);
    expect(connect).toHaveBeenCalledWith(
      expect.objectContaining({
        browserWSEndpoint:
          "ws://127.0.0.1:50485/devtools/browser/current-generation",
      }),
    );
    expect(onAdoptedOwners).toHaveBeenCalledWith(survivingOwners);
  });

  it("rejects a pre-existing profile owner", async () => {
    const prior = [
      {
        pid: 99,
        name: "msedge.exe",
        commandLine: `--user-data-dir=${options.userDataDir}`,
      },
    ];
    const connect = jest.fn();
    const launch = createEdgeBrowserHandoffLaunchAdapter({
      launch: jest.fn().mockRejectedValue(cleanExit),
      connect,
      inspect: jest.fn(() => ({
        endpoint: endpoint(50485, "/devtools/browser/prior"),
        lock: lock(prior),
      })),
    });

    await expect(launch(options)).rejects.toBe(cleanExit);
    expect(connect).not.toHaveBeenCalled();
  });

  it("does not adopt a non-zero browser failure", async () => {
    const failure = new Error("Failed to launch the browser process: Code: 1");
    const connect = jest.fn();
    const launch = createEdgeBrowserHandoffLaunchAdapter({
      launch: jest.fn().mockRejectedValue(failure),
      connect,
      inspect: jest.fn(() => ({
        endpoint: endpoint(null, null),
        lock: lock(),
      })),
    });

    await expect(launch(options)).rejects.toBe(failure);
    expect(connect).not.toHaveBeenCalled();
  });

  it("rejects a stale endpoint when no new marker is written", async () => {
    let now = 0;
    const connect = jest.fn();
    const launch = createEdgeBrowserHandoffLaunchAdapter({
      launch: jest.fn().mockRejectedValue(cleanExit),
      connect,
      inspect: jest.fn(() => ({
        endpoint: endpoint(50485, "/devtools/browser/stale"),
        lock: lock(),
      })),
      now: () => now,
      sleep: async () => {
        now += 10;
      },
      waitMs: 20,
      pollMs: 10,
    });

    await expect(launch(options)).rejects.toBe(cleanExit);
    expect(connect).not.toHaveBeenCalled();
  });

  it("rejects a ready endpoint when no newly owned process exists", async () => {
    const inspections = [
      { endpoint: endpoint(null, null), lock: lock() },
      {
        endpoint: endpoint(50485, "/devtools/browser/current"),
        lock: lock(),
      },
    ];
    const lastInspection = inspections[inspections.length - 1];
    let now = 0;
    const connect = jest.fn();
    const launch = createEdgeBrowserHandoffLaunchAdapter({
      launch: jest.fn().mockRejectedValue(cleanExit),
      connect,
      inspect: jest.fn(() => inspections.shift() ?? lastInspection),
      now: () => now,
      sleep: async () => {
        now += 10;
      },
      waitMs: 10,
      pollMs: 10,
    });

    await expect(launch(options)).rejects.toBe(cleanExit);
    expect(connect).not.toHaveBeenCalled();
  });

  it("closes and rejects an adopted endpoint that is not operational", async () => {
    const survivingOwner = {
      pid: 5448,
      name: "msedge.exe",
      commandLine: `--user-data-dir=${options.userDataDir}`,
    };
    const inspections = [
      { endpoint: endpoint(null, null), lock: lock() },
      {
        endpoint: endpoint(50485, "/devtools/browser/current"),
        lock: lock([survivingOwner]),
      },
    ];
    const disconnected = browser(false);
    const launch = createEdgeBrowserHandoffLaunchAdapter({
      launch: jest.fn().mockRejectedValue(cleanExit),
      connect: jest.fn().mockResolvedValue(disconnected),
      inspect: jest.fn(() => inspections.shift()!),
    });

    await expect(launch(options)).rejects.toBe(cleanExit);
    expect(disconnected.close).toHaveBeenCalledTimes(1);
  });

  it("does not apply the Edge handoff policy to another browser family", async () => {
    const failure = new Error("Failed to launch the browser process:  Code: 0");
    const inspect = jest.fn();
    const connect = jest.fn();
    const launch = createEdgeBrowserHandoffLaunchAdapter({
      launch: jest.fn().mockRejectedValue(failure),
      connect,
      inspect,
    });

    await expect(
      launch({ ...options, executablePath: "C:\\Chrome\\chrome.exe" }),
    ).rejects.toBe(failure);
    expect(inspect).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });

  it("returns the ordinary launch result without attempting adoption", async () => {
    const launched = browser();
    const connect = jest.fn();
    const originalLaunch = jest.fn().mockResolvedValue(launched);
    const launch = createEdgeBrowserHandoffLaunchAdapter({
      launch: originalLaunch,
      connect,
      inspect: jest.fn(() => ({
        endpoint: endpoint(null, null),
        lock: lock(),
      })),
    });

    await expect(launch(options)).resolves.toBe(launched);
    expect(connect).not.toHaveBeenCalled();
  });
});
