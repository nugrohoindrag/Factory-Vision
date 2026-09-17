// Package onboarding is the free trial: public registration, the industry
// seed templates, the blank-factory alternative, the readiness/activation
// checklists, the welcome tour and the first production workflow.
//
// Progress and guidance were two maps inside the Node process, so a deploy
// reset every trial; they live in onboarding_progress and
// onboarding_guidance now (migration 035), with the same shape the console
// reads.
package onboarding

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api-go/fixtures"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/identity"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/masterdata"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/production"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/db"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/httpx"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/jsnum"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/security"
)

// StepState is the TypeScript OnboardingStepState.
type StepState struct {
	ID          string  `json:"id"`
	Title       string  `json:"title"`
	Description string  `json:"description"`
	Status      string  `json:"status"`
	CompletedAt *string `json:"completedAt,omitempty"`
	Optional    *bool   `json:"optional,omitempty"`
}

// ChecklistItem is one thing a bar needs before it reaches 100%.
type ChecklistItem struct {
	ID     string `json:"id"`
	Label  string `json:"label"`
	Weight int    `json:"weight"`
	Done   bool   `json:"done"`
	Path   string `json:"path,omitempty"`
	Hint   string `json:"hint,omitempty"`
}

// FactoryProfile is the TypeScript FactoryProfileInput.
type FactoryProfile struct {
	FactoryName     string  `json:"factoryName"`
	Industry        string  `json:"industry"`
	Country         string  `json:"country"`
	City            *string `json:"city,omitempty"`
	Timezone        string  `json:"timezone"`
	WorkingCalendar string  `json:"workingCalendar"`
}

// Progress is the TypeScript OnboardingProgress.
type Progress struct {
	TenantID          string               `json:"tenantId"`
	UserID            string               `json:"userId"`
	TrialStatus       string               `json:"trialStatus"`
	TrialStart        string               `json:"trialStart"`
	TrialEnd          string               `json:"trialEnd"`
	DaysRemaining     int                  `json:"daysRemaining"`
	ReadinessPercent  int                  `json:"readinessPercent"`
	ActivationPercent int                  `json:"activationPercent"`
	ReadinessItems    []ChecklistItem      `json:"readinessItems,omitempty"`
	ActivationItems   []ChecklistItem      `json:"activationItems,omitempty"`
	ExperienceType    *string              `json:"experienceType,omitempty"`
	TemplateApplied   *string              `json:"templateApplied,omitempty"`
	FactoryProfile    *FactoryProfile      `json:"factoryProfile,omitempty"`
	Steps             map[string]StepState `json:"steps"`
	UpdatedAt         string               `json:"updatedAt"`
}

// Guidance is the TypeScript GuidanceState.
type Guidance struct {
	TourCompleted     bool     `json:"tourCompleted"`
	TourSkipped       bool     `json:"tourSkipped"`
	DismissedTooltips []string `json:"dismissedTooltips"`
	ActiveTourStep    *int     `json:"activeTourStep,omitempty"`
}

// TrialRegistration is the TypeScript TrialRegistrationResponse.
type TrialRegistration struct {
	Token         string `json:"token"`
	TenantID      string `json:"tenantId"`
	UserID        string `json:"userId"`
	Email         string `json:"email"`
	FullName      string `json:"fullName"`
	FactoryName   string `json:"factoryName"`
	Industry      string `json:"industry"`
	TrialStart    string `json:"trialStart"`
	TrialEnd      string `json:"trialEnd"`
	DaysRemaining int    `json:"daysRemaining"`
}

// FirstWorkflowResult is the TypeScript FirstWorkflowResult.
type FirstWorkflowResult struct {
	OrderNumber      string  `json:"orderNumber"`
	WoNumber         string  `json:"woNumber"`
	ProductName      string  `json:"productName"`
	PlannedQuantity  int     `json:"plannedQuantity"`
	ProducedQuantity int     `json:"producedQuantity"`
	RejectQuantity   int     `json:"rejectQuantity"`
	AchievementRate  float64 `json:"achievementRate"`
	DefectRate       float64 `json:"defectRate"`
	OccurredAt       string  `json:"occurredAt"`
}

// stepOrder is the wizard's step order; JSON object order follows it.
var stepOrder = []string{"factory_profile", "industry_selection", "template_application", "starter_master_data", "welcome_tour",
	"first_production_order", "first_work_order", "first_production_run", "first_production_result"}

var defaultSteps = map[string]StepState{
	"factory_profile":         {Title: "Profil Pabrik & Kalender", Description: "Konfigurasi nama pabrik, zona waktu, dan kalender shift produksi."},
	"industry_selection":      {Title: "Pilih Karakteristik Industri", Description: "Pilih industri manufaktur spesifik untuk menentukan alur kerja relevan."},
	"template_application":    {Title: "Terapkan Industry Seed Template", Description: "Clone master data starter industri (produk, mesin, proses, routing)."},
	"starter_master_data":     {Title: "Review Master Data Starter", Description: "Pastikan produk, mesin, dan work center siap digunakan."},
	"welcome_tour":            {Title: "Welcome Tour MES", Description: "Pelajari 5 pilar navigasi konsol dan terminal shop floor."},
	"first_production_order":  {Title: "Buat Production Order Pertama", Description: "Buat rencana pesanan produksi perdana dengan jumlah target."},
	"first_work_order":        {Title: "Rilis Work Order", Description: "Bagi rencana pesanan ke stasiun mesin dan work center di lantai pabrik."},
	"first_production_run":    {Title: "Catat Hasil Produksi Shop Floor", Description: "Catat jumlah good unit dan reject unit pertama secara real-time."},
	"first_production_result": {Title: "Evaluasi KPI Produksi & OEE", Description: "Lihat pencapaian target, reject rate, dan dampak langsung pada dashboard."},
}

