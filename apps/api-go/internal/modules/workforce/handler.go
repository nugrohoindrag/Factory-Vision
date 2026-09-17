package workforce

import (
	"net/http"
	"strconv"
	"strings"

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
		return Actor{ID: "system", Name: db.Ptr("System")}
	}
	return Actor{ID: p.SubjectID, Name: db.Ptr(p.Name)}
}

func success(w http.ResponseWriter, message string) error {
	return httpx.OK(w, map[string]any{"success": true, "message": message})
}

// Mount registers /workforce/*.
func Mount(r chi.Router, svc *Service, auditor audit.Recorder) {
	tenant := func(r *http.Request) string { return tenancy.TenantID(r.Context()) }
	q := func(r *http.Request, key string) string { return r.URL.Query().Get(key) }

	// --- Skills ---------------------------------------------------------

	r.Get("/workforce/skills", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		list, err := svc.Skills(r.Context(), tenant(r))
		if err != nil {
			return err
		}
		return httpx.OK(w, list)
	}))

	r.Post("/workforce/skills", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		code := v.String("code", httpx.Opt{Min: httpx.Min(2), Max: httpx.Max(64)})
		name := v.String("name", httpx.Opt{Min: httpx.Min(2), Max: httpx.Max(255)})
		category := v.String("category", httpx.Opt{Optional: true, Max: httpx.Max(64)})
		description := v.String("description", httpx.Opt{Optional: true, Max: httpx.Max(1000)})
		maxLevel := v.Int("maxLevel", httpx.Opt{Min: httpx.Min(1), Max: httpx.Max(10), Optional: true})
		if err := v.Done(); err != nil {
			return err
		}
		skill, err := svc.CreateSkill(r.Context(), tenant(r), *code, *name, category, description, maxLevel)
		if err != nil {
			return err
		}
		return httpx.Created(w, skill)
	}))

	r.Put("/workforce/skills/{id}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		code, name := v.OptStr("code"), v.OptStr("name")
		category, description := v.OptStr("category"), v.OptStr("description")
		maxLevel := v.Int("maxLevel", httpx.Opt{Optional: true})
		if err := v.Done(); err != nil {
			return err
		}
		skill, err := svc.UpdateSkill(r.Context(), tenant(r), chi.URLParam(r, "id"), code, name, category, description, maxLevel)
		if err != nil {
			return err
		}
		return httpx.OK(w, skill)
	}))

	r.Delete("/workforce/skills/{id}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		if err := svc.DeleteSkill(r.Context(), tenant(r), chi.URLParam(r, "id")); err != nil {
			return err
		}
		return success(w, "Skill dihapus.")
	}))

	// --- Requirements ---------------------------------------------------

	r.Get("/workforce/requirements", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		list, err := svc.Requirements(r.Context(), tenant(r), q(r, "targetType"), q(r, "targetId"))
		if err != nil {
			return err
		}
		return httpx.OK(w, list)
	}))

	r.Post("/workforce/requirements", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		targetType := v.String("targetType", httpx.Opt{})
		targetID := v.String("targetId", httpx.Opt{})
		skillID := v.String("skillId", httpx.Opt{})
		minimumLevel := v.Int("minimumLevel", httpx.Opt{Min: httpx.Min(1), Max: httpx.Max(10), Optional: true})
		mandatory := v.Boolean("mandatory", httpx.Opt{Optional: true})
		if err := v.Done(); err != nil {
			return err
		}
		if *targetType != "MACHINE" && *targetType != "PROCESS" {
			return httpx.Validation("targetType harus MACHINE atau PROCESS.")
		}
		req, err := svc.SetRequirement(r.Context(), tenant(r), *targetType, *targetID, *skillID, minimumLevel, mandatory)
		if err != nil {
			return err
		}
		return httpx.Created(w, req)
	}))

	r.Delete("/workforce/requirements/{id}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		if err := svc.DeleteRequirement(r.Context(), tenant(r), chi.URLParam(r, "id")); err != nil {
			return err
		}
		return success(w, "Requirement kualifikasi dihapus.")
	}))

	// --- Qualifications -------------------------------------------------

	r.Get("/workforce/qualifications", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		f := QualificationFilter{OperatorID: q(r, "operatorId"), SkillID: q(r, "skillId")}
		if raw := q(r, "expiringWithinDays"); raw != "" {
			n, err := strconv.Atoi(raw)
			if err != nil {
				return httpx.Validation("expiringWithinDays harus berupa angka.")
			}
			f.ExpiringWithinDays = &n
		}
		list, err := svc.Qualifications(r.Context(), tenant(r), f)
		if err != nil {
			return err
		}
		return httpx.OK(w, list)
	}))

	r.Post("/workforce/qualifications", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		in := QualificationInput{
			CertifiedDate: v.ISODate("certifiedDate", httpx.Opt{Optional: true}), ExpiryDate: v.ISODate("expiryDate", httpx.Opt{Optional: true}),
			Issuer: v.String("issuer", httpx.Opt{Optional: true, Max: httpx.Max(255)}), CertificateNumber: v.String("certificateNumber", httpx.Opt{Optional: true, Max: httpx.Max(128)}),
			Status: v.OptStr("status"), SuspendedReason: v.String("suspendedReason", httpx.Opt{Optional: true, Max: httpx.Max(1000)}),
		}
		operatorID := v.String("operatorId", httpx.Opt{})
		skillID := v.String("skillId", httpx.Opt{})
		level := v.Int("level", httpx.Opt{Min: httpx.Min(1), Max: httpx.Max(10)})
		if err := v.Done(); err != nil {
			return err
		}
		in.OperatorID, in.SkillID, in.Level = *operatorID, *skillID, *level
		qual, err := svc.SetQualification(r.Context(), tenant(r), in, actorOf(r))
		if err != nil {
			return err
		}
		if _, err := auditor.Record(r.Context(), audit.FromRequest(r, "operator_qualification", qual.ID, "QUALIFICATION_SET", nil,
			map[string]any{"operatorId": qual.OperatorID, "skillCode": qual.SkillCode, "level": qual.Level, "expiryDate": qual.ExpiryDate, "status": qual.Status})); err != nil {
			return err
		}
		return httpx.Created(w, qual)
	}))

	r.Delete("/workforce/qualifications/{id}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		id := chi.URLParam(r, "id")
		if err := svc.DeleteQualification(r.Context(), tenant(r), id); err != nil {
			return err
		}
		if _, err := auditor.Record(r.Context(), audit.FromRequest(r, "operator_qualification", id, "QUALIFICATION_REMOVE", nil, nil)); err != nil {
			return err
		}
		return success(w, "Kualifikasi dihapus.")
	}))

	// --- Shift assignments ----------------------------------------------

	r.Get("/workforce/shift-assignments", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		list, err := svc.ShiftAssignments(r.Context(), tenant(r), q(r, "operatorId"), q(r, "shiftId"), q(r, "onDate"))
		if err != nil {
			return err
		}
		return httpx.OK(w, list)
	}))

	r.Post("/workforce/shift-assignments", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		operatorID := v.String("operatorId", httpx.Opt{})
		shiftID := v.String("shiftId", httpx.Opt{})
		effectiveFrom := v.ISODate("effectiveFrom", httpx.Opt{Optional: true})
		effectiveTo := v.ISODate("effectiveTo", httpx.Opt{Optional: true})
		isDefault := v.Boolean("isDefault", httpx.Opt{Optional: true})
		if err := v.Done(); err != nil {
			return err
		}
		a, err := svc.AssignShift(r.Context(), tenant(r), *operatorID, *shiftID, effectiveFrom, effectiveTo, isDefault, actorOf(r))
		if err != nil {
			return err
		}
		return httpx.Created(w, a)
	}))

	r.Delete("/workforce/shift-assignments/{id}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		if err := svc.RemoveShiftAssignment(r.Context(), tenant(r), chi.URLParam(r, "id")); err != nil {
			return err
		}
		return success(w, "Penugasan shift dihapus.")
	}))

	// --- Availability ---------------------------------------------------

	r.Get("/workforce/availability", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		list, err := svc.AvailabilityList(r.Context(), tenant(r), q(r, "operatorId"))
		if err != nil {
			return err
		}
		return httpx.OK(w, list)
	}))

	r.Post("/workforce/availability", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		operatorID := v.String("operatorId", httpx.Opt{})
		state := v.String("state", httpx.Opt{})
		shiftID, effectiveFrom, effectiveTo := v.OptStr("shiftId"), v.OptStr("effectiveFrom"), v.OptStr("effectiveTo")
		reason := v.String("reason", httpx.Opt{Optional: true, Max: httpx.Max(500)})
		if err := v.Done(); err != nil {
			return err
		}
		a, err := svc.SetAvailability(r.Context(), tenant(r), *operatorID, *state, shiftID, effectiveFrom, effectiveTo, reason, actorOf(r))
		if err != nil {
			return err
		}
		return httpx.Created(w, a)
	}))

	// --- Eligibility ----------------------------------------------------

	r.Get("/workforce/eligibility", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		c := EligibilityContext{MachineID: q(r, "machineId"), ProcessID: q(r, "processId"), OnDate: q(r, "onDate")}
		if ids := q(r, "operatorIds"); ids != "" {
			c.OperatorIDs = strings.Split(ids, ",")
		}
		list, err := svc.Eligibility(r.Context(), tenant(r), c)
		if err != nil {
			return err
		}
		return httpx.OK(w, list)
	}))

	// --- Labour requirement & assignments -------------------------------

	r.Get("/workforce/labor-requirements/{workOrderId}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		status, err := svc.LaborStatus(r.Context(), tenant(r), chi.URLParam(r, "workOrderId"))
		if err != nil {
			return err
		}
		return httpx.OK(w, status)
	}))

	r.Put("/workforce/labor-requirements/{workOrderId}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		required := v.Int("requiredOperators", httpx.Opt{Min: httpx.Min(0), Max: httpx.Max(100)})
		shiftID := v.OptStr("shiftId")
		notes := v.String("notes", httpx.Opt{Optional: true, Max: httpx.Max(500)})
		if err := v.Done(); err != nil {
			return err
		}
		status, err := svc.SetLaborRequirement(r.Context(), tenant(r), chi.URLParam(r, "workOrderId"), *required, shiftID, notes)
		if err != nil {
			return err
		}
		return httpx.OK(w, status)
	}))

	r.Get("/workforce/assignments", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		list, err := svc.Assignments(r.Context(), tenant(r), AssignmentFilter{WorkOrderID: q(r, "workOrderId"), OperatorID: q(r, "operatorId"), Status: q(r, "status"), Active: q(r, "active") == "true"})
		if err != nil {
			return err
		}
		return httpx.OK(w, list)
	}))

	r.Post("/workforce/assignments", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		workOrderID := v.String("workOrderId", httpx.Opt{})
		operatorID := v.String("operatorId", httpx.Opt{})
		role := v.String("role", httpx.Opt{Optional: true, Max: httpx.Max(64)})
		shiftID := v.OptStr("shiftId")
		force := v.Boolean("force", httpx.Opt{Optional: true})
		if err := v.Done(); err != nil {
			return err
		}
		forced := force != nil && *force
		// Overriding a qualification check is a decision somebody has to own,
		// so it takes the manage right rather than the everyday assignment right.
		if forced {
			p := auth.PrincipalFrom(r.Context())
			if p == nil || !p.Has("workforce:manage") {
				return httpx.Forbidden("Menugaskan operator yang tidak memenuhi syarat memerlukan izin workforce:manage.")
			}
		}
		a, err := svc.AssignOperator(r.Context(), tenant(r), *workOrderID, *operatorID, role, shiftID, forced, actorOf(r))
		if err != nil {
			return err
		}
		if _, err := auditor.Record(r.Context(), audit.FromRequest(r, "labor_assignment", a.ID, "OPERATOR_ASSIGNED", nil,
			map[string]any{"workOrderId": a.WorkOrderID, "operatorId": a.OperatorID, "qualificationCheck": a.QualificationCheck, "forced": forced})); err != nil {
			return err
		}
		return httpx.Created(w, a)
	}))

	r.Delete("/workforce/assignments/{id}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		id := chi.URLParam(r, "id")
		if err := svc.UnassignOperator(r.Context(), tenant(r), id, actorOf(r)); err != nil {
			return err
		}
		if _, err := auditor.Record(r.Context(), audit.FromRequest(r, "labor_assignment", id, "OPERATOR_UNASSIGNED", nil, nil)); err != nil {
			return err
		}
		return success(w, "Penugasan operator dilepas.")
	}))

	// --- Time & utilisation ---------------------------------------------

	r.Get("/workforce/time-records", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		f := TimeFilter{OperatorID: q(r, "operatorId"), WorkOrderID: q(r, "workOrderId"), From: q(r, "from"), To: q(r, "to")}
		if raw := q(r, "limit"); raw != "" {
			n, err := strconv.Atoi(raw)
			if err != nil {
				return httpx.Validation("limit harus berupa angka.")
			}
			f.Limit = n
		}
		list, err := svc.TimeRecords(r.Context(), tenant(r), f)
		if err != nil {
			return err
		}
		return httpx.OK(w, list)
	}))

	r.Post("/workforce/time-records", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		in := TimeInput{WorkOrderID: v.OptStr("workOrderId"), ShiftID: v.OptStr("shiftId"), ShiftDate: v.ISODate("shiftDate", httpx.Opt{Optional: true}),
			EndedAt: v.OptStr("endedAt"), Category: v.OptStr("category")}
		operatorID := v.String("operatorId", httpx.Opt{})
		startedAt := v.String("startedAt", httpx.Opt{})
		productive := v.Number("productiveMinutes", httpx.Opt{Min: httpx.Min(0)})
		available := v.Number("availableMinutes", httpx.Opt{Min: httpx.Min(0)})
		if err := v.Done(); err != nil {
			return err
		}
		in.OperatorID, in.StartedAt, in.ProductiveMinutes, in.AvailableMinutes = *operatorID, *startedAt, *productive, *available
		rec, err := svc.RecordTime(r.Context(), tenant(r), in, actorOf(r))
		if err != nil {
			return err
		}
		return httpx.Created(w, rec)
	}))

	r.Get("/workforce/utilization", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		scope := q(r, "scope")
		if scope == "" {
			scope = "OPERATOR"
		}
		list, err := svc.UtilizationBy(r.Context(), tenant(r), scope, q(r, "from"), q(r, "to"))
		if err != nil {
			return err
		}
		return httpx.OK(w, list)
	}))

	r.Get("/workforce/dashboard", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		d, err := svc.WorkforceDashboard(r.Context(), tenant(r))
		if err != nil {
			return err
		}
		return httpx.OK(w, d)
	}))
}
