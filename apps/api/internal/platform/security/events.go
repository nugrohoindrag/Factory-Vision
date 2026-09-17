package security

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"sort"
	"sync"
	"time"

	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/auth"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/db"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/httpx"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/tenancy"
)

// Security events and alerting (§42, §43).
//
// The audit trail records what happened; it answers questions after somebody
// thinks to ask. This is the other half: the small set of events that should
// reach a person on the day they occur — an administrator role handed out, a
// lockout, a large export. Two sinks: a structured log line, and an optional
// webhook. Delivery is best effort and never blocks the request.

// Severity is INFO, WARNING or CRITICAL.
type Severity string

const (
	SeverityInfo     Severity = "INFO"
	SeverityWarning  Severity = "WARNING"
	SeverityCritical Severity = "CRITICAL"
)

// Event is one security event.
type Event struct {
	Type     string         `json:"type"`
	Severity Severity       `json:"severity"`
	Message  string         `json:"message"`
	TenantID string         `json:"tenantId,omitempty"`
	Actor    string         `json:"actor,omitempty"`
	IP       string         `json:"ip,omitempty"`
	Detail   map[string]any `json:"detail,omitempty"`
}

// EventContext is the optional part of a refusal.
type EventContext struct {
	TenantID string
	Actor    string
	IP       string
	Detail   map[string]any
}

// Alertable are the events worth waking somebody for, per §43.
var Alertable = map[string]bool{
	"LOGIN_LOCKED":                true,
	"OPERATOR_LOGIN_LOCKED":       true,
	"INTERNAL_LOGIN_LOCKED":       true,
	"ADMIN_ROLE_ASSIGNED":         true,
	"PERMISSION_CHANGED":          true,
	"LARGE_EXPORT":                true,
	"CROSS_TENANT_ATTEMPT":        true,
	"REALTIME_HANDSHAKE_REJECTED": true,
	"AUDIT_WRITE_FAILED":          true,
	"BACKUP_STALE":                true,
	"MFA_DISABLED":                true,
	"MFA_RECOVERY_CODE_USED":      true,
}

// Events records, counts and forwards security events.
type Events struct {
	mu       sync.Mutex
	counters map[string]int
	webhook  string
	client   *http.Client
	log      *slog.Logger
	observer func(eventType string)
}

// NewEvents builds the stream; webhook may be empty (log-only).
func NewEvents(webhook string, log *slog.Logger) *Events {
	if log == nil {
		log = slog.Default()
	}
	return &Events{
		counters: map[string]int{},
		webhook:  webhook,
		client:   &http.Client{Timeout: 5 * time.Second},
		log:      log,
	}
}

// Observe registers a metrics hook.
func (e *Events) Observe(fn func(eventType string)) { e.observer = fn }

// Record counts, logs, and forwards an alertable event to the webhook.
func (e *Events) Record(ev Event) {
	e.mu.Lock()
	e.counters[ev.Type]++
	e.mu.Unlock()
	if e.observer != nil {
		e.observer(ev.Type)
	}

	attrs := []any{"kind", "security", "type", ev.Type, "severity", string(ev.Severity), "message", ev.Message}
	if ev.TenantID != "" {
		attrs = append(attrs, "tenantId", ev.TenantID)
	}
	if ev.Actor != "" {
		attrs = append(attrs, "actor", ev.Actor)
	}
	if ev.IP != "" {
		attrs = append(attrs, "ip", ev.IP)
	}
	if ev.Detail != nil {
		attrs = append(attrs, "detail", ev.Detail)
	}
	switch ev.Severity {
	case SeverityCritical:
		e.log.Error("security event", attrs...)
	case SeverityWarning:
		e.log.Warn("security event", attrs...)
	default:
		e.log.Info("security event", attrs...)
	}

	if e.webhook == "" || !Alertable[ev.Type] {
		return
	}
	go e.deliver(ev)
}

func (e *Events) deliver(ev Event) {
	type payload struct {
		Text  string `json:"text"`
		Event any    `json:"event"`
	}
	body, err := json.Marshal(payload{
		// `text` is what Slack and Teams read; the structured fields are
		// for anything that parses rather than displays.
		Text: "[Factory Vision] " + string(ev.Severity) + ": " + ev.Message,
		Event: struct {
			Event
			At string `json:"at"`
		}{ev, db.Now()},
	})
	if err != nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, e.webhook, bytes.NewReader(body))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := e.client.Do(req)
	if err != nil {
		e.log.Warn("security: alert webhook failed", "error", err)
		return
	}
	resp.Body.Close()
}

// Refusal is the most common shape: something was refused.
func (e *Events) Refusal(eventType, message string, ctx EventContext) {
	e.Record(Event{
		Type: eventType, Severity: SeverityWarning, Message: message,
		TenantID: ctx.TenantID, Actor: ctx.Actor, IP: ctx.IP, Detail: ctx.Detail,
	})
}

// Counters is a snapshot for the security summary, keys sorted.
func (e *Events) Counters() map[string]int {
	e.mu.Lock()
	defer e.mu.Unlock()
	out := make(map[string]int, len(e.counters))
	for k, v := range e.counters {
		out[k] = v
	}
	return out
}

// CounterKeys lists the recorded event types in order, for tests.
func (e *Events) CounterKeys() []string {
	c := e.Counters()
	keys := make([]string, 0, len(c))
	for k := range c {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// CrossTenantAttempt is the httpx.SecurityEventSink hook: a request that
// reached outside its scope.
func (e *Events) CrossTenantAttempt(r *http.Request) {
	actor := ""
	if p := auth.PrincipalFrom(r.Context()); p != nil {
		actor = p.SubjectID
	}
	e.Record(Event{
		Type:     "CROSS_TENANT_ATTEMPT",
		Severity: SeverityWarning,
		Message:  "Akses di luar cakupan ditolak: " + r.Method + " " + r.URL.Path,
		TenantID: tenancy.TenantID(r.Context()),
		Actor:    actor,
		IP:       httpx.ClientIP(r),
		Detail:   map[string]any{"path": r.URL.Path, "method": r.Method},
	})
}
