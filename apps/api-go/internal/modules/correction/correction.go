// Package correction is the data correction workflow (US-042, US-043).
//
// A correction never overwrites history: the original value is retained on
// the request, derived metrics are recomputed rather than hand-adjusted,
// and the whole thing is auditable years later even though the number on
// the dashboard changed. Requests were held in process memory by the Node
// API; here they are rows of correction_request.
package correction

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/audit"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/production"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/auth"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/db"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/httpx"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/tenancy"
)

// WindowHours: beyond this many hours after the shift, approval is required.
const WindowHours = 24

// CorrectableFields is what may be corrected, by entity type.
var CorrectableFields = map[string][]string{
	"PRODUCTION_RECORD": {"goodQuantity", "rejectQuantity", "rejectReasonId", "notes"},
	"DOWNTIME_RECORD":   {"reasonId", "startTime", "endTime", "durationSeconds", "notes"},
}

// Request is one correction, field for field the TypeScript CorrectionRequest.
type Request struct {
	ID               string                    `json:"id"`
	TenantID         string                    `json:"tenantId"`
	EntityType       string                    `json:"entityType"`
	EntityID         string                    `json:"entityId"`
	ShiftDate        string                    `json:"shiftDate"`
	FieldChanges     map[string]map[string]any `json:"fieldChanges"`
	Reason           string                    `json:"reason"`
	RequestedBy      string                    `json:"requestedBy"`
	RequestedAt      string                    `json:"requestedAt"`
	RequiresApproval bool                      `json:"requiresApproval"`
	ApprovedBy       *string                   `json:"approvedBy,omitempty"`
	ApprovedAt       *string                   `json:"approvedAt,omitempty"`
	RejectedBy       *string                   `json:"rejectedBy,omitempty"`
	RejectedAt       *string                   `json:"rejectedAt,omitempty"`
	Status           string                    `json:"status"`
	AppliedAt        *string                   `json:"appliedAt,omitempty"`
}

// Window is where a shift date stands against the correction window.
type Window struct {
	Closed       bool     `json:"closed"`
	WithinWindow bool     `json:"withinWindow"`
	HoursElapsed *float64 `json:"hoursElapsed"` // nil for an unparseable date (Infinity in Node)
}

// CalcVersionSource is the OEE definition version stamped on an applied
// correction, so a changed report can be traced to it.
type CalcVersionSource interface {
	CalcVersion(ctx context.Context, tenantID string) (int, error)
}

// Service is the workflow.
type Service struct {
	pool       *db.Pool
	production *production.Service
	audit      audit.Recorder
	oee        CalcVersionSource
	now        func() time.Time
}

// NewService wires the workflow; oee may be attached later.
func NewService(pool *db.Pool, prod *production.Service, auditor audit.Recorder) *Service {
	return &Service{pool: pool, production: prod, audit: auditor, now: time.Now}
}

// AttachOee connects the calc version source.
func (s *Service) AttachOee(o CalcVersionSource) { s.oee = o }

const columns = `id, tenant_id, entity_type, entity_id, to_char(shift_date, 'YYYY-MM-DD'), field_changes, reason,
  requested_by, requested_at, requires_approval, approved_by, approved_at, rejected_by, rejected_at, status, applied_at`

func scan(rows pgx.Rows) (Request, error) {
	var (
		c                                 Request
		changes                           []byte
		requestedAt                       *time.Time
		approvedAt, rejectedAt, appliedAt *time.Time
		requiresApproval                  *bool
		status                            *string
	)
	if err := rows.Scan(&c.ID, &c.TenantID, &c.EntityType, &c.EntityID, &c.ShiftDate, &changes, &c.Reason,
		&c.RequestedBy, &requestedAt, &requiresApproval, &c.ApprovedBy, &approvedAt, &c.RejectedBy, &rejectedAt, &status, &appliedAt); err != nil {
		return c, err
	}
	c.FieldChanges = map[string]map[string]any{}
	if m, ok := db.RawJSON(changes).(map[string]any); ok {
		for field, change := range m {
			if cm, ok := change.(map[string]any); ok {
				c.FieldChanges[field] = cm
			}
		}
	}
	if requestedAt != nil {
		c.RequestedAt = db.ISO(*requestedAt)
	}
	c.RequiresApproval = db.Deref(requiresApproval, true)
	c.Status = db.StrOr(status, "PENDING")
	c.ApprovedAt, c.RejectedAt, c.AppliedAt = db.ISOPtr(approvedAt), db.ISOPtr(rejectedAt), db.ISOPtr(appliedAt)
	c.ApprovedBy, c.RejectedBy = db.Str(c.ApprovedBy), db.Str(c.RejectedBy)
	return c, nil
}

