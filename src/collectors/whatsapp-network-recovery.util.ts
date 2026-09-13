import { request } from 'https';

import type { WhatsAppHelperStatusSnapshot } from './whatsapp-helper.types';

export const WHATSAPP_NETWORK_FAILURE_CODE = 'NETWORK_UNAVAILABLE' as const;

const NETWORK_FAILURE_PATTERNS = [
  /net::err_(?:connection|internet|network|name|timed|proxy|address|socket|tunnel)/i,
  /err_connection_(?:timed_out|reset|refused|closed)/i,
  /err_internet_disconnected/i,
  /err_name_not_resolved/i,
  /eai_again|enotfound|enetunreach|ehostunreach|etimedout|econnreset|econnrefused/i,
  /dns[^\n]*(?:failed|failure|unavailable|timeout)/i,
  /network[^\n]*(?:offline|unavailable|failed|failure|timeout)/i,
  /connection[^\n]*(?:timed out|timeout|unavailable)/i,
];

export function isWhatsAppTransportFailure(message: string | null | undefined): boolean {
  const normalized = message?.trim();
  return Boolean(normalized && NETWORK_FAILURE_PATTERNS.some((pattern) => pattern.test(normalized)));
}

export function isRecoverableWhatsAppNetworkFailure(
  status: Pick<WhatsAppHelperStatusSnapshot, 'state' | 'failureCode' | 'lastError' | 'info'>,
): boolean {
  if (status.state === 'RELINK_REQUIRED' || status.failureCode === 'WHATSAPP_RELINK_REQUIRED') {
    return false;
  }

  return (
    status.failureCode === WHATSAPP_NETWORK_FAILURE_CODE ||
    isWhatsAppTransportFailure(status.lastError) ||
    isWhatsAppTransportFailure(status.info)
  );
}

/**
 * Reachability check for the same origin the WhatsApp helper will navigate to.
 * Any HTTP response proves transport readiness; no page content is retained.
 */
export function probeWhatsAppWebConnectivity(timeoutMs = 5_000): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (reachable: boolean) => {
      if (settled) return;
      settled = true;
      resolve(reachable);
    };

    const requestHandle = request(
      {
        protocol: 'https:',
        hostname: 'web.whatsapp.com',
        path: '/',
        method: 'HEAD',
        timeout: timeoutMs,
      },
      (response) => {
        response.resume();
        finish(true);
      },
    );

    requestHandle.once('timeout', () => {
      requestHandle.destroy();
      finish(false);
    });
    requestHandle.once('error', () => finish(false));
    requestHandle.end();
  });
}
