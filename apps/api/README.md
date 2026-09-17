# Factory Vision API

Backend MES Factory Vision: satu binary Go (`fv`) di atas chi + pgx, menggantikan implementasi
Express + `pg` sebelumnya dengan kontrak HTTP yang sama byte-per-byte — envelope error, array polos
untuk list, format token sesi, hash scrypt, TOTP, dan nilai AES-GCM yang tersimpan tetap terbaca.
Front-end (`apps/console`, `apps/operator`, `apps/admin`) tidak berubah.

## Menjalankan lokal

```bash
# Postgres identik CI, migrasi + seed (dari root repo)
docker run -d --name fv-pg -e POSTGRES_USER=factory -e POSTGRES_PASSWORD=factory \
  -e POSTGRES_DB=factory_vision -e TZ=Asia/Jakarta -p 5432:5432 postgres:16-alpine
DATABASE_URL=postgresql://factory:factory@localhost:5432/factory_vision \
  APP_DB_PASSWORD=ci-app-role-password pnpm db:migrate && pnpm db:seed

# API di :4000 (konek sebagai role RLS factory_app, bukan owner)
cd apps/api && go build -o bin/fv ./cmd/fv          # atau: pnpm --filter @factory-vision/api build
PORT=4000 NODE_ENV=test TZ=Asia/Jakarta AUTH_REQUIRED=true SEED_DEMO_DATA=true \
  DATABASE_URL=postgresql://factory_app:ci-app-role-password@localhost:5432/factory_vision \
  BOOTSTRAP_ADMIN_EMAIL=admin@pabrik.co.id BOOTSTRAP_ADMIN_PASSWORD=ChangeMe-Local-Only \
  BOOTSTRAP_OPERATOR_PIN=284617 MFA_ENCRYPTION_KEY=local-test-key ./bin/fv serve
```

Variabel lingkungan ada di `.env.example`; `.env` di direktori ini dan di root repo dibaca tanpa
menimpa nilai yang sudah ada. Yang khusus binary ini: `ADMIN_ADDR` (metrics Prometheus + pprof,
default `127.0.0.1:4100`, jangan dipublikasikan), `SLOW_QUERY_MS`, `OTEL_EXPORTER_OTLP_ENDPOINT`
(tracing hanya aktif bila diisi), `GOMEMLIMIT`, `GOGC`.

Subcommand `fv`:

| Perintah | Fungsi |
|---|---|
| `serve` (default) | API HTTP; menjalankan job runner bila `API_RUN_JOB_RUNNER` bukan `false` dan relay outbox bila `OUTBOX_RELAY_ENABLED` bukan `false`; bila `SEED_DEMO_DATA` truthy, menulis demo plant + riwayat 60 hari saat boot (idempoten) |
| `worker` | job queue planning (`planning_job`, `FOR UPDATE SKIP LOCKED`) tanpa HTTP; boleh berjalan bersamaan dengan runner di API |
| `migrate` | runner migrasi di dalam image: `MIGRATE_DATABASE_URL` (owner skema), `MIGRATIONS_DIR` (default `./db`), `ALTER ROLE` untuk `APP_DB_USER`/`APP_DB_PASSWORD`, `db/seeds` bila `SEED_DEMO_DATA` truthy; exit 1 pada kegagalan pertama |
| `seed-demo` | demo plant (upsert tenant/plant/lines/processes/products), production order demo bila belum ada, riwayat shop floor 60 hari (COPY → `INSERT … ON CONFLICT DO NOTHING`); dijalankan ulang tidak menambah apa pun |
| `healthcheck` | probe `/health` untuk `HEALTHCHECK` image distroless |
| `probe <path> [method]` | cetak status HTTP satu permintaan dari dalam container (dipakai `deploy/verify-deployment.sh`) |

## Uji

