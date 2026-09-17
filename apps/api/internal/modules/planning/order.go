package planning

import (
	"context"
	"encoding/base64"
	"fmt"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/db"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/httpx"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/outbox"
)

// CustomerOrder is the TypeScript CustomerOrder. Dates are calendar dates,
// never moments: requested_delivery_date decides whether an order is late.
type CustomerOrder struct {
	ID                    string  `json:"id"`
	TenantID              string  `json:"tenantId"`
	OrderNumber           string  `json:"orderNumber"`
	CustomerID            string  `json:"customerId"`
	PoNumber              *string `json:"poNumber,omitempty"`
	OrderChannel          string  `json:"orderChannel"`
	OrderDate             string  `json:"orderDate"`
	RequestedDeliveryDate string  `json:"requestedDeliveryDate"`
	CustomerPic           *string `json:"customerPic,omitempty"`
	DeliveryAddress       *string `json:"deliveryAddress,omitempty"`
	DockNumber            *string `json:"dockNumber,omitempty"`
	DocumentURL           *string `json:"documentUrl,omitempty"`
	Status                string  `json:"status"`
	StatusReason          *string `json:"statusReason,omitempty"`
	CreatedBy             *string `json:"createdBy,omitempty"`
	CreatedAt             *string `json:"createdAt,omitempty"`
	UpdatedAt             *string `json:"updatedAt,omitempty"`
}

// CustomerOrderLine is the TypeScript CustomerOrderLine.
type CustomerOrderLine struct {
	ID                    string  `json:"id"`
	TenantID              string  `json:"tenantId"`
	CustomerOrderID       string  `json:"customerOrderId"`
	ProductID             string  `json:"productId"`
	ModelType             *string `json:"modelType,omitempty"`
	OrderedQuantity       int     `json:"orderedQuantity"`
	Unit                  string  `json:"unit"`
	RequestedDeliveryDate *string `json:"requestedDeliveryDate,omitempty"`
	PlannedQuantity       int     `json:"plannedQuantity"`
	ProducedQuantity      int     `json:"producedQuantity"`
	LineNo                int     `json:"lineNo"`
	CreatedAt             *string `json:"createdAt,omitempty"`
	UpdatedAt             *string `json:"updatedAt,omitempty"`
}

// OrderDocument is one uploaded source document (MES-025).
type OrderDocument struct {
	ID              string  `json:"id"`
	TenantID        string  `json:"tenantId"`
	CustomerOrderID string  `json:"customerOrderId"`
	FileName        string  `json:"fileName"`
	ContentType     string  `json:"contentType"`
	SizeBytes       int     `json:"sizeBytes"`
	StorageURL      string  `json:"storageUrl"`
	UploadedBy      *string `json:"uploadedBy,omitempty"`
	UploadedAt      *string `json:"uploadedAt,omitempty"`
}

// OrderDetail is an order with its lines and documents.
type OrderDetail struct {
	CustomerOrder
	Lines     []CustomerOrderLine `json:"lines"`
	Documents []OrderDocument     `json:"documents"`
}

const orderColumns = `id, tenant_id, order_number, customer_id, po_number, order_channel, to_char(order_date, 'YYYY-MM-DD'), to_char(requested_delivery_date, 'YYYY-MM-DD'),
	customer_pic, delivery_address, dock_number, document_url, status, status_reason, created_by, created_at, updated_at`

// The same columns for the list query, which joins and so needs the alias.
const aliasedOrderColumns = `co.id, co.tenant_id, co.order_number, co.customer_id, co.po_number, co.order_channel, to_char(co.order_date, 'YYYY-MM-DD'),
	to_char(co.requested_delivery_date, 'YYYY-MM-DD'), co.customer_pic, co.delivery_address, co.dock_number, co.document_url, co.status, co.status_reason, co.created_by, co.created_at, co.updated_at`

const lineColumns = `id, tenant_id, customer_order_id, product_id, model_type, ordered_quantity, unit, to_char(requested_delivery_date, 'YYYY-MM-DD'),
	planned_quantity, produced_quantity, line_no, created_at, updated_at`

func scanOrder(row pgx.Row) (CustomerOrder, error) {
	var o CustomerOrder
	var channel, status *string
	var created, updated *time.Time
	if err := row.Scan(&o.ID, &o.TenantID, &o.OrderNumber, &o.CustomerID, &o.PoNumber, &channel, &o.OrderDate, &o.RequestedDeliveryDate,
		&o.CustomerPic, &o.DeliveryAddress, &o.DockNumber, &o.DocumentURL, &status, &o.StatusReason, &o.CreatedBy, &created, &updated); err != nil {
		return CustomerOrder{}, err
	}
	o.OrderChannel, o.Status = db.Deref(channel, "MANUAL"), db.Deref(status, "RECEIVED")
	o.CreatedAt, o.UpdatedAt = db.ISOPtr(created), db.ISOPtr(updated)
	return o, nil
}

func scanLine(row pgx.Row) (CustomerOrderLine, error) {
	var l CustomerOrderLine
	var created, updated *time.Time
	if err := row.Scan(&l.ID, &l.TenantID, &l.CustomerOrderID, &l.ProductID, &l.ModelType, &l.OrderedQuantity, &l.Unit, &l.RequestedDeliveryDate,
		&l.PlannedQuantity, &l.ProducedQuantity, &l.LineNo, &created, &updated); err != nil {
		return CustomerOrderLine{}, err
	}
	l.CreatedAt, l.UpdatedAt = db.ISOPtr(created), db.ISOPtr(updated)
	return l, nil
}

// OrderFilter narrows the order list.
type OrderFilter struct {
	Statuses                                                []string
	CustomerID, ProductID, DeliveryFrom, DeliveryTo, Search string
	Limit                                                   int
}

// OrderRepository is customer_order, customer_order_line and
// customer_order_document.
type OrderRepository struct{}

