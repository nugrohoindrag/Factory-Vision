import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Security response headers (§29).
 *
 * Written here rather than pulled in as a dependency: the API answers JSON, so
 * the correct policy is the restrictive one — deny everything and name the two
 * exceptions — and that is a dozen lines, not a package. The front ends get
 * their own policy from the nginx config that serves them, because a policy
 * that has to cover both an API and an HTML bundle ends up covering neither.
 */

/** `/api/v1/docs` is the one HTML page this service serves. */
const DOCS_PATH = '/api/v1/docs';

const API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
const DOCS_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

export function securityHeaders(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Content-Security-Policy', req.path === DOCS_PATH ? DOCS_CSP : API_CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');

    // Browsers ignore HSTS over plain HTTP, so a plant LAN on http:// is
    // unaffected while a public deployment behind TLS gets the guarantee.
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

    // The API's answers are per-session data. A shared cache holding one
    // operator's work orders and handing them to the next tablet is a data
    // leak that never touches the application code.
    if (req.path.startsWith('/api/')) {
      res.setHeader('Cache-Control', 'no-store');
    }

    // Express advertises itself by default, which tells a scanner what to try.
    res.removeHeader('X-Powered-By');
    next();
  };
}
