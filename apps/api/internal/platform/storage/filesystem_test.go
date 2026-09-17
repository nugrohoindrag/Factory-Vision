package storage

import (
	"context"
	"path/filepath"
	"testing"
)

// Port of qa-object-storage.mjs for the filesystem backend: round trip,
// idempotent removal, and a key that tries to leave the root is refused.
func TestFilesystemStoreRoundTrip(t *testing.T) {
	root := t.TempDir()
	store := NewFilesystem(root)
	ctx := context.Background()
	if ok, detail := store.Check(ctx); !ok {
		t.Fatalf("check: %s", detail)
	}
	n, err := store.Put(ctx, "tenant-a/doc-1.pdf", []byte("%PDF-1.4 testkit"), "application/pdf")
	if err != nil || n != 16 {
		t.Fatalf("put: %d %v", n, err)
	}
	if exists, _ := store.Exists(ctx, "tenant-a/doc-1.pdf"); !exists {
		t.Fatal("object should exist")
	}
	got, err := store.Get(ctx, "tenant-a/doc-1.pdf")
	if err != nil || string(got) != "%PDF-1.4 testkit" {
		t.Fatalf("get: %q %v", got, err)
	}
	if missing, err := store.Get(ctx, "tenant-a/nope.pdf"); err != nil || missing != nil {
		t.Fatalf("missing object: %v %v", missing, err)
	}
	if err := store.Remove(ctx, "tenant-a/doc-1.pdf"); err != nil {
		t.Fatal(err)
	}
	if err := store.Remove(ctx, "tenant-a/doc-1.pdf"); err != nil {
		t.Fatalf("second remove must be success: %v", err)
	}
	for _, bad := range []string{"../escape.txt", "/abs.txt", "a/../../b"} {
		if _, err := store.Put(ctx, bad, []byte("x"), "text/plain"); err == nil {
			t.Errorf("%q accepted", bad)
		}
	}
	if store.Root() != root || filepath.IsAbs(store.Root()) == false {
		t.Fatalf("root: %s", store.Root())
	}
}