// List orders newest first (limit ≤ 2000).
func (OrderRepository) List(ctx context.Context, tx pgx.Tx, tenantID string, f OrderFilter) ([]CustomerOrder, error) {
	where, args := []string{"co.tenant_id = $1"}, []any{tenantID}
	add := func(clause string, v any) {
		args = append(args, v)
		where = append(where, fmt.Sprintf(clause, len(args)))
	}
	if len(f.Statuses) > 0 {
		add("co.status = ANY($%d)", f.Statuses)
	}
	if f.CustomerID != "" {
		add("co.customer_id = $%d", f.CustomerID)
	}
	if f.DeliveryFrom != "" {
		add("co.requested_delivery_date >= $%d::date", f.DeliveryFrom)
	}
	if f.DeliveryTo != "" {
		add("co.requested_delivery_date <= $%d::date", f.DeliveryTo)
	}
	if f.ProductID != "" {
		add("EXISTS (SELECT 1 FROM customer_order_line col WHERE col.customer_order_id = co.id AND col.product_id = $%d)", f.ProductID)
	}
	if f.Search != "" {
		args = append(args, "%"+strings.ToLower(f.Search)+"%")
		where = append(where, fmt.Sprintf("(LOWER(co.order_number) LIKE $%d OR LOWER(COALESCE(co.po_number, '')) LIKE $%d)", len(args), len(args)))
	}
	limit := f.Limit
	if limit <= 0 {
		limit = 500
	}
	if limit > 2000 {
		limit = 2000
	}
	args = append(args, limit)
	rows, err := tx.Query(ctx, `SELECT `+aliasedOrderColumns+` FROM customer_order co WHERE `+strings.Join(where, " AND ")+fmt.Sprintf(` ORDER BY co.order_date DESC, co.order_number DESC LIMIT $%d`, len(args)), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []CustomerOrder{}
	for rows.Next() {
		o, err := scanOrder(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

func orderOrNil(o CustomerOrder, err error) (*CustomerOrder, error) {
	if db.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &o, nil
}

// FindByID reads one order; nil when absent.
func (OrderRepository) FindByID(ctx context.Context, tx pgx.Tx, tenantID, id string) (*CustomerOrder, error) {
	return orderOrNil(scanOrder(tx.QueryRow(ctx, `SELECT `+orderColumns+` FROM customer_order WHERE tenant_id = $1 AND id = $2`, tenantID, id)))
}

// FindByIDForUpdate locks the row for the rest of the transaction.
func (OrderRepository) FindByIDForUpdate(ctx context.Context, tx pgx.Tx, tenantID, id string) (*CustomerOrder, error) {
	return orderOrNil(scanOrder(tx.QueryRow(ctx, `SELECT `+orderColumns+` FROM customer_order WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, tenantID, id)))
}

// Insert stores an order.
func (OrderRepository) Insert(ctx context.Context, tx pgx.Tx, o CustomerOrder) (CustomerOrder, error) {
	return scanOrder(tx.QueryRow(ctx, `INSERT INTO customer_order (id, tenant_id, order_number, customer_id, po_number, order_channel, order_date, requested_delivery_date,
			customer_pic, delivery_address, dock_number, document_url, status, created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8::date,$9,$10,$11,$12,$13,$14) RETURNING `+orderColumns,
		o.ID, o.TenantID, o.OrderNumber, o.CustomerID, o.PoNumber, o.OrderChannel, o.OrderDate, o.RequestedDeliveryDate, o.CustomerPic, o.DeliveryAddress, o.DockNumber, o.DocumentURL, o.Status, o.CreatedBy))
}

// OrderPatch is what an update may change.
type OrderPatch struct {
	CustomerID, PoNumber, OrderChannel, RequestedDeliveryDate, CustomerPic, DeliveryAddress, DockNumber, DocumentURL *string
}

// Update patches with COALESCE semantics.
func (OrderRepository) Update(ctx context.Context, tx pgx.Tx, tenantID, id string, p OrderPatch) (*CustomerOrder, error) {
	return orderOrNil(scanOrder(tx.QueryRow(ctx, `UPDATE customer_order SET customer_id = COALESCE($3, customer_id), po_number = COALESCE($4, po_number),
		order_channel = COALESCE($5, order_channel), requested_delivery_date = COALESCE($6::date, requested_delivery_date), customer_pic = COALESCE($7, customer_pic),
		delivery_address = COALESCE($8, delivery_address), dock_number = COALESCE($9, dock_number), document_url = COALESCE($10, document_url), updated_at = CURRENT_TIMESTAMP
		WHERE tenant_id = $1 AND id = $2 RETURNING `+orderColumns,
		tenantID, id, p.CustomerID, p.PoNumber, p.OrderChannel, p.RequestedDeliveryDate, p.CustomerPic, p.DeliveryAddress, p.DockNumber, p.DocumentURL)))
}

// UpdateStatus sets the status, keeping the reason when none is given.
func (OrderRepository) UpdateStatus(ctx context.Context, tx pgx.Tx, tenantID, id, status string, reason *string) (*CustomerOrder, error) {
	return orderOrNil(scanOrder(tx.QueryRow(ctx, `UPDATE customer_order SET status = $3, status_reason = COALESCE($4, status_reason), updated_at = CURRENT_TIMESTAMP
		WHERE tenant_id = $1 AND id = $2 RETURNING `+orderColumns, tenantID, id, status, reason)))
}

func collectLines(rows pgx.Rows, err error) ([]CustomerOrderLine, error) {
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []CustomerOrderLine{}
	for rows.Next() {
		l, err := scanLine(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// ListLines is an order's lines by line number.
func (OrderRepository) ListLines(ctx context.Context, tx pgx.Tx, tenantID, orderID string) ([]CustomerOrderLine, error) {
	return collectLines(tx.Query(ctx, `SELECT `+lineColumns+` FROM customer_order_line WHERE tenant_id = $1 AND customer_order_id = $2 ORDER BY line_no`, tenantID, orderID))
}

// ListLinesForOrders is the lines of several orders in one round trip.
func (OrderRepository) ListLinesForOrders(ctx context.Context, tx pgx.Tx, tenantID string, orderIDs []string) ([]CustomerOrderLine, error) {
	if len(orderIDs) == 0 {
		return []CustomerOrderLine{}, nil
	}
	return collectLines(tx.Query(ctx, `SELECT `+lineColumns+` FROM customer_order_line WHERE tenant_id = $1 AND customer_order_id = ANY($2) ORDER BY customer_order_id, line_no`, tenantID, orderIDs))
}

// FindLineByID reads one line; nil when absent.
func (OrderRepository) FindLineByID(ctx context.Context, tx pgx.Tx, tenantID, lineID string) (*CustomerOrderLine, error) {
	l, err := scanLine(tx.QueryRow(ctx, `SELECT `+lineColumns+` FROM customer_order_line WHERE tenant_id = $1 AND id = $2`, tenantID, lineID))
	if db.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &l, nil
}

// NextLineNo is MAX(line_no)+1.
func (OrderRepository) NextLineNo(ctx context.Context, tx pgx.Tx, tenantID, orderID string) (int, error) {
	var n int
	err := tx.QueryRow(ctx, `SELECT COALESCE(MAX(line_no), 0) + 1 FROM customer_order_line WHERE tenant_id = $1 AND customer_order_id = $2`, tenantID, orderID).Scan(&n)
	return n, err
}

// InsertLine stores a line.
func (OrderRepository) InsertLine(ctx context.Context, tx pgx.Tx, l CustomerOrderLine) (CustomerOrderLine, error) {
	return scanLine(tx.QueryRow(ctx, `INSERT INTO customer_order_line (id, tenant_id, customer_order_id, product_id, model_type, ordered_quantity, unit, requested_delivery_date,
			planned_quantity, produced_quantity, line_no)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8::date,$9,$10,$11) RETURNING `+lineColumns,
		l.ID, l.TenantID, l.CustomerOrderID, l.ProductID, l.ModelType, l.OrderedQuantity, l.Unit, l.RequestedDeliveryDate, l.PlannedQuantity, l.ProducedQuantity, l.LineNo))
}

// LinePatch is what a line update may change.
type LinePatch struct {
	OrderedQuantity                        *int
	Unit, ModelType, RequestedDeliveryDate *string
}

// UpdateLine patches a line.
func (OrderRepository) UpdateLine(ctx context.Context, tx pgx.Tx, tenantID, lineID string, p LinePatch) (*CustomerOrderLine, error) {
	l, err := scanLine(tx.QueryRow(ctx, `UPDATE customer_order_line SET ordered_quantity = COALESCE($3, ordered_quantity), unit = COALESCE($4, unit),
		model_type = COALESCE($5, model_type), requested_delivery_date = COALESCE($6::date, requested_delivery_date), updated_at = CURRENT_TIMESTAMP
		WHERE tenant_id = $1 AND id = $2 RETURNING `+lineColumns, tenantID, lineID, p.OrderedQuantity, p.Unit, p.ModelType, p.RequestedDeliveryDate))
	if db.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &l, nil
}

// DeleteLine removes a line.
func (OrderRepository) DeleteLine(ctx context.Context, tx pgx.Tx, tenantID, lineID string) (bool, error) {
	tag, err := tx.Exec(ctx, `DELETE FROM customer_order_line WHERE tenant_id = $1 AND id = $2`, tenantID, lineID)
	return tag.RowsAffected() > 0, err
}

// AddPlannedQuantity adds delta to a line's planned quantity.
func (OrderRepository) AddPlannedQuantity(ctx context.Context, tx pgx.Tx, tenantID, lineID string, delta int) error {
	_, err := tx.Exec(ctx, `UPDATE customer_order_line SET planned_quantity = planned_quantity + $3, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = $1 AND id = $2`, tenantID, lineID, delta)
	return err
}

// ListDocuments is an order's documents, newest first.
func (OrderRepository) ListDocuments(ctx context.Context, tx pgx.Tx, tenantID, orderID string) ([]OrderDocument, error) {
	rows, err := tx.Query(ctx, `SELECT id, tenant_id, customer_order_id, file_name, content_type, size_bytes, storage_url, uploaded_by, uploaded_at
		FROM customer_order_document WHERE tenant_id = $1 AND customer_order_id = $2 ORDER BY uploaded_at DESC, id`, tenantID, orderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []OrderDocument{}
	for rows.Next() {
		var d OrderDocument
		var uploaded *time.Time
		if err := rows.Scan(&d.ID, &d.TenantID, &d.CustomerOrderID, &d.FileName, &d.ContentType, &d.SizeBytes, &d.StorageURL, &d.UploadedBy, &uploaded); err != nil {
			return nil, err
		}
		d.UploadedAt = db.ISOPtr(uploaded)
		out = append(out, d)
	}
	return out, rows.Err()
}

// InsertDocument stores a document row.
func (OrderRepository) InsertDocument(ctx context.Context, tx pgx.Tx, d OrderDocument) error {
	_, err := tx.Exec(ctx, `INSERT INTO customer_order_document (id, tenant_id, customer_order_id, file_name, content_type, size_bytes, storage_url, uploaded_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, d.ID, d.TenantID, d.CustomerOrderID, d.FileName, d.ContentType, d.SizeBytes, d.StorageURL, d.UploadedBy)
	return err
}

// --- Documents storage (MES-025-3) -------------------------------------------

// Extensions that may be written, keyed by the content types we accept.
var documentExtensions = map[string]string{
	"application/pdf": ".pdf", "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx", "application/vnd.ms-excel": ".xls", "text/csv": ".csv",
}

var allowedDocumentTypes = []string{"application/pdf", "image/png", "image/jpeg", "image/webp",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-excel", "text/csv"}

const maxDocumentBytes = 10 * 1024 * 1024

func documentKey(tenantID, objectID string) (string, error) {
	if tenantID == "" || strings.Contains(tenantID, "/") || strings.Contains(tenantID, "..") || objectID == "" || strings.Contains(objectID, "/") || strings.Contains(objectID, "..") {
		return "", httpx.Validation("Lokasi dokumen tidak valid.")
	}
	return tenantID + "/" + objectID, nil
}

// ContentTypeOf is the content type an object id implies, for the download.
func ContentTypeOf(objectID string) string {
	ext := strings.ToLower(path.Ext(objectID))
	for ct, e := range documentExtensions {
		if e == ext {
			return ct
		}
	}
	return "application/octet-stream"
}

// --- Service ------------------------------------------------------------------

// OrderLineInput is one line of a new order.
type OrderLineInput struct {
	ProductID                              string
	OrderedQuantity                        int
	Unit, ModelType, RequestedDeliveryDate *string
}

// OrderInput is a new order.
type OrderInput struct {
	CustomerID, OrderChannel, RequestedDeliveryDate                            string
	OrderDate, PoNumber, CustomerPic, DeliveryAddress, DockNumber, DocumentURL *string
	Lines                                                                      []OrderLineInput
}

func (s *Service) orderDetail(ctx context.Context, tx pgx.Tx, tenantID, id string) (OrderDetail, error) {
	order, err := s.orders.FindByID(ctx, tx, tenantID, id)
	if err != nil {
		return OrderDetail{}, err
	}
	if order == nil {
		return OrderDetail{}, httpx.NotFound("Customer Order tidak ditemukan.")
	}
	lines, err := s.orders.ListLines(ctx, tx, tenantID, id)
	if err != nil {
		return OrderDetail{}, err
	}
	docs, err := s.orders.ListDocuments(ctx, tx, tenantID, id)
	if err != nil {
		return OrderDetail{}, err
	}
	return OrderDetail{CustomerOrder: *order, Lines: lines, Documents: docs}, nil
}

// Orders lists orders with their lines.
func (s *Service) Orders(ctx context.Context, tenantID string, f OrderFilter) ([]OrderDetail, error) {
	out := []OrderDetail{}
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		orders, err := s.orders.List(ctx, tx, tenantID, f)
		if err != nil {
			return err
		}
		if len(orders) == 0 {
			return nil
		}
		ids := make([]string, len(orders))
		for i, o := range orders {
			ids[i] = o.ID
		}
		lines, err := s.orders.ListLinesForOrders(ctx, tx, tenantID, ids)
		if err != nil {
			return err
		}
		for _, o := range orders {
			d := OrderDetail{CustomerOrder: o, Lines: []CustomerOrderLine{}, Documents: []OrderDocument{}}
			for _, l := range lines {
				if l.CustomerOrderID == o.ID {
					d.Lines = append(d.Lines, l)
				}
			}
			out = append(out, d)
		}
		return nil
	})
	return out, err
}

// Order reads one order with lines and documents.
func (s *Service) Order(ctx context.Context, tenantID, id string) (OrderDetail, error) {
	var out OrderDetail
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.orderDetail(ctx, tx, tenantID, id)
		return err
	})
	return out, err
}

func inactiveCustomer(code string) error {
	return httpx.Validation("Customer tidak aktif tidak dapat dipilih untuk order baru.", httpx.FieldError{Field: "customerId", Code: "INACTIVE", Message: fmt.Sprintf("Customer %s tidak aktif.", code)})
}

// CreateOrder is MES-021: the order is where real demand enters the system.
func (s *Service) CreateOrder(ctx context.Context, tenantID string, in OrderInput, actorID string) (OrderDetail, error) {
	var out OrderDetail
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		customer, err := s.customers.FindByID(ctx, tx, tenantID, in.CustomerID)
		if err != nil {
			return err
		}
		if customer == nil {
			return httpx.NotFound("Customer tidak ditemukan.")
		}
		if customer.Status != "ACTIVE" {
			return inactiveCustomer(customer.Code)
		}
		orderDate := db.Deref(in.OrderDate, db.ISO(s.now())[:10])
		number, err := NextNumber(ctx, tx, tenantID, "customer_order", "order_number", CustomerOrderPrefix(orderDate), 3)
		if err != nil {
			return err
		}
		customerPic := in.CustomerPic
		if customerPic == nil {
			customerPic = customer.PicName
		}
		// Falling back to the customer's registered address and dock means the
		// common case needs no retyping, while a one-off delivery can still
		// override it on the order.
		address := in.DeliveryAddress
		if address == nil {
			address = customer.DeliveryAddress
		}
		dock := in.DockNumber
		if dock == nil {
			dock = customer.DockNumber
		}
		order, err := s.orders.Insert(ctx, tx, CustomerOrder{ID: "co-" + uuid.NewString(), TenantID: tenantID, OrderNumber: number, CustomerID: in.CustomerID, PoNumber: in.PoNumber,
			OrderChannel: in.OrderChannel, OrderDate: orderDate, RequestedDeliveryDate: in.RequestedDeliveryDate, CustomerPic: customerPic, DeliveryAddress: address, DockNumber: dock,
			DocumentURL: in.DocumentURL, Status: "RECEIVED", CreatedBy: &actorID})
		if err != nil {
			return err
		}
		lines := []CustomerOrderLine{}
		for i, li := range in.Lines {
			line, err := s.insertLine(ctx, tx, tenantID, order.ID, li, i+1)
			if err != nil {
				return err
			}
			lines = append(lines, line)
		}
		if err := s.auditIn(ctx, tx, tenantID, actorID, "", "customer_order", order.ID, "CREATE", nil, OrderDetail{CustomerOrder: order, Lines: lines}); err != nil {
			return err
		}
		if err := s.outbox.Publish(ctx, tx, tenantID, outbox.Event{Type: EventCustomerOrderReceived, AggregateType: "customer_order", AggregateID: order.ID,
			Payload: map[string]any{"orderNumber": order.OrderNumber, "customerId": order.CustomerID, "orderChannel": order.OrderChannel, "requestedDeliveryDate": order.RequestedDeliveryDate, "lineCount": len(lines)}}); err != nil {
			return err
		}
		out = OrderDetail{CustomerOrder: order, Lines: lines, Documents: []OrderDocument{}}
		return nil
	})
	return out, err
}

// UpdateOrder patches an order that is still open.
func (s *Service) UpdateOrder(ctx context.Context, tenantID, id string, p OrderPatch, actorID string) (OrderDetail, error) {
	var out OrderDetail
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		before, err := s.orders.FindByID(ctx, tx, tenantID, id)
		if err != nil {
			return err
		}
		if before == nil {
			return httpx.NotFound("Customer Order tidak ditemukan.")
		}
		if before.Status == "CANCELLED" || before.Status == "COMPLETED" {
			return httpx.InvalidState(fmt.Sprintf("Customer Order berstatus %s tidak dapat diubah.", before.Status))
		}
		if p.CustomerID != nil && *p.CustomerID != "" && *p.CustomerID != before.CustomerID {
			customer, err := s.customers.FindByID(ctx, tx, tenantID, *p.CustomerID)
			if err != nil {
				return err
			}
			if customer == nil {
				return httpx.NotFound("Customer tidak ditemukan.")
			}
			if customer.Status != "ACTIVE" {
				return httpx.Validation("Customer tidak aktif tidak dapat dipilih.", httpx.FieldError{Field: "customerId", Code: "INACTIVE", Message: fmt.Sprintf("Customer %s tidak aktif.", customer.Code)})
			}
		}
		updated, err := s.orders.Update(ctx, tx, tenantID, id, p)
		if err != nil {
			return err
		}
		if updated == nil {
			return httpx.NotFound("Customer Order tidak ditemukan.")
		}
		if err := s.auditIn(ctx, tx, tenantID, actorID, "", "customer_order", id, "UPDATE", before, updated); err != nil {
			return err
		}
		out, err = s.orderDetail(ctx, tx, tenantID, id)
		return err
	})
	return out, err
}

