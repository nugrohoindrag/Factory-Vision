package httpx

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/db"
)

// HandlerFunc is what every route is written as: it returns an error rather
// than writing one, so the envelope is built in exactly one place.
type HandlerFunc func(w http.ResponseWriter, r *http.Request) error

// SecurityEventSink is how the error path reports a refusal worth a person's
// attention. An interface so httpx does not depend on the security package.
type SecurityEventSink interface {
	CrossTenantAttempt(r *http.Request)
}

var (
	sink   SecurityEventSink
	logger = slog.Default()
)

// Configure wires the pieces Handle needs but must not import.
func Configure(log *slog.Logger, s SecurityEventSink) {
	if log != nil {
		logger = log
	}
	sink = s
}

// Handle adapts a HandlerFunc to net/http, translating its error.
func Handle(h HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := h(w, r); err != nil {
			WriteError(w, r, err)
		}
	}
}

type errorEnvelope struct {
	Error errorBody `json:"error"`
}

type errorBody struct {
	Code      string       `json:"code"`
	Message   string       `json:"message"`
	Fields    []FieldError `json:"fields,omitempty"`
	RequestID string       `json:"requestId"`
}

// WriteError is the terminal error handler, the only place an error body is
// constructed.
func WriteError(w http.ResponseWriter, r *http.Request, err error) {
	requestID := RequestID(r.Context())
	if requestID == "" {
		requestID = "unknown"
	}

	var apiErr *Error
	if errors.As(err, &apiErr) {
		// A request that reached for a plant, a line or a tenant outside its
		// own scope is either a misconfigured integration or somebody trying;
		// both are worth a person's attention rather than a 403 in a log file.
		if apiErr.Code == "OUT_OF_SCOPE" && sink != nil {
			sink.CrossTenantAttempt(r)
		}
		if apiErr.RetryAfter > 0 {
			w.Header().Set("Retry-After", strconv.Itoa(apiErr.RetryAfter))
		}
		writeJSON(w, apiErr.Status, errorEnvelope{Error: errorBody{
			Code: apiErr.Code, Message: apiErr.Message, Fields: apiErr.Fields, RequestID: requestID,
		}})
		return
	}

	// A PostgreSQL constraint violation is a client problem expressed in the
	// database's vocabulary. Answering 500 with the raw text is wrong twice
	// over: it tells the caller nothing they can act on, and it publishes
	// constraint names, column names and sometimes values to whoever asked.
	if c := db.Describe(err); c != nil {
		writeJSON(w, c.Status, errorEnvelope{Error: errorBody{Code: c.Code, Message: c.Message, RequestID: requestID}})
		return
	}

	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		e := PayloadTooLarge()
		writeJSON(w, e.Status, errorEnvelope{Error: errorBody{Code: e.Code, Message: e.Message, RequestID: requestID}})
		return
	}

	if errors.Is(err, context.Canceled) {
		// The client went away; there is nobody left to answer.
		return
	}

	// The detail stays in the log, where an engineer can read it. The caller
	// gets the request id, which is how the two are joined up.
	logger.Error("unhandled error", "requestId", requestID, "method", r.Method, "path", r.URL.Path, "error", err)
	writeJSON(w, 500, errorEnvelope{Error: errorBody{
		Code:      "INTERNAL_ERROR",
		Message:   "Terjadi kesalahan internal. Sertakan request id saat melaporkan.",
		RequestID: requestID,
	}})
}

// NotFoundHandler answers an unknown route with the same envelope as
// everything else. The Node API only did this under /api/v1 and answered
// HTML elsewhere; one envelope everywhere is simpler and no client relied on
// the HTML.
func NotFoundHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		WriteError(w, r, NotFound("Endpoint "+r.Method+" "+r.URL.Path+" tidak dikenal."))
	}
}

// MethodNotAllowedHandler keeps 405 inside the contract too.
func MethodNotAllowedHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		WriteError(w, r, New("NOT_FOUND", "Endpoint "+r.Method+" "+r.URL.Path+" tidak dikenal.", 405))
	}
}