```bash
go vet ./... && go test ./...                      # unit: envelope, validator, tabel permission vs golden, TOTP/scrypt/AES vs nilai referensi,
                                                   # rate limit, route audit (setiap route mutasi punya aturan), generator riwayat vs baris referensi
DATABASE_URL=postgresql://factory_app:ci-app-role-password@localhost:5432/factory_vision \
OWNER_DATABASE_URL=postgresql://factory:factory@localhost:5432/factory_vision \
  go test -tags integration ./...                  # RLS lintas tenant, append-only ditolak DB, queue/relay/storage/planning, seed demo idempoten
```

Gate black-box (skrip di `scripts/`, bahasa-agnostik: hanya HTTP + membaca DB sebagai owner):

```bash
QA_API=http://localhost:4000 node apps/api/scripts/qa-security-posture.mjs     # 13 kontrol MUST
API_BASE=http://localhost:4000 node scripts/verify-user-stories.mjs             # 81/81 (perlu SEED_DEMO_DATA=true)
pnpm verify:improvement                                                         # PRD §50, 73/73; mem-boot bin/fv sendiri di :4097
pnpm verify:persistence && pnpm qa:posture && pnpm --filter @factory-vision/api qa
```

Skrip yang mem-boot API sendiri (`verify-persistence`, `verify-mes-improvement`, `qa-mold-crud`,
`qa-batch-integrity`, `qa-sales-http-boundary`) memakai `bin/fv` (atau `bin/fv.exe`) dan menerima
`QA_API_CMD` untuk perintah lain. Yang membaca baris kembali butuh `DATABASE_URL` = koneksi owner
(atau `OWNER_DATABASE_URL` bila skrip menyediakannya).

`fixtures/*.json` adalah snapshot kontrak yang dibekukan saat cutover dari implementasi
sebelumnya: katalog permission, baseline role, golden route→permission (322 route `/api/v1`),
inventori endpoint, template industri, demo plant. Permission baru ditambahkan ke
`permission-catalog.json` + `system-role-permissions.json` dan di-backfill lewat migrasi; route baru
yang bermutasi wajib punya aturan di `internal/platform/rbac/table.go` dan baris golden-nya
(`routes_test` menegakkan keduanya lewat `chi.Walk`).

## Tata letak

