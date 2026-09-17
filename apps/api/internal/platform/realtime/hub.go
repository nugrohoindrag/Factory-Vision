// Package realtime is the Server-Sent Events hub that replaces socket.io.
//
// No front-end ever consumed the socket.io gateway (the live board polls),
// so the replacement is the simplest push channel HTTP has: one long GET
// per client, one goroutine per client draining its own buffered channel,
// and a broadcaster that fans out per tenant. A slow client loses events
// rather than stalling the relay — it will re-read on reconnect, which is
// how a polling console behaves anyway.
package realtime

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"sync/atomic"
	"time"
)

// Message is one event as the console receives it.
type Message struct {
	Event string
	Data  any
}

type client struct {
	tenantID string
	ch       chan Message
}

// Hub fans events out to the clients of a tenant.
type Hub struct {
	mu        sync.RWMutex
	clients   map[*client]struct{}
	dropped   atomic.Int64
	buffer    int
	heartbeat time.Duration
}

// New builds a hub; buffer is the per-client queue depth.
func New() *Hub {
	return &Hub{clients: map[*client]struct{}{}, buffer: 64, heartbeat: 25 * time.Second}
}

// Publish delivers to every client of a tenant; a full client queue drops
// the message for that client only.
func (h *Hub) Publish(tenantID, event string, data any) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for c := range h.clients {
		if c.tenantID != tenantID {
			continue
		}
		select {
		case c.ch <- Message{Event: event, Data: data}:
		default:
			h.dropped.Add(1)
		}
	}
}

// Broadcast delivers to every client regardless of tenant, for
// deployment-wide notices only.
func (h *Hub) Broadcast(event string, data any) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for c := range h.clients {
		select {
		case c.ch <- Message{Event: event, Data: data}:
		default:
			h.dropped.Add(1)
		}
	}
}

// Clients is the number of open streams.
func (h *Hub) Clients() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}

// Dropped is how many messages were lost to full client queues.
func (h *Hub) Dropped() int64 { return h.dropped.Load() }

func (h *Hub) subscribe(tenantID string) *client {
	c := &client{tenantID: tenantID, ch: make(chan Message, h.buffer)}
	h.mu.Lock()
	h.clients[c] = struct{}{}
	h.mu.Unlock()
	return c
}

func (h *Hub) unsubscribe(c *client) {
	h.mu.Lock()
	delete(h.clients, c)
	h.mu.Unlock()
}

// Serve streams a tenant's events to one HTTP response until the client
// goes away. The caller has already authenticated the request and decided
// which tenant it may hear.
func (h *Hub) Serve(w http.ResponseWriter, r *http.Request, tenantID string) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	fmt.Fprintf(w, "event: connected\ndata: {\"tenantId\":%q}\n\n", tenantID)
	flusher.Flush()

	c := h.subscribe(tenantID)
	defer h.unsubscribe(c)
	ticker := time.NewTicker(h.heartbeat)
	defer ticker.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
			// A comment line keeps proxies from timing the stream out.
			if _, err := fmt.Fprint(w, ": keepalive\n\n"); err != nil {
				return
			}
			flusher.Flush()
		case m := <-c.ch:
			data, err := json.Marshal(m.Data)
			if err != nil {
				continue
			}
			if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", m.Event, data); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}
