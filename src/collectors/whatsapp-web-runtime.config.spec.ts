import {
  resolveBrowserExecutables,
  resolveWhatsAppBrowserPreference,
  resolveWhatsAppWebVersionMode,
  buildWhatsAppWebClientOptions,
  getWhatsAppWebVersionLogSnapshot,
} from './whatsapp-web-runtime.config';

describe('whatsapp-web-runtime browser and version selection', () => {
  const previousEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...previousEnv };
  });

  it('forces chrome-only selection when WHATSAPP_BROWSER=chrome', () => {
    process.env.WHATSAPP_BROWSER = 'chrome';
    delete process.env.PATROL_HELPER_EDGE_PATH;
    expect(resolveWhatsAppBrowserPreference()).toBe('chrome');

    const resolved = resolveBrowserExecutables();
    expect(resolved.preference).toBe('chrome');
    expect(resolved.available.every((browser) => browser.source === 'chrome')).toBe(true);
  });

  it('fails clearly for an unsupported explicit browser preference', () => {
    process.env.WHATSAPP_BROWSER = 'firefox';
    expect(() => resolveWhatsAppBrowserPreference()).toThrow(
      'Invalid WHATSAPP_BROWSER="firefox". Use chrome, edge, or auto.',
    );
  });

  it('never selects Edge when Chrome preference is set even if Edge exists', () => {
    process.env.WHATSAPP_BROWSER = 'chrome';
    process.env.PATROL_HELPER_CHROME_PATH =
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    process.env.PATROL_HELPER_EDGE_PATH =
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

    const resolved = resolveBrowserExecutables();
    expect(resolved.available.every((browser) => !/msedge\.exe$/i.test(browser.executablePath))).toBe(
      true,
    );
  });

  it('uses live WhatsApp Web runtime with explicit cache none when mode=live', () => {
    process.env.PATROL_WHATSAPP_WEB_VERSION_MODE = 'live';
    expect(resolveWhatsAppWebVersionMode()).toBe('live');

    const options = buildWhatsAppWebClientOptions({
      headless: true,
      executablePath: 'C:\\fake\\chrome.exe',
    });
    expect(options.webVersion).toBeUndefined();
    expect(options.webVersionCache).toEqual({ type: 'none', strict: true });
    expect(options.puppeteer.executablePath).toContain('chrome.exe');
  });

  it('keeps pinned mode explicit and separate from live', () => {
    process.env.PATROL_WHATSAPP_WEB_VERSION_MODE = 'pinned';
    expect(resolveWhatsAppWebVersionMode()).toBe('pinned');
    const snapshot = getWhatsAppWebVersionLogSnapshot();
    expect(snapshot.mode).toBe('pinned');
    expect(snapshot.cacheMode).toBe('local');
    expect(snapshot.cacheStrict).toBe('true');
  });

  it('supports library-default mode for Test A without forcing a custom pin', () => {
    process.env.PATROL_WHATSAPP_WEB_VERSION_MODE = 'library-default';
    expect(resolveWhatsAppWebVersionMode()).toBe('library-default');
    const options = buildWhatsAppWebClientOptions({
      headless: true,
      executablePath: 'C:\\fake\\chrome.exe',
    });
    expect(options.webVersion).toBeUndefined();
    expect(options.webVersionCache).toBeUndefined();
  });
});