```
cmd/fv                       binary: serve | worker | migrate | seed-demo | healthcheck | probe
fixtures/                    snapshot kontrak: katalog permission, baseline role, golden route→permission, inventori endpoint,
                             template industri, demo plant (rates/routings/operators yang dibaca seed riwayat)
internal/platform/
  config      env → struct (NODE_ENV=production menolak AUTH_REQUIRED=false; TZ wajib di production)
  bootstrap   seed demo: plant/lines/processes/products (upsert), production order demo, riwayat 60 hari via shopfloor.SeedHistory
  migrate     runner migrasi di image (migrations/*.sql urut nama, ALTER ROLE app, seeds bila SEED_DEMO_DATA)
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
  queue       planning_job: enqueue (di dalam transaksi pemanggil), claim FOR UPDATE SKIP LOCKED tanpa tenant, succeed/fail dengan
              max_attempts; Runner (drain per tick, Nudge dari request) dipakai API (API_RUN_JOB_RUNNER) dan fv worker
  outbox      Writer (in-transaction) + Relay: klaim per tenant SKIP LOCKED, kirim ke subscriber, tandai PUBLISHED dalam transaksi
              yang sama; kegagalan dicatat di luar transaksi, FAILED setelah 5 percobaan (at-least-once)
  realtime    hub Server-Sent Events: satu goroutine per klien, buffer per klien (drop bila penuh), room per tenant, heartbeat 25 s
  storage     ObjectStore: filesystem (default, tolak traversal) dan S3/MinIO (SigV4 di stdlib, path-style; vektor uji AWS)
internal/modules/
  meta        /health, /meta/deployment, /meta/openapi.json, /docs
  event       /events, /events/timeline, /events/summary (+ ?cursor= keyset aditif), Recorder detached berbatas
  audit       /audit-logs, Recorder (awaited / detached / in-transaction)
  identity    login, operator-login, MFA (verify/status/enroll/confirm/disable), session, logout, sessions, password, PIN,
              bootstrap admin & PIN awal, sweeper sesi, repository app_session
  roles       /permissions, /roles CRUD; PermissionsFor / ResolveScope / LandingPathFor untuk resolver
  masterdata  62 route /master/* (plants, lines, work centers, machines, products, BOM, operators, reasons, users, devices,
              processes, routings, machine-rates, kpi-targets, shifts) — DB adalah rekaman, cache per tenant TTL 30 s
  shift       /shifts CRUD; handover (context, list, create, acknowledge — tabel shift_handover), /shifts/performance
  csv         /csv/entities, template, export (formula-neutralised), import per baris (+ dryRun)
  production  production orders, work orders (state machine §11, split §25.7, process chain §13, quantity flow §10),
              batches (master/batches, ADR-29); PlanningReactor (M5) dan DemandSource (M5) sebagai antarmuka; outbox
              in-transaction; OnChange → invalidasi read model
  machinestate  machine_state_log (append-then-close), dipakai production dan shopfloor
  shopfloor   output, downtime start/resolve, sync-batch (idempoten via sync_event; satu query untuk ledger), sync
              exceptions (MES-082), shift_date di zona plant (TZ); history.go = generator riwayat demo deterministik
              (mulberry32 atas FNV-1a, identik bit dengan generator sebelumnya) + SeedHistory (COPY ke tabel temp)
  correction  correction_request (dulu in-memory): window 24 jam, auto-apply bila berwenang, approve/reject, policy
  execution   read model: snapshot per tenant (work orders, production/downtime records, downtime aktif) — 4 scan
              paralel (errgroup), cache 10 s + singleflight, di-invalidasi oleh setiap penulisan production/shopfloor
  oee         oee_config + oee_validation_entry (dulu in-memory); grain machine×shift×hari dari snapshot; drill-down,
              bottleneck, report (+CSV), target-vs-actual, /reports/oee; pembulatan identik JS (platform/jsnum)
  analytics   14 route /analytics/* (live board, pareto, KPI eksekutif, tren, line/plant/process, downtime & quality
              summary, order status, alerts, daily) dari grain line×hari; /reports/{production,downtime,shift} (+CSV
              ber-scope); ExtraAlerts = antarmuka aturan v2
  material    /materials/* (gudang, inventori + ledger, transaksi, kebutuhan/readiness, reservasi, konsumsi + varians)
              dan /mrp/* (run, hasil, latest); DemandSource (M5) sebagai antarmuka
  quality     /quality/* (inspection plans + characteristics, inspections + lines, holds, dispositions → production,
              NCR + corrective actions, transfer gate, dashboard)
  maintenance /maintenance/* (plans + due status, requests, records: assign/start/complete/emergency → downtime dan
              machine state, KPI MTBF/MTTR)
  workforce   /workforce/* (skills, requirements, qualifications dengan status turunan, shift assignments, availability
              sebagai riwayat, eligibility, labor requirements/assignments, time records, utilisation, dashboard)
  wip         /wip/* (records + aging, status history, hold/release, transfers dengan quality gate, receipts dengan
              varians beralasan, dashboard)
  board       /production-board (proyeksi lane + konflik dihitung saat dibaca; 8 pembacaan paralel) dan dispatch
  alerts      aturan §26 (material, quality, maintenance, workforce, WIP) — lima grup paralel, satu grup gagal tidak
              mengosongkan feed; digabung ke /analytics/alerts
  improvement adapter sync-batch → material/quality/wip (RECORD_CONSUMPTION, RECORD_INSPECTION, RECORD_WIP, TRANSFER_WIP)
  planning    customers, customer orders (+ lines, dokumen base64 → object store, status turunan MES-026), demand forecast (job
              DEMAND_FORECAST_GENERATE, snapshot SUPERSEDED), capacity plan (mesin × shift × hari − downtime terencana, job
              CAPACITY_PLAN_RECALCULATE, assess on-the-fly), production plan (wizard 6 langkah, optimistic locking `version`,
              agregasi demand per produk, confirm/cancel), /planning/config; audit transaksional (RecordIn) + outbox per perubahan;
              Facade untuk production (RefreshOrdersForPlanLine, PropagateProducedQuantity, WorkOrderDemand) dan material (PlanDemandLines)
  production/generation  Work Order per proses routing dari plan (validasi routing dulu, rantai predecessor, idempoten)
  mold        /molds CRUD + kompatibilitas produk (ADR-36): retire dijaga IN_USE, hapus dijaga referensi produksi
  stream      GET /events/stream (SSE): relay outbox → hub; event planning bernama `planning:<Type>` dengan amplop baris outbox
  onboarding  POST /auth/trial-register (tenant + client_account + langganan trial + admin dalam satu transaksi, lalu login),
              template industri (fixture industry-templates.json, diklon ke tenant), blank factory, status (checklist readiness
              & activation berbobot 100 dari baris tenant), step, guidance, first-workflow, events, upgrade — progres/guidance
              di tabel (migrasi 035), bukan memori proses
  clientmgmt  /api/internal/v1: login/sesi/logout staf vendor (internal_session, token di-hash), summary, plans, clients CRUD +
              status, subscription history/change, usage capture (dihitung SQL per tenant), support access (grant/revoke/use),
              audit, staff; hak per peran OWNER/ACCOUNT_MANAGER/SUPPORT
internal/routes   pipeline + mount; routes_test: setiap route mutasi wajib punya aturan permission eksplisit (chi.Walk)
internal/testkit  pool app + owner untuk uji integrasi
```

