# Factory Vision

Manufacturing Execution System (MES) for mid-market Indonesian manufacturing.

Shop-floor operators capture production, downtime and reject on a tablet that
keeps working through a Wi-Fi outage; supervisors and managers read OEE,
bottlenecks and shift handover from a console. The product language is
**Bahasa Indonesia** — every label, empty state and error the user sees is
Indonesian, while the code and its comments are English.

## Layout

pnpm workspace monorepo.

| Path | What it is |
|---|---|
| `apps/api` | Service layer: production, shop floor, downtime, OEE, corrections, audit, RBAC |
| `apps/console` | Supervisor / manager web console (Vite + React, port 3100) |
| `apps/operator` | Shop-floor terminal, offline-capable via IndexedDB (port 3200) |
| `apps/admin` | Internal client-management console (port 3300) |
| `apps/worker` | Background job runner |
| `packages/ui` | Design system mirror plus the Factory Vision extension layer (`ui/fv`) |
| `packages/api-client`, `packages/domain-types`, `packages/i18n` | Shared contracts |
| `db/` | SQL migrations and seeds |
| `deploy/` | Dockerfiles, compose stack and the deployment guide |

## Running locally

Requires Node 22 and pnpm (the version is pinned by `packageManager`; run
`corepack enable` and pnpm resolves itself).

```bash
pnpm install

# Nothing ships with a default password: until these are set, nobody can sign in.
BOOTSTRAP_ADMIN_EMAIL=admin@example.com \
BOOTSTRAP_ADMIN_PASSWORD='choose-a-long-one' \
SEED_DEMO_DATA=true \
pnpm dev
```

| Command | |
|---|---|
| `pnpm dev` | every app in parallel |
| `pnpm dev:console` / `dev:operator` / `dev:api` / `dev:admin` | one app |
| `pnpm typecheck` | `tsc --noEmit` across all nine packages |
| `pnpm build` | build every app and package |
| `pnpm verify:stories` | acceptance suite, 81 assertions over 54 user stories, against a running API |
| `pnpm ds:check` | design-system mirror integrity (needs the upstream system on disk) |
| `pnpm db:migrate` / `db:seed` | apply `db/migrations` and `db/seeds` |

`SEED_DEMO_DATA` loads a demo tyre plant with 60 days of history. Leave it
unset for a real install, which should start empty and be filled from the
factory's own master data.

## Branches

| Branch | Role |
|---|---|
| `master` | trunk — day-to-day development, default branch |
| `staging` | pre-production verification |
| `production` | what is live; images from here are also tagged `latest` |

Promotion is forward-only: `master` → `staging` → `production`.

## CI/CD

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every push and
pull request to those three branches:

1. **verify** — install, typecheck, build, then start the API and run the
   acceptance suite against it.
2. **publish** — only after `verify` is green, and never for a pull request.
   Builds three images and pushes them to GHCR.

| Image | Built from |
|---|---|
| `ghcr.io/nugrohoindrag/factory-vision-api` | `deploy/Dockerfile.api` |
| `ghcr.io/nugrohoindrag/factory-vision-console` | `deploy/Dockerfile.web` (`APP=console`) |
| `ghcr.io/nugrohoindrag/factory-vision-operator` | `deploy/Dockerfile.web` (`APP=operator`) |

Each is tagged with its branch name, a short commit sha, semver for a `v*` tag,
and `latest` on `production`.

Deployment itself is a pull, not a push — no CI credential reaches a server:

```bash
docker compose -f deploy/docker-compose.yml pull
docker compose -f deploy/docker-compose.yml up -d
```

## Deployment

The same images serve both supported modes; only configuration differs.
`GET /api/v1/meta/deployment` reports which one an install is running.

- **On-premise, single tenant** — the whole stack inside a plant's own network,
  no outbound internet required. The operator terminal's assets (fonts, icons)
  are bundled, not fetched from a CDN.
- **Cloud, multi-tenant** — managed PostgreSQL, tenancy resolved per request.
  Isolation is enforced in the session, in every query's scope, and by
  `FORCE ROW LEVEL SECURITY` in the database.

Copy `deploy/.env.example` to `deploy/.env` and fill it in first. See
`deploy/DEPLOYMENT.md` for the full guide, including the configuration
reference and the post-install verification steps.

## Note on documentation

Product documentation — PRD, roadmap, market analysis, technical architecture
and the design-system guideline — is kept outside this repository, so `Docs/`
references elsewhere in the tree will not resolve here.
