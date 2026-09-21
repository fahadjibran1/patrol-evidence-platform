import { PassThrough } from 'stream';
import { installDesktopShutdownControl } from './desktop-shutdown-control';

describe('packaged desktop shutdown control pipe', () => {
  const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

  it('ignores a foreign session and closes exactly once for the parent session', async () => {
    const input = new PassThrough();
    const close = jest.fn().mockResolvedValue(undefined);
    const exit = jest.fn();
    const log = jest.fn();
    installDesktopShutdownControl(input, 'private-session', close, exit, log);

    input.write('PATROLSAFE_SHUTDOWN foreign-session\n');
    await flush();
    expect(close).not.toHaveBeenCalled();
    input.write('PATROLSAFE_SHUTDOWN private-session\n');
    input.write('PATROLSAFE_SHUTDOWN private-session\n');
    await flush();
    expect(close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
    expect(log.mock.calls.map((call) => call[0])).toEqual(['desktop-shutdown-requested', 'desktop-shutdown-complete']);
    expect(JSON.stringify(log.mock.calls)).not.toContain('private-session');
  });

  it('fails closed on oversized input and reports a failed close without exposing the session', async () => {
    const input = new PassThrough();
    const close = jest.fn().mockRejectedValue(new Error('synthetic close failure'));
    const exit = jest.fn();
    const log = jest.fn();
    installDesktopShutdownControl(input, 'private-session', close, exit, log);
    input.write(`${'X'.repeat(300)}\n`);
    await flush();
    expect(close).not.toHaveBeenCalled();
    input.write('PATROLSAFE_SHUTDOWN private-session\n');
    await flush();
    expect(close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
    expect(JSON.stringify(log.mock.calls)).not.toContain('private-session');
  });
});