## Milestone dan gate

| M | Isi | Status | Gate |
|---|---|---|---|
| M0 | platform, health/meta, event, audit, resolver, tabel permission, observability, CI job `api-go`, `qa-api-diff` | selesai | `go test` + integrasi; `qa-api-diff` identik untuk events/audit/meta |
| M1 | identity (login, MFA, sesi, kredensial), roles, master data (62 route, entitas yang dulu in-memory kini persisten), shifts, CSV, security summary, bootstrap | selesai | `qa-security-posture` 12/13 (sisa: trial-register → M6); `verify-user-stories` 34/81 (semua bagian identitas, user, role, master data, shift, CSV, audit, meta) |
| M2 | production, shopfloor (output, downtime, sync-batch, sync exceptions), corrections, OEE, shift handover/performance, `master/batches` | selesai | `verify-persistence` 28/29 (sisa: `/reports/downtime` → M3), `qa-batch-integrity` 15/15, `qa-sales-http-boundary` 27/27, `verify-user-stories` 67/81 (sisa: analytics/reports → M3); `qa-api-diff` identik untuk work-orders (+chain, available-quantity), production-orders, shop-floor, oee (calculate, machine-performance, bottlenecks, report, target-vs-actual), reports/oee |
| M3 | analytics (14 route, satu grain line×hari dari snapshot eksekusi bersama), reports (produksi/downtime/shift + CSV), alerts v1.7 (+ antarmuka untuk aturan v2 di M4) | selesai | `verify-user-stories` 80/81 melawan Go sendirian di DB segar (sisa: riwayat demo 60 hari → `fv seed-demo` M7), `verify-persistence` 29/29, `qa-production-posture` 22/29 (sisa: planning → M5); `qa-api-diff` identik untuk 14 analytics + 4 reports kecuali executive-kpi/alerts (status KPI diturunkan dari `kpi_target` DB yang Node abaikan) |
| M4 | material/mrp, quality, maintenance, workforce, wip, board, alerts penuh, adapter sync-batch v2 | selesai | `verify-mes-improvement` 64/73 melawan Go sendirian: skenario 1–8 (material, quality, maintenance, workforce, WIP, board, events, offline) penuh; sisa skenario 9 trial-register → M6 dan 10 job runner → M5. `qa-api-diff` 33 identik / 3 diizinkan / 0 tak terduga untuk materials, mrp, quality, maintenance, workforce, wip, production-board; regresi M1–M3 tetap 59 identik / 11 diizinkan |
| M5 | planning (customers, orders + dokumen, forecast, capacity, production plan, WO generation, config), molds, storage fs/S3, queue + `fv worker`, relay outbox + hub SSE | selesai | `verify-mes-improvement` 67/73 (sisa skenario 9 trial-register → M6), `qa-mold-crud` 39/39, `qa-production-posture` 30/30, `verify-persistence` 29/29, `qa-batch-integrity` 15/15, `qa-sales-http-boundary` 27/27; uji integrasi Go: queue (claim/retry/FAILED), relay (rollback tak terkirim, PUBLISHED, FAILED setelah 5), storage fs, alur planning (verify-planning-flow diport); `qa-api-diff` 27 identik / 0 diizinkan untuk customers, customer-orders, demand-forecasts, capacity-plans, production-plans, planning, molds; `/work-orders/:id/demand` dan `/materials/readiness` kini identik |
| M6 | onboarding (trial-register, template, status, guidance, first-workflow), client management + API internal vendor, migrasi 035 (onboarding_progress/guidance/analytics_event, internal_session) | selesai | `qa-security-posture` 13/13, `verify-mes-improvement` 73/73 melawan Go sendirian; uji integrasi progres onboarding (persisten lintas instance, 404 untuk tenant lain); `scripts/qa-internal-diff.mjs` 8 identik / 3 diizinkan (tanggal DATE, lihat divergensi) untuk /api/internal/v1 |
| M7 | `fv migrate`, `fv seed-demo` (+ hook boot `SEED_DEMO_DATA`), `fv probe`, Dockerfile/compose/CI cutover ke Go, runtime Node + `apps/worker` + `packages/job-queue` dihapus, `apps/api-go` → `apps/api` | selesai | riwayat demo identik byte-per-byte dengan yang ditulis boot Node di DB segar (312 production + 233 downtime; run kedua menambah 0), `verify-user-stories` 81/81 melawan Go sendirian di DB segar, seluruh CI tanpa Node (unit + integrasi, posture 13/13, stories 81/81, improvement 73/73, persistence, mold CRUD, posture produksi, batch, sales boundary, govulncheck, CodeQL Go, trivy atas image distroless) |

