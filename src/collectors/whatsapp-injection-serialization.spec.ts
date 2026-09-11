describe('whatsapp-web.js injection compatibility guard', () => {
  function makeClient() {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Client } = require('whatsapp-web.js');
    return new Client({
      puppeteer: { headless: true, args: [] },
    }) as {
      inject: () => Promise<unknown>;
      _injectImpl: () => Promise<unknown>;
      _injectInFlight: boolean;
      _pendingInjectGeneration: number;
      _injectStopping: boolean;
      _injectAuthenticated: boolean;
      destroy: () => Promise<void>;
    };
  }

  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  it('serializes navigation-triggered injection and coalesces requests', async () => {
    const client = makeClient();
    const first = deferred<void>();
    const calls: Promise<void>[] = [];
    client._injectImpl = jest.fn(() => {
      calls.push(first.promise);
      return first.promise;
    });

    const initial = client.inject();
    const navigationOne = client.inject();
    const navigationTwo = client.inject();

    expect(client._injectImpl).toHaveBeenCalledTimes(1);
    expect(client._injectInFlight).toBe(true);
    expect(client._pendingInjectGeneration).toBeGreaterThan(0);

    first.resolve();
    await initial;
    await Promise.resolve();
    expect(client._injectImpl).toHaveBeenCalledTimes(2);

    client._injectAuthenticated = true;
    await Promise.all([navigationOne, navigationTwo].map((promise) => promise.catch(() => undefined)));
    expect(client._injectImpl).toHaveBeenCalledTimes(2);
    expect(calls).toHaveLength(2);
  });

  it('keeps the maximum active injection count at one', async () => {
    const client = makeClient();
    const first = deferred<void>();
    let active = 0;
    let maximum = 0;
    client._injectImpl = jest.fn(async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await first.promise;
      active -= 1;
    });

    const running = client.inject();
    await client.inject();
    await client.inject();
    expect(maximum).toBe(1);
    first.resolve();
    await running;
    await Promise.resolve();
    expect(maximum).toBe(1);
  });

  it('cancels pending reinjection on authentication and shutdown', async () => {
    const client = makeClient();
    const first = deferred<void>();
    client._injectImpl = jest.fn(() => first.promise);
    const running = client.inject();
    void client.inject();
    client._injectAuthenticated = true;
    first.resolve();
    await running;
    await Promise.resolve();
    expect(client._injectImpl).toHaveBeenCalledTimes(1);

    client._injectAuthenticated = false;
    client._injectStopping = false;
    const second = deferred<void>();
    client._injectImpl = jest.fn(() => second.promise);
    const next = client.inject();
    void client.inject();
    await client.destroy();
    second.resolve();
    await next;
    await Promise.resolve();
    expect(client._injectImpl).toHaveBeenCalledTimes(1);
    expect(client._pendingInjectGeneration).toBe(0);
  });

  it('permits a replacement document to rebuild the event bridge after authentication', async () => {
    const client = makeClient();
    client._injectImpl = jest.fn(async () => undefined);
    client._injectAuthenticated = true;

    await client.inject();
    expect(client._injectImpl).not.toHaveBeenCalled();

    // Mirrors the patched main-frame navigation handoff: authentication is
    // document-scoped, so the replacement document must inject once.
    client._injectAuthenticated = false;
    await client.inject();
    expect(client._injectImpl).toHaveBeenCalledTimes(1);
  });

  it('keeps authenticated injection open until the live event bridge reaches ready', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const clientSource = fs.readFileSync(
      path.join(process.cwd(), 'node_modules', 'whatsapp-web.js', 'src', 'Client.js'),
      'utf8',
    );
    const authenticatedCallback = clientSource.slice(
      clientSource.indexOf("'onAppStateHasSyncedEvent'"),
      clientSource.indexOf("'onOfflineProgressUpdateEvent'"),
    );

    expect(authenticatedCallback).not.toMatch(
      /_injectAuthenticated\s*=\s*true;[\s\S]*emit\(Events\.AUTHENTICATED/,
    );
    expect(authenticatedCallback).toMatch(
      /attachEventListeners\(\)[\s\S]*_injectAuthenticated\s*=\s*true;[\s\S]*emit\(Events\.READY/,
    );
    expect(authenticatedCallback).toContain(
      'window.__wwebjsLiveEventBridgeAttached === true',
    );
    expect(authenticatedCallback).not.toContain(
      "return typeof window.WWebJS !== 'undefined'",
    );
  });

  it('registers main-frame reinjection before initial injection can authenticate', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const clientSource = fs.readFileSync(
      path.join(process.cwd(), 'node_modules', 'whatsapp-web.js', 'src', 'Client.js'),
      'utf8',
    );
    const initializeSource = clientSource.slice(
      clientSource.indexOf('async initialize()'),
      clientSource.indexOf('async requestPairingCode'),
    );

    expect(initializeSource.indexOf("this.pupPage.on('framenavigated'")).toBeGreaterThan(-1);
    expect(initializeSource.indexOf("this.pupPage.on('framenavigated'")).toBeLessThan(
      initializeSource.indexOf('await this.inject()'),
    );
  });

  it('completes authenticated setup when reinjection observes an already connected document', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const clientSource = fs.readFileSync(
      path.join(process.cwd(), 'node_modules', 'whatsapp-web.js', 'src', 'Client.js'),
      'utf8',
    );

    expect(clientSource).toContain('window.__wwebjsAuthSyncDispatched');
    expect(clientSource).toContain("window.AuthStore.AppState.state === 'CONNECTED'");
    expect(clientSource).toMatch(
      /if \(window\.__wwebjsAuthSyncDispatched\) return;[\s\S]*window\.__wwebjsAuthSyncDispatched = true;[\s\S]*window\.onAppStateHasSyncedEvent\(\)/,
    );
  });

  it('applies the guard through the checked-in patch-package artifact', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const patch = fs.readFileSync(
      path.join(process.cwd(), 'patches', 'whatsapp-web.js+1.34.7.patch'),
      'utf8',
    );
    expect(patch).toContain('_injectInFlight');
    expect(patch).toContain('_pendingInjectGeneration');
    expect(patch).toContain('_injectStopping');
    expect(patch).toContain('_injectAuthenticated');
    expect(patch).toContain('frame === this.pupPage.mainFrame()');
    expect(patch).toContain('this._injectAuthenticated = false');
    expect(patch).toContain('window.__wwebjsLiveEventBridgeAttached = true');
    expect(patch).toContain('Register navigation ownership before the initial injection');
    expect(patch).toContain('window.__wwebjsAuthSyncDispatched');
  });
});
