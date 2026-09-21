/**
 * Site configuration set from the internal console (Pengaturan Situs).
 *
 * The bundle is static, so anything an account manager may change without a
 * release, the Google Analytics measurement id and the Search Console
 * verification token, is fetched at load from the API and applied to the
 * document. Nothing here is inline script: the analytics bootstrap comes from
 * `/site/gtag.js` on this origin, which is what the landing CSP allows.
 *
 * In production nginx already splices the same tags into the raw index.html
 * (an SSI include of `/site/head.html`), because Google's verification
 * crawler runs no script. This client-side pass is the dev-server fallback
 * and is a no-op when the tags are already present.
 */
export interface SiteConfig {
  siteName: string;
  siteUrl: string;
  siteDescription: string;
  gaMeasurementId: string;
  searchConsoleToken: string;
  whatsappNumber: string;
  whatsappLabel: string;
}

/** What the page shows before the API answers, and if it never does. */
export const DEFAULT_SITE_CONFIG: SiteConfig = {
  siteName: 'Factory Vision',
  siteUrl: 'https://factoryvision.id',
  siteDescription: '',
  gaMeasurementId: '',
  searchConsoleToken: '',
  whatsappNumber: '6281382258620',
  whatsappLabel: 'Ask our Team',
};

let pending: Promise<SiteConfig> | null = null;

/** Fetches the configuration once; every caller shares the same request. */
export function getSiteConfig(): Promise<SiteConfig> {
  if (!pending) {
    pending = fetch('/site/config.json', { headers: { Accept: 'application/json' } })
      .then((res) => (res.ok ? (res.json() as Promise<SiteConfig>) : DEFAULT_SITE_CONFIG))
      .then((cfg) => ({ ...DEFAULT_SITE_CONFIG, ...cfg }))
      .catch(() => DEFAULT_SITE_CONFIG);
  }
  return pending;
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
  applySiteConfig(await getSiteConfig());
}
