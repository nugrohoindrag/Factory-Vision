# Factory Vision API — Go

Implementasi Go dari `apps/api` (Express + `pg`). Dibangun per milestone menuju satu cutover;
sampai saat itu `apps/api` (Node) tetap menjadi referensi perilaku dan sumber fixture, dan
tidak diubah. Kontrak HTTP dipertahankan byte-per-byte: envelope error, array polos untuk
list, format token sesi, hash scrypt, TOTP, dan nilai AES-GCM yang tersimpan tetap terbaca.

## Menjalankan lokal

```bash
# Postgres identik CI, migrasi + seed (dari root repo)
docker run -d --name fv-pg -e POSTGRES_USER=factory -e POSTGRES_PASSWORD=factory \
  -e POSTGRES_DB=factory_vision -e TZ=Asia/Jakarta -p 5432:5432 postgres:16-alpine
DATABASE_URL=postgresql://factory:factory@localhost:5432/factory_vision \
  APP_DB_PASSWORD=ci-app-role-password pnpm db:migrate && pnpm db:seed

# API Go di :4000 (konek sebagai role RLS factory_app, bukan owner)
cd apps/api-go && go build -o bin/fv ./cmd/fv
PORT=4000 NODE_ENV=test TZ=Asia/Jakarta AUTH_REQUIRED=true SEED_DEMO_DATA=true \
  DATABASE_URL=postgresql://factory_app:ci-app-role-password@localhost:5432/factory_vision \
  BOOTSTRAP_ADMIN_EMAIL=admin@pabrik.co.id BOOTSTRAP_ADMIN_PASSWORD=ChangeMe-Local-Only \
  BOOTSTRAP_OPERATOR_PIN=284617 MFA_ENCRYPTION_KEY=local-test-key ./bin/fv serve
```

Nama variabel lingkungan sama dengan Node (lihat `.env.example`); tambahan: `ADMIN_ADDR`
(metrics Prometheus + pprof, default `127.0.0.1:4100`, jangan dipublikasikan), `SLOW_QUERY_MS`,
`OTEL_EXPORTER_OTLP_ENDPOINT` (tracing hanya aktif bila diisi), `GOMEMLIMIT`.

Subcommand: `fv serve` (default), `fv healthcheck` (dipakai `HEALTHCHECK` image distroless).
`fv worker`, `fv migrate`, `fv seed-demo` menyusul di milestone M5/M7.

## Uji

```bash
go vet ./... && go test ./...                      # unit: envelope, validator, tabel permission vs golden, TOTP/scrypt/AES vs nilai Node, rate limit, route audit
DATABASE_URL=postgresql://factory_app:ci-app-role-password@localhost:5432/factory_vision \
OWNER_DATABASE_URL=postgresql://factory:factory@localhost:5432/factory_vision \
  go test -tags integration ./...                  # RLS lintas tenant, append-only ditolak DB, cursor keyset, sesi buatan Node terbaca
```

Gate black-box (skrip yang sudah ada, bahasa-agnostik) melawan Go di `:4000`:

```bash
QA_API=http://localhost:4000 node apps/api/scripts/qa-security-posture.mjs
API_BASE=http://localhost:4000 node scripts/verify-user-stories.mjs
QA_API_CMD="apps/api-go/bin/fv serve" pnpm verify:improvement      # skrip spawn menerima QA_API_CMD
```

Uji diferensial (Node `:4001` dan Go `:4000` di DB yang sama, replay semua GET dari inventori):

```bash
MSYS_NO_PATHCONV=1 node scripts/qa-api-diff.mjs --include=/api/v1/master,/api/v1/events \
  --allow=/api/v1/master/batches,/api/v1/master/devices
```

Fixture di `fixtures/*.json` dihasilkan dari sumber TS oleh
`node --import tsx apps/api/scripts/export-go-fixtures.mjs`; CI gagal bila hasilnya berbeda dari
yang ter-commit. Tabel route→permission di `internal/platform/rbac/table.go` ditulis tangan dan
diuji identik dengan golden untuk seluruh 322 route `/api/v1` — termasuk urutan tie-break
komparator V8 yang tidak konsisten (aturan method-spesifik yang dideklarasikan belakangan menang;
aturan `*` mempertahankan urutan).

