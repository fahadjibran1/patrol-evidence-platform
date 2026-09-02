import {
  extractUnknownWaWebModule,
  isWwebjsModuleCompatibilitySignal,
  shouldTreatAsModuleCompatibilityFailure,
  WWEBJS_MODULE_COMPATIBILITY_ERROR,
} from './wwebjs-compatibility';

describe('wwebjs-compatibility', () => {
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
});
