import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * TOTP, RFC 6238 (§5).
 *
 * Written against the RFC rather than pulled in as a dependency: it is HMAC
 * plus a truncation, the Node standard library has the HMAC, and an
 * authentication primitive is not where a supply chain surprise is welcome.
 * The RFC's own test vectors are in the test suite, so this is checked
 * against the specification rather than against itself.
 *
 * Parameters are the ones every authenticator app assumes: SHA-1, six digits,
 * a thirty second step. They are not a security choice so much as an
 * interoperability one — Google Authenticator, Aegis, 1Password and the rest
 * will not read anything else without manual configuration.
 */

const DIGITS = 6;
const STEP_SECONDS = 30;

/** Skew tolerated on either side, in steps: one step is ±30 seconds. */
const DEFAULT_WINDOW = 1;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function toBase32(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function fromBase32(secret: string): Buffer {
  const cleaned = secret.replace(/=+$/, '').replace(/\s/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const character of cleaned) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index === -1) throw new Error(`Invalid base32 character: ${character}`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** 160 bits, which is what the RFC recommends for HMAC-SHA1. */
export function generateSecret(): string {
  return toBase32(randomBytes(20));
}

export function generateCode(secret: string, atMs: number = Date.now()): string {
  const counter = Math.floor(atMs / 1000 / STEP_SECONDS);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac('sha1', fromBase32(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

/**
 * Verifies a code, allowing for clock skew on the phone.
 *
 * Constant-time comparison: a code is a six-digit secret for thirty seconds,
 * and an early-exit comparison leaks it a digit at a time.
 */
export function verifyCode(
  secret: string,
  code: string,
  options: { atMs?: number; window?: number } = {}
): boolean {
  const candidate = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(candidate)) return false;

  const at = options.atMs ?? Date.now();
  const window = options.window ?? DEFAULT_WINDOW;
  const expected = Buffer.from(candidate);

  for (let drift = -window; drift <= window; drift += 1) {
    const generated = Buffer.from(generateCode(secret, at + drift * STEP_SECONDS * 1000));
    if (generated.length === expected.length && timingSafeEqual(generated, expected)) return true;
  }
  return false;
}

/** The URI an authenticator app reads, whether from a QR code or by hand. */
export function otpauthUri(options: { secret: string; account: string; issuer: string }): string {
  const label = encodeURIComponent(`${options.issuer}:${options.account}`);
  const params = new URLSearchParams({
    secret: options.secret,
    issuer: options.issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/**
 * Recovery codes.
 *
 * The one route back in when the phone is lost, so they are treated as
 * credentials: shown once, stored only as hashes, single use.
 */
export function generateRecoveryCodes(count = 8): string[] {
  return Array.from({ length: count }, () => {
    const raw = randomBytes(5).toString('hex').toUpperCase();
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}
