package db

import (
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// ConstraintError is a PostgreSQL constraint violation a request can cause,
// translated into what it means. Only the classes a caller can actually
// trigger are described; anything else stays an unexplained fault, because
// inventing an explanation for an error we do not understand is worse than
// admitting it is a fault.
type ConstraintError struct {
	Status  int
	Code    string
	Message string
	cause   *pgconn.PgError
}

func (e *ConstraintError) Error() string { return e.cause.Error() }
func (e *ConstraintError) Unwrap() error { return e.cause }

// Describe recognises a constraint violation, or returns nil.
func Describe(err error) *ConstraintError {
	var pg *pgconn.PgError
	if !errors.As(err, &pg) {
		return nil
	}
	switch pg.Code {
	case "23505":
		msg := "Data serupa sudah ada."
		if pg.ConstraintName != "" {
			msg = "Data serupa sudah ada dan melanggar batasan " + pg.ConstraintName + "."
		}
		return &ConstraintError{Status: 409, Code: "CONFLICT", Message: msg, cause: pg}
	case "23503":
		return &ConstraintError{Status: 422, Code: "VALIDATION_ERROR", Message: "Data yang direferensikan tidak ditemukan.", cause: pg}
	case "23502":
		msg := "Ada kolom wajib yang belum diisi."
		if pg.ColumnName != "" {
			msg = "Kolom " + pg.ColumnName + " wajib diisi."
		}
		return &ConstraintError{Status: 422, Code: "VALIDATION_ERROR", Message: msg, cause: pg}
	case "23514":
		msg := "Nilai tidak memenuhi aturan yang berlaku."
		if pg.ConstraintName != "" {
			msg = "Nilai tidak memenuhi aturan " + pg.ConstraintName + "."
		}
		return &ConstraintError{Status: 422, Code: "VALIDATION_ERROR", Message: msg, cause: pg}
	}
	return nil
}

// IsNoRows reports whether a single-row query found nothing.
func IsNoRows(err error) bool { return errors.Is(err, pgx.ErrNoRows) }

// IsUniqueViolation reports a 23505, for callers that turn it into a
// domain-specific conflict message rather than the generic one.
func IsUniqueViolation(err error) bool {
	var pg *pgconn.PgError
	return errors.As(err, &pg) && pg.Code == "23505"
}

// IsInsufficientPrivilege reports a 42501, which is what the append-only
// tables answer to an UPDATE or DELETE from the application role.
func IsInsufficientPrivilege(err error) bool {
	var pg *pgconn.PgError
	return errors.As(err, &pg) && pg.Code == "42501"
}

// SQLState is the PostgreSQL error code and the constraint it names, for
// callers that translate one specific violation into a domain message.
// Empty when the error is not a PostgreSQL error.
func SQLState(err error) (code, constraint string) {
	var pg *pgconn.PgError
	if !errors.As(err, &pg) {
		return "", ""
	}
	return pg.Code, pg.ConstraintName
}
