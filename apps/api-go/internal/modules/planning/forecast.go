package planning

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/db"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/httpx"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/outbox"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/queue"
)

// Forecast is the TypeScript DemandForecast plus the supersession pointer.
type Forecast struct {
	ID             string  `json:"id"`
	TenantID       string  `json:"tenantId"`
	ForecastNumber string  `json:"forecastNumber"`
	PeriodStart    string  `json:"periodStart"`
	PeriodEnd      string  `json:"periodEnd"`
	LookbackMonths int     `json:"lookbackMonths"`
	Method         string  `json:"method"`
	GeneratedBy    *string `json:"generatedBy,omitempty"`
	GeneratedAt    *string `json:"generatedAt,omitempty"`
	Status         string  `json:"status"`
	SupersededByID *string `json:"supersededById,omitempty"`
}

// ForecastLine is the TypeScript DemandForecastLine plus the history flags.
type ForecastLine struct {
	ID                  string             `json:"id"`
	TenantID            string             `json:"tenantId"`
	DemandForecastID    string             `json:"demandForecastId"`
	CustomerID          *string            `json:"customerId,omitempty"`
	ProductID           string             `json:"productId"`
	HistoricalDemand    map[string]float64 `json:"historicalDemand"`
	AverageDemand       float64            `json:"averageDemand"`
	ForecastQuantity    int                `json:"forecastQuantity"`
	InsufficientHistory bool               `json:"insufficientHistory"`
	MonthsWithHistory   int                `json:"monthsWithHistory"`
}

// PlanUsing is a Production Plan built on a forecast snapshot.
type PlanUsing struct {
	ProductionPlanID string `json:"productionPlanId"`
	PlanNumber       string `json:"planNumber"`
	Status           string `json:"status"`
}

// ForecastDetail is a forecast with its lines and consumers.
type ForecastDetail struct {
	Forecast
	Lines       []ForecastLine `json:"lines"`
	UsedByPlans []PlanUsing    `json:"usedByPlans"`
}

const forecastColumns = `id, tenant_id, forecast_number, to_char(period_start, 'YYYY-MM-DD'), to_char(period_end, 'YYYY-MM-DD'), lookback_months, method, generated_by, generated_at, status, superseded_by_id`
const forecastLineColumns = `id, tenant_id, demand_forecast_id, customer_id, product_id, historical_demand, average_demand::float8, forecast_quantity, insufficient_history, months_with_history`

func scanForecast(row pgx.Row) (Forecast, error) {
	var f Forecast
	var method, status *string
	var generated *time.Time
	if err := row.Scan(&f.ID, &f.TenantID, &f.ForecastNumber, &f.PeriodStart, &f.PeriodEnd, &f.LookbackMonths, &method, &f.GeneratedBy, &generated, &status, &f.SupersededByID); err != nil {
		return Forecast{}, err
	}
	f.Method, f.Status, f.GeneratedAt = db.Deref(method, "HISTORICAL_AVERAGE"), db.Deref(status, "DRAFT"), db.ISOPtr(generated)
	return f, nil
}

func scanForecastLine(row pgx.Row) (ForecastLine, error) {
	var l ForecastLine
	var history []byte
	if err := row.Scan(&l.ID, &l.TenantID, &l.DemandForecastID, &l.CustomerID, &l.ProductID, &history, &l.AverageDemand, &l.ForecastQuantity, &l.InsufficientHistory, &l.MonthsWithHistory); err != nil {
		return ForecastLine{}, err
	}
	l.HistoricalDemand = map[string]float64{}
	if len(history) > 0 {
		_ = json.Unmarshal(history, &l.HistoricalDemand)
	}
	return l, nil
}

// ForecastRepository is demand_forecast and demand_forecast_line.
type ForecastRepository struct{}

