package httpx

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func envelope(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var body struct {
		Error map[string]any `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("not an envelope: %s", rec.Body.String())
	}
	return body.Error
}

func TestHandleWritesTheDocumentedEnvelope(t *testing.T) {
	cases := []struct {
		err    error
		status int
		code   string
	}{
		{Validation("x", FieldError{Field: "f", Code: "REQUIRED", Message: "f wajib diisi."}), 422, "VALIDATION_ERROR"},
		{Unauthenticated(""), 401, "UNAUTHENTICATED"},
		{Forbidden(""), 403, "FORBIDDEN"},
		{OutOfScope(""), 403, "OUT_OF_SCOPE"},
		{NotFound(""), 404, "NOT_FOUND"},
		{Conflict("dup"), 409, "CONFLICT"},
		{InvalidState("state"), 409, "INVALID_STATE"},
		{RateLimited("slow", 7), 429, "RATE_LIMITED"},
		{errors.New("boom"), 500, "INTERNAL_ERROR"},
		{&pgconn.PgError{Code: "23505", ConstraintName: "uq_x"}, 409, "CONFLICT"},
		{&pgconn.PgError{Code: "23503"}, 422, "VALIDATION_ERROR"},
		{&pgconn.PgError{Code: "23502", ColumnName: "name"}, 422, "VALIDATION_ERROR"},
		{&pgconn.PgError{Code: "23514", ConstraintName: "ck_y"}, 422, "VALIDATION_ERROR"},
	}
	for _, c := range cases {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/x", nil)
		req.Header.Set("X-Request-Id", "req-123")
		WithRequestID(Handle(func(w http.ResponseWriter, r *http.Request) error { return c.err })).ServeHTTP(rec, req)
		if rec.Code != c.status {
			t.Errorf("%v: status %d want %d", c.err, rec.Code, c.status)
		}
		e := envelope(t, rec)
		if e["code"] != c.code {
			t.Errorf("%v: code %v want %s", c.err, e["code"], c.code)
		}
		if e["requestId"] != "req-123" {
			t.Errorf("%v: requestId %v", c.err, e["requestId"])
		}
		if rec.Header().Get("X-Request-Id") != "req-123" {
			t.Errorf("request id must be echoed")
		}
		if c.code == "RATE_LIMITED" && rec.Header().Get("Retry-After") != "7" {
			t.Errorf("429 must carry Retry-After")
		}
		if c.code == "INTERNAL_ERROR" && strings.Contains(rec.Body.String(), "boom") {
			t.Errorf("internal detail must stay in the log, not the body")
		}
		if c.code == "VALIDATION_ERROR" && c.status == 422 && c.err == cases[0].err {
			if _, ok := e["fields"]; !ok {
				t.Errorf("validation must carry fields")
			}
		}
	}
}

func TestRequestIDIsGeneratedWhenMissingOrInvalid(t *testing.T) {
	for _, incoming := range []string{"", "bad id with spaces", strings.Repeat("a", 200)} {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/health", nil)
		if incoming != "" {
			req.Header.Set("X-Request-Id", incoming)
		}
		WithRequestID(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if RequestID(r.Context()) == "" {
				t.Error("id missing from context")
			}
		})).ServeHTTP(rec, req)
		got := rec.Header().Get("X-Request-Id")
		if got == "" || got == incoming || len(got) != 36 {
			t.Errorf("incoming %q: got %q", incoming, got)
		}
	}
}

func TestDecodeToleratesEmptyAndRefusesMalformed(t *testing.T) {
	var dst map[string]any
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(""))
	req.Header.Set("Content-Type", "application/json")
	if err := Decode(req, &dst); err != nil || dst != nil {
		t.Fatalf("empty body: %v %v", err, dst)
	}
	req = httptest.NewRequest(http.MethodPost, "/", strings.NewReader("{not json"))
	req.Header.Set("Content-Type", "application/json")
	var e *Error
	if err := Decode(req, &dst); !errors.As(err, &e) || e.Status != 422 {
		t.Fatalf("malformed body must be a 422 envelope, got %v", err)
	}
	req = httptest.NewRequest(http.MethodPost, "/", strings.NewReader(strings.Repeat("x", MaxBodyBytes+1)))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	Handle(func(w http.ResponseWriter, r *http.Request) error {
		_, err := Body(r)
		return err
	}).ServeHTTP(rec, req)
	if rec.Code != 413 {
		t.Fatalf("oversized body must be 413, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestValidatorMessagesMatchNode(t *testing.T) {
	v := Validate(map[string]any{"email": "not-an-email", "n": "abc", "clock": "25:00", "role": "X", "list": []any{1}})
	v.Email("email", Opt{})
	v.Number("n", Opt{})
	v.String("missing", Opt{})
	v.ClockTime("clock", Opt{})
	v.OneOf("role", []string{"A", "B"}, Opt{})
	v.StringArray("list", Opt{})
	v.String("s", Opt{Optional: true, Min: Min(2)})
	err := v.Done()
	var e *Error
	if !errors.As(err, &e) {
		t.Fatal("expected a validation error")
	}
	want := map[string]string{
		"email":   "email harus berupa alamat email yang valid.",
		"n":       "n harus berupa angka.",
		"missing": "missing wajib diisi.",
		"clock":   "clock harus dalam format HH:mm.",
		"role":    "role harus salah satu dari: A, B.",
		"list":    "list harus berupa daftar teks.",
	}
	got := map[string]string{}
	for _, f := range e.Fields {
		got[f.Field] = f.Message
	}
	for field, msg := range want {
		if got[field] != msg {
			t.Errorf("%s: got %q want %q", field, got[field], msg)
		}
	}
	if e.Message != "Data yang dikirim tidak valid." {
		t.Errorf("top-level message %q", e.Message)
	}

	ok := Validate(map[string]any{"name": "  Ann  ", "n": "12", "b": "true", "d": "2026-09-17", "e": "A@B.CO"})
	if s := ok.Str("name"); s != "Ann" {
		t.Errorf("trim: %q", s)
	}
	if n := ok.Number("n", Opt{Integer: true}); n == nil || *n != 12 {
		t.Errorf("numeric string must parse")
	}
	if b := ok.Boolean("b", Opt{}); b == nil || !*b {
		t.Errorf("boolean string must parse")
	}
	if d := ok.ISODate("d", Opt{}); d == nil {
		t.Errorf("date must parse")
	}
	if em := ok.Email("e", Opt{}); em == nil || *em != "a@b.co" {
		t.Errorf("email must lower-case")
	}
	if err := ok.Done(); err != nil {
		t.Fatalf("unexpected: %v", err)
	}
}

func TestJSONDoesNotEscapeHTML(t *testing.T) {
	rec := httptest.NewRecorder()
	if err := JSON(rec, 200, map[string]string{"name": "Ban <R17> & Co"}); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(rec.Body.String(), "<R17> & Co") {
		t.Fatalf("html escaped: %s", rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json; charset=utf-8" {
		t.Fatalf("content type %q", ct)
	}
}