func freshSteps() map[string]StepState {
	steps := make(map[string]StepState, len(stepOrder))
	for _, id := range stepOrder {
		s := defaultSteps[id]
		s.ID, s.Status = id, "not_started"
		steps[id] = s
	}
	return steps
}

var nonAlnum = regexp.MustCompile(`[^a-z0-9]+`)

func slug(text string) string {
	return strings.Trim(nonAlnum.ReplaceAllString(strings.ToLower(text), "-"), "-")
}

func short(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

const trialDays = 14

// Service is the onboarding module.
type Service struct {
	pool       *db.Pool
	master     *masterdata.Service
	production *production.Service
	identity   *identity.Service
	policy     security.Policy
	templates  fixtures.IndustryTemplates
	now        func() time.Time
}

// NewService wires the module.
func NewService(pool *db.Pool, master *masterdata.Service, prod *production.Service, id *identity.Service, policy security.Policy) (*Service, error) {
	templates, err := fixtures.LoadIndustryTemplates()
	if err != nil {
		return nil, err
	}
	return &Service{pool: pool, master: master, production: prod, identity: id, policy: policy, templates: templates, now: time.Now}, nil
}

// --- Persistence -------------------------------------------------------------

func (s *Service) loadProgress(ctx context.Context, tx pgx.Tx, tenantID string) (*Progress, error) {
	var p Progress
	var trialStart, trialEnd, updated time.Time
	var profile, steps []byte
	err := tx.QueryRow(ctx, `SELECT user_id, trial_status, trial_start, trial_end, experience_type, template_applied, factory_profile, steps, updated_at
		FROM onboarding_progress WHERE tenant_id = $1`, tenantID).Scan(&p.UserID, &p.TrialStatus, &trialStart, &trialEnd, &p.ExperienceType, &p.TemplateApplied, &profile, &steps, &updated)
	if db.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	p.TenantID, p.TrialStart, p.TrialEnd, p.UpdatedAt = tenantID, db.ISO(trialStart), db.ISO(trialEnd), db.ISO(updated)
	if len(profile) > 0 {
		var fp FactoryProfile
		if json.Unmarshal(profile, &fp) == nil {
			p.FactoryProfile = &fp
		}
	}
	p.Steps = freshSteps()
	if len(steps) > 0 {
		stored := map[string]StepState{}
		if json.Unmarshal(steps, &stored) == nil {
			for id, st := range stored {
				if _, known := p.Steps[id]; known {
					st.ID = id
					p.Steps[id] = st
				}
			}
		}
	}
	return &p, nil
}

func (s *Service) saveProgress(ctx context.Context, tx pgx.Tx, p *Progress) error {
	steps, err := json.Marshal(p.Steps)
	if err != nil {
		return err
	}
	var profile []byte
	if p.FactoryProfile != nil {
		if profile, err = json.Marshal(p.FactoryProfile); err != nil {
			return err
		}
	}
	_, err = tx.Exec(ctx, `INSERT INTO onboarding_progress (tenant_id, user_id, trial_status, trial_start, trial_end, experience_type, template_applied, factory_profile, steps, updated_at)
		VALUES ($1,$2,$3,$4::timestamptz,$5::timestamptz,$6,$7,$8::jsonb,$9::jsonb,$10::timestamptz)
		ON CONFLICT (tenant_id) DO UPDATE SET user_id = EXCLUDED.user_id, trial_status = EXCLUDED.trial_status, trial_start = EXCLUDED.trial_start, trial_end = EXCLUDED.trial_end,
			experience_type = EXCLUDED.experience_type, template_applied = EXCLUDED.template_applied, factory_profile = EXCLUDED.factory_profile, steps = EXCLUDED.steps, updated_at = EXCLUDED.updated_at`,
		p.TenantID, p.UserID, p.TrialStatus, p.TrialStart, p.TrialEnd, p.ExperienceType, p.TemplateApplied, profile, steps, p.UpdatedAt)
	return err
}

// recordEvent appends a funnel event; a failure here never fails the action.
func (s *Service) recordEvent(ctx context.Context, tenantID, eventName string, userID *string, metadata map[string]any) {
	var meta []byte
	if metadata != nil {
		meta, _ = json.Marshal(metadata)
	}
	_ = s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `INSERT INTO onboarding_analytics_event (tenant_id, event_name, user_id, occurred_at, metadata) VALUES ($1,$2,$3,$4::timestamptz,$5::jsonb)`,
			tenantID, eventName, userID, db.ISO(s.now()), meta)
		return err
	})
}

