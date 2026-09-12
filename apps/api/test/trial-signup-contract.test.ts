import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { TrialRegistrationPayload, TrialRegistrationResponse } from '@factory-vision/domain-types';
import { onboardingRoutes } from '../src/routes/onboarding.routes.js';
import type { OnboardingService } from '../src/modules/onboarding/onboarding.service.js';
import { errorMiddleware, requestIdMiddleware } from '../src/platform/http/envelope.js';
import { ApiError } from '../src/platform/http/api-error.js';

/**
 * The public trial form is the one endpoint a stranger calls without reading
 * the code, so its request shape is a contract, not an implementation detail.
 * It shipped once with the landing page sending `companyName` while the route
 * read `factoryName`, and every signup failed with a generic message. These
 * tests pin the shape at the HTTP boundary from both directions.
 */

function stubService(onRegister: (payload: TrialRegistrationPayload) => void) {
  return {
    async registerTrial(payload: TrialRegistrationPayload): Promise<TrialRegistrationResponse> {
      onRegister(payload);
      return {
        token: 'session-token',
        tenantId: 'tenant-test',
        userId: 'usr-test',
        email: payload.email,
        fullName: payload.fullName,
        factoryName: payload.factoryName,
        industry: payload.industry,
        trialStart: '2026-09-12T00:00:00.000Z',
        trialEnd: '2026-09-26T00:00:00.000Z',
        daysRemaining: 14,
      };
    },
    listTemplates: () => [],
  } as unknown as OnboardingService;
}

async function serve(service: OnboardingService) {
  const app = express();
  app.use(express.json());
  app.use(requestIdMiddleware);
  app.use('/api/v1', onboardingRoutes(service));
  // The same catch-all main.ts registers, so an unrouted verb answers the way
  // production does.
  app.use('/api/v1', (req, _res, next) =>
    next(ApiError.notFound(`Endpoint ${req.method} ${req.path} tidak dikenal.`))
  );
  app.use(errorMiddleware);

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const port = (server.address() as { port: number }).port;
  return { server, url: `http://127.0.0.1:${port}/api/v1/auth/trial-register` };
}

// Built exactly the way apps/landing/src/components/TrialSignupModal.tsx
// builds it, and typed the same, so drift on either side fails here.
const LANDING_PAYLOAD: TrialRegistrationPayload = {
  fullName: 'Rina Kusuma',
  email: 'rina@majupresisi.example',
  password: 'RahasiaKuat2026',
  factoryName: 'PT Maju Presisi Nusantara',
  industry: 'automotive',
  plantScale: '4-10 Lini Produksi',
};

test('the payload the landing page sends is accepted and reaches the service intact', async () => {
  let received: TrialRegistrationPayload | undefined;
  const { server, url } = await serve(stubService((p) => (received = p)));
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(LANDING_PAYLOAD),
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as TrialRegistrationResponse;
    assert.equal(body.token, 'session-token', 'the console is handed a session token');
    assert.equal(body.factoryName, LANDING_PAYLOAD.factoryName);

    assert.ok(received, 'service was called');
    assert.equal(received.factoryName, LANDING_PAYLOAD.factoryName);
    assert.equal(received.plantScale, LANDING_PAYLOAD.plantScale, 'the sizing hint is passed through');
    assert.equal(received.city, undefined, 'an omitted optional field stays absent');
  } finally {
    server.close();
  }
});

test('the old companyName shape is refused with a field-level 422, not a generic error', async () => {
  let called = false;
  const { server, url } = await serve(stubService(() => (called = true)));
  try {
    const { factoryName: _dropped, ...legacy } = LANDING_PAYLOAD;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...legacy, companyName: 'PT Maju Presisi Nusantara' }),
    });
    assert.equal(res.status, 422);
    const body = (await res.json()) as {
      error: { code: string; message: string; fields?: Array<{ field: string; code: string }> };
    };
    assert.equal(body.error.code, 'VALIDATION_ERROR');
    assert.equal(body.error.message, 'Lengkapi semua kolom formulir trial.');
    assert.deepEqual(
      body.error.fields?.map((f) => `${f.field}:${f.code}`),
      ['factoryName:REQUIRED'],
      'the response names the missing field so the caller can see the mismatch'
    );
    assert.equal(called, false, 'nothing is created for an invalid form');
  } finally {
    server.close();
  }
});

test('an over-long plantScale is a validation error, not a database error later', async () => {
  const { server, url } = await serve(stubService(() => {}));
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...LANDING_PAYLOAD, plantScale: 'x'.repeat(65) }),
    });
    assert.equal(res.status, 422);
  } finally {
    server.close();
  }
});

test('the endpoint answers POST only; opening it in a browser is a 404 in the standard envelope', async () => {
  const { server, url } = await serve(stubService(() => {}));
  try {
    const res = await fetch(url);
    assert.equal(res.status, 404);
    const body = (await res.json()) as { error: { code: string; message: string; requestId: string } };
    assert.equal(body.error.code, 'NOT_FOUND');
    assert.equal(body.error.message, 'Endpoint GET /auth/trial-register tidak dikenal.');
    assert.ok(body.error.requestId);
  } finally {
    server.close();
  }
});
