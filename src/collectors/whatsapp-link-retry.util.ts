import type { WhatsAppHelperStatusSnapshot } from './whatsapp-helper.types';

export const LINK_RETRY_REQUIRED = 'LINK_RETRY_REQUIRED' as const;

export type WhatsAppLinkProfileSafety =
  | 'NEVER_AUTHENTICATED_FIRST_LINK'
  | 'EXISTING_SESSION_PROTECTED'
  | 'UNKNOWN';

export type WhatsAppBootstrapFailureCode =
  | 'REMOTE_BOOTSTRAP_FAILURE'
  | 'AUTH_SELECTOR_TIMEOUT'
  | 'QR_INITIALIZATION_TIMEOUT'
  | 'BROWSER_LAUNCH_FAILURE';

export function classifyLinkProfileSafety(input: {
  configuredLinkedAccountId: string | null;
  profileWasEmptyBeforeLaunch: boolean;
  retryingProvenFirstLink: boolean;
}): WhatsAppLinkProfileSafety {
  if (input.configuredLinkedAccountId?.trim()) {
    return 'EXISTING_SESSION_PROTECTED';
  }
  if (input.retryingProvenFirstLink || input.profileWasEmptyBeforeLaunch) {
    return 'NEVER_AUTHENTICATED_FIRST_LINK';
  }
  return 'UNKNOWN';
}

export function classifyBootstrapFailureCode(input: {
  message: string;
  browserStarted: boolean;
  pageLoaded: boolean;
  criticalBootstrapResourceFailure?: boolean;
}): WhatsAppBootstrapFailureCode {
  if (input.criticalBootstrapResourceFailure) {
    return 'REMOTE_BOOTSTRAP_FAILURE';
  }
  if (!input.browserStarted || !input.pageLoaded) {
    return 'BROWSER_LAUNCH_FAILURE';
  }
  if (/auth(?:entication)?\s*(?:selector\s*)?timeout/i.test(input.message)) {
    return 'AUTH_SELECTOR_TIMEOUT';
  }
  return 'QR_INITIALIZATION_TIMEOUT';
}

export function shouldOfferLinkRetry(input: {
  status: WhatsAppHelperStatusSnapshot;
  profileSafety: WhatsAppLinkProfileSafety;
  authenticationObserved: boolean;
  profileLockFailure: boolean;
}): boolean {
  return (
    input.status.state === 'failed' &&
    input.profileSafety === 'NEVER_AUTHENTICATED_FIRST_LINK' &&
    !input.authenticationObserved &&
    !input.status.connectedAccount?.trim() &&
    !input.profileLockFailure
  );
}

export function shouldFallbackToNextBrowser(input: {
  hasNextCandidate: boolean;
  browserStarted: boolean;
}): boolean {
  return input.hasNextCandidate && !input.browserStarted;
}

export function startupAttemptCount(input: {
  firstLinkAttempt: boolean;
  configuredRetries: number;
}): number {
  if (input.firstLinkAttempt) {
    return 1;
  }
  return 1 + Math.max(0, Math.floor(input.configuredRetries));
}