// RecordAnalyticsEvent is POST /onboarding/events.
func (s *Service) RecordAnalyticsEvent(ctx context.Context, tenantID, eventName string, userID *string, metadata map[string]any) {
	s.recordEvent(ctx, tenantID, eventName, userID, metadata)
}

// --- Trial registration --------------------------------------------------------

// TrialInput is the public form.
type TrialInput struct {
	FullName, Email, Password, FactoryName, Industry string
	City, PlantScale                                 *string
}

// RegisterTrial creates the tenant, its client account, the 14-day
// subscription and the administrator in one transaction, then logs the
// administrator in so the console can open immediately.
func (s *Service) RegisterTrial(ctx context.Context, in TrialInput, client identity.ClientContext) (TrialRegistration, error) {
	if strings.TrimSpace(in.FullName) == "" {
		return TrialRegistration{}, httpx.Validation("Nama lengkap wajib diisi.")
	}
	if strings.TrimSpace(in.Email) == "" || !strings.Contains(in.Email, "@") {
		return TrialRegistration{}, httpx.Validation("Email tidak valid.")
	}
	// The public trial form is a password-setting path like any other (§4.1).
	if err := s.policy.AssertPassword(in.Password, "password"); err != nil {
		return TrialRegistration{}, err
	}
	if strings.TrimSpace(in.FactoryName) == "" {
		return TrialRegistration{}, httpx.Validation("Nama pabrik wajib diisi.")
	}
	email := strings.ToLower(strings.TrimSpace(in.Email))
	tenantSlug := short(slug(in.FactoryName), 16)
	if tenantSlug == "" {
		tenantSlug = "factory"
	}
	tenantID := fmt.Sprintf("tenant-%s-%s", tenantSlug, uuid.NewString()[:6])
	userID := "usr-" + uuid.NewString()[:8]
	clientID := "client-" + uuid.NewString()[:8]
	subID := "sub-" + uuid.NewString()[:8]
	now := s.now()
	trialEnd := now.Add(trialDays * 24 * time.Hour)
	city := db.Deref(in.City, "Jakarta")
	var notes *string
	if in.PlantScale != nil && *in.PlantScale != "" {
		// The plant scale has no column of its own: it is a sales qualifier,
		// so it goes in the account notes where an account manager reads it.
		notes = db.Ptr("Skala pabrik (formulir trial): " + *in.PlantScale)
	}
	hash := security.HashSecret(in.Password)
	if err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `INSERT INTO tenant (id, name, timezone, plan, status) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING`, tenantID, in.FactoryName, "Asia/Jakarta", "TRIAL", "ACTIVE"); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO client_account (id, tenant_id, legal_name, display_name, industry, city, contact_name, contact_email, lifecycle_status, deployment_mode, notes, onboarded_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now()) ON CONFLICT (tenant_id) DO NOTHING`,
			clientID, tenantID, in.FactoryName, in.FactoryName, in.Industry, city, in.FullName, email, "TRIAL", "CLOUD_MULTI_TENANT", notes); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO client_subscription (id, client_id, plan_id, status, started_at, renews_at) VALUES ($1,$2,$3,$4,$5::date,$6::date) ON CONFLICT (id) DO NOTHING`,
			subID, clientID, "plan-trial", "ACTIVE", db.ISO(now)[:10], db.ISO(trialEnd)[:10]); err != nil {
			return err
		}
		_, err := masterdata.Repository{}.UpsertUser(ctx, tx, masterdata.User{ID: userID, TenantID: tenantID, Email: email, Name: in.FullName, Role: "ADMIN", AccountType: "APPLICATION_USER",
			ScopeLevel: "TENANT", Status: "ACTIVE", CreatedAt: db.ISO(now)}, &hash)
		if err != nil {
			return err
		}
		steps := freshSteps()
		return s.saveProgress(ctx, tx, &Progress{TenantID: tenantID, UserID: userID, TrialStatus: "active", TrialStart: db.ISO(now), TrialEnd: db.ISO(trialEnd),
			FactoryProfile: &FactoryProfile{FactoryName: in.FactoryName, Industry: in.Industry, Country: "Indonesia", City: &city, Timezone: "Asia/Jakarta", WorkingCalendar: "2 Shift / 5 Hari Kerja"},
			Steps:          steps, UpdatedAt: db.ISO(now)})
	}); err != nil {
		return TrialRegistration{}, err
	}
	s.master.Invalidate(tenantID)

	login, err := s.identity.Login(ctx, tenantID, email, in.Password, client)
	if err != nil {
		return TrialRegistration{}, err
	}
	session, ok := login.(*identity.LoginResponse)
	if !ok {
		// A brand-new trial account cannot already carry a second factor.
		return TrialRegistration{}, httpx.InvalidState("Akun trial baru tidak dapat meminta verifikasi MFA.")
	}
	s.recordEvent(ctx, tenantID, "signup_completed", &userID, map[string]any{"industry": in.Industry, "factoryName": in.FactoryName, "plantScale": in.PlantScale})
	return TrialRegistration{Token: session.Token, TenantID: tenantID, UserID: userID, Email: email, FullName: in.FullName, FactoryName: in.FactoryName, Industry: in.Industry,
		TrialStart: db.ISO(now), TrialEnd: db.ISO(trialEnd), DaysRemaining: trialDays}, nil
}

