import {
  classifyPostAuthCompatibility,
  extractUnknownWaWebModule,
  isWwebjsModuleCompatibilitySignal,
  shouldTreatAsModuleCompatibilityFailure,
  WWEBJS_MODULE_COMPATIBILITY_ERROR,
} from './wwebjs-compatibility';

const compatibleProbe = {
  hasWindowStore: false,
  hasAuthStore: true,
  hasChatCollection: true,
  hasMsgCollection: true,
  socketModuleId: 'WAWebSocketModel',
  socketStrategy: 'require',
  missingDependencies: [],
  waState: 'CONNECTED',
  getChatsOk: null,
  getChatsError: null,
  getChatsCount: null,
  chatCollectionReadOk: true,
  chatCollectionReadError: null,
  chatModelCount: 1,
};

describe('wwebjs-compatibility', () => {
  it('keeps the patched auth-store socket resolver inside the Puppeteer-serialized function', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ExposeAuthStore } = require('whatsapp-web.js/src/util/Injected/AuthStore/AuthStore');
    const modules: Record<string, unknown> = {
      WAWebSocketModel: { Socket: { on: jest.fn(), state: 'UNLAUNCHED' } },
      WAWebCmd: { Cmd: {} },
      WAWebConnModel: { Conn: {} },
      WAWebOfflineHandler: { OfflineMessageHandler: {} },
      WAWebAltDeviceLinkingApi: {},
      WABase64: {},
      WAWebCompanionRegClientUtils: {},
      WAWebAdvSignatureApi: {},
      WAWebUserPrefsInfoStore: {},
      WAWebSignalStoreApi: {},
    };
    const pageWindow = {
      require: (moduleId: string) => modules[moduleId],
    } as { require(moduleId: string): unknown; AuthStore?: { AppState: unknown } };

    const serializedExposeAuthStore = new Function(
      'window',
      `return (${ExposeAuthStore.toString()})();`,
    );

    expect(() => serializedExposeAuthStore(pageWindow)).not.toThrow();
    expect(pageWindow.AuthStore?.AppState).toBe(
      (modules.WAWebSocketModel as { Socket: unknown }).Socket,
    );
  });

  it('detects WAWebSocketModel unknown module errors', () => {
    const text = 'Requiring unknown module "WAWebSocketModel"';
    expect(isWwebjsModuleCompatibilitySignal(text)).toBe(true);
    expect(extractUnknownWaWebModule(text)).toBe('WAWebSocketModel');
  });

  it('detects other WAWeb unknown modules', () => {
    expect(isWwebjsModuleCompatibilitySignal('Requiring unknown module "WAWebCollections"')).toBe(
      true,
    );
  });

  it('treats authenticated + !ready timeout as compatibility failure', () => {
    expect(
      shouldTreatAsModuleCompatibilityFailure({
        authenticated: true,
        ready: false,
        pageSignals: [],
        timedOutAfterAuth: true,
      }),
    ).toBe(true);
  });

  it('treats CHAT_STORE_NOT_READY after auth as compatibility failure', () => {
    expect(
      shouldTreatAsModuleCompatibilityFailure({
        authenticated: true,
        ready: false,
        pageSignals: [],
        chatStoreNotReady: true,
      }),
    ).toBe(true);
  });

  it('exposes a distinct failure code that is not logout', () => {
    expect(WWEBJS_MODULE_COMPATIBILITY_ERROR).toBe('WWEBJS_MODULE_COMPATIBILITY_ERROR');
    expect(WWEBJS_MODULE_COMPATIBILITY_ERROR.toLowerCase().includes('logout')).toBe(false);
  });

  it('accepts the minimum post-auth Store contract without enumerating chats', () => {
    expect(classifyPostAuthCompatibility(compatibleProbe)).toBeNull();
  });

  it.each([
    [{ hasAuthStore: false }, 'STORE_NOT_EXPOSED'],
    [{ hasChatCollection: false }, 'CHAT_MODULE_MISSING'],
    [{ hasMsgCollection: false }, 'MESSAGE_MODULE_MISSING'],
    [{ missingDependencies: ['WWebJS.getChats'] }, 'GET_CHATS_UNAVAILABLE'],
    [{ chatCollectionReadOk: false }, 'CHAT_COLLECTION_READ_FAILED'],
    [{ waState: 'OPENING' }, 'WHATSAPP_NOT_CONNECTED'],
  ])('reports a precise compatibility failure for %j', (override, expected) => {
    expect(classifyPostAuthCompatibility({ ...compatibleProbe, ...override })).toBe(expected);
  });

  it('replaces a Puppeteer binding retained across page navigation', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { exposeFunctionIfAbsent } = require('whatsapp-web.js/src/util/Puppeteer');
    const duplicate = new Error('Failed to add page binding with name onQRChangedEvent: already exists!');
    const page = {
      evaluate: jest.fn().mockResolvedValue(false),
      exposeFunction: jest.fn().mockRejectedValueOnce(duplicate).mockResolvedValueOnce(undefined),
      removeExposedFunction: jest.fn().mockResolvedValue(undefined),
    };
    const callback = jest.fn();

    await exposeFunctionIfAbsent(page, 'onQRChangedEvent', callback);

    expect(page.removeExposedFunction).toHaveBeenCalledWith('onQRChangedEvent');
    expect(page.exposeFunction).toHaveBeenNthCalledWith(2, 'onQRChangedEvent', callback);
  });
});
