// Command fv is the Factory Vision MES API.
//
//	fv serve        run the HTTP API (the default)
//	fv worker       run the planning job queue and the outbox relay alone
//	fv healthcheck  probe a running API, for the container HEALTHCHECK
//
// One binary serves both deployment modes (US-052 cloud, US-053 on-premise).
// The difference is configuration, not code: PRD §31 requires the domain
// model and business behaviour to be identical, so an on-premise install
// must not run a different build.
package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	_ "time/tzdata" // the plant's zone must resolve inside a distroless image

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api/internal/modules/alerts"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/modules/analytics"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/modules/audit"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/modules/board"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/modules/clientmgmt"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/modules/correction"
	csvmod "github.com/nugrohoindrag/factory-vision/apps/api/internal/modules/csv"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/modules/event"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/modules/execution"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/modules/identity"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/modules/improvement"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/modules/maintenance"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/modules/masterdata"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/modules/material"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/modules/mold"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/modules/oee"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/modules/onboarding"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/modules/planning"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/modules/production"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/modules/quality"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/modules/roles"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/modules/shift"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/modules/shopfloor"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/modules/stream"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/modules/wip"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/modules/workforce"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/async"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/auth"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/bootstrap"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/config"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/db"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/httpx"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/migrate"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/observability"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/outbox"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/queue"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/rbac"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/realtime"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/security"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/storage"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/routes"
)

func main() {
	cmd := "serve"
	if len(os.Args) > 1 {
		cmd = os.Args[1]
	}
	var err error
	switch cmd {
	case "serve":
		err = serve()
	case "worker":
		err = worker()
	case "migrate":
		err = migrateCmd()
	case "seed-demo":
		err = seedDemo()
	case "healthcheck":
		err = healthcheck()
	case "probe":
		err = probe(os.Args[2:])
	default:
		err = fmt.Errorf("unknown command %q (serve | worker | migrate | seed-demo | healthcheck | probe)", cmd)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "[fv]", err)
		os.Exit(1)
	}
}

// healthcheck probes /health on the configured port; the image has no curl.
func healthcheck() error {
	port := os.Getenv("PORT")
	if port == "" {
		port = "4000"
	}
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get("http://127.0.0.1:" + port + "/health")
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("health: %s", resp.Status)
	}
	return nil
}

