# Factory Vision

Manufacturing Execution System (MES) for mid-market Indonesian manufacturing. pnpm workspace monorepo.

```
apps/api        The API: one Go binary `fv` (chi + pgx) — serve | worker | migrate | seed-demo | healthcheck | probe
apps/console    Supervisor / manager web console (Vite + React, port 3100)
apps/operator   Shop-floor operator terminal, offline-capable via IndexedDB (port 3200)
apps/admin      Internal client-management console (port 3300)
apps/vision     Camera analytics worker (Python, YOLO + ByteTrack): people counting, crowd / potential-weapon alerts, vehicle density; own DB `fv_vision`, compose profile `vision`
packages/ui     Design system mirror + Factory Vision extension layer
packages/api-client, domain-types, i18n
db/             SQL migrations and seeds
```

Product language is **Indonesian** — UI copy, labels and empty states are in Bahasa Indonesia; code and comments are in English.

## MES Improvement v2.0

The Improvement PRD (`Docs/Factory Vision — MES Improvement PRD.md`) adds six operational
capabilities on top of the v1.7 baseline (the current PRD is `Docs/PRD-MES-Indonesia-MVP-v1.8.md`; v1.8 is additive over v1.7). Each is one API module, one console screen and one
migration:

| Capability | API module (`apps/api/internal/modules/`) | Console route | Migration |
|---|---|---|---|
| Event History (append-only) | `event` | `/event-history` | 026 |
| Material, inventory, MRP | `material` | `/material-inventory`, `/material-readiness`, `/mrp` | 027 |
| Quality lifecycle | `quality` | `/quality` | 028 |
| Maintenance | `maintenance` | `/maintenance` | 029 |
| Workforce & labour | `workforce` | `/workforce` | 030 |
| WIP & process handoff | `wip` | `/wip` | 031 |
| Visual Production Board | `board` | `/production-board` | — (a projection) |

Things worth knowing before changing any of it:

- **Every capability writes to `operational_event`**, and that table is append-only *by privilege*:
  `factory_app` holds SELECT and INSERT and nothing else. Use `event.Service.RecordDetached` from a
  path whose work is already committed — a failed timeline write must never fail the production
  record that caused it.
- **The improvement's roles are `MAINTENANCE`, `WAREHOUSE` and `WORKFORCE_ADMIN`** (migration 032).
  New permissions must be added to `apps/api/fixtures/permission-catalog.json` (and to the roles
  that hold them in `system-role-permissions.json`) *and* backfilled in a migration: baseline roles
  are only materialised for a tenant that has none, so anything added later is inert for existing
  tenants until a migration grants it.
- **`go test ./internal/routes` fails on a mutating route without an explicit permission rule.**
  Every new mutating endpoint needs a rule in `internal/platform/rbac/table.go` and a row in
  `fixtures/route-permissions.golden.json`; the test walks the chi tree, so nothing is exempt.
- **`pnpm verify:improvement` is the acceptance gate** — ten end-to-end scenarios (PRD §50) run
  against a live API (the script boots `apps/api/bin/fv` itself) and a live PostgreSQL, asserting
  business rules through HTTP and then reading the rows back as the database owner. It is
  idempotent: it may be run repeatedly against the same database.

## Backend (`apps/api`, Go)

One binary, `fv`, built with `go build -o bin/fv ./cmd/fv` (or `pnpm --filter @factory-vision/api
build`). `serve` is the API, `worker` the planning job queue, `migrate` the in-image migration
runner, `seed-demo` the demo plant with its 60-day history, `probe` a status-code probe for the
distroless container. Details and the layout are in `apps/api/README.md`.

- **The HTTP contract is what the front ends and the QA scripts expect**: bare arrays for lists,
  the `{ error: { code, message, fields, requestId } }` envelope, Indonesian messages, session
  token `<tenant>.<base64url>`, scrypt `scrypt$salt$hash`, AES-GCM `v1:` values. Domain structs
  keep timestamps as strings via `db.ISO`/`db.Date`; optional fields are pointers, never
  `omitempty` on `0`/`false`.
- **Every handler returns `error` through `httpx.Handle`**, every query runs inside
  `pool.WithTenant` (RLS), `WithoutTenant` is only for the relay/queue, and nothing ever
  UPDATEs `audit_log` or `operational_event`. Detached work (audit, events, session touch) goes
  through `async.Runner`, never a bare goroutine.
- **Policy lives in `internal/platform/rbac/table.go`** and is tested against
  `fixtures/route-permissions.golden.json`. The fixtures are the frozen contract snapshot (see
  `fixtures/fixtures.go`); edit them by hand together with the code they describe.
- **Every migration must be idempotent**: `fv migrate` keeps no state table and replays the whole
  directory on every deploy (`pnpm db:replay-check` and the CI `persistence` job catch a
  violation). Migration 035 (`onboarding_*`, `internal_session`) is the pattern.
- **Gates before a push**, all against the binary alone on the CI-identical Postgres: `go test
  ./...`, `go test -tags integration ./...`, `qa-security-posture.mjs` (13/13),
  `verify-user-stories.mjs` (81/81, needs `SEED_DEMO_DATA=true`), `pnpm verify:improvement`
  (83/83), `verify:persistence`, `qa:posture`, `qa:mold-crud`, `qa:batch`, `qa:sales-boundary`.
  The scripts that read rows back take `DATABASE_URL` as the owner connection. On Git Bash pass
  `MSYS_NO_PATHCONV=1` to scripts that take URL paths as arguments.

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
pnpm dev              # every app in parallel (the API via `go run`)
pnpm dev:console      # console only
pnpm dev:operator     # operator only
pnpm typecheck        # tsc --noEmit across the workspace, go vet for the API
pnpm ds:check         # design system mirror integrity
pnpm db:migrate       # apply db/migrations (dev runner, tracks schema_migrations)
pnpm db:seed          # apply db/seeds
pnpm db:seed:demo     # demo plant + 60 days of history (fv seed-demo, idempotent)
pnpm verify:improvement   # MES Improvement end-to-end acceptance (PRD §50)
```

## Notes

- The `dist/` directories under `apps/` and `packages/` are build output, not sources — don't read them for current behaviour.
- Product docs (PRD, roadmap, architecture, market analysis) live in `Docs/`, which is git-ignored and not published to GitHub.
