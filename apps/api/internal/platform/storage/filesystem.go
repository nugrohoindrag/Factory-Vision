package storage

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

// Filesystem is the self-hosted default: a mounted directory. Correct for
// one API container owning one volume; the S3 store exists beside it for
// the moment there are two. Traversal is refused rather than sanitised.
type Filesystem struct {
	root string
}

// NewFilesystem stores under root.
func NewFilesystem(root string) *Filesystem { return &Filesystem{root: root} }

// Kind is "filesystem".
func (f *Filesystem) Kind() string { return "filesystem" }

// Root is the directory in use.
func (f *Filesystem) Root() string { return f.root }

func (f *Filesystem) resolve(key string) (string, error) {
	if err := AssertSafeKey(key); err != nil {
		return "", err
	}
	base := filepath.Clean(f.root)
	resolved := filepath.Clean(filepath.Join(base, filepath.FromSlash(key)))
	if resolved != base && !strings.HasPrefix(resolved, base+string(filepath.Separator)) {
		return "", fmt.Errorf("object key keluar dari root penyimpanan: %s", key)
	}
	return resolved, nil
}

// Put writes the bytes, creating the parent directories.
func (f *Filesystem) Put(_ context.Context, key string, body []byte, _ string) (int, error) {
	target, err := f.resolve(key)
	if err != nil {
		return 0, err
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return 0, err
	}
	if err := os.WriteFile(target, body, 0o644); err != nil {
		return 0, err
	}
	return len(body), nil
}

// Get reads the bytes; nil when absent.
func (f *Filesystem) Get(_ context.Context, key string) ([]byte, error) {
	target, err := f.resolve(key)
	if err != nil {
		return nil, err
	}
	b, err := os.ReadFile(target)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	return b, err
}

// Remove deletes the file; absent is success.
func (f *Filesystem) Remove(_ context.Context, key string) error {
	target, err := f.resolve(key)
	if err != nil {
		return err
	}
	if err := os.Remove(target); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	return nil
}

// Exists reports whether the file is there.
func (f *Filesystem) Exists(_ context.Context, key string) (bool, error) {
	target, err := f.resolve(key)
	if err != nil {
		return false, err
	}
	_, err = os.Stat(target)
	if err == nil {
		return true, nil
	}
	if errors.Is(err, fs.ErrNotExist) {
		return false, nil
	}
	return false, err
}

// Check creates the root and probes writability — a read-only mount or a
// volume owned by another uid is what actually fails in production.
func (f *Filesystem) Check(_ context.Context) (bool, string) {
	if err := os.MkdirAll(f.root, 0o755); err != nil {
		return false, fmt.Sprintf("filesystem %s tidak dapat ditulis: %s", f.root, err)
	}
	probe := filepath.Join(f.root, ".write-probe")
	if err := os.WriteFile(probe, []byte("ok"), 0o644); err != nil {
		return false, fmt.Sprintf("filesystem %s tidak dapat ditulis: %s", f.root, err)
	}
	_ = os.Remove(probe)
	return true, "filesystem: " + f.root
}
