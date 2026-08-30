import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

/**
 * Password and PIN hashing (US-001, US-002).
 *
 * scrypt from the Node standard library, so the pilot on-premise deployment
 * has no native build step. The stored form is `scrypt$<salt>$<hash>`; the
 * verifier compares in constant time so a wrong password and a wrong user cost
 * the same.
 */
const KEY_LENGTH = 64;

export function hashSecret(secret: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(secret, salt, KEY_LENGTH).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifySecret(secret: string, stored: string | undefined): boolean {
  if (!stored) return false;
  const [scheme, salt, expected] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !expected) return false;

  const derived = scryptSync(secret, salt, KEY_LENGTH);
  const expectedBuffer = Buffer.from(expected, 'hex');
  if (expectedBuffer.length !== derived.length) return false;
  return timingSafeEqual(derived, expectedBuffer);
}