// probe prints the status code of one request to the API in this container,
// for deploy/verify-deployment.sh: the distroless image has neither curl nor
// a shell, and the API's port is not published on the host.
//
//	fv probe /health            GET
//	fv probe /api/v1/x POST     POST with an empty JSON object
//
// A request that fails prints 000, as curl's --write-out would.
func probe(args []string) error {
	if len(args) == 0 {
		return errors.New("usage: fv probe <path> [method]")
	}
	port := os.Getenv("PORT")
	if port == "" {
		port = "4000"
	}
	method := http.MethodGet
	if len(args) > 1 {
		method = strings.ToUpper(args[1])
	}
	var body io.Reader
	if method != http.MethodGet {
		body = strings.NewReader("{}")
	}
	req, err := http.NewRequest(method, "http://127.0.0.1:"+port+args[0], body)
	if err != nil {
		return err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		fmt.Println("000")
		return nil
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
	fmt.Println(resp.StatusCode)
	return nil
}

func serve() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	log := observability.Logger(cfg.IsProduction())
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	if cfg.AuthDisabledRequested() && cfg.IsProduction() {
		log.Error("[security] AUTH_REQUIRED=false is refused in production. Authentication stays on. Use a non-production NODE_ENV for a demo install.")
	}
	bootedAt := db.Now()

	metrics := observability.NewMetrics()
	tracing, err := observability.StartTracing(ctx, cfg.OTLPEndpoint, "factory-vision-api", cfg.ProductVersion)
	if err != nil {
		return fmt.Errorf("tracing: %w", err)
	}

	// PostgreSQL must be reachable and migrated before anything is served:
	// the shop floor's records live there, not in this process.
	pool, err := db.Open(ctx, cfg.DatabaseURL, db.Options{
		MaxConns: cfg.PoolMax, MinConns: cfg.PoolMin, SlowQuery: cfg.SlowQuery, Observer: metrics, Logger: log,
	})
	if err != nil {
		return err
	}
	defer pool.Close()
	if ok, err := pool.TableExists(ctx, "production_record"); err != nil {
		return err
	} else if !ok {
		return errors.New("the production_record table is missing. Run `pnpm db:migrate` before starting the API")
	}
	role, err := pool.CheckRole(ctx)
	if err != nil {
		return err
	}
	if role.Bypassed() {
		log.Error("[db] SECURITY: connected as a role that bypasses row-level security; tenant isolation policies do NOT apply to this connection. Point DATABASE_URL at the factory_app role.",
			"role", role.Name, "superuser", role.Superuser, "bypassrls", role.BypassRLS)
	} else {
		log.Info("[db] connected", "role", role.Name)
	}

	events := security.NewEvents(cfg.SecurityAlertWebhook, log)
	events.Observe(metrics.SecurityEvent)
	httpx.Configure(log, events)
	detached := async.NewRunner(64, 15*time.Second, log)

	auditSvc := audit.NewService(pool, detached, events)
	eventSvc := event.NewService(pool, detached)
	master, err := masterdata.NewService(pool)
	if err != nil {
		return err
	}
	roleSvc, err := roles.NewService(pool, master)
	if err != nil {
		return err
	}
	sessions := identity.NewSessionRepository(pool)
	resolver, err := auth.NewResolver(sessions, identity.SubjectSource{Master: master}, roleSvc, detached, log)
	if err != nil {
		return err
	}
	defer resolver.Close()
	mfa := identity.NewMFA(pool, security.NewSecretBox(cfg.MFAEncryptionKey), cfg.MFARequiredRoles)
	identitySvc := identity.NewService(cfg, master, roleSvc, auditSvc, sessions, resolver, mfa, events, log)
	masterHandler := masterdata.NewHandler(master, auditSvc, identitySvc, events)
	csvSvc := csvmod.NewService(master)

	// The execution core (M2): production and the shop floor share one
	// outbox and one change hook, so a read model built over their records
	// is refreshed whichever of them wrote.
	ob := outbox.Repository{}
	productionSvc := production.NewService(pool, ob, detached, log)
	shopfloorSvc := shopfloor.NewService(pool, productionSvc, master, ob, cfg.Location, log)
	productionHandler := production.NewHandler(productionSvc, master, auditSvc)
	productionHandler.AttachDowntime(shopfloorSvc)
	correctionSvc := correction.NewService(pool, productionSvc, auditSvc)
	readModel, err := execution.New(productionSvc, shopfloorSvc)
	if err != nil {
		return err
	}
	oeeSvc, err := oee.NewService(pool, master, productionSvc, readModel)
	if err != nil {
		return err
	}
	correctionSvc.AttachOee(oeeSvc)
	analyticsSvc, err := analytics.NewService(master, productionSvc, readModel)
	if err != nil {
		return err
	}
	handoverSvc := shift.NewHandoverService(pool, master, productionSvc, shopfloorSvc)

	// The MES Improvement modules (M4). Each writes its own tables and the
	// operational_event timeline; the board and the alert feed are
	// projections over them, and the sync batch reaches them through the
	// offline adapter so a replayed terminal queue applies exactly once.
	materialSvc := material.NewService(pool, master, productionSvc, eventSvc)
	qualitySvc := quality.NewService(pool, productionSvc, eventSvc)
	maintenanceSvc := maintenance.NewService(pool, master, shopfloorSvc, eventSvc, log)
	workforceSvc := workforce.NewService(pool, master, productionSvc, eventSvc)
	wipSvc := wip.NewService(pool, master, productionSvc, qualitySvc, eventSvc, cfg.WipAgingHours, cfg.WipCriticalHours)
	boardSvc := board.NewService(master, productionSvc, maintenanceSvc, materialSvc, workforceSvc, eventSvc, cfg.Location)
	shopfloorSvc.AttachImprovement(improvement.NewOffline(materialSvc, qualitySvc, wipSvc))
	analyticsSvc.AttachExtraAlerts(alerts.NewImprovement(materialSvc, qualitySvc, maintenanceSvc, workforceSvc, wipSvc))

	// Planning and the async layer (M5). Planning publishes, it never calls
	// execution; production reaches planning through the facade seams it
	// declared in M2. Documents go to the object store, forecasts and
	// recalculations to the job queue, and every outbox row to the SSE hub
	// through the relay.
	store, err := storage.FromOptions(storage.Options{Driver: cfg.ObjectStorageDriver, DocumentDir: cfg.DocumentStorageDir, Bucket: cfg.ObjectStorageBucket, Region: cfg.ObjectStorageRegion,
		Endpoint: cfg.ObjectStorageEndpoint, AccessKey: cfg.ObjectStorageAccessKey, SecretKey: cfg.ObjectStorageSecretKey, ForcePathStyle: cfg.ObjectStorageForcePathStyle,
		ForcePathStyleSet: true, WorkingDirFallback: cfg.WorkingDir, Logger: log})
	if err != nil {
		return err
	}
	if ok, detail := store.Check(ctx); ok {
		log.Info("[storage] " + detail)
	} else {
		log.Error("[storage] " + detail)
	}
	jobQueue := queue.New(pool)
	planningSvc := planning.NewService(pool, auditSvc, ob, jobQueue, store)
	productionSvc.AttachPlanning(planningSvc)
	productionHandler.AttachDemand(planningSvc)
	materialSvc.AttachDemand(materialDemand{planningSvc})
	generator := production.NewGenerator(productionSvc, auditSvc)
	moldSvc := mold.NewService(pool)
	// The API runs the queue too unless API_RUN_JOB_RUNNER=false hands it to
	// `fv worker`; SKIP LOCKED makes either arrangement correct.
	var runner *queue.Runner
	if cfg.APIRunJobRunner {
		runner = queue.NewRunner(jobQueue, planningSvc.JobHandlers(), "api-job-runner", log)
		runner.Start(ctx, cfg.PlanningJobInterval)
		defer runner.Stop()
	}
	// Onboarding and the vendor console (M6). Trial registration writes the
	// tenant, its client account, the trial subscription and the
	// administrator in one transaction; the vendor API lives under
	// /api/internal/v1 with its own staff, sessions and audit trail.
	policy := security.NewPolicy(cfg.PasswordMinLength)
	onboardingSvc, err := onboarding.NewService(pool, master, productionSvc, identitySvc, policy)
	if err != nil {
		return err
	}
	internalSvc := clientmgmt.NewService(pool, events, policy, log)
	hub := realtime.New()
	relay := outbox.NewRelay(pool, log)
	relay.Subscribe(stream.Subscriber(hub))
	if cfg.OutboxRelayEnabled {
		relay.Start(ctx, cfg.OutboxRelayInterval)
		defer relay.Stop()
		log.Info("[outbox] relay aktif.")
	}

	// Every install starts with the pilot tenant row and the bootstrap
	// administrator; the trial tenants come later.
	if err := ensureTenant(ctx, pool, cfg); err != nil {
		return err
	}
	// SEED_DEMO_DATA=true is the sales or pilot install: the demo tyre plant
	// and sixty days of shop-floor history, idempotent, so every boot may run
	// it. A real factory starts empty.
	if cfg.SeedDemoData {
		if err := runDemoSeed(ctx, log, bootstrap.DemoServices{Pool: pool, Master: master, Production: productionSvc, ShopFloor: shopfloorSvc}); err != nil {
			return err
		}
	}
	if _, err := roleSvc.Roles(ctx, config.PilotTenant); err != nil {
		return fmt.Errorf("roles: %w", err)
	}
	if err := identitySvc.BootstrapAdminCredential(ctx); err != nil {
		return fmt.Errorf("bootstrap admin: %w", err)
	}
	if err := internalSvc.Bootstrap(ctx, cfg.InternalAdminEmail, cfg.InternalAdminPassword, cfg.InternalAdminName); err != nil {
		return fmt.Errorf("bootstrap internal admin: %w", err)
	}
	identitySvc.StartSessionSweeper(ctx, 15*time.Minute)

	handler := routes.Handler(routes.Deps{
		Config: cfg, Log: log, Metrics: metrics, Tracing: tracing, Resolver: resolver, Table: rbac.Default,
		Events: events, BootedAt: bootedAt, EventService: eventSvc, AuditService: auditSvc,
		MFAAvailable: mfa.Available(), MFARequiredRoles: mfa.RequiredRoles(),
		Mount: []func(chi.Router){
			func(r chi.Router) { identity.Mount(r, identitySvc, master) },
			func(r chi.Router) { roles.Mount(r, roleSvc, auditSvc, events) },
			masterHandler.Mount,
			func(r chi.Router) { shift.Mount(r, master, auditSvc) },
			func(r chi.Router) { shift.MountHandover(r, handoverSvc, master, auditSvc) },
			func(r chi.Router) { csvmod.Mount(r, csvSvc, auditSvc, events, cfg.LargeExportRows) },
			productionHandler.Mount,
			func(r chi.Router) { shopfloor.Mount(r, shopfloorSvc, auditSvc) },
			func(r chi.Router) { correction.Mount(r, correctionSvc) },
			func(r chi.Router) { oee.Mount(r, oeeSvc, auditSvc) },
			func(r chi.Router) { analytics.Mount(r, analyticsSvc, shopfloorSvc) },
			func(r chi.Router) { material.Mount(r, materialSvc, auditSvc) },
			func(r chi.Router) { quality.Mount(r, qualitySvc, auditSvc) },
			func(r chi.Router) { maintenance.Mount(r, maintenanceSvc, auditSvc) },
			func(r chi.Router) { workforce.Mount(r, workforceSvc, auditSvc) },
			func(r chi.Router) { wip.Mount(r, wipSvc, auditSvc) },
			func(r chi.Router) { board.Mount(r, boardSvc, auditSvc) },
			func(r chi.Router) { planning.Mount(r, planningSvc, runner, generatorAdapter{generator}) },
			func(r chi.Router) { mold.Mount(r, moldSvc, auditSvc) },
			func(r chi.Router) { stream.Mount(r, hub) },
			func(r chi.Router) { onboarding.Mount(r, onboardingSvc) },
		},
		Root: []func(chi.Router){
			func(r chi.Router) { clientmgmt.Mount(r, internalSvc) },
			func(r chi.Router) { clientmgmt.MountSite(r, internalSvc) },
		},
	})

	admin := observability.AdminServer(cfg.AdminAddr, metrics, func() bool { return pool.Ping(ctx) == nil })
	go func() {
		if err := admin.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Warn("admin listener failed", "addr", cfg.AdminAddr, "error", err)
		}
	}()

	server := httpx.NewServer(fmt.Sprintf(":%d", cfg.Port), handler, log)
	log.Info("[Factory Vision API] listening",
		"port", cfg.Port, "admin", cfg.AdminAddr, "auth", cfg.AuthRequired, "cors", cfg.DescribeCORS(), "tz", cfg.Location.String())

	err = server.Start(ctx, 15*time.Second)

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = admin.Shutdown(shutdownCtx)
	detached.Drain(10 * time.Second)
	if tracing != nil {
		_ = tracing.Shutdown(shutdownCtx)
	}
	return err
}

