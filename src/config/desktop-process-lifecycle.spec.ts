// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createDesktopProcessLifecycle } = require('../../desktop/process-lifecycle') as {
  createDesktopProcessLifecycle(): {
    beginQuit(): void;
    isQuitting(): boolean;
    expectChildExit(child: object): void;
    classifyChildExit(
      child: object,
      currentChild: object | null,
      flags?: { restarting?: boolean; recoveringPort?: boolean },
    ): { current: boolean; expected: boolean };
    notifyRenderer(window: ReturnType<typeof createWindow> | null, channel: string, payload: unknown): boolean;
  };
};

function createWindow(windowDestroyed = false, webContentsDestroyed = false) {
  return {
    isDestroyed: jest.fn(() => windowDestroyed),
    webContents: {
      isDestroyed: jest.fn(() => webContentsDestroyed),
      send: jest.fn(),
    },
  };
}

describe('desktop process lifecycle', () => {
  it('notifies an existing BrowserWindow when the backend exits', () => {
    const lifecycle = createDesktopProcessLifecycle();
    const window = createWindow();
    expect(lifecycle.notifyRenderer(window, 'desktop:backend-status', { status: 'stopped' })).toBe(true);
    expect(window.webContents.send).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['BrowserWindow', createWindow(true, false)],
    ['webContents', createWindow(false, true)],
  ])('does not access destroyed %s after the backend exits', (_label, window) => {
    const lifecycle = createDesktopProcessLifecycle();
    expect(lifecycle.notifyRenderer(window, 'desktop:backend-status', { status: 'stopped' })).toBe(false);
    expect(window.webContents.send).not.toHaveBeenCalled();
  });

  it('classifies backend exit during application quit as expected', () => {
    const lifecycle = createDesktopProcessLifecycle();
    const child = {};
    lifecycle.beginQuit();
    expect(lifecycle.isQuitting()).toBe(true);
    expect(lifecycle.classifyChildExit(child, child)).toEqual({ current: true, expected: true });
  });

  it('preserves unexpected backend crash handling while the app is active', () => {
    const lifecycle = createDesktopProcessLifecycle();
    const child = {};
    expect(lifecycle.classifyChildExit(child, child)).toEqual({ current: true, expected: false });
  });

  it('treats an old child exit during restart as expected and stale', () => {
    const lifecycle = createDesktopProcessLifecycle();
    const oldChild = {};
    const replacementChild = {};
    lifecycle.expectChildExit(oldChild);
    expect(lifecycle.classifyChildExit(oldChild, replacementChild, { restarting: true })).toEqual({
      current: false,
      expected: true,
    });
  });

  it('keeps repeated shutdown transitions idempotently in the quitting state', () => {
    const lifecycle = createDesktopProcessLifecycle();
    const child = {};
    lifecycle.beginQuit();
    lifecycle.beginQuit();
    lifecycle.expectChildExit(child);
    lifecycle.expectChildExit(child);
    expect(lifecycle.isQuitting()).toBe(true);
    expect(lifecycle.classifyChildExit(child, child)).toEqual({ current: true, expected: true });
  });
});
