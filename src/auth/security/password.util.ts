import { randomBytes, scrypt as nodeScrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scrypt = promisify(nodeScrypt);

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${derivedKey.toString('hex')}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [salt, key] = storedHash.split(':');

  if (!salt || !key) {
    return false;
  }

  const derivedKey = (await scrypt(password, salt, 64)) as Buffer;
  const storedKey = Buffer.from(key, 'hex');

  if (derivedKey.length !== storedKey.length) {
    return false;
  }

  return timingSafeEqual(derivedKey, storedKey);
}
