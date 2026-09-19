import { shouldRecoverUnexpectedHealthySession } from './whatsapp-session-recovery.util';

describe('WhatsApp session recovery classification', () => {
  it.each(['LOGOUT', 'UNPAIRED', 'UNPAIRED_IDLE', 'CONFLICT'])(
    'recovers a healthy session ended unexpectedly with %s',
    (reason) => {
      expect(shouldRecoverUnexpectedHealthySession({
        wasHealthy: true,
        reason,
        operatorLogoutRequested: false,
        shutdownRequested: false,
      })).toBe(true);
    },
  );

  it('does not recover operator logout, shutdown, pre-ready invalid session, or network failure through this path', () => {
    expect(shouldRecoverUnexpectedHealthySession({ wasHealthy: true, reason: 'LOGOUT', operatorLogoutRequested: true, shutdownRequested: false })).toBe(false);
    expect(shouldRecoverUnexpectedHealthySession({ wasHealthy: true, reason: 'LOGOUT', operatorLogoutRequested: false, shutdownRequested: true })).toBe(false);
    expect(shouldRecoverUnexpectedHealthySession({ wasHealthy: false, reason: 'LOGOUT', operatorLogoutRequested: false, shutdownRequested: false })).toBe(false);
    expect(shouldRecoverUnexpectedHealthySession({ wasHealthy: true, reason: 'NAVIGATION', operatorLogoutRequested: false, shutdownRequested: false })).toBe(false);
  });
});
