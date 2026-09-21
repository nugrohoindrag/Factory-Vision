package onboarding

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api/internal/modules/identity"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/auth"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/db"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/httpx"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/tenancy"
)

func tenantOf(r *http.Request) string {
	if id := tenancy.TenantID(r.Context()); id != "" {
		return id
	}
	return "tenant-pilot-factory-01"
}

func userOf(r *http.Request) *string {
	if p := auth.PrincipalFrom(r.Context()); p != nil {
		return db.Ptr(p.SubjectID)
	}
	return nil
}

// Mount registers the trial registration and the onboarding routes.
func Mount(r chi.Router, svc *Service) {
	r.Post("/auth/trial-register", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		fullName := v.String("fullName", httpx.Opt{Min: httpx.Min(2)})
		email := v.Email("email", httpx.Opt{})
		// Length is checked against the shared policy in the service.
		password := v.String("password", httpx.Opt{Min: httpx.Min(1)})
		factoryName := v.String("factoryName", httpx.Opt{Min: httpx.Min(2)})
		industry := v.String("industry", httpx.Opt{Min: httpx.Min(2)})
		plantScale := v.String("plantScale", httpx.Opt{Optional: true, Max: httpx.Max(64)})
		// The code is the proof that somebody at the vendor has spoken to this
		// person; the form is public, the workspace it creates is not cheap.
		referralCode := v.String("referralCode", httpx.Opt{Min: httpx.Min(4), Max: httpx.Max(32)})
		if err := v.DoneWith("Lengkapi semua kolom formulir trial."); err != nil {
			return err
		}
		in := TrialInput{FullName: *fullName, Email: *email, Password: *password, FactoryName: *factoryName, Industry: db.Deref(industry, "general"), PlantScale: plantScale, ReferralCode: *referralCode}
		if city, ok := body["city"].(string); ok {
			in.City = &city
		}
		if in.Industry == "" {
			in.Industry = "general"
		}
		result, err := svc.RegisterTrial(r.Context(), in, identity.ClientContextFrom(r))
		if err != nil {
			return err
		}
		return httpx.Created(w, result)
	}))

	r.Get("/onboarding/templates", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		return httpx.OK(w, svc.Templates())
	}))

	r.Post("/onboarding/apply-template", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		industry := db.Deref(v.String("industry", httpx.Opt{}), "general")
		if industry == "" {
			industry = "general"
		}
		profile := ProfileInput{}
		if s, ok := body["factoryName"].(string); ok {
			profile.FactoryName = &s
		}
		if s, ok := body["city"].(string); ok {
			profile.City = &s
		}
		if s, ok := body["timezone"].(string); ok {
			profile.Timezone = &s
		}
		result, err := svc.ApplyTemplate(r.Context(), tenantOf(r), industry, profile)
		if err != nil {
			return err
		}
		return httpx.OK(w, result)
	}))

	r.Post("/onboarding/create-blank", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		factoryName := v.String("factoryName", httpx.Opt{Min: httpx.Min(2)})
		industry := v.String("industry", httpx.Opt{})
		country := v.String("country", httpx.Opt{})
		timezone := v.String("timezone", httpx.Opt{})
		calendar := v.String("workingCalendar", httpx.Opt{})
		if err := v.Done(); err != nil {
			return err
		}
		profile := ProfileInput{FactoryName: factoryName, Industry: db.Deref(industry, "general"), Country: db.Deref(country, "Indonesia"), Timezone: db.Ptr(db.Deref(timezone, "Asia/Jakarta")), WorkingCalendar: db.Deref(calendar, "2 Shift")}
		if s, ok := body["city"].(string); ok {
			profile.City = &s
		}
		result, err := svc.CreateBlankFactory(r.Context(), tenantOf(r), profile)
		if err != nil {
			return err
		}
		return httpx.OK(w, result)
	}))

	r.Get("/onboarding/status", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		status, err := svc.Status(r.Context(), tenantOf(r), db.Deref(userOf(r), ""))
		if err != nil {
			return err
		}
		return httpx.OK(w, status)
	}))

	r.Put("/onboarding/step", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		stepID := v.String("stepId", httpx.Opt{Min: httpx.Min(1)})
		status := v.String("status", httpx.Opt{Min: httpx.Min(1)})
		if err := v.DoneWith("stepId dan status wajib diisi."); err != nil {
			return err
		}
		progress, err := svc.UpdateStep(r.Context(), tenantOf(r), *stepID, *status)
		if err != nil {
			return err
		}
		return httpx.OK(w, progress)
	}))

	r.Get("/onboarding/guidance", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		g, err := svc.GetGuidance(r.Context(), tenantOf(r))
		if err != nil {
			return err
		}
		return httpx.OK(w, g)
	}))

	r.Put("/onboarding/guidance", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		patch := GuidancePatch{}
		if b, ok := body["tourCompleted"].(bool); ok {
			patch.TourCompleted = &b
		}
		if b, ok := body["tourSkipped"].(bool); ok {
			patch.TourSkipped = &b
		}
		if f, ok := body["activeTourStep"].(float64); ok {
			n := int(f)
			patch.ActiveTourStep = &n
		}
		if items, ok := body["dismissedTooltips"].([]any); ok {
			patch.DismissedTooltips = []string{}
			for _, it := range items {
				if s, ok := it.(string); ok {
					patch.DismissedTooltips = append(patch.DismissedTooltips, s)
				}
			}
		}
		g, err := svc.UpdateGuidance(r.Context(), tenantOf(r), patch)
		if err != nil {
			return err
		}
		return httpx.OK(w, g)
	}))

	r.Post("/onboarding/first-workflow", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		in := FirstWorkflowInput{}
		if s, ok := body["productId"].(string); ok {
			in.ProductID = &s
		}
		intOf := func(key string) *int {
			if f, ok := body[key].(float64); ok {
				n := int(f)
				return &n
			}
			return nil
		}
		in.Quantity, in.GoodQty, in.RejectQty = intOf("quantity"), intOf("goodQty"), intOf("rejectQty")
		result, err := svc.ExecuteFirstWorkflow(r.Context(), tenantOf(r), in)
		if err != nil {
			return err
		}
		return httpx.OK(w, result)
	}))

	r.Post("/onboarding/events", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		eventName, _ := body["eventName"].(string)
		if eventName == "" {
			return httpx.Validation("eventName wajib diisi.")
		}
		metadata, _ := body["metadata"].(map[string]any)
		svc.RecordAnalyticsEvent(r.Context(), tenantOf(r), eventName, userOf(r), metadata)
		return httpx.OK(w, map[string]any{"success": true})
	}))

	r.Post("/onboarding/upgrade", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		planCode, _ := body["planCode"].(string)
		if planCode == "" {
			planCode = "GROWTH"
		}
		result, err := svc.UpgradePlan(r.Context(), tenantOf(r), planCode)
		if err != nil {
			return err
		}
		return httpx.OK(w, result)
	}))
}