func (s *Service) insertLine(ctx context.Context, tx pgx.Tx, tenantID, orderID string, in OrderLineInput, lineNo int) (CustomerOrderLine, error) {
	product, err := s.reference.FindProduct(ctx, tx, tenantID, in.ProductID)
	if err != nil {
		return CustomerOrderLine{}, err
	}
	if product == nil {
		return CustomerOrderLine{}, httpx.Validation("Product pada order line tidak ditemukan.", httpx.FieldError{Field: "productId", Code: "NOT_FOUND", Message: fmt.Sprintf("Product %s tidak ditemukan.", in.ProductID)})
	}
	if product.Status != "ACTIVE" {
		return CustomerOrderLine{}, httpx.Validation("Product tidak aktif tidak dapat dipesan.", httpx.FieldError{Field: "productId", Code: "INACTIVE", Message: fmt.Sprintf("Product %s berstatus %s.", product.SKU, product.Status)})
	}
	if in.OrderedQuantity <= 0 {
		return CustomerOrderLine{}, httpx.Validation("Ordered quantity harus bilangan bulat lebih dari nol.", httpx.FieldError{Field: "orderedQuantity", Code: "OUT_OF_RANGE", Message: fmt.Sprintf("Ordered quantity %d tidak valid.", in.OrderedQuantity)})
	}
	return s.orders.InsertLine(ctx, tx, CustomerOrderLine{ID: "col-" + uuid.NewString(), TenantID: tenantID, CustomerOrderID: orderID, ProductID: in.ProductID, ModelType: in.ModelType,
		OrderedQuantity: in.OrderedQuantity, Unit: db.Deref(in.Unit, product.Unit), RequestedDeliveryDate: in.RequestedDeliveryDate, LineNo: lineNo})
}