Tabel di atas adalah catatan sejarah pengerjaan; sejak M7 hanya Go yang ada di repositori.

## Baseline performa (diukur saat M1, bukan klaim)

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
berebut 10 koneksi, sedangkan event loop Node menyerialkan. Profil dengan pprof di `ADMIN_ADDR`
(`go tool pprof http://127.0.0.1:4100/debug/pprof/profile`) sebelum menyetel `DATABASE_POOL_MAX`.

## Perbedaan yang disengaja terhadap implementasi Node sebelumnya

Dicatat selama migrasi (diverifikasi dengan `scripts/qa-api-diff.mjs`, yang membandingkan dua instance API atas DB
yang sama) dan dipertahankan sebagai perilaku yang dimaksud:

- Body > 8 MiB / JSON rusak → 413/400 ber-envelope (Node: 500 tanpa kode).
- 404/405 di luar `/api/v1` dan `/socket.io/*` → envelope JSON (Node: HTML / handshake socket.io; tidak ada klien yang memakai socket.io).
- Route inline yang membalas `{message}` tanpa envelope (`/master/bom/:id`, `/master/users/:id`) → envelope dengan pesan sama.
- `GET /csv/entities`: Node mengembalikan `[]` (bug `res.json(csv.listEntities)` tanpa pemanggilan); Go mengembalikan daftar entitas.
- `master/devices`, `master/kpi-targets` (tulis), `master/bom` (demo), batch PUT, work-center update/delete: Node menyimpannya hanya di memori (hilang saat restart, dan `hydrateReference` mengabaikan tabel kosong); Go membaca/menulis tabel; daftar demo yang hanya hidup di memori Node tidak ada.
- `master/processes` menyertakan `createdAt`/`updatedAt` dari DB (Node hanya pada respons create).
- Audit `actorId` merekam principal yang sebenarnya (Node menulis literal `Admin` pada banyak route master data).
- `PUT /master/downtime-reasons/:id` dan `reject-reasons/:id` menerapkan field body (Node mengabaikan payload).
- Staleness cache sesi maksimal 10 s per proses (sama seperti Node).
- `corrections`, `oee/config`, `oee/validation`, `shifts/handover`: Node menyimpannya di memori (hilang saat restart,
  `calcVersion` kembali ke 1); Go menulis `correction_request`, `oee_config`, `oee_validation_entry`, `shift_handover`.
  `GET /corrections` tidak lagi memuat dua baris demo hard-coded.
