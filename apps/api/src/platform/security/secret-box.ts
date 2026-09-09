import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

/**
 * Authenticated encryption for the few secrets that must be recoverable (§14,
 * §34).
 *
 * A password is hashed because nothing ever needs to read it back. A TOTP
 * secret is different: verifying a code means regenerating it, so the value
 * has to survive in a readable form. What keeps it safe is that the key lives
 * outside the database — in `MFA_ENCRYPTION_KEY` — so the copy most likely to
 * leave the building, a backup, carries ciphertext and nothing else.
 *
 * AES-256-GCM rather than CBC: the tag means a modified ciphertext is refused
 * rather than silently decrypted into rubbish that then gets used.
 *
 * Format: `v1:<iv base64>:<tag base64>:<ciphertext base64>`. The version
 * prefix is there so a future key rotation or algorithm change can read what
 * this one wrote.
 */

const VERSION = 'v1';

export class MissingEncryptionKey extends Error {
  constructor() {
    super(
      'MFA_ENCRYPTION_KEY is not set. Multi-factor enrolment stores an encrypted secret and ' +
        'refuses to store one it cannot protect.'
    );
    this.name = 'MissingEncryptionKey';
  }
}

/**
 * Derives the 32-byte key.
 *
 * The environment variable may be a base64 32-byte key or an ordinary
 * passphrase; both end up the same length through SHA-256. A passphrase is not
 * as strong as random bytes and the deployment documentation says so, but
 * refusing anything that is not perfectly formatted is how installations end
 * up with the feature switched off instead.
 */
function key(): Buffer {
  const configured = process.env.MFA_ENCRYPTION_KEY?.trim();
  if (!configured) throw new MissingEncryptionKey();
  return createHash('sha256').update(configured).digest();
}

export function encryptionAvailable(): boolean {
  return Boolean(process.env.MFA_ENCRYPTION_KEY?.trim());
}

export function seal(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':');
}

export function open(sealed: string): string {
  const [version, iv, tag, ciphertext] = sealed.split(':');
  if (version !== VERSION || !iv || !tag || !ciphertext) {
    throw new Error('Unrecognised sealed value.');
  }
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