## Tata letak

```
cmd/fv                       binary: serve | healthcheck
fixtures/                    katalog permission, baseline role, golden route→permission, inventori endpoint (dari TS)
internal/platform/
  config      env → struct (NODE_ENV=production menolak AUTH_REQUIRED=false; TZ wajib di production)
  db          pgxpool (DATABASE_POOL_MAX/MIN, lifetime, health check), WithTenant = BEGIN; set_config('app.tenant_id') ; COMMIT,
              WithoutTenant hanya untuk relay/queue, pemetaan 23505/23503/23502/23514, tracer slow-query + histogram
  httpx       Error + Handle (satu-satunya tempat envelope dibentuk), JSON streaming (SetEscapeHTML false), Decode 8 MiB,
              Validator (pesan identik TS), request id, server dengan timeout
  httpx/middleware  security headers, CORS, gzip ≥1 KiB (streaming), recover, access log, timeout per request
  tenancy     X-Tenant-Id / DEFAULT_TENANT_ID / X-User-Id / X-User-Role (jalur AUTH_REQUIRED=false)
  auth        Principal, token (<tenant>.<base64url>, sha256), Resolver (ristretto TTL 10 s + singleflight + touch idle
              throttled 60 s via runner berbatas), middleware AttachPrincipal/RequirePermission, scope helpers
  rbac        katalog + baseline (embed fixture), tabel RULES + PUBLIC_API_PATHS + matcher, Authorize
  security    RequestLimiter/CredentialGuard (semantik identik), scrypt byte-kompatibel, AES-256-GCM v1:, TOTP RFC 6238,
              security events + webhook + counter Prometheus
  cache       cache per tenant (ristretto + singleflight + invalidasi)
  async       runner detached berbatas (semaphore) — audit/event/touch tidak memblokir request, tidak fan-out tanpa batas
  observability  Prometheus (latency per route, in-flight, query DB, security event), pprof di ADMIN_ADDR, OTel opsional, slog
internal/modules/
  meta        /health, /meta/deployment, /meta/openapi.json, /docs
  event       /events, /events/timeline, /events/summary (+ ?cursor= keyset aditif), Recorder detached berbatas
  audit       /audit-logs, Recorder (awaited / detached / in-transaction)
  identity    login, operator-login, MFA (verify/status/enroll/confirm/disable), session, logout, sessions, password, PIN,
              bootstrap admin & PIN awal, sweeper sesi, repository app_session
  roles       /permissions, /roles CRUD; PermissionsFor / ResolveScope / LandingPathFor untuk resolver
  masterdata  62 route /master/* (plants, lines, work centers, machines, products, BOM, operators, reasons, users, devices,
              processes, routings, machine-rates, kpi-targets, shifts) — DB adalah rekaman, cache per tenant TTL 30 s
  shift       /shifts CRUD
  csv         /csv/entities, template, export (formula-neutralised), import per baris (+ dryRun)
internal/routes   pipeline + mount; routes_test: setiap route mutasi wajib punya aturan permission eksplisit (chi.Walk)
internal/testkit  pool app + owner untuk uji integrasi
```

## Milestone dan gate

| M | Isi | Status | Gate |
|---|---|---|---|
| M0 | platform, health/meta, event, audit, resolver, tabel permission, observability, CI job `api-go`, `qa-api-diff` | selesai | `go test` + integrasi; `qa-api-diff` identik untuk events/audit/meta |
| M1 | identity (login, MFA, sesi, kredensial), roles, master data (62 route, entitas yang dulu in-memory kini persisten), shifts, CSV, security summary, bootstrap | selesai | `qa-security-posture` 12/13 (sisa: trial-register → M6); `verify-user-stories` 34/81 (semua bagian identitas, user, role, master data, shift, CSV, audit, meta) |
| M2 | production, shopfloor (output, downtime, sync-batch, sync exceptions), corrections, OEE, shift handover/performance, `master/batches` | — | `verify-persistence`, `qa-batch-integrity`, `qa-sales-http-boundary`, user stories shop floor |
| M3 | analytics (14), reports, alerts parsial | — | user stories analytics, `qa-production-posture` |
| M4 | material/mrp, quality, maintenance, workforce, wip, board, alerts penuh | — | `verify:improvement` 8 skenario |
| M5 | planning, molds, storage fs/S3, `fv worker`, relay outbox + hub SSE | — | `qa-mold-crud`, user stories planning |
| M6 | onboarding (trial-register), client-management + admin internal | — | `verify-user-stories` penuh, posture 13/13 |
| M7 | `fv migrate`, `fv seed-demo`, Dockerfile/compose/CI cutover, hapus runtime Node | — | seluruh CI hijau tanpa Node |

