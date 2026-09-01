#!/usr/bin/env node
/**
 * Design System compliance check (Docs/DESIGN-SYSTEM-GUIDELINE.md).
 *
 * The guideline's rules are mostly about what must *not* appear in product
 * code, which makes them checkable. The one that matters most for dark/light
 * correctness is the ban on literal colours: a screen built only from
 * `--color-*` tokens survives both themes for free, and one hex value is enough
 * to break it in exactly one of them — the failure nobody notices until a
 * customer does.
 *
 *   node scripts/check-design-system-compliance.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Product code the rules apply to. The mirror and its fv layer are exempt. */
const SCAN_ROOTS = [
  'apps/console/src',
  'apps/operator/src',
  'apps/admin/src',
];

/**
 * The files allowed to name a colour, and why.
 *
 * `fv/palette.css` is the palette itself. The other two paint into a `data:`
 * URI SVG, which cannot read CSS custom properties at all — the guideline
 * grants the brand mark the same allowance, and both files document it. Every
 * value in them is taken from the Factory Vision blue ramp.
 */
const COLOUR_EXEMPT = [
  'packages/ui/src/fv/palette.css',
  'apps/console/src/features/auth/avatars.ts',
  'apps/operator/src/features/auth/avatars.ts',
];

const RULES = [
  {
    id: 'no-hex-colour',
    // Six- or three-digit hex in a style position. Skips `#` in JSX text and
    // in URLs by requiring the literal to stand alone.
    pattern: /(?<![\w&])#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b(?!\s*\{)/g,
    message: 'literal hex colour — use a --color-* token (guideline §2.2)',
    appliesTo: (file) => /\.(tsx?|css)$/.test(file),
  },
  {
    id: 'no-rgba',
    pattern: /\brgba?\s*\(/g,
    message: 'rgba()/rgb() literal — use a --color-* token (guideline §2.2)',
    appliesTo: (file) => /\.(tsx?|css)$/.test(file),
  },
  {
    id: 'no-lucide',
    pattern: /from\s+['"]lucide-react['"]/g,
    message: 'lucide-react — one icon family only: <Icon name="…" /> Material Symbols Rounded',
    appliesTo: (file) => /\.tsx?$/.test(file),
  },
  {
    id: 'no-data-accent',
    pattern: /data-accent\s*=/g,
    message: 'data-accent — the accent presets are dead, one palette only',
    appliesTo: (file) => /\.(tsx?|css)$/.test(file),
  },
  {
    id: 'no-mirror-filled-card',
    pattern: /<Card\s+variant=["']filled["']/g,
    message: 'Card variant="filled" — use SurfaceCard from @factory-vision/ui/fv',
    appliesTo: (file) => /\.tsx$/.test(file),
  },
  {
    id: 'no-mirror-filter-chip',
    pattern: /<Chip\s+variant=["']filter["']/g,
    message: 'Chip variant="filter" — use FilterChip from @factory-vision/ui/fv',
    appliesTo: (file) => /\.tsx$/.test(file),
  },
  {
    id: 'no-tone-wash',
    pattern: /\btoneWash\b/g,
    message: 'toneWash — chips, badges and pills use solid toneContainer/toneOnContainer',
    appliesTo: (file) => /\.tsx$/.test(file),
  },
];

function walk(dir, found = []) {
  if (!fs.existsSync(dir)) return found;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      walk(full, found);
    } else {
      found.push(full);
    }
  }
  return found;
}

const violations = [];
let scanned = 0;

for (const root of SCAN_ROOTS) {
  for (const file of walk(path.join(ROOT, root))) {
    const relative = path.relative(ROOT, file).replace(/\\/g, '/');
    if (COLOUR_EXEMPT.includes(relative)) continue;

    const source = fs.readFileSync(file, 'utf-8');
    scanned += 1;

    for (const rule of RULES) {
      if (!rule.appliesTo(relative)) continue;
      rule.pattern.lastIndex = 0;
      let match;
      while ((match = rule.pattern.exec(source)) !== null) {
        const line = source.slice(0, match.index).split('\n').length;
        violations.push({ file: relative, line, rule: rule.id, message: rule.message, text: match[0] });
      }
    }
  }
}

console.log(`Berkas dipindai: ${scanned}`);

if (violations.length > 0) {
  console.error(`\nPELANGGARAN DESIGN SYSTEM (${violations.length}):\n`);
  for (const v of violations.slice(0, 40)) {
    console.error(`  ${v.file}:${v.line}\n    ${v.text}  →  ${v.message}`);
  }
  if (violations.length > 40) console.error(`  … dan ${violations.length - 40} lainnya`);
  console.error('');
  process.exit(1);
}

console.log('OK — tidak ada literal warna, ikon di luar Material Symbols, atau komponen mirror terlarang.');
