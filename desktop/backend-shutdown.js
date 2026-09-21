/** Stop only the backend process spawned by this Electron instance. */
function stopSpawnedBackend(child, options = {}) {
  const timeoutMs = options.timeoutMs ?? 30_000;
  return new Promise((resolve) => {
    let settled = false;
    let pipeFailureHandled = false;
    let stdinErrorHandler = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (stdinErrorHandler && typeof child.stdin?.off === 'function') {
        child.stdin.off('error', stdinErrorHandler);
      }
      resolve(result);
    };
    const timer = setTimeout(() => {
      if ((child.exitCode !== null && child.exitCode !== undefined) ||
          (options.isCurrent && !options.isCurrent())) {
        finish('exited');
        return;
      }
      options.log?.('Backend stop timeout reached', `pid=${child.pid ?? 'unknown'} forcing owned process tree`);
      try {
        options.forceKillTree?.(child.pid);
      } catch (error) {
        options.log?.('Backend owned-tree cleanup failed', error instanceof Error ? error.message : String(error));
        child.kill('SIGKILL');
      }
      finish('forced');
    }, timeoutMs);

    child.once('exit', () => finish('exited'));
    if (child.exitCode !== null && child.exitCode !== undefined) {
      finish('exited');
      return;
    }

    if (options.sessionId && child.stdin?.writable) {
      stdinErrorHandler = (error) => {
        if (settled || pipeFailureHandled) return;
        pipeFailureHandled = true;
        options.log?.('Backend graceful shutdown pipe failed', error.message);
        child.kill();
      };
      if (typeof child.stdin.once === 'function') child.stdin.once('error', stdinErrorHandler);
      child.stdin.write(`PATROLSAFE_SHUTDOWN ${options.sessionId}\n`, (error) => {
        if (error) stdinErrorHandler(error);
      });
    } else {
      child.kill();
    }
  });
}

module.exports = { stopSpawnedBackend };
