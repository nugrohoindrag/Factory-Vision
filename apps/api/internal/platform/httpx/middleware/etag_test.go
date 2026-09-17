package middleware

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func etagHandler(body string, status int, contentType string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", contentType)
		w.WriteHeader(status)
		// Two writes, the way a streaming encoder writes.
		_, _ = w.Write([]byte(body[:len(body)/2]))
		_, _ = w.Write([]byte(body[len(body)/2:]))
	})
}

func TestETagTagsJSONAndAnswers304OnMatch(t *testing.T) {
	always := func(*http.Request) bool { return true }
	h := ETag(always)(etagHandler(`{"kpi":{"oee":0.71}}`, 200, "application/json; charset=utf-8"))

	first := httptest.NewRecorder()
	h.ServeHTTP(first, httptest.NewRequest(http.MethodGet, "/api/v1/analytics/executive-kpi", nil))
	tag := first.Header().Get("ETag")
	if first.Code != 200 || !strings.HasPrefix(tag, `W/"`) || first.Body.String() != `{"kpi":{"oee":0.71}}` {
		t.Fatalf("first: %d %q %q", first.Code, tag, first.Body.String())
	}
	if first.Header().Get("Content-Length") != "20" {
		t.Fatalf("content length: %q", first.Header().Get("Content-Length"))
	}

	// The same body → the same tag → 304 without a body.
	req := httptest.NewRequest(http.MethodGet, "/api/v1/analytics/executive-kpi", nil)
	req.Header.Set("If-None-Match", tag)
	second := httptest.NewRecorder()
	h.ServeHTTP(second, req)
	if second.Code != http.StatusNotModified || second.Body.Len() != 0 || second.Header().Get("ETag") != tag {
		t.Fatalf("second: %d %q body %d", second.Code, second.Header().Get("ETag"), second.Body.Len())
	}

	// A strong form of the same tag, or a list, still matches (weak comparison).
	req = httptest.NewRequest(http.MethodGet, "/x", nil)
	req.Header.Set("If-None-Match", `"stale", `+strings.TrimPrefix(tag, "W/"))
	third := httptest.NewRecorder()
	h.ServeHTTP(third, req)
	if third.Code != http.StatusNotModified {
		t.Fatalf("weak comparison: %d", third.Code)
	}

	// A different body → a different tag → 200 again.
	changed := ETag(always)(etagHandler(`{"kpi":{"oee":0.72}}`, 200, "application/json; charset=utf-8"))
	req = httptest.NewRequest(http.MethodGet, "/x", nil)
	req.Header.Set("If-None-Match", tag)
	fourth := httptest.NewRecorder()
	changed.ServeHTTP(fourth, req)
	if fourth.Code != 200 || fourth.Header().Get("ETag") == tag {
		t.Fatalf("changed body: %d %q", fourth.Code, fourth.Header().Get("ETag"))
	}
}

func TestETagLeavesOtherResponsesAlone(t *testing.T) {
	always := func(*http.Request) bool { return true }
	cases := []struct {
		name        string
		method      string
		status      int
		contentType string
	}{
		{"csv export streams through", http.MethodGet, 200, "text/csv; charset=utf-8"},
		{"error envelope is not tagged", http.MethodGet, 401, "application/json; charset=utf-8"},
		{"POST is never tagged", http.MethodPost, 200, "application/json; charset=utf-8"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			h := ETag(always)(etagHandler(`{"a":1}`, c.status, c.contentType))
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(c.method, "/x", nil)
			req.Header.Set("If-None-Match", "*")
			h.ServeHTTP(rec, req)
			if rec.Code != c.status || rec.Header().Get("ETag") != "" || rec.Body.String() != `{"a":1}` {
				t.Fatalf("%d etag=%q body=%q", rec.Code, rec.Header().Get("ETag"), rec.Body.String())
			}
		})
	}

	// A route the matcher excludes is untouched even for JSON.
	never := func(*http.Request) bool { return false }
	h := ETag(never)(etagHandler(`[]`, 200, "application/json"))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/work-orders", nil))
	if rec.Header().Get("ETag") != "" || rec.Body.String() != "[]" {
		t.Fatalf("excluded route: etag=%q body=%q", rec.Header().Get("ETag"), rec.Body.String())
	}
}

func TestETagHeadHasNoBody(t *testing.T) {
	h := ETag(func(*http.Request) bool { return true })(etagHandler(`{"a":1}`, 200, "application/json"))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodHead, "/x", nil))
	if rec.Code != 200 || rec.Header().Get("ETag") == "" || rec.Body.Len() != 0 || rec.Header().Get("Content-Length") != "7" {
		t.Fatalf("HEAD: %d etag=%q body=%d len=%q", rec.Code, rec.Header().Get("ETag"), rec.Body.Len(), rec.Header().Get("Content-Length"))
	}
}
