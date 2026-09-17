package masterdata

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/db"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/httpx"
)

// BomComponentInput is one component line as the console sends it.
type BomComponentInput struct {
	ID              *string  `json:"id"`
	ComponentPartID string   `json:"componentPartId"`
	ComponentType   string   `json:"componentType"`
	Quantity        float64  `json:"quantity"`
	UOM             string   `json:"uom"`
	ScrapPercentage *float64 `json:"scrapPercentage"`
	Sequence        *int     `json:"sequence"`
	Reference       *string  `json:"reference"`
	Notes           *string  `json:"notes"`
}

// CreateBomInput is the POST body.
type CreateBomInput struct {
	ProductID       string              `json:"productId"`
	BomName         string              `json:"bomName"`
	Version         *string             `json:"version"`
	EffectiveDate   *string             `json:"effectiveDate"`
	EndDate         *string             `json:"endDate"`
	ProductRevision *string             `json:"productRevision"`
	Description     *string             `json:"description"`
	Status          *string             `json:"status"`
	Components      []BomComponentInput `json:"components"`
}

// UpdateBomInput is the PUT body; absent fields are left alone.
type UpdateBomInput struct {
	BomName         *string              `json:"bomName"`
	Version         *string              `json:"version"`
	EffectiveDate   *string              `json:"effectiveDate"`
	EndDate         *string              `json:"endDate"`
	ProductRevision *string              `json:"productRevision"`
	Description     *string              `json:"description"`
	Status          *string              `json:"status"`
	Components      *[]BomComponentInput `json:"components"`
}

func (s *Service) buildComponents(ctx context.Context, tenantID, bomID string, inputs []BomComponentInput, createdAt, updatedAt string) ([]BomItem, error) {
	products, err := s.Products(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	byID := make(map[string]Product, len(products))
	for _, p := range products {
		byID[p.ID] = p
	}
	items := make([]BomItem, 0, len(inputs))
	for idx, c := range inputs {
		if strings.TrimSpace(c.ComponentPartID) == "" {
			return nil, httpx.Validation("Komponen BOM harus menyebutkan componentPartId.", httpx.FieldError{
				Field: fmt.Sprintf("components[%d].componentPartId", idx), Code: "REQUIRED", Message: "componentPartId wajib diisi.",
			})
		}
		sku, name := c.ComponentPartID, "Component Part"
		if p, ok := byID[c.ComponentPartID]; ok {
			sku, name = p.SKU, p.Name
		}
		id := fmt.Sprintf("bom-item-%d-%d", time.Now().UnixMilli(), idx+1)
		if c.ID != nil && *c.ID != "" {
			id = *c.ID
		}
		scrap := 0.0
		if c.ScrapPercentage != nil {
			scrap = *c.ScrapPercentage
		}
		seq := idx + 1
		if c.Sequence != nil && *c.Sequence != 0 {
			seq = *c.Sequence
		}
		componentType := c.ComponentType
		if componentType == "" {
			componentType = "RAW_MATERIAL"
		}
		items = append(items, BomItem{
			ID: id, BomID: bomID, LineNumber: idx + 1, ComponentPartID: c.ComponentPartID,
			ComponentPartSKU: sku, ComponentPartName: name, ComponentType: componentType,
			Quantity: c.Quantity, UOM: c.UOM, ScrapPercentage: &scrap, Sequence: &seq,
			Reference: db.Str(c.Reference), Notes: db.Str(c.Notes),
			CreatedAt: &createdAt, UpdatedAt: &updatedAt,
		})
	}
	return items, nil
}

// CreateBom numbers the BOM per tenant and year and, when created ACTIVE,
// supersedes any other active BOM for the product so exactly one is.
func (s *Service) CreateBom(ctx context.Context, tenantID string, in CreateBomInput, createdBy string) (Bom, error) {
	v := httpx.Validate(Patch{"productId": in.ProductID, "bomName": in.BomName})
	v.String("productId", httpx.Opt{})
	v.String("bomName", httpx.Opt{})
	if err := v.Done(); err != nil {
		return Bom{}, err
	}
	product, err := s.ProductByID(ctx, tenantID, in.ProductID)
	if err != nil {
		return Bom{}, err
	}
	if product == nil {
		return Bom{}, httpx.NotFound("Product not found for this BOM")
	}
	if createdBy == "" {
		createdBy = "Admin"
	}
	now := db.Now()
	bom := Bom{
		ID: newID("bom"), TenantID: tenantID, ProductID: in.ProductID, ProductSKU: product.SKU, ProductName: product.Name,
		ProductRevision: db.Str(in.ProductRevision), BomName: in.BomName, Version: db.Deref(in.Version, "v1.0"),
		Status: db.Deref(in.Status, "DRAFT"), EffectiveDate: db.Deref(in.EffectiveDate, now[:10]),
		EndDate: db.Str(in.EndDate), Description: db.Str(in.Description),
		CreatedBy: &createdBy, CreatedAt: now, UpdatedBy: &createdBy, UpdatedAt: now,
	}
	if bom.Version == "" {
		bom.Version = "v1.0"
	}
	if bom.Status == "" {
		bom.Status = "DRAFT"
	}
	components, err := s.buildComponents(ctx, tenantID, bom.ID, in.Components, now, now)
	if err != nil {
		return Bom{}, err
	}
	bom.Components = components

	err = s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		count, err := s.repo.CountBoms(ctx, tx, tenantID)
		if err != nil {
			return err
		}
		bom.BomNumber = fmt.Sprintf("BOM-%d-%03d", time.Now().Year(), count+1)
		if err := s.repo.UpsertBom(ctx, tx, bom); err != nil {
			return err
		}
		if bom.Status == "ACTIVE" {
			return s.repo.DeactivateOtherBoms(ctx, tx, tenantID, bom.ProductID, bom.ID)
		}
		return nil
	})
	s.boms.Invalidate(tenantID)
	return bom, err
}

