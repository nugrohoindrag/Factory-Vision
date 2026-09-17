package event

import (
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/httpx"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/tenancy"
)

// Mount registers the read-only Event History routes (US-E001). There is
// deliberately no POST: events are written by the modules that cause them,
// and an endpoint that let the console append to the timeline would make
// the timeline evidence of nothing (BR-E02).
func Mount(r chi.Router, s *Service) {
	r.Get("/events", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		q := Query{
			EntityType:  httpx.QueryStr(r, "entityType"),
			EntityID:    httpx.QueryStr(r, "entityId"),
			EventType:   httpx.QueryStr(r, "eventType"),
			WorkOrderID: httpx.QueryStr(r, "workOrderId"),
			MachineID:   httpx.QueryStr(r, "machineId"),
			BatchID:     httpx.QueryStr(r, "batchId"),
			From:        httpx.QueryStr(r, "from"),
			To:          httpx.QueryStr(r, "to"),
			Cursor:      httpx.QueryStr(r, "cursor"),
		}
		if v := httpx.QueryStr(r, "limit"); v != "" {
			n := httpx.QueryInt(r, "limit", 0)
			q.Limit = &n
		}
		if v := httpx.QueryStr(r, "offset"); v != "" {
			n := httpx.QueryInt(r, "offset", 0)
			q.Offset = &n
		}
		events, err := s.List(r.Context(), tenancy.TenantID(r.Context()), q)
		if err != nil {
			return err
		}
		return httpx.OK(w, events)
	}))

	// Chronological timeline of one entity, oldest first (§10.3). Registered
	// before /events/summary would be unnecessary with chi's router, but the
	// order mirrors the Node file for anyone comparing the two.
	r.Get("/events/timeline/{entityType}/{entityId}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		entityType := strings.ToUpper(chi.URLParam(r, "entityType"))
		events, err := s.Timeline(r.Context(), tenancy.TenantID(r.Context()), entityType, chi.URLParam(r, "entityId"), 500)
		if err != nil {
			return err
		}
		return httpx.OK(w, events)
	}))

	r.Get("/events/summary", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		days := httpx.QueryInt(r, "days", 7)
		summary, err := s.Summary(r.Context(), tenancy.TenantID(r.Context()), days)
		if err != nil {
			return err
		}
		return httpx.OK(w, summary)
	}))
}
