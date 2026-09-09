import type { CorsOptions } from 'cors';

/**
 * Cross-origin policy (§28).
 *
 * The front ends are served from the same origin as the API — each app's nginx
 * proxies `/api` to this service — so the correct production answer is that
 * there is no cross-origin access at all, and `CORS_ALLOWED_ORIGINS` is the
 * deliberate exception for a customer who splits the console onto its own
 * host. Development gets the local Vite ports and nothing else.
 *
 * What is never acceptable is the reflecting wildcard the API shipped with:
 * any page on the internet could then read this API through the browser of
 * someone signed in to it.
 */

const DEV_ORIGINS = [3000, 3100, 3200, 3300].flatMap((port) => [
  `http://localhost:${port}`,
  `http://127.0.0.1:${port}`,
]);

export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function allowedOrigins(): string[] {
  const configured = process.env.CORS_ALLOWED_ORIGINS?.split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);

  if (configured?.length) return configured;
  return isProduction() ? [] : DEV_ORIGINS;
}

export function isOriginAllowed(origin: string | undefined): boolean {
  // No Origin header: a same-origin request, a server-to-server call, or the
  // operator terminal's own fetch. Cross-origin is what this gate is for.
  if (!origin) return true;
  return allowedOrigins().includes(origin.replace(/\/$/, ''));
}

export function corsOptions(): CorsOptions {
  return {
    origin(origin, callback) {
      if (isOriginAllowed(origin)) return callback(null, true);
      // Answering "not allowed" rather than throwing keeps the response a
      // plain CORS refusal instead of a 500 in the error log.
      callback(null, false);
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-Id', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 600,
  };
}

/** Reported at boot so an operator can see the policy that is actually live. */
export function describeCorsPolicy(): string {
  const origins = allowedOrigins();
  if (origins.length) return origins.join(', ');
  return isProduction() ? 'same-origin only' : 'development defaults';
}
