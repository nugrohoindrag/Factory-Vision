# Deployment, Factory Vision MES

Covers **US-052 (Cloud SaaS)** and **US-053 (On-Premise)**. Both modes run the
same images and the same code requires the domain model and business
behaviour to be identical, so the only thing that differs is configuration.

| | Cloud SaaS | On-Premise |
|---|---|---|
| `DEPLOYMENT_MODE` | `CLOUD_MULTI_TENANT` | `ON_PREMISE_SINGLE_TENANT` |
| Tenant resolution | Per request, from the session | Pinned to `DEFAULT_TENANT_ID` |
| Database | Managed PostgreSQL 16 | PostgreSQL 16 container or the factory's own instance |
| Reachability | Public HTTPS | Plant LAN only; no outbound internet required |
| Operator PWA | Same bundle | Same bundle, served from the plant network |

`GET /api/v1/meta/deployment` reports the active mode, so a support call never
has to guess which one an install is running.

---

## On-Premise (US-053)

Requires Docker Engine 24+ with the Compose plugin. Nothing else, no cloud
account, no external service.

```bash
cp deploy/.env.example deploy/.env
# set POSTGRES_PASSWORD; leave AUTH_REQUIRED=true
docker compose -f deploy/docker-compose.yml up -d --build
```

Then apply the schema:

Migrations run as the schema owner (`POSTGRES_USER`), not as the application
role, and `APP_DB_PASSWORD` is what lets the migration give `factory_app` its
login:

```bash
docker compose -f deploy/docker-compose.yml exec api node -e "process.exit(0)" # readiness
export DATABASE_URL='postgresql://factory:<POSTGRES_PASSWORD>@localhost:5432/factory_vision'
export APP_DB_PASSWORD='<APP_DB_PASSWORD from deploy/.env>'
pnpm db:migrate
pnpm db:seed
```

| Service | URL |
|---|---|
| Supervisor / manager console | `http://<host>:3100` |
| Operator terminal (tablets) | `http://<host>:3200` |
| API + docs | proxied at `/api/v1`, human-readable index at `/api/v1/docs` |

The database port is deliberately not published: it is reachable only from the
compose network. Add a `ports` mapping if a DBA genuinely needs direct access.

### Tablets

The operator terminal is offline-capable (US-045). Point each tablet at
`http://<host>:3200` and add it to the home screen. Once loaded, production
capture continues through a Wi-Fi outage and syncs on reconnect, the terminal
shows queue depth and sync state in its header so an operator can always tell
whether their counts have reached the server.

---

## Cloud SaaS (US-052)

Same images, different configuration:

```bash
DEPLOYMENT_MODE=CLOUD_MULTI_TENANT
DATABASE_URL=postgresql://… # managed PostgreSQL 16
AUTH_REQUIRED=true
# DEFAULT_TENANT_ID is not set, tenancy comes from the session
```

Run `deploy/Dockerfile.api` behind the platform's load balancer with TLS
terminated there, and serve the two web bundles as static sites (or run
`Dockerfile.web` and point its `/api/` proxy at the API service).

Tenant isolation is enforced in three places, and all three must hold:

1. **Session** the bearer token carries the tenant; the API ignores a
 conflicting `X-Tenant-Id` header rather than trusting it.
2. **Query scope** plant / line / work-centre scope narrows every read.
3. **Database** migrations `001` and `002` add `FORCE ROW LEVEL SECURITY`
 with a `tenant_isolation` policy on every tenant-scoped table, keyed on
 `current_setting('app.tenant_id')`. A connection that does not declare a
 tenant sees no rows at all.

 This last layer only holds if the API connects as a role the policies
 apply to. A superuser carries `BYPASSRLS` and is exempt from all of them,
 so `POSTGRES_USER` must never appear in the API's `DATABASE_URL`.
 Migration `004` creates `factory_app` (`NOSUPERUSER`, `NOBYPASSRLS`) for
 exactly this, and `pnpm db:migrate` gives it the password in
 `APP_DB_PASSWORD`. The API logs a `[db] SECURITY:` line at startup and
 `/api/v1/meta/health` reports `ROW LEVEL SECURITY BYPASSED` if it ever
 finds itself connected as a privileged role.

 Verify on a real install, as the application role, not the owner:

 ```bash
 psql "$DATABASE_URL" -c "SET app.tenant_id = 'some-other-tenant'"                       -c 'SELECT count(*) FROM production_record'
 # must return 0
 ```

