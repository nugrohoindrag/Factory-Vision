package shift

import (
	"context"
	"fmt"
	"net/http"
	"sort"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"golang.org/x/sync/errgroup"

	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/audit"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/masterdata"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/production"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/shopfloor"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/auth"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/db"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/httpx"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/jsnum"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/tenancy"
)

// Shift performance and handover (US-022, US-023). The handover screen is
// the one place a supervisor hands responsibility over; the context is
// assembled server-side from the same records the reports use. Handover
// notes were held in process memory by the Node API; here they are rows
// of shift_handover.

// HandoverRecord is the TypeScript ShiftHandoverRecord.
type HandoverRecord struct {
	ID                     string   `json:"id"`
	TenantID               string   `json:"tenantId"`
	LineID                 string   `json:"lineId"`
	ShiftID                string   `json:"shiftId"`
	ShiftDate              string   `json:"shiftDate"`
	OutgoingSupervisorID   string   `json:"outgoingSupervisorId"`
	OutgoingSupervisorName string   `json:"outgoingSupervisorName"`
	IncomingSupervisorID   *string  `json:"incomingSupervisorId,omitempty"`
	IncomingSupervisorName *string  `json:"incomingSupervisorName,omitempty"`
	Notes                  string   `json:"notes"`
	OpenIssues             []string `json:"openIssues"`
	AcknowledgedAt         *string  `json:"acknowledgedAt,omitempty"`
	CreatedAt              string   `json:"createdAt"`
}

// OpenWorkOrder is one line of the handover context.
type OpenWorkOrder struct {
	ID             string  `json:"id"`
	WoNumber       string  `json:"woNumber"`
	ProductName    string  `json:"productName"`
	Status         string  `json:"status"`
	AchievementPct float64 `json:"achievementPct"`
}

// HandoverContext is everything a supervisor needs on the handover screen.
type HandoverContext struct {
	LineID                   string          `json:"lineId"`
	LineName                 string          `json:"lineName"`
	ShiftID                  string          `json:"shiftId"`
	ShiftName                string          `json:"shiftName"`
	ShiftDate                string          `json:"shiftDate"`
	TargetQuantity           int             `json:"targetQuantity"`
	GoodQuantity             int             `json:"goodQuantity"`
	RejectQuantity           int             `json:"rejectQuantity"`
	AchievementPct           float64         `json:"achievementPct"`
	RemainingTarget          int             `json:"remainingTarget"`
	RejectRatePct            float64         `json:"rejectRatePct"`
	DowntimeMinutes          int             `json:"downtimeMinutes"`
	UnplannedDowntimeMinutes int             `json:"unplannedDowntimeMinutes"`
	TopDowntimeReason        *string         `json:"topDowntimeReason"`
	TopRejectReason          *string         `json:"topRejectReason"`
	OpenWorkOrders           []OpenWorkOrder `json:"openWorkOrders"`
	ActiveDowntimeCount      int             `json:"activeDowntimeCount"`
	PreviousHandover         *HandoverRecord `json:"previousHandover"`
}

// HandoverService builds contexts and stores handovers.
type HandoverService struct {
	pool       *db.Pool
	master     *masterdata.Service
	production *production.Service
	shopfloor  *shopfloor.Service
}

// NewHandoverService wires the service.
func NewHandoverService(pool *db.Pool, master *masterdata.Service, prod *production.Service, sf *shopfloor.Service) *HandoverService {
	return &HandoverService{pool: pool, master: master, production: prod, shopfloor: sf}
}

const handoverColumns = `id, tenant_id, line_id, shift_id, to_char(shift_date, 'YYYY-MM-DD'), outgoing_supervisor_id,
  outgoing_supervisor_name, incoming_supervisor_id, incoming_supervisor_name, notes, open_issues, acknowledged_at, created_at`

func scanHandover(rows pgx.Rows) (HandoverRecord, error) {
	var (
		h              HandoverRecord
		outID, outName *string
		issues         []byte
		acknowledged   *time.Time
		created        *time.Time
	)
	if err := rows.Scan(&h.ID, &h.TenantID, &h.LineID, &h.ShiftID, &h.ShiftDate, &outID, &outName,
		&h.IncomingSupervisorID, &h.IncomingSupervisorName, &h.Notes, &issues, &acknowledged, &created); err != nil {
		return h, err
	}
	h.OutgoingSupervisorID, h.OutgoingSupervisorName = db.StrOr(outID, ""), db.StrOr(outName, "")
	h.OpenIssues = []string{}
	if list, ok := db.RawJSON(issues).([]any); ok {
		for _, item := range list {
			if s, ok := item.(string); ok {
				h.OpenIssues = append(h.OpenIssues, s)
			}
		}
	}
	h.AcknowledgedAt = db.ISOPtr(acknowledged)
	if created != nil {
		h.CreatedAt = db.ISO(*created)
	}
	h.IncomingSupervisorID, h.IncomingSupervisorName = db.Str(h.IncomingSupervisorID), db.Str(h.IncomingSupervisorName)
	return h, nil
}

