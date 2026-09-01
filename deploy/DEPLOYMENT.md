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

The stack is seven services: PostgreSQL, the API, the background worker, the
three front ends, and, for an internet-facing install only, a reverse proxy.

```bash
cp deploy/.env.example deploy/.env
# set POSTGRES_PASSWORD and APP_DB_PASSWORD; leave AUTH_REQUIRED=true
docker compose -f deploy/docker-compose.yml up -d
```

That pulls the images CI publishes. Add `--build` to build them on the box
instead, which needs roughly 2 GB of RAM for the Vite builds; a small VPS
should pull.

Then apply the schema:

Apply the schema **before** starting the API: production records live in
PostgreSQL, so the API refuses to start against a database that has none.
On a host that pulled images and has no checkout, the schema ships inside
the API image:

```bash
docker compose -f deploy/docker-compose.yml run --rm migrate
```

From a source checkout instead:

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
| Internal admin console | `http://127.0.0.1:3300`, loopback only |
| API + docs | proxied at `/api/v1`, human-readable index at `/api/v1/docs` |

Neither the database nor the API publishes a port: both are reachable only
from the compose network, and each front end proxies `/api` to the API on its
own origin, which is what keeps the operator terminal free of CORS setup on a
plant LAN. Add a `ports` mapping if a DBA genuinely needs direct access.

The internal admin console is the vendor's client management, not a customer
surface, so it binds to loopback. Reach it through an SSH tunnel
(`ssh -L 3300:127.0.0.1:3300 <host>`) rather than publishing it.

### The worker and the planning queue

The background worker serves no port. It is the process that drains the
planning queue: demand-forecast aggregation and capacity recalculation are
`planning_job` rows, and the API answers `202` after enqueuing one rather than
doing the work inside the request.

`FOR UPDATE SKIP LOCKED` is what makes that split safe — a claim takes a row no
other transaction holds — so running the queue in the API as well is correct,
merely wasteful. `API_RUN_JOB_RUNNER` decides:

```bash
API_RUN_JOB_RUNNER=false    # default in deploy/.env: the worker owns the queue
API_RUN_JOB_RUNNER=true     # single-container install with no worker service
```

Scaling the worker is `docker compose up -d --scale worker=2`; no coordination
is needed. If forecasts stop completing, check the worker's logs first — with
`API_RUN_JOB_RUNNER=false` there is nothing else draining the queue.

The **outbox relay** runs in the API, not the worker, and is not a job. Its
subscribers hold the WebSocket connections, which exist only in that process; a
relay elsewhere would mark events published that nobody heard. `OUTBOX_RELAY_ENABLED=false`
turns it off, and `OUTBOX_RELAY_INTERVAL_MS` sets its poll interval.

### Document storage

Customer Order attachments go through an object-store adapter, chosen by
`OBJECT_STORAGE_DRIVER`:

- `filesystem` (default) writes to the `document-data` volume. Correct while
  there is exactly **one** API container.
- `s3` uses MinIO or any S3-compatible bucket.

**Switch to `s3` before running a second API replica.** Two replicas on local
volumes each end up holding half the attachments, and the symptom is
intermittent 404s on documents that uploaded successfully — one of the harder
faults to diagnose after the fact.

MinIO ships behind a profile, because the single-VPS stack does not need it:

```bash
# in deploy/.env
OBJECT_STORAGE_DRIVER=s3
OBJECT_STORAGE_ENDPOINT=http://minio:9000
OBJECT_STORAGE_BUCKET=factory-vision-documents
OBJECT_STORAGE_ACCESS_KEY=<pilih>
OBJECT_STORAGE_SECRET_KEY=<pilih>

docker compose -f deploy/docker-compose.yml --profile minio up -d
```

The bucket must exist before the API starts; create it once from the MinIO
console on `:9001`, or with `mc mb`. The API checks the bucket at boot and logs
`[storage] unavailable: …` if it cannot reach it, so a misconfiguration shows up
in the startup log rather than at the first upload.

Migrating existing documents from the volume to a bucket is a copy of
`/var/lib/factory-vision/documents/<tenant>/<object>` to the same key in the
bucket; the keys are identical by design.

### Public VPS

For an internet-facing deployment, the `proxy` profile adds Traefik: it
terminates HTTPS on `:443`, redirects HTTP, and obtains and renews Let's
Encrypt certificates itself.

