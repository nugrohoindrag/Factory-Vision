package storage

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

// A store that answers 500 five times opens the breaker; the sixth call is
// refused without reaching the store, and a 404 never counts.
func TestS3BreakerOpensOnServerErrors(t *testing.T) {
	var hits atomic.Int32
	var status atomic.Int32
	status.Store(http.StatusInternalServerError)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		w.WriteHeader(int(status.Load()))
	}))
	defer srv.Close()
	s := NewS3(S3Options{Bucket: "b", Region: "us-east-1", Endpoint: srv.URL, AccessKey: "k", SecretKey: "s", ForcePathStyle: true})
	ctx := context.Background()

	for i := 0; i < 5; i++ {
		if _, err := s.Get(ctx, "doc/"+string(rune('a'+i))); err == nil || errors.Is(err, ErrUnavailable) {
			t.Fatalf("call %d: want the store's own error, got %v", i, err)
		}
	}
	if hits.Load() != 5 {
		t.Fatalf("store reached %d times, want 5", hits.Load())
	}
	_, err := s.Get(ctx, "doc/z")
	if !errors.Is(err, ErrUnavailable) {
		t.Fatalf("sixth call must be refused by the breaker, got %v", err)
	}
	if hits.Load() != 5 {
		t.Fatalf("an open breaker must not reach the store (hits %d)", hits.Load())
	}
}

func TestS3BreakerIgnoresNotFound(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusNotFound) }))
	defer srv.Close()
	s := NewS3(S3Options{Bucket: "b", Region: "us-east-1", Endpoint: srv.URL, AccessKey: "k", SecretKey: "s", ForcePathStyle: true})
	for i := 0; i < 10; i++ {
		b, err := s.Get(context.Background(), "missing")
		if err != nil || b != nil {
			t.Fatalf("404 is nil, nil: %v %v", b, err)
		}
	}
	if ok, _ := s.Exists(context.Background(), "missing"); ok {
		t.Fatal("exists must be false")
	}
}
