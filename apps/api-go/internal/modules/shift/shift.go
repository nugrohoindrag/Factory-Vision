// Package shift is shift configuration (US-021). Handover (US-023) joins it
// with the execution core, because a handover context is built from
// production and downtime records.
//
// Mounted under /shifts rather than /master/shifts because a handover is an
// operational transaction, not master data: the console's supervisor area
// and its settings area both read from here.
package shift

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/audit"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/masterdata"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/httpx"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/tenancy"
)

// Mount registers the shift configuration routes.
func Mount(r chi.Router, master *masterdata.Service, auditor audit.Recorder) {
	r.Get("/shifts", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		shifts, err := master.Shifts(r.Context(), tenancy.TenantID(r.Context()))
		if err != nil {
			return err
		}
		return httpx.OK(w, shifts)
	}))

	r.Post("/shifts", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		plantID := v.String("plantId", httpx.Opt{})
		name := v.String("name", httpx.Opt{Min: httpx.Min(2), Max: httpx.Max(60)})
		startTime := v.ClockTime("startTime", httpx.Opt{})
		endTime := v.ClockTime("endTime", httpx.Opt{})
		breakMinutes := v.Int("breakMinutes", httpx.Opt{Min: httpx.Min(0), Max: httpx.Max(480), Optional: true})
		active := v.Boolean("active", httpx.Opt{Optional: true})
		targetQuantity := v.Number("targetQuantity", httpx.Opt{Min: httpx.Min(0), Optional: true})
		if err := v.Done(); err != nil {
			return err
		}
		tenantID := tenancy.TenantID(r.Context())
		shift := masterdata.Shift{
			PlantID: *plantID, Name: *name, StartTime: *startTime, EndTime: *endTime,
			BreakMinutes: 0, Active: true,
		}
		if breakMinutes != nil {
			shift.BreakMinutes = *breakMinutes
		}
		if active != nil {
			shift.Active = *active
		}
		created, err := master.CreateShift(r.Context(), tenantID, shift)
		if err != nil {
			return err
		}
		next := map[string]any{
			"id": created.ID, "tenantId": created.TenantID, "plantId": created.PlantID, "name": created.Name,
			"startTime": created.StartTime, "endTime": created.EndTime, "breakMinutes": created.BreakMinutes,
			"crossesMidnight": created.CrossesMidnight, "active": created.Active, "targetQuantity": targetQuantity,
		}
		if _, err := auditor.Record(r.Context(), audit.FromRequest(r, "shift", created.ID, "CREATE", nil, next)); err != nil {
			return err
		}
		return httpx.Created(w, created)
	}))

	r.Put("/shifts/{id}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		tenantID := tenancy.TenantID(r.Context())
		before, err := master.ShiftByID(r.Context(), tenantID, chi.URLParam(r, "id"))
		if err != nil {
			return err
		}
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		v.String("name", httpx.Opt{Optional: true, Min: httpx.Min(2), Max: httpx.Max(60)})
		v.ClockTime("startTime", httpx.Opt{Optional: true})
		v.ClockTime("endTime", httpx.Opt{Optional: true})
		v.Int("breakMinutes", httpx.Opt{Min: httpx.Min(0), Max: httpx.Max(480), Optional: true})
		v.Boolean("active", httpx.Opt{Optional: true})
		if err := v.Done(); err != nil {
			return err
		}
		patch := masterdata.Patch{}
		for _, key := range []string{"name", "startTime", "endTime", "breakMinutes", "active"} {
			if val, ok := body[key]; ok && val != nil && val != "" {
				patch[key] = val
			}
		}
		updated, err := master.UpdateShift(r.Context(), tenantID, chi.URLParam(r, "id"), patch)
		if err != nil {
			return err
		}
		var previous any
		if before != nil {
			previous = before
		}
		if _, err := auditor.Record(r.Context(), audit.FromRequest(r, "shift", updated.ID, "UPDATE", previous, updated)); err != nil {
			return err
		}
		return httpx.OK(w, updated)
	}))

	r.Delete("/shifts/{id}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		tenantID := tenancy.TenantID(r.Context())
		before, err := master.ShiftByID(r.Context(), tenantID, chi.URLParam(r, "id"))
		if err != nil {
			return err
		}
		if err := master.DeleteShift(r.Context(), tenantID, chi.URLParam(r, "id")); err != nil {
			return err
		}
		var previous any
		if before != nil {
			previous = before
		}
		if _, err := auditor.Record(r.Context(), audit.FromRequest(r, "shift", chi.URLParam(r, "id"), "DELETE", previous, nil)); err != nil {
			return err
		}
		return httpx.OK(w, map[string]any{"success": true, "message": "Shift dihapus."})
	}))
}
