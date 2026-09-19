const SESSION_INVALIDATION_REASONS = /^(LOGOUT|UNPAIRED|UNPAIRED_IDLE|CONFLICT)$/i;

export function shouldRecoverUnexpectedHealthySession(input: {
  wasHealthy: boolean;
  reason: string;
  operatorLogoutRequested: boolean;
  shutdownRequested: boolean;
}): boolean {
  return (
    input.wasHealthy &&
    !input.operatorLogoutRequested &&
    !input.shutdownRequested &&
    SESSION_INVALIDATION_REASONS.test(input.reason.trim())
  );
}