// --- Templates ---------------------------------------------------------------

// Templates lists the industry seed templates' descriptions.
func (s *Service) Templates() []map[string]any {
	out := make([]map[string]any, 0, len(s.templates.Order))
	for _, key := range s.templates.Order {
		out = append(out, s.templates.ByKey[key].Info)
	}
	return out
}

func (s *Service) template(industry string) fixtures.IndustryTemplate {
	if t, ok := s.templates.ByKey[industry]; ok {
		return t
	}
	return s.templates.ByKey["general"]
}

// ProfileInput is what apply-template and create-blank accept.
type ProfileInput struct {
	FactoryName, City, Timezone        *string
	Industry, Country, WorkingCalendar string
}

// ApplyResult is the response of apply-template and create-blank.
type ApplyResult struct {
	Success  bool     `json:"success"`
	Progress Progress `json:"progress"`
}

// ApplyTemplate clones an industry's starter master data into the tenant
// and marks the first four steps complete.
func (s *Service) ApplyTemplate(ctx context.Context, tenantID, industry string, profile ProfileInput) (ApplyResult, error) {
	tmpl := s.template(industry)
	factoryName := db.Deref(profile.FactoryName, tmpl.DefaultPlantName)
	if factoryName == "" {
		factoryName = tmpl.DefaultPlantName
	}
	plantID := fmt.Sprintf("plant-%s-%s", short(slug(factoryName), 16), uuid.NewString()[:4])
	repo := masterdata.Repository{}
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		if err := repo.UpsertPlant(ctx, tx, masterdata.Plant{ID: plantID, TenantID: tenantID, Name: factoryName, Location: db.Deref(profile.City, "Kawasan Industri, Indonesia"), Timezone: db.Deref(profile.Timezone, "Asia/Jakarta"), Status: "ACTIVE"}); err != nil {
			return err
		}
		lineIDs := make([]string, len(tmpl.Lines))
		for i, l := range tmpl.Lines {
			lineIDs[i] = fmt.Sprintf("line-%s-%s", slug(l.Code), uuid.NewString()[:4])
			if err := repo.UpsertLine(ctx, tx, masterdata.Line{ID: lineIDs[i], TenantID: tenantID, PlantID: plantID, Code: l.Code, Name: l.Name, Status: l.Status, PlannedProductionTimeMinutes: l.PlannedProductionTimeMinutes}); err != nil {
				return err
			}
		}
		pick := func(ids []string, i int) string {
			if i >= 0 && i < len(ids) {
				return ids[i]
			}
			if len(ids) > 0 {
				return ids[0]
			}
			return ""
		}
		wcIDs := make([]string, len(tmpl.WorkCenters))
		for i, wc := range tmpl.WorkCenters {
			wcIDs[i] = fmt.Sprintf("wc-%s-%s", slug(wc.Code), uuid.NewString()[:4])
			if err := repo.UpsertWorkCenter(ctx, tx, masterdata.WorkCenter{ID: wcIDs[i], TenantID: tenantID, ProductionLineID: pick(lineIDs, wc.LineIndex), Code: wc.Code, Name: wc.Name, Sequence: wc.Sequence}); err != nil {
				return err
			}
		}
		procIDs := make([]string, len(tmpl.Processes))
		for i, p := range tmpl.Processes {
			procIDs[i] = fmt.Sprintf("proc-%s-%s", slug(p.Code), uuid.NewString()[:4])
			if err := repo.UpsertProcess(ctx, tx, masterdata.Process{ID: procIDs[i], TenantID: tenantID, Code: p.Code, Name: p.Name, SequenceDefault: p.SequenceDefault, Status: p.Status}); err != nil {
				return err
			}
		}
		machineIDs := make([]string, len(tmpl.Machines))
		for i, m := range tmpl.Machines {
			machineIDs[i] = fmt.Sprintf("mch-%s-%s", slug(m.Code), uuid.NewString()[:4])
			if err := repo.UpsertMachine(ctx, tx, masterdata.Machine{ID: machineIDs[i], TenantID: tenantID, WorkCenterID: pick(wcIDs, m.WorkCenterIndex), Code: m.Code, Name: m.Name, Status: m.Status,
				IdealCycleTimeSeconds: m.IdealCycleTimeSeconds, CurrentState: m.CurrentState, CurrentStateSince: m.CurrentStateSince}); err != nil {
				return err
			}
		}
		productIDs := make([]string, len(tmpl.Products))
		for i, p := range tmpl.Products {
			productIDs[i] = fmt.Sprintf("prod-%s-%s", slug(p.SKU), uuid.NewString()[:4])
			if err := repo.UpsertProduct(ctx, tx, masterdata.Product{ID: productIDs[i], TenantID: tenantID, SKU: p.SKU, Name: p.Name, Unit: p.Unit, IdealCycleTimeSeconds: p.IdealCycleTimeSeconds, Status: p.Status}); err != nil {
				return err
			}
		}
		for _, r := range tmpl.Routings {
			if r.ProductIndex >= len(productIDs) || r.ProcessIndex >= len(procIDs) || r.WorkCenterIndex >= len(wcIDs) || r.MachineIndex >= len(machineIDs) {
				continue
			}
			productID := productIDs[r.ProductIndex]
			cycle := r.StandardCycleTimeSeconds
			if err := repo.UpsertRouting(ctx, tx, masterdata.Routing{ID: fmt.Sprintf("rtg-%s-%d", productID, r.Sequence), TenantID: tenantID, ProductID: productID, ProcessID: procIDs[r.ProcessIndex],
				Sequence: r.Sequence, WorkCenterID: db.Ptr(wcIDs[r.WorkCenterIndex]), MachineID: db.Ptr(machineIDs[r.MachineIndex]), StandardCycleTimeSeconds: &cycle, Active: true}); err != nil {
				return err
			}
		}
		for _, sh := range tmpl.Shifts {
			if _, err := repo.UpsertShift(ctx, tx, masterdata.Shift{ID: fmt.Sprintf("shift-%s-%s", slug(sh.Name), uuid.NewString()[:4]), TenantID: tenantID, PlantID: plantID, Name: sh.Name, StartTime: sh.StartTime,
				EndTime: sh.EndTime, BreakMinutes: sh.BreakMinutes, CrossesMidnight: sh.CrossesMidnight, Active: sh.Active}); err != nil {
				return err
			}
		}
		for _, r := range tmpl.DowntimeReasons {
			if err := repo.UpsertDowntimeReason(ctx, tx, masterdata.DowntimeReason{ID: fmt.Sprintf("dtr-%s-%s", slug(r.Code), uuid.NewString()[:4]), TenantID: tenantID, Category: r.Category, Code: r.Code, Name: r.Name,
				IsPlanned: r.IsPlanned, Active: r.Active, SortOrder: r.SortOrder}); err != nil {
				return err
			}
		}
		for _, r := range tmpl.RejectReasons {
			if err := repo.UpsertRejectReason(ctx, tx, masterdata.RejectReason{ID: fmt.Sprintf("rjr-%s-%s", slug(r.Code), uuid.NewString()[:4]), TenantID: tenantID, Category: r.Category, Code: r.Code, Name: r.Name,
				Active: r.Active, SortOrder: r.SortOrder}); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return ApplyResult{}, err
	}
	s.master.Invalidate(tenantID)

	// Starter BOMs and a sample production order, both non-fatal like Node.
	products, err := s.master.Products(ctx, tenantID)
	if err != nil {
		return ApplyResult{}, err
	}
	for _, b := range tmpl.Boms {
		if len(products) == 0 {
			break
		}
		target := products[0]
		if b.ProductIndex < len(products) {
			target = products[b.ProductIndex]
		}
		components := make([]masterdata.BomComponentInput, 0, len(b.Items))
		for _, it := range b.Items {
			partID := it.ComponentSku
			for _, p := range products {
				if p.SKU == it.ComponentSku {
					partID = p.ID
				}
			}
			scrap := it.ScrapPercentage
			components = append(components, masterdata.BomComponentInput{ComponentPartID: partID, ComponentType: it.ComponentType, Quantity: it.Quantity, UOM: it.Uom, ScrapPercentage: &scrap, Sequence: it.Sequence, Notes: it.Notes})
		}
		_, _ = s.master.CreateBom(ctx, tenantID, masterdata.CreateBomInput{ProductID: target.ID, BomName: b.BomName, Version: db.Ptr(b.Version), Status: db.Ptr(b.Status), Description: b.Description, Components: components}, "system-onboarding")
	}
	if len(products) > 0 {
		_, _ = s.production.CreateProductionOrder(ctx, tenantID, production.CreateProductionOrderInput{OrderNumber: tmpl.SampleOrder.OrderNumberPrefix + "-001", ProductID: products[0].ID,
			Quantity: tmpl.SampleOrder.Quantity, DueDate: db.ISO(s.now().Add(7 * 24 * time.Hour))[:10], CreatedBy: "system-onboarding"})
	}

	progress, err := s.Status(ctx, tenantID, "")
	if err != nil {
		return ApplyResult{}, err
	}
	completed := db.ISO(s.now())
	progress.ExperienceType, progress.TemplateApplied = db.Ptr("template"), db.Ptr(industry)
	for _, id := range []string{"factory_profile", "industry_selection", "template_application", "starter_master_data"} {
		st := progress.Steps[id]
		st.Status, st.CompletedAt = "completed", &completed
		progress.Steps[id] = st
	}
	if err := s.persist(ctx, &progress); err != nil {
		return ApplyResult{}, err
	}
	s.recordEvent(ctx, tenantID, "industry_template_applied", nil, map[string]any{"industry": industry, "productsCount": len(tmpl.Products), "machinesCount": len(tmpl.Machines)})
	return ApplyResult{Success: true, Progress: progress}, nil
}

