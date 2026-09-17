// Package csv is CSV onboarding for master data (US-008).
//
// The pilot factory's product, machine and reason-code lists already exist
// in spreadsheets. Re-keying them into forms is the single largest barrier
// to a two-week onboarding, so import is validated row by row and reported
// in full: a file with one bad line imports the other 199 and says exactly
// which line failed and why, rather than rejecting the lot or, worse,
// silently skipping.
package csv

import (
	"context"
	"regexp"
	"strconv"
	"strings"

	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/masterdata"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/httpx"
)

// Column describes one CSV column.
type Column struct {
	Name        string  `json:"name"`
	Required    bool    `json:"required"`
	Description string  `json:"description"`
	References  *string `json:"references,omitempty"`
	Example     string  `json:"example"`
}

// Template is the header row plus a filled example.
type Template struct {
	Entity  string   `json:"entity"`
	Label   string   `json:"label"`
	Columns []Column `json:"columns"`
	CSV     string   `json:"csv"`
}

// RowError is one failed row.
type RowError struct {
	Row     int     `json:"row"`
	Column  *string `json:"column,omitempty"`
	Code    string  `json:"code"` // REQUIRED | INVALID_FORMAT | UNKNOWN_REFERENCE | DUPLICATE | OUT_OF_SCOPE
	Message string  `json:"message"`
}

// ImportResult is the full report of an import or a dry run.
type ImportResult struct {
	Entity            string     `json:"entity"`
	TotalRows         int        `json:"totalRows"`
	Created           int        `json:"created"`
	Updated           int        `json:"updated"`
	Skipped           int        `json:"skipped"`
	Failed            int        `json:"failed"`
	Errors            []RowError `json:"errors"`
	RejectedWholeFile bool       `json:"rejectedWholeFile"`
}

// EntityOption is one entry of the supported-entity list.
type EntityOption struct {
	Entity string `json:"entity"`
	Label  string `json:"label"`
}

// Row is one parsed CSV row, keyed by header.
type Row map[string]string

type rowError struct {
	column  string
	code    string
	message string
}

type spec struct {
	label    string
	columns  []Column
	keyOf    func(Row) string
	validate func(ctx context.Context, tenantID string, row Row, ref *reference) []rowError
	apply    func(ctx context.Context, tenantID string, row Row, ref *reference) (string, error)
	export   func(ctx context.Context, tenantID string, ref *reference, allowedLineIDs []string) ([]Row, error)
}

// reference is the master data an import validates against, read once per
// import rather than once per row.
type reference struct {
	master *masterdata.Service
	*masterdata.Reference
	shifts    []masterdata.Shift
	operators []masterdata.Operator
}

func (r *reference) refresh(ctx context.Context, tenantID string) error {
	ref, err := r.master.Reference(ctx, tenantID)
	if err != nil {
		return err
	}
	r.Reference = ref
	if r.shifts, err = r.master.Shifts(ctx, tenantID); err != nil {
		return err
	}
	r.operators, err = r.master.Operators(ctx, tenantID)
	return err
}

// Order is the entity order the console lists.
var Order = []string{"products", "machines", "lines", "operators", "processes", "routings", "machine-rates", "shifts", "downtime-reasons", "reject-reasons"}

// Service owns the entity specifications.
type Service struct {
	master *masterdata.Service
	specs  map[string]spec
}

func col(name string, required bool, description, example string) Column {
	return Column{Name: name, Required: required, Description: description, Example: example}
}

func colRef(name string, required bool, description, example, references string) Column {
	c := col(name, required, description, example)
	c.References = &references
	return c
}

var downtimeCategories = []string{"MACHINE", "MATERIAL", "PROCESS", "QUALITY", "PEOPLE", "PLANNING"}
var rejectCategories = []string{"DIMENSION", "APPEARANCE", "MATERIAL", "ASSEMBLY", "FUNCTION", "OTHER"}

// NewService builds the specifications over master data.
func NewService(master *masterdata.Service) *Service {
	s := &Service{master: master}
	s.specs = buildSpecs()
	return s
}

// ListEntities is what the import screen offers.
func (s *Service) ListEntities() []EntityOption {
	out := make([]EntityOption, 0, len(Order))
	for _, e := range Order {
		out = append(out, EntityOption{Entity: e, Label: s.specs[e].label})
	}
	return out
}

