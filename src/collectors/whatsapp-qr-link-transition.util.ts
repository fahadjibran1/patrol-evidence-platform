export interface WhatsAppQrLinkDisconnectContext {
  reason: string;
  currentGeneration: boolean;
  existingLocalAuthSessionCandidate: boolean;
  qrReceivedForCurrentAttempt: boolean;
  authenticationReachedForCurrentAttempt: boolean;
  readinessFinalized: boolean;
  operatorLogoutRequested: boolean;
  shutdownRequested: boolean;
}

/**
 * whatsapp-web.js can report LOGOUT while a fresh QR session changes browser
 * context. That signal is transitional only when it belongs to the current
 * fresh-link generation and a real QR was already emitted. Keeping the client
 * current lets the bounded authentication timeout and later auth/ready events
 * decide the outcome; it does not infer that the QR was scanned.
 */
export function shouldPreserveFreshQrLinkClient(
  context: WhatsAppQrLinkDisconnectContext,
): boolean {
  return (
    /^LOGOUT$/i.test(context.reason.trim()) &&
    context.currentGeneration &&
    !context.existingLocalAuthSessionCandidate &&
    context.qrReceivedForCurrentAttempt &&
    !context.authenticationReachedForCurrentAttempt &&
    !context.readinessFinalized &&
    !context.operatorLogoutRequested &&
    !context.shutdownRequested
  );
}
