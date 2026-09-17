package production

import (
	"context"
	"fmt"
	"math"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/audit"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/masterdata"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/auth"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/httpx"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/tenancy"
)

// DowntimeSource is what the start/complete preconditions need from the
// shop floor: whether a stop is still open.
type DowntimeSource interface {
	HasActiveDowntimeForMachine(ctx context.Context, tenantID, machineID string) (bool, error)
	HasActiveDowntimeForWorkOrder(ctx context.Context, tenantID, workOrderID string) (bool, error)
}

// DemandSource answers the read-only customer view of a work order
// (ADR-22); nil means the work order is not linked to a plan line.
type DemandSource interface {
	WorkOrderDemand(ctx context.Context, tenantID, workOrderID string) (any, error)
}

// Handler mounts the production routes.
type Handler struct {
	svc      *Service
	master   *masterdata.Service
	audit    audit.Recorder
	downtime DowntimeSource
	demand   DemandSource
}

// NewHandler wires the routes' dependencies. downtime and demand may be
// attached later.
func NewHandler(svc *Service, master *masterdata.Service, auditor audit.Recorder) *Handler {
	return &Handler{svc: svc, master: master, audit: auditor}
}

// AttachDowntime connects the shop floor's open-downtime reads.
func (h *Handler) AttachDowntime(d DowntimeSource) { h.downtime = d }

// AttachDemand connects planning's demand trace.
func (h *Handler) AttachDemand(d DemandSource) { h.demand = d }

func tenant(r *http.Request) string { return tenancy.TenantID(r.Context()) }

func (h *Handler) record(r *http.Request, entityType, entityID, action string, previous, next any) {
	h.audit.RecordDetached(audit.FromRequest(r, entityType, entityID, action, previous, next))
}

// Mount registers the routes under /api/v1.
func (h *Handler) Mount(r chi.Router) {
	h.mountProductionOrders(r)
	h.mountWorkOrders(r)
	h.mountBatches(r)
}

func (h *Handler) mountProductionOrders(r chi.Router) {
	r.Get("/production-orders", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		orders, err := h.svc.ProductionOrders(r.Context(), tenant(r))
		if err != nil {
			return err
		}
		return httpx.OK(w, orders)
	}))

	r.Get("/production-orders/{id}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		order, err := h.svc.ProductionOrderByID(r.Context(), tenant(r), chi.URLParam(r, "id"))
		if err != nil {
			return err
		}
		if order == nil {
			return httpx.NotFound("Production order not found")
		}
		return httpx.OK(w, order)
	}))

	r.Post("/production-orders", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		orderNumber := v.String("orderNumber", httpx.Opt{Max: httpx.Max(64)})
		productID := v.String("productId", httpx.Opt{Max: httpx.Max(64)})
		quantity := v.Int("quantity", httpx.Opt{Min: httpx.Min(0)})
		dueDate := v.ISODate("dueDate", httpx.Opt{})
		createdBy := v.String("createdBy", httpx.Opt{Optional: true, Max: httpx.Max(64)})
		if err := v.Done(); err != nil {
			return err
		}
		by := auth.ActorID(r.Context())
		if createdBy != nil {
			by = *createdBy
		}
		order, err := h.svc.CreateProductionOrder(r.Context(), tenant(r), CreateProductionOrderInput{
			OrderNumber: *orderNumber, ProductID: *productID, Quantity: *quantity, DueDate: *dueDate, CreatedBy: by,
		})
		if err != nil {
			return err
		}
		return httpx.Created(w, order)
	}))

	r.Post("/production-orders/{id}/release", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		tenantID := tenant(r)
		routings, err := h.master.Routings(r.Context(), tenantID, "")
		if err != nil {
			return err
		}
		forRelease := make([]RoutingForRelease, 0, len(routings))
		for _, rt := range routings {
			forRelease = append(forRelease, RoutingForRelease{
				ProductID: rt.ProductID, ProcessID: rt.ProcessID, Sequence: rt.Sequence,
				WorkCenterID: rt.WorkCenterID, MachineID: rt.MachineID, Active: rt.Active,
			})
		}
		order, err := h.svc.ReleaseProductionOrder(r.Context(), tenantID, chi.URLParam(r, "id"), forRelease)
		if err != nil {
			return err
		}
		return httpx.OK(w, order)
	}))

	r.Put("/production-orders/{id}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		p := ProductionOrderPatch{
			OrderNumber: v.String("orderNumber", httpx.Opt{Optional: true, Max: httpx.Max(64)}),
			ProductID:   v.String("productId", httpx.Opt{Optional: true, Max: httpx.Max(64)}),
			Quantity:    v.Int("quantity", httpx.Opt{Optional: true, Min: httpx.Min(0)}),
			DueDate:     v.ISODate("dueDate", httpx.Opt{Optional: true}),
			Status:      v.String("status", httpx.Opt{Optional: true, Max: httpx.Max(32)}),
		}
		if err := v.Done(); err != nil {
			return err
		}
		order, err := h.svc.UpdateProductionOrder(r.Context(), tenant(r), chi.URLParam(r, "id"), p)
		if err != nil {
			return err
		}
		return httpx.OK(w, order)
	}))

	r.Delete("/production-orders/{id}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		if err := h.svc.DeleteProductionOrder(r.Context(), tenant(r), chi.URLParam(r, "id")); err != nil {
			return err
		}
		return httpx.OK(w, map[string]any{"success": true, "message": "Production order deleted"})
	}))
}