// MonthlyHistory is the monthly order quantity per product and customer for
// the window, keyed on order_date (when the demand arrived); cancelled
// orders do not count.
func (ForecastRepository) MonthlyHistory(ctx context.Context, tx pgx.Tx, tenantID, fromMonth, toMonth string, productIDs []string) ([]MonthlyDemandRow, error) {
	args := []any{tenantID, fromMonth + "-01", toMonth + "-01"}
	filter := ""
	if len(productIDs) > 0 {
		args = append(args, productIDs)
		filter = " AND col.product_id = ANY($4)"
	}
	rows, err := tx.Query(ctx, `SELECT col.product_id, co.customer_id, to_char(co.order_date, 'YYYY-MM'), SUM(col.ordered_quantity)::float8
		FROM customer_order_line col JOIN customer_order co ON co.id = col.customer_order_id
		WHERE col.tenant_id = $1 AND co.order_date >= $2::date AND co.order_date < ($3::date + INTERVAL '1 month') AND co.status <> 'CANCELLED'`+filter+`
		GROUP BY col.product_id, co.customer_id, to_char(co.order_date, 'YYYY-MM') ORDER BY col.product_id, 3`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []MonthlyDemandRow{}
	for rows.Next() {
		var r MonthlyDemandRow
		if err := rows.Scan(&r.ProductID, &r.CustomerID, &r.Month, &r.Quantity); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// Insert stores a forecast header.
func (ForecastRepository) Insert(ctx context.Context, tx pgx.Tx, f Forecast) (Forecast, error) {
	return scanForecast(tx.QueryRow(ctx, `INSERT INTO demand_forecast (id, tenant_id, forecast_number, period_start, period_end, lookback_months, method, generated_by, status)
		VALUES ($1,$2,$3,$4::date,$5::date,$6,$7,$8,$9) RETURNING `+forecastColumns, f.ID, f.TenantID, f.ForecastNumber, f.PeriodStart, f.PeriodEnd, f.LookbackMonths, f.Method, f.GeneratedBy, f.Status))
}

// InsertLine stores one line.
func (ForecastRepository) InsertLine(ctx context.Context, tx pgx.Tx, l ForecastLine) (ForecastLine, error) {
	history, err := json.Marshal(l.HistoricalDemand)
	if err != nil {
		return ForecastLine{}, err
	}
	return scanForecastLine(tx.QueryRow(ctx, `INSERT INTO demand_forecast_line (id, tenant_id, demand_forecast_id, customer_id, product_id, historical_demand, average_demand, forecast_quantity, insufficient_history, months_with_history)
		VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10) RETURNING `+forecastLineColumns,
		l.ID, l.TenantID, l.DemandForecastID, l.CustomerID, l.ProductID, history, l.AverageDemand, l.ForecastQuantity, l.InsufficientHistory, l.MonthsWithHistory))
}

// FindByID reads one forecast; nil when absent.
func (ForecastRepository) FindByID(ctx context.Context, tx pgx.Tx, tenantID, id string) (*Forecast, error) {
	f, err := scanForecast(tx.QueryRow(ctx, `SELECT `+forecastColumns+` FROM demand_forecast WHERE tenant_id = $1 AND id = $2`, tenantID, id))
	if db.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &f, nil
}

// ListLines reads a forecast's lines by product.
func (ForecastRepository) ListLines(ctx context.Context, tx pgx.Tx, tenantID, forecastID string) ([]ForecastLine, error) {
	rows, err := tx.Query(ctx, `SELECT `+forecastLineColumns+` FROM demand_forecast_line WHERE tenant_id = $1 AND demand_forecast_id = $2 ORDER BY product_id`, tenantID, forecastID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ForecastLine{}
	for rows.Next() {
		l, err := scanForecastLine(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// List reads forecasts newest period first (limit ≤ 500).
func (ForecastRepository) List(ctx context.Context, tx pgx.Tx, tenantID, status, periodStart string, limit int) ([]Forecast, error) {
	where, args := []string{"tenant_id = $1"}, []any{tenantID}
	if status != "" {
		args = append(args, status)
		where = append(where, fmt.Sprintf("status = $%d", len(args)))
	}
	if periodStart != "" {
		args = append(args, periodStart)
		where = append(where, fmt.Sprintf("period_start = $%d::date", len(args)))
	}
	if limit <= 0 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}
	args = append(args, limit)
	rows, err := tx.Query(ctx, `SELECT `+forecastColumns+` FROM demand_forecast WHERE `+strings.Join(where, " AND ")+fmt.Sprintf(` ORDER BY period_start DESC, forecast_number DESC LIMIT $%d`, len(args)), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Forecast{}
	for rows.Next() {
		f, err := scanForecast(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// FindSupersedable locks the GENERATED forecasts for the same period and
// lookback: a different lookback is a different question.
func (ForecastRepository) FindSupersedable(ctx context.Context, tx pgx.Tx, tenantID, periodStart string, lookback int) ([]Forecast, error) {
	rows, err := tx.Query(ctx, `SELECT `+forecastColumns+` FROM demand_forecast WHERE tenant_id = $1 AND period_start = $2::date AND lookback_months = $3 AND status = 'GENERATED' FOR UPDATE`, tenantID, periodStart, lookback)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Forecast{}
	for rows.Next() {
		f, err := scanForecast(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// MarkSuperseded points a forecast at its replacement; its lines are never
// touched (MES-028).
func (ForecastRepository) MarkSuperseded(ctx context.Context, tx pgx.Tx, tenantID, id, byID string) error {
	_, err := tx.Exec(ctx, `UPDATE demand_forecast SET status = 'SUPERSEDED', superseded_by_id = $3 WHERE tenant_id = $1 AND id = $2`, tenantID, id, byID)
	return err
}

// PlansUsing lists the Production Plans that reference a forecast.
func (ForecastRepository) PlansUsing(ctx context.Context, tx pgx.Tx, tenantID, forecastID string) ([]PlanUsing, error) {
	rows, err := tx.Query(ctx, `SELECT id, plan_number, status FROM production_plan WHERE tenant_id = $1 AND demand_forecast_id = $2 ORDER BY plan_number`, tenantID, forecastID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PlanUsing{}
	for rows.Next() {
		var p PlanUsing
		if err := rows.Scan(&p.ProductionPlanID, &p.PlanNumber, &p.Status); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// --- Service ------------------------------------------------------------------

// GenerateForecastInput is what a generation job carries.
type GenerateForecastInput struct {
	PeriodStart    string   `json:"periodStart"`
	PeriodEnd      string   `json:"periodEnd"`
	LookbackMonths int      `json:"lookbackMonths"`
	ProductIDs     []string `json:"productIds,omitempty"`
	PerCustomer    *bool    `json:"perCustomer,omitempty"`
	AsOf           *string  `json:"asOf,omitempty"`
}

func lookbackList() string {
	parts := make([]string, len(AllowedLookbacks))
	for i, n := range AllowedLookbacks {
		parts[i] = fmt.Sprint(n)
	}
	return strings.Join(parts, ", ")
}

func assertForecastInput(in GenerateForecastInput) error {
	allowed := false
	for _, n := range AllowedLookbacks {
		if n == in.LookbackMonths {
			allowed = true
		}
	}
	if !allowed {
		return httpx.Validation(fmt.Sprintf("Lookback harus salah satu dari %s bulan.", lookbackList()), httpx.FieldError{Field: "lookbackMonths", Code: "INVALID_VALUE", Message: fmt.Sprintf("Lookback %d tidak didukung.", in.LookbackMonths)})
	}
	if dateOf(in.PeriodEnd).Before(dateOf(in.PeriodStart)) {
		return httpx.Validation("Periode forecast tidak valid.", httpx.FieldError{Field: "periodEnd", Code: "OUT_OF_RANGE", Message: "Period end harus setelah atau sama dengan period start."})
	}
	return nil
}

// EnqueueForecast enqueues a generation and returns the job (202). The
// aggregation is worker work, not request work.
func (s *Service) EnqueueForecast(ctx context.Context, tenantID string, in GenerateForecastInput, actorID string) (queue.Job, error) {
	if err := assertForecastInput(in); err != nil {
		return queue.Job{}, err
	}
	payload := map[string]any{"periodStart": in.PeriodStart, "periodEnd": in.PeriodEnd, "lookbackMonths": in.LookbackMonths}
	if in.ProductIDs != nil {
		payload["productIds"] = in.ProductIDs
	}
	if in.PerCustomer != nil {
		payload["perCustomer"] = *in.PerCustomer
	}
	if in.AsOf != nil {
		payload["asOf"] = *in.AsOf
	}
	var job queue.Job
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		job, err = s.jobs.EnqueueIn(ctx, tx, queue.Request{TenantID: tenantID, JobType: "DEMAND_FORECAST_GENERATE", Payload: payload, RequestedBy: &actorID})
		return err
	})
	return job, err
}

// ForecastJob reads one forecast job.
func (s *Service) ForecastJob(ctx context.Context, tenantID, jobID string) (queue.Job, error) {
	job, err := s.jobs.FindByID(ctx, tenantID, jobID)
	if err != nil {
		return queue.Job{}, err
	}
	if job == nil {
		return queue.Job{}, httpx.NotFound("Job forecast tidak ditemukan.")
	}
	return *job, nil
}

// ForecastJobs lists forecast jobs.
func (s *Service) ForecastJobs(ctx context.Context, tenantID string) ([]queue.Job, error) {
	return s.jobs.List(ctx, tenantID, "DEMAND_FORECAST_GENERATE", 0)
}

// RunForecast runs one generation in one transaction: history read,
// supersede, insert, audit, event. Called by the job runner.
func (s *Service) RunForecast(ctx context.Context, tenantID string, in GenerateForecastInput, actorID string) (ForecastDetail, error) {
	if err := assertForecastInput(in); err != nil {
		return ForecastDetail{}, err
	}
	asOf := s.now()
	if in.AsOf != nil && *in.AsOf != "" {
		if t, err := db.ParseISO(*in.AsOf); err == nil {
			asOf = t
		} else if t, err := time.Parse("2006-01-02", *in.AsOf); err == nil {
			asOf = t
		}
	}
	months := LookbackMonths(asOf, in.LookbackMonths)
	var out ForecastDetail
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		history, err := s.forecasts.MonthlyHistory(ctx, tx, tenantID, months[0], months[len(months)-1], in.ProductIDs)
		if err != nil {
			return err
		}
		computed := ComputeForecast(history, in.LookbackMonths, asOf, db.Deref(in.PerCustomer, false))
		number, err := NextNumber(ctx, tx, tenantID, "demand_forecast", "forecast_number", DemandForecastPrefix(in.PeriodStart), 3)
		if err != nil {
			return err
		}
		forecast, err := s.forecasts.Insert(ctx, tx, Forecast{ID: "fc-" + uuid.NewString(), TenantID: tenantID, ForecastNumber: number, PeriodStart: in.PeriodStart, PeriodEnd: in.PeriodEnd,
			LookbackMonths: in.LookbackMonths, Method: "HISTORICAL_AVERAGE", GeneratedBy: &actorID, Status: "GENERATED"})
		if err != nil {
			return err
		}
		lines := []ForecastLine{}
		insufficient := 0
		for _, c := range computed {
			line, err := s.forecasts.InsertLine(ctx, tx, ForecastLine{ID: "fcl-" + uuid.NewString(), TenantID: tenantID, DemandForecastID: forecast.ID, CustomerID: c.CustomerID, ProductID: c.ProductID,
				HistoricalDemand: c.HistoricalDemand, AverageDemand: c.AverageDemand, ForecastQuantity: c.ForecastQuantity, InsufficientHistory: c.InsufficientHistory, MonthsWithHistory: c.MonthsWithHistory})
			if err != nil {
				return err
			}
			if line.InsufficientHistory {
				insufficient++
			}
			lines = append(lines, line)
		}
		// Supersede the previous snapshot for the same question; its lines
		// stay exactly as they were.
		superseded, err := s.forecasts.FindSupersedable(ctx, tx, tenantID, in.PeriodStart, in.LookbackMonths)
		if err != nil {
			return err
		}
		var supersededIDs []string
		for _, prev := range superseded {
			if prev.ID == forecast.ID {
				continue
			}
			if err := s.forecasts.MarkSuperseded(ctx, tx, tenantID, prev.ID, forecast.ID); err != nil {
				return err
			}
			supersededIDs = append(supersededIDs, prev.ID)
		}
		var previous any
		if len(supersededIDs) > 0 {
			previous = map[string]any{"supersededForecastIds": supersededIDs}
		}
		if err := s.auditIn(ctx, tx, tenantID, actorID, "SYSTEM", "demand_forecast", forecast.ID, "GENERATE", previous,
			map[string]any{"forecastNumber": forecast.ForecastNumber, "lookbackMonths": forecast.LookbackMonths, "months": months, "lineCount": len(lines), "insufficientHistoryCount": insufficient}); err != nil {
			return err
		}
		payload := map[string]any{"forecastNumber": forecast.ForecastNumber, "periodStart": forecast.PeriodStart, "periodEnd": forecast.PeriodEnd, "lookbackMonths": forecast.LookbackMonths,
			"lineCount": len(lines), "insufficientHistoryCount": insufficient}
		if len(supersededIDs) > 0 {
			payload["supersededForecastId"] = supersededIDs[0]
		}
		if err := s.outbox.Publish(ctx, tx, tenantID, outbox.Event{Type: EventDemandForecastGenerated, AggregateType: "demand_forecast", AggregateID: forecast.ID, Payload: payload}); err != nil {
			return err
		}
		out = ForecastDetail{Forecast: forecast, Lines: lines, UsedByPlans: []PlanUsing{}}
		return nil
	})
	return out, err
}

// Forecasts lists forecast headers.
func (s *Service) Forecasts(ctx context.Context, tenantID, status string) ([]Forecast, error) {
	var out []Forecast
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.forecasts.List(ctx, tx, tenantID, status, "", 0)
		return err
	})
	return out, err
}

func (s *Service) forecastDetail(ctx context.Context, tx pgx.Tx, tenantID, id string) (ForecastDetail, error) {
	f, err := s.forecasts.FindByID(ctx, tx, tenantID, id)
	if err != nil {
		return ForecastDetail{}, err
	}
	if f == nil {
		return ForecastDetail{}, httpx.NotFound("Demand forecast tidak ditemukan.")
	}
	lines, err := s.forecasts.ListLines(ctx, tx, tenantID, id)
	if err != nil {
		return ForecastDetail{}, err
	}
	plans, err := s.forecasts.PlansUsing(ctx, tx, tenantID, id)
	if err != nil {
		return ForecastDetail{}, err
	}
	return ForecastDetail{Forecast: *f, Lines: lines, UsedByPlans: plans}, nil
}

// ForecastByID reads one forecast with lines and consumers.
func (s *Service) ForecastByID(ctx context.Context, tenantID, id string) (ForecastDetail, error) {
	var out ForecastDetail
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.forecastDetail(ctx, tx, tenantID, id)
		return err
	})
	return out, err
}

// ForecastActuals is the ordered quantity per product for a period (MES-030).
func (s *Service) ForecastActuals(ctx context.Context, tenantID, periodStart, periodEnd string) (map[string]int, error) {
	out := map[string]int{}
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT col.product_id, SUM(col.ordered_quantity)::int FROM customer_order_line col JOIN customer_order co ON co.id = col.customer_order_id
			WHERE col.tenant_id = $1 AND co.order_date >= $2::date AND co.order_date <= $3::date AND co.status <> 'CANCELLED' GROUP BY col.product_id ORDER BY col.product_id`, tenantID, periodStart, periodEnd)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var id string
			var n int
			if err := rows.Scan(&id, &n); err != nil {
				return err
			}
			out[id] = n
		}
		return rows.Err()
	})
	return out, err
}

// --- Routes -------------------------------------------------------------------

var forecastStatuses = []string{"DRAFT", "GENERATED", "SUPERSEDED"}

func (h *handler) mountForecasts(r chi.Router) {
	r.Post("/demand-forecasts/generate", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		periodStart := v.ISODate("periodStart", httpx.Opt{})
		periodEnd := v.ISODate("periodEnd", httpx.Opt{})
		lookback := v.Int("lookbackMonths", httpx.Opt{})
		in := GenerateForecastInput{PerCustomer: v.Boolean("perCustomer", httpx.Opt{Optional: true})}
		if raw, ok := body["productIds"]; ok && raw != nil {
			items, isList := raw.([]any)
			if !isList {
				v.Reject("productIds", "INVALID_TYPE", "productIds harus berupa daftar id product.")
			}
			in.ProductIDs = []string{}
			for _, it := range items {
				if s, ok := it.(string); ok {
					in.ProductIDs = append(in.ProductIDs, s)
				}
			}
		}
		if lookback != nil {
			allowed := false
			for _, n := range AllowedLookbacks {
				if n == *lookback {
					allowed = true
				}
			}
			if !allowed {
				v.Reject("lookbackMonths", "INVALID_VALUE", fmt.Sprintf("Lookback harus salah satu dari %s bulan (ADR-20).", lookbackList()))
			}
		}
		if err := v.Done(); err != nil {
			return err
		}
		in.PeriodStart, in.PeriodEnd, in.LookbackMonths = *dateOnly(periodStart), *dateOnly(periodEnd), *lookback
		job, err := h.svc.EnqueueForecast(r.Context(), h.tenant(r), in, actorOf(r))
		if err != nil {
			return err
		}
		// Nudge the runner so an interactive request does not wait for the
		// next poll tick; the job is still executed by the runner.
		if h.runner != nil {
			h.runner.Nudge()
		}
		return httpx.JSON(w, http.StatusAccepted, map[string]any{"jobId": job.ID, "status": job.Status, "message": "Perhitungan forecast dijalankan sebagai job. Pantau status lewat /demand-forecasts/jobs."})
	}))

	r.Get("/demand-forecasts/jobs", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		jobs, err := h.svc.ForecastJobs(r.Context(), h.tenant(r))
		if err != nil {
			return err
		}
		return httpx.OK(w, jobs)
	}))

	r.Get("/demand-forecasts/jobs/{jobId}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		job, err := h.svc.ForecastJob(r.Context(), h.tenant(r), chi.URLParam(r, "jobId"))
		if err != nil {
			return err
		}
		return httpx.OK(w, job)
	}))

	r.Get("/demand-forecasts", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		status := r.URL.Query().Get("status")
		if indexOf(forecastStatuses, status) < 0 {
			status = ""
		}
		list, err := h.svc.Forecasts(r.Context(), h.tenant(r), status)
		if err != nil {
			return err
		}
		return httpx.OK(w, list)
	}))

	r.Get("/demand-forecasts/{id}/comparison", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		tenantID := h.tenant(r)
		forecast, err := h.svc.ForecastByID(r.Context(), tenantID, chi.URLParam(r, "id"))
		if err != nil {
			return err
		}
		actuals, err := h.svc.ForecastActuals(r.Context(), tenantID, forecast.PeriodStart, forecast.PeriodEnd)
		if err != nil {
			return err
		}
		rows := make([]map[string]any, 0, len(forecast.Lines))
		for _, line := range forecast.Lines {
			actual := actuals[line.ProductID]
			rows = append(rows, map[string]any{"productId": line.ProductID, "forecastQuantity": line.ForecastQuantity, "actualOrderedQuantity": actual, "variance": actual - line.ForecastQuantity, "insufficientHistory": line.InsufficientHistory})
		}
		return httpx.OK(w, map[string]any{"forecastId": forecast.ID, "periodStart": forecast.PeriodStart, "periodEnd": forecast.PeriodEnd, "rows": rows})
	}))

	r.Get("/demand-forecasts/{id}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		forecast, err := h.svc.ForecastByID(r.Context(), h.tenant(r), chi.URLParam(r, "id"))
		if err != nil {
			return err
		}
		return httpx.OK(w, forecast)
	}))
}
