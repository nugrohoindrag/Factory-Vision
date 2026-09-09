import { randomBytes } from 'crypto';
import { UserRole } from '@factory-vision/domain-types';
import { ApiError } from '../../platform/http/api-error.js';
import { isDatabaseConfigured, withTenant } from '../../platform/db/pool.js';
import { encryptionAvailable, open, seal } from '../../platform/security/secret-box.js';
import { hashSecret, verifySecret } from './credentials.js';
import {
  generateCode,
  generateRecoveryCodes,
  generateSecret,
  otpauthUri,
  verifyCode,
} from './totp.js';

/**
 * Multi-factor authentication (§5).
 *
 * Three rules shape this:
 *
 *   * enrolment is two steps — issue a secret, then prove it with a code — so
 *     nobody can lock themselves out by scanning a QR badly;
 *   * a challenge issued at login is short-lived and single-use, and grants
 *     nothing on its own: it is not a session, it is a receipt saying the
 *     password was right;
 *   * a recovery code is a credential, so it is hashed, shown once, and
 *     consumed when used.
 *
 * Which roles must have it is configuration, defaulting to the administrator
 * — the account whose compromise costs the most.
 */

const CHALLENGE_TTL_MS = 5 * 60_000;
const ISSUER = 'Factory Vision';

interface Challenge {
  tenantId: string;
  userId: string;
  expiresAt: number;
}

export interface MfaStatus {
  enrolled: boolean;
  confirmedAt?: string;
  required: boolean;
  recoveryCodesRemaining: number;
}

interface Row {
  secret_encrypted: string;
  confirmed_at: Date | string | null;
  recovery_code_hashes: string[];
}

export function rolesRequiringMfa(): UserRole[] {
  const configured = process.env.MFA_REQUIRED_ROLES?.split(',')
    .map((role) => role.trim().toUpperCase())
    .filter(Boolean);
  const roles = configured?.length ? configured : ['ADMIN'];
  return roles as UserRole[];
}

export class MfaService {
  private readonly challenges = new Map<string, Challenge>();

  get available(): boolean {
    return isDatabaseConfigured() && encryptionAvailable();
  }

  isRequiredFor(role: string): boolean {
    return rolesRequiringMfa().includes(role.toUpperCase() as UserRole);
  }

  // --- Enrolment ------------------------------------------------------

  /**
   * Issues a secret and returns what the authenticator app needs. Nothing is
   * enforced until `confirm` proves the app and the server agree.
   */
  async beginEnrolment(
    tenantId: string,
    userId: string,
    account: string
  ): Promise<{ secret: string; otpauthUri: string }> {
    this.assertAvailable();
    const secret = generateSecret();

    await withTenant(tenantId, (client) =>
      client.query(
        `INSERT INTO user_mfa (tenant_id, user_id, secret_encrypted, confirmed_at, recovery_code_hashes)
         VALUES ($1, $2, $3, NULL, '{}')
         ON CONFLICT (tenant_id, user_id)
         DO UPDATE SET secret_encrypted = EXCLUDED.secret_encrypted,
                       confirmed_at = NULL,
                       recovery_code_hashes = '{}'`,
        [tenantId, userId, seal(secret)]
      )
    );

    return { secret, otpauthUri: otpauthUri({ secret, account, issuer: ISSUER }) };
  }

  /** Confirms enrolment and returns the recovery codes, shown exactly once. */
  async confirmEnrolment(tenantId: string, userId: string, code: string): Promise<string[]> {
    this.assertAvailable();
    const row = await this.read(tenantId, userId);
    if (!row) throw ApiError.invalidState('Belum ada proses pendaftaran MFA untuk akun ini.');

    if (!verifyCode(open(row.secret_encrypted), code)) {
      throw ApiError.validation('Kode MFA tidak cocok. Periksa jam perangkat Anda lalu coba lagi.', [
        { field: 'code', code: 'INVALID', message: 'Kode tidak cocok.' },
      ]);
    }

    const recoveryCodes = generateRecoveryCodes();
    await withTenant(tenantId, (client) =>
      client.query(
        `UPDATE user_mfa
            SET confirmed_at = now(), recovery_code_hashes = $3
          WHERE tenant_id = $1 AND user_id = $2`,
        [tenantId, userId, recoveryCodes.map((value) => hashSecret(value))]
      )
    );

    return recoveryCodes;
  }

  async disable(tenantId: string, userId: string): Promise<void> {
    if (!isDatabaseConfigured()) return;
    await withTenant(tenantId, (client) =>
      client.query('DELETE FROM user_mfa WHERE tenant_id = $1 AND user_id = $2', [tenantId, userId])
    );
  }

