// Command fv is the Factory Vision MES API.
//
//	fv serve        run the HTTP API (the default)
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
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
	_ "time/tzdata" // the plant's zone must resolve inside a distroless image

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/analytics"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/audit"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/correction"
	csvmod "github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/csv"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/event"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/execution"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/identity"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/masterdata"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/oee"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/production"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/roles"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/shift"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/shopfloor"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/async"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/auth"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/config"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/db"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/httpx"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/observability"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/outbox"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/rbac"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/security"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/routes"
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
	case "healthcheck":
		err = healthcheck()
	default:
		err = fmt.Errorf("unknown command %q (serve | healthcheck)", cmd)
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

	// Every install starts with the pilot tenant row and the bootstrap
	// administrator; the demo seed and the trial tenants come later.
	if err := ensureTenant(ctx, pool, cfg); err != nil {
		return err
	}
	if _, err := roleSvc.Roles(ctx, config.PilotTenant); err != nil {
		return fmt.Errorf("roles: %w", err)
	}
	if err := identitySvc.BootstrapAdminCredential(ctx); err != nil {
		return fmt.Errorf("bootstrap admin: %w", err)
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