func (s *Service) persist(ctx context.Context, p *Progress) error {
	return s.pool.WithTenant(ctx, p.TenantID, func(tx pgx.Tx) error { return s.saveProgress(ctx, tx, p) })
}

// CreateBlankFactory sets up one plant and skips the template step.
func (s *Service) CreateBlankFactory(ctx context.Context, tenantID string, profile ProfileInput) (ApplyResult, error) {
	factoryName := db.Deref(profile.FactoryName, "")
	plantID := fmt.Sprintf("plant-%s-%s", short(slug(factoryName), 16), uuid.NewString()[:4])
	if err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		return masterdata.Repository{}.UpsertPlant(ctx, tx, masterdata.Plant{ID: plantID, TenantID: tenantID, Name: factoryName, Location: db.Deref(profile.City, "Indonesia"), Timezone: db.Deref(profile.Timezone, "Asia/Jakarta"), Status: "ACTIVE"})
	}); err != nil {
		return ApplyResult{}, err
	}
	s.master.Invalidate(tenantID)
	progress, err := s.Status(ctx, tenantID, "")
	if err != nil {
		return ApplyResult{}, err
	}
	now := db.ISO(s.now())
	progress.ExperienceType = db.Ptr("blank")
	for _, id := range []string{"factory_profile", "industry_selection"} {
		st := progress.Steps[id]
		st.Status, st.CompletedAt = "completed", &now
		progress.Steps[id] = st
	}
	st := progress.Steps["template_application"]
	st.Status, st.CompletedAt = "skipped", &now
	progress.Steps["template_application"] = st
	if err := s.persist(ctx, &progress); err != nil {
		return ApplyResult{}, err
	}
	s.recordEvent(ctx, tenantID, "blank_factory_selected", nil, map[string]any{"industry": profile.Industry, "factoryName": factoryName})
	return ApplyResult{Success: true, Progress: progress}, nil
}

