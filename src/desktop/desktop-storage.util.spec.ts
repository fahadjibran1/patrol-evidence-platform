import { resolveDesktopWhatsAppAutoStart } from './desktop-storage.util';

describe('resolveDesktopWhatsAppAutoStart', () => {
  const originalDesktopConfigPath = process.env.DESKTOP_CONFIG_PATH;
  const originalWhatsappAutoStart = process.env.WHATSAPP_AUTO_START;

  afterEach(() => {
    if (originalDesktopConfigPath === undefined) {
      delete process.env.DESKTOP_CONFIG_PATH;
    } else {
      process.env.DESKTOP_CONFIG_PATH = originalDesktopConfigPath;
    }

    if (originalWhatsappAutoStart === undefined) {
      delete process.env.WHATSAPP_AUTO_START;
    } else {
      process.env.WHATSAPP_AUTO_START = originalWhatsappAutoStart;
    }
  });

  it('returns false when autoStartCollector is not explicitly enabled', () => {
    process.env.DESKTOP_CONFIG_PATH = 'C:/Patrol/workspace.json';
    process.env.WHATSAPP_AUTO_START = 'true';

    expect(
      resolveDesktopWhatsAppAutoStart({
        autoStartCollector: false,
        setupCompleted: true,
      }),
    ).toBe(false);

    expect(
      resolveDesktopWhatsAppAutoStart({
        setupCompleted: true,
      }),
    ).toBe(false);
  });

  it('returns false when setup is not completed in desktop mode', () => {
    process.env.DESKTOP_CONFIG_PATH = 'C:/Patrol/workspace.json';

    expect(
      resolveDesktopWhatsAppAutoStart({
        autoStartCollector: true,
        setupCompleted: false,
      }),
    ).toBe(false);
  });

  it('resumes an explicitly enabled monitoring preference after completed desktop setup', () => {
    process.env.DESKTOP_CONFIG_PATH = 'C:/Patrol/workspace.json';
    process.env.WHATSAPP_AUTO_START = 'true';

    expect(
      resolveDesktopWhatsAppAutoStart({
        autoStartCollector: true,
        setupCompleted: true,
      }),
    ).toBe(true);
  });

  it('falls back to WHATSAPP_AUTO_START outside desktop config mode', () => {
    delete process.env.DESKTOP_CONFIG_PATH;
    process.env.WHATSAPP_AUTO_START = 'true';

    expect(
      resolveDesktopWhatsAppAutoStart({
        autoStartCollector: true,
        setupCompleted: true,
      }),
    ).toBe(true);
  });
});
