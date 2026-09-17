package material

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api/internal/modules/audit"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/auth"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/db"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/httpx"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/tenancy"
)

func actorOf(r *http.Request) Actor {
	p := auth.PrincipalFrom(r.Context())
	if p == nil {
		return Actor{ID: "system", Name: db.Ptr("System"), Type: "USER"}
	}
	a := Actor{ID: p.SubjectID, Name: db.Ptr(p.Name), Type: "USER"}
	if p.Kind == auth.KindOperator {
		a.Type = "OPERATOR"
	}
	return a
}

// Mount registers /materials/* and /mrp/*.
func Mount(r chi.Router, svc *Service, auditor audit.Recorder) {
	tenant := func(r *http.Request) string { return tenancy.TenantID(r.Context()) }
	q := func(r *http.Request, key string) string { return r.URL.Query().Get(key) }

	r.Get("/materials/warehouses", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		list, err := svc.Warehouses(r.Context(), tenant(r))
		if err != nil {
			return err
		}
		return httpx.OK(w, list)
	}))

	r.Post("/materials/warehouses", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		code := v.String("code", httpx.Opt{Min: httpx.Min(2), Max: httpx.Max(64)})
		name := v.String("name", httpx.Opt{Min: httpx.Min(2), Max: httpx.Max(255)})
		plantID := v.String("plantId", httpx.Opt{Optional: true})
		warehouseType := v.String("warehouseType", httpx.Opt{Optional: true})
		if err := v.Done(); err != nil {
			return err
		}
		created, err := svc.CreateWarehouse(r.Context(), tenant(r), *code, *name, plantID, warehouseType)
		if err != nil {
			return err
		}
		return httpx.Created(w, created)
	}))

	r.Get("/materials/inventory", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		list, err := svc.Inventory(r.Context(), tenant(r), InventoryFilter{
			MaterialID: q(r, "materialId"), WarehouseID: q(r, "warehouseId"), BelowReorder: q(r, "belowReorder") == "true", Search: q(r, "search"),
		})
		if err != nil {
			return err
		}
		return httpx.OK(w, list)
	}))

	r.Post("/materials/inventory/adjust", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		in := AdjustInput{
			WarehouseID:  v.String("warehouseId", httpx.Opt{Optional: true}),
			UOM:          v.String("uom", httpx.Opt{Optional: true}),
			ReorderPoint: v.Number("reorderPoint", httpx.Opt{Min: httpx.Min(0), Optional: true}),
			SafetyStock:  v.Number("safetyStock", httpx.Opt{Min: httpx.Min(0), Optional: true}),
			Actor:        actorOf(r),
		}
		materialID := v.String("materialId", httpx.Opt{})
		onHand := v.Number("onHandQuantity", httpx.Opt{Min: httpx.Min(0)})
		reason := v.String("reason", httpx.Opt{Min: httpx.Min(3), Max: httpx.Max(500)})
		if err := v.Done(); err != nil {
			return err
		}
		in.MaterialID, in.OnHandQuantity, in.Reason = *materialID, *onHand, *reason
		tenantID := tenant(r)
		before, err := svc.Inventory(r.Context(), tenantID, InventoryFilter{MaterialID: in.MaterialID, WarehouseID: db.Deref(in.WarehouseID, "")})
		if err != nil {
			return err
		}
		updated, err := svc.AdjustInventory(r.Context(), tenantID, in)
		if err != nil {
			return err
		}
		var previous any
		if len(before) > 0 {
			previous = map[string]any{"onHandQuantity": before[0].OnHandQuantity}
		}
		if _, err := auditor.Record(r.Context(), audit.FromRequest(r, "material_inventory", updated.ID, "MATERIAL_ADJUSTMENT", previous,
			map[string]any{"onHandQuantity": updated.OnHandQuantity, "reason": in.Reason})); err != nil {
			return err
		}
		return httpx.OK(w, updated)
	}))

	movement := func(record func(ctx *http.Request, in MovementInput) (Transaction, error)) http.HandlerFunc {
		return httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
			body, err := httpx.Body(r)
			if err != nil {
				return err
			}
			v := httpx.Validate(body)
			in := MovementInput{
				WarehouseID: v.String("warehouseId", httpx.Opt{Optional: true}),
				UOM:         v.String("uom", httpx.Opt{Optional: true}),
				Reference:   v.String("reference", httpx.Opt{Optional: true}),
				Actor:       actorOf(r),
			}
			materialID := v.String("materialId", httpx.Opt{})
			quantity := v.Number("quantity", httpx.Opt{Min: httpx.Min(0.0001)})
			if err := v.Done(); err != nil {
				return err
			}
			in.MaterialID, in.Quantity = *materialID, *quantity
			out, err := record(r, in)
			if err != nil {
				return err
			}
			return httpx.Created(w, out)
		})
	}
	r.Post("/materials/inventory/receive", movement(func(r *http.Request, in MovementInput) (Transaction, error) {
		return svc.ReceiveMaterial(r.Context(), tenant(r), in)
	}))
	r.Post("/materials/inventory/incoming", movement(func(r *http.Request, in MovementInput) (Transaction, error) {
		return svc.RecordIncoming(r.Context(), tenant(r), in)
	}))

	r.Get("/materials/transactions", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		list, err := svc.Transactions(r.Context(), tenant(r), TransactionFilter{
			MaterialID: q(r, "materialId"), ReferenceID: q(r, "referenceId"), From: q(r, "from"), To: q(r, "to"), Limit: httpx.QueryInt(r, "limit", 0),
		})
		if err != nil {
			return err
		}
		return httpx.OK(w, list)
	}))

	r.Get("/materials/requirements", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		list, err := svc.StoredRequirements(r.Context(), tenant(r), RequirementFilter{SourceType: q(r, "sourceType"), SourceID: q(r, "sourceId"), Status: q(r, "status")})
		if err != nil {
			return err
		}
		return httpx.OK(w, list)
	}))

	r.Post("/materials/availability/work-order/{id}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		out, err := svc.CheckWorkOrder(r.Context(), tenant(r), chi.URLParam(r, "id"))
		if err != nil {
			return err
		}
		return httpx.OK(w, out)
	}))

	r.Post("/materials/availability/production-plan/{id}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		tenantID := tenant(r)
		id := chi.URLParam(r, "id")
		demand, err := svc.Demand().PlanDemandLines(r.Context(), tenantID, []string{id}, "", "")
		if err != nil {
			return err
		}
		if len(demand) == 0 {
			return httpx.NotFound("Production Plan tidak ditemukan atau belum memiliki line.")
		}
		out, err := svc.CheckProductionPlan(r.Context(), tenantID, id, demand)
		if err != nil {
			return err
		}
		return httpx.OK(w, out)
	}))

	r.Get("/materials/readiness", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		tenantID := tenant(r)
		demand, err := svc.Demand().PlanDemandLines(r.Context(), tenantID, nil, q(r, "from"), q(r, "to"))
		if err != nil {
			return err
		}
		byPlan := map[string][]DemandLine{}
		var order []string
		for _, line := range demand {
			if _, ok := byPlan[line.ProductionPlanID]; !ok {
				order = append(order, line.ProductionPlanID)
			}
			byPlan[line.ProductionPlanID] = append(byPlan[line.ProductionPlanID], line)
		}
		out := []Readiness{}
		for _, planID := range order {
			readiness, err := svc.CheckProductionPlan(r.Context(), tenantID, planID, byPlan[planID])
			if err != nil {
				return err
			}
			out = append(out, readiness)
		}
		return httpx.OK(w, out)
	}))

	r.Get("/materials/reservations", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		list, err := svc.Reservations(r.Context(), tenant(r), ReservationFilter{WorkOrderID: q(r, "workOrderId"), MaterialID: q(r, "materialId"), Status: q(r, "status")})
		if err != nil {
			return err
		}
		return httpx.OK(w, list)
	}))

	r.Post("/materials/reservations/work-order/{id}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		out, err := svc.ReserveForWorkOrder(r.Context(), tenant(r), chi.URLParam(r, "id"), actorOf(r))
		if err != nil {
			return err
		}
		return httpx.Created(w, out)
	}))

	r.Delete("/materials/reservations/{id}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		if err := svc.ReleaseReservation(r.Context(), tenant(r), chi.URLParam(r, "id"), actorOf(r)); err != nil {
			return err
		}
		return httpx.OK(w, map[string]any{"success": true, "message": "Reservasi material dilepas."})
	}))

	r.Get("/materials/consumption", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		list, err := svc.Consumption(r.Context(), tenant(r), ConsumptionFilter{
			WorkOrderID: q(r, "workOrderId"), MaterialID: q(r, "materialId"), Status: q(r, "status"), From: q(r, "from"), To: q(r, "to"), Limit: httpx.QueryInt(r, "limit", 0),
		})
		if err != nil {
			return err
		}
		return httpx.OK(w, list)
	}))

	r.Post("/materials/consumption", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		in := ConsumptionInput{
			PlannedQuantity: v.Number("plannedQuantity", httpx.Opt{Min: httpx.Min(0), Optional: true}),
			WarehouseID:     v.String("warehouseId", httpx.Opt{Optional: true}),
			BatchID:         v.String("batchId", httpx.Opt{Optional: true}),
			ProcessID:       v.String("processId", httpx.Opt{Optional: true}),
			MachineID:       v.String("machineId", httpx.Opt{Optional: true}),
			OperatorID:      v.String("operatorId", httpx.Opt{Optional: true}),
			ConsumptionType: v.String("consumptionType", httpx.Opt{Optional: true}),
			UOM:             v.String("uom", httpx.Opt{Optional: true}),
			Notes:           v.String("notes", httpx.Opt{Optional: true, Max: httpx.Max(500)}),
			IdempotencyKey:  v.String("idempotencyKey", httpx.Opt{Optional: true}),
		}
		workOrderID := v.String("workOrderId", httpx.Opt{})
		materialID := v.String("materialId", httpx.Opt{})
		actual := v.Number("actualQuantity", httpx.Opt{Min: httpx.Min(0.0001)})
		override := v.Boolean("allowOverride", httpx.Opt{Optional: true})
		if err := v.Done(); err != nil {
			return err
		}
		in.WorkOrderID, in.MaterialID, in.ActualQuantity = *workOrderID, *materialID, *actual
		in.AllowOverride = override != nil && *override
		p := auth.PrincipalFrom(r.Context())
		if in.AllowOverride && (p == nil || !p.Has("material:adjust")) {
			return httpx.Forbidden("Override konsumsi melebihi stok memerlukan izin material:adjust.")
		}
		actor := actorOf(r)
		record, err := svc.RecordConsumption(r.Context(), tenant(r), in, actor)
		if err != nil {
			return err
		}
		if _, err := auditor.Record(r.Context(), audit.FromRequest(r, "material_consumption", record.ID, "MATERIAL_CONSUMPTION", nil, map[string]any{
			"workOrderId": record.WorkOrderID, "materialId": record.MaterialID, "actualQuantity": record.ActualQuantity,
			"varianceQuantity": record.VarianceQuantity, "override": in.AllowOverride,
		})); err != nil {
			return err
		}
		return httpx.Created(w, record)
	}))

	r.Get("/materials/consumption/variance/{workOrderId}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		out, err := svc.ConsumptionVariance(r.Context(), tenant(r), chi.URLParam(r, "workOrderId"))
		if err != nil {
			return err
		}
		return httpx.OK(w, out)
	}))

	r.Get("/mrp/runs", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		list, err := svc.MrpRuns(r.Context(), tenant(r), httpx.QueryInt(r, "limit", 0))
		if err != nil {
			return err
		}
		return httpx.OK(w, list)
	}))

	r.Get("/mrp/runs/latest", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		latest, err := svc.LatestMrp(r.Context(), tenant(r))
		if err != nil {
			return err
		}
		if latest == nil {
			return httpx.OK(w, map[string]any{"run": nil, "results": []any{}})
		}
		return httpx.OK(w, latest)
	}))

	r.Get("/mrp/runs/{id}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		run, err := svc.MrpRun(r.Context(), tenant(r), chi.URLParam(r, "id"))
		if err != nil {
			return err
		}
		if run == nil {
			return httpx.NotFound("MRP run tidak ditemukan.")
		}
		return httpx.OK(w, run)
	}))

	r.Post("/mrp/run", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		in := MrpInput{
			HorizonStart: v.ISODate("horizonStart", httpx.Opt{Optional: true}),
			HorizonEnd:   v.ISODate("horizonEnd", httpx.Opt{Optional: true}),
			PlanIDs:      v.StringArray("planIds", httpx.Opt{Optional: true}),
			Notes:        v.String("notes", httpx.Opt{Optional: true, Max: httpx.Max(500)}),
		}
		if err := v.Done(); err != nil {
			return err
		}
		if !v.Has("planIds") {
			in.PlanIDs = nil
		}
		actor := actorOf(r)
		outcome, err := svc.RunMrp(r.Context(), tenant(r), in, actor)
		if err != nil {
			return err
		}
		if _, err := auditor.Record(r.Context(), audit.FromRequest(r, "mrp_run", outcome.Run.ID, "MRP_RUN", nil, map[string]any{
			"runNumber": outcome.Run.RunNumber, "horizonStart": outcome.Run.HorizonStart, "horizonEnd": outcome.Run.HorizonEnd, "shortageMaterials": outcome.Run.ShortageMaterials,
		})); err != nil {
			return err
		}
		return httpx.Created(w, outcome)
	}))
}