```bash
# in deploy/.env
WEB_BIND=127.0.0.1          # keep 3100/3200 off the public interface
ACME_EMAIL=ops@example.com
DASHBOARD_DOMAIN=dashboard.example.com
OPERATOR_DOMAIN=operator.example.com
API_DOMAIN=api.example.com

docker compose -f deploy/docker-compose.yml --profile proxy up -d
```

Each domain must already resolve to the host, or the ACME challenge fails.
The firewall then needs only 22, 80 and 443; nothing else should be reachable
from outside.

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
| `BOOTSTRAP_ADMIN_EMAIL` | — | **Required.** Without it no account can sign in and the API says so at boot |
| `BOOTSTRAP_ADMIN_PASSWORD` | — | **Required**, minimum 12 characters; a shorter one is refused |
| `BOOTSTRAP_ADMIN_NAME` | `Administrator` | Display name of the first administrator |
| `BOOTSTRAP_OPERATOR_PIN` | — | Starting PIN for shop-floor terminals. Applied **only** to operators that have none, so it never resets a PIN an administrator issued. Leave it unset and issue PINs from Settings → Operator → PIN instead |
| `PLANNING_JOB_INTERVAL_MS` | `5000` | How often the planning queue (forecast, capacity recalculation) is drained |
| `DOCUMENT_STORAGE_DIR` | `<cwd>/var/documents` | Where Customer Order source documents are written. **Mount a volume**, or attachments are lost on redeploy |
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

### Pilot go-live checklist

Run these against the installed stack, in order. Each one has failed in
practice, which is why it is on the list.

```bash
# 1. The API must NOT be connected as a superuser. A superuser bypasses every
#    row-level security policy, so tenant isolation silently does not apply.
docker compose -f deploy/docker-compose.yml logs api | grep -i 'SECURITY'
# → no output. Any "[db] SECURITY: connected as ..." line is a stop.

# 2. Migrations applied, including the SALES role and the planning tables.
docker compose -f deploy/docker-compose.yml exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "select count(*) from schema_migrations"
# → 19 or more.

# 3. An administrator can sign in.
curl -s -X POST http://<host>:4000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"<BOOTSTRAP_ADMIN_EMAIL>","password":"<BOOTSTRAP_ADMIN_PASSWORD>"}'

# 4. Every operator who will use a terminal has a PIN. Without one they cannot
#    sign in, and the terminal gives no clue why.
docker compose -f deploy/docker-compose.yml exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "select o.employee_number, (c.operator_id is not null) as has_pin
     from operator o left join operator_credential c on c.operator_id = o.id"
# → every row true. Issue the missing ones in Settings → Operator → PIN.

# 5. Master data survives a restart, i.e. it is really in PostgreSQL.
docker compose -f deploy/docker-compose.yml restart api
curl -s -H "Authorization: Bearer $TOKEN" http://<host>:4000/api/v1/master/products
# → the same products as before the restart, not an empty array.
```

## Rollback

Migrations `005`–`019` each ship a matching file in `db/rollbacks/`, applied one
step at a time in reverse order. Three things to know before using them:

- **Take a dump first.** `pg_dump` is the only thing that makes a rollback
  reversible; the rollback scripts are not.
- **`019` is deliberately a no-op.** It repaired `input_quantity` values that
  violated the §10 invariant, and the broken figures were not recorded anywhere
  to restore. Rolling it back would only re-introduce negative WIP.
- **`017` refuses** while any user still holds the `SALES` role; move them to
  another role first. This is intentional, so a rollback cannot orphan a
  signed-in user against a role that no longer exists.

```bash
# Snapshot before anything.
docker compose -f deploy/docker-compose.yml exec -T postgres \
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > backup-$(date +%F-%H%M).sql

# One step back at a time; the runner rolls back the most recent migration.
pnpm exec tsx db/migrate.ts rollback

# Then redeploy the matching image tag.
IMAGE_TAG=<previous> docker compose -f deploy/docker-compose.yml up -d
```

To restore wholesale instead:

```bash
docker compose -f deploy/docker-compose.yml down
docker compose -f deploy/docker-compose.yml up -d postgres
docker compose -f deploy/docker-compose.yml exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" < backup-<stamp>.sql
IMAGE_TAG=<previous> docker compose -f deploy/docker-compose.yml up -d
```

## Upgrades

Migrations are idempotent and additive; `pnpm db:migrate` re-runs every file
safely. Rebuild and restart:

```bash
docker compose -f deploy/docker-compose.yml up -d --build
```

Tablets pick up a new operator bundle on next load, `index.html` is served
`no-store` precisely so a terminal never keeps running last week's build.
