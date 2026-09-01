#!/usr/bin/env node
/**
 * Module boundary check (MES-019-3, MES-019-4).
 *
 * The repository has no ESLint installation — `pnpm lint` was an empty
 * recursive call — so the rule lives here and `pnpm lint` runs it. It is the
 * same rule an `no-restricted-imports` config would express, enforced at the
 * same point in the pipeline, and it fails the build the same way.
 *
 * Two invariants:
 *
 *  1. **`planning` must not import `production`** (nor the other execution
 *     modules). Planning decides what to make; execution records what happened.
 *     A dependency in that direction would make planning untestable without a
 *     shop floor, and would let a scheduling change break output capture.
 *
 *  2. **Only `planning/public` is importable from outside.** Reaching into
 *     `planning/application` or `planning/infrastructure` from another module
 *     is what turns a boundary into a suggestion.
 *
 * The reverse direction is allowed on purpose: production asks planning what a
 * work order is for, through the facade.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API_MODULES = path.join(ROOT, 'apps', 'api', 'src', 'modules');

/** Modules `planning` may not depend on, and why. */
const FORBIDDEN_FROM_PLANNING = {
  production: 'planning tidak boleh bergantung pada eksekusi produksi',
  shopfloor: 'planning tidak boleh bergantung pada shop floor',
  oee: 'planning tidak boleh bergantung pada perhitungan OEE',
  correction: 'planning tidak boleh bergantung pada modul koreksi',
  performance: 'planning tidak boleh bergantung pada modul performance',
  reporting: 'planning tidak boleh bergantung pada modul reporting',
  shift: 'planning tidak boleh bergantung pada modul shift handover',
};

const IMPORT_PATTERN = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT_PATTERN = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

function walk(dir, found = []) {
  if (!fs.existsSync(dir)) return found;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      walk(full, found);
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      found.push(full);
    }
  }
  return found;
}

function importsOf(source) {
  const specifiers = [];
  for (const pattern of [IMPORT_PATTERN, DYNAMIC_IMPORT_PATTERN]) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(source)) !== null) specifiers.push(match[1]);
  }
  return specifiers;
}

/** Resolves a relative specifier to a module-relative path under `modules/`. */
function resolveModulePath(file, specifier) {
  if (!specifier.startsWith('.')) return undefined;
  const resolved = path.resolve(path.dirname(file), specifier);
  if (!resolved.startsWith(API_MODULES)) return undefined;
  return path.relative(API_MODULES, resolved).split(path.sep);
}

const violations = [];

for (const file of walk(API_MODULES)) {
  const relative = path.relative(ROOT, file).replace(/\\/g, '/');
  const owningModule = path.relative(API_MODULES, file).split(path.sep)[0];
  const source = fs.readFileSync(file, 'utf-8');

  for (const specifier of importsOf(source)) {
    const target = resolveModulePath(file, specifier);
    if (!target) continue;
    const targetModule = target[0];
    if (targetModule === owningModule) continue;

    // 1. planning must not depend on execution
    if (owningModule === 'planning' && FORBIDDEN_FROM_PLANNING[targetModule]) {
      violations.push(
        `${relative}\n    imports "${specifier}" (module: ${targetModule})\n    → ${FORBIDDEN_FROM_PLANNING[targetModule]} (MES-019)`
      );
    }

    // 2. planning is reachable only through public/
    if (targetModule === 'planning' && owningModule !== 'planning' && target[1] !== 'public') {
      violations.push(
        `${relative}\n    imports "${specifier}" (planning/${target[1] ?? '?'})\n    → hanya planning/public yang boleh diimpor modul lain (MES-019)`
      );
    }
  }
}

if (violations.length > 0) {
  console.error(`\n[boundaries] ${violations.length} pelanggaran batas modul:\n`);
  for (const violation of violations) console.error(`  ${violation}\n`);
  process.exit(1);
}

console.log('[boundaries] OK — batas modul planning terjaga.');