func collect(rows pgx.Rows, err error) ([]Request, error) {
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Request{}
	for rows.Next() {
		c, err := scan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *Service) find(ctx context.Context, tx pgx.Tx, tenantID, id string) (*Request, error) {
	rows, err := tx.Query(ctx, `SELECT `+columns+` FROM correction_request WHERE tenant_id = $1 AND id = $2`, tenantID, id)
	list, err := collect(rows, err)
	if err != nil || len(list) == 0 {
		return nil, err
	}
	return &list[0], nil
}

// List reads a tenant's corrections, oldest first, optionally by status.
func (s *Service) List(ctx context.Context, tenantID, status string) ([]Request, error) {
	var out []Request
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		where := "tenant_id = $1"
		params := []any{tenantID}
		if status != "" {
			where += " AND status = $2"
			params = append(params, status)
		}
		rows, err := tx.Query(ctx, `SELECT `+columns+` FROM correction_request WHERE `+where+` ORDER BY requested_at ASC, id ASC LIMIT 5000`, params...)
		out, err = collect(rows, err)
		return err
	})
	return out, err
}

// AssessWindow is whether a correction is inside the free window: a
// supervisor fixes an active shift outright, a manager has 24 hours on a
// closed shift, after which a second pair of eyes is required.
func (s *Service) AssessWindow(shiftDate string) Window {
	end, err := time.Parse("2006-01-02", shiftDate)
	if err != nil {
		return Window{Closed: true, WithinWindow: false, HoursElapsed: nil}
	}
	shiftEnd := end.Add(24*time.Hour - time.Millisecond)
	hours := s.now().Sub(shiftEnd).Hours()
	return Window{Closed: hours > 0, WithinWindow: hours <= WindowHours, HoursElapsed: &hours}
}

// CreateInput is a new request.
type CreateInput struct {
	EntityType    string
	EntityID      string
	ShiftDate     string
	FieldChanges  map[string]map[string]any
	Reason        string
	RequestedBy   string
	RequestedByID string
	Permissions   []string
}

func hasPermission(perms []string, p string) bool {
	for _, x := range perms {
		if x == p {
			return true
		}
	}
	return false
}

func fromTo(changes map[string]map[string]any, key string) map[string]any {
	out := map[string]any{}
	fields := make([]string, 0, len(changes))
	for f := range changes {
		fields = append(fields, f)
	}
	sort.Strings(fields)
	for _, f := range fields {
		out[f] = changes[f][key]
	}
	return out
}

