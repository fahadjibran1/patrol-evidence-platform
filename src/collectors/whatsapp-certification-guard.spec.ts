import {
  QR_ONLY_CERTIFICATION_ENV,
  QR_ONLY_CERTIFICATION_PROCESS_MARKER,
  QrOnlyCertificationGuard,
  UNEXPECTED_AUTHENTICATION,
  isQrOnlyCertificationMode,
  redactQrOnlyCertificationLog,
} from './whatsapp-certification-guard';

describe('QR-only WhatsApp certification guard', () => {
  it('requires both the environment switch and process marker', () => {
    expect(isQrOnlyCertificationMode({ [QR_ONLY_CERTIFICATION_ENV]: 'true' }, ['node'])).toBe(false);
    expect(isQrOnlyCertificationMode({}, ['node', QR_ONLY_CERTIFICATION_PROCESS_MARKER])).toBe(false);
    expect(
      isQrOnlyCertificationMode(
        { [QR_ONLY_CERTIFICATION_ENV]: 'true' },
        ['node', QR_ONLY_CERTIFICATION_PROCESS_MARKER],
      ),
    ).toBe(true);
  });

  it('allows QR generation and refresh while authentication remains unauthorized', () => {
    const guard = new QrOnlyCertificationGuard(true);
    expect(guard.currentState).toBe('EXPECTING_QR_ONLY');
    expect(guard.allowQr()).toBe(true);
    expect(guard.allowQr()).toBe(true);
  });

  it.each(['authenticated', 'ready', 'CONNECTED', 'client-identity'] as const)(
    'terminates on an unexpected %s signal',
    (signal) => {
      const guard = new QrOnlyCertificationGuard(true);
      expect(guard.detectAccountBoundSignal(signal)).toBe(true);
      expect(guard.currentState).toBe(UNEXPECTED_AUTHENTICATION);
      expect(guard.detectAccountBoundSignal(signal)).toBe(false);
    },
  );

  it('never infers authorization and requires an explicit future operator action', () => {
    const guard = new QrOnlyCertificationGuard(true);
    expect(guard.authorizeAuthentication(false)).toBe(false);
    expect(guard.currentState).toBe('EXPECTING_QR_ONLY');
    expect(guard.authorizeAuthentication(true)).toBe(true);
    expect(guard.currentState).toBe('AUTHENTICATION_AUTHORIZED');
    expect(guard.detectAccountBoundSignal('authenticated')).toBe(false);
  });

  it('leaves normal production authentication unchanged when inactive', () => {
    const guard = new QrOnlyCertificationGuard(false);
    expect(guard.currentState).toBe('DISABLED');
    expect(guard.detectAccountBoundSignal('authenticated')).toBe(false);
    expect(guard.detectAccountBoundSignal('ready')).toBe(false);
  });

  it('redacts account identifiers, credentials, and URL queries from certification logs', () => {
    const redacted = redactQrOnlyCertificationLog(
      'account=447700000000@c.us jid=447700000001@c.us token=sensitive https://web.whatsapp.com/path?secret=value',
    );
    expect(redacted).not.toContain('447700000000');
    expect(redacted).not.toContain('447700000001');
    expect(redacted).not.toContain('sensitive');
    expect(redacted).not.toContain('?secret=value');
    expect(redacted).toContain('https://web.whatsapp.com/path');
  });
});
