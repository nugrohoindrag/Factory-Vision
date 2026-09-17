package shopfloor

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/audit"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/auth"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/httpx"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/tenancy"
)

// Mount registers the /shop-floor routes.
func Mount(r chi.Router, svc *Service, auditor audit.Recorder) {
	r.Post("/shop-floor/output", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		in := OutputInput{
			MachineID:      v.String("machineId", httpx.Opt{Optional: true, Max: httpx.Max(64)}),
			ShiftID:        v.String("shiftId", httpx.Opt{Optional: true, Max: httpx.Max(64)}),
			RejectReasonID: v.String("rejectReasonId", httpx.Opt{Optional: true, Max: httpx.Max(64)}),
			Notes:          v.String("notes", httpx.Opt{Optional: true, Max: httpx.Max(2000)}),
		}
		workOrderID := v.String("workOrderId", httpx.Opt{Max: httpx.Max(64)})
		operatorID := v.String("operatorId", httpx.Opt{Max: httpx.Max(64)})
		good := v.Int("goodQuantity", httpx.Opt{})
		reject := v.Int("rejectQuantity", httpx.Opt{Optional: true})
		clientEventID := v.String("clientEventId", httpx.Opt{Max: httpx.Max(64)})
		occurredAt := v.String("occurredAt", httpx.Opt{})
		if err := v.Done(); err != nil {
			return err
		}
		in.WorkOrderID, in.OperatorID, in.GoodQuantity = *workOrderID, *operatorID, *good
		if reject != nil {
			in.RejectQuantity = *reject
		}
		in.ClientEventID, in.OccurredAt = *clientEventID, *occurredAt
		record, err := svc.RecordOutput(r.Context(), tenancy.TenantID(r.Context()), in)
		if err != nil {
			return err
		}
		return httpx.Created(w, record)
	}))

	r.Post("/shop-floor/downtime/start", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		in := DowntimeInput{
			LineID:      v.String("lineId", httpx.Opt{Optional: true, Max: httpx.Max(64)}),
			WorkOrderID: v.String("workOrderId", httpx.Opt{Optional: true, Max: httpx.Max(64)}),
			OperatorID:  v.String("operatorId", httpx.Opt{Optional: true, Max: httpx.Max(64)}),
			ShiftID:     v.String("shiftId", httpx.Opt{Optional: true, Max: httpx.Max(64)}),
			Notes:       v.String("notes", httpx.Opt{Optional: true, Max: httpx.Max(2000)}),
		}
		machineID := v.String("machineId", httpx.Opt{Max: httpx.Max(64)})
		reasonID := v.String("reasonId", httpx.Opt{Max: httpx.Max(64)})
		clientEventID := v.String("clientEventId", httpx.Opt{Max: httpx.Max(64)})
		occurredAt := v.String("occurredAt", httpx.Opt{})
		if err := v.Done(); err != nil {
			return err
		}
		in.MachineID, in.ReasonID, in.ClientEventID, in.OccurredAt = *machineID, *reasonID, *clientEventID, *occurredAt
		record, err := svc.StartDowntime(r.Context(), tenancy.TenantID(r.Context()), in)
		if err != nil {
			return err
		}
		return httpx.Created(w, record)
	}))

	r.Post("/shop-floor/downtime/{id}/resolve", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		clientEventID := v.String("clientEventId", httpx.Opt{Max: httpx.Max(64)})
		occurredAt := v.String("occurredAt", httpx.Opt{})
		if err := v.Done(); err != nil {
			return err
		}
		record, err := svc.ResolveDowntime(r.Context(), tenancy.TenantID(r.Context()), chi.URLParam(r, "id"),
			ResolveInput{ClientEventID: *clientEventID, OccurredAt: *occurredAt})
		if err != nil {
			return err
		}
		return httpx.OK(w, record)
	}))

	r.Get("/shop-floor/downtime", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		records, err := svc.DowntimeRecords(r.Context(), tenancy.TenantID(r.Context()), DowntimeFilter{LineID: httpx.QueryStr(r, "lineId")})
		if err != nil {
			return err
		}
		return httpx.OK(w, records)
	}))

	// Sync exceptions (MES-082): a list per line and per shift, because that
	// is how a supervisor works through a bad shift. Defaults to OPEN.
	r.Get("/shop-floor/sync-exceptions", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		status := httpx.QueryStr(r, "status")
		if status == "" {
			status = "OPEN"
		}
		list, err := svc.SyncExceptions(r.Context(), tenancy.TenantID(r.Context()), ExceptionFilter{
			LineID: httpx.QueryStr(r, "lineId"), ShiftDate: httpx.QueryStr(r, "shiftDate"),
			Status: status, WorkOrderID: httpx.QueryStr(r, "workOrderId"),
		})
		if err != nil {
			return err
		}
		return httpx.OK(w, list)
	}))

	r.Get("/shop-floor/sync-exceptions/summary", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		summary, err := svc.SyncExceptionSummary(r.Context(), tenancy.TenantID(r.Context()))
		if err != nil {
			return err
		}
		return httpx.OK(w, summary)
	}))

	r.Patch("/shop-floor/sync-exceptions/{id}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		status, _ := body["status"].(string)
		if status != "RESOLVED" && status != "IGNORED" && status != "OPEN" {
			return httpx.Validation("status harus RESOLVED, IGNORED atau OPEN.")
		}
		var note *string
		if s, ok := body["note"].(string); ok {
			note = &s
		}
		updated, err := svc.SetSyncExceptionStatus(r.Context(), tenancy.TenantID(r.Context()), chi.URLParam(r, "id"), status, auth.ActorID(r.Context()), note)
		if err != nil {
			return err
		}
		auditor.RecordDetached(audit.FromRequest(r, "sync_exception", updated.ID, "SYNC_EXCEPTION_"+status, nil, updated))
		return httpx.OK(w, updated)
	}))

	r.Post("/shop-floor/sync-batch", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		var body struct {
			Commands []SyncCommand `json:"commands"`
		}
		if err := httpx.Decode(r, &body); err != nil {
			return err
		}
		result, err := svc.SyncBatch(r.Context(), tenancy.TenantID(r.Context()), body.Commands)
		if err != nil {
			return err
		}
		return httpx.OK(w, result)
	}))
}
