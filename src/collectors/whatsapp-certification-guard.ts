export const QR_ONLY_CERTIFICATION_ENV = 'PATROL_CERTIFICATION_EXPECT_UNAUTHENTICATED';
export const QR_ONLY_CERTIFICATION_PROCESS_MARKER = '--patrol-certification-qr-only';
export const UNEXPECTED_AUTHENTICATION = 'UNEXPECTED_AUTHENTICATION' as const;

export type QrOnlyCertificationState =
  | 'DISABLED'
  | 'EXPECTING_QR_ONLY'
  | 'AUTHENTICATION_AUTHORIZED'
  | typeof UNEXPECTED_AUTHENTICATION;

export type AccountBoundSignal = 'authenticated' | 'ready' | 'CONNECTED' | 'client-identity';

export function isQrOnlyCertificationMode(
  env: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = process.argv,
): boolean {
  return (
    env[QR_ONLY_CERTIFICATION_ENV] === 'true' &&
    argv.includes(QR_ONLY_CERTIFICATION_PROCESS_MARKER)
  );
}

export class QrOnlyCertificationGuard {
  private state: QrOnlyCertificationState;

  constructor(active: boolean) {
    this.state = active ? 'EXPECTING_QR_ONLY' : 'DISABLED';
  }

  get currentState(): QrOnlyCertificationState {
    return this.state;
  }

  allowQr(): boolean {
    return this.state === 'DISABLED' || this.state === 'EXPECTING_QR_ONLY';
  }

  authorizeAuthentication(explicitOperatorAuthorization: boolean): boolean {
    if (this.state !== 'EXPECTING_QR_ONLY' || !explicitOperatorAuthorization) {
      return false;
    }
    this.state = 'AUTHENTICATION_AUTHORIZED';
    return true;
  }

  detectAccountBoundSignal(_signal: AccountBoundSignal): boolean {
    if (this.state === UNEXPECTED_AUTHENTICATION) {
      return true;
    }
    if (this.state !== 'EXPECTING_QR_ONLY') {
      return false;
    }
    this.state = UNEXPECTED_AUTHENTICATION;
    return true;
  }

  isTerminal(): boolean {
    return this.state === UNEXPECTED_AUTHENTICATION;
  }
}

export function redactQrOnlyCertificationLog(text: string): string {
  return text
    .replace(/https?:\/\/[^\s]+/gi, (value) => {
      try {
        const url = new URL(value);
        return `${url.origin}${url.pathname}`;
      } catch {
        return '[REDACTED-URL]';
      }
    })
    .replace(/\+?\d{7,}(?:@(?:c|g)\.us)?/gi, '[REDACTED-IDENTIFIER]')
    .replace(
      /\b(account|connectedAccount|jid|wid|phone|sender|chat|group|contact)=\S+/gi,
      '$1=[REDACTED]',
    )
    .replace(/\b(authorization|bearer|cookie|token|secret)=\S+/gi, '$1=[REDACTED]');
}
