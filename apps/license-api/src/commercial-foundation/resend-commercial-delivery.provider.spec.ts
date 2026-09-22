import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes } from 'crypto';
import { ResendCommercialDeliveryProvider } from './resend-commercial-delivery.provider';

describe('Resend commercial delivery provider', () => {
  const secret = `whsec_${randomBytes(32).toString('base64')}`;
  const config = new ConfigService({ COMMERCIAL_RESEND_ENABLED: 'true', COMMERCIAL_RESEND_API_KEY: 're_phase4_test_only', COMMERCIAL_RESEND_FROM: 'PatrolSafe Test <licensing@example.invalid>', COMMERCIAL_RESEND_WEBHOOK_SECRET: secret });
  const provider = new ResendCommercialDeliveryProvider(config);

  afterEach(() => jest.restoreAllMocks());

  it('sends the safe link template with a deterministic provider idempotency key', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ id: 'email_phase4_test' }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const result = await provider.send({ attemptId: 'attempt-1', idempotencyKey: 'delivery-attempt-1', recipient: 'owner@example.test', companyName: 'Example Patrols', startsAt: '2026-09-22', expiresAt: '2027-09-21', downloadUrl: 'https://licensing.test/download/token', linkExpiresAt: '2026-09-23T12:00:00.000Z' });
    expect(result.messageId).toBe('email_phase4_test');
    const request = fetchMock.mock.calls[0];
    expect(request[0]).toBe('https://api.resend.com/emails');
    expect((request[1]?.headers as Record<string, string>)['Idempotency-Key']).toBe('delivery-attempt-1');
    const body = String(request[1]?.body);
    expect(body).toContain('Activate supplied licence');
    expect(body).not.toContain('machineFingerprint');
    expect(body).not.toContain('installationId');
  });

  it('verifies signed events and rejects forged signatures', () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const id = 'msg_webhook_phase4';
    const raw = Buffer.from(JSON.stringify({ type: 'email.delivered', created_at: new Date().toISOString(), data: { email_id: 'email_phase4_test' } }));
    const signature = createHmac('sha256', Buffer.from(secret.slice(6), 'base64')).update(`${id}.${timestamp}.${raw.toString('utf8')}`).digest('base64');
    expect(provider.verifyWebhook(raw, { 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': `v1,${signature}` })).toEqual(expect.objectContaining({ eventId: id, messageId: 'email_phase4_test', type: 'email.delivered' }));
    expect(() => provider.verifyWebhook(raw, { 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': 'v1,forged' })).toThrow();
  });
});