// AddLine appends a line while the order is RECEIVED (MES-022).
func (s *Service) AddLine(ctx context.Context, tenantID, orderID string, in OrderLineInput, actorID string) (CustomerOrderLine, error) {
	var out CustomerOrderLine
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		order, err := s.orders.FindByID(ctx, tx, tenantID, orderID)
		if err != nil {
			return err
		}
		if order == nil {
			return httpx.NotFound("Customer Order tidak ditemukan.")
		}
		if order.Status != "RECEIVED" {
			return httpx.InvalidState(fmt.Sprintf("Order line hanya dapat ditambahkan selama order berstatus RECEIVED, saat ini %s.", order.Status))
		}
		lineNo, err := s.orders.NextLineNo(ctx, tx, tenantID, orderID)
		if err != nil {
			return err
		}
		out, err = s.insertLine(ctx, tx, tenantID, orderID, in, lineNo)
		if err != nil {
			return err
		}
		return s.auditIn(ctx, tx, tenantID, actorID, "", "customer_order_line", out.ID, "CREATE", nil, out)
	})
	return out, err
}

// UpdateLine patches a line, refusing to drop ordered below planned.
func (s *Service) UpdateLine(ctx context.Context, tenantID, orderID, lineID string, p LinePatch, actorID string) (CustomerOrderLine, error) {
	var out CustomerOrderLine
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		before, err := s.orders.FindLineByID(ctx, tx, tenantID, lineID)
		if err != nil {
			return err
		}
		if before == nil || before.CustomerOrderID != orderID {
			return httpx.NotFound("Order line tidak ditemukan.")
		}
		if p.OrderedQuantity != nil && *p.OrderedQuantity < before.PlannedQuantity {
			return httpx.Validation("Ordered quantity tidak boleh di bawah planned quantity.", httpx.FieldError{Field: "orderedQuantity", Code: "OUT_OF_RANGE",
				Message: fmt.Sprintf("Ordered quantity %d lebih kecil dari planned quantity %d yang sudah masuk Production Plan.", *p.OrderedQuantity, before.PlannedQuantity)})
		}
		updated, err := s.orders.UpdateLine(ctx, tx, tenantID, lineID, p)
		if err != nil {
			return err
		}
		if updated == nil {
			return httpx.NotFound("Order line tidak ditemukan.")
		}
		out = *updated
		return s.auditIn(ctx, tx, tenantID, actorID, "", "customer_order_line", lineID, "UPDATE", before, updated)
	})
	return out, err
}

