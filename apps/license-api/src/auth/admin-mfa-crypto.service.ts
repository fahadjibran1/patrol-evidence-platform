import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;

@Injectable()
export class AdminMfaCryptoService {
  private readonly key: Buffer | null;

  constructor(private readonly config: ConfigService) {
    const configured = this.config.get<string>('ADMIN_MFA_ENCRYPTION_KEY')?.trim() ?? '';
    this.key = /^[0-9a-fA-F]{64}$/.test(configured) ? Buffer.from(configured, 'hex') : null;
  }

  isConfigured(): boolean {
    return this.key?.length === 32;
  }

  generateSecret(): string {
    this.assertConfigured();
    return this.base32Encode(randomBytes(20));
  }

  encryptSecret(secret: string): string {
    const key = this.assertConfigured();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${ciphertext.toString('hex')}`;
  }

  decryptSecret(payload: string): string {
    const key = this.assertConfigured();
    const [iv, tag, ciphertext] = payload.split(':');
    if (!iv || !tag || !ciphertext) throw new Error('Invalid MFA secret envelope');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
    decipher.setAuthTag(Buffer.from(tag, 'hex'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'hex')),
      decipher.final(),
    ]).toString('utf8');
  }

  createOtpAuthUri(secret: string, email: string): string {
    const issuer = 'PatrolSafe Operator';
    return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}`
      + `?secret=${encodeURIComponent(secret)}&issuer=${encodeURIComponent(issuer)}`
      + `&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD_SECONDS}`;
  }

  verifyTotp(secret: string, code: string, now = Date.now()): number | null {
    if (!/^\d{6}$/.test(code)) return null;
    const current = Math.floor(now / 1000 / TOTP_PERIOD_SECONDS);
    for (const offset of [-1, 0, 1]) {
      const counter = current + offset;
      const expected = this.totp(secret, counter);
      if (timingSafeEqual(Buffer.from(expected), Buffer.from(code))) return counter;
    }
    return null;
  }

  generateRecoveryCodes(count = 10): string[] {
    this.assertConfigured();
    return Array.from({ length: count }, () => {
      const raw = this.base32Encode(randomBytes(10));
      return raw.match(/.{1,4}/g)!.join('-');
    });
  }

  hashRecoveryCode(code: string): string {
    const normalized = code.toUpperCase().replace(/[^A-Z2-7]/g, '');
    return createHmac('sha256', this.assertConfigured()).update(`patrolsafe:mfa:recovery:${normalized}`).digest('hex');
  }

  private totp(secret: string, counter: number): string {
    const counterBuffer = Buffer.alloc(8);
    counterBuffer.writeBigUInt64BE(BigInt(counter));
    const digest = createHmac('sha1', this.base32Decode(secret)).update(counterBuffer).digest();
    const offset = digest[digest.length - 1] & 0x0f;
    const binary = (digest.readUInt32BE(offset) & 0x7fffffff) % (10 ** TOTP_DIGITS);
    return String(binary).padStart(TOTP_DIGITS, '0');
  }

  private base32Encode(bytes: Buffer): string {
    let bits = '';
    for (const byte of bytes) bits += byte.toString(2).padStart(8, '0');
    let result = '';
    for (let index = 0; index < bits.length; index += 5) {
      result += BASE32_ALPHABET[Number.parseInt(bits.slice(index, index + 5).padEnd(5, '0'), 2)];
    }
    return result;
  }

  private base32Decode(value: string): Buffer {
    let bits = '';
    for (const character of value.toUpperCase().replace(/=+$/g, '')) {
      const index = BASE32_ALPHABET.indexOf(character);
      if (index < 0) throw new Error('Invalid MFA secret encoding');
      bits += index.toString(2).padStart(5, '0');
    }
    const bytes: number[] = [];
    for (let index = 0; index + 8 <= bits.length; index += 8) {
      bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
    }
    return Buffer.from(bytes);
  }

  private assertConfigured(): Buffer {
    if (!this.key || this.key.length !== 32) throw new Error('ADMIN_MFA_ENCRYPTION_KEY is not configured');
    return this.key;
  }
}