// UpdateBom edits the header and, when components are sent, replaces them.
func (s *Service) UpdateBom(ctx context.Context, tenantID, id string, in UpdateBomInput, updatedBy string) (Bom, error) {
	existing, err := s.BomByID(ctx, tenantID, id)
	if err != nil {
		return Bom{}, err
	}
	if existing == nil {
		return Bom{}, httpx.NotFound("Bill of Material not found")
	}
	bom := *existing
	if in.BomName != nil && *in.BomName != "" {
		bom.BomName = *in.BomName
	}
	if in.Version != nil && *in.Version != "" {
		bom.Version = *in.Version
	}
	if in.EffectiveDate != nil && *in.EffectiveDate != "" {
		bom.EffectiveDate = *in.EffectiveDate
	}
	if in.EndDate != nil {
		bom.EndDate = db.Str(in.EndDate)
	}
	if in.ProductRevision != nil {
		bom.ProductRevision = db.Str(in.ProductRevision)
	}
	if in.Description != nil {
		bom.Description = db.Str(in.Description)
	}
	if in.Status != nil && *in.Status != "" {
		bom.Status = *in.Status
	}
	now := db.Now()
	if in.Components != nil {
		components, err := s.buildComponents(ctx, tenantID, bom.ID, *in.Components, bom.CreatedAt, now)
		if err != nil {
			return Bom{}, err
		}
		bom.Components = components
	}
	if updatedBy != "" {
		bom.UpdatedBy = &updatedBy
	}
	bom.UpdatedAt = now
	err = s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		if err := s.repo.UpsertBom(ctx, tx, bom); err != nil {
			return err
		}
		if bom.Status == "ACTIVE" {
			return s.repo.DeactivateOtherBoms(ctx, tx, tenantID, bom.ProductID, bom.ID)
		}
		return nil
	})
	s.boms.Invalidate(tenantID)
	return bom, err
}

// SetBomStatus changes only the status, superseding others when activating.
func (s *Service) SetBomStatus(ctx context.Context, tenantID, id, status, updatedBy string) (Bom, error) {
	existing, err := s.BomByID(ctx, tenantID, id)
	if err != nil {
		return Bom{}, err
	}
	if existing == nil {
		return Bom{}, httpx.NotFound("Bill of Material not found")
	}
	bom := *existing
	bom.Status = status
	if updatedBy != "" {
		bom.UpdatedBy = &updatedBy
	}
	bom.UpdatedAt = db.Now()
	err = s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		if err := s.repo.SetBomStatus(ctx, tx, tenantID, id, status); err != nil {
			return err
		}
		if status == "ACTIVE" {
			return s.repo.DeactivateOtherBoms(ctx, tx, tenantID, bom.ProductID, id)
		}
		return nil
	})
	s.boms.Invalidate(tenantID)
	return bom, err
}

func (s *Service) DeleteBom(ctx context.Context, tenantID, id string) error {
	var deleted bool
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		deleted, err = s.repo.Remove(ctx, tx, "bill_of_material", tenantID, id)
		return err
	})
	s.boms.Invalidate(tenantID)
	if err != nil {
		return err
	}
	if !deleted {
		return httpx.NotFound("Bill of Material not found")
	}
	return nil
}