func (h *Handler) mountWorkOrders(r chi.Router) {
	r.Get("/work-orders", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		all, err := h.svc.WorkOrders(r.Context(), tenant(r), WorkOrderFilter{
			LineID: httpx.QueryStr(r, "lineId"), Status: httpx.QueryStr(r, "status"), ProcessID: httpx.QueryStr(r, "processId"),
		})
		if err != nil {
			return err
		}
		// US-014: an operator sees only the work assigned to their line, and
		// US-003 narrows every other role to its scope.
		return httpx.OK(w, auth.FilterLines(auth.PrincipalFrom(r.Context()), all, func(wo WorkOrder) string { return wo.LineID }))
	}))

	r.Get("/work-orders/{id}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		wo, err := h.svc.WorkOrderByID(r.Context(), tenant(r), chi.URLParam(r, "id"))
		if err != nil {
			return err
		}
		if wo == nil {
			return httpx.NotFound("Work order tidak ditemukan.")
		}
		if err := auth.AssertLine(auth.PrincipalFrom(r.Context()), wo.LineID); err != nil {
			return err
		}
		return httpx.OK(w, wo)
	}))

	r.Post("/work-orders", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		in := CreateWorkOrderInput{
			ProductionOrderID:    v.String("productionOrderId", httpx.Opt{Optional: true, Max: httpx.Max(64)}),
			ProductionPlanLineID: v.String("productionPlanLineId", httpx.Opt{Optional: true, Max: httpx.Max(64)}),
			ProcessID:            v.String("processId", httpx.Opt{Optional: true, Max: httpx.Max(64)}),
			Sequence:             v.Int("sequence", httpx.Opt{Optional: true}),
			WorkCenterID:         v.String("workCenterId", httpx.Opt{Optional: true, Max: httpx.Max(64)}),
			MachineID:            v.String("machineId", httpx.Opt{Optional: true, Max: httpx.Max(64)}),
			ShiftID:              v.String("shiftId", httpx.Opt{Optional: true, Max: httpx.Max(64)}),
			MoldID:               v.String("moldId", httpx.Opt{Optional: true, Max: httpx.Max(64)}),
			Unit:                 v.String("unit", httpx.Opt{Optional: true, Max: httpx.Max(32)}),
			Priority:             v.Int("priority", httpx.Opt{Optional: true}),
		}
		productID := v.String("productId", httpx.Opt{Max: httpx.Max(64)})
		lineID := v.String("lineId", httpx.Opt{Max: httpx.Max(64)})
		target := v.Int("targetQuantity", httpx.Opt{Min: httpx.Min(0)})
		plannedStart := v.String("plannedStart", httpx.Opt{})
		plannedEnd := v.String("plannedEnd", httpx.Opt{})
		if err := v.Done(); err != nil {
			return err
		}
		in.ProductID, in.LineID, in.TargetQuantity = *productID, *lineID, *target
		in.PlannedStart, in.PlannedEnd = *plannedStart, *plannedEnd
		wo, err := h.svc.CreateWorkOrder(r.Context(), tenant(r), in)
		if err != nil {
			return err
		}
		h.record(r, "work_order", wo.ID, "CREATE", nil, wo)
		return httpx.Created(w, wo)
	}))

	r.Put("/work-orders/{id}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		p := Patch{
			PlannedStart: v.String("plannedStart", httpx.Opt{Optional: true}),
			PlannedEnd:   v.String("plannedEnd", httpx.Opt{Optional: true}),
			Priority:     v.Int("priority", httpx.Opt{Optional: true}),
			MachineID:    v.String("machineId", httpx.Opt{Optional: true, Max: httpx.Max(64)}),
			MoldID:       v.String("moldId", httpx.Opt{Optional: true, Max: httpx.Max(64)}),
			ShiftID:      v.String("shiftId", httpx.Opt{Optional: true, Max: httpx.Max(64)}),
			ProcessID:    v.String("processId", httpx.Opt{Optional: true, Max: httpx.Max(64)}),
			LineID:       v.String("lineId", httpx.Opt{Optional: true, Max: httpx.Max(64)}),
			WorkCenterID: v.String("workCenterId", httpx.Opt{Optional: true, Max: httpx.Max(64)}),
			ProductID:    v.String("productId", httpx.Opt{Optional: true, Max: httpx.Max(64)}),
			Sequence:     v.Int("sequence", httpx.Opt{Optional: true}),
			Unit:         v.String("unit", httpx.Opt{Optional: true, Max: httpx.Max(32)}),
		}
		// targetQuantity is the deprecated alias of plannedQuantity (ADR-23).
		planned := v.Int("plannedQuantity", httpx.Opt{Optional: true})
		target := v.Int("targetQuantity", httpx.Opt{Optional: true})
		status := v.String("status", httpx.Opt{Optional: true, Max: httpx.Max(32)})
		if err := v.Done(); err != nil {
			return err
		}
		if target != nil {
			p.PlannedQuantity = target
		}
		if planned != nil {
			p.PlannedQuantity = planned
		}
		wo, err := h.svc.UpdateWorkOrder(r.Context(), tenant(r), chi.URLParam(r, "id"), p, status)
		if err != nil {
			return err
		}
		h.record(r, "work_order", wo.ID, "UPDATE", nil, wo)
		return httpx.OK(w, wo)
	}))

	r.Delete("/work-orders/{id}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		id := chi.URLParam(r, "id")
		if err := h.svc.DeleteWorkOrder(r.Context(), tenant(r), id); err != nil {
			return err
		}
		h.record(r, "work_order", id, "DELETE", nil, nil)
		return httpx.OK(w, map[string]any{"success": true, "message": "Work order deleted successfully"})
	}))

	confirm := httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		tenantID := tenant(r)
		before, err := h.svc.WorkOrderByID(r.Context(), tenantID, chi.URLParam(r, "id"))
		if err != nil {
			return err
		}
		if before == nil {
			return httpx.NotFound("Work order tidak ditemukan.")
		}
		p := auth.PrincipalFrom(r.Context())
		if err := auth.AssertLine(p, before.LineID); err != nil {
			return err
		}
		confirmedBy := "Supervisor"
		if p != nil {
			confirmedBy = p.SubjectID
		}
		wo, err := h.svc.ConfirmWorkOrder(r.Context(), tenantID, before.ID, &confirmedBy)
		if err != nil {
			return err
		}
		h.record(r, "work_order", wo.ID, "CONFIRM", map[string]any{"status": before.Status}, map[string]any{"status": wo.Status})
		return httpx.OK(w, wo)
	})
	r.Post("/work-orders/{id}/confirm", confirm)
	r.Post("/work-orders/{id}/release", confirm)

	r.Post("/work-orders/{id}/start", h.start)

	r.Post("/work-orders/{id}/cancel", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		tenantID := tenant(r)
		before, err := h.svc.WorkOrderByID(r.Context(), tenantID, chi.URLParam(r, "id"))
		if err != nil {
			return err
		}
		if before == nil {
			return httpx.NotFound("Work order tidak ditemukan.")
		}
		if err := auth.AssertLine(auth.PrincipalFrom(r.Context()), before.LineID); err != nil {
			return err
		}
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		reason := v.String("reason", httpx.Opt{Optional: true, Max: httpx.Max(2000)})
		if reason == nil {
			reason = v.String("statusReason", httpx.Opt{Optional: true, Max: httpx.Max(2000)})
		}
		if err := v.Done(); err != nil {
			return err
		}
		wo, err := h.svc.CancelWorkOrder(r.Context(), tenantID, before.ID, reason)
		if err != nil {
			return err
		}
		h.record(r, "work_order", wo.ID, "CANCEL", map[string]any{"status": before.Status}, map[string]any{"status": wo.Status})
		return httpx.OK(w, wo)
	}))

	r.Post("/work-orders/{id}/split", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		tenantID := tenant(r)
		existing, err := h.svc.WorkOrderByID(r.Context(), tenantID, chi.URLParam(r, "id"))
		if err != nil {
			return err
		}
		if existing == nil {
			return httpx.NotFound("Work order tidak ditemukan.")
		}
		p := auth.PrincipalFrom(r.Context())
		if err := auth.AssertLine(p, existing.LineID); err != nil {
			return err
		}
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		parts := splitParts(body["parts"])
		var actor *string
		if p != nil {
			actor = &p.Name
		}
		result, err := h.svc.SplitWorkOrder(r.Context(), tenantID, existing.ID, parts, actor)
		if err != nil {
			return err
		}
		children := make([]map[string]any, 0, len(result.Children))
		for _, c := range result.Children {
			children = append(children, map[string]any{"id": c.ID, "woNumber": c.WoNumber, "plannedQuantity": c.PlannedQuantity, "machineId": c.MachineID})
		}
		h.record(r, "work_order", result.Parent.ID, "SPLIT",
			map[string]any{"plannedQuantity": existing.PlannedQuantity, "hasChildWorkOrder": false},
			map[string]any{"plannedQuantity": result.Parent.PlannedQuantity, "hasChildWorkOrder": true, "children": children})
		return httpx.Created(w, result)
	}))

	r.Post("/work-orders/{id}/complete", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		tenantID := tenant(r)
		wo, err := h.svc.WorkOrderByID(r.Context(), tenantID, chi.URLParam(r, "id"))
		if err != nil {
			return err
		}
		if wo == nil {
			return httpx.NotFound("Work order tidak ditemukan.")
		}
		if err := auth.AssertLine(auth.PrincipalFrom(r.Context()), wo.LineID); err != nil {
			return err
		}
		// An open downtime is refused rather than silently closed: closing it
		// automatically would invent an end time nobody observed.
		if h.downtime != nil {
			open, err := h.downtime.HasActiveDowntimeForWorkOrder(r.Context(), tenantID, wo.ID)
			if err != nil {
				return err
			}
			if open {
				return httpx.InvalidState("Masih ada downtime aktif pada work order ini. Selesaikan downtime sebelum menutup work order.")
			}
		}
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		occurredAt := v.String("occurredAt", httpx.Opt{Optional: true})
		if err := v.Done(); err != nil {
			return err
		}
		completed, err := h.svc.CompleteWorkOrder(r.Context(), tenantID, wo.ID, occurredAt)
		if err != nil {
			return err
		}
		h.record(r, "work_order", completed.ID, "COMPLETE", map[string]any{"status": wo.Status}, map[string]any{
			"status": completed.Status, "goodQuantity": completed.GoodQuantity, "rejectQuantity": completed.RejectQuantity, "actualEnd": completed.ActualEnd,
		})
		return httpx.OK(w, completed)
	}))

	r.Get("/work-orders/{id}/chain", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		chain, err := h.svc.Chain(r.Context(), tenant(r), chi.URLParam(r, "id"))
		if err != nil {
			return err
		}
		return httpx.OK(w, chain)
	}))

	r.Get("/work-orders/{id}/available-quantity", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		chain, err := h.svc.Chain(r.Context(), tenant(r), chi.URLParam(r, "id"))
		if err != nil {
			return err
		}
		predecessorTransferred := 0
		if n := len(chain.Predecessors); n > 0 {
			predecessorTransferred = chain.Predecessors[n-1].TransferredQuantity
		}
		// The formula's own inputs travel with the number (§18.3).
		return httpx.OK(w, map[string]any{
			"workOrderId":       chain.WorkOrder.WorkOrderID,
			"availableQuantity": chain.AvailableQuantity,
			"inputs":            map[string]any{"predecessorTransferred": predecessorTransferred, "ownInput": chain.WorkOrder.InputQuantity},
			"isFirstProcess":    chain.IsFirstProcess,
		})
	}))

	r.Get("/work-orders/{id}/demand", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		var demand any
		if h.demand != nil {
			var err error
			demand, err = h.demand.WorkOrderDemand(r.Context(), tenant(r), chi.URLParam(r, "id"))
			if err != nil {
				return err
			}
		}
		if demand == nil {
			return httpx.NotFound("Work Order tidak terhubung ke Production Plan Line, sehingga demand customer tidak dapat ditelusuri.")
		}
		return httpx.OK(w, demand)
	}))

	r.Post("/work-orders/{id}/batch", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		tenantID := tenant(r)
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		batchID := v.String("batchId", httpx.Opt{})
		if err := v.Done(); err != nil {
			return err
		}
		wo, err := h.svc.WorkOrderByID(r.Context(), tenantID, chi.URLParam(r, "id"))
		if err != nil {
			return err
		}
		if wo == nil {
			return httpx.NotFound("Work order tidak ditemukan.")
		}
		if err := auth.AssertLine(auth.PrincipalFrom(r.Context()), wo.LineID); err != nil {
			return err
		}
		batch, err := h.svc.BatchByID(r.Context(), tenantID, *batchID)
		if err != nil {
			return err
		}
		if batch == nil {
			return httpx.NotFound("Batch/Lot tidak ditemukan.")
		}
		if batch.ProductID != wo.ProductID {
			return httpx.Validation("Batch/Lot tidak sesuai dengan produk pada work order.", httpx.FieldError{
				Field: "batchId", Code: "INVALID_COMBINATION", Message: "Produk batch berbeda dengan produk work order.",
			})
		}
		if batch.Status == "SCRAPPED" || batch.Status == "COMPLETED" {
			return httpx.InvalidState(fmt.Sprintf("Batch/Lot berstatus %s tidak dapat dilampirkan.", batch.Status))
		}
		if wo.Status == StatusCompleted || wo.Status == StatusCancelled {
			return httpx.InvalidState(fmt.Sprintf("Work order berstatus %s tidak dapat diubah.", wo.Status))
		}
		updated, err := h.svc.AssignBatchToWorkOrder(r.Context(), tenantID, wo.ID, batch.ID)
		if err != nil {
			return err
		}
		h.record(r, "work_order", updated.ID, "ATTACH_BATCH",
			map[string]any{"isBatchManaged": wo.IsBatchManaged}, map[string]any{"isBatchManaged": true, "batchId": batch.ID})
		return httpx.OK(w, updated)
	}))
}

