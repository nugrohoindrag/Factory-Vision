// Package config reads the process environment into one typed value.
//
// The variable names are the ones the Node API used, so the compose files,
// the CI workflow and the QA scripts keep working unchanged: an operator who
// knows how to configure the old container knows how to configure this one.
package config

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

// PilotTenant is the tenant every install starts with. Migrations and the
// demo seed assume it exists; `ensureTenant` writes it on every boot.
const PilotTenant = "tenant-pilot-factory-01"

// Config is the whole runtime configuration, validated once at startup.
type Config struct {
	Env              string // NODE_ENV: "production" or anything else
	Port             int
	AdminAddr        string // metrics + pprof listener; never published
	DatabaseURL      string
	OwnerDatabaseURL string // only tests and `fv migrate` use it
	PoolMax          int32
	PoolMin          int32
	SlowQuery        time.Duration
	Location         *time.Location // TZ, the plant's clock for shift_date

	AuthRequired   bool
	DeploymentMode string // ON_PREMISE_SINGLE_TENANT | CLOUD_MULTI_TENANT
	DefaultTenant  string
	CORSOrigins    []string // explicit allowlist; empty means "by environment"
	APIDocsPublic  bool

	BootstrapAdminEmail    string
	BootstrapAdminPassword string
	BootstrapAdminName     string
	BootstrapOperatorPIN   string
	InternalAdminEmail     string
	InternalAdminPassword  string
	InternalAdminName      string

	MFAEncryptionKey  string
	MFARequiredRoles  []string
	PasswordMinLength int
	PINMinLength      int

	SecurityAlertWebhook string
	LargeExportRows      int
	WipAgingHours        float64
	WipCriticalHours     float64

	SeedDemoData bool

	ObjectStorageDriver    string
	DocumentStorageDir     string
	ObjectStorageEndpoint  string
	ObjectStorageBucket    string
	ObjectStorageRegion    string
	ObjectStorageAccessKey string
	ObjectStorageSecretKey string
	// Path-style addressing; required by MinIO, harmless on AWS.
	ObjectStorageForcePathStyle bool
	// WorkingDir is where the filesystem store defaults to var/documents.
	WorkingDir string

	APIRunJobRunner     bool
	PlanningJobInterval time.Duration
	OutboxRelayEnabled  bool
	OutboxRelayInterval time.Duration

	OTLPEndpoint   string
	ProductVersion string
}

// Load reads `.env` files the way the Node API did — the app's own first,
// then the repository root — never overriding a variable the process already
// has, so docker compose stays authoritative.
func Load() (*Config, error) {
	loadDotenv()
	c := &Config{}

	c.Env = get("NODE_ENV", "development")
	c.Port = getInt("PORT", 4000)
	c.AdminAddr = get("ADMIN_ADDR", "127.0.0.1:4100")
	c.DatabaseURL = get("DATABASE_URL", "")
	c.OwnerDatabaseURL = get("OWNER_DATABASE_URL", "")
	c.PoolMax = int32(getInt("DATABASE_POOL_MAX", 10))
	c.PoolMin = int32(getInt("DATABASE_POOL_MIN", 2))
	c.SlowQuery = time.Duration(getInt("SLOW_QUERY_MS", 250)) * time.Millisecond

	tz := get("TZ", "")
	if tz == "" {
		if c.IsProduction() {
			return nil, errors.New("TZ is not set. shift_date is derived from the plant's local clock, so the API refuses to guess in production; set TZ=Asia/Jakarta (or the plant's zone)")
		}
		tz = "Asia/Jakarta"
	}
	loc, err := time.LoadLocation(tz)
	if err != nil {
		return nil, fmt.Errorf("TZ=%q is not a valid IANA zone: %w", tz, err)
	}
	c.Location = loc

	// Authentication is on by default and the demo switch is refused in
	// production: a flag that can be set by one line in a .env is a way to
	// publish a factory's data by accident, and the accident is silent.
	authDisabledRequested := get("AUTH_REQUIRED", "") == "false"
	c.AuthRequired = !authDisabledRequested || c.IsProduction()

	c.DeploymentMode = "CLOUD_MULTI_TENANT"
	if get("DEPLOYMENT_MODE", "") == "ON_PREMISE_SINGLE_TENANT" {
		c.DeploymentMode = "ON_PREMISE_SINGLE_TENANT"
	}
	c.DefaultTenant = get("DEFAULT_TENANT_ID", PilotTenant)
	c.CORSOrigins = splitList(get("CORS_ALLOWED_ORIGINS", ""), func(s string) string {
		return strings.TrimSuffix(s, "/")
	})
	c.APIDocsPublic = truthy(get("API_DOCS_PUBLIC", ""))

	c.BootstrapAdminEmail = strings.TrimSpace(get("BOOTSTRAP_ADMIN_EMAIL", ""))
	c.BootstrapAdminPassword = get("BOOTSTRAP_ADMIN_PASSWORD", "")
	c.BootstrapAdminName = strings.TrimSpace(get("BOOTSTRAP_ADMIN_NAME", ""))
	if c.BootstrapAdminName == "" {
		c.BootstrapAdminName = "Administrator"
	}
	c.BootstrapOperatorPIN = get("BOOTSTRAP_OPERATOR_PIN", "")
	c.InternalAdminEmail = strings.TrimSpace(get("INTERNAL_ADMIN_EMAIL", ""))
	c.InternalAdminPassword = get("INTERNAL_ADMIN_PASSWORD", "")
	c.InternalAdminName = get("INTERNAL_ADMIN_NAME", "Internal Administrator")

	c.MFAEncryptionKey = get("MFA_ENCRYPTION_KEY", "")
	c.MFARequiredRoles = splitList(get("MFA_REQUIRED_ROLES", "ADMIN"), strings.ToUpper)
	c.PasswordMinLength = getInt("PASSWORD_MIN_LENGTH", 12)
	c.PINMinLength = getInt("PIN_MIN_LENGTH", 6)

	c.SecurityAlertWebhook = strings.TrimSpace(get("SECURITY_ALERT_WEBHOOK", ""))
	c.LargeExportRows = getInt("LARGE_EXPORT_ROWS", 5000)
	c.WipAgingHours = getFloat("WIP_AGING_HOURS", 24)
	c.WipCriticalHours = getFloat("WIP_CRITICAL_HOURS", 72)
	c.SeedDemoData = truthy(get("SEED_DEMO_DATA", ""))

	c.ObjectStorageDriver = get("OBJECT_STORAGE_DRIVER", "filesystem")
	c.DocumentStorageDir = get("DOCUMENT_STORAGE_DIR", "")
	c.ObjectStorageEndpoint = get("OBJECT_STORAGE_ENDPOINT", "")
	c.ObjectStorageBucket = get("OBJECT_STORAGE_BUCKET", "")
	c.ObjectStorageRegion = get("OBJECT_STORAGE_REGION", "us-east-1")
	c.ObjectStorageAccessKey = get("OBJECT_STORAGE_ACCESS_KEY", "")
	c.ObjectStorageSecretKey = get("OBJECT_STORAGE_SECRET_KEY", "")
	c.ObjectStorageForcePathStyle = get("OBJECT_STORAGE_FORCE_PATH_STYLE", "") != "false"
	c.WorkingDir, _ = os.Getwd()

	c.APIRunJobRunner = get("API_RUN_JOB_RUNNER", "") != "false"
	c.PlanningJobInterval = time.Duration(getInt("PLANNING_JOB_INTERVAL_MS", 5000)) * time.Millisecond
	c.OutboxRelayEnabled = get("OUTBOX_RELAY_ENABLED", "") != "false"
	c.OutboxRelayInterval = time.Duration(getInt("OUTBOX_RELAY_INTERVAL_MS", 5000)) * time.Millisecond

	c.OTLPEndpoint = get("OTEL_EXPORTER_OTLP_ENDPOINT", "")
	c.ProductVersion = get("PRODUCT_VERSION", "1.5.0")

	if c.DatabaseURL == "" {
		return nil, errors.New("DATABASE_URL is not set. The MES stores production records, downtime and work orders in PostgreSQL; without it nothing the shop floor captures would survive a restart, so the API will not start. See deploy/DEPLOYMENT.md")
	}
	return c, nil
}

