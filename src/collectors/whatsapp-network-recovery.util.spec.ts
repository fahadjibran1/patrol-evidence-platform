import {
  isRecoverableWhatsAppNetworkFailure,
  isWhatsAppTransportFailure,
  WHATSAPP_NETWORK_FAILURE_CODE,
} from './whatsapp-network-recovery.util';

describe('WhatsApp transient-network recovery classification', () => {
  it.each([
    'net::ERR_CONNECTION_TIMED_OUT at https://web.whatsapp.com/',
    'net::ERR_INTERNET_DISCONNECTED',
    'getaddrinfo ENOTFOUND web.whatsapp.com',
    'connect ETIMEDOUT 1.2.3.4:443',
    'DNS lookup failure',
  ])('classifies transport failure without treating it as authentication loss: %s', (message) => {
    expect(isWhatsAppTransportFailure(message)).toBe(true);
  });

  it.each([
    'LOGOUT',
    'UNPAIRED',
    'Authentication failed',
    'WhatsApp Web module changed',
    'Browser profile is locked',
  ])('does not classify session/authentication failures as transport loss: %s', (message) => {
    expect(isWhatsAppTransportFailure(message)).toBe(false);
  });

  it('keeps relink-required terminal even when accompanying text mentions network', () => {
    expect(
      isRecoverableWhatsAppNetworkFailure({
        state: 'RELINK_REQUIRED',
        failureCode: 'WHATSAPP_RELINK_REQUIRED',
        lastError: 'Network unavailable after logout',
        info: 'Relink required',
      }),
    ).toBe(false);
  });

  it('recognizes the explicit network failure code', () => {
    expect(
      isRecoverableWhatsAppNetworkFailure({
        state: 'failed',
        failureCode: WHATSAPP_NETWORK_FAILURE_CODE,
        lastError: null,
        info: 'Connection lost',
      }),
    ).toBe(true);
  });
});
