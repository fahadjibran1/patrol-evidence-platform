import { ConfigService } from '@nestjs/config';
import { randomBytes, randomUUID } from 'crypto';
import { CommercialDeliveryTokenService } from './commercial-delivery-token.service';

describe('commercial delivery token service', () => {
  const config = new ConfigService({ COMMERCIAL_DELIVERY_TOKEN_SECRET: randomBytes(32).toString('base64'), COMMERCIAL_LICENCE_DOWNLOAD_BASE_URL: 'https://licensing.test/patrolsafe/licence/download', NODE_ENV: 'test' });
  const service = new CommercialDeliveryTokenService(config);

  it('derives a stable 256-bit opaque token and persists only its hash contract', () => {
    const id = randomUUID();
    const first = service.derive(id);
    expect(first).toEqual(service.derive(id));
    expect(first.raw).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.hash).not.toContain(first.raw);
    expect(service.derive(randomUUID()).raw).not.toBe(first.raw);
  });

  it('constructs a fixed server destination without accepting query or object input', () => {
    const raw = service.derive(randomUUID()).raw;
    expect(service.downloadUrl(raw)).toBe(`https://licensing.test/patrolsafe/licence/download/${raw}`);
  });
});
