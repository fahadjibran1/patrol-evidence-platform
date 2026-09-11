import type { WhatsAppHelperStatusSnapshot } from './whatsapp-helper.types';
import {
  classifyBootstrapFailureCode,
  classifyLinkProfileSafety,
  shouldFallbackToNextBrowser,
  shouldOfferLinkRetry,
  startupAttemptCount,
} from './whatsapp-link-retry.util';

const failedStatus = (overrides: Partial<WhatsAppHelperStatusSnapshot> = {}): WhatsAppHelperStatusSnapshot => ({
  enabled: true,
  connected: false,
  ready: false,
  state: 'failed',
  info: 'failed',
  sessionPath: 'session',
  qrCode: null,
  lastQrAt: null,
  lastMessageAt: null,
  lastEventAt: null,
  lastReadyAt: null,
  lastDisconnectAt: null,
  lastBackfillAt: null,
  connectedAccount: null,
  backfillRunning: false,
  backfillMessagesScanned: 0,
  backfillImagesImported: 0,
  backfillDuplicatesSkipped: 0,
  liveMessagesProcessed: 0,
  liveImagesImported: 0,
  liveDuplicatesSkipped: 0,
  productionListenerCount: 0,
  allowFromMe: false,
  startupStage: null,
  startupStartedAt: null,
  lastError: 'timeout',
  collectorLogPath: 'collector.log',
  latestQrPath: 'qr.txt',
  qrPayloadLength: null,
  qrPersistedAt: null,
  qrDeliveredAt: null,
  browserExecutablePath: null,
  browserExecutableSource: null,
  browserCandidatesTried: [],
  sessionPathExists: true,
  sessionPathWritable: true,
  sessionCorruptionSuspected: false,
  sessionCorruptionMessage: null,
  failureCode: 'QR_INITIALIZATION_TIMEOUT',
  groups: [],
  contacts: [],
  ...overrides,
});

describe('bounded WhatsApp link retry policy', () => {
  it('classifies an empty unlinked profile as a never-authenticated first link', () => {
    expect(classifyLinkProfileSafety({
      configuredLinkedAccountId: null,
      profileWasEmptyBeforeLaunch: true,
      retryingProvenFirstLink: false,
    })).toBe('NEVER_AUTHENTICATED_FIRST_LINK');
  });

  it('protects a profile with an authoritative persisted linked account', () => {
    expect(classifyLinkProfileSafety({
      configuredLinkedAccountId: 'account-1',
      profileWasEmptyBeforeLaunch: true,
      retryingProvenFirstLink: true,
    })).toBe('EXISTING_SESSION_PROTECTED');
  });

  it('fails closed for a populated profile without authoritative account history', () => {
    expect(classifyLinkProfileSafety({
      configuredLinkedAccountId: null,
      profileWasEmptyBeforeLaunch: false,
      retryingProvenFirstLink: false,
    })).toBe('UNKNOWN');
  });

  it('retains proven first-link safety across an explicit retry without deleting the profile', () => {
    expect(classifyLinkProfileSafety({
      configuredLinkedAccountId: null,
      profileWasEmptyBeforeLaunch: false,
      retryingProvenFirstLink: true,
    })).toBe('NEVER_AUTHENTICATED_FIRST_LINK');
  });

  it('offers retry for a terminal pre-auth first-link failure', () => {
    expect(shouldOfferLinkRetry({
      status: failedStatus(),
      profileSafety: 'NEVER_AUTHENTICATED_FIRST_LINK',
      authenticationObserved: false,
      profileLockFailure: false,
    })).toBe(true);
  });

  it('never offers first-link retry after authentication was observed', () => {
    expect(shouldOfferLinkRetry({
      status: failedStatus(),
      profileSafety: 'NEVER_AUTHENTICATED_FIRST_LINK',
      authenticationObserved: true,
      profileLockFailure: false,
    })).toBe(false);
  });

  it('never offers first-link retry for an existing protected session', () => {
    expect(shouldOfferLinkRetry({
      status: failedStatus(),
      profileSafety: 'EXISTING_SESSION_PROTECTED',
      authenticationObserved: false,
      profileLockFailure: false,
    })).toBe(false);
  });

  it('fails closed instead of offering retry for a profile-lock failure', () => {
    expect(shouldOfferLinkRetry({
      status: failedStatus(),
      profileSafety: 'NEVER_AUTHENTICATED_FIRST_LINK',
      authenticationObserved: false,
      profileLockFailure: true,
    })).toBe(false);
  });

  it('allows browser-family fallback only when the selected browser never launched', () => {
    expect(shouldFallbackToNextBrowser({ hasNextCandidate: true, browserStarted: false })).toBe(true);
  });

  it('suppresses browser-family fallback after a successful browser launch', () => {
    expect(shouldFallbackToNextBrowser({ hasNextCandidate: true, browserStarted: true })).toBe(false);
  });

  it('runs exactly one startup attempt for a first-link generation', () => {
    expect(startupAttemptCount({ firstLinkAttempt: true, configuredRetries: 2 })).toBe(1);
  });

  it('preserves the configured bounded retry budget for non-first-link sessions', () => {
    expect(startupAttemptCount({ firstLinkAttempt: false, configuredRetries: 2 })).toBe(3);
  });

  it.each([
    [{ message: 'auth timeout', browserStarted: true, pageLoaded: true }, 'AUTH_SELECTOR_TIMEOUT'],
    [{ message: 'no QR', browserStarted: true, pageLoaded: true }, 'QR_INITIALIZATION_TIMEOUT'],
    [{ message: 'launch failed', browserStarted: false, pageLoaded: false }, 'BROWSER_LAUNCH_FAILURE'],
    [{ message: 'auth timeout', browserStarted: true, pageLoaded: true, criticalBootstrapResourceFailure: true }, 'REMOTE_BOOTSTRAP_FAILURE'],
  ] as const)('classifies safe structured bootstrap failures', (input, expected) => {
    expect(classifyBootstrapFailureCode(input)).toBe(expected);
  });
});