// runDemoSeed writes the demo plant and its history, logging what changed
// the way the Node boot did.
func runDemoSeed(ctx context.Context, log *slog.Logger, svc bootstrap.DemoServices) error {
	plant, err := bootstrap.SeedDemoPlant(ctx, config.PilotTenant, svc)
	if err != nil {
		return fmt.Errorf("seed demo plant: %w", err)
	}
	log.Info(fmt.Sprintf("[seed] demo plant: %d lines, %d products, %d production orders, 0 work orders", plant.Lines, plant.Products, plant.ProductionOrders))
	history, err := bootstrap.SeedDemoHistory(ctx, config.PilotTenant, svc)
	if err != nil {
		return fmt.Errorf("seed demo history: %w", err)
	}
	log.Info(fmt.Sprintf("[seed] shop-floor history: %d production, %d downtime records across processes", history.ProductionCount, history.DowntimeCount))
	return nil
}

// seedDemo is the boot-time demo seed as a command, for an install that
// wants the demo plant written once under supervision rather than on every
// boot: `fv seed-demo` against the application role.
func seedDemo() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	log := observability.Logger(cfg.IsProduction())
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	pool, err := db.Open(ctx, cfg.DatabaseURL, db.Options{MaxConns: cfg.PoolMax, MinConns: cfg.PoolMin, SlowQuery: cfg.SlowQuery, Logger: log})
	if err != nil {
		return err
	}
	defer pool.Close()
	if ok, err := pool.TableExists(ctx, "production_record"); err != nil {
		return err
	} else if !ok {
		return errors.New("the production_record table is missing. Run `fv migrate` before seeding")
	}
	detached := async.NewRunner(8, 15*time.Second, log)
	master, err := masterdata.NewService(pool)
	if err != nil {
		return err
	}
	ob := outbox.Repository{}
	productionSvc := production.NewService(pool, ob, detached, log)
	shopfloorSvc := shopfloor.NewService(pool, productionSvc, master, ob, cfg.Location, log)
	if err := ensureTenant(ctx, pool, cfg); err != nil {
		return err
	}
	err = runDemoSeed(ctx, log, bootstrap.DemoServices{Pool: pool, Master: master, Production: productionSvc, ShopFloor: shopfloorSvc})
	detached.Drain(10 * time.Second)
	return err
}

