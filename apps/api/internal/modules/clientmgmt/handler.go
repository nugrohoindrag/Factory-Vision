package clientmgmt

import (
	"context"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/db"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/httpx"
)

type principalKey struct{}

// resolve attaches the internal principal for a Bearer token, if any.
func (s *Service) resolve(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		header := r.Header.Get("Authorization")
		if strings.HasPrefix(header, "Bearer ") {
			p, err := s.Resolve(r.Context(), strings.TrimSpace(header[7:]))
			if err == nil && p != nil {
				r = r.WithContext(context.WithValue(r.Context(), principalKey{}, p))
			}
		}
		next.ServeHTTP(w, r)
	})
}

func principalOf(r *http.Request) *Principal {
	p, _ := r.Context().Value(principalKey{}).(*Principal)
	return p
}

func actorOf(r *http.Request) Actor {
	ip := httpx.ClientIP(r)
	return Actor{Email: principalOf(r).Email, IP: &ip}
}

// Mount registers the vendor API under /api/internal/v1.
func Mount(root chi.Router, svc *Service) {
	root.Route("/api/internal/v1", func(r chi.Router) {
		r.Use(svc.resolve)
		q := func(r *http.Request, key string) string { return r.URL.Query().Get(key) }
		guard := func(right string, fn func(w http.ResponseWriter, r *http.Request) error) http.HandlerFunc {
			return httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
				if err := Assert(principalOf(r), right); err != nil {
					return err
				}
				return fn(w, r)
			})
		}

		// --- Session --------------------------------------------------------

		r.Post("/auth/login", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
			body, err := httpx.Body(r)
			if err != nil {
				return err
			}
			v := httpx.Validate(body)
			email := v.Email("email", httpx.Opt{})
			password := v.String("password", httpx.Opt{Min: httpx.Min(1)})
			if err := v.DoneWith("Email dan kata sandi wajib diisi."); err != nil {
				return err
			}
			ip := httpx.ClientIP(r)
			token, principal, err := svc.Login(r.Context(), *email, *password, &ip)
			if err != nil {
				return err
			}
			return httpx.OK(w, map[string]any{"token": token, "principal": principal})
		}))

		r.Get("/auth/session", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
			p := principalOf(r)
			if p == nil {
				return httpx.Unauthenticated("Sesi internal tidak aktif.")
			}
			return httpx.OK(w, map[string]any{"principal": p})
		}))

		r.Post("/auth/logout", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
			if p := principalOf(r); p != nil {
				if err := svc.Logout(r.Context(), p.SessionID); err != nil {
					return err
				}
			}
			return httpx.OK(w, map[string]any{"success": true})
		}))

		// --- Portfolio ------------------------------------------------------

		r.Get("/summary", guard("client:view", func(w http.ResponseWriter, r *http.Request) error {
			summary, err := svc.Portfolio(r.Context())
			if err != nil {
				return err
			}
			return httpx.OK(w, summary)
		}))

		r.Get("/plans", guard("client:view", func(w http.ResponseWriter, r *http.Request) error {
			plans, err := svc.Plans(r.Context())
			if err != nil {
				return err
			}
			return httpx.OK(w, plans)
		}))

		// --- Clients --------------------------------------------------------

		r.Get("/clients", guard("client:view", func(w http.ResponseWriter, r *http.Request) error {
			list, err := svc.Clients(r.Context(), q(r, "status"), q(r, "search"))
			if err != nil {
				return err
			}
			return httpx.OK(w, list)
		}))

		r.Get("/clients/{id}", guard("client:view", func(w http.ResponseWriter, r *http.Request) error {
			o, err := svc.ClientByID(r.Context(), chi.URLParam(r, "id"))
			if err != nil {
				return err
			}
			return httpx.OK(w, o)
		}))

		r.Post("/clients", guard("client:manage", func(w http.ResponseWriter, r *http.Request) error {
			body, err := httpx.Body(r)
			if err != nil {
				return err
			}
			v := httpx.Validate(body)
			legalName := v.String("legalName", httpx.Opt{Min: httpx.Min(2), Max: httpx.Max(255)})
			displayName := v.String("displayName", httpx.Opt{Min: httpx.Min(2), Max: httpx.Max(255)})
			planID := v.String("planId", httpx.Opt{})
			startedAt := v.ISODate("startedAt", httpx.Opt{})
			lifecycle := v.OneOf("lifecycleStatus", []string{"PROSPECT", "TRIAL", "ACTIVE"}, httpx.Opt{})
			deployment := v.OneOf("deploymentMode", []string{"CLOUD_MULTI_TENANT", "ON_PREMISE_SINGLE_TENANT"}, httpx.Opt{Optional: true})
			in := CreateClientInput{Industry: v.String("industry", httpx.Opt{Optional: true, Max: httpx.Max(128)}), City: v.String("city", httpx.Opt{Optional: true, Max: httpx.Max(128)}),
				ContactName: v.String("contactName", httpx.Opt{Optional: true, Max: httpx.Max(255)}), ContactEmail: v.Email("contactEmail", httpx.Opt{Optional: true}),
				ContactPhone: v.String("contactPhone", httpx.Opt{Optional: true, Max: httpx.Max(64)}), AccountManager: v.String("accountManager", httpx.Opt{Optional: true, Max: httpx.Max(255)}),
				RenewsAt: dateOnly(v.ISODate("renewsAt", httpx.Opt{Optional: true})), Notes: v.String("notes", httpx.Opt{Optional: true, Max: httpx.Max(2000)})}
			if err := v.Done(); err != nil {
				return err
			}
			in.LegalName, in.DisplayName, in.PlanID, in.StartedAt, in.LifecycleStatus = *legalName, *displayName, *planID, *dateOnly(startedAt), *lifecycle
			in.DeploymentMode = db.Deref(deployment, "CLOUD_MULTI_TENANT")
			client, sub, err := svc.CreateClient(r.Context(), in, actorOf(r))
			if err != nil {
				return err
			}
			return httpx.Created(w, map[string]any{"client": client, "subscription": sub})
		}))

		r.Put("/clients/{id}", guard("client:manage", func(w http.ResponseWriter, r *http.Request) error {
			body, err := httpx.Body(r)
			if err != nil {
				return err
			}
			v := httpx.Validate(body)
			p := ClientPatch{DisplayName: v.String("displayName", httpx.Opt{Optional: true, Min: httpx.Min(2), Max: httpx.Max(255)}), LegalName: v.String("legalName", httpx.Opt{Optional: true, Min: httpx.Min(2), Max: httpx.Max(255)}),
				Industry: v.String("industry", httpx.Opt{Optional: true, Max: httpx.Max(128)}), City: v.String("city", httpx.Opt{Optional: true, Max: httpx.Max(128)}),
				ContactName: v.String("contactName", httpx.Opt{Optional: true, Max: httpx.Max(255)}), ContactEmail: v.Email("contactEmail", httpx.Opt{Optional: true}),
				ContactPhone: v.String("contactPhone", httpx.Opt{Optional: true, Max: httpx.Max(64)}), AccountManager: v.String("accountManager", httpx.Opt{Optional: true, Max: httpx.Max(255)}),
				Notes: v.String("notes", httpx.Opt{Optional: true, Max: httpx.Max(2000)})}
			if err := v.Done(); err != nil {
				return err
			}
			client, err := svc.UpdateClient(r.Context(), chi.URLParam(r, "id"), p, actorOf(r))
			if err != nil {
				return err
			}
			return httpx.OK(w, client)
		}))

		r.Patch("/clients/{id}/status", guard("client:manage", func(w http.ResponseWriter, r *http.Request) error {
			body, err := httpx.Body(r)
			if err != nil {
				return err
			}
			v := httpx.Validate(body)
			status := v.OneOf("status", []string{"PROSPECT", "TRIAL", "ACTIVE", "SUSPENDED", "CHURNED"}, httpx.Opt{})
			if err := v.Done(); err != nil {
				return err
			}
			client, err := svc.SetLifecycleStatus(r.Context(), chi.URLParam(r, "id"), *status, actorOf(r))
			if err != nil {
				return err
			}
			return httpx.OK(w, client)
		}))

		// --- Subscription ---------------------------------------------------

		r.Get("/clients/{id}/subscriptions", guard("client:view", func(w http.ResponseWriter, r *http.Request) error {
			list, err := svc.SubscriptionHistory(r.Context(), chi.URLParam(r, "id"))
			if err != nil {
				return err
			}
			return httpx.OK(w, list)
		}))

		r.Post("/clients/{id}/subscription", guard("subscription:manage", func(w http.ResponseWriter, r *http.Request) error {
			body, err := httpx.Body(r)
			if err != nil {
				return err
			}
			v := httpx.Validate(body)
			planID := v.String("planId", httpx.Opt{})
			startedAt := v.ISODate("startedAt", httpx.Opt{})
			in := ChangePlanInput{ClientID: chi.URLParam(r, "id"), RenewsAt: dateOnly(v.ISODate("renewsAt", httpx.Opt{Optional: true})),
				MaxPlants: v.Int("overrideMaxPlants", httpx.Opt{Optional: true, Min: httpx.Min(0)}), MaxProductionLines: v.Int("overrideMaxProductionLines", httpx.Opt{Optional: true, Min: httpx.Min(0)}),
				MaxMachines: v.Int("overrideMaxMachines", httpx.Opt{Optional: true, Min: httpx.Min(0)}), MaxUsers: v.Int("overrideMaxUsers", httpx.Opt{Optional: true, Min: httpx.Min(0)}),
				MaxOperators: v.Int("overrideMaxOperators", httpx.Opt{Optional: true, Min: httpx.Min(0)})}
			if err := v.Done(); err != nil {
				return err
			}
			in.PlanID, in.StartedAt = *planID, *dateOnly(startedAt)
			sub, err := svc.ChangePlan(r.Context(), in, actorOf(r))
			if err != nil {
				return err
			}
			return httpx.Created(w, sub)
		}))

		// --- Usage ----------------------------------------------------------

		r.Get("/clients/{id}/usage", guard("client:view", func(w http.ResponseWriter, r *http.Request) error {
			days := 30
			if n, err := strconv.Atoi(q(r, "days")); err == nil && n > 0 {
				days = n
			}
			if days > 365 {
				days = 365
			}
			list, err := svc.UsageHistory(r.Context(), chi.URLParam(r, "id"), days)
			if err != nil {
				return err
			}
			return httpx.OK(w, list)
		}))

		r.Post("/usage/capture", guard("client:view", func(w http.ResponseWriter, r *http.Request) error {
			list, err := svc.CaptureUsage(r.Context(), principalOf(r).Email)
			if err != nil {
				return err
			}
			return httpx.OK(w, list)
		}))

		// --- Support access -------------------------------------------------

		r.Get("/support-access", guard("client:view", func(w http.ResponseWriter, r *http.Request) error {
			list, err := svc.ActiveSupportAccess(r.Context())
			if err != nil {
				return err
			}
			return httpx.OK(w, list)
		}))

		r.Get("/clients/{id}/support-access", guard("client:view", func(w http.ResponseWriter, r *http.Request) error {
			list, err := svc.SupportAccessFor(r.Context(), chi.URLParam(r, "id"))
			if err != nil {
				return err
			}
			return httpx.OK(w, list)
		}))

		r.Post("/clients/{id}/support-access", guard("support:grant", func(w http.ResponseWriter, r *http.Request) error {
			body, err := httpx.Body(r)
			if err != nil {
				return err
			}
			v := httpx.Validate(body)
			grantedTo := v.Email("grantedTo", httpx.Opt{})
			reason := v.String("reason", httpx.Opt{Min: httpx.Min(10), Max: httpx.Max(500)})
			level := v.OneOf("accessLevel", []string{"READ_ONLY", "READ_WRITE"}, httpx.Opt{Optional: true})
			hours := v.Int("hours", httpx.Opt{Optional: true, Min: httpx.Min(1), Max: httpx.Max(72)})
			if err := v.Done(); err != nil {
				return err
			}
			grant, err := svc.GrantSupportAccess(r.Context(), GrantInput{ClientID: chi.URLParam(r, "id"), GrantedTo: *grantedTo, Reason: *reason, AccessLevel: db.Deref(level, "READ_ONLY"), Hours: db.Deref(hours, 4)}, actorOf(r))
			if err != nil {
				return err
			}
			return httpx.Created(w, grant)
		}))

		r.Delete("/support-access/{grantId}", guard("support:grant", func(w http.ResponseWriter, r *http.Request) error {
			grant, err := svc.RevokeSupportAccess(r.Context(), chi.URLParam(r, "grantId"), actorOf(r))
			if err != nil {
				return err
			}
			return httpx.OK(w, grant)
		}))

		r.Post("/support-access/{grantId}/use", guard("support:grant", func(w http.ResponseWriter, r *http.Request) error {
			out, err := svc.UseSupportAccess(r.Context(), chi.URLParam(r, "grantId"), actorOf(r))
			if err != nil {
				return err
			}
			return httpx.OK(w, out)
		}))

		// --- Audit and staff ------------------------------------------------

		// --- Referral codes (trial gate) ----------------------------------

		r.Get("/referral-codes", guard("client:view", func(w http.ResponseWriter, r *http.Request) error {
			list, err := svc.ReferralCodes(r.Context())
			if err != nil {
				return err
			}
			return httpx.OK(w, list)
		}))

		r.Post("/referral-codes", guard("client:manage", func(w http.ResponseWriter, r *http.Request) error {
			body, err := httpx.Body(r)
			if err != nil {
				return err
			}
			v := httpx.Validate(body)
			label := v.String("label", httpx.Opt{Min: httpx.Min(3), Max: httpx.Max(255)})
			maxUses := v.Int("maxUses", httpx.Opt{Optional: true, Min: httpx.Min(1), Max: httpx.Max(maxReferralUses)})
			expiryDays := v.Int("expiryDays", httpx.Opt{Optional: true, Min: httpx.Min(0), Max: httpx.Max(365)})
			if err := v.Done(); err != nil {
				return err
			}
			code, err := svc.GenerateReferralCode(r.Context(), ReferralInput{Label: *label, MaxUses: db.Deref(maxUses, 1), ExpiryDays: db.Deref(expiryDays, 30)}, actorOf(r))
			if err != nil {
				return err
			}
			return httpx.Created(w, code)
		}))

		r.Delete("/referral-codes/{id}", guard("client:manage", func(w http.ResponseWriter, r *http.Request) error {
			code, err := svc.RevokeReferralCode(r.Context(), chi.URLParam(r, "id"), actorOf(r))
			if err != nil {
				return err
			}
			return httpx.OK(w, code)
		}))

		// --- CMS: site settings and articles --------------------------------

		r.Get("/cms/settings", guard("cms:view", func(w http.ResponseWriter, r *http.Request) error {
			s, err := svc.GetSiteSettings(r.Context())
			if err != nil {
				return err
			}
			return httpx.OK(w, s)
		}))

		r.Put("/cms/settings", guard("cms:manage", func(w http.ResponseWriter, r *http.Request) error {
			body, err := httpx.Body(r)
			if err != nil {
				return err
			}
			v := httpx.Validate(body)
			in := SiteSettings{
				SiteName:           db.Deref(v.String("siteName", httpx.Opt{Optional: true, Max: httpx.Max(120)}), ""),
				SiteURL:            db.Deref(v.String("siteUrl", httpx.Opt{Optional: true, Max: httpx.Max(255)}), ""),
				SiteDescription:    db.Deref(v.String("siteDescription", httpx.Opt{Optional: true, Max: httpx.Max(500)}), ""),
				GAMeasurementID:    db.Deref(v.String("gaMeasurementId", httpx.Opt{Optional: true, Max: httpx.Max(32)}), ""),
				SearchConsoleToken: db.Deref(v.String("searchConsoleToken", httpx.Opt{Optional: true, Max: httpx.Max(128)}), ""),
				SearchConsoleFile:  db.Deref(v.String("searchConsoleFile", httpx.Opt{Optional: true, Max: httpx.Max(64)}), ""),
			}
			if err := v.Done(); err != nil {
				return err
			}
			out, err := svc.UpdateSiteSettings(r.Context(), in, actorOf(r))
			if err != nil {
				return err
			}
			return httpx.OK(w, out)
		}))

		articleInput := func(body map[string]any) (ArticleInput, error) {
			v := httpx.Validate(body)
			in := ArticleInput{
				Title:         db.Deref(v.String("title", httpx.Opt{Min: httpx.Min(3), Max: httpx.Max(255)}), ""),
				Slug:          db.Deref(v.String("slug", httpx.Opt{Optional: true, Max: httpx.Max(160)}), ""),
				BodyMarkdown:  db.Deref(v.String("bodyMarkdown", httpx.Opt{Optional: true, Max: httpx.Max(200000)}), ""),
				Excerpt:       v.String("excerpt", httpx.Opt{Optional: true, Max: httpx.Max(500)}),
				CoverImageURL: v.String("coverImageUrl", httpx.Opt{Optional: true, Max: httpx.Max(1000)}),
				AuthorName:    v.String("authorName", httpx.Opt{Optional: true, Max: httpx.Max(255)}),
				SEOTitle:      v.String("seoTitle", httpx.Opt{Optional: true, Max: httpx.Max(255)}),
			}
			return in, v.Done()
		}

		r.Get("/cms/articles", guard("cms:view", func(w http.ResponseWriter, r *http.Request) error {
			list, err := svc.Articles(r.Context())
			if err != nil {
				return err
			}
			return httpx.OK(w, list)
		}))

		r.Post("/cms/articles", guard("cms:manage", func(w http.ResponseWriter, r *http.Request) error {
			body, err := httpx.Body(r)
			if err != nil {
				return err
			}
			in, err := articleInput(body)
			if err != nil {
				return err
			}
			a, err := svc.CreateArticle(r.Context(), in, actorOf(r))
			if err != nil {
				return err
			}
			return httpx.Created(w, a)
		}))

		r.Get("/cms/articles/{id}", guard("cms:view", func(w http.ResponseWriter, r *http.Request) error {
			a, err := svc.ArticleByID(r.Context(), chi.URLParam(r, "id"))
			if err != nil {
				return err
			}
			return httpx.OK(w, a)
		}))

		r.Put("/cms/articles/{id}", guard("cms:manage", func(w http.ResponseWriter, r *http.Request) error {
			body, err := httpx.Body(r)
			if err != nil {
				return err
			}
			in, err := articleInput(body)
			if err != nil {
				return err
			}
			a, err := svc.UpdateArticle(r.Context(), chi.URLParam(r, "id"), in, actorOf(r))
			if err != nil {
				return err
			}
			return httpx.OK(w, a)
		}))

		r.Patch("/cms/articles/{id}/status", guard("cms:manage", func(w http.ResponseWriter, r *http.Request) error {
			body, err := httpx.Body(r)
			if err != nil {
				return err
			}
			v := httpx.Validate(body)
			status := v.OneOf("status", []string{"DRAFT", "PUBLISHED", "ARCHIVED"}, httpx.Opt{})
			if err := v.Done(); err != nil {
				return err
			}
			a, err := svc.SetArticleStatus(r.Context(), chi.URLParam(r, "id"), *status, actorOf(r))
			if err != nil {
				return err
			}
			return httpx.OK(w, a)
		}))

		r.Delete("/cms/articles/{id}", guard("cms:manage", func(w http.ResponseWriter, r *http.Request) error {
			if err := svc.DeleteArticle(r.Context(), chi.URLParam(r, "id"), actorOf(r)); err != nil {
				return err
			}
			return httpx.OK(w, map[string]any{"success": true})
		}))

		r.Get("/audit", guard("audit:view", func(w http.ResponseWriter, r *http.Request) error {
			limit := 100
			if n, err := strconv.Atoi(q(r, "limit")); err == nil && n > 0 {
				limit = n
			}
			list, err := svc.AuditTrail(r.Context(), q(r, "clientId"), limit)
			if err != nil {
				return err
			}
			return httpx.OK(w, list)
		}))

		r.Get("/staff", guard("audit:view", func(w http.ResponseWriter, r *http.Request) error {
			list, err := svc.Staff(r.Context())
			if err != nil {
				return err
			}
			return httpx.OK(w, list)
		}))
	})
}

func dateOnly(s *string) *string {
	if s == nil {
		return nil
	}
	d := *s
	if len(d) > 10 {
		d = d[:10]
	}
	return &d
}
