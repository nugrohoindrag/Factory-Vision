// Package httpx is the HTTP foundation every module shares: the one error
// type, the one place a response body is built from it, JSON in and out, and
// the request validator.
package httpx

import "fmt"

// FieldError is one field-level validation failure.
type FieldError struct {
	Field   string `json:"field"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

// Error is the one error type every module returns (US-054).
//
// Route handlers never build a response body by hand: they return an *Error
// and Handle turns it into the single documented envelope, so a validation
// failure in master data reads exactly like one in shop floor.
type Error struct {
	Code    string
	Message string
	Status  int
	Fields  []FieldError
	// RetryAfter, in seconds, is set on 429s so the envelope can answer with
	// Retry-After: a 429 without it tells a well-behaved client to guess, and
	// a guessing client retries in a loop.
	RetryAfter int
}

func (e *Error) Error() string { return fmt.Sprintf("%s (%d): %s", e.Code, e.Status, e.Message) }

// New is the general constructor; the helpers below are the documented set.
func New(code, message string, status int) *Error {
	return &Error{Code: code, Message: message, Status: status}
}

func Validation(message string, fields ...FieldError) *Error {
	return &Error{Code: "VALIDATION_ERROR", Message: message, Status: 422, Fields: fields}
}

func Unauthenticated(message string) *Error {
	if message == "" {
		message = "Sesi tidak valid atau telah berakhir."
	}
	return New("UNAUTHENTICATED", message, 401)
}

func Forbidden(message string) *Error {
	if message == "" {
		message = "Anda tidak memiliki izin untuk tindakan ini."
	}
	return New("FORBIDDEN", message, 403)
}

func OutOfScope(message string) *Error {
	if message == "" {
		message = "Data berada di luar cakupan akses Anda."
	}
	return New("OUT_OF_SCOPE", message, 403)
}

func NotFound(message string) *Error {
	if message == "" {
		message = "Data tidak ditemukan."
	}
	return New("NOT_FOUND", message, 404)
}

func Conflict(message string) *Error { return New("CONFLICT", message, 409) }

// InvalidState is a legal request against an entity whose state does not
// allow it.
func InvalidState(message string) *Error { return New("INVALID_STATE", message, 409) }

// RateLimited carries the wait rather than the reason: telling a caller how
// many attempts remain, or whether the account exists, hands a brute-force
// script the feedback it needs.
func RateLimited(message string, retryAfterSeconds int) *Error {
	e := New("RATE_LIMITED", message, 429)
	e.RetryAfter = retryAfterSeconds
	return e
}

func Internal(message string) *Error {
	if message == "" {
		message = "Terjadi kesalahan internal."
	}
	return New("INTERNAL_ERROR", message, 500)
}

// PayloadTooLarge answers a body over the configured limit. The Node API
// returned a codeless 500 here; an envelope the client can read is a
// deliberate improvement.
func PayloadTooLarge() *Error {
	return New("VALIDATION_ERROR", "Ukuran data yang dikirim melebihi batas 8 MB.", 413)
}
