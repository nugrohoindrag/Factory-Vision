/**
 * Acceptance test for the offline / on-premise asset requirement.
 *
 * Every request to a host other than localhost is aborted, which is what a
 * plant network with no outbound access looks like to the browser.
 */
import { chromium } from 'playwright-core';

// Screenshots go where every other QA script puts its evidence, which is
// git-ignored. Defaulting to '.' scattered PNGs across the repository root.
import fs from 'fs';
const OUT = process.env.OUT_DIR || 'qa-evidence';
fs.mkdirSync(OUT, { recursive: true });
const blocked = [];
const consoleErrors = [];

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
});
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });

await page.route('**/*', (route) => {
  const url = route.request().url();
  const isLocal = url.includes('localhost') || url.startsWith('data:') || url.startsWith('blob:');
  if (isLocal) return route.continue();
  blocked.push(url);
  return route.abort();
});

/**
 * The console under test.
 *
 * Parameterised rather than hardcoded to :3100: a long-lived dev server on the
 * default port is exactly what made an earlier defect invisible, and a check
 * that silently reports on stale code is worse than no check.
 */
const CONSOLE_URL = process.env.CONSOLE_URL || 'http://localhost:3100';

page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

await page.goto(CONSOLE_URL + '/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/offline-login.png` });

await page.fill('#fv-email', 'admin@pabrik.co.id');
await page.fill('#fv-password', process.env.BOOTSTRAP_ADMIN_PASSWORD || 'ChangeMe-Local-Only');
await page.getByRole('button', { name: /^Masuk$/ }).click();
await page.waitForTimeout(3500);
await page.screenshot({ path: `${OUT}/offline-dashboard.png` });

await page.goto(CONSOLE_URL + '/work-orders', { waitUntil: 'networkidle' });
await page.waitForTimeout(1800);
await page.screenshot({ path: `${OUT}/offline-workorders.png` });

// Acceptance: every icon must render as a glyph, not as its ligature name.
// The DOM text is the ligature either way, so the check measures rendered
// width: one glyph is about the font size, the spelled-out word is far wider.
let failures = 0;
for (const route of ['/', '/work-orders', '/oee', '/settings?tab=products', '/reports?tab=production']) {
  await page.goto(`${CONSOLE_URL}${route}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const bad = await page.evaluate(async () => {
    await document.fonts.ready;
    const wide = [];
    for (const el of document.querySelectorAll('.material-symbols-rounded')) {
      const size = parseFloat(getComputedStyle(el).fontSize) || 24;
      // scrollWidth exceeding the box means the word did not collapse to a glyph.
      if (el.scrollWidth > size * 1.6) wide.push(el.textContent.trim());
    }
    return [...new Set(wide)];
  });
  if (bad.length) failures += 1;
  console.log(`${bad.length ? 'FAIL' : 'OK  '} ${route}${bad.length ? '  raw icons: ' + bad.join(', ') : ''}`);
}

const fontRequests = blocked.filter((u) => u.includes('font'));
console.log(`\nExternal requests blocked: ${blocked.length}`);
console.log(`  of which font related: ${fontRequests.length}`);
if (blocked.length) console.log('  ' + [...new Set(blocked)].slice(0, 6).join('\n  '));
console.log(`Console errors: ${consoleErrors.length}`);
if (consoleErrors.length) console.log('  ' + consoleErrors.slice(0, 5).join('\n  '));
console.log(failures === 0 ? '\nRESULT: PASS' : `\nRESULT: FAIL (${failures} routes)`);

await browser.close();