// start is US-015: the preconditions are checked here, not in the
// terminal, because the operator may be replaying an offline queue built
// minutes ago and the machine may have been taken out of service since.
func (h *Handler) start(w http.ResponseWriter, r *http.Request) {
	httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		tenantID := tenant(r)
		wo, err := h.svc.WorkOrderByID(r.Context(), tenantID, chi.URLParam(r, "id"))
		if err != nil {
			return err
		}
		if wo == nil {
			return httpx.NotFound("Work order tidak ditemukan.")
		}
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		p := auth.PrincipalFrom(r.Context())
		operatorID := ""
		if s, ok := body["operatorId"].(string); ok {
			operatorID = s
		} else if p != nil {
			operatorID = p.SubjectID
		}
		if err := auth.AssertAssignedWorkOrder(p, wo.LineID, operatorID); err != nil {
			return err
		}
		if wo.Status != StatusConfirmed {
			return httpx.InvalidState(fmt.Sprintf(
				"Work order berstatus %s tidak dapat dimulai. Work order harus berstatus CONFIRMED.", wo.Status))
		}
		var operator *masterdata.Operator
		if operatorID != "" {
			if operator, err = h.master.OperatorByID(r.Context(), tenantID, operatorID); err != nil {
				return err
			}
		}
		if operator == nil || operator.Status != "ACTIVE" {
			return httpx.Validation("Operator tidak valid atau tidak aktif.", httpx.FieldError{
				Field: "operatorId", Code: "UNKNOWN_REFERENCE", Message: "Operator tidak dikenal atau nonaktif.",
			})
		}
		if wo.MachineID != nil {
			machine, err := h.master.MachineByID(r.Context(), tenantID, *wo.MachineID)
			if err != nil {
				return err
			}
			if machine == nil || machine.Status != "ACTIVE" {
				return httpx.InvalidState("Mesin pada work order ini tidak aktif.")
			}
			if h.downtime != nil {
				open, err := h.downtime.HasActiveDowntimeForMachine(r.Context(), tenantID, *wo.MachineID)
				if err != nil {
					return err
				}
				if open {
					return httpx.InvalidState("Mesin sedang dalam kondisi downtime. Selesaikan downtime terlebih dahulu.")
				}
			}
		}
		shifts, err := h.master.Shifts(r.Context(), tenantID)
		if err != nil {
			return err
		}
		active := 0
		for _, s := range shifts {
			if s.Active {
				active++
			}
		}
		if active == 0 {
			return httpx.InvalidState("Tidak ada shift aktif yang terkonfigurasi.")
		}
		var occurredAt *string
		if s, ok := body["occurredAt"].(string); ok && s != "" {
			occurredAt = &s
		}
		started, err := h.svc.StartWorkOrder(r.Context(), tenantID, wo.ID, operatorID, occurredAt)
		if err != nil {
			return err
		}
		h.record(r, "work_order", started.ID, "START", map[string]any{"status": wo.Status},
			map[string]any{"status": started.Status, "operatorId": operatorID})
		return httpx.OK(w, started)
	})(w, r)
}

