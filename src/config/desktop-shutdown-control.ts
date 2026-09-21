import { Readable } from 'stream';

/** The packaged parent alone owns this anonymous pipe; no HTTP endpoint is exposed. */
export function installDesktopShutdownControl(
  input: Readable,
  sessionId: string,
  close: () => Promise<unknown>,
  exit: (code: number) => void,
  log: (event: string, details?: string) => void,
): void {
  let pending = '';
  let closing = false;
  input.setEncoding('utf8');
  input.on('data', (chunk: string) => {
    if (closing) return;
    pending += chunk;
    if (pending.length > 256) {
      pending = '';
      return;
    }
    const lineEnd = pending.indexOf('\n');
    if (lineEnd < 0) return;
    const command = pending.slice(0, lineEnd).trim();
    pending = '';
    if (command !== `PATROLSAFE_SHUTDOWN ${sessionId}`) return;
    closing = true;
    log('desktop-shutdown-requested');
    void close().then(() => {
      log('desktop-shutdown-complete');
      exit(0);
    }).catch((error) => {
      log('desktop-shutdown-failed', error instanceof Error ? error.message : String(error));
      exit(1);
    });
  });
}