// --- Status --------------------------------------------------------------------

// Status is the progress with both checklists recomputed from the tenant's
// own rows. Each bar is a weighted checklist that sums to 100, so the
// number can never say 70% while the screen cannot say which 30% is missing.
func (s *Service) Status(ctx context.Context, tenantID, userID string) (Progress, error) {
	var progress *Progress
	counts := struct{ orders, plans, workOrders, records int }{}
	if err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		progress, err = s.loadProgress(ctx, tx, tenantID)
		if err != nil {
			return err
		}
		if progress == nil {
			now := s.now()
			progress = &Progress{TenantID: tenantID, UserID: db.StrOr(&userID, "usr-default"), TrialStatus: "active", TrialStart: db.ISO(now), TrialEnd: db.ISO(now.Add(trialDays * 24 * time.Hour)),
				DaysRemaining: trialDays, Steps: freshSteps(), UpdatedAt: db.ISO(now)}
			if userID == "" {
				progress.UserID = "usr-default"
			}
			if err := s.saveProgress(ctx, tx, progress); err != nil {
				return err
			}
		}
		return tx.QueryRow(ctx, `SELECT (SELECT count(*) FROM customer_order WHERE tenant_id = $1), (SELECT count(*) FROM production_plan WHERE tenant_id = $1),
			(SELECT count(*) FROM work_order WHERE tenant_id = $1), (SELECT count(*) FROM production_record WHERE tenant_id = $1)`, tenantID).
			Scan(&counts.orders, &counts.plans, &counts.workOrders, &counts.records)
	}); err != nil {
		return Progress{}, err
	}
	ref, err := s.master.Reference(ctx, tenantID)
	if err != nil {
		return Progress{}, err
	}
	shifts, err := s.master.Shifts(ctx, tenantID)
	if err != nil {
		return Progress{}, err
	}
	operators, err := s.master.Operators(ctx, tenantID)
	if err != nil {
		return Progress{}, err
	}
	readiness := []ChecklistItem{
		{"plant", "Plant", 10, len(ref.Plants) > 0, "/settings?tab=lines", "Minimal satu plant terdaftar."},
		{"products", "Produk", 15, len(ref.Products) > 0, "/settings?tab=products", "Minimal satu produk aktif."},
		{"lines", "Production Line", 15, len(ref.Lines) > 0, "/settings?tab=lines", "Minimal satu production line."},
		{"work-centers", "Work Center", 10, len(ref.WorkCenters) > 0, "/settings?tab=work-centers", "Minimal satu work center pada sebuah line."},
		{"machines", "Mesin", 15, len(ref.Machines) > 0, "/settings?tab=machines", "Minimal satu mesin pada sebuah work center."},
		{"processes", "Proses Produksi", 10, len(ref.Processes) > 0, "/settings?tab=processes", "Tahapan proses yang dilalui produk."},
		{"routings", "Routing Produk", 10, len(ref.Routings) > 0, "/settings?tab=routings", "Urutan proses untuk minimal satu produk."},
		{"shifts", "Shift", 8, len(shifts) > 0, "/settings?tab=shifts", "Kalender shift produksi."},
		{"operators", "Operator", 7, len(operators) > 0, "/settings?tab=operators", "Operator yang akan mencatat produksi."},
	}
	progress.ReadinessItems, progress.ReadinessPercent = readiness, percent(readiness)

	// Activation follows the order-to-production chain (§45), counted from
	// the tenant's own rows.
	if counts.orders > 0 {
		setStatus(progress, "first_production_order", "completed")
	}
	if counts.workOrders > 0 {
		setStatus(progress, "first_work_order", "completed")
	}
	if counts.records > 0 {
		setStatus(progress, "first_production_run", "completed")
	}
	activation := []ChecklistItem{
		{"customer-order", "Customer Order pertama", 25, counts.orders > 0, "/customer-orders?add=1", "Buat order pertama lewat Buat Order."},
		{"production-plan", "Production Plan pertama", 20, counts.plans > 0, "/production-plans", "Turunkan order menjadi rencana produksi."},
		{"work-order", "Work Order pertama", 25, counts.workOrders > 0, "/work-orders", "Generate work order dari plan."},
		{"production-run", "Hasil produksi pertama dicatat", 15, counts.records > 0, "/work-orders", "Operator mencatat good/reject di terminal shop floor."},
		{"production-result", "KPI & OEE terbentuk", 15, progress.Steps["first_production_result"].Status == "completed" || counts.records > 0, "/", "Dashboard menampilkan OEE dari hasil produksi."},
	}
	progress.ActivationItems, progress.ActivationPercent = activation, percent(activation)
	if end, err := db.ParseISO(progress.TrialEnd); err == nil {
		remaining := math.Ceil(end.Sub(s.now()).Hours() / 24)
		if remaining < 0 {
			remaining = 0
		}
		progress.DaysRemaining = int(remaining)
	}
	return *progress, nil
}

