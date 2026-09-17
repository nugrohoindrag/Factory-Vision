package db

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"math/big"
	"strings"
	"time"
)

// The Node API represented every timestamp as the string toISOString()
// produces (UTC, millisecond precision, trailing Z) and every DATE column as
// YYYY-MM-DD. The console and the operator terminal parse exactly those
// shapes, so the Go domain types keep strings for both and convert at the
// repository boundary with the helpers here.

const isoLayout = "2006-01-02T15:04:05.000Z"

// ISO renders an instant the way JavaScript's toISOString does.
func ISO(t time.Time) string { return t.UTC().Format(isoLayout) }

// ISOPtr is ISO for a nullable column.
func ISOPtr(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := ISO(*t)
	return &s
}

// Now is the ISO string for the current instant.
func Now() string { return ISO(time.Now()) }

// ParseISO accepts what Date.parse accepts in practice: RFC 3339 with or
// without fractional seconds, a timestamp without zone, and a bare date.
func ParseISO(s string) (time.Time, error) {
	s = strings.TrimSpace(s)
	for _, layout := range []string{time.RFC3339Nano, time.RFC3339, "2006-01-02T15:04:05.000", "2006-01-02T15:04:05", "2006-01-02"} {
		if t, err := time.Parse(layout, s); err == nil {
			return t, nil
		}
	}
	return time.Time{}, fmt.Errorf("invalid timestamp %q", s)
}

// Date renders a DATE column as the calendar date PostgreSQL holds, not as a
// moment: shift_date decides which shift a record belongs to and therefore
// every OEE figure derived from it.
func Date(t time.Time) string { return t.Format("2006-01-02") }

// DatePtr is Date for a nullable column.
func DatePtr(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := Date(*t)
	return &s
}

// Str turns a nullable text column into an absent property rather than an
// explicit null, matching orUndefined in the Node repositories.
func Str(s *string) *string {
	if s == nil || *s == "" {
		return nil
	}
	return s
}

// StrOr reads a nullable text column with a default.
func StrOr(s *string, fallback string) string {
	if s == nil {
		return fallback
	}
	return *s
}

// Ptr returns a pointer to v, for optional JSON fields.
func Ptr[T any](v T) *T { return &v }

// NullIf returns nil for an empty string, so it is stored as NULL.
func NullIf(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// Deref reads an optional value with a default.
func Deref[T any](p *T, fallback T) T {
	if p == nil {
		return fallback
	}
	return *p
}

// JSONB serialises a value for a jsonb column; nil stays NULL.
func JSONB(v any) ([]byte, error) {
	if v == nil {
		return nil, nil
	}
	return json.Marshal(v)
}

// RawJSON decodes a jsonb column into an arbitrary value; NULL stays nil.
func RawJSON(b []byte) any {
	if len(b) == 0 {
		return nil
	}
	var v any
	if err := json.Unmarshal(b, &v); err != nil {
		return nil
	}
	return v
}

const base36 = "0123456789abcdefghijklmnopqrstuvwxyz"

// RandomBase36 mirrors Math.random().toString(36).substring(2, n), the
// suffix the Node API put on generated ids.
func RandomBase36(n int) string {
	out := make([]byte, n)
	for i := range out {
		idx, err := rand.Int(rand.Reader, big.NewInt(int64(len(base36))))
		if err != nil {
			panic(err)
		}
		out[i] = base36[idx.Int64()]
	}
	return string(out)
}

// NewID builds an id in the shape the Node API used: <prefix>-<ms>-<rand>.
func NewID(prefix string, randLen int) string {
	return fmt.Sprintf("%s-%d-%s", prefix, time.Now().UnixMilli(), RandomBase36(randLen))
}