// Create files a request; inside the window an authorised user's
// correction applies immediately, outside it the same correction waits.
func (s *Service) Create(ctx context.Context, tenantID string, in CreateInput) (Request, error) {
	allowed := CorrectableFields[in.EntityType]
	var illegal []string
	fields := make([]string, 0, len(in.FieldChanges))
	for f := range in.FieldChanges {
		fields = append(fields, f)
	}
	sort.Strings(fields)
	for _, f := range fields {
		if !contains(allowed, f) {
			illegal = append(illegal, f)
		}
	}
	if len(illegal) > 0 {
		errs := make([]httpx.FieldError, len(illegal))
		for i, f := range illegal {
			errs[i] = httpx.FieldError{Field: f, Code: "NOT_CORRECTABLE", Message: f + " bukan field yang dapat dikoreksi menurut"}
		}
		return Request{}, httpx.Validation(fmt.Sprintf("Field berikut tidak dapat dikoreksi: %s.", strings.Join(illegal, ", ")), errs...)
	}
	if len(in.FieldChanges) == 0 {
		return Request{}, httpx.Validation("Tidak ada perubahan yang diajukan.")
	}
	if len(strings.TrimSpace(in.Reason)) < 5 {
		return Request{}, httpx.Validation("Alasan koreksi wajib diisi.",
			httpx.FieldError{Field: "reason", Code: "REQUIRED", Message: "Jelaskan alasan koreksi minimal 5 karakter."})
	}

	window := s.AssessWindow(in.ShiftDate)
	canApprove := hasPermission(in.Permissions, "correction:approve")
	requiresApproval := !window.WithinWindow || !canApprove

	changes, err := db.JSONB(in.FieldChanges)
	if err != nil {
		return Request{}, err
	}
	shiftDate, err := time.Parse("2006-01-02", in.ShiftDate)
	if err != nil {
		return Request{}, httpx.Validation("shiftDate harus berformat YYYY-MM-DD.",
			httpx.FieldError{Field: "shiftDate", Code: "INVALID_FORMAT", Message: "Gunakan format YYYY-MM-DD."})
	}
	var created Request
	if err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			`INSERT INTO correction_request (id, tenant_id, entity_type, entity_id, shift_date, field_changes, reason,
			   requested_by, requested_at, requires_approval, status)
			 VALUES ($1,$2,$3,$4,$5::date,$6::jsonb,$7,$8,$9,$10,'PENDING') RETURNING `+columns,
			fmt.Sprintf("corr-%d", s.now().UnixMilli()), tenantID, in.EntityType, in.EntityID, shiftDate, changes, in.Reason,
			in.RequestedBy, s.now(), requiresApproval)
		list, err := collect(rows, err)
		if err != nil {
			return err
		}
		created = list[0]
		return nil
	}); err != nil {
		return Request{}, err
	}

	actorID := in.RequestedByID
	if actorID == "" {
		actorID = in.RequestedBy
	}
	hours := math.Inf(1)
	if window.HoursElapsed != nil {
		hours = math.Round(*window.HoursElapsed*10) / 10
	}
	var hoursValue any = nil
	if !math.IsInf(hours, 0) {
		hoursValue = hours
	}
	s.audit.RecordDetached(audit.Entry{
		TenantID: tenantID, ActorType: "USER", ActorID: actorID, EntityType: "correction_request", EntityID: created.ID,
		Action: "CORRECTION_REQUESTED", PreviousValue: fromTo(in.FieldChanges, "from"),
		NewValue: map[string]any{"changes": fromTo(in.FieldChanges, "to"), "shiftDate": in.ShiftDate, "requiresApproval": requiresApproval, "hoursSinceShift": hoursValue},
	})

	if !requiresApproval {
		return s.apply(ctx, tenantID, created, in.RequestedBy, in.RequestedByID)
	}
	return created, nil
}

// Approve applies a PENDING correction.
func (s *Service) Approve(ctx context.Context, tenantID, id, approvedBy, approvedByID string) (Request, error) {
	var corr *Request
	if err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		corr, err = s.find(ctx, tx, tenantID, id)
		if err != nil {
			return err
		}
		if corr == nil {
			return httpx.NotFound("Permintaan koreksi tidak ditemukan.")
		}
		if corr.Status != "PENDING" {
			return httpx.InvalidState(fmt.Sprintf("Koreksi berstatus %s tidak dapat disetujui lagi.", corr.Status))
		}
		rows, err := tx.Query(ctx,
			`UPDATE correction_request SET status = 'APPROVED', approved_by = $3, approved_at = $4
			  WHERE tenant_id = $1 AND id = $2 RETURNING `+columns, tenantID, id, approvedBy, s.now())
		list, err := collect(rows, err)
		if err != nil {
			return err
		}
		corr = &list[0]
		return nil
	}); err != nil {
		return Request{}, err
	}
	return s.apply(ctx, tenantID, *corr, approvedBy, approvedByID)
}

