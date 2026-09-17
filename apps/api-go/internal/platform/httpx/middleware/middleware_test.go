package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func ok() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) })
}

// The assertions mirror apps/api/test/security-controls.test.ts, so the Go
// pipeline is held to the same policy the Node one was.
func TestSecurityHeaders(t *testing.T) {
	rec := httptest.NewRecorder()
	SecurityHeaders(ok()).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/x", nil))
	h := rec.Header()
	want := map[string]string{
		"Content-Security-Policy":           "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
		"X-Content-Type-Options":            "nosniff",
		"X-Frame-Options":                   "DENY",
		"Referrer-Policy":                   "no-referrer",
		"Cross-Origin-Resource-Policy":      "same-origin",
		"X-Permitted-Cross-Domain-Policies": "none",
		"Strict-Transport-Security":         "max-age=31536000; includeSubDomains",
		"Cache-Control":                     "no-store",
	}
	for k, v := range want {
		if h.Get(k) != v {
			t.Errorf("%s = %q want %q", k, h.Get(k), v)
		}
	}
	if h.Get("X-Powered-By") != "" {
		t.Error("must not advertise the runtime")
	}
	rec = httptest.NewRecorder()
	SecurityHeaders(ok()).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/health", nil))
	if rec.Header().Get("Cache-Control") != "" {
		t.Error("no-store applies to /api only")
	}
}

func TestCORSRefusesUnlistedOrigin(t *testing.T) {
	cors := CORS(CORSOptions{AllowedOrigins: []string{"http://localhost:3100"}})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	req.Header.Set("Origin", "https://evil.example.net")
	cors(ok()).ServeHTTP(rec, req)
	if rec.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("a refused origin must get no CORS headers")
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/health", nil)
	req.Header.Set("Origin", "http://localhost:3100")
	cors(ok()).ServeHTTP(rec, req)
	if rec.Header().Get("Access-Control-Allow-Origin") != "http://localhost:3100" {
		t.Fatal("an allowed origin must be reflected")
	}
	if rec.Header().Get("Access-Control-Expose-Headers") != "X-Request-Id" {
		t.Fatal("request id must be exposed")
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodOptions, "/api/v1/x", nil)
	req.Header.Set("Origin", "http://localhost:3100")
	req.Header.Set("Access-Control-Request-Method", "POST")
	cors(ok()).ServeHTTP(rec, req)
	if rec.Code != 204 || rec.Header().Get("Access-Control-Allow-Headers") == "" || rec.Header().Get("Access-Control-Max-Age") != "600" {
		t.Fatalf("preflight: %d %v", rec.Code, rec.Header())
	}

	// No Origin header: a same-origin or server-to-server call, always fine.
	rec = httptest.NewRecorder()
	cors(ok()).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/health", nil))
	if rec.Code != 200 {
		t.Fatal("origin-less request must pass")
	}
}

func TestRecoverTurnsPanicIntoEnvelope(t *testing.T) {
	rec := httptest.NewRecorder()
	Recover(discardLogger())(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { panic("boom") })).
		ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/x", nil))
	if rec.Code != 500 || !contains(rec.Body.String(), `"INTERNAL_ERROR"`) {
		t.Fatalf("got %d %s", rec.Code, rec.Body.String())
	}
}

func TestGzipOnlyAboveThreshold(t *testing.T) {
	big := make([]byte, 4096)
	for i := range big {
		big[i] = 'a'
	}
	handler := Gzip(nil)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/big" {
			w.Write(big)
		} else {
			w.Write([]byte(`{"ok":true}`))
		}
	}))
	for path, wantGzip := range map[string]bool{"/big": true, "/small": false} {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.Header.Set("Accept-Encoding", "gzip")
		handler.ServeHTTP(rec, req)
		if (rec.Header().Get("Content-Encoding") == "gzip") != wantGzip {
			t.Errorf("%s: gzip=%v want %v", path, !wantGzip, wantGzip)
		}
	}
}

func contains(s, sub string) bool {
	return len(s) >= len(sub) && (s == sub || len(sub) == 0 || indexOf(s, sub) >= 0)
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}
