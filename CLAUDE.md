# Factory Vision

Manufacturing Execution System (MES) for mid-market Indonesian manufacturing. pnpm workspace monorepo.

```
apps/api        NestJS-style service layer (production, shopfloor, downtime, corrections, audit)
apps/console    Supervisor / manager web console (Vite + React, port 3100)
apps/operator   Shop-floor operator terminal, offline-capable via IndexedDB (port 3200)
apps/worker     Background job runner
packages/ui     Design system mirror + Factory Vision extension layer
packages/api-client, domain-types, i18n
db/             SQL migrations and seeds
```

Product language is **Indonesian** — UI copy, labels and empty states are in Bahasa Indonesia; code and comments are in English.

## MES Improvement v2.0

The Improvement PRD (`Docs/Factory Vision — MES Improvement PRD.md`) adds six operational
capabilities on top of the v1.7 baseline (the current PRD is `Docs/PRD-MES-Indonesia-MVP-v1.8.md`; v1.8 is additive over v1.7). Each is one API module, one console screen and one
migration:

| Capability | API module | Console route | Migration |
|---|---|---|---|
| Event History (append-only) | `modules/event` | `/event-history` | 026 |
| Material, inventory, MRP | `modules/material` | `/material-inventory`, `/material-readiness`, `/mrp` | 027 |
| Quality lifecycle | `modules/quality` | `/quality` | 028 |
| Maintenance | `modules/maintenance` | `/maintenance` | 029 |
| Workforce & labour | `modules/workforce` | `/workforce` | 030 |
| WIP & process handoff | `modules/wip` | `/wip` | 031 |
| Visual Production Board | `modules/board` | `/production-board` | — (a projection) |

Things worth knowing before changing any of it:

- **Every capability writes to `operational_event`**, and that table is append-only *by privilege*:
  `factory_app` holds SELECT and INSERT and nothing else. Use `EventService.recordDetached` from a
  path whose work is already committed — a failed timeline write must never fail the production
  record that caused it.
- **The improvement's roles are `MAINTENANCE`, `WAREHOUSE` and `WORKFORCE_ADMIN`** (migration 032).
  New permissions must be added to `modules/rbac/permissions.ts` *and* backfilled in a migration:
  baseline roles are only materialised for a tenant that has none, so anything added later is inert
  for existing tenants until a migration grants it.
- **`pnpm --filter @factory-vision/api run qa:routes` fails on an unmapped router file.** A new
  `routes/*.ts` must be added to `ROUTER_MOUNTS` in `scripts/audit-route-permissions.mjs`, and every
  mutating endpoint needs an explicit rule in `platform/auth/route-permissions.ts`.
- **`pnpm verify:improvement` is the acceptance gate** — eight end-to-end scenarios (PRD §50) run
  against a live API and a live PostgreSQL, asserting business rules through HTTP and then reading
  the rows back as the database owner. It is idempotent: it may be run repeatedly against the same
  database.

## UI work: read this first

All UI changes are governed by **[Docs/DESIGN-SYSTEM-GUIDELINE.md](Docs/DESIGN-SYSTEM-GUIDELINE.md)**, which is kept out of the published repository and so exists only in a local checkout. The rules that catch people out:

- **`packages/ui/src` is a mirror of `D:\Design System` and must not be edited.** Product-specific additions go in `packages/ui/src/fv` and are imported from `@factory-vision/ui/fv`. Run `pnpm ds:check` to verify the mirror; `pnpm ds:pull` to refresh it from upstream.
- **One palette, no accent picker.** Factory Vision's colours live in `packages/ui/src/fv/palette.css` — a seven-blue ramp (`#001D39` → `#BDD8E9`) that re-points the `--md-sys-color-*` tokens for light and dark. Blue is an accent only: it lives in `primary`/`secondary`/`tertiary`/chart/hero, while `background` and every `surface-container-*` step stay neutral grey (light) or neutral near-black (dark). The file is imported at each app root right after `tokens.css`. The `[data-accent]` presets in the mirror are dead: nothing sets the attribute, so never add one.
- **No literal colours.** No hex, no `rgba()` — outside `fv/palette.css`, the one file allowed to name them. Use the `--color-*` / `--space-*` / `--radius-*` / `--elevation-*` contract aliases, or the `Tone` helpers from `@factory-vision/ui/fv`. Prefer the short `--color-*` aliases over the `--md-sys-*` names beneath them.
- **Filled and solid by default.** Gradients and translucent washes are the exception. Cards use `SurfaceCard` (not `Card variant="filled"`); chips, badges and status pills use the solid `toneContainer` + `toneOnContainer` pair, never `toneWash`. Tone belongs on rails, icons, sparklines and figures — not on the container behind them. Full rule in §2.3 of the guideline.
- **One fill for every selected state.** The active tab, a selected `FilterChip`, the hero, a CTA button — all fill solid `--color-primary` / `--color-on-primary`. There is no second "selected" colour; use `FilterChip` from `@factory-vision/ui/fv` instead of the mirror's `Chip variant="filter"`, whose selected fill is tied to `secondary-container`. Every table header fills solid with `--color-primary` / `--color-on-primary` via `fv/table-header.css`, imported once at the console root. **Console tables are `DataTable` from `@factory-vision/ui/fv`, never the mirror's `AdvancedDataTable` directly:** the wrapper is the reference look (the Customer Order list) as defaults — titled, row count under the title via `count`, a checkbox column only when `onBulkDelete`/`onBulkExport` is passed, an expand chevron only when `renderExpandedRow` is. A hand-written `<table>` takes `className="fv-table"` inside a `.fv-table-scroll` div, with `fv-num` on numeric columns. See §2.3 of the guideline.
- **Lines are hairlines: `--color-border`, never `--color-outline-variant`.** The palette carries two greys on purpose — `outline-variant` (Steel Gray, `#8A93A3`) is for icon and secondary-text tone, `border` (`#DCE0E6`) is the only weight a card edge, row divider or separator may use. The mirror's `AdvancedDataTable` and `SurfaceCard` already draw with `border`; 175 hand-written `1px solid outline-variant` rules in the apps did not, which is what made the console read as boxes. Prefer no line at all where a tonal step (`surface` over `background`) already separates.
- **One icon family:** Material Symbols Rounded via `<Icon name="…" />`. Do not add `lucide-react` or any other icon package.
- **Every screen must survive both `data-theme` values** (dark and light). This follows for free if you never write a literal colour.
- Industry examples (`PlantOverviewHero`, `WorkOrderList`, …) come from `@factory-vision/ui/examples`, not the package root.

## Commands

```bash
pnpm dev              # every app in parallel
pnpm dev:console      # console only
pnpm dev:operator     # operator only
pnpm typecheck        # tsc --noEmit across the workspace
pnpm ds:check         # design system mirror integrity
pnpm db:migrate       # apply db/migrations
pnpm db:seed          # apply db/seeds
pnpm verify:improvement   # MES Improvement end-to-end acceptance (PRD §50)
```

## Notes

- The `dist/` directories committed under `apps/` and `packages/` are stale build output, not sources — don't read them for current behaviour.
- Product docs (PRD, roadmap, architecture, market analysis) live in `Docs/`, which is git-ignored and not published to GitHub.