func number(v any) float64 {
	switch n := v.(type) {
	case float64:
		return n
	case int:
		return float64(n)
	case string:
		f, err := strconv.ParseFloat(strings.TrimSpace(n), 64)
		if err != nil {
			return math.NaN()
		}
		return f
	case nil:
		return 0
	}
	return math.NaN()
}

func diff(changes map[string]map[string]any, field string) int {
	change, ok := changes[field]
	if !ok {
		return 0
	}
	d := number(change["to"]) - number(change["from"])
	if math.IsNaN(d) {
		return 0
	}
	return int(d)
}

// apply moves the aggregate the reports read from and stamps the record
// APPLIED. History is already intact on fieldChanges[...].from.
func (s *Service) apply(ctx context.Context, tenantID string, corr Request, actor, actorID string) (Request, error) {
	if corr.EntityType == "PRODUCTION_RECORD" {
		goodDiff, rejectDiff := diff(corr.FieldChanges, "goodQuantity"), diff(corr.FieldChanges, "rejectQuantity")
		if goodDiff != 0 || rejectDiff != 0 {
			// Input moves with the dispositions it accounts for (§10).
			if err := s.production.IncrementQuantities(ctx, tenantID, corr.EntityID, production.Increment{
				Good: goodDiff, Reject: rejectDiff, Input: goodDiff + rejectDiff,
			}); err != nil {
				return Request{}, err
			}
		}
	}
	var applied Request
	if err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			`UPDATE correction_request SET status = 'APPLIED', applied_at = $3
			  WHERE tenant_id = $1 AND id = $2 RETURNING `+columns, tenantID, corr.ID, s.now())
		list, err := collect(rows, err)
		if err != nil {
			return err
		}
		applied = list[0]
		return nil
	}); err != nil {
		return Request{}, err
	}

	var calcVersion any
	if s.oee != nil {
		if v, err := s.oee.CalcVersion(ctx, tenantID); err == nil {
			calcVersion = v
		}
	}
	if actorID == "" {
		actorID = actor
	}
	s.audit.RecordDetached(audit.Entry{
		TenantID: tenantID, ActorType: "USER", ActorID: actorID, EntityType: "correction_request", EntityID: corr.ID,
		Action: "CORRECTION_APPLIED", PreviousValue: fromTo(corr.FieldChanges, "from"),
		NewValue: map[string]any{"changes": fromTo(corr.FieldChanges, "to"), "correctionOfId": corr.EntityID, "recomputed": true, "calcVersion": calcVersion},
	})
	return applied, nil
}

// Reject refuses a request that has not been applied.
func (s *Service) Reject(ctx context.Context, tenantID, id, rejectedBy, rejectedByID string) (Request, error) {
	var corr Request
	if err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		current, err := s.find(ctx, tx, tenantID, id)
		if err != nil {
			return err
		}
		if current == nil {
			return httpx.NotFound("Permintaan koreksi tidak ditemukan.")
		}
		if current.Status == "APPLIED" {
			return httpx.InvalidState("Koreksi yang sudah diterapkan tidak dapat ditolak.")
		}
		rows, err := tx.Query(ctx,
			`UPDATE correction_request SET status = 'REJECTED', rejected_by = $3, rejected_at = $4
			  WHERE tenant_id = $1 AND id = $2 RETURNING `+columns, tenantID, id, rejectedBy, s.now())
		list, err := collect(rows, err)
		if err != nil {
			return err
		}
		corr = list[0]
		return nil
	}); err != nil {
		return Request{}, err
	}
	if rejectedByID == "" {
		rejectedByID = rejectedBy
	}
	s.audit.RecordDetached(audit.Entry{
		TenantID: tenantID, ActorType: "USER", ActorID: rejectedByID, EntityType: "correction_request", EntityID: corr.ID,
		Action: "CORRECTION_REJECTED", PreviousValue: map[string]any{"status": "PENDING"}, NewValue: map[string]any{"status": "REJECTED"},
	})
	return corr, nil
}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

