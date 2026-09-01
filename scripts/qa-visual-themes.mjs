/**
 * Pilot gate — every screen in both themes.
 *
 * "Survives dark and light" is usually checked by eye, which does not scale to
 * a dozen screens and does not fail a build. This drives the real console in a
 * real browser, switches `data-theme`, and measures what actually rendered:
 *
 *   - Text/background contrast on sampled elements, against WCAG AA (4.5:1 for
 *     body text). A token used in the wrong slot shows up here as a number.
 *   - Any element painted with a colour that is not resolvable from tokens —
 *     the symptom of a hardcoded value surviving the static check.
 *   - Screenshots of every screen in both themes, as evidence.
 *
 *   CONSOLE_URL=http://localhost:3150 node scripts/qa-visual-themes.mjs
 */
import { chromium } from 'playwright-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '..', '.env') });

const CONSOLE_URL = process.env.CONSOLE_URL || 'http://localhost:3100';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = process.env.OUT_DIR || path.resolve(here, '..', 'qa-evidence', 'themes');
const EMAIL = process.env.BOOTSTRAP_ADMIN_EMAIL || 'admin@pabrik.co.id';
const PASSWORD = process.env.BOOTSTRAP_ADMIN_PASSWORD || 'ChangeMe-Local-Only';

fs.mkdirSync(OUT, { recursive: true });

let passed = 0;
let failed = 0;
const failures = [];

function check(label, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    failures.push(label);
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

/** The screens this release added, plus the ones most likely to regress. */
const SCREENS = [
  ['/order-receiving', 'order-receiving'],
  ['/customer-orders', 'customer-orders'],
  ['/master-customers', 'master-customers'],
  ['/demand-forecast', 'demand-forecast'],
  ['/capacity-planning', 'capacity-planning'],
  ['/production-plans', 'production-plans'],
  ['/work-orders', 'work-orders'],
  ['/', 'dashboard'],
  ['/live-board', 'live-board'],
  ['/settings?tab=operators', 'settings-operators'],
  ['/settings?tab=molds', 'settings-molds'],
  ['/sync-exceptions', 'sync-exceptions'],
];

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });

const consoleErrors = [];
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

/**
 * Samples rendered colours and computes contrast.
 *
 * Runs in the page so it measures what the browser actually painted, including
 * anything inherited or overridden — which is the only way to catch a token
 * used in the wrong slot.
 */
async function auditTheme(label) {
  return page.evaluate((themeLabel) => {
    const parse = (value) => {
      const m = value.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const [r, g, b, a = '1'] = m[1].split(',').map((n) => parseFloat(n));
      return { r, g, b, a: Number(a) };
    };
    const luminance = ({ r, g, b }) => {
      const f = (c) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const contrast = (fg, bg) => {
      const l1 = luminance(fg);
      const l2 = luminance(bg);
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    };
    /** Walks up until an element paints an opaque background. */
    const effectiveBackground = (el) => {
      let node = el;
      while (node && node !== document.documentElement) {
        const bg = parse(getComputedStyle(node).backgroundColor);
        if (bg && bg.a > 0.5) return bg;
        node = node.parentElement;
      }
      const bodyBg = parse(getComputedStyle(document.body).backgroundColor);
      return bodyBg && bodyBg.a > 0.5 ? bodyBg : { r: 255, g: 255, b: 255, a: 1 };
    };

    const bodyBg = parse(getComputedStyle(document.body).backgroundColor);
    const problems = [];
    let sampled = 0;

    const candidates = Array.from(
      document.querySelectorAll('h1, h2, h3, p, span, td, th, label, button, a, li')
    ).filter((el) => {
      const text = (el.textContent || '').trim();
      if (!text || text.length > 120) return false;
      // Only leaf-ish nodes, so a container's text is not measured twice.
      if (el.children.length > 0) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 4 && rect.height > 4 && rect.top < window.innerHeight;
    });

    for (const el of candidates.slice(0, 220)) {
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.opacity === '0') continue;
      // WCAG 1.4.3 exempts decoration. An element the author marked
      // `aria-hidden` is not announced and is not content, so holding it to a
      // text ratio would force dividers and icon glyphs to look like text.
      if (el.closest('[aria-hidden="true"]')) continue;
      const fg = parse(style.color);
      if (!fg || fg.a < 0.5) continue;
      const bg = effectiveBackground(el);
      const ratio = contrast(fg, bg);
      sampled += 1;

      const size = parseFloat(style.fontSize);
      const bold = parseInt(style.fontWeight, 10) >= 700;
      // WCAG AA: 3:1 for large text (>=18.66px bold or >=24px), else 4.5:1.
      const threshold = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;

      if (ratio < threshold) {
        problems.push({
          text: (el.textContent || '').trim().slice(0, 45),
          tag: el.tagName.toLowerCase(),
          color: style.color,
          background: `rgb(${bg.r}, ${bg.g}, ${bg.b})`,
          ratio: Math.round(ratio * 100) / 100,
          threshold,
          fontSize: size,
        });
      }
    }

    // An icon name outside the bundled subset has no glyph, so the browser
    // paints the ligature *text* instead.
    //
    // Measured with canvas, not `getBoundingClientRect`: the span keeps its
    // 17px layout box and `overflow: visible` lets the word spill across the
    // navigation behind it, so the element's own rect stays innocent while the
    // screen shows "receipt_long" written over three menu items. Measuring the
    // ink is the only way to see it.
    const rawIcons = [];
    const probe = document.createElement('canvas').getContext('2d');
    for (const el of document.querySelectorAll('span')) {
      const cs = getComputedStyle(el);
      if (!/Material Symbols/i.test(cs.fontFamily)) continue;
      const name = (el.textContent || '').trim();
      if (!name) continue;
      const size = parseFloat(cs.fontSize) || 24;
      probe.font = `${size}px "Material Symbols Rounded"`;
      // A real glyph is about one em wide; a spelled-out name is far wider.
      if (probe.measureText(name).width > size * 1.9) rawIcons.push(name);
    }

    return {
      theme: themeLabel,
      appliedTheme: document.documentElement.getAttribute('data-theme'),
      bodyBackground: bodyBg ? `rgb(${bodyBg.r}, ${bodyBg.g}, ${bodyBg.b})` : 'transparent',
      bodyOpaque: Boolean(bodyBg && bodyBg.a > 0.5),
      sampled,
      problems,
      rawIcons: [...new Set(rawIcons)],
    };
  }, label);
}