// RemoveLine deletes a line that has not been planned.
func (s *Service) RemoveLine(ctx context.Context, tenantID, orderID, lineID, actorID string) error {
	return s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		before, err := s.orders.FindLineByID(ctx, tx, tenantID, lineID)
		if err != nil {
			return err
		}
		if before == nil || before.CustomerOrderID != orderID {
			return httpx.NotFound("Order line tidak ditemukan.")
		}
		if before.PlannedQuantity > 0 {
			return httpx.InvalidState(fmt.Sprintf("Order line tidak dapat dihapus: %d pcs sudah masuk Production Plan.", before.PlannedQuantity))
		}
		if _, err := s.orders.DeleteLine(ctx, tx, tenantID, lineID); err != nil {
			return err
		}
		return s.auditIn(ctx, tx, tenantID, actorID, "", "customer_order_line", lineID, "DELETE", before, nil)
	})
}

// OrderLines lists an order's lines.
func (s *Service) OrderLines(ctx context.Context, tenantID, orderID string) ([]CustomerOrderLine, error) {
	var out []CustomerOrderLine
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.orders.ListLines(ctx, tx, tenantID, orderID)
		return err
	})
	return out, err
}

// DocumentInput is an upload: base64 content, or an object stored out of band.
type DocumentInput struct {
	FileName, ContentType string
	SizeBytes             int
	Content, StorageURL   *string
}

// AttachDocument stores the bytes first, then the row, so a row can never
// point at bytes that are not there (MES-025).
func (s *Service) AttachDocument(ctx context.Context, tenantID, orderID string, in DocumentInput, actorID string) (OrderDocument, error) {
	var fields []httpx.FieldError
	if indexOf(allowedDocumentTypes, in.ContentType) < 0 {
		fields = append(fields, httpx.FieldError{Field: "contentType", Code: "UNSUPPORTED_TYPE", Message: fmt.Sprintf("Tipe file %s tidak didukung. Gunakan: %s.", in.ContentType, strings.Join(allowedDocumentTypes, ", "))})
	}
	if in.SizeBytes <= 0 {
		fields = append(fields, httpx.FieldError{Field: "sizeBytes", Code: "REQUIRED", Message: "Ukuran file tidak valid."})
	} else if in.SizeBytes > maxDocumentBytes {
		fields = append(fields, httpx.FieldError{Field: "sizeBytes", Code: "TOO_LARGE", Message: fmt.Sprintf("Ukuran file %.1f MB melebihi batas %d MB.", float64(in.SizeBytes)/1024/1024, maxDocumentBytes/1024/1024)})
	}
	if len(fields) > 0 {
		return OrderDocument{}, httpx.Validation("Dokumen order tidak dapat diunggah.", fields...)
	}
	if (in.Content == nil || *in.Content == "") && (in.StorageURL == nil || *in.StorageURL == "") {
		return OrderDocument{}, httpx.Validation("Dokumen order tidak dapat diunggah.", httpx.FieldError{Field: "content", Code: "REQUIRED", Message: "Isi dokumen (base64) wajib dikirim."})
	}
	documentID := "codoc-" + uuid.NewString()
	storageURL, size := db.Deref(in.StorageURL, ""), in.SizeBytes
	if in.Content != nil && *in.Content != "" {
		ext := documentExtensions[in.ContentType]
		raw, err := base64.StdEncoding.DecodeString(*in.Content)
		if err != nil || len(raw) == 0 {
			// Node's Buffer.from(…, 'base64') never throws; it silently
			// truncates, so an empty result was its only signal.
			if raw2, err2 := base64.RawStdEncoding.DecodeString(strings.TrimRight(*in.Content, "=")); err2 == nil && len(raw2) > 0 {
				raw = raw2
			} else {
				return OrderDocument{}, httpx.Validation("Isi dokumen tidak dapat dibaca.", httpx.FieldError{Field: "content", Code: "INVALID_FORMAT", Message: "Konten harus base64 yang valid."})
			}
		}
		objectID := documentID + ext
		key, err := documentKey(tenantID, objectID)
		if err != nil {
			return OrderDocument{}, err
		}
		written, err := s.store.Put(ctx, key, raw, in.ContentType)
		if err != nil {
			return OrderDocument{}, err
		}
		// A URL the API serves, not a storage location: the console must never
		// learn where the bytes live, so the backend can change under it.
		storageURL, size = "/api/v1/customer-orders/documents/"+objectID+"/content", written
	}
	var out OrderDocument
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		order, err := s.orders.FindByID(ctx, tx, tenantID, orderID)
		if err != nil {
			return err
		}
		if order == nil {
			return httpx.NotFound("Customer Order tidak ditemukan.")
		}
		doc := OrderDocument{ID: documentID, TenantID: tenantID, CustomerOrderID: orderID, FileName: in.FileName, ContentType: in.ContentType, SizeBytes: size, StorageURL: storageURL, UploadedBy: &actorID}
		if err := s.orders.InsertDocument(ctx, tx, doc); err != nil {
			return err
		}
		stored, err := s.orders.ListDocuments(ctx, tx, tenantID, orderID)
		if err != nil {
			return err
		}
		out = doc
		for _, d := range stored {
			if d.ID == documentID {
				out = d
			}
		}
		next := map[string]any{"id": out.ID, "tenantId": out.TenantID, "customerOrderId": out.CustomerOrderID, "fileName": out.FileName, "contentType": out.ContentType,
			"sizeBytes": out.SizeBytes, "storageUrl": out.StorageURL, "uploadedBy": out.UploadedBy, "uploadedAt": out.UploadedAt, "customerOrderNumber": order.OrderNumber}
		return s.auditIn(ctx, tx, tenantID, actorID, "", "customer_order_document", out.ID, "CREATE", nil, next)
	})
	return out, err
}