func (s *Service) spec(entity string) (spec, error) {
	sp, ok := s.specs[entity]
	if !ok {
		return spec{}, httpx.NotFound("Entitas CSV " + entity + " tidak didukung.")
	}
	return sp, nil
}

// Template is the header row plus a filled example, so the first import is
// a copy-paste.
func (s *Service) Template(entity string) (Template, error) {
	sp, err := s.spec(entity)
	if err != nil {
		return Template{}, err
	}
	header := make([]string, 0, len(sp.columns))
	example := make([]string, 0, len(sp.columns))
	for _, c := range sp.columns {
		header = append(header, c.Name)
		example = append(example, escapeCSV(c.Example))
	}
	return Template{
		Entity: entity, Label: sp.label, Columns: sp.columns,
		CSV: strings.Join(header, ",") + "\n" + strings.Join(example, ",") + "\n",
	}, nil
}

// Export serialises the collection, scoped to the caller's lines where the
// entity has a line.
func (s *Service) Export(ctx context.Context, entity, tenantID string, allowedLineIDs []string) (string, int, error) {
	sp, err := s.spec(entity)
	if err != nil {
		return "", 0, err
	}
	ref := &reference{master: s.master}
	if err := ref.refresh(ctx, tenantID); err != nil {
		return "", 0, err
	}
	rows, err := sp.export(ctx, tenantID, ref, allowedLineIDs)
	if err != nil {
		return "", 0, err
	}
	var b strings.Builder
	for i, c := range sp.columns {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString(c.Name)
	}
	b.WriteByte('\n')
	for _, row := range rows {
		for i, c := range sp.columns {
			if i > 0 {
				b.WriteByte(',')
			}
			b.WriteString(escapeCSV(row[c.Name]))
		}
		b.WriteByte('\n')
	}
	return b.String(), len(rows), nil
}

// Import validates and applies a CSV upload. dryRun runs every check and
// reports the outcome without writing, which is what the console's
// "Validasi" button calls before an admin commits.
func (s *Service) Import(ctx context.Context, entity, tenantID, content string, dryRun bool) (ImportResult, error) {
	sp, err := s.spec(entity)
	if err != nil {
		return ImportResult{}, err
	}
	header, rows := Parse(content)
	result := ImportResult{Entity: entity, Errors: []RowError{}}

	if len(header) == 0 {
		result.RejectedWholeFile = true
		result.Errors = append(result.Errors, RowError{Row: 0, Code: "INVALID_FORMAT", Message: "File CSV kosong atau tanpa header."})
		return result, nil
	}
	// A missing required column is a file-level problem: importing the rows
	// that happen to parse would leave a half-configured factory behind.
	var missing []string
	for _, c := range sp.columns {
		if c.Required && !contains(header, c.Name) {
			missing = append(missing, c.Name)
		}
	}
	if len(missing) > 0 {
		result.RejectedWholeFile = true
		result.Errors = append(result.Errors, RowError{Row: 0, Code: "REQUIRED", Message: "Kolom wajib tidak ditemukan: " + strings.Join(missing, ", ") + "."})
		return result, nil
	}

	ref := &reference{master: s.master}
	if err := ref.refresh(ctx, tenantID); err != nil {
		return result, err
	}
	result.TotalRows = len(rows)
	seen := map[string]bool{}

	for index, row := range rows {
		rowNumber := index + 1
		var rowErrors []RowError
		for _, c := range sp.columns {
			if c.Required && row[c.Name] == "" {
				name := c.Name
				rowErrors = append(rowErrors, RowError{Row: rowNumber, Column: &name, Code: "REQUIRED", Message: c.Name + " wajib diisi."})
			}
		}
		if len(rowErrors) == 0 {
			key := sp.keyOf(row)
			if seen[key] {
				rowErrors = append(rowErrors, RowError{Row: rowNumber, Code: "DUPLICATE", Message: "Baris duplikat untuk kunci " + key + " di dalam file yang sama."})
			} else {
				seen[key] = true
			}
			for _, e := range sp.validate(ctx, tenantID, row, ref) {
				re := RowError{Row: rowNumber, Code: e.code, Message: e.message}
				if e.column != "" {
					column := e.column
					re.Column = &column
				}
				rowErrors = append(rowErrors, re)
			}
		}
		if len(rowErrors) > 0 {
			result.Failed++
			result.Errors = append(result.Errors, rowErrors...)
			continue
		}
		if dryRun {
			result.Skipped++
			continue
		}
		outcome, err := sp.apply(ctx, tenantID, row, ref)
		if err != nil {
			result.Failed++
			msg := "Gagal menyimpan baris."
			if e, ok := err.(*httpx.Error); ok {
				msg = e.Message
			} else if err != nil {
				msg = err.Error()
			}
			result.Errors = append(result.Errors, RowError{Row: rowNumber, Code: "INVALID_FORMAT", Message: msg})
			continue
		}
		if outcome == "created" {
			result.Created++
		} else {
			result.Updated++
		}
		// Later rows may reference what this one created (a line, then an
		// operator on it), so the reference is re-read after each write.
		if err := ref.refresh(ctx, tenantID); err != nil {
			return result, err
		}
	}
	return result, nil
}

