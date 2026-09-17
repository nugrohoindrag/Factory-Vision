package csv

import (
	"net/http"
	"regexp"

	"github.com/go-chi/chi/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/audit"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/auth"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/httpx"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/security"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/tenancy"
)

func mustClock() *regexp.Regexp { return regexp.MustCompile(`^([01]\d|2[0-3]):[0-5]\d$`) }

// MaxCSVBytes bounds an upload: it covers the largest realistic master-data
// file while keeping a mistyped upload from exhausting memory.
const MaxCSVBytes = 5 * 1024 * 1024

// Mount registers the CSV import/export routes. The upload arrives as a
// JSON string rather than multipart: the console reads the file with
// FileReader anyway.
func Mount(r chi.Router, s *Service, auditor audit.Recorder, events *security.Events, largeExportRows int) {
	r.Get("/csv/entities", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		return httpx.OK(w, s.ListEntities())
	}))

	r.Get("/csv/{entity}/template", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		entity := chi.URLParam(r, "entity")
		template, err := s.Template(entity)
		if err != nil {
			return err
		}
		if httpx.QueryStr(r, "format") == "csv" {
			w.Header().Set("Content-Type", "text/csv; charset=utf-8")
			w.Header().Set("Content-Disposition", `attachment; filename="template-`+entity+`.csv"`)
			_, err := w.Write([]byte(template.CSV))
			return err
		}
		return httpx.OK(w, template)
	}))

	r.Get("/csv/{entity}/export", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		entity := chi.URLParam(r, "entity")
		tenantID := tenancy.TenantID(r.Context())
		// US-008: "Export respects user's access scope."
		var allowed []string
		scopeLevel := "TENANT"
		p := auth.PrincipalFrom(r.Context())
		if p != nil && p.Scope.Level != "TENANT" {
			allowed = p.Scope.LineIDs
			scopeLevel = p.Scope.Level
		}
		body, rowCount, err := s.Export(r.Context(), entity, tenantID, allowed)
		if err != nil {
			return err
		}
		if _, err := auditor.Record(r.Context(), audit.FromRequest(r, "csv_export", entity, "EXPORT", nil, map[string]any{
			"entity": entity, "scope": scopeLevel, "rowCount": rowCount, "bytes": len(body),
		})); err != nil {
			return err
		}
		// §43: a bulk export is the shape data leaves in, so it is alertable
		// rather than merely audited.
		if rowCount >= largeExportRows {
			events.Record(security.Event{
				Type: "LARGE_EXPORT", Severity: security.SeverityWarning,
				Message:  "Export " + entity + " berisi " + itoa(rowCount) + " baris.",
				TenantID: tenantID, Actor: auth.ActorID(r.Context()), IP: httpx.ClientIP(r),
				Detail: map[string]any{"entity": entity, "rowCount": rowCount},
			})
		}
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		w.Header().Set("Content-Disposition", `attachment; filename="`+entity+`.csv"`)
		_, err = w.Write([]byte(body))
		return err
	}))

	r.Post("/csv/{entity}/import", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		entity := chi.URLParam(r, "entity")
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		content := v.String("content", httpx.Opt{Min: httpx.Min(1), Max: httpx.Max(MaxCSVBytes)})
		dryRun := v.Boolean("dryRun", httpx.Opt{Optional: true})
		if err := v.DoneWith("Isi file CSV wajib dikirim."); err != nil {
			return err
		}
		tenantID := tenancy.TenantID(r.Context())
		result, err := s.Import(r.Context(), entity, tenantID, *content, dryRun != nil && *dryRun)
		if err != nil {
			return err
		}
		// A dry run changes nothing, so it is not an auditable event.
		if dryRun == nil || !*dryRun {
			if _, err := auditor.Record(r.Context(), audit.FromRequest(r, "csv_import", entity, "IMPORT", nil, map[string]any{
				"entity": result.Entity, "created": result.Created, "updated": result.Updated,
				"failed": result.Failed, "rejectedWholeFile": result.RejectedWholeFile,
			})); err != nil {
				return err
			}
		}
		return httpx.OK(w, result)
	}))
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[i:])
}
