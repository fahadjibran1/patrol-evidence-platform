import { EventEmitter } from 'events';

// The Electron module is CommonJS and intentionally has no Nest dependency.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { stopSpawnedBackend } = require('../../desktop/backend-shutdown') as {
  stopSpawnedBackend: (child: FakeChild, options: Record<string, unknown>) => Promise<string>;
};

class FakeChild extends EventEmitter {
  pid = 4242;
  exitCode: number | null = null;
  stdin = { writable: true, write: jest.fn((_value: string, _callback: (error?: Error) => void) => true) };
  kill = jest.fn();
}

describe('Electron-owned backend shutdown', () => {
  afterEach(() => jest.useRealTimers());

  it('requests graceful private-pipe shutdown and waits for the exact child exit', async () => {
    const child = new FakeChild();
    const forceKillTree = jest.fn();
    const stopping = stopSpawnedBackend(child, { sessionId: 'session-a', timeoutMs: 100, forceKillTree });
    expect(child.stdin.write).toHaveBeenCalledWith('PATROLSAFE_SHUTDOWN session-a\n', expect.any(Function));
    expect(child.kill).not.toHaveBeenCalled();
    child.exitCode = 0;
    child.emit('exit', 0, null);
    expect(await stopping).toBe('exited');
    expect(forceKillTree).not.toHaveBeenCalled();
  });

  it('forces only the recorded backend process tree after a bounded timeout', async () => {
    jest.useFakeTimers();
    const child = new FakeChild();
    const unrelatedBrowser = { pid: 9001, alive: true };
    const forceKillTree = jest.fn();
    const stopping = stopSpawnedBackend(child, { sessionId: 'session-a', timeoutMs: 50, forceKillTree, isCurrent: () => true });
    await jest.advanceTimersByTimeAsync(50);
    expect(await stopping).toBe('forced');
    expect(forceKillTree).toHaveBeenCalledTimes(1);
    expect(forceKillTree).toHaveBeenCalledWith(4242);
    expect(unrelatedBrowser.alive).toBe(true);
  });

  it('does not force a stale or replaced child PID', async () => {
    jest.useFakeTimers();
    const child = new FakeChild();
    const forceKillTree = jest.fn();
    const stopping = stopSpawnedBackend(child, { sessionId: 'session-a', timeoutMs: 50, forceKillTree, isCurrent: () => false });
    await jest.advanceTimersByTimeAsync(50);
    expect(await stopping).toBe('exited');
    expect(forceKillTree).not.toHaveBeenCalled();
  });

  it('falls back when the private control pipe fails', async () => {
    const child = new FakeChild();
    const stopping = stopSpawnedBackend(child, { sessionId: 'session-a', timeoutMs: 100 });
    const callback = child.stdin.write.mock.calls[0][1] as (error?: Error) => void;
    callback(new Error('synthetic pipe failure'));
    expect(child.kill).toHaveBeenCalledTimes(1);
    child.exitCode = 0;
    child.emit('exit', 0, null);
    await stopping;
  });
});