// OrderDocuments lists an order's documents.
func (s *Service) OrderDocuments(ctx context.Context, tenantID, orderID string) ([]OrderDocument, error) {
	var out []OrderDocument
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.orders.ListDocuments(ctx, tx, tenantID, orderID)
		return err
	})
	return out, err
}

// DocumentContent reads a stored object back; the route guards who may ask.
func (s *Service) DocumentContent(ctx context.Context, tenantID, objectID string) ([]byte, string, error) {
	key, err := documentKey(tenantID, objectID)
	if err != nil {
		return nil, "", err
	}
	b, err := s.store.Get(ctx, key)
	if err != nil {
		return nil, "", err
	}
	if b == nil {
		return nil, "", httpx.NotFound("Dokumen tidak ditemukan pada penyimpanan.")
	}
	return b, ContentTypeOf(objectID), nil
}

// RemoveDocument deletes the row and then the object; an already-absent
// object must not stop the row being deleted.
func (s *Service) RemoveDocument(ctx context.Context, tenantID, documentID, actorID string) error {
	return s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var storageURL *string
		err := tx.QueryRow(ctx, `SELECT storage_url FROM customer_order_document WHERE tenant_id = $1 AND id = $2`, tenantID, documentID).Scan(&storageURL)
		if err != nil && !db.IsNoRows(err) {
			return err
		}
		tag, err := tx.Exec(ctx, `DELETE FROM customer_order_document WHERE tenant_id = $1 AND id = $2`, tenantID, documentID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return httpx.NotFound("Dokumen tidak ditemukan.")
		}
		if storageURL != nil {
			parts := strings.Split(*storageURL, "/")
			if len(parts) >= 2 {
				if key, err := documentKey(tenantID, parts[len(parts)-2]); err == nil {
					_ = s.store.Remove(ctx, key)
				}
			}
		}
		return s.auditIn(ctx, tx, tenantID, actorID, "", "customer_order_document", documentID, "DELETE", nil, nil)
	})
}

// --- Status (MES-026) ---------------------------------------------------------

// derivationFacts reads, in two round trips, the aggregates status
// derivation runs on. Work Orders reach the order through the plan line,
// never by storing a customer id (ADR-22).
func (s *Service) derivationFacts(ctx context.Context, tx pgx.Tx, tenantID, orderID string) (DerivationFacts, error) {
	var f DerivationFacts
	if err := tx.QueryRow(ctx, `SELECT COUNT(*), COUNT(*) FILTER (WHERE col.planned_quantity >= col.ordered_quantity), COUNT(*) FILTER (WHERE col.produced_quantity >= col.ordered_quantity)
		FROM customer_order_line col WHERE col.tenant_id = $1 AND col.customer_order_id = $2`, tenantID, orderID).Scan(&f.LineCount, &f.FullyPlannedLines, &f.FullyProducedLines); err != nil {
		return f, err
	}
	err := tx.QueryRow(ctx, `SELECT COUNT(*) FILTER (WHERE wo.status IN ('IN_PRODUCTION', 'COMPLETED')), COUNT(*)
		FROM production_plan_demand ppd JOIN work_order wo ON wo.production_plan_line_id = ppd.production_plan_line_id
		WHERE ppd.tenant_id = $1 AND ppd.customer_order_id = $2`, tenantID, orderID).Scan(&f.WorkOrdersInProduction, &f.WorkOrderCount)
	return f, err
}

// RefreshStatusIn recomputes an order's derived status inside a transaction.
func (s *Service) RefreshStatusIn(ctx context.Context, tx pgx.Tx, tenantID, orderID, actorID string) (*CustomerOrder, error) {
	if actorID == "" {
		actorID = "system"
	}
	order, err := s.orders.FindByIDForUpdate(ctx, tx, tenantID, orderID)
	if err != nil || order == nil {
		return nil, err
	}
	facts, err := s.derivationFacts(ctx, tx, tenantID, orderID)
	if err != nil {
		return nil, err
	}
	next := DeriveCustomerOrderStatus(order.Status, facts)
	if next == order.Status {
		return order, nil
	}
	updated, err := s.orders.UpdateStatus(ctx, tx, tenantID, orderID, next, nil)
	if err != nil {
		return nil, err
	}
	if err := s.auditIn(ctx, tx, tenantID, actorID, "SYSTEM", "customer_order", orderID, "STATUS_DERIVED", map[string]any{"status": order.Status}, map[string]any{"status": next, "facts": facts}); err != nil {
		return nil, err
	}
	if err := s.outbox.Publish(ctx, tx, tenantID, outbox.Event{Type: EventCustomerOrderStatusChanged, AggregateType: "customer_order", AggregateID: orderID,
		Payload: map[string]any{"orderNumber": order.OrderNumber, "previousStatus": order.Status, "newStatus": next}}); err != nil {
		return nil, err
	}
	return updated, nil
}

// RecomputeStatus is the public entry point, opening its own transaction.
func (s *Service) RecomputeStatus(ctx context.Context, tenantID, orderID string) (*CustomerOrder, error) {
	var out *CustomerOrder
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.RefreshStatusIn(ctx, tx, tenantID, orderID, "")
		return err
	})
	return out, err
}