// Mount registers the /corrections routes.
func Mount(r chi.Router, svc *Service) {
	r.Get("/corrections", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		list, err := svc.List(r.Context(), tenancy.TenantID(r.Context()), httpx.QueryStr(r, "status"))
		if err != nil {
			return err
		}
		return httpx.OK(w, list)
	}))

	r.Post("/corrections", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		entityType := v.OneOf("entityType", []string{"PRODUCTION_RECORD", "DOWNTIME_RECORD"}, httpx.Opt{})
		entityID := v.String("entityId", httpx.Opt{Max: httpx.Max(64)})
		shiftDate := v.String("shiftDate", httpx.Opt{})
		reason := v.String("reason", httpx.Opt{Optional: true, Max: httpx.Max(2000)})
		requestedBy := v.String("requestedBy", httpx.Opt{Optional: true, Max: httpx.Max(64)})
		if err := v.Done(); err != nil {
			return err
		}
		changes := map[string]map[string]any{}
		if raw, ok := body["fieldChanges"].(map[string]any); ok {
			for field, change := range raw {
				if cm, ok := change.(map[string]any); ok {
					changes[field] = cm
				} else {
					changes[field] = map[string]any{}
				}
			}
		}
		p := auth.PrincipalFrom(r.Context())
		by := "System"
		byID := ""
		var perms []string
		if p != nil {
			by, byID, perms = p.Name, p.SubjectID, p.Permissions
		}
		if requestedBy != nil {
			by = *requestedBy
		}
		corr, err := svc.Create(r.Context(), tenancy.TenantID(r.Context()), CreateInput{
			EntityType: *entityType, EntityID: *entityID, ShiftDate: *shiftDate, FieldChanges: changes,
			Reason: db.Deref(reason, ""), RequestedBy: by, RequestedByID: byID, Permissions: perms,
		})
		if err != nil {
			return err
		}
		return httpx.Created(w, corr)
	}))

	decide := func(action string) http.HandlerFunc {
		return httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
			body, err := httpx.Body(r)
			if err != nil {
				return err
			}
			p := auth.PrincipalFrom(r.Context())
			by, byID := "Supervisor", ""
			if p != nil {
				by, byID = p.Name, p.SubjectID
			}
			if s, ok := body[action+"By"].(string); ok && s != "" {
				by = s
			}
			var corr Request
			if action == "approved" {
				corr, err = svc.Approve(r.Context(), tenancy.TenantID(r.Context()), chi.URLParam(r, "id"), by, byID)
			} else {
				corr, err = svc.Reject(r.Context(), tenancy.TenantID(r.Context()), chi.URLParam(r, "id"), by, byID)
			}
			if err != nil {
				return err
			}
			return httpx.OK(w, corr)
		})
	}
	r.Post("/corrections/{id}/approve", decide("approved"))
	r.Post("/corrections/{id}/reject", decide("rejected"))

	r.Get("/corrections/policy", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		shiftDate := httpx.QueryStr(r, "shiftDate")
		if shiftDate == "" {
			shiftDate = db.Now()[:10]
		}
		window := svc.AssessWindow(shiftDate)
		p := auth.PrincipalFrom(r.Context())
		canApprove := p != nil && p.Has("correction:approve")
		return httpx.OK(w, map[string]any{
			"windowHours":  WindowHours,
			"shiftDate":    shiftDate,
			"closed":       window.Closed,
			"withinWindow": window.WithinWindow,
			"hoursElapsed": window.HoursElapsed,
			"canApprove":   canApprove,
			"correctableFields": map[string]any{
				"PRODUCTION_RECORD": CorrectableFields["PRODUCTION_RECORD"],
				"DOWNTIME_RECORD":   CorrectableFields["DOWNTIME_RECORD"],
			},
		})
	}))
}
