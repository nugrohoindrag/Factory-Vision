// Package storage is the object store interface (Architecture §22.5,
// ADR-09): a filesystem directory on the single-VPS stack, MinIO or S3 where
// one is configured, chosen once at bootstrap. Keys are opaque: Put stores
// exactly the key it is given, so the naming scheme belongs to the caller.
package storage

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
)

// Store is what the rest of the code talks to.
type Store interface {
	// Kind is the backend in use, for the health endpoint and for tests.
	Kind() string
	Put(ctx context.Context, key string, body []byte, contentType string) (int, error)
	// Get reads an object back; nil, nil when it is not there.
	Get(ctx context.Context, key string) ([]byte, error)
	// Remove deletes an object. Already-absent is success.
	Remove(ctx context.Context, key string) error
	Exists(ctx context.Context, key string) (bool, error)
	// Check confirms the backend is usable, at bootstrap, so a misconfigured
	// store is a startup complaint rather than a failed upload three days later.
	Check(ctx context.Context) (bool, string)
}

// ErrUnsafeKey is returned for a key that could escape its prefix.
var ErrUnsafeKey = errors.New("object key tidak valid")

// AssertSafeKey rejects a key that could escape its prefix, whatever the backend.
func AssertSafeKey(key string) error {
	if key == "" || strings.HasPrefix(key, "/") || strings.Contains(key, "..") || strings.Contains(key, "\\") || strings.Contains(key, "\x00") {
		return fmt.Errorf("%w: %q", ErrUnsafeKey, key)
	}
	return nil
}

// Options selects and configures the backend, from OBJECT_STORAGE_*.
type Options struct {
	Driver             string // filesystem | s3 | minio
	DocumentDir        string
	Bucket             string
	Region             string
	Endpoint           string
	AccessKey          string
	SecretKey          string
	ForcePathStyle     bool
	ForcePathStyleSet  bool
	WorkingDirFallback string
}

// FromOptions is the one place the backend is chosen. The default is the
// filesystem, which is right for the single-VPS stack and wrong the moment
// there is a second API replica — a documented default, not a silent one.
func FromOptions(o Options) (Store, error) {
	driver := strings.ToLower(strings.TrimSpace(o.Driver))
	if driver == "" {
		driver = "filesystem"
	}
	if driver == "s3" || driver == "minio" {
		var missing []string
		if o.Bucket == "" {
			missing = append(missing, "OBJECT_STORAGE_BUCKET")
		}
		if o.AccessKey == "" {
			missing = append(missing, "OBJECT_STORAGE_ACCESS_KEY")
		}
		if o.SecretKey == "" {
			missing = append(missing, "OBJECT_STORAGE_SECRET_KEY")
		}
		if len(missing) > 0 {
			return nil, fmt.Errorf("OBJECT_STORAGE_DRIVER=%s tetapi %s belum diset.", driver, strings.Join(missing, ", "))
		}
		region := o.Region
		if region == "" {
			region = "us-east-1"
		}
		pathStyle := true
		if o.ForcePathStyleSet {
			pathStyle = o.ForcePathStyle
		}
		return NewS3(S3Options{Bucket: o.Bucket, Region: region, Endpoint: o.Endpoint, AccessKey: o.AccessKey, SecretKey: o.SecretKey, ForcePathStyle: pathStyle}), nil
	}
	if driver != "filesystem" {
		return nil, fmt.Errorf("OBJECT_STORAGE_DRIVER=%s tidak dikenal. Gunakan 'filesystem' atau 's3'.", driver)
	}
	root := o.DocumentDir
	if root == "" {
		root = filepath.Join(o.WorkingDirFallback, "var", "documents")
	}
	abs, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	return NewFilesystem(abs), nil
}