// CancelOrder refuses while any Work Order serving the order is running.
func (s *Service) CancelOrder(ctx context.Context, tenantID, orderID, reason, actorID string) (CustomerOrder, error) {
	if strings.TrimSpace(reason) == "" {
		return CustomerOrder{}, httpx.Validation("Alasan pembatalan wajib diisi.", httpx.FieldError{Field: "reason", Code: "REQUIRED", Message: "Alasan pembatalan wajib diisi."})
	}
	var out CustomerOrder
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		order, err := s.orders.FindByIDForUpdate(ctx, tx, tenantID, orderID)
		if err != nil {
			return err
		}
		if order == nil {
			return httpx.NotFound("Customer Order tidak ditemukan.")
		}
		facts, err := s.derivationFacts(ctx, tx, tenantID, orderID)
		if err != nil {
			return err
		}
		if err := AssertCancellable(order.Status, facts); err != nil {
			return err
		}
		updated, err := s.orders.UpdateStatus(ctx, tx, tenantID, orderID, "CANCELLED", &reason)
		if err != nil {
			return err
		}
		if updated == nil {
			return httpx.NotFound("Customer Order tidak ditemukan.")
		}
		out = *updated
		if err := s.auditIn(ctx, tx, tenantID, actorID, "", "customer_order", orderID, "CANCEL", map[string]any{"status": order.Status}, map[string]any{"status": "CANCELLED", "reason": reason}); err != nil {
			return err
		}
		return s.outbox.Publish(ctx, tx, tenantID, outbox.Event{Type: EventCustomerOrderCancelled, AggregateType: "customer_order", AggregateID: orderID,
			Payload: map[string]any{"orderNumber": order.OrderNumber, "previousStatus": order.Status, "newStatus": "CANCELLED", "reason": reason}})
	})
	return out, err
}

// SetLogisticsStatus is the three statuses the MVP leaves to a human.
func (s *Service) SetLogisticsStatus(ctx context.Context, tenantID, orderID, status, actorID string) (CustomerOrder, error) {
	if indexOf(ManualLogisticsStatuses, status) < 0 {
		return CustomerOrder{}, httpx.Validation(fmt.Sprintf("Status %s diturunkan sistem dari fakta produksi dan tidak dapat diset manual. Hanya %s yang manual.", status, strings.Join(ManualLogisticsStatuses, ", ")))
	}
	var out CustomerOrder
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		order, err := s.orders.FindByIDForUpdate(ctx, tx, tenantID, orderID)
		if err != nil {
			return err
		}
		if order == nil {
			return httpx.NotFound("Customer Order tidak ditemukan.")
		}
		if order.Status == "CANCELLED" {
			return httpx.InvalidState("Customer Order yang dibatalkan tidak dapat diubah statusnya.")
		}
		if order.Status != "PRODUCED" && indexOf(ManualLogisticsStatuses, order.Status) < 0 {
			return httpx.InvalidState(fmt.Sprintf("Status logistik hanya dapat diset setelah order PRODUCED, saat ini %s.", order.Status))
		}
		updated, err := s.orders.UpdateStatus(ctx, tx, tenantID, orderID, status, nil)
		if err != nil {
			return err
		}
		if updated == nil {
			return httpx.NotFound("Customer Order tidak ditemukan.")
		}
		out = *updated
		return s.auditIn(ctx, tx, tenantID, actorID, "", "customer_order", orderID, "STATUS_SET", map[string]any{"status": order.Status}, map[string]any{"status": status})
	})
	return out, err
}

// --- Routes -------------------------------------------------------------------

var orderChannels = []string{"KANBAN_CARD", "EMAIL", "INVOICE", "PO_DOCUMENT", "MANUAL"}
var orderStatuses = []string{"RECEIVED", "PLANNED", "IN_PRODUCTION", "PRODUCED", "READY_TO_SHIP", "SHIPPED", "COMPLETED", "CANCELLED"}

func dateOnly(s *string) *string {
	if s == nil {
		return nil
	}
	d := *s
	if len(d) > 10 {
		d = d[:10]
	}
	return &d
}

// parseOrderLine validates one line, collecting every field error at once
// so the form can show a message beside each bad input (MES-023).
func parseOrderLine(raw any, index int) (OrderLineInput, error) {
	m, ok := raw.(map[string]any)
	if !ok {
		return OrderLineInput{}, httpx.Validation("Order line tidak valid.", httpx.FieldError{Field: fmt.Sprintf("lines[%d]", index), Code: "INVALID_TYPE", Message: "Order line harus berupa objek."})
	}
	v := httpx.Validate(m)
	productID := v.String("productId", httpx.Opt{})
	quantity := v.Int("orderedQuantity", httpx.Opt{Min: httpx.Min(1)})
	in := OrderLineInput{Unit: v.String("unit", httpx.Opt{Optional: true, Max: httpx.Max(32)}), ModelType: v.String("modelType", httpx.Opt{Optional: true, Max: httpx.Max(64)}),
		RequestedDeliveryDate: dateOnly(v.ISODate("requestedDeliveryDate", httpx.Opt{Optional: true}))}
	if err := v.DoneWith(fmt.Sprintf("Order line %d tidak valid.", index+1)); err != nil {
		return OrderLineInput{}, err
	}
	in.ProductID, in.OrderedQuantity = *productID, *quantity
	return in, nil
}

