function canNotifyRenderer(window) {
  return Boolean(
    window &&
      !window.isDestroyed() &&
      window.webContents &&
      !window.webContents.isDestroyed(),
  );
}

function createDesktopProcessLifecycle() {
  const expectedChildExits = new WeakSet();
  let quitting = false;

  return {
    beginQuit() {
      quitting = true;
    },

    isQuitting() {
      return quitting;
    },

    expectChildExit(child) {
      if (child && (typeof child === 'object' || typeof child === 'function')) {
        expectedChildExits.add(child);
      }
    },

    classifyChildExit(child, currentChild, { restarting = false, recoveringPort = false } = {}) {
      return {
        current: child === currentChild,
        expected: quitting || restarting || recoveringPort || expectedChildExits.has(child),
      };
    },

    notifyRenderer(window, channel, payload) {
      if (!canNotifyRenderer(window)) {
        return false;
      }

      window.webContents.send(channel, payload);
      return true;
    },
  };
}

module.exports = {
  canNotifyRenderer,
  createDesktopProcessLifecycle,
};