func percent(items []ChecklistItem) int {
	total := 0
	for _, it := range items {
		if it.Done {
			total += it.Weight
		}
	}
	if total > 100 {
		total = 100
	}
	return total
}

func setStatus(p *Progress, id, status string) {
	st := p.Steps[id]
	st.Status = status
	p.Steps[id] = st
}

// UpdateStep is PUT /onboarding/step.
func (s *Service) UpdateStep(ctx context.Context, tenantID, stepID, status string) (Progress, error) {
	var out *Progress
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		p, err := s.loadProgress(ctx, tx, tenantID)
		if err != nil {
			return err
		}
		if p == nil {
			return httpx.NotFound("Data onboarding tidak ditemukan.")
		}
		now := db.ISO(s.now())
		if st, ok := p.Steps[stepID]; ok {
			st.Status = status
			if status == "completed" {
				st.CompletedAt = &now
			}
			p.Steps[stepID] = st
		}
		p.UpdatedAt = now
		out = p
		return s.saveProgress(ctx, tx, p)
	})
	if err != nil {
		return Progress{}, err
	}
	s.recordEvent(ctx, tenantID, "onboarding_step_completed", nil, map[string]any{"stepId": stepID, "status": status})
	return *out, nil
}

// --- Guidance ------------------------------------------------------------------

func (s *Service) loadGuidance(ctx context.Context, tx pgx.Tx, tenantID string) (Guidance, error) {
	g := Guidance{DismissedTooltips: []string{}}
	var dismissed []byte
	err := tx.QueryRow(ctx, `SELECT tour_completed, tour_skipped, dismissed_tooltips, active_tour_step FROM onboarding_guidance WHERE tenant_id = $1`, tenantID).Scan(&g.TourCompleted, &g.TourSkipped, &dismissed, &g.ActiveTourStep)
	if db.IsNoRows(err) {
		return g, nil
	}
	if err != nil {
		return g, err
	}
	if len(dismissed) > 0 {
		_ = json.Unmarshal(dismissed, &g.DismissedTooltips)
	}
	if g.DismissedTooltips == nil {
		g.DismissedTooltips = []string{}
	}
	return g, nil
}

// GetGuidance is GET /onboarding/guidance.
func (s *Service) GetGuidance(ctx context.Context, tenantID string) (Guidance, error) {
	var g Guidance
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		g, err = s.loadGuidance(ctx, tx, tenantID)
		return err
	})
	return g, err
}

// GuidancePatch is PUT /onboarding/guidance.
type GuidancePatch struct {
	TourCompleted, TourSkipped *bool
	DismissedTooltips          []string
	ActiveTourStep             *int
}

// UpdateGuidance merges the patch; dismissed tooltips accumulate as a set.
func (s *Service) UpdateGuidance(ctx context.Context, tenantID string, p GuidancePatch) (Guidance, error) {
	var g Guidance
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		current, err := s.loadGuidance(ctx, tx, tenantID)
		if err != nil {
			return err
		}
		g = current
		if p.TourCompleted != nil {
			g.TourCompleted = *p.TourCompleted
		}
		if p.TourSkipped != nil {
			g.TourSkipped = *p.TourSkipped
		}
		if p.ActiveTourStep != nil {
			g.ActiveTourStep = p.ActiveTourStep
		}
		if p.DismissedTooltips != nil {
			seen := map[string]bool{}
			merged := []string{}
			for _, t := range append(append([]string{}, current.DismissedTooltips...), p.DismissedTooltips...) {
				if !seen[t] {
					seen[t] = true
					merged = append(merged, t)
				}
			}
			g.DismissedTooltips = merged
		}
		dismissed, _ := json.Marshal(g.DismissedTooltips)
		_, err = tx.Exec(ctx, `INSERT INTO onboarding_guidance (tenant_id, tour_completed, tour_skipped, dismissed_tooltips, active_tour_step, updated_at)
			VALUES ($1,$2,$3,$4::jsonb,$5, CURRENT_TIMESTAMP)
			ON CONFLICT (tenant_id) DO UPDATE SET tour_completed = EXCLUDED.tour_completed, tour_skipped = EXCLUDED.tour_skipped, dismissed_tooltips = EXCLUDED.dismissed_tooltips,
				active_tour_step = EXCLUDED.active_tour_step, updated_at = CURRENT_TIMESTAMP`, tenantID, g.TourCompleted, g.TourSkipped, dismissed, g.ActiveTourStep)
		return err
	})
	if err != nil {
		return Guidance{}, err
	}
	if p.TourCompleted != nil && *p.TourCompleted {
		s.recordEvent(ctx, tenantID, "welcome_tour_completed", nil, nil)
	}
	return g, nil
}