// --- plumbing ---------------------------------------------------------

func isPositiveNumber(v string) bool {
	if v == "" {
		return false
	}
	f, err := strconv.ParseFloat(strings.TrimSpace(v), 64)
	return err == nil && f > 0
}

func numberError(column string) rowError {
	return rowError{column: column, code: "INVALID_FORMAT", message: column + " harus berupa angka lebih besar dari 0."}
}

func num(v string) float64 {
	f, _ := strconv.ParseFloat(strings.TrimSpace(v), 64)
	return f
}

func contains(list []string, s string) bool {
	for _, item := range list {
		if item == s {
			return true
		}
	}
	return false
}

var (
	formulaPrefix = regexp.MustCompile(`^[=+\-@\t\r]`)
	plainNumber   = regexp.MustCompile(`^-?\d+([.,]\d+)?$`)
	needsQuoting  = regexp.MustCompile(`[",\n]`)
)

// NeutralizeFormula guards against formula injection (§55): a cell that
// begins with =, +, -, @, a tab or a carriage return is a formula to Excel,
// not text. A plain negative number is left alone.
func NeutralizeFormula(value string) string {
	if !formulaPrefix.MatchString(value) || plainNumber.MatchString(value) {
		return value
	}
	return "'" + value
}

func escapeCSV(value string) string {
	safe := NeutralizeFormula(value)
	if needsQuoting.MatchString(safe) {
		return `"` + strings.ReplaceAll(safe, `"`, `""`) + `"`
	}
	return safe
}

// Parse is a minimal RFC-4180 reader: quoted fields, escaped quotes, CRLF.
// Exported spreadsheets routinely contain commas inside product names, so a
// naive split would corrupt exactly the data an admin is most likely to
// upload.
func Parse(text string) (header []string, rows []Row) {
	clean := strings.TrimPrefix(text, "\ufeff")
	var records [][]string
	var record []string
	var field strings.Builder
	inQuotes := false
	runes := []rune(clean)
	for i := 0; i < len(runes); i++ {
		c := runes[i]
		if inQuotes {
			if c == '"' {
				if i+1 < len(runes) && runes[i+1] == '"' {
					field.WriteRune('"')
					i++
				} else {
					inQuotes = false
				}
			} else {
				field.WriteRune(c)
			}
			continue
		}
		switch c {
		case '"':
			inQuotes = true
		case ',':
			record = append(record, field.String())
			field.Reset()
		case '\n', '\r':
			if c == '\r' && i+1 < len(runes) && runes[i+1] == '\n' {
				i++
			}
			record = append(record, field.String())
			records = append(records, record)
			record = nil
			field.Reset()
		default:
			field.WriteRune(c)
		}
	}
	if field.Len() > 0 || len(record) > 0 {
		record = append(record, field.String())
		records = append(records, record)
	}
	var nonEmpty [][]string
	for _, r := range records {
		for _, cell := range r {
			if strings.TrimSpace(cell) != "" {
				nonEmpty = append(nonEmpty, r)
				break
			}
		}
	}
	if len(nonEmpty) == 0 {
		return nil, nil
	}
	for _, h := range nonEmpty[0] {
		header = append(header, strings.TrimSpace(h))
	}
	for _, cells := range nonEmpty[1:] {
		row := Row{}
		for i, name := range header {
			if i < len(cells) {
				row[name] = strings.TrimSpace(cells[i])
			} else {
				row[name] = ""
			}
		}
		rows = append(rows, row)
	}
	return header, rows
}
