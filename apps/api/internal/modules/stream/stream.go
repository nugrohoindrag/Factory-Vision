// Package stream is GET /api/v1/events/stream: the Server-Sent Events feed
// that replaces the socket.io gateway. Every event a module wrote to the
// outbox reaches the relay, and the relay hands it to the hub, which fans it
// out to the callers of this route for the event's tenant.
package stream

import (
	"context"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/outbox"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/realtime"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/tenancy"
)

// Mount registers the stream route. The auth pipeline has already decided
// who may listen: the tenant is the caller's, never a query parameter.
func Mount(r chi.Router, hub *realtime.Hub) {
	r.Get("/events/stream", func(w http.ResponseWriter, r *http.Request) {
		hub.Serve(w, r, tenancy.TenantID(r.Context()))
	})
}

var planningAggregates = map[string]bool{"customer_order": true, "demand_forecast": true, "capacity_plan": true, "production_plan": true}

// Subscriber turns relayed outbox rows into hub messages. Planning events
// are namespaced `planning:<EventType>` and carry the row's envelope plus
// the payload, exactly as the socket.io gateway emitted them; execution
// events (work-order:updated, production:output-recorded, …) keep their
// name and carry the entity the handler published.
func Subscriber(hub *realtime.Hub) outbox.Subscriber {
	return func(_ context.Context, e outbox.Row) error {
		name, data := e.EventType, any(e.Payload)
		if planningAggregates[e.AggregateType] {
			name = "planning:" + e.EventType
			envelope := map[string]any{"eventId": e.ID, "aggregateType": e.AggregateType, "aggregateId": e.AggregateID, "occurredAt": e.OccurredAt}
			for k, v := range e.Payload {
				envelope[k] = v
			}
			data = envelope
		}
		hub.Publish(e.TenantID, name, data)
		return nil
	}
}