// --- First workflow --------------------------------------------------------------

// FirstWorkflowInput is the optional body of POST /onboarding/first-workflow.
type FirstWorkflowInput struct {
	ProductID                    *string
	Quantity, GoodQty, RejectQty *int
}

// ExecuteFirstWorkflow runs PO → WO release and marks the run steps complete.
func (s *Service) ExecuteFirstWorkflow(ctx context.Context, tenantID string, in FirstWorkflowInput) (FirstWorkflowResult, error) {
	products, err := s.master.Products(ctx, tenantID)
	if err != nil {
		return FirstWorkflowResult{}, err
	}
	var target *masterdata.Product
	if in.ProductID != nil {
		for i := range products {
			if products[i].ID == *in.ProductID {
				target = &products[i]
			}
		}
	}
	if target == nil && len(products) > 0 {
		target = &products[0]
	}
	if target == nil {
		return FirstWorkflowResult{}, httpx.Validation("Belum ada produk terdaftar untuk menjalankan alur produksi.")
	}
	planned := db.Deref(in.Quantity, 500)
	good := db.Deref(in.GoodQty, int(math.Round(float64(planned)*0.96)))
	reject := db.Deref(in.RejectQty, planned-good)

	poNumber := "PO-FIRST-" + lastDigits(s.now().UnixMilli(), 4)
	po, err := s.production.CreateProductionOrder(ctx, tenantID, production.CreateProductionOrderInput{OrderNumber: poNumber, ProductID: target.ID, Quantity: planned,
		DueDate: db.ISO(s.now().Add(7 * 24 * time.Hour))[:10], CreatedBy: "onboarding-wizard"})
	if err != nil {
		return FirstWorkflowResult{}, err
	}
	routings, err := s.master.Routings(ctx, tenantID, "")
	if err != nil {
		return FirstWorkflowResult{}, err
	}
	forRelease := make([]production.RoutingForRelease, 0, len(routings))
	for _, rt := range routings {
		forRelease = append(forRelease, production.RoutingForRelease{ProductID: rt.ProductID, ProcessID: rt.ProcessID, Sequence: rt.Sequence, WorkCenterID: rt.WorkCenterID, MachineID: rt.MachineID, Active: rt.Active})
	}
	if _, err := s.production.ReleaseProductionOrder(ctx, tenantID, po.ID, forRelease); err != nil {
		return FirstWorkflowResult{}, err
	}
	workOrders, err := s.production.WorkOrders(ctx, tenantID, production.WorkOrderFilter{})
	if err != nil {
		return FirstWorkflowResult{}, err
	}
	woNumber := poNumber + "-WO1"
	for _, w := range workOrders {
		if w.ProductionOrderID != nil && *w.ProductionOrderID == po.ID {
			woNumber = w.WoNumber
			break
		}
	}
	if woNumber == poNumber+"-WO1" && len(workOrders) > 0 {
		woNumber = workOrders[0].WoNumber
	}
	now := db.ISO(s.now())
	for _, id := range []string{"first_production_order", "first_work_order", "first_production_run", "first_production_result"} {
		if _, err := s.UpdateStep(ctx, tenantID, id, "completed"); err != nil {
			return FirstWorkflowResult{}, err
		}
	}
	achievement := jsnum.Round1(float64(good) / float64(planned) * 100)
	defect := jsnum.ToFixed(float64(reject)/float64(planned)*100, 2)
	s.recordEvent(ctx, tenantID, "production_completed", nil, map[string]any{"orderNumber": poNumber, "product": target.Name, "planned": planned, "good": good, "reject": reject, "achievementRate": achievement})
	return FirstWorkflowResult{OrderNumber: poNumber, WoNumber: woNumber, ProductName: target.Name, PlannedQuantity: planned, ProducedQuantity: good, RejectQuantity: reject,
		AchievementRate: achievement, DefectRate: defect, OccurredAt: now}, nil
}

func lastDigits(n int64, count int) string {
	s := fmt.Sprint(n)
	if len(s) > count {
		return s[len(s)-count:]
	}
	return s
}

// UpgradePlan marks the trial converted and records the request.
func (s *Service) UpgradePlan(ctx context.Context, tenantID, planCode string) (map[string]any, error) {
	progress, err := s.Status(ctx, tenantID, "")
	if err != nil {
		return nil, err
	}
	progress.TrialStatus = "converted"
	if err := s.persist(ctx, &progress); err != nil {
		return nil, err
	}
	s.recordEvent(ctx, tenantID, "trial_converted", nil, map[string]any{"planCode": planCode})
	return map[string]any{"success": true, "message": fmt.Sprintf("Permintaan upgrade ke paket %s telah diterima. Tim sales kami akan segera menghubungi Anda.", strings.ToUpper(planCode))}, nil
}
