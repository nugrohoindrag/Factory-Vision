/**
 * Site configuration set from the internal console (Pengaturan Situs).
 *
 * The bundle is static, so anything an account manager may change without a
 * release, the Google Analytics measurement id and the Search Console
 * verification token, is fetched at load from the API and applied to the
 * document. Nothing here is inline script: the analytics bootstrap comes from
 * `/site/gtag.js` on this origin, which is what the landing CSP allows.
 */
export interface SiteConfig {
  siteName: string;
  siteUrl: string;
  siteDescription: string;
  gaMeasurementId: string;
  searchConsoleToken: string;
}

const GA_ID = /^G-[A-Z0-9]{4,16}$/;

function addScript(src: string, async = false): void {
  if (document.querySelector(`script[src="${src}"]`)) return;
  const el = document.createElement('script');
  el.src = src;
  el.async = async;
  document.head.appendChild(el);
}

export function applySiteConfig(config: SiteConfig): void {
  if (config.searchConsoleToken && !document.querySelector('meta[name="google-site-verification"]')) {
    const meta = document.createElement('meta');
    meta.name = 'google-site-verification';
    meta.content = config.searchConsoleToken;
    document.head.appendChild(meta);
  }
  if (GA_ID.test(config.gaMeasurementId)) {
    addScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(config.gaMeasurementId)}`, true);
    addScript('/site/gtag.js');
  }
}

/** Fetches and applies the configuration. A failure leaves the page as built. */
export async function bootstrapSiteConfig(): Promise<void> {
  try {
    const res = await fetch('/site/config.json', { headers: { Accept: 'application/json' } });
    if (!res.ok) return;
    applySiteConfig((await res.json()) as SiteConfig);
  } catch {
    /* offline or API down: the page still renders, only analytics is missing */
  }
}