// migrateCmd applies db/migrations (and db/seeds when SEED_DEMO_DATA is on)
// as the schema owner, then gives the application role its login. It reads
// the environment the Node runner read, so the compose `migrate` service is
// unchanged apart from the command.
func migrateCmd() error {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	url := os.Getenv("MIGRATE_DATABASE_URL")
	if url == "" {
		url = os.Getenv("DATABASE_URL")
	}
	root := os.Getenv("MIGRATIONS_DIR")
	if root == "" {
		root = filepath.Join(mustGetwd(), "db")
	}
	_, err := migrate.Run(ctx, migrate.Options{
		DatabaseURL: url, Root: root, AppRole: os.Getenv("APP_DB_USER"), AppPassword: os.Getenv("APP_DB_PASSWORD"),
		SeedDemoData: config.Truthy(os.Getenv("SEED_DEMO_DATA")), Out: os.Stdout,
	})
	if err != nil {
		return fmt.Errorf("migrate failed: %w", err)
	}
	return nil
}

func mustGetwd() string {
	wd, err := os.Getwd()
	if err != nil {
		return "."
	}
	return wd
}

// worker runs the planning job queue without serving HTTP. `FOR UPDATE SKIP LOCKED` lets any number of these share the queue
// with the API's optional in-process runner.
func worker() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	if cfg.DatabaseURL == "" {
		return errors.New("DATABASE_URL belum diset. Worker tidak dapat memproses job queue")
	}
	log := observability.Logger(cfg.IsProduction())
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	pool, err := db.Open(ctx, cfg.DatabaseURL, db.Options{MaxConns: cfg.PoolMax, MinConns: cfg.PoolMin, SlowQuery: cfg.SlowQuery, Logger: log})
	if err != nil {
		return err
	}
	defer pool.Close()
	store, err := storage.FromOptions(storage.Options{Driver: cfg.ObjectStorageDriver, DocumentDir: cfg.DocumentStorageDir, Bucket: cfg.ObjectStorageBucket, Region: cfg.ObjectStorageRegion,
		Endpoint: cfg.ObjectStorageEndpoint, AccessKey: cfg.ObjectStorageAccessKey, SecretKey: cfg.ObjectStorageSecretKey, ForcePathStyle: cfg.ObjectStorageForcePathStyle,
		ForcePathStyleSet: true, WorkingDirFallback: cfg.WorkingDir, Logger: log})
	if err != nil {
		return err
	}
	detached := async.NewRunner(16, 15*time.Second, log)
	events := security.NewEvents(cfg.SecurityAlertWebhook, log)
	auditSvc := audit.NewService(pool, detached, events)
	planningSvc := planning.NewService(pool, auditSvc, outbox.Repository{}, queue.New(pool), store)
	runner := queue.NewRunner(queue.New(pool), planningSvc.JobHandlers(), "worker", log)
	runner.Start(ctx, cfg.PlanningJobInterval)
	// The outbox relay is not started here: its only subscriber is the SSE
	// hub, which lives in the API process. A relay with no subscriber would
	// mark rows published that no client ever received.
	log.Info("[worker] aktif", "interval", cfg.PlanningJobInterval.String())
	<-ctx.Done()
	log.Info("[worker] sinyal diterima, menghentikan runner.")
	runner.Stop()
	detached.Drain(10 * time.Second)
	return nil
}