  async status(tenantId: string, userId: string, role: string): Promise<MfaStatus> {
    const row = await this.read(tenantId, userId);
    return {
      enrolled: Boolean(row?.confirmed_at),
      confirmedAt: row?.confirmed_at
        ? new Date(row.confirmed_at as string | Date).toISOString()
        : undefined,
      required: this.isRequiredFor(role),
      recoveryCodesRemaining: row?.recovery_code_hashes.length ?? 0,
    };
  }

  /** True when the account has finished enrolment and must be challenged. */
  async isActiveFor(tenantId: string, userId: string): Promise<boolean> {
    const row = await this.read(tenantId, userId);
    return Boolean(row?.confirmed_at);
  }

  // --- Login challenge ------------------------------------------------

  issueChallenge(tenantId: string, userId: string): { challengeToken: string; expiresInSeconds: number } {
    const challengeToken = `mfa-${randomBytes(24).toString('base64url')}`;
    this.challenges.set(challengeToken, {
      tenantId,
      userId,
      expiresAt: Date.now() + CHALLENGE_TTL_MS,
    });
    this.sweep();
    return { challengeToken, expiresInSeconds: CHALLENGE_TTL_MS / 1000 };
  }

  /**
   * Consumes a challenge and the code that answers it.
   *
   * Single use in both directions: the challenge is deleted whether the code
   * was right or wrong, so a stolen challenge token cannot be used to guess
   * six digits at leisure.
   */
  async verifyChallenge(
    challengeToken: string,
    code: string
  ): Promise<{ tenantId: string; userId: string; usedRecoveryCode: boolean }> {
    const challenge = this.challenges.get(challengeToken);
    this.challenges.delete(challengeToken);

    if (!challenge || challenge.expiresAt < Date.now()) {
      throw ApiError.unauthenticated('Sesi verifikasi MFA telah berakhir. Silakan login kembali.');
    }

    const row = await this.read(challenge.tenantId, challenge.userId);
    if (!row?.confirmed_at) {
      throw ApiError.unauthenticated('MFA tidak aktif untuk akun ini.');
    }

    if (verifyCode(open(row.secret_encrypted), code)) {
      await this.touch(challenge.tenantId, challenge.userId);
      return { tenantId: challenge.tenantId, userId: challenge.userId, usedRecoveryCode: false };
    }

    const normalised = code.trim().toUpperCase();
    const remaining = row.recovery_code_hashes.filter((hash) => !verifySecret(normalised, hash));
    if (remaining.length < row.recovery_code_hashes.length) {
      await withTenant(challenge.tenantId, (client) =>
        client.query(
          `UPDATE user_mfa SET recovery_code_hashes = $3, last_used_at = now()
            WHERE tenant_id = $1 AND user_id = $2`,
          [challenge.tenantId, challenge.userId, remaining]
        )
      );
      return { tenantId: challenge.tenantId, userId: challenge.userId, usedRecoveryCode: true };
    }

    throw ApiError.unauthenticated('Kode MFA salah.');
  }

  /** Test seam: the code an enrolled account would present right now. */
  async currentCode(tenantId: string, userId: string): Promise<string | undefined> {
    const row = await this.read(tenantId, userId);
    return row ? generateCode(open(row.secret_encrypted)) : undefined;
  }

  // --- Internals ------------------------------------------------------

  private assertAvailable(): void {
    if (!encryptionAvailable()) {
      throw ApiError.invalidState(
        'MFA belum dapat diaktifkan: MFA_ENCRYPTION_KEY belum diatur pada server.'
      );
    }
  }

  private async read(tenantId: string, userId: string): Promise<Row | undefined> {
    if (!isDatabaseConfigured()) return undefined;
    const rows = await withTenant(tenantId, async (client) => {
      const result = await client.query<Row>(
        `SELECT secret_encrypted, confirmed_at, recovery_code_hashes
           FROM user_mfa WHERE tenant_id = $1 AND user_id = $2`,
        [tenantId, userId]
      );
      return result.rows;
    });
    return rows[0];
  }

  private async touch(tenantId: string, userId: string): Promise<void> {
    await withTenant(tenantId, (client) =>
      client.query('UPDATE user_mfa SET last_used_at = now() WHERE tenant_id = $1 AND user_id = $2', [
        tenantId,
        userId,
      ])
    );
  }

  private sweep(): void {
    const now = Date.now();
    for (const [token, challenge] of this.challenges) {
      if (challenge.expiresAt < now) this.challenges.delete(token);
    }
  }
}
