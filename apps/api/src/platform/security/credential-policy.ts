import { ApiError } from '../http/api-error.js';

/**
 * One password and PIN policy, applied on every path that sets a credential
 * (§4.1, §8, §20 of the Cyber Security Requirement).
 *
 * The policy used to live inline in each setter, which is how the bootstrap
 * administrator ended up requiring twelve characters while an administrator
 * issuing a password for someone else required eight, and the public trial
 * form required six. A credential is only as strong as the weakest door that
 * can set it, so there is now exactly one door.
 */

const DEFAULT_PASSWORD_MIN = 12;
const DEFAULT_PIN_MIN = 6;

function configured(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw >= fallback ? Math.floor(raw) : fallback;
}

export function passwordMinLength(): number {
  return configured('PASSWORD_MIN_LENGTH', DEFAULT_PASSWORD_MIN);
}

export function pinMinLength(): number {
  return configured('PIN_MIN_LENGTH', DEFAULT_PIN_MIN);
}

/** A PIN keypad has ten keys, so the obvious sequences are worth naming. */
function isTrivialPin(pin: string): boolean {
  if (/^(\d)\1*$/.test(pin)) return true; // 000000, 111111
  const ascending = '0123456789012345';
  const descending = '9876543210987654';
  return ascending.includes(pin) || descending.includes(pin);
}

export function assertPasswordPolicy(password: string | undefined, field = 'password'): void {
  const min = passwordMinLength();
  if (!password || password.length < min) {
    const message = `Kata sandi minimal ${min} karakter.`;
    throw ApiError.validation(message, [{ field, code: 'TOO_SHORT', message }]);
  }
  if (/^\s+$/.test(password)) {
    const message = 'Kata sandi tidak boleh hanya berisi spasi.';
    throw ApiError.validation(message, [{ field, code: 'INVALID_FORMAT', message }]);
  }
}

export function assertPinPolicy(pin: string | undefined, field = 'pin'): void {
  const min = pinMinLength();
  if (!pin || !new RegExp(`^\\d{${min},12}$`).test(pin)) {
    const message = `PIN harus ${min}-12 digit angka.`;
    throw ApiError.validation(message, [{ field, code: 'INVALID_FORMAT', message }]);
  }
  if (isTrivialPin(pin)) {
    const message = 'PIN tidak boleh berupa angka berurutan atau berulang.';
    throw ApiError.validation(message, [{ field, code: 'TOO_WEAK', message }]);
  }
}

/**
 * The same check without the throw, for configuration read at boot: a bad
 * `BOOTSTRAP_ADMIN_PASSWORD` should be reported and ignored, not crash the
 * process into a restart loop.
 */
export function describeCredentialProblem(secret: string | undefined, kind: 'password' | 'pin'): string | undefined {
  try {
    if (kind === 'password') assertPasswordPolicy(secret);
    else assertPinPolicy(secret);
    return undefined;
  } catch (error) {
    return error instanceof ApiError ? error.message : 'Kredensial tidak memenuhi kebijakan.';
  }
}
