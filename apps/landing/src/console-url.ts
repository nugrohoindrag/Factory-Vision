/**
 * Where the product console lives, seen from the landing page.
 *
 * The landing image is built once in CI and deployed to hosts it knows nothing
 * about, so the address cannot be baked in. Production serves the console on
 * `dashboard.` beside the apex (`factoryvision.id` → `dashboard.factoryvision.id`),
 * and that convention is the default; a deployment laid out differently sets
 * `VITE_CONSOLE_URL` at build time (see deploy/Dockerfile.web).
 */
export function consoleUrl(location: Pick<Location, 'hostname' | 'protocol'> = window.location): string {
  const configured = import.meta.env.VITE_CONSOLE_URL as string | undefined;
  if (configured) return configured.replace(/\/+$/, '');

  const { hostname, protocol } = location;
  if (hostname === 'localhost' || hostname === '127.0.0.1') return 'http://localhost:3100';

  const apex = hostname.replace(/^www\./, '');
  return `${protocol}//dashboard.${apex}`;
}