func (h *handler) mountOrders(r chi.Router) {
	r.Get("/customer-orders", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		q := r.URL.Query()
		f := OrderFilter{CustomerID: q.Get("customerId"), ProductID: q.Get("productId"), DeliveryFrom: q.Get("deliveryFrom"), DeliveryTo: q.Get("deliveryTo"), Search: q.Get("search")}
		if raw := q.Get("status"); raw != "" {
			f.Statuses = []string{}
			for _, s := range strings.Split(raw, ",") {
				if indexOf(orderStatuses, s) >= 0 {
					f.Statuses = append(f.Statuses, s)
				}
			}
		}
		list, err := h.svc.Orders(r.Context(), h.tenant(r), f)
		if err != nil {
			return err
		}
		return httpx.OK(w, list)
	}))

	// Registered before /customer-orders/{id} would match it, and scoped to
	// the caller's tenant — the object id alone is not authorisation.
	r.Get("/customer-orders/documents/{objectId}/content", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, contentType, err := h.svc.DocumentContent(r.Context(), h.tenant(r), chi.URLParam(r, "objectId"))
		if err != nil {
			return err
		}
		w.Header().Set("Content-Type", contentType)
		w.Header().Set("Content-Length", fmt.Sprint(len(body)))
		w.Header().Set("Cache-Control", "private, max-age=300")
		w.WriteHeader(http.StatusOK)
		_, err = w.Write(body)
		return err
	}))

	r.Get("/customer-orders/{id}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		d, err := h.svc.Order(r.Context(), h.tenant(r), chi.URLParam(r, "id"))
		if err != nil {
			return err
		}
		return httpx.OK(w, d)
	}))

	r.Post("/customer-orders", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		customerID := v.String("customerId", httpx.Opt{})
		// Order Channel is mandatory: §45 makes it the record of where the
		// demand came from.
		channel := v.OneOf("orderChannel", orderChannels, httpx.Opt{})
		delivery := v.ISODate("requestedDeliveryDate", httpx.Opt{})
		in := OrderInput{OrderDate: dateOnly(v.ISODate("orderDate", httpx.Opt{Optional: true})), PoNumber: v.String("poNumber", httpx.Opt{Optional: true, Max: httpx.Max(64)}),
			CustomerPic: v.String("customerPic", httpx.Opt{Optional: true, Max: httpx.Max(255)}), DeliveryAddress: v.OptStr("deliveryAddress"),
			DockNumber: v.String("dockNumber", httpx.Opt{Optional: true, Max: httpx.Max(64)}), DocumentURL: v.OptStr("documentUrl")}
		rawLines, hasLines := body["lines"]
		var lineItems []any
		if hasLines && rawLines != nil {
			items, ok := rawLines.([]any)
			if !ok {
				v.Reject("lines", "INVALID_TYPE", "lines harus berupa daftar order line.")
			}
			lineItems = items
		}
		if err := v.Done(); err != nil {
			return err
		}
		for i, raw := range lineItems {
			line, err := parseOrderLine(raw, i)
			if err != nil {
				return err
			}
			in.Lines = append(in.Lines, line)
		}
		in.CustomerID, in.OrderChannel, in.RequestedDeliveryDate = *customerID, *channel, *dateOnly(delivery)
		created, err := h.svc.CreateOrder(r.Context(), h.tenant(r), in, actorOf(r))
		if err != nil {
			return err
		}
		return httpx.Created(w, created)
	}))

	r.Patch("/customer-orders/{id}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		p := OrderPatch{CustomerID: v.OptStr("customerId"), OrderChannel: v.OneOf("orderChannel", orderChannels, httpx.Opt{Optional: true}),
			RequestedDeliveryDate: dateOnly(v.ISODate("requestedDeliveryDate", httpx.Opt{Optional: true})), PoNumber: v.String("poNumber", httpx.Opt{Optional: true, Max: httpx.Max(64)}),
			CustomerPic: v.String("customerPic", httpx.Opt{Optional: true, Max: httpx.Max(255)}), DeliveryAddress: v.OptStr("deliveryAddress"),
			DockNumber: v.String("dockNumber", httpx.Opt{Optional: true, Max: httpx.Max(64)}), DocumentURL: v.OptStr("documentUrl")}
		if err := v.Done(); err != nil {
			return err
		}
		updated, err := h.svc.UpdateOrder(r.Context(), h.tenant(r), chi.URLParam(r, "id"), p, actorOf(r))
		if err != nil {
			return err
		}
		return httpx.OK(w, updated)
	}))

	r.Get("/customer-orders/{id}/lines", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		list, err := h.svc.OrderLines(r.Context(), h.tenant(r), chi.URLParam(r, "id"))
		if err != nil {
			return err
		}
		return httpx.OK(w, list)
	}))

	r.Post("/customer-orders/{id}/lines", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		line, err := parseOrderLine(body, 0)
		if err != nil {
			return err
		}
		created, err := h.svc.AddLine(r.Context(), h.tenant(r), chi.URLParam(r, "id"), line, actorOf(r))
		if err != nil {
			return err
		}
		return httpx.Created(w, created)
	}))

	r.Patch("/customer-orders/{id}/lines/{lineId}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		p := LinePatch{OrderedQuantity: v.Int("orderedQuantity", httpx.Opt{Optional: true, Min: httpx.Min(1)}), Unit: v.String("unit", httpx.Opt{Optional: true, Max: httpx.Max(32)}),
			ModelType: v.String("modelType", httpx.Opt{Optional: true, Max: httpx.Max(64)}), RequestedDeliveryDate: dateOnly(v.ISODate("requestedDeliveryDate", httpx.Opt{Optional: true}))}
		if err := v.Done(); err != nil {
			return err
		}
		updated, err := h.svc.UpdateLine(r.Context(), h.tenant(r), chi.URLParam(r, "id"), chi.URLParam(r, "lineId"), p, actorOf(r))
		if err != nil {
			return err
		}
		return httpx.OK(w, updated)
	}))

	r.Delete("/customer-orders/{id}/lines/{lineId}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		if err := h.svc.RemoveLine(r.Context(), h.tenant(r), chi.URLParam(r, "id"), chi.URLParam(r, "lineId"), actorOf(r)); err != nil {
			return err
		}
		return httpx.OK(w, map[string]any{"success": true, "message": "Order line dihapus."})
	}))

	r.Get("/customer-orders/{id}/documents", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		list, err := h.svc.OrderDocuments(r.Context(), h.tenant(r), chi.URLParam(r, "id"))
		if err != nil {
			return err
		}
		return httpx.OK(w, list)
	}))

	r.Post("/customer-orders/{id}/documents", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		fileName := v.String("fileName", httpx.Opt{Min: httpx.Min(1), Max: httpx.Max(255)})
		contentType := v.String("contentType", httpx.Opt{Min: httpx.Min(1), Max: httpx.Max(128)})
		size := v.Int("sizeBytes", httpx.Opt{Min: httpx.Min(1)})
		// Base64 in the JSON body: the console reads the file with FileReader
		// and there is no multipart parser in this stack.
		in := DocumentInput{Content: v.String("content", httpx.Opt{Optional: true, Min: httpx.Min(1)}), StorageURL: v.String("storageUrl", httpx.Opt{Optional: true, Min: httpx.Min(1)})}
		if err := v.Done(); err != nil {
			return err
		}
		in.FileName, in.ContentType, in.SizeBytes = *fileName, *contentType, *size
		doc, err := h.svc.AttachDocument(r.Context(), h.tenant(r), chi.URLParam(r, "id"), in, actorOf(r))
		if err != nil {
			return err
		}
		return httpx.Created(w, doc)
	}))

	r.Delete("/customer-orders/{id}/documents/{documentId}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		if err := h.svc.RemoveDocument(r.Context(), h.tenant(r), chi.URLParam(r, "documentId"), actorOf(r)); err != nil {
			return err
		}
		return httpx.OK(w, map[string]any{"success": true, "message": "Dokumen dihapus."})
	}))

	r.Post("/customer-orders/{id}/cancel", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		reason := v.String("reason", httpx.Opt{Min: httpx.Min(3)})
		if err := v.Done(); err != nil {
			return err
		}
		order, err := h.svc.CancelOrder(r.Context(), h.tenant(r), chi.URLParam(r, "id"), *reason, actorOf(r))
		if err != nil {
			return err
		}
		return httpx.OK(w, order)
	}))

	r.Post("/customer-orders/{id}/logistics-status", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		status := v.OneOf("status", ManualLogisticsStatuses, httpx.Opt{})
		if err := v.Done(); err != nil {
			return err
		}
		order, err := h.svc.SetLogisticsStatus(r.Context(), h.tenant(r), chi.URLParam(r, "id"), *status, actorOf(r))
		if err != nil {
			return err
		}
		return httpx.OK(w, order)
	}))

	r.Post("/customer-orders/{id}/refresh-status", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		order, err := h.svc.RecomputeStatus(r.Context(), h.tenant(r), chi.URLParam(r, "id"))
		if err != nil {
			return err
		}
		if order == nil {
			return httpx.NotFound("Customer Order tidak ditemukan.")
		}
		return httpx.OK(w, order)
	}))
}
