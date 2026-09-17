package middleware

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"strconv"
	"strings"
)

// ETag gives the read-model routes a validator. A dashboard polls the same
// analytics every few seconds and most of those answers are identical; with
// a weak ETag on every 200 JSON response, a client that sends the last tag
// back in If-None-Match gets a bodiless 304 instead of the same kilobytes
// again. Only the routes `match` names are buffered — everything else,
// including CSV exports and the SSE feed, streams through untouched — and the
// Cache-Control: no-store the security headers set stays: this is
// revalidation by the client, not storage by a shared cache.
func ETag(match func(*http.Request) bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if (r.Method != http.MethodGet && r.Method != http.MethodHead) || match == nil || !match(r) {
				next.ServeHTTP(w, r)
				return
			}
			rec := &etagRecorder{ResponseWriter: w}
			next.ServeHTTP(rec, r)
			if !rec.buffered {
				return
			}
			tag := WeakETag(rec.body.Bytes())
			h := w.Header()
			h.Set("ETag", tag)
			if etagMatches(r.Header.Get("If-None-Match"), tag) {
				h.Del("Content-Length")
				w.WriteHeader(http.StatusNotModified)
				return
			}
			h.Set("Content-Length", strconv.Itoa(rec.body.Len()))
			w.WriteHeader(http.StatusOK)
			if r.Method != http.MethodHead {
				_, _ = w.Write(rec.body.Bytes())
			}
		})
	}
}

// WeakETag is the validator for a body: the first 16 bytes of its SHA-256,
// weak because a compressed transfer of the same JSON is the same resource.
func WeakETag(body []byte) string {
	sum := sha256.Sum256(body)
	return `W/"` + hex.EncodeToString(sum[:16]) + `"`
}

// etagMatches reads If-None-Match: a list of validators, each possibly
// weak, or `*`. Comparison is weak (RFC 9110 §8.8.3.2), so W/ prefixes are
// ignored on both sides.
func etagMatches(ifNoneMatch, tag string) bool {
	if ifNoneMatch == "" {
		return false
	}
	want := strings.TrimPrefix(tag, "W/")
	for _, candidate := range strings.Split(ifNoneMatch, ",") {
		candidate = strings.TrimSpace(candidate)
		if candidate == "*" || strings.TrimPrefix(candidate, "W/") == want {
			return true
		}
	}
	return false
}

// etagRecorder buffers a 200 JSON response and passes everything else
// through unchanged, deciding at the first WriteHeader or Write.
type etagRecorder struct {
	http.ResponseWriter
	decided  bool
	buffered bool
	body     bytes.Buffer
}

func (e *etagRecorder) decide(status int) {
	if e.decided {
		return
	}
	e.decided = true
	contentType := e.Header().Get("Content-Type")
	e.buffered = status == http.StatusOK && strings.HasPrefix(contentType, "application/json")
	if !e.buffered {
		e.ResponseWriter.WriteHeader(status)
	}
}

func (e *etagRecorder) WriteHeader(status int) {
	if e.decided {
		if !e.buffered {
			e.ResponseWriter.WriteHeader(status)
		}
		return
	}
	e.decide(status)
}

func (e *etagRecorder) Write(p []byte) (int, error) {
	if !e.decided {
		// An implicit 200, the way net/http treats a Write without a
		// WriteHeader; the content type is what the handler set by now.
		e.decide(http.StatusOK)
	}
	if e.buffered {
		return e.body.Write(p)
	}
	return e.ResponseWriter.Write(p)
}

// Flush is forwarded only for a pass-through response; a buffered body is
// written whole once the handler returns.
func (e *etagRecorder) Flush() {
	if e.decided && !e.buffered {
		if f, ok := e.ResponseWriter.(http.Flusher); ok {
			f.Flush()
		}
	}
}
