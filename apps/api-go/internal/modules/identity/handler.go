package identity

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/masterdata"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/auth"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/config"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/httpx"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/tenancy"
)

func clientContext(r *http.Request) ClientContext { return ClientContextFrom(r) }

// ClientContextFrom is the caller's address and agent, for the audit trail.
func ClientContextFrom(r *http.Request) ClientContext {
	ip := httpx.ClientIP(r)
	return ClientContext{IP: &ip, UserAgent: httpx.UserAgent(r)}
}

// requireApplicationSession: MFA belongs to a named person, so an operator
// terminal session cannot use it.
func requireApplicationSession(r *http.Request) (*auth.Principal, error) {
	p := auth.PrincipalFrom(r.Context())
	if p == nil {
		return nil, httpx.Unauthenticated("Sesi tidak aktif.")
	}
	if p.Kind != auth.KindApplication {
		return nil, httpx.Forbidden("MFA hanya berlaku untuk akun pengguna aplikasi.")
	}
	return p, nil
}

type success struct {
	Success bool   `json:"success"`
	Message string `json:"message,omitempty"`
}

// Mount registers the authentication endpoints (US-001, US-002) and session
// administration (US-005). Login is deliberately the only unauthenticated
// write in the API.
func Mount(r chi.Router, s *Service, master *masterdata.Service) {
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
		// The console names no tenant: a trial admin and the pilot's
		// supervisor sign in at the same address. So the tenant comes from
		// the email when the client did not say. The header still wins when
		// present, and an unknown email falls through to the default tenant
		// so the failure reads the same as a wrong password.
		var candidates []string
		if header := r.Header.Get("X-Tenant-Id"); header != "" {
			candidates = []string{header}
		} else if candidates, err = s.TenantsForEmail(r.Context(), *email); err != nil {
			return err
		}
		if len(candidates) == 0 {
			tenant := tenancy.TenantID(r.Context())
			if tenant == "" {
				tenant = config.PilotTenant
			}
			candidates = []string{tenant}
		}
		var outcome any
		var lastErr error
		for _, tenantID := range candidates {
			outcome, lastErr = s.Login(r.Context(), tenantID, *email, *password, clientContext(r))
			if lastErr == nil {
				break
			}
		}
		if lastErr != nil {
			return lastErr
		}
		return httpx.OK(w, outcome)
	}))

	r.Post("/auth/operator-login", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		employeeNumber := v.String("employeeNumber", httpx.Opt{Min: httpx.Min(1)})
		pin := v.String("pin", httpx.Opt{Min: httpx.Min(1), Max: httpx.Max(32)})
		if err := v.DoneWith("Nomor karyawan dan PIN wajib diisi."); err != nil {
			return err
		}
		tenantID := tenancy.TenantID(r.Context())
		if tenantID == "" {
			tenantID = config.PilotTenant
		}
		resp, err := s.OperatorLogin(r.Context(), tenantID, *employeeNumber, *pin, clientContext(r))
		if err != nil {
			return err
		}
		return httpx.OK(w, resp)
	}))

	// §5, second factor. The challenge token is what the login answered
	// with; it is single use and expires in minutes.
	r.Post("/auth/mfa/verify", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		token := v.String("challengeToken", httpx.Opt{Min: httpx.Min(1)})
		code := v.String("code", httpx.Opt{Min: httpx.Min(6), Max: httpx.Max(16)})
		if err := v.DoneWith("Token verifikasi dan kode MFA wajib diisi."); err != nil {
			return err
		}
		resp, err := s.VerifyMfaLogin(r.Context(), *token, *code, clientContext(r))
		if err != nil {
			return err
		}
		return httpx.OK(w, resp)
	}))

	r.Get("/auth/mfa", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		p, err := requireApplicationSession(r)
		if err != nil {
			return err
		}
		status, err := s.MFA.Status(r.Context(), p.TenantID, p.SubjectID, p.Role)
		if err != nil {
			return err
		}
		return httpx.OK(w, struct {
			MfaStatus
			Available bool `json:"available"`
		}{status, s.MFA.Available()})
	}))

	r.Post("/auth/mfa/enroll", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		p, err := requireApplicationSession(r)
		if err != nil {
			return err
		}
		account := p.Name
		if user, err := master.UserByID(r.Context(), p.TenantID, p.SubjectID); err != nil {
			return err
		} else if user != nil {
			account = user.Email
		}
		enrolment, err := s.MFA.BeginEnrolment(r.Context(), p.TenantID, p.SubjectID, account)
		if err != nil {
			return err
		}
		return httpx.OK(w, enrolment)
	}))

	r.Post("/auth/mfa/confirm", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		p, err := requireApplicationSession(r)
		if err != nil {
			return err
		}
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		code := v.String("code", httpx.Opt{Min: httpx.Min(6), Max: httpx.Max(8)})
		if err := v.DoneWith("Kode MFA wajib diisi."); err != nil {
			return err
		}
		codes, err := s.MFA.ConfirmEnrolment(r.Context(), p.TenantID, p.SubjectID, *code)
		if err != nil {
			return err
		}
		return httpx.OK(w, map[string]any{"success": true, "recoveryCodes": codes})
	}))

	// Turns MFA off for the signed-in account, and only after a current
	// code: an unlocked console left on a desk should not be able to remove
	// the factor that protects it.
	r.Post("/auth/mfa/disable", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		p, err := requireApplicationSession(r)
		if err != nil {
			return err
		}
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		code := v.String("code", httpx.Opt{Min: httpx.Min(6), Max: httpx.Max(16)})
		if err := v.DoneWith("Kode MFA wajib diisi untuk menonaktifkan MFA."); err != nil {
			return err
		}
		challenge := s.MFA.IssueChallenge(p.TenantID, p.SubjectID)
		if _, err := s.MFA.VerifyChallenge(r.Context(), challenge.ChallengeToken, *code); err != nil {
			return err
		}
		if err := s.MFA.Disable(r.Context(), p.TenantID, p.SubjectID); err != nil {
			return err
		}
		return httpx.OK(w, success{Success: true})
	}))

	// Session probe: the console calls this on boot to decide whether to
	// restore a session, and the operator terminal polls it to detect the
	// inactivity logout US-002 requires.
	r.Get("/auth/session", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		p := auth.PrincipalFrom(r.Context())
		if p == nil {
			return httpx.Unauthenticated("Sesi tidak aktif.")
		}
		out := map[string]any{"principal": p}
		if p.Kind == auth.KindApplication {
			user, err := master.UserByID(r.Context(), p.TenantID, p.SubjectID)
			if err != nil {
				return err
			}
			if user != nil {
				out["user"] = user
			}
		} else {
			operator, err := master.OperatorByID(r.Context(), p.TenantID, p.SubjectID)
			if err != nil {
				return err
			}
			if operator != nil {
				out["operator"] = operator
			}
		}
		return httpx.OK(w, out)
	}))

	r.Post("/auth/logout", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		if p := auth.PrincipalFrom(r.Context()); p != nil {
			if err := s.Logout(r.Context(), p); err != nil {
				return err
			}
		}
		return httpx.OK(w, success{Success: true})
	}))

	// US-005, live sessions and revocation.
	r.Get("/sessions", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		sessions, err := s.ListSessions(r.Context(), tenancy.TenantID(r.Context()), httpx.QueryPtr(r, "subjectId"))
		if err != nil {
			return err
		}
		return httpx.OK(w, sessions)
	}))
	r.Delete("/sessions/{sessionId}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		id := chi.URLParam(r, "sessionId")
		revoked, err := s.RevokeSessions(r.Context(), tenancy.TenantID(r.Context()), &id, nil, auth.ActorID(r.Context()))
		if err != nil {
			return err
		}
		return httpx.OK(w, map[string]any{"success": revoked > 0, "revoked": revoked})
	}))
	r.Delete("/sessions", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		subjectID := httpx.QueryPtr(r, "subjectId")
		if subjectID == nil {
			return httpx.Validation("subjectId wajib diisi untuk mencabut sesi pengguna.")
		}
		revoked, err := s.RevokeSessions(r.Context(), tenancy.TenantID(r.Context()), nil, subjectID, auth.ActorID(r.Context()))
		if err != nil {
			return err
		}
		return httpx.OK(w, map[string]any{"success": true, "revoked": revoked})
	}))

	// Credential administration.
	r.Post("/users/{id}/password", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		password := v.String("password", httpx.Opt{Min: httpx.Min(8)})
		if err := v.Done(); err != nil {
			return err
		}
		if err := s.SetUserPassword(r.Context(), tenancy.TenantID(r.Context()), chi.URLParam(r, "id"), *password, auth.ActorID(r.Context())); err != nil {
			return err
		}
		return httpx.OK(w, success{Success: true, Message: "Kata sandi diperbarui dan sesi aktif dicabut."})
	}))
	r.Post("/operators/{id}/pin", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		pin := v.String("pin", httpx.Opt{Min: httpx.Min(4), Max: httpx.Max(8)})
		if err := v.Done(); err != nil {
			return err
		}
		if err := s.SetOperatorPin(r.Context(), tenancy.TenantID(r.Context()), chi.URLParam(r, "id"), *pin, auth.ActorID(r.Context())); err != nil {
			return err
		}
		return httpx.OK(w, success{Success: true, Message: "PIN operator diperbarui dan sesi aktif dicabut."})
	}))
}

var _ = errors.New
