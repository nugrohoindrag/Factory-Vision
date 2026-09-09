import test from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import {
  assertPasswordPolicy,
  assertPinPolicy,
  describeCredentialProblem,
} from '../src/platform/security/credential-policy.js';
import { CredentialGuard, RequestLimiter } from '../src/platform/security/rate-limit.js';
import { securityHeaders } from '../src/platform/http/security-headers.js';
import { isOriginAllowed } from '../src/platform/http/cors-policy.js';
import { neutralizeFormula } from '../src/modules/csv/csv.service.js';
import { ApiError } from '../src/platform/http/api-error.js';

/**
 * The controls the Cyber Security Requirement marks MUST, tested at the level
 * they are enforced. Each of these was a gap found by reading the requirement
 * against the code, so the tests are written to fail if the gap comes back.
 */

// --- §4.1, §8: one credential policy on every path ---------------------

test('password policy rejects anything shorter than twelve characters', () => {
  assert.throws(() => assertPasswordPolicy('short'), ApiError);
  assert.throws(() => assertPasswordPolicy('elevenchars'), ApiError);
  assert.doesNotThrow(() => assertPasswordPolicy('RahasiaKuat2026'));
});

test('PIN policy rejects the four-digit, repeated and sequential cases', () => {
  assert.throws(() => assertPinPolicy('1234'), ApiError, 'four digits is below the minimum');
  assert.throws(() => assertPinPolicy('000000'), ApiError, 'repeated digits');
  assert.throws(() => assertPinPolicy('123456'), ApiError, 'ascending run');
  assert.throws(() => assertPinPolicy('987654'), ApiError, 'descending run');
  assert.throws(() => assertPinPolicy('28461a'), ApiError, 'not all digits');
  assert.doesNotThrow(() => assertPinPolicy('284617'));
});

test('boot-time configuration is described rather than thrown', () => {
  assert.equal(describeCredentialProblem('RahasiaKuat2026', 'password'), undefined);
  assert.match(describeCredentialProblem('short', 'password') ?? '', /minimal 12/);
  assert.match(describeCredentialProblem('1234', 'pin') ?? '', /6-12 digit/);
});

// --- §7, §8: brute-force lockout ---------------------------------------

test('credential guard locks after the configured failures and clears on success', () => {
  const guard = new CredentialGuard({ limit: 3, windowMs: 60_000, lockMs: 60_000 });

  assert.equal(guard.recordFailure('op-1001'), false);
  assert.equal(guard.recordFailure('op-1001'), false);
  assert.equal(guard.recordFailure('op-1001'), true, 'third failure locks');
  assert.ok(guard.secondsLocked('op-1001') > 0);
  assert.throws(() => guard.assertAvailable('op-1001', 'terkunci'), ApiError);

  // A different identity is unaffected: the lock is per account, not per plant.
  assert.equal(guard.secondsLocked('op-1002'), 0);

  guard.recordSuccess('op-1001');
  assert.equal(guard.secondsLocked('op-1001'), 0);
});

test('request limiter allows up to the limit and then asks for a wait', () => {
  const limiter = new RequestLimiter({ limit: 2, windowMs: 60_000 });
  assert.equal(limiter.consume('ip:10.0.0.1'), 0);
  assert.equal(limiter.consume('ip:10.0.0.1'), 0);
  assert.ok(limiter.consume('ip:10.0.0.1') > 0, 'third call is throttled');
  assert.equal(limiter.consume('ip:10.0.0.2'), 0, 'a different caller is unaffected');
});

// --- §28: cross-origin allowlist ---------------------------------------

test('origin allowlist accepts only configured origins', () => {
  const previous = process.env.CORS_ALLOWED_ORIGINS;
  process.env.CORS_ALLOWED_ORIGINS = 'https://dashboard.example.com';
  try {
    assert.equal(isOriginAllowed(undefined), true, 'same-origin calls carry no Origin');
    assert.equal(isOriginAllowed('https://dashboard.example.com'), true);
    assert.equal(isOriginAllowed('https://dashboard.example.com/'), true, 'trailing slash');
    assert.equal(isOriginAllowed('https://evil.example.net'), false);
  } finally {
    if (previous === undefined) delete process.env.CORS_ALLOWED_ORIGINS;
    else process.env.CORS_ALLOWED_ORIGINS = previous;
  }
});

// --- §29: security headers ---------------------------------------------

