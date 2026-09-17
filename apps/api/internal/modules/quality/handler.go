package quality

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

// characteristicsFrom reads the posted characteristics leniently, as the
// Node route passed them through.
func characteristicsFrom(raw any) []CharacteristicInput {
	items, ok := raw.([]any)
	if !ok {
		return nil
	}
	out := make([]CharacteristicInput, 0, len(items))
	for _, item := range items {
		m, _ := item.(map[string]any)
		c := CharacteristicInput{}
		if s, ok := m["id"].(string); ok {
			c.ID = s
		}
		if n, ok := m["sequence"].(float64); ok {
			c.Sequence = int(n)
		}
		if s, ok := m["name"].(string); ok {
			c.Name = s
		}
		if s, ok := m["dataType"].(string); ok {
			c.DataType = s
		}
		c.Specification = optString(m, "specification")
		c.LowerLimit = optNumber(m, "lowerLimit")
		c.UpperLimit = optNumber(m, "upperLimit")
		c.TargetValue = optNumber(m, "targetValue")
		c.UOM = optString(m, "uom")
		if b, ok := m["required"].(bool); ok {
			c.Required = b
		}
		out = append(out, c)
	}
	return out
}

// MeasurementsFrom decodes the measurements array of an inspection body.
func MeasurementsFrom(raw any) []Measurement {
	items, ok := raw.([]any)
	if !ok {
		return nil
	}
	out := make([]Measurement, 0, len(items))
	for _, item := range items {
		m, _ := item.(map[string]any)
		meas := Measurement{CharacteristicID: optString(m, "characteristicId"), ActualValue: optString(m, "actualValue"), NumericValue: optNumber(m, "numericValue"), Notes: optString(m, "notes")}
		if s, ok := m["characteristicName"].(string); ok {
			meas.CharacteristicName = s
		}
		out = append(out, meas)
	}
	return out
}

func optString(m map[string]any, key string) *string {
	if s, ok := m[key].(string); ok {
		return &s
	}
	return nil
}

func optNumber(m map[string]any, key string) *float64 {
	if f, ok := m[key].(float64); ok {
		return &f
	}
	return nil
}