// IsProduction reports whether NODE_ENV=production, the value the compose
// file sets and the only one under which the demo switches are refused.
func (c *Config) IsProduction() bool { return c.Env == "production" }

// AuthDisabledRequested is true when someone asked for AUTH_REQUIRED=false,
// whether or not it was honoured; the boot log says which.
func (c *Config) AuthDisabledRequested() bool { return get("AUTH_REQUIRED", "") == "false" }

// AllowedOrigins is the CORS allowlist actually in force: the configured
// list, else the local Vite ports outside production, else nothing.
func (c *Config) AllowedOrigins() []string {
	if len(c.CORSOrigins) > 0 {
		return c.CORSOrigins
	}
	if c.IsProduction() {
		return nil
	}
	return devOrigins
}

var devOrigins = func() []string {
	var out []string
	for _, port := range []int{3000, 3100, 3200, 3300} {
		out = append(out, fmt.Sprintf("http://localhost:%d", port), fmt.Sprintf("http://127.0.0.1:%d", port))
	}
	return out
}()

// DescribeCORS is what the boot log and the security summary print.
func (c *Config) DescribeCORS() string {
	origins := c.AllowedOrigins()
	if len(origins) > 0 {
		return strings.Join(origins, ", ")
	}
	if c.IsProduction() {
		return "same-origin only"
	}
	return "development defaults"
}

func loadDotenv() {
	// From `cmd/fv` in development the repository root is four levels above
	// the executable's working directory only by convention, so both the
	// current directory and the parents up to the root `.env` are tried.
	_ = godotenv.Load() // ./.env, never overriding
	dir, err := os.Getwd()
	if err != nil {
		return
	}
	for range 5 {
		dir = filepath.Dir(dir)
		candidate := filepath.Join(dir, ".env")
		if _, err := os.Stat(candidate); err == nil {
			_ = godotenv.Load(candidate)
			return
		}
	}
}

func get(name, fallback string) string {
	if v, ok := os.LookupEnv(name); ok && v != "" {
		return v
	}
	return fallback
}

func getInt(name string, fallback int) int {
	v := get(name, "")
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(strings.TrimSpace(v))
	if err != nil {
		return fallback
	}
	return n
}

func getFloat(name string, fallback float64) float64 {
	v := get(name, "")
	if v == "" {
		return fallback
	}
	f, err := strconv.ParseFloat(strings.TrimSpace(v), 64)
	if err != nil {
		return fallback
	}
	return f
}

var truthyPattern = regexp.MustCompile(`(?i)^(1|true|yes)$`)

func truthy(v string) bool { return truthyPattern.MatchString(v) }

func splitList(v string, normalise func(string) string) []string {
	var out []string
	for _, part := range strings.Split(v, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		out = append(out, normalise(part))
	}
	return out
}