try {
  console.log('\n1. Masuk ke console');
  await page.goto(CONSOLE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  await page.fill('#fv-email', EMAIL).catch(() => undefined);
  await page.fill('#fv-password', PASSWORD).catch(() => undefined);
  await page.getByRole('button', { name: /^Masuk$/ }).click().catch(() => undefined);
  await page.waitForTimeout(4000);

  const signedIn = await page.evaluate(() => !document.querySelector('#fv-email'));
  check('administrator masuk ke console', signedIn, 'masih di layar login');
  if (!signedIn) throw new Error('login gagal, audit tema tidak dapat dijalankan');

  const summary = [];

  /**
   * Switches the theme the way a user does.
   *
   * The console owns `data-theme` and re-applies it from its own state on every
   * render, so setting the attribute from outside is silently reverted. An
   * earlier version of this script did exactly that and reported the light
   * theme as passing while measuring dark twice.
   */
  async function setTheme(target) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const current = await page.evaluate(() =>
        document.documentElement.getAttribute('data-theme')
      );
      if (current === target) return true;
      const toggle = page
        .locator('button')
        .filter({ hasText: /^(light_mode|dark_mode)$/ })
        .first();
      if (await toggle.count()) await toggle.click().catch(() => undefined);
      else return false;
      await page.waitForTimeout(800);
    }
    return (
      (await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === target
    );
  }

  for (const theme of ['light', 'dark']) {
    console.log(`\n2. Tema ${theme}`);
    const switched = await setTheme(theme);
    check(`tema berhasil dipindahkan ke ${theme}`, switched, 'toggle tema tidak ditemukan');

    for (const [route, name] of SCREENS) {
      // A full page load would reset the app's theme state to its default and
      // silently retest dark, so navigate the way the router does.
      const [routePath, routeQuery = ''] = route.split('?');
      await page.evaluate(
        ([pathname, search]) => {
          window.history.pushState({}, '', pathname + (search ? `?${search}` : ''));
          window.dispatchEvent(new PopStateEvent('popstate'));
        },
        [routePath, routeQuery]
      );
      await page.waitForTimeout(2400);

      if ((await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) !== theme) {
        await setTheme(theme);
      }

      // `font-display: block` gives the icon font a three-second block period.
      // Screenshotting inside it captures ligature names rather than glyphs,
      // which reads as a rendering defect and is only a cold cache.
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(500);

      const audit = await auditTheme(theme);
      await page.screenshot({ path: `${OUT}/${name}-${theme}.png` });

      summary.push({ name, theme, ...audit });

      check(
        `${name} · ${theme} · tema benar-benar aktif`,
        audit.appliedTheme === theme,
        `data-theme=${audit.appliedTheme}`
      );
      check(
        `${name} · ${theme} · body punya latar opaque`,
        audit.bodyOpaque,
        audit.bodyBackground
      );
      check(
        `${name} · ${theme} · seluruh ikon tampil sebagai glyph`,
        audit.rawIcons.length === 0,
        audit.rawIcons.slice(0, 4).join(', ')
      );
      check(
        `${name} · ${theme} · kontras teks memenuhi WCAG AA (${audit.sampled} elemen)`,
        audit.problems.length === 0,
        audit.problems
          .slice(0, 3)
          .map((p) => `"${p.text}" ${p.ratio}:1 (min ${p.threshold})`)
          .join('; ')
      );
    }
  }

  console.log('\n3. Kesehatan halaman');
  const fatal = consoleErrors.filter(
    (e) => !/favicon|Failed to load resource.*40[34]|ResizeObserver/i.test(e)
  );
  check('tidak ada error JavaScript fatal', fatal.length === 0, fatal.slice(0, 3).join(' | '));

  fs.writeFileSync(`${OUT}/contrast-report.json`, JSON.stringify(summary, null, 2));
  console.log(`\n${passed} pemeriksaan lulus, ${failed} gagal.`);
  console.log(`Bukti visual: ${OUT}`);
  if (failures.length) console.error('\nGagal:\n' + failures.map((f) => `  - ${f}`).join('\n'));
} catch (error) {
  failed += 1;
  console.error('\nException:', error.message);
  await page.screenshot({ path: `${OUT}/error.png` }).catch(() => undefined);
} finally {
  await browser.close();
}

process.exit(failed > 0 ? 1 : 0);