// Mount registers /quality/*.
func Mount(r chi.Router, svc *Service, auditor audit.Recorder) {
	tenant := func(r *http.Request) string { return tenancy.TenantID(r.Context()) }
	q := func(r *http.Request, key string) string { return r.URL.Query().Get(key) }
	record := func(r *http.Request, entityType, entityID, action string, next any) error {
		_, err := auditor.Record(r.Context(), audit.FromRequest(r, entityType, entityID, action, nil, next))
		return err
	}

	r.Get("/quality/inspection-plans", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		list, err := svc.Plans(r.Context(), tenant(r), PlanFilter{ProductID: q(r, "productId"), ProcessID: q(r, "processId"), Status: q(r, "status")})
		if err != nil {
			return err
		}
		return httpx.OK(w, list)
	}))

	r.Get("/quality/inspection-plans/{id}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		plan, err := svc.Plan(r.Context(), tenant(r), chi.URLParam(r, "id"))
		if err != nil {
			return err
		}
		if plan == nil {
			return httpx.NotFound("Inspection Plan tidak ditemukan.")
		}
		return httpx.OK(w, plan)
	}))

	r.Post("/quality/inspection-plans", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		in := PlanInput{
			ProductID: v.String("productId", httpx.Opt{Optional: true}), ProcessID: v.String("processId", httpx.Opt{Optional: true}),
			SamplingMethod: v.String("samplingMethod", httpx.Opt{Optional: true}), SamplingQuantity: v.Number("samplingQuantity", httpx.Opt{Min: httpx.Min(0), Optional: true}),
			Frequency: v.String("frequency", httpx.Opt{Optional: true, Max: httpx.Max(128)}), Mandatory: v.Boolean("mandatory", httpx.Opt{Optional: true}),
			Status: v.String("status", httpx.Opt{Optional: true}),
		}
		name := v.String("name", httpx.Opt{Min: httpx.Min(2), Max: httpx.Max(255)})
		inspectionType := v.String("inspectionType", httpx.Opt{})
		if err := v.Done(); err != nil {
			return err
		}
		in.Name, in.InspectionType = *name, *inspectionType
		in.Characteristics = characteristicsFrom(body["characteristics"])
		if len(in.Characteristics) == 0 {
			return httpx.Validation("Inspection Plan harus memiliki minimal satu karakteristik.")
		}
		plan, err := svc.CreatePlan(r.Context(), tenant(r), in, actorOf(r))
		if err != nil {
			return err
		}
		return httpx.Created(w, plan)
	}))

	r.Put("/quality/inspection-plans/{id}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		p := PlanPatch{
			Name: optString(body, "name"), InspectionType: optString(body, "inspectionType"), ProductID: optString(body, "productId"), ProcessID: optString(body, "processId"),
			SamplingMethod: optString(body, "samplingMethod"), SamplingQuantity: optNumber(body, "samplingQuantity"), Frequency: optString(body, "frequency"), Status: optString(body, "status"),
		}
		if b, ok := body["mandatory"].(bool); ok {
			p.Mandatory = &b
		}
		if raw, ok := body["characteristics"]; ok && raw != nil {
			p.HasCharacteristics = true
			p.Characteristics = characteristicsFrom(raw)
		}
		plan, err := svc.UpdatePlan(r.Context(), tenant(r), chi.URLParam(r, "id"), p)
		if err != nil {
			return err
		}
		return httpx.OK(w, plan)
	}))

	r.Delete("/quality/inspection-plans/{id}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		if err := svc.DeletePlan(r.Context(), tenant(r), chi.URLParam(r, "id")); err != nil {
			return err
		}
		return httpx.OK(w, map[string]any{"success": true, "message": "Inspection Plan dihapus."})
	}))

	r.Get("/quality/inspections", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		list, err := svc.Inspections(r.Context(), tenant(r), InspectionFilter{
			WorkOrderID: q(r, "workOrderId"), BatchID: q(r, "batchId"), ProductID: q(r, "productId"), Result: q(r, "result"), From: q(r, "from"), To: q(r, "to"), Limit: httpx.QueryInt(r, "limit", 0),
		})
		if err != nil {
			return err
		}
		return httpx.OK(w, list)
	}))

	r.Post("/quality/inspections", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		in := InspectionInput{
			InspectionPlanID: v.String("inspectionPlanId", httpx.Opt{Optional: true}), InspectionType: v.String("inspectionType", httpx.Opt{Optional: true}),
			WorkOrderID: v.String("workOrderId", httpx.Opt{Optional: true}), BatchID: v.String("batchId", httpx.Opt{Optional: true}), ProductID: v.String("productId", httpx.Opt{Optional: true}),
			ProcessID: v.String("processId", httpx.Opt{Optional: true}), MachineID: v.String("machineId", httpx.Opt{Optional: true}),
			FailedQuantity: v.Number("failedQuantity", httpx.Opt{Min: httpx.Min(0), Optional: true}), UOM: v.String("uom", httpx.Opt{Optional: true}),
			OperatorID: v.String("operatorId", httpx.Opt{Optional: true}), Notes: v.String("notes", httpx.Opt{Optional: true, Max: httpx.Max(1000)}),
			IdempotencyKey: v.String("idempotencyKey", httpx.Opt{Optional: true}),
		}
		inspected := v.Number("inspectedQuantity", httpx.Opt{Min: httpx.Min(0.0001)})
		if err := v.Done(); err != nil {
			return err
		}
		in.InspectedQuantity = *inspected
		in.Measurements = MeasurementsFrom(body["measurements"])
		inspection, err := svc.RecordInspection(r.Context(), tenant(r), in, actorOf(r))
		if err != nil {
			return err
		}
		if err := record(r, "inspection", inspection.ID, "QUALITY_INSPECTION", map[string]any{"result": inspection.Result, "inspectedQuantity": inspection.InspectedQuantity, "failedQuantity": inspection.FailedQuantity, "workOrderId": inspection.WorkOrderID}); err != nil {
			return err
		}
		return httpx.Created(w, inspection)
	}))

	r.Get("/quality/holds", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		list, err := svc.Holds(r.Context(), tenant(r), HoldFilter{Status: q(r, "status"), WorkOrderID: q(r, "workOrderId"), BatchID: q(r, "batchId")})
		if err != nil {
			return err
		}
		return httpx.OK(w, list)
	}))

	r.Post("/quality/holds", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		in := HoldInput{
			WorkOrderID: v.String("workOrderId", httpx.Opt{Optional: true}), BatchID: v.String("batchId", httpx.Opt{Optional: true}), ProductID: v.String("productId", httpx.Opt{Optional: true}),
			MaterialID: v.String("materialId", httpx.Opt{Optional: true}), InspectionID: v.String("inspectionId", httpx.Opt{Optional: true}), UOM: v.String("uom", httpx.Opt{Optional: true}),
			OwnerName: v.String("ownerName", httpx.Opt{Optional: true}), Notes: v.String("notes", httpx.Opt{Optional: true, Max: httpx.Max(1000)}),
		}
		quantity := v.Number("quantity", httpx.Opt{Min: httpx.Min(0.0001)})
		reason := v.String("reason", httpx.Opt{Min: httpx.Min(3), Max: httpx.Max(1000)})
		ownerID := v.String("ownerId", httpx.Opt{})
		if err := v.Done(); err != nil {
			return err
		}
		in.Quantity, in.Reason, in.OwnerID = *quantity, *reason, *ownerID
		hold, err := svc.CreateHold(r.Context(), tenant(r), in, actorOf(r))
		if err != nil {
			return err
		}
		if err := record(r, "quality_hold", hold.ID, "QUALITY_HOLD", map[string]any{"quantity": hold.Quantity, "reason": hold.Reason, "ownerId": hold.OwnerID}); err != nil {
			return err
		}
		return httpx.Created(w, hold)
	}))

	r.Post("/quality/holds/{id}/release", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		reason := v.String("reason", httpx.Opt{Min: httpx.Min(3), Max: httpx.Max(1000)})
		if err := v.Done(); err != nil {
			return err
		}
		hold, err := svc.ReleaseHold(r.Context(), tenant(r), chi.URLParam(r, "id"), *reason, actorOf(r))
		if err != nil {
			return err
		}
		if err := record(r, "quality_hold", hold.ID, "QUALITY_RELEASE", map[string]any{"reason": *reason}); err != nil {
			return err
		}
		return httpx.OK(w, hold)
	}))

	r.Get("/quality/gate/{workOrderId}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		out, err := svc.TransferBlock(r.Context(), tenant(r), chi.URLParam(r, "workOrderId"), httpx.QueryPtr(r, "productId"), httpx.QueryPtr(r, "processId"))
		if err != nil {
			return err
		}
		return httpx.OK(w, out)
	}))

	r.Get("/quality/dispositions", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		list, err := svc.Dispositions(r.Context(), tenant(r), DispositionFilter{WorkOrderID: q(r, "workOrderId"), InspectionID: q(r, "inspectionId"), Decision: q(r, "decision"), Limit: httpx.QueryInt(r, "limit", 0)})
		if err != nil {
			return err
		}
		return httpx.OK(w, list)
	}))

	r.Post("/quality/dispositions", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		in := DispositionInput{
			InspectionID: v.String("inspectionId", httpx.Opt{Optional: true}), QualityHoldID: v.String("qualityHoldId", httpx.Opt{Optional: true}), WorkOrderID: v.String("workOrderId", httpx.Opt{Optional: true}),
			BatchID: v.String("batchId", httpx.Opt{Optional: true}), ProductID: v.String("productId", httpx.Opt{Optional: true}), UOM: v.String("uom", httpx.Opt{Optional: true}),
			DefectCode: v.String("defectCode", httpx.Opt{Optional: true}), NcrID: v.String("ncrId", httpx.Opt{Optional: true}),
		}
		decision := v.String("decision", httpx.Opt{})
		quantity := v.Number("quantity", httpx.Opt{Min: httpx.Min(0.0001)})
		reason := v.String("reason", httpx.Opt{Min: httpx.Min(3), Max: httpx.Max(1000)})
		if err := v.Done(); err != nil {
			return err
		}
		in.Decision, in.Quantity, in.Reason = *decision, *quantity, *reason
		disposition, err := svc.CreateDisposition(r.Context(), tenant(r), in, actorOf(r))
		if err != nil {
			return err
		}
		if err := record(r, "quality_disposition", disposition.ID, "QUALITY_DISPOSITION", map[string]any{"decision": disposition.Decision, "quantity": disposition.Quantity, "reason": disposition.Reason, "workOrderId": disposition.WorkOrderID}); err != nil {
			return err
		}
		return httpx.Created(w, disposition)
	}))

	r.Get("/quality/ncr", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		list, err := svc.Ncrs(r.Context(), tenant(r), NcrFilter{Status: q(r, "status"), WorkOrderID: q(r, "workOrderId"), Overdue: q(r, "overdue") == "true", Limit: httpx.QueryInt(r, "limit", 0)})
		if err != nil {
			return err
		}
		return httpx.OK(w, list)
	}))

	r.Post("/quality/ncr", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		in := NcrInput{
			Severity: v.String("severity", httpx.Opt{Optional: true}), OwnerName: v.String("ownerName", httpx.Opt{Optional: true}), ProductID: v.String("productId", httpx.Opt{Optional: true}),
			BatchID: v.String("batchId", httpx.Opt{Optional: true}), WorkOrderID: v.String("workOrderId", httpx.Opt{Optional: true}), ProcessID: v.String("processId", httpx.Opt{Optional: true}),
			MachineID: v.String("machineId", httpx.Opt{Optional: true}), OperatorID: v.String("operatorId", httpx.Opt{Optional: true}), DefectCode: v.String("defectCode", httpx.Opt{Optional: true}),
			InspectionID: v.String("inspectionId", httpx.Opt{Optional: true}), Quantity: v.Number("quantity", httpx.Opt{Min: httpx.Min(0), Optional: true}), UOM: v.String("uom", httpx.Opt{Optional: true}),
			DueDate: v.ISODate("dueDate", httpx.Opt{Optional: true}),
		}
		title := v.String("title", httpx.Opt{Min: httpx.Min(3), Max: httpx.Max(255)})
		description := v.String("description", httpx.Opt{Min: httpx.Min(3), Max: httpx.Max(4000)})
		ownerID := v.String("ownerId", httpx.Opt{})
		if err := v.Done(); err != nil {
			return err
		}
		in.Title, in.Description, in.OwnerID = *title, *description, *ownerID
		ncr, err := svc.CreateNcr(r.Context(), tenant(r), in, actorOf(r))
		if err != nil {
			return err
		}
		if err := record(r, "ncr", ncr.ID, "NCR_CREATE", map[string]any{"ncrNumber": ncr.NcrNumber, "severity": ncr.Severity, "ownerId": ncr.OwnerID}); err != nil {
			return err
		}
		return httpx.Created(w, ncr)
	}))

	r.Patch("/quality/ncr/actions/{id}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		status := v.String("status", httpx.Opt{Optional: true})
		evidence := v.String("evidence", httpx.Opt{Optional: true, Max: httpx.Max(2000)})
		if err := v.Done(); err != nil {
			return err
		}
		id := chi.URLParam(r, "id")
		if err := svc.UpdateCorrectiveAction(r.Context(), tenant(r), id, status, evidence, actorOf(r)); err != nil {
			return err
		}
		if err := record(r, "corrective_action", id, "CORRECTIVE_ACTION_UPDATE", map[string]any{"status": status, "evidence": evidence}); err != nil {
			return err
		}
		return httpx.OK(w, map[string]any{"success": true})
	}))

	r.Patch("/quality/ncr/{id}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		p := NcrPatch{
			Status: v.String("status", httpx.Opt{Optional: true}), RootCause: v.String("rootCause", httpx.Opt{Optional: true, Max: httpx.Max(4000)}),
			OwnerID: v.String("ownerId", httpx.Opt{Optional: true}), OwnerName: v.String("ownerName", httpx.Opt{Optional: true}),
			DueDate: v.ISODate("dueDate", httpx.Opt{Optional: true}), Severity: v.String("severity", httpx.Opt{Optional: true}),
		}
		if err := v.Done(); err != nil {
			return err
		}
		ncr, err := svc.UpdateNcr(r.Context(), tenant(r), chi.URLParam(r, "id"), p, actorOf(r))
		if err != nil {
			return err
		}
		if err := record(r, "ncr", ncr.ID, "NCR_UPDATE", map[string]any{"status": ncr.Status, "rootCause": ncr.RootCause, "ownerId": ncr.OwnerID}); err != nil {
			return err
		}
		return httpx.OK(w, ncr)
	}))

	r.Post("/quality/ncr/{id}/actions", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		in := ActionInput{OwnerName: v.String("ownerName", httpx.Opt{Optional: true}), DueDate: v.ISODate("dueDate", httpx.Opt{Optional: true}), Notes: v.String("notes", httpx.Opt{Optional: true, Max: httpx.Max(1000)})}
		action := v.String("action", httpx.Opt{Min: httpx.Min(3), Max: httpx.Max(2000)})
		ownerID := v.String("ownerId", httpx.Opt{})
		if err := v.Done(); err != nil {
			return err
		}
		in.Action, in.OwnerID = *action, *ownerID
		out, err := svc.AddCorrectiveAction(r.Context(), tenant(r), chi.URLParam(r, "id"), in)
		if err != nil {
			return err
		}
		return httpx.Created(w, out)
	}))

	r.Get("/quality/dashboard", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		out, err := svc.QualityDashboard(r.Context(), tenant(r), q(r, "from"), q(r, "to"))
		if err != nil {
			return err
		}
		return httpx.OK(w, out)
	}))
}
