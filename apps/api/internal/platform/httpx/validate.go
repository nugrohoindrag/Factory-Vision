package httpx

import (
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"

	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/db"
)

// Validator is a deliberately small request validator (US-054).
//
// It exists so every endpoint reports a bad request the same way: collect
// all field failures, then return one VALIDATION_ERROR carrying the complete
// list. Failing on the first bad field would make CSV-scale payloads and
// multi-field forms need several round trips to get right. The messages are
// the Node API's, word for word, because the console shows them.
type Validator struct {
	body   map[string]any
	errors []FieldError
}

// Validate wraps a decoded body.
func Validate(body map[string]any) *Validator {
	if body == nil {
		body = map[string]any{}
	}
	return &Validator{body: body}
}

// Opt carries the per-field options; zero values mean "required, unbounded".
type Opt struct {
	Optional bool
	Min      *float64
	Max      *float64
	Integer  bool
}

// Min and Max build option values without a temporary variable.
func Min(v float64) *float64 { return &v }
func Max(v float64) *float64 { return &v }

func (v *Validator) fail(field, code, message string) {
	v.errors = append(v.errors, FieldError{Field: field, Code: code, Message: message})
}

func (v *Validator) absent(field string, raw any) bool {
	if raw == nil {
		return true
	}
	if s, ok := raw.(string); ok && s == "" {
		return true
	}
	return false
}

// Has reports whether the field was sent at all (even as null).
func (v *Validator) Has(field string) bool {
	_, ok := v.body[field]
	return ok
}

// Raw returns the untyped value.
func (v *Validator) Raw(field string) any { return v.body[field] }

// String reads a required, non-empty, trimmed string.
func (v *Validator) String(field string, opt Opt) *string {
	raw := v.body[field]
	if v.absent(field, raw) {
		if !opt.Optional {
			v.fail(field, "REQUIRED", field+" wajib diisi.")
		}
		return nil
	}
	s, ok := raw.(string)
	if !ok {
		v.fail(field, "INVALID_TYPE", field+" harus berupa teks.")
		return nil
	}
	value := strings.TrimSpace(s)
	if opt.Min != nil && float64(len([]rune(value))) < *opt.Min {
		v.fail(field, "TOO_SHORT", fmt.Sprintf("%s minimal %s karakter.", field, num(*opt.Min)))
	}
	if opt.Max != nil && float64(len([]rune(value))) > *opt.Max {
		v.fail(field, "TOO_LONG", fmt.Sprintf("%s maksimal %s karakter.", field, num(*opt.Max)))
	}
	return &value
}

// Str is String for the common required case, returning "" when missing
// (the error is recorded either way).
func (v *Validator) Str(field string) string {
	return db.Deref(v.String(field, Opt{}), "")
}

// OptStr is String for an optional field.
func (v *Validator) OptStr(field string) *string { return v.String(field, Opt{Optional: true}) }

// Number reads a finite number; numeric strings are accepted the way
// Number(raw) accepted them.
func (v *Validator) Number(field string, opt Opt) *float64 {
	raw := v.body[field]
	if v.absent(field, raw) {
		if !opt.Optional {
			v.fail(field, "REQUIRED", field+" wajib diisi.")
		}
		return nil
	}
	var value float64
	switch x := raw.(type) {
	case float64:
		value = x
	case string:
		f, err := strconv.ParseFloat(strings.TrimSpace(x), 64)
		if err != nil || math.IsInf(f, 0) || math.IsNaN(f) {
			v.fail(field, "INVALID_TYPE", field+" harus berupa angka.")
			return nil
		}
		value = f
	case bool:
		if x {
			value = 1
		}
	default:
		v.fail(field, "INVALID_TYPE", field+" harus berupa angka.")
		return nil
	}
	if opt.Integer && value != math.Trunc(value) {
		v.fail(field, "INVALID_FORMAT", field+" harus berupa bilangan bulat.")
	}
	if opt.Min != nil && value < *opt.Min {
		v.fail(field, "OUT_OF_RANGE", fmt.Sprintf("%s minimal %s.", field, num(*opt.Min)))
	}
	if opt.Max != nil && value > *opt.Max {
		v.fail(field, "OUT_OF_RANGE", fmt.Sprintf("%s maksimal %s.", field, num(*opt.Max)))
	}
	return &value
}

// Int reads an integer field.
func (v *Validator) Int(field string, opt Opt) *int {
	opt.Integer = true
	f := v.Number(field, opt)
	if f == nil {
		return nil
	}
	n := int(*f)
	return &n
}

// Boolean accepts true/false and their string forms.
func (v *Validator) Boolean(field string, opt Opt) *bool {
	raw, present := v.body[field]
	if !present || raw == nil {
		if !opt.Optional {
			v.fail(field, "REQUIRED", field+" wajib diisi.")
		}
		return nil
	}
	switch x := raw.(type) {
	case bool:
		return &x
	case string:
		if x == "true" {
			return db.Ptr(true)
		}
		if x == "false" {
			return db.Ptr(false)
		}
	}
	v.fail(field, "INVALID_TYPE", field+" harus berupa true/false.")
	return nil
}