test('every API response carries the security headers', () => {
  const headers = new Map<string, string>();
  const req = { path: '/api/v1/work-orders' } as Request;
  const res = {
    setHeader: (name: string, value: string) => headers.set(name, value),
    removeHeader: (name: string) => headers.delete(name),
  } as unknown as Response;

  let nextCalled = false;
  securityHeaders()(req, res, () => {
    nextCalled = true;
  });

  assert.ok(nextCalled);
  assert.equal(headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(headers.get('X-Frame-Options'), 'DENY');
  assert.equal(headers.get('Cache-Control'), 'no-store', 'per-session data is never cached');
  assert.match(headers.get('Content-Security-Policy') ?? '', /frame-ancestors 'none'/);
  assert.match(headers.get('Strict-Transport-Security') ?? '', /max-age=31536000/);
  assert.ok(headers.get('Referrer-Policy'));
  assert.ok(headers.get('Permissions-Policy'));
});

// --- §55: spreadsheet formula injection --------------------------------

test('export neutralises formulas but leaves real values alone', () => {
  assert.equal(neutralizeFormula('=cmd|calc'), "'=cmd|calc");
  assert.equal(neutralizeFormula('+1234567890'), "'+1234567890");
  assert.equal(neutralizeFormula('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(neutralizeFormula('\tinjected'), "'\tinjected");

  assert.equal(neutralizeFormula('TIRE-185-65-R15'), 'TIRE-185-65-R15');
  assert.equal(neutralizeFormula('-5'), '-5', 'a negative quantity is data, not a formula');
  assert.equal(neutralizeFormula('-12.5'), '-12.5');
});

// --- The middleware stack over real HTTP --------------------------------

test('the HTTP stack answers with headers, a CORS refusal and a 429', async () => {
  const express = (await import('express')).default;
  const cors = (await import('cors')).default;
  const { corsOptions } = await import('../src/platform/http/cors-policy.js');
  const { rateLimit } = await import('../src/platform/security/rate-limit.js');
  const { errorMiddleware, requestIdMiddleware } = await import('../src/platform/http/envelope.js');

  const previous = process.env.CORS_ALLOWED_ORIGINS;
  process.env.CORS_ALLOWED_ORIGINS = 'https://dashboard.example.com';

  const app = express();
  app.use(securityHeaders());
  app.use(cors(corsOptions()));
  app.use(express.json());
  app.use(requestIdMiddleware);
  app.use(
    '/api/v1/auth/login',
    rateLimit({ limit: 2, windowMs: 60_000, message: 'Terlalu banyak percobaan login.' })
  );
  app.post('/api/v1/auth/login', (_req, res) => res.json({ ok: true }));
  app.use(errorMiddleware);

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const port = (server.address() as { port: number }).port;
  const url = `http://127.0.0.1:${port}/api/v1/auth/login`;

  try {
    const post = (origin?: string) =>
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
        body: JSON.stringify({ email: 'a@b.c', password: 'x' }),
      });

    const first = await post();
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(first.headers.get('x-frame-options'), 'DENY');
    assert.ok(first.headers.get('content-security-policy'));
    assert.equal(first.headers.get('cache-control'), 'no-store');

    const allowed = await post('https://dashboard.example.com');
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://dashboard.example.com');

    const refused = await post('https://evil.example.net');
    assert.equal(refused.headers.get('access-control-allow-origin'), null, 'no CORS grant for a stranger');

    const throttled = await post();
    assert.equal(throttled.status, 429, 'the third call in the window is refused');
    const body = (await throttled.json()) as { error?: { code?: string } };
    assert.equal(body.error?.code, 'RATE_LIMITED');
  } finally {
    server.close();
    if (previous === undefined) delete process.env.CORS_ALLOWED_ORIGINS;
    else process.env.CORS_ALLOWED_ORIGINS = previous;
  }
});

// --- §5: TOTP, checked against RFC 6238 --------------------------------

test('TOTP matches the RFC 6238 SHA-1 test vectors', async () => {
  const { generateCode, toBase32, fromBase32, verifyCode, otpauthUri, generateSecret } = await import(
    '../src/modules/auth/totp.js'
  );

  // The RFC's shared secret is the ASCII string "12345678901234567890".
  const secret = toBase32(Buffer.from('12345678901234567890', 'ascii'));
  const vectors: Array<[number, string]> = [
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ];

  for (const [seconds, expected] of vectors) {
    assert.equal(generateCode(secret, seconds * 1000), expected, `vector at t=${seconds}`);
  }

  assert.equal(fromBase32(secret).toString('ascii'), '12345678901234567890', 'base32 round trip');

  // A phone that is half a step out still works; one that is minutes out does not.
  assert.equal(verifyCode(secret, generateCode(secret, 59_000), { atMs: 59_000 + 25_000 }), true);
  assert.equal(verifyCode(secret, generateCode(secret, 59_000), { atMs: 59_000 + 300_000 }), false);
  assert.equal(verifyCode(secret, '000000', { atMs: 59_000 }), false);
  assert.equal(verifyCode(secret, 'abcdef', { atMs: 59_000 }), false, 'non-numeric is refused');

  // The label is percent-encoded whole, colon included, which is the form the
  // otpauth specification allows and every authenticator app reads.
  assert.match(
    otpauthUri({ secret: generateSecret(), account: 'admin@pabrik.co.id', issuer: 'Factory Vision' }),
    /^otpauth:\/\/totp\/Factory%20Vision%3Aadmin%40pabrik\.co\.id\?secret=[A-Z2-7]+&issuer=Factory\+Vision&algorithm=SHA1&digits=6&period=30$/
  );
});

test('sealed secrets survive a round trip and refuse tampering', async () => {
  const { seal, open, encryptionAvailable } = await import('../src/platform/security/secret-box.js');

  const previous = process.env.MFA_ENCRYPTION_KEY;
  process.env.MFA_ENCRYPTION_KEY = 'test-key-for-the-suite-only-32-chars';
  try {
    assert.equal(encryptionAvailable(), true);
    const sealed = seal('JBSWY3DPEHPK3PXP');
    assert.notEqual(sealed, 'JBSWY3DPEHPK3PXP', 'the secret is not stored in the clear');
    assert.equal(open(sealed), 'JBSWY3DPEHPK3PXP');

    // GCM authenticates: a flipped byte is refused rather than decrypted.
    const parts = sealed.split(':');
    const body = Buffer.from(parts[3], 'base64');
    body[0] ^= 0xff;
    parts[3] = body.toString('base64');
    assert.throws(() => open(parts.join(':')));
  } finally {
    if (previous === undefined) delete process.env.MFA_ENCRYPTION_KEY;
    else process.env.MFA_ENCRYPTION_KEY = previous;
  }
});