Rencana lengkap: `~/.claude/plans/wise-beaming-dongarra.md` (lokal).

## Baseline performa (M1, bukan klaim)

Laptop pengembang, Postgres 16 di Docker, DB seed yang sama, 32 klien paralel selama 5 detik per
endpoint, pool 10 koneksi di kedua sisi (`DATABASE_POOL_MAX` default). Diukur dengan generator
beban kecil (closed loop), ADMIN token.

| Endpoint | Go rps | Go p50 / p95 / p99 | Node rps | Node p50 / p95 / p99 |
|---|---|---|---|---|
| `GET /master/products` | 8 736 | 2.7 / 6.4 / 16.0 ms | 1 260 | 19.1 / 71.1 / 118.1 ms |
| `GET /master/machines` | 9 852 | 2.8 / 6.3 / 9.7 ms | 1 454 | 18.8 / 47.6 / 89.6 ms |
| `GET /roles` | 5 438 | 4.7 / 11.0 / 19.4 ms | 1 425 | 23.1 / 33.9 / 49.5 ms |
| `GET /events?limit=200` (murni DB) | 625 | 42.9 / 109.9 / 244.2 ms | 402 | 77.2 / 109.5 / 134.6 ms |
| `GET /auth/session` | 6 899 | 3.9 / 9.6 / 15.6 ms | 1 787 | 17.0 / 30.2 / 43.0 ms |

Yang ber-cache (master data, roles, sesi) 4–7× lebih cepat. Yang murni DB (`events`, 200 baris ×
19 kolom per permintaan) hanya 1,5× di median dan ekor p99-nya lebih panjang: 32 goroutine
berebut 10 koneksi, sedangkan event loop Node menyerialkan. Kandidat untuk diprofil saat M3
(pprof di `ADMIN_ADDR`), bukan untuk ditebak.

## Divergensi yang disengaja (allowlist `qa-api-diff`)

- Body > 8 MiB / JSON rusak → 413/400 ber-envelope (Node: 500 tanpa kode).
- 404/405 di luar `/api/v1` dan `/socket.io/*` → envelope JSON (Node: HTML / handshake socket.io; tidak ada klien yang memakai socket.io).
- Route inline yang membalas `{message}` tanpa envelope (`/master/bom/:id`, `/master/users/:id`) → envelope dengan pesan sama.
- `GET /csv/entities`: Node mengembalikan `[]` (bug `res.json(csv.listEntities)` tanpa pemanggilan); Go mengembalikan daftar entitas.
- `master/devices`, `master/kpi-targets` (tulis), `master/bom` (demo), batch PUT, work-center update/delete: Node menyimpannya hanya di memori (hilang saat restart, dan `hydrateReference` mengabaikan tabel kosong); Go membaca/menulis tabel. Sampai `fv seed-demo` (M7), daftar demo yang hanya hidup di memori Node tidak muncul dari Go.
- `master/processes` menyertakan `createdAt`/`updatedAt` dari DB (Node hanya pada respons create).
- Audit `actorId` merekam principal yang sebenarnya (Node menulis literal `Admin` pada banyak route master data).
- `PUT /master/downtime-reasons/:id` dan `reject-reasons/:id` menerapkan field body (Node mengabaikan payload).
- Staleness cache sesi maksimal 10 s per proses (sama seperti Node).