---

## Offline assets

Everything the UI needs to render is bundled with the deployment. There is no
CDN dependency at runtime, so the console and the operator terminal work
identically on a plant network with no outbound internet.

| Asset | Size | Source |
|---|---:|---|
| Material Symbols Rounded (158 icons) | 189 KB | `packages/ui/src/fv/fonts/` |
| Inter, Latin + Latin Extended | 130 KB | same |
| Roboto Flex, Latin + Latin Extended | 56 KB | same |
| Profile avatars | 0 KB | drawn as inline SVG from the user's initials |

The icon font is subset to the icons this product actually renders, which is
the difference between 189 KB and the 5.1 MB full set. Regenerate it after
adding an icon:

```bash
pip install fonttools brotli      # build-time only
pnpm --filter @factory-vision/ui fonts:vendor
```

The script scans the apps and the design system for icon names, prunes the
font's ligature table to those icons, subsets, and rewrites
`packages/ui/src/fv/fonts.css`. Adding an icon without re-running it leaves
that one icon rendering as its name.

### Verifying

Block outbound access and confirm the UI is intact:

```bash
# In devtools, or with a proxy that drops non-local traffic:
# every navigation and action icon must be a glyph, never the word
# "menu_open", "edit" or "delete", and no external request may be pending.
```

The repository check is `node scripts/offline-check.mjs` against a running
console; it aborts every non-localhost request, then fails if any element
carrying an icon renders wider than its own font size, which is what an
unformed ligature looks like.

---

## Configuration reference

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `4000` | API listen port |
| `DATABASE_URL` |, | PostgreSQL connection string. Use the `factory_app` role, **not** `POSTGRES_USER`: a superuser bypasses row-level security |
| `APP_DB_USER` | `factory_app` | The RLS-bound role the API connects as |
| `APP_DB_PASSWORD` |, | Set before `pnpm db:migrate`; the migration grants the role login with it |
| `DEPLOYMENT_MODE` | `CLOUD_MULTI_TENANT` | Reported by `/api/v1/meta/deployment` |
| `DEFAULT_TENANT_ID` | `tenant-pilot-factory-01` | On-premise only |
| `AUTH_REQUIRED` | `true` | **Leave on.** `false` disables authentication and every permission check |
| `DEMO_USER_PASSWORD` | `FactoryVision2026!` | Seeded pilot accounts; blank it in a real install |
| `DEMO_OPERATOR_PIN` | `1234` | Seeded operator PINs; blank it in a real install |
| `TZ` | `Asia/Jakarta` | Affects `shift_date` derivation |

---

## Verifying an install

```bash
curl -s http://<host>:4000/health
curl -s http://<host>:4000/api/v1/meta/deployment

# Unauthenticated access must be refused
curl -s http://<host>:4000/api/v1/master/products
# → {"error":{"code":"UNAUTHENTICATED",…}}

# Authenticated access must succeed and be scoped to the caller's role
TOKEN=$(curl -s -X POST http://<host>:4000/api/v1/auth/login \
 -H 'Content-Type: application/json' \
 -d '{"email":"…","password":"…"}' | jq -r.token)
curl -s -H "Authorization: Bearer $TOKEN" http://<host>:4000/api/v1/analytics/executive-kpi
```

## Upgrades

Migrations are idempotent and additive; `pnpm db:migrate` re-runs every file
safely. Rebuild and restart:

```bash
docker compose -f deploy/docker-compose.yml up -d --build
```

Tablets pick up a new operator bundle on next load, `index.html` is served
`no-store` precisely so a terminal never keeps running last week's build.