// OneOf reads an enumerated string.
func (v *Validator) OneOf(field string, allowed []string, opt Opt) *string {
	raw := v.body[field]
	if v.absent(field, raw) {
		if !opt.Optional {
			v.fail(field, "REQUIRED", field+" wajib diisi.")
		}
		return nil
	}
	s, ok := raw.(string)
	if !ok || !contains(allowed, s) {
		v.fail(field, "INVALID_VALUE", fmt.Sprintf("%s harus salah satu dari: %s.", field, strings.Join(allowed, ", ")))
		return nil
	}
	return &s
}

// ISODate accepts an ISO-8601 timestamp or a YYYY-MM-DD date.
func (v *Validator) ISODate(field string, opt Opt) *string {
	raw := v.body[field]
	if v.absent(field, raw) {
		if !opt.Optional {
			v.fail(field, "REQUIRED", field+" wajib diisi.")
		}
		return nil
	}
	s, ok := raw.(string)
	if !ok {
		v.fail(field, "INVALID_FORMAT", field+" harus berupa tanggal ISO yang valid.")
		return nil
	}
	if _, err := db.ParseISO(s); err != nil {
		v.fail(field, "INVALID_FORMAT", field+" harus berupa tanggal ISO yang valid.")
		return nil
	}
	return &s
}

var clockPattern = regexp.MustCompile(`^([01]\d|2[0-3]):[0-5]\d$`)

// ClockTime reads HH:mm, used by shift configuration (US-021).
func (v *Validator) ClockTime(field string, opt Opt) *string {
	raw := v.body[field]
	if v.absent(field, raw) {
		if !opt.Optional {
			v.fail(field, "REQUIRED", field+" wajib diisi.")
		}
		return nil
	}
	s, ok := raw.(string)
	if !ok || !clockPattern.MatchString(s) {
		v.fail(field, "INVALID_FORMAT", field+" harus dalam format HH:mm.")
		return nil
	}
	return &s
}

var emailPattern = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)

// Email reads and lower-cases an email address.
func (v *Validator) Email(field string, opt Opt) *string {
	value := v.String(field, opt)
	if value == nil {
		return nil
	}
	if !emailPattern.MatchString(*value) {
		v.fail(field, "INVALID_FORMAT", field+" harus berupa alamat email yang valid.")
		return nil
	}
	lower := strings.ToLower(*value)
	return &lower
}

// StringArray reads a list of strings.
func (v *Validator) StringArray(field string, opt Opt) []string {
	raw, present := v.body[field]
	if !present || raw == nil {
		if !opt.Optional {
			v.fail(field, "REQUIRED", field+" wajib diisi.")
		}
		return nil
	}
	list, ok := raw.([]any)
	if !ok {
		v.fail(field, "INVALID_TYPE", field+" harus berupa daftar teks.")
		return nil
	}
	out := make([]string, 0, len(list))
	for _, item := range list {
		s, ok := item.(string)
		if !ok {
			v.fail(field, "INVALID_TYPE", field+" harus berupa daftar teks.")
			return nil
		}
		out = append(out, s)
	}
	return out
}

// Object reads a nested object, for payloads that carry one.
func (v *Validator) Object(field string, opt Opt) map[string]any {
	raw, present := v.body[field]
	if !present || raw == nil {
		if !opt.Optional {
			v.fail(field, "REQUIRED", field+" wajib diisi.")
		}
		return nil
	}
	obj, ok := raw.(map[string]any)
	if !ok {
		v.fail(field, "INVALID_TYPE", field+" harus berupa objek.")
		return nil
	}
	return obj
}

// Reject records an error a type check cannot express (a cross-field rule).
func (v *Validator) Reject(field, code, message string) { v.fail(field, code, message) }

// Failed reports whether anything has been rejected so far.
func (v *Validator) Failed() bool { return len(v.errors) > 0 }

// Done returns the collected failures as one error, or nil. Call once, at
// the end of parsing.
func (v *Validator) Done() error {
	return v.DoneWith("Data yang dikirim tidak valid.")
}

// DoneWith is Done with a custom top-level message.
func (v *Validator) DoneWith(message string) error {
	if len(v.errors) == 0 {
		return nil
	}
	return Validation(message, v.errors...)
}

func contains(list []string, s string) bool {
	for _, item := range list {
		if item == s {
			return true
		}
	}
	return false
}

// num formats a bound the way JavaScript template literals render numbers.
func num(f float64) string {
	if f == math.Trunc(f) {
		return strconv.FormatInt(int64(f), 10)
	}
	return strconv.FormatFloat(f, 'f', -1, 64)
}