func collectHandovers(rows pgx.Rows, err error) ([]HandoverRecord, error) {
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []HandoverRecord{}
	for rows.Next() {
		h, err := scanHandover(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, h)
	}
	return out, rows.Err()
}

// latestShiftDate is the most recent shift date in the transaction data.
func (s *HandoverService) latestShiftDate(ctx context.Context, tenantID string) (string, error) {
	var latest *string
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT to_char(GREATEST(
			   (SELECT MAX(shift_date) FROM production_record WHERE tenant_id = $1),
			   (SELECT MAX(shift_date) FROM downtime_record WHERE tenant_id = $1)), 'YYYY-MM-DD')`, tenantID).Scan(&latest)
	})
	if err != nil {
		return "", err
	}
	if latest == nil {
		return db.Now()[:10], nil
	}
	return *latest, nil
}

// ContextParams selects the shift the context describes.
type ContextParams struct {
	LineID    string
	ShiftID   *string
	ShiftDate *string
}

func rankTop(pairs [][2]any) *string {
	totals := map[string]float64{}
	var order []string
	for _, p := range pairs {
		key, _ := p[0].(string)
		weight, _ := p[1].(float64)
		if _, ok := totals[key]; !ok {
			order = append(order, key)
		}
		totals[key] += weight
	}
	if len(order) == 0 {
		return nil
	}
	sort.SliceStable(order, func(i, j int) bool { return totals[order[i]] > totals[order[j]] })
	return &order[0]
}

// BuildContext assembles the handover screen for one line and shift.
func (s *HandoverService) BuildContext(ctx context.Context, tenantID string, p ContextParams) (HandoverContext, error) {
	line, err := s.master.LineByID(ctx, tenantID, p.LineID)
	if err != nil {
		return HandoverContext{}, err
	}
	if line == nil {
		return HandoverContext{}, httpx.NotFound("Production line tidak ditemukan.")
	}
	shiftDate := ""
	if p.ShiftDate != nil && *p.ShiftDate != "" {
		shiftDate = *p.ShiftDate
	} else if shiftDate, err = s.latestShiftDate(ctx, tenantID); err != nil {
		return HandoverContext{}, err
	}
	shifts, err := s.master.Shifts(ctx, tenantID)
	if err != nil {
		return HandoverContext{}, err
	}
	shiftID := "shift-1"
	if p.ShiftID != nil && *p.ShiftID != "" {
		shiftID = *p.ShiftID
	} else {
		for _, sh := range shifts {
			if sh.Active {
				shiftID = sh.ID
				break
			}
		}
	}
	shiftName := shiftID
	for _, sh := range shifts {
		if sh.ID == shiftID {
			shiftName = sh.Name
			break
		}
	}

	var (
		workOrders []production.WorkOrder
		records    []shopfloor.ProductionRecord
		downtimes  []shopfloor.DowntimeRecord
		previous   *HandoverRecord
	)
	g, gctx := errgroup.WithContext(ctx)
	g.Go(func() error {
		var err error
		workOrders, err = s.production.WorkOrders(gctx, tenantID, production.WorkOrderFilter{})
		return err
	})
	g.Go(func() error {
		var err error
		records, err = s.shopfloor.ProductionRecords(gctx, tenantID, shopfloor.ProductionRecordFilter{})
		return err
	})
	g.Go(func() error {
		var err error
		downtimes, err = s.shopfloor.DowntimeRecords(gctx, tenantID, shopfloor.DowntimeFilter{LineID: p.LineID})
		return err
	})
	g.Go(func() error {
		return s.pool.WithTenant(gctx, tenantID, func(tx pgx.Tx) error {
			rows, err := tx.Query(gctx,
				`SELECT `+handoverColumns+` FROM shift_handover
				  WHERE tenant_id = $1 AND line_id = $2
				    AND (shift_date < $3::date OR (shift_date = $3::date AND shift_id <> $4))
				  ORDER BY created_at DESC, id DESC LIMIT 1`, tenantID, p.LineID, shiftDate, shiftID)
			list, err := collectHandovers(rows, err)
			if err != nil {
				return err
			}
			if len(list) > 0 {
				previous = &list[0]
			}
			return nil
		})
	})
	if err := g.Wait(); err != nil {
		return HandoverContext{}, err
	}

	lineOrders := []production.WorkOrder{}
	orderIDs := map[string]bool{}
	for _, wo := range workOrders {
		if wo.LineID == p.LineID {
			lineOrders = append(lineOrders, wo)
			orderIDs[wo.ID] = true
		}
	}
	good, reject := 0, 0
	rejectPairs := [][2]any{}
	for _, r := range records {
		if r.ShiftDate != shiftDate || r.ShiftID != shiftID || !orderIDs[r.WorkOrderID] {
			continue
		}
		good += r.GoodQuantity
		reject += r.RejectQuantity
		if r.RejectReasonID != nil && r.RejectQuantity > 0 {
			rejectPairs = append(rejectPairs, [2]any{*r.RejectReasonID, float64(r.RejectQuantity)})
		}
	}
	total := good + reject

	target := 0
	for _, wo := range lineOrders {
		if wo.Status != production.StatusCancelled {
			target += wo.PlannedQuantity
		}
	}
	downtimeSeconds, unplannedSeconds, activeDowntime := 0, 0, 0
	downtimePairs := [][2]any{}
	for _, d := range downtimes {
		if d.ShiftDate != shiftDate || d.ShiftID != shiftID {
			continue
		}
		seconds := db.Deref(d.DurationSeconds, 0)
		downtimeSeconds += seconds
		if !d.IsPlanned {
			unplannedSeconds += seconds
		}
		if d.Status == "ACTIVE" {
			activeDowntime++
		}
		downtimePairs = append(downtimePairs, [2]any{d.ReasonID, float64(seconds)})
	}

	reasonName := func(id *string, kind string) (*string, error) {
		if id == nil {
			return nil, nil
		}
		name := *id
		if kind == "downtime" {
			reasons, err := s.master.DowntimeReasons(ctx, tenantID)
			if err != nil {
				return nil, err
			}
			for _, r := range reasons {
				if r.ID == *id {
					name = r.Name
				}
			}
		} else {
			reasons, err := s.master.RejectReasons(ctx, tenantID)
			if err != nil {
				return nil, err
			}
			for _, r := range reasons {
				if r.ID == *id {
					name = r.Name
				}
			}
		}
		return &name, nil
	}
	topDowntime, err := reasonName(rankTop(downtimePairs), "downtime")
	if err != nil {
		return HandoverContext{}, err
	}
	topReject, err := reasonName(rankTop(rejectPairs), "reject")
	if err != nil {
		return HandoverContext{}, err
	}

	products, err := s.master.Products(ctx, tenantID)
	if err != nil {
		return HandoverContext{}, err
	}
	open := []OpenWorkOrder{}
	for _, wo := range lineOrders {
		if wo.Status != production.StatusInProduction && wo.Status != production.StatusConfirmed && wo.Status != production.StatusScheduled {
			continue
		}
		productName := wo.ProductID
		for _, pr := range products {
			if pr.ID == wo.ProductID {
				productName = pr.Name
				break
			}
		}
		pct := 0.0
		if wo.PlannedQuantity > 0 {
			pct = jsnum.Round1(float64(wo.OutputQuantity) / float64(wo.PlannedQuantity) * 100)
		}
		open = append(open, OpenWorkOrder{ID: wo.ID, WoNumber: wo.WoNumber, ProductName: productName, Status: wo.Status, AchievementPct: pct})
	}

	achievement := 0.0
	if target > 0 {
		achievement = jsnum.Round1(float64(good) / float64(target) * 100)
	}
	rejectRate := 0.0
	if total > 0 {
		rejectRate = jsnum.ToFixed(float64(reject)/float64(total)*100, 2)
	}
	remaining := target - good
	if remaining < 0 {
		remaining = 0
	}
	return HandoverContext{
		LineID: p.LineID, LineName: line.Name, ShiftID: shiftID, ShiftName: shiftName, ShiftDate: shiftDate,
		TargetQuantity: target, GoodQuantity: good, RejectQuantity: reject, AchievementPct: achievement,
		RemainingTarget: remaining, RejectRatePct: rejectRate,
		DowntimeMinutes: jsnum.RoundInt(float64(downtimeSeconds) / 60), UnplannedDowntimeMinutes: jsnum.RoundInt(float64(unplannedSeconds) / 60),
		TopDowntimeReason: topDowntime, TopRejectReason: topReject, OpenWorkOrders: open,
		ActiveDowntimeCount: activeDowntime, PreviousHandover: previous,
	}, nil
}

// List reads handovers, newest first.
func (s *HandoverService) List(ctx context.Context, tenantID, lineID, shiftDate string) ([]HandoverRecord, error) {
	var out []HandoverRecord
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			`SELECT `+handoverColumns+` FROM shift_handover
			  WHERE tenant_id = $1 AND ($2 = '' OR line_id = $2) AND ($3 = '' OR shift_date = NULLIF($3, '')::date)
			  ORDER BY created_at DESC, id DESC LIMIT 500`, tenantID, lineID, shiftDate)
		out, err = collectHandovers(rows, err)
		return err
	})
	return out, err
}

// CreateHandoverInput is a new or refreshed handover.
type CreateHandoverInput struct {
	LineID                 string
	ShiftID                string
	ShiftDate              string
	OutgoingSupervisorID   string
	OutgoingSupervisorName string
	IncomingSupervisorID   *string
	IncomingSupervisorName *string
	Notes                  string
	OpenIssues             []string
}

// Create stores a handover; one per line per shift per day, so a second
// one refreshes the first rather than leaving two notes.
func (s *HandoverService) Create(ctx context.Context, tenantID string, in CreateHandoverInput) (HandoverRecord, error) {
	line, err := s.master.LineByID(ctx, tenantID, in.LineID)
	if err != nil {
		return HandoverRecord{}, err
	}
	if line == nil {
		return HandoverRecord{}, httpx.NotFound("Production line tidak ditemukan.")
	}
	shiftDate, err := time.Parse("2006-01-02", in.ShiftDate)
	if err != nil {
		return HandoverRecord{}, httpx.Validation("shiftDate harus berformat YYYY-MM-DD.",
			httpx.FieldError{Field: "shiftDate", Code: "INVALID_FORMAT", Message: "Gunakan format YYYY-MM-DD."})
	}
	var out HandoverRecord
	err = s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var issues []byte
		if in.OpenIssues != nil {
			if issues, err = db.JSONB(in.OpenIssues); err != nil {
				return err
			}
		}
		rows, err := tx.Query(ctx,
			`INSERT INTO shift_handover (id, tenant_id, line_id, shift_id, shift_date, outgoing_supervisor_id, outgoing_supervisor_name,
			   incoming_supervisor_id, incoming_supervisor_name, notes, open_issues, created_at)
			 VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8, $9, $10, COALESCE($11::jsonb, '[]'::jsonb), CURRENT_TIMESTAMP)
			 ON CONFLICT (tenant_id, line_id, shift_id, shift_date) DO UPDATE SET
			   notes = EXCLUDED.notes,
			   open_issues = COALESCE($11::jsonb, shift_handover.open_issues),
			   incoming_supervisor_id = COALESCE(EXCLUDED.incoming_supervisor_id, shift_handover.incoming_supervisor_id),
			   incoming_supervisor_name = COALESCE(EXCLUDED.incoming_supervisor_name, shift_handover.incoming_supervisor_name)
			 RETURNING `+handoverColumns,
			fmt.Sprintf("hnd-%d", time.Now().UnixMilli()), tenantID, in.LineID, in.ShiftID, shiftDate,
			in.OutgoingSupervisorID, in.OutgoingSupervisorName, in.IncomingSupervisorID, in.IncomingSupervisorName, in.Notes, issues)
		list, err := collectHandovers(rows, err)
		if err != nil {
			return err
		}
		out = list[0]
		return nil
	})
	return out, err
}

// Acknowledge records the incoming supervisor's acceptance.
func (s *HandoverService) Acknowledge(ctx context.Context, tenantID, id, incomingID, incomingName string) (HandoverRecord, error) {
	var out []HandoverRecord
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			`UPDATE shift_handover SET incoming_supervisor_id = $3, incoming_supervisor_name = $4, acknowledged_at = CURRENT_TIMESTAMP
			  WHERE tenant_id = $1 AND id = $2 RETURNING `+handoverColumns, tenantID, id, incomingID, incomingName)
		out, err = collectHandovers(rows, err)
		return err
	})
	if err != nil {
		return HandoverRecord{}, err
	}
	if len(out) == 0 {
		return HandoverRecord{}, httpx.NotFound("Catatan handover tidak ditemukan.")
	}
	return out[0], nil
}

// MountHandover registers the handover routes and /shifts/performance.
// Registered before /shifts/{id} so /shifts/handover is never read as an id.
func MountHandover(r chi.Router, svc *HandoverService, master *masterdata.Service, auditor audit.Recorder) {
	tenant := func(r *http.Request) string { return tenancy.TenantID(r.Context()) }

	r.Get("/shifts/handover/context", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		lineID := httpx.QueryStr(r, "lineId")
		if lineID == "" {
			return httpx.Validation("lineId wajib diisi.")
		}
		out, err := svc.BuildContext(r.Context(), tenant(r), ContextParams{
			LineID: lineID, ShiftID: httpx.QueryPtr(r, "shiftId"), ShiftDate: httpx.QueryPtr(r, "shiftDate"),
		})
		if err != nil {
			return err
		}
		return httpx.OK(w, out)
	}))

	r.Get("/shifts/handover", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		list, err := svc.List(r.Context(), tenant(r), httpx.QueryStr(r, "lineId"), httpx.QueryStr(r, "shiftDate"))
		if err != nil {
			return err
		}
		return httpx.OK(w, list)
	}))

	r.Post("/shifts/handover", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		lineID := v.String("lineId", httpx.Opt{})
		shiftID := v.String("shiftId", httpx.Opt{})
		shiftDate := v.String("shiftDate", httpx.Opt{})
		notes := v.String("notes", httpx.Opt{Min: httpx.Min(1), Max: httpx.Max(2000)})
		openIssues := v.StringArray("openIssues", httpx.Opt{Optional: true})
		incomingID := v.String("incomingSupervisorId", httpx.Opt{Optional: true})
		incomingName := v.String("incomingSupervisorName", httpx.Opt{Optional: true})
		if err := v.Done(); err != nil {
			return err
		}
		p := auth.PrincipalFrom(r.Context())
		outgoingID, outgoingName := "system", "System"
		if p != nil {
			outgoingID, outgoingName = p.SubjectID, p.Name
		}
		if !v.Has("openIssues") {
			openIssues = nil
		}
		record, err := svc.Create(r.Context(), tenant(r), CreateHandoverInput{
			LineID: *lineID, ShiftID: *shiftID, ShiftDate: *shiftDate, OutgoingSupervisorID: outgoingID, OutgoingSupervisorName: outgoingName,
			IncomingSupervisorID: incomingID, IncomingSupervisorName: incomingName, Notes: *notes, OpenIssues: openIssues,
		})
		if err != nil {
			return err
		}
		auditor.RecordDetached(audit.FromRequest(r, "shift_handover", record.ID, "SHIFT_HANDOVER", nil,
			map[string]any{"lineId": record.LineID, "shiftId": record.ShiftID, "shiftDate": record.ShiftDate}))
		return httpx.Created(w, record)
	}))

	r.Post("/shifts/handover/{id}/acknowledge", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		p := auth.PrincipalFrom(r.Context())
		id, name := "system", "System"
		if p != nil {
			id, name = p.SubjectID, p.Name
		}
		record, err := svc.Acknowledge(r.Context(), tenant(r), chi.URLParam(r, "id"), id, name)
		if err != nil {
			return err
		}
		return httpx.OK(w, record)
	}))

	// US-022: shift performance, one context per line in the caller's
	// scope, gathered concurrently.
	r.Get("/shifts/performance", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		tenantID := tenant(r)
		var lines []string
		if lineID := httpx.QueryStr(r, "lineId"); lineID != "" {
			lines = []string{lineID}
		} else if p := auth.PrincipalFrom(r.Context()); p != nil && p.Scope.Level != "TENANT" {
			lines = p.Scope.LineIDs
		} else {
			all, err := master.Lines(r.Context(), tenantID)
			if err != nil {
				return err
			}
			for _, l := range all {
				lines = append(lines, l.ID)
			}
		}
		out := make([]HandoverContext, len(lines))
		g, gctx := errgroup.WithContext(r.Context())
		g.SetLimit(8)
		for i, id := range lines {
			g.Go(func() error {
				c, err := svc.BuildContext(gctx, tenantID, ContextParams{
					LineID: id, ShiftID: httpx.QueryPtr(r, "shiftId"), ShiftDate: httpx.QueryPtr(r, "shiftDate"),
				})
				if err != nil {
					return err
				}
				out[i] = c
				return nil
			})
		}
		if err := g.Wait(); err != nil {
			return err
		}
		if out == nil {
			out = []HandoverContext{}
		}
		return httpx.OK(w, out)
	}))
}