// splitParts reads the parts array leniently: a non-numeric quantity is
// NaN, which the domain refuses by position.
func splitParts(raw any) []SplitPart {
	items, ok := raw.([]any)
	if !ok {
		return nil
	}
	parts := make([]SplitPart, 0, len(items))
	for _, item := range items {
		m, _ := item.(map[string]any)
		part := SplitPart{PlannedQuantity: math.NaN()}
		if q, ok := m["plannedQuantity"].(float64); ok {
			part.PlannedQuantity = q
		}
		part.MachineID = optString(m, "machineId")
		part.WorkCenterID = optString(m, "workCenterId")
		part.MoldID = optString(m, "moldId")
		part.ShiftID = optString(m, "shiftId")
		part.PlannedStart = optString(m, "plannedStart")
		part.PlannedEnd = optString(m, "plannedEnd")
		parts = append(parts, part)
	}
	return parts
}

func optString(m map[string]any, key string) *string {
	if m == nil {
		return nil
	}
	if s, ok := m[key].(string); ok && s != "" {
		return &s
	}
	return nil
}

func (h *Handler) mountBatches(r chi.Router) {
	r.Get("/master/batches", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		batches, err := h.svc.Batches(r.Context(), tenant(r), httpx.QueryStr(r, "productId"), httpx.QueryStr(r, "status"))
		if err != nil {
			return err
		}
		return httpx.OK(w, batches)
	}))

	r.Post("/master/batches", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		in := CreateBatchInput{
			ProductionOrderID:    v.String("productionOrderId", httpx.Opt{Optional: true, Max: httpx.Max(64)}),
			Status:               v.String("status", httpx.Opt{Optional: true, Max: httpx.Max(32)}),
			PlannedQuantity:      v.Int("plannedQuantity", httpx.Opt{Optional: true, Min: httpx.Min(0)}),
			MaterialLotReference: v.String("materialLotReference", httpx.Opt{Optional: true, Max: httpx.Max(128)}),
			MachineID:            v.String("machineId", httpx.Opt{Optional: true, Max: httpx.Max(64)}),
			MoldID:               v.String("moldId", httpx.Opt{Optional: true, Max: httpx.Max(64)}),
			OperatorID:           v.String("operatorId", httpx.Opt{Optional: true, Max: httpx.Max(64)}),
			ShiftID:              v.String("shiftId", httpx.Opt{Optional: true, Max: httpx.Max(64)}),
			ExpiryDate:           v.ISODate("expiryDate", httpx.Opt{Optional: true}),
		}
		batchNumber := v.String("batchNumber", httpx.Opt{Min: httpx.Min(1), Max: httpx.Max(64)})
		productID := v.String("productId", httpx.Opt{Min: httpx.Min(1), Max: httpx.Max(64)})
		workOrderID := v.String("workOrderId", httpx.Opt{Min: httpx.Min(1), Max: httpx.Max(64)})
		productionDate := v.ISODate("productionDate", httpx.Opt{})
		if err := v.Done(); err != nil {
			return err
		}
		in.BatchNumber, in.ProductID, in.WorkOrderID, in.ProductionDate = *batchNumber, *productID, *workOrderID, *productionDate
		batch, err := h.svc.CreateBatch(r.Context(), tenant(r), in)
		if err != nil {
			return err
		}
		return httpx.Created(w, batch)
	}))

	r.Put("/master/batches/{id}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		p := BatchPatch{
			BatchNumber:          v.String("batchNumber", httpx.Opt{Optional: true, Max: httpx.Max(64)}),
			WorkOrderID:          v.String("workOrderId", httpx.Opt{Optional: true, Max: httpx.Max(64)}),
			PlannedQuantity:      v.Int("plannedQuantity", httpx.Opt{Optional: true, Min: httpx.Min(0)}),
			Status:               v.String("status", httpx.Opt{Optional: true, Max: httpx.Max(32)}),
			StatusReason:         v.String("statusReason", httpx.Opt{Optional: true, Max: httpx.Max(2000)}),
			MaterialLotReference: v.String("materialLotReference", httpx.Opt{Optional: true, Max: httpx.Max(128)}),
			MachineID:            v.String("machineId", httpx.Opt{Optional: true, Max: httpx.Max(64)}),
			MoldID:               v.String("moldId", httpx.Opt{Optional: true, Max: httpx.Max(64)}),
			OperatorID:           v.String("operatorId", httpx.Opt{Optional: true, Max: httpx.Max(64)}),
			ShiftID:              v.String("shiftId", httpx.Opt{Optional: true, Max: httpx.Max(64)}),
			ProductionDate:       v.ISODate("productionDate", httpx.Opt{Optional: true}),
			ExpiryDate:           v.ISODate("expiryDate", httpx.Opt{Optional: true}),
			ActualStart:          v.String("actualStart", httpx.Opt{Optional: true}),
			ActualEnd:            v.String("actualEnd", httpx.Opt{Optional: true}),
			ProductionOrderID:    v.String("productionOrderId", httpx.Opt{Optional: true, Max: httpx.Max(64)}),
		}
		if err := v.Done(); err != nil {
			return err
		}
		batch, err := h.svc.UpdateBatch(r.Context(), tenant(r), chi.URLParam(r, "id"), p)
		if err != nil {
			return err
		}
		return httpx.OK(w, batch)
	}))
}
