package httpx

import (
	"context"
	"encoding/json"
	"io"
	"mime"
	"net/http"
	"strings"
)

// MaxBodyBytes matches the Node API's express.json({ limit: '8mb' }).
const MaxBodyBytes = 8 << 20

// JSON streams v to the response. The encoder writes straight to the
// ResponseWriter rather than marshalling to a byte slice first, and HTML
// escaping is off because the console reads these bodies as JSON, never as
// markup: escaping would turn a "<" in a product name into a unicode escape.
func JSON(w http.ResponseWriter, status int, v any) error {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	return enc.Encode(v)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	_ = JSON(w, status, v)
}

// OK is the common case: 200 with a body.
func OK(w http.ResponseWriter, v any) error { return JSON(w, http.StatusOK, v) }

// Created answers 201 with the new record.
func Created(w http.ResponseWriter, v any) error { return JSON(w, http.StatusCreated, v) }

// NoContent answers 204.
func NoContent(w http.ResponseWriter) error {
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// Decode reads a JSON body into dst, with the same tolerance express.json
// showed: no body, or a body under another content type, decodes as nothing
// so a validator can report the missing fields rather than a parse error.
func Decode(r *http.Request, dst any) error {
	r.Body = http.MaxBytesReader(nil, r.Body, MaxBodyBytes)
	ct, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if ct != "" && ct != "application/json" && !strings.HasSuffix(ct, "+json") {
		return nil
	}
	body, err := io.ReadAll(r.Body)
	if err != nil {
		return err
	}
	if len(strings.TrimSpace(string(body))) == 0 {
		return nil
	}
	if err := json.Unmarshal(body, dst); err != nil {
		return Validation("Body permintaan bukan JSON yang valid.")
	}
	return nil
}

// Body reads the request as a generic object for the Validator. The parsed
// object is also kept on the request context so a rate limiter keyed on a
// body field and the handler read the stream once between them.
func Body(r *http.Request) (map[string]any, error) {
	if cached, ok := r.Context().Value(bodyKey{}).(map[string]any); ok {
		return cached, nil
	}
	var raw any
	if err := Decode(r, &raw); err != nil {
		return nil, err
	}
	if raw == nil {
		return map[string]any{}, nil
	}
	obj, ok := raw.(map[string]any)
	if !ok {
		return nil, Validation("Body permintaan harus berupa objek JSON.")
	}
	return obj, nil
}

type bodyKey struct{}

// WithBody stores an already-parsed body on the request, for middleware that
// had to read it before the handler.
func WithBody(r *http.Request, body map[string]any) *http.Request {
	return r.WithContext(context.WithValue(r.Context(), bodyKey{}, body))
}

// QueryInt reads an integer query parameter with a default, the way
// Number(req.query.x ?? d) did: garbage falls back to the default.
func QueryInt(r *http.Request, name string, fallback int) int {
	raw := r.URL.Query().Get(name)
	if raw == "" {
		return fallback
	}
	n := 0
	neg := false
	for i, c := range raw {
		if i == 0 && c == '-' {
			neg = true
			continue
		}
		if c < '0' || c > '9' {
			return fallback
		}
		n = n*10 + int(c-'0')
	}
	if neg {
		n = -n
	}
	return n
}

// QueryStr reads a query parameter, empty when absent.
func QueryStr(r *http.Request, name string) string { return r.URL.Query().Get(name) }

// QueryPtr reads a query parameter as an optional value.
func QueryPtr(r *http.Request, name string) *string {
	v := r.URL.Query().Get(name)
	if v == "" {
		return nil
	}
	return &v
}
