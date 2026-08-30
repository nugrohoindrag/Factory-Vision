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

## UI work: read this first

All UI changes are governed by **[Docs/DESIGN-SYSTEM-GUIDELINE.md](Docs/DESIGN-SYSTEM-GUIDELINE.md)**, which is kept out of the published repository and so exists only in a local checkout. The rules that catch people out:

- **`packages/ui/src` is a mirror of `D:\Design System` and must not be edited.** Product-specific additions go in `packages/ui/src/fv` and are imported from `@factory-vision/ui/fv`. Run `pnpm ds:check` to verify the mirror; `pnpm ds:pull` to refresh it from upstream.
- **One palette, no accent picker.** Factory Vision's colours live in `packages/ui/src/fv/palette.css` — a seven-blue ramp (`#001D39` → `#BDD8E9`) that re-points the `--md-sys-color-*` tokens for light and dark. Blue is an accent only: it lives in `primary`/`secondary`/`tertiary`/chart/hero, while `background` and every `surface-container-*` step stay neutral grey (light) or neutral near-black (dark). The file is imported at each app root right after `tokens.css`. The `[data-accent]` presets in the mirror are dead: nothing sets the attribute, so never add one.
- **No literal colours.** No hex, no `rgba()` — outside `fv/palette.css`, the one file allowed to name them. Use the `--color-*` / `--space-*` / `--radius-*` / `--elevation-*` contract aliases, or the `Tone` helpers from `@factory-vision/ui/fv`. Prefer the short `--color-*` aliases over the `--md-sys-*` names beneath them.
- **Filled and solid by default.** Gradients and translucent washes are the exception. Cards use `SurfaceCard` (not `Card variant="filled"`); chips, badges and status pills use the solid `toneContainer` + `toneOnContainer` pair, never `toneWash`. Tone belongs on rails, icons, sparklines and figures — not on the container behind them. Full rule in §2.3 of the guideline.
- **One fill for every selected state.** The active tab, a selected `FilterChip`, the hero, a CTA button — all fill solid `--color-primary` / `--color-on-primary`. There is no second "selected" colour; use `FilterChip` from `@factory-vision/ui/fv` instead of the mirror's `Chip variant="filter"`, whose selected fill is tied to `secondary-container`. Every `AdvancedDataTable` header fills solid with `--color-primary` / `--color-on-primary` via `fv/table-header.css`, imported once at the console root — including CSS fixes for the header's "select all" checkbox and sort-arrow icon, which otherwise disappear into the fill. See §2.3 of the guideline.
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
```

## Notes

- The `dist/` directories committed under `apps/` and `packages/` are stale build output, not sources — don't read them for current behaviour.
- Product docs (PRD, roadmap, architecture, market analysis) live in `Docs/`, which is git-ignored and not published to GitHub.