- `POST /work-orders/:id/cancel` menerima `reason`/`statusReason` di body; tanpa alasan tetap 409 seperti Node (yang
  tidak pernah meneruskan alasan, sehingga pembatalan lewat API selalu ditolak).
- `POST /production-orders`, `POST /work-orders`, `POST /shop-floor/output`, `downtime/start`: field wajib divalidasi
  (422 VALIDATION_ERROR ber-field) alih-alih diserahkan ke constraint PostgreSQL.
- `GET /master/batches` membaca `production_batch` (bentuk penuh ADR-29), bukan tiga baris demo in-memory.
- Klasifikasi sync-batch: pelanggaran constraint PostgreSQL diklasifikasikan lewat kode envelope-nya (23514 → VALIDATION_ERROR,
  permanen) alih-alih `INTERNAL_ERROR` retryable.
- Exception sync tetap difile walau konteks work order gagal dibaca (Node melewatkan pencatatan bila `contextFor` melempar).
- socket.io diganti `GET /api/v1/events/stream` (SSE, tenant dari sesi): event eksekusi memakai nama lama
  (`work-order:updated`, `production:output-recorded`, `downtime:*`) dengan entitasnya sebagai data; event planning
  `planning:<Type>` dengan `{eventId, aggregateType, aggregateId, occurredAt, ...payload}` seperti gateway lama.
  Rute ini dikecualikan dari gzip dan timeout 60 s.
- Relay outbox berjalan di API (`OUTBOX_RELAY_ENABLED`, default aktif); subscriber-nya hub SSE proses API. `fv worker`
  hanya menjalankan job queue — relay tanpa subscriber akan menandai baris PUBLISHED tanpa ada klien yang menerimanya.
- `GET /capacity-plans/assess`: `demandQuantity` dibulatkan ke bilangan bulat (Node meneruskan pecahan apa adanya).
- Dokumen order: base64 yang tidak valid → 422 `INVALID_FORMAT` (Node: `Buffer.from` memotong diam-diam, hanya hasil kosong yang ditolak).
- `maintenance/kpi`, `quality/dashboard`, `workforce/availability`: `from`/`effectiveFrom` default dicap dari jam
  permintaan (selisih milidetik antar-proses); bidang lain identik.
- Audit §39 pada modul v2 (kualifikasi, penugasan, WIP, dispatch board, konsumsi, inspeksi, maintenance) ditulis
  *sebelum* respons, seperti `await audit.record` di Node — bukan detached.
- Progres onboarding, guidance dan event funnel disimpan di tabel (migrasi 035); Node menyimpannya di memori (hilang saat
  restart). Sesi konsol internal juga persisten (`internal_session`, token di-hash SHA-256) — Node memakai `Map`.
- `/api/internal/v1`: kolom DATE (`startedAt`, `renewsAt`, `endedAt`, `capturedOn`) dikembalikan apa adanya; Node membaca DATE
  sebagai `Date` tengah malam lokal lalu `toISOString()`, sehingga di Asia/Jakarta mundur satu hari (dan `daysToRenewal`
  ikut bergeser). `client_usage_snapshot` dihitung lewat SQL per tenant, bukan dari cache memori.
- `POST /onboarding/events` tanpa `eventName` → 422 ber-envelope (Node: 400 `{error: string}` tanpa envelope).
- `analytics/executive-kpi` dan `analytics/alerts`: status/ambang diturunkan dari `kpi_target` di DB (seed
  `110/130` untuk REJECT_RATE dan DOWNTIME); Node memakai baris demo in-memory (`95/85`, DOWNTIME 400) dan mengabaikan
  tabelnya. Angka lainnya identik.