// generatorAdapter presents production's Work Order generator through the
// interface planning declares, so planning never imports production.
type generatorAdapter struct{ g *production.Generator }

func (a generatorAdapter) GenerateForPlan(ctx context.Context, tenantID, planID, actorID string) (planning.GenerateResult, error) {
	res, err := a.g.GenerateForPlan(ctx, tenantID, planID, actorID)
	if err != nil {
		return planning.GenerateResult{}, err
	}
	out := planning.GenerateResult{ProductionPlanID: res.ProductionPlanID, Created: make([]any, len(res.Created)), Existing: make([]any, len(res.Existing)), SkippedPlanLineIDs: res.SkippedPlanLineIDs}
	for i, w := range res.Created {
		out.Created[i] = w
	}
	for i, w := range res.Existing {
		out.Existing[i] = w
	}
	return out, nil
}

// materialDemand presents planning's demand lines in material's terms.
type materialDemand struct{ p *planning.Service }

func (m materialDemand) PlanDemandLines(ctx context.Context, tenantID string, planIDs []string, horizonStart, horizonEnd string) ([]material.DemandLine, error) {
	lines, err := m.p.PlanDemandLines(ctx, tenantID, planIDs, horizonStart, horizonEnd)
	if err != nil {
		return nil, err
	}
	out := make([]material.DemandLine, len(lines))
	for i, l := range lines {
		out[i] = material.DemandLine{ProductionPlanID: l.ProductionPlanID, PlanNumber: l.PlanNumber, ProductID: l.ProductID, PlannedQuantity: float64(l.PlannedQuantity), RequiredDate: l.RequiredDate}
	}
	return out, nil
}

// ensureTenant makes sure the tenant row exists. Every table has a foreign
// key to tenant, so nothing can be written before this row does.
func ensureTenant(ctx context.Context, pool *db.Pool, cfg *config.Config) error {
	tenantID := config.PilotTenant
	return pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx,
			`INSERT INTO tenant (id, name, timezone, plan, status) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
			tenantID, "Factory Vision Tenant", cfg.Location.String(), "MID_MARKET", "ACTIVE")
		return err
	})
}
