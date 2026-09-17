package maintenance

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/audit"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/auth"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/db"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/httpx"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/tenancy"
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

// Mount registers /maintenance/*.
func Mount(r chi.Router, svc *Service, auditor audit.Recorder) {
	tenant := func(r *http.Request) string { return tenancy.TenantID(r.Context()) }
	q := func(r *http.Request, key string) string { return r.URL.Query().Get(key) }

	r.Get("/maintenance/plans", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		list, err := svc.Plans(r.Context(), tenant(r), PlanFilter{MachineID: q(r, "machineId"), Status: q(r, "status")})
		if err != nil {
			return err
		}
		return httpx.OK(w, list)
	}))

	r.Post("/maintenance/plans", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		in := PlanInput{
			IntervalUnit: v.String("intervalUnit", httpx.Opt{Optional: true}), EstimatedDurationMinutes: v.Number("estimatedDurationMinutes", httpx.Opt{Min: httpx.Min(0), Optional: true}),
			WarningThreshold: v.Number("warningThreshold", httpx.Opt{Min: httpx.Min(0), Optional: true}), StartFrom: v.ISODate("startFrom", httpx.Opt{Optional: true}),
			Tasks: v.StringArray("tasks", httpx.Opt{Optional: true}),
		}
		name := v.String("name", httpx.Opt{Min: httpx.Min(2), Max: httpx.Max(255)})
		machineID := v.String("machineId", httpx.Opt{})
		triggerType := v.String("triggerType", httpx.Opt{})
		interval := v.Number("intervalValue", httpx.Opt{Min: httpx.Min(0.01)})
		if err := v.Done(); err != nil {
			return err
		}
		in.Name, in.MachineID, in.TriggerType, in.IntervalValue = *name, *machineID, *triggerType, *interval
		if !v.Has("tasks") {
			in.Tasks = nil
		}
		plan, err := svc.CreatePlan(r.Context(), tenant(r), in, actorOf(r))
		if err != nil {
			return err
		}
		return httpx.Created(w, plan)
	}))

	r.Post("/maintenance/plans/generate", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		created, err := svc.GenerateDueWork(r.Context(), tenant(r), actorOf(r))
		if err != nil {
			return err
		}
		return httpx.Created(w, map[string]any{"created": len(created), "records": created})
	}))

	r.Put("/maintenance/plans/{id}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		p := PlanPatch{Name: optString(body, "name"), MachineID: optString(body, "machineId"), TriggerType: optString(body, "triggerType"), IntervalUnit: optString(body, "intervalUnit"),
			Status: optString(body, "status"), NextDueAt: optString(body, "nextDueAt"), LastPerformedAt: optString(body, "lastPerformedAt"), IntervalValue: optNumber(body, "intervalValue"),
			WarningThreshold: optNumber(body, "warningThreshold"), NextDueMeter: optNumber(body, "nextDueMeter"), LastPerformedMeter: optNumber(body, "lastPerformedMeter")}
		if f := optNumber(body, "estimatedDurationMinutes"); f != nil {
			p.EstimatedDurationMinutes = db.Ptr(int(*f))
		}
		if raw, ok := body["tasks"].([]any); ok {
			p.HasTasks = true
			p.Tasks = []string{}
			for _, t := range raw {
				if s, ok := t.(string); ok {
					p.Tasks = append(p.Tasks, s)
				}
			}
		}
		plan, err := svc.UpdatePlan(r.Context(), tenant(r), chi.URLParam(r, "id"), p)
		if err != nil {
			return err
		}
		return httpx.OK(w, plan)
	}))

	r.Delete("/maintenance/plans/{id}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		if err := svc.DeletePlan(r.Context(), tenant(r), chi.URLParam(r, "id")); err != nil {
			return err
		}
		return httpx.OK(w, map[string]any{"success": true, "message": "Maintenance Plan dihapus."})
	}))

	r.Get("/maintenance/requests", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		list, err := svc.Requests(r.Context(), tenant(r), RequestFilter{Status: q(r, "status"), MachineID: q(r, "machineId"), Limit: httpx.QueryInt(r, "limit", 0)})
		if err != nil {
			return err
		}
		return httpx.OK(w, list)
	}))

	r.Post("/maintenance/requests", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		in := RequestInput{MaintenanceType: v.String("maintenanceType", httpx.Opt{Optional: true}), Priority: v.String("priority", httpx.Opt{Optional: true}),
			ReportedSymptom: v.String("reportedSymptom", httpx.Opt{Optional: true, Max: httpx.Max(2000)}), WorkOrderID: v.String("workOrderId", httpx.Opt{Optional: true}),
			DowntimeID: v.String("downtimeId", httpx.Opt{Optional: true}), Notes: v.String("notes", httpx.Opt{Optional: true, Max: httpx.Max(1000)})}
		machineID := v.String("machineId", httpx.Opt{})
		problem := v.String("problemDescription", httpx.Opt{Min: httpx.Min(3), Max: httpx.Max(2000)})
		if err := v.Done(); err != nil {
			return err
		}
		in.MachineID, in.ProblemDescription = *machineID, *problem
		request, err := svc.CreateRequest(r.Context(), tenant(r), in, actorOf(r))
		if err != nil {
			return err
		}
		return httpx.Created(w, request)
	}))

	r.Post("/maintenance/requests/{id}/accept", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		technicianID := v.String("technicianId", httpx.Opt{Optional: true})
		technicianName := v.String("technicianName", httpx.Opt{Optional: true})
		scheduledFor := v.ISODate("scheduledFor", httpx.Opt{Optional: true})
		if err := v.Done(); err != nil {
			return err
		}
		record, err := svc.AcceptRequest(r.Context(), tenant(r), chi.URLParam(r, "id"), technicianID, technicianName, scheduledFor, actorOf(r))
		if err != nil {
			return err
		}
		return httpx.Created(w, record)
	}))

	r.Post("/maintenance/requests/{id}/reject", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		if err := svc.RejectRequest(r.Context(), tenant(r), chi.URLParam(r, "id")); err != nil {
			return err
		}
		return httpx.OK(w, map[string]any{"success": true, "message": "Permintaan maintenance ditolak."})
	}))

	r.Get("/maintenance/records", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		list, err := svc.Records(r.Context(), tenant(r), RecordFilter{MachineID: q(r, "machineId"), Status: q(r, "status"), MaintenanceType: q(r, "maintenanceType"),
			From: q(r, "from"), To: q(r, "to"), Limit: httpx.QueryInt(r, "limit", 0)})
		if err != nil {
			return err
		}
		return httpx.OK(w, list)
	}))

	r.Post("/maintenance/records/{id}/assign", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		technicianID := v.String("technicianId", httpx.Opt{})
		technicianName := v.String("technicianName", httpx.Opt{Optional: true})
		scheduledFor := v.ISODate("scheduledFor", httpx.Opt{Optional: true})
		if err := v.Done(); err != nil {
			return err
		}
		record, err := svc.AssignTechnician(r.Context(), tenant(r), chi.URLParam(r, "id"), *technicianID, technicianName, scheduledFor)
		if err != nil {
			return err
		}
		return httpx.OK(w, record)
	}))

	r.Post("/maintenance/records/{id}/start", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		record, err := svc.StartWork(r.Context(), tenant(r), chi.URLParam(r, "id"), actorOf(r))
		if err != nil {
			return err
		}
		if _, err := auditor.Record(r.Context(), audit.FromRequest(r, "maintenance_record", record.ID, "MAINTENANCE_START", nil, map[string]any{"machineId": record.MachineID, "maintenanceType": record.MaintenanceType})); err != nil {
			return err
		}
		return httpx.OK(w, record)
	}))

	r.Post("/maintenance/records/{id}/complete", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		in := CompleteInput{RootCause: v.String("rootCause", httpx.Opt{Optional: true, Max: httpx.Max(2000)}), ActionTaken: v.String("actionTaken", httpx.Opt{Optional: true, Max: httpx.Max(2000)}),
			CostReference: v.Number("costReference", httpx.Opt{Min: httpx.Min(0), Optional: true}), MeterReading: v.Number("meterReading", httpx.Opt{Min: httpx.Min(0), Optional: true}),
			Notes: v.String("notes", httpx.Opt{Optional: true, Max: httpx.Max(1000)})}
		result := v.String("result", httpx.Opt{})
		if err := v.Done(); err != nil {
			return err
		}
		in.Result = *result
		if parts, ok := body["parts"].([]any); ok {
			for _, item := range parts {
				m, _ := item.(map[string]any)
				part := PartInput{PartID: optString(m, "partId"), UOM: optString(m, "uom"), CostReference: optNumber(m, "costReference")}
				if s, ok := m["partName"].(string); ok {
					part.PartName = s
				}
				if f, ok := m["quantity"].(float64); ok {
					part.Quantity = f
				}
				in.Parts = append(in.Parts, part)
			}
		}
		record, err := svc.CompleteWork(r.Context(), tenant(r), chi.URLParam(r, "id"), in, actorOf(r))
		if err != nil {
			return err
		}
		if _, err := auditor.Record(r.Context(), audit.FromRequest(r, "maintenance_record", record.ID, "MAINTENANCE_COMPLETE", nil, map[string]any{"result": in.Result, "durationMinutes": record.DurationMinutes, "rootCause": in.RootCause, "machineId": record.MachineID})); err != nil {
			return err
		}
		return httpx.OK(w, record)
	}))

	r.Post("/maintenance/emergency", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		in := EmergencyInput{WorkOrderID: v.String("workOrderId", httpx.Opt{Optional: true}), LineID: v.String("lineId", httpx.Opt{Optional: true}), OperatorID: v.String("operatorId", httpx.Opt{Optional: true}),
			ShiftID: v.String("shiftId", httpx.Opt{Optional: true}), ReasonID: v.String("reasonId", httpx.Opt{Optional: true}), TechnicianID: v.String("technicianId", httpx.Opt{Optional: true}),
			TechnicianName: v.String("technicianName", httpx.Opt{Optional: true})}
		machineID := v.String("machineId", httpx.Opt{})
		problem := v.String("problem", httpx.Opt{Min: httpx.Min(3), Max: httpx.Max(2000)})
		if err := v.Done(); err != nil {
			return err
		}
		in.MachineID, in.Problem = *machineID, *problem
		outcome, err := svc.RaiseEmergency(r.Context(), tenant(r), in, actorOf(r))
		if err != nil {
			return err
		}
		if _, err := auditor.Record(r.Context(), audit.FromRequest(r, "maintenance_record", outcome.Record.ID, "MAINTENANCE_EMERGENCY", nil, map[string]any{"machineId": in.MachineID, "problem": in.Problem, "downtimeId": outcome.DowntimeID})); err != nil {
			return err
		}
		return httpx.Created(w, outcome)
	}))

	r.Get("/maintenance/kpi", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		out, err := svc.KPI(r.Context(), tenant(r), q(r, "from"), q(r, "to"), q(r, "machineId"))
		if err != nil {
			return err
		}
		return httpx.OK(w, out)
	}))
}
