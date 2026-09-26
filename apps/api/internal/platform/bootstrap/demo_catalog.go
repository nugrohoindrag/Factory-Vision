package bootstrap

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// The demo plant's material catalogue, curing moulds and bills of material:
// what the Mold and BOM screens show on a SEED_DEMO_DATA install. Every value
// is fictional.
//
// Materials are product rows (migration 027) and are upserted like the
// fixture's products. Moulds and BOMs are edited from the console, so they are
// written only where missing and never reset: a mould the shop floor moved to
// MAINTENANCE, or a BOM a planner activated, stays as they left it. A mould's
// compatibilities and a BOM's lines are written together with their parent and
// only when the parent is new, because a BOM edited in the console renumbers
// its lines, and seeding the originals back beside them would mix two lists.
//
// Nothing here feeds the shop-floor history generator.

type demoMaterial struct {
	id, sku, name, unit string
}

// demoMaterials extends the four materials the fixture already carries
// (mat-rub-01, mat-stl-01, mat-bdw-01, pkg-trw-01) to a full tyre recipe.
var demoMaterials = []demoMaterial{
	{"mat-sbr-01", "MAT-SBR-01", "Styrene Butadiene Rubber SBR 1502", "KG"},
	{"mat-brr-01", "MAT-BRR-01", "Polybutadiene Rubber BR (High-Cis)", "KG"},
	{"mat-cbk-01", "MAT-CBK-01", "Carbon Black N330 (HAF)", "KG"},
	{"mat-cbk-02", "MAT-CBK-02", "Carbon Black N660 (GPF)", "KG"},
	{"mat-sil-01", "MAT-SIL-01", "Highly Dispersible Precipitated Silica", "KG"},
	{"mat-oil-01", "MAT-OIL-01", "TDAE Process Oil", "KG"},
	{"mat-zno-01", "MAT-ZNO-01", "Zinc Oxide 99.5%", "KG"},
	{"mat-sul-01", "MAT-SUL-01", "Insoluble Sulfur, Oil-Treated", "KG"},
	{"mat-acc-01", "MAT-ACC-01", "Accelerator TBBS", "KG"},
	{"mat-aox-01", "MAT-AOX-01", "Antioxidant 6PPD", "KG"},
	{"mat-iir-01", "MAT-IIR-01", "Bromobutyl Inner Liner Compound BIIR", "KG"},
	{"mat-nyl-01", "MAT-NYL-01", "Nylon 66 Cap Ply Fabric 1400dtex/2", "METER"},
	{"mat-pet-01", "MAT-PET-01", "Polyester Body Ply Fabric 1100dtex/2", "METER"},
	{"pkg-lbl-01", "PKG-LBL-01", "Tread Label Sticker", "PCS"},
}

type demoMold struct {
	id, code, name, status string
	machineID              string // empty: not mounted
	// productID is the compatible product; active says whether the link is
	// switched on.
	productID string
	active    bool
}

// demoMolds are the curing moulds of the two dual-cavity presses.
//
// A product with an active compatibility makes the mould mandatory on every
// one of its Work Orders at confirmation (ADR-36), whatever the process. The
// acceptance scripts confirm Tire A and Tire B work orders on the extrusion
// and curing steps without naming a mould, so only Tire C's moulds are
// switched on; the Tire A and Tire B links are registered but inactive,
// which is the state the pilot starts in before the mould rule is rolled out
// to the passenger and SUV lines.
var demoMolds = []demoMold{
	{"mold-pcr185-01", "MLD-PCR185-01", "Segmented Mold 185/65 R15 Pola NT-E1 #1", "IN_USE", "mc-cpr-01", "prod-tire-a", false},
	{"mold-pcr185-02", "MLD-PCR185-02", "Segmented Mold 185/65 R15 Pola NT-E1 #2", "IN_USE", "mc-cpr-01", "prod-tire-a", false},
	{"mold-pcr185-03", "MLD-PCR185-03", "Segmented Mold 185/65 R15 Pola NT-E1 #3", "AVAILABLE", "", "prod-tire-a", false},
	{"mold-suv235-01", "MLD-SUV235-01", "Segmented Mold 235/70 R16 Pola NT-AT2 #1", "AVAILABLE", "", "prod-tire-b", false},
	{"mold-suv235-02", "MLD-SUV235-02", "Segmented Mold 235/70 R16 Pola NT-AT2 #2", "MAINTENANCE", "", "prod-tire-b", false},
	{"mold-ltr195-01", "MLD-LTR195-01", "Two-Piece Mold 195 R14C Pola NT-LT3 #1", "IN_USE", "mc-cpr-02", "prod-tire-c", true},
	{"mold-ltr195-02", "MLD-LTR195-02", "Two-Piece Mold 195 R14C Pola NT-LT3 #2", "AVAILABLE", "", "prod-tire-c", true},
	// Retired with the 13-inch size; kept in the register as history.
	{"mold-pcr175-01", "MLD-PCR175-01", "Two-Piece Mold 175/70 R13 Pola NT-C0", "RETIRED", "", "", false},
}

type demoBomLine struct {
	partID, componentType string
	quantity              float64
	uom                   string
	scrap                 float64
	reference             string
}

type demoBom struct {
	id, number, productID, revision, name, version, status string
	effective, end                                         string // end empty: open-ended
	description, createdAt                                 string
	lines                                                  []demoBomLine
}

const (
	bomRaw       = "RAW_MATERIAL"
	bomComponent = "COMPONENT"
	bomSubAssy   = "SUB_ASSEMBLY"
	bomPackaging = "PACKAGING"
)

// demoBoms are one ACTIVE BOM per tyre, the Tire A trial recipe still in
// DRAFT, and the Tire B version the current one superseded. Quantities are
// per finished tyre.
var demoBoms = []demoBom{
	{
		id: "bom-tire-a-v21", number: "BOM-PCR185-021", productID: "prod-tire-a", revision: "Rev C",
		name: "BOM Ban PCR 185/65 R15", version: "v2.1", status: "ACTIVE", effective: "2026-07-01",
		description: "Resep produksi berjalan untuk ban penumpang 185/65 R15. Berat ban jadi sekitar 7,8 kg.",
		createdAt:   "2026-06-24T02:00:00.000Z",
		lines: []demoBomLine{
			{"mat-rub-01", bomRaw, 1.450, "KG", 1.5, "Tapak & dinding samping"},
			{"mat-sbr-01", bomRaw, 1.250, "KG", 1.5, "Tapak"},
			{"mat-brr-01", bomRaw, 0.420, "KG", 1.5, "Dinding samping"},
			{"mat-cbk-01", bomRaw, 0.980, "KG", 1.0, "Tapak"},
			{"mat-cbk-02", bomRaw, 0.360, "KG", 1.0, "Dinding samping & karkas"},
			{"mat-sil-01", bomRaw, 0.520, "KG", 1.0, "Tapak"},
			{"mat-oil-01", bomRaw, 0.300, "KG", 0.5, "Kompon"},
			{"mat-zno-01", bomRaw, 0.085, "KG", 0.5, "Aktivator vulkanisasi"},
			{"mat-sul-01", bomRaw, 0.048, "KG", 0.5, "Vulkanisasi"},
			{"mat-acc-01", bomRaw, 0.036, "KG", 0.5, "Vulkanisasi"},
			{"mat-aox-01", bomRaw, 0.042, "KG", 0.5, "Antioksidan"},
			{"mat-iir-01", bomSubAssy, 0.680, "KG", 2.0, "Inner liner"},
			{"mat-pet-01", bomComponent, 1.920, "METER", 2.5, "Karkas 1 ply"},
			{"mat-stl-01", bomComponent, 610, "METER", 2.0, "Sabuk baja 2 lapis"},
			{"mat-nyl-01", bomComponent, 1.880, "METER", 3.0, "Cap ply"},
			{"mat-bdw-01", bomComponent, 0.620, "KG", 1.0, "Inti bead"},
			{"pkg-lbl-01", bomPackaging, 1, "PCS", 0, "Label tapak"},
			{"pkg-trw-01", bomPackaging, 0.020, "ROLL", 0, "Kemasan (1 rol untuk 50 ban)"},
		},
	},
	{
		id: "bom-tire-a-v22", number: "BOM-PCR185-022", productID: "prod-tire-a", revision: "Rev D",
		name: "BOM Ban PCR 185/65 R15 (Tapak Silika Tinggi)", version: "v2.2", status: "DRAFT", effective: "2026-10-15",
		description: "Uji coba kompon tapak silika tinggi untuk menurunkan rolling resistance. Menunggu hasil uji laboratorium sebelum diaktifkan.",
		createdAt:   "2026-09-10T03:00:00.000Z",
		lines: []demoBomLine{
			{"mat-rub-01", bomRaw, 1.400, "KG", 1.5, "Tapak & dinding samping"},
			{"mat-sbr-01", bomRaw, 1.300, "KG", 1.5, "Tapak"},
			{"mat-brr-01", bomRaw, 0.420, "KG", 1.5, "Dinding samping"},
			{"mat-cbk-01", bomRaw, 0.780, "KG", 1.0, "Tapak"},
			{"mat-cbk-02", bomRaw, 0.360, "KG", 1.0, "Dinding samping & karkas"},
			{"mat-sil-01", bomRaw, 0.720, "KG", 1.2, "Tapak"},
			{"mat-oil-01", bomRaw, 0.320, "KG", 0.5, "Kompon"},
			{"mat-zno-01", bomRaw, 0.085, "KG", 0.5, "Aktivator vulkanisasi"},
			{"mat-sul-01", bomRaw, 0.050, "KG", 0.5, "Vulkanisasi"},
			{"mat-acc-01", bomRaw, 0.040, "KG", 0.5, "Vulkanisasi"},
			{"mat-aox-01", bomRaw, 0.042, "KG", 0.5, "Antioksidan"},
			{"mat-iir-01", bomSubAssy, 0.680, "KG", 2.0, "Inner liner"},
			{"mat-pet-01", bomComponent, 1.920, "METER", 2.5, "Karkas 1 ply"},
			{"mat-stl-01", bomComponent, 610, "METER", 2.0, "Sabuk baja 2 lapis"},
			{"mat-nyl-01", bomComponent, 1.880, "METER", 3.0, "Cap ply"},
			{"mat-bdw-01", bomComponent, 0.620, "KG", 1.0, "Inti bead"},
			{"pkg-lbl-01", bomPackaging, 1, "PCS", 0, "Label tapak"},
			{"pkg-trw-01", bomPackaging, 0.020, "ROLL", 0, "Kemasan (1 rol untuk 50 ban)"},
		},
	},
	{
		id: "bom-tire-b-v12", number: "BOM-SUV235-012", productID: "prod-tire-b", revision: "Rev A",
		name: "BOM Ban SUV 235/70 R16", version: "v1.2", status: "INACTIVE", effective: "2025-11-01", end: "2026-05-14",
		description: "Versi sebelumnya, digantikan v1.3 setelah perubahan kompon tapak.",
		createdAt:   "2025-10-20T02:00:00.000Z",
		lines: []demoBomLine{
			{"mat-rub-01", bomRaw, 2.400, "KG", 1.5, "Tapak & dinding samping"},
			{"mat-sbr-01", bomRaw, 1.900, "KG", 1.5, "Tapak"},
			{"mat-brr-01", bomRaw, 0.650, "KG", 1.5, "Dinding samping"},
			{"mat-cbk-01", bomRaw, 1.800, "KG", 1.0, "Tapak"},
			{"mat-cbk-02", bomRaw, 0.620, "KG", 1.0, "Dinding samping & karkas"},
			{"mat-sil-01", bomRaw, 0.450, "KG", 1.0, "Tapak"},
			{"mat-oil-01", bomRaw, 0.480, "KG", 0.5, "Kompon"},
			{"mat-zno-01", bomRaw, 0.135, "KG", 0.5, "Aktivator vulkanisasi"},
			{"mat-sul-01", bomRaw, 0.075, "KG", 0.5, "Vulkanisasi"},
			{"mat-acc-01", bomRaw, 0.058, "KG", 0.5, "Vulkanisasi"},
			{"mat-aox-01", bomRaw, 0.068, "KG", 0.5, "Antioksidan"},
			{"mat-iir-01", bomSubAssy, 1.050, "KG", 2.0, "Inner liner"},
			{"mat-pet-01", bomComponent, 5.200, "METER", 2.5, "Karkas 2 ply"},
			{"mat-stl-01", bomComponent, 820, "METER", 2.0, "Sabuk baja 2 lapis"},
			{"mat-nyl-01", bomComponent, 2.450, "METER", 3.0, "Cap ply"},
			{"mat-bdw-01", bomComponent, 0.940, "KG", 1.0, "Inti bead"},
			{"pkg-trw-01", bomPackaging, 0.030, "ROLL", 0, "Kemasan (1 rol untuk 33 ban)"},
		},
	},
	{
		id: "bom-tire-b-v13", number: "BOM-SUV235-013", productID: "prod-tire-b", revision: "Rev B",
		name: "BOM Ban SUV 235/70 R16", version: "v1.3", status: "ACTIVE", effective: "2026-05-15",
		description: "Resep produksi berjalan untuk ban SUV all-terrain 235/70 R16. Berat ban jadi sekitar 12,4 kg.",
		createdAt:   "2026-05-08T02:00:00.000Z",
		lines: []demoBomLine{
			{"mat-rub-01", bomRaw, 2.350, "KG", 1.5, "Tapak & dinding samping"},
			{"mat-sbr-01", bomRaw, 1.850, "KG", 1.5, "Tapak"},
			{"mat-brr-01", bomRaw, 0.700, "KG", 1.5, "Dinding samping"},
			{"mat-cbk-01", bomRaw, 1.650, "KG", 1.0, "Tapak"},
			{"mat-cbk-02", bomRaw, 0.620, "KG", 1.0, "Dinding samping & karkas"},
			{"mat-sil-01", bomRaw, 0.600, "KG", 1.0, "Tapak"},
			{"mat-oil-01", bomRaw, 0.460, "KG", 0.5, "Kompon"},
			{"mat-zno-01", bomRaw, 0.135, "KG", 0.5, "Aktivator vulkanisasi"},
			{"mat-sul-01", bomRaw, 0.075, "KG", 0.5, "Vulkanisasi"},
			{"mat-acc-01", bomRaw, 0.058, "KG", 0.5, "Vulkanisasi"},
			{"mat-aox-01", bomRaw, 0.068, "KG", 0.5, "Antioksidan"},
			{"mat-iir-01", bomSubAssy, 1.050, "KG", 2.0, "Inner liner"},
			{"mat-pet-01", bomComponent, 5.200, "METER", 2.5, "Karkas 2 ply"},
			{"mat-stl-01", bomComponent, 820, "METER", 2.0, "Sabuk baja 2 lapis"},
			{"mat-nyl-01", bomComponent, 2.450, "METER", 3.0, "Cap ply"},
			{"mat-bdw-01", bomComponent, 0.940, "KG", 1.0, "Inti bead"},
			{"pkg-lbl-01", bomPackaging, 1, "PCS", 0, "Label tapak"},
			{"pkg-trw-01", bomPackaging, 0.030, "ROLL", 0, "Kemasan (1 rol untuk 33 ban)"},
		},
	},
	{
		id: "bom-tire-c-v10", number: "BOM-LTR195-010", productID: "prod-tire-c", revision: "Rev A",
		name: "BOM Ban Light Truck 195 R14C", version: "v1.0", status: "ACTIVE", effective: "2026-06-01",
		description: "Resep produksi ban light truck 195 R14C. Kandungan karet alam lebih tinggi untuk ketahanan beban. Berat ban jadi sekitar 10,1 kg.",
		createdAt:   "2026-05-25T02:00:00.000Z",
		lines: []demoBomLine{
			{"mat-rub-01", bomRaw, 2.450, "KG", 1.5, "Tapak & dinding samping"},
			{"mat-sbr-01", bomRaw, 1.100, "KG", 1.5, "Tapak"},
			{"mat-brr-01", bomRaw, 0.450, "KG", 1.5, "Dinding samping"},
			{"mat-cbk-01", bomRaw, 1.750, "KG", 1.0, "Tapak"},
			{"mat-cbk-02", bomRaw, 0.500, "KG", 1.0, "Dinding samping & karkas"},
			{"mat-oil-01", bomRaw, 0.280, "KG", 0.5, "Kompon"},
			{"mat-zno-01", bomRaw, 0.120, "KG", 0.5, "Aktivator vulkanisasi"},
			{"mat-sul-01", bomRaw, 0.070, "KG", 0.5, "Vulkanisasi"},
			{"mat-acc-01", bomRaw, 0.052, "KG", 0.5, "Vulkanisasi"},
			{"mat-aox-01", bomRaw, 0.060, "KG", 0.5, "Antioksidan"},
			{"mat-iir-01", bomSubAssy, 0.900, "KG", 2.0, "Inner liner"},
			{"mat-pet-01", bomComponent, 4.400, "METER", 2.5, "Karkas 2 ply"},
			{"mat-stl-01", bomComponent, 760, "METER", 2.0, "Sabuk baja 2 lapis"},
			{"mat-nyl-01", bomComponent, 2.100, "METER", 3.0, "Cap ply"},
			{"mat-bdw-01", bomComponent, 1.050, "KG", 1.0, "Inti bead"},
			{"pkg-lbl-01", bomPackaging, 1, "PCS", 0, "Label tapak"},
			{"pkg-trw-01", bomPackaging, 0.025, "ROLL", 0, "Kemasan (1 rol untuk 40 ban)"},
		},
	},
}

// seedDemoCatalog writes the materials, moulds and BOMs inside the plant
// seed's transaction, after the products they reference.
func seedDemoCatalog(ctx context.Context, tx pgx.Tx, tenantID string, out *PlantResult) error {
	for _, m := range demoMaterials {
		if _, err := tx.Exec(ctx, `INSERT INTO product (id, tenant_id, sku, name, unit, ideal_cycle_time_seconds, status) VALUES ($1,$2,$3,$4,$5,0,'ACTIVE')
			ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, status = EXCLUDED.status`,
			m.id, tenantID, m.sku, m.name, m.unit); err != nil {
			return err
		}
		out.Materials++
	}

	for _, m := range demoMolds {
		// The press is a SQL-seed row; a database seeded without it gets
		// the mould unmounted rather than a failed seed.
		var machine *string
		if m.machineID != "" {
			machine = &m.machineID
		}
		// No conflict target: a mould an operator already registered under
		// the same code is theirs, and the seed leaves it alone.
		tag, err := tx.Exec(ctx, `INSERT INTO mold (id, tenant_id, code, name, cavity_count, status, current_machine_id, created_at, updated_at)
			VALUES ($1,$2::varchar,$3,$4,1,$5,(SELECT id FROM machine WHERE tenant_id = $2::varchar AND id = $6::varchar),'2026-06-02T01:00:00.000Z'::timestamptz,'2026-06-02T01:00:00.000Z'::timestamptz)
			ON CONFLICT DO NOTHING`,
			m.id, tenantID, m.code, m.name, m.status, machine)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			continue
		}
		out.Molds++
		if m.productID == "" {
			continue
		}
		tag, err = tx.Exec(ctx, `INSERT INTO product_mold_compatibility (id, tenant_id, product_id, mold_id, active, created_at)
			VALUES ($1,$2,$3,$4,$5,'2026-06-02T01:00:00.000Z'::timestamptz) ON CONFLICT DO NOTHING`,
			"pmc-"+m.id, tenantID, m.productID, m.id, m.active)
		if err != nil {
			return err
		}
		out.MoldCompatibilities += int(tag.RowsAffected())
	}

	for _, b := range demoBoms {
		var end *string
		if b.end != "" {
			end = &b.end
		}
		// Exactly one BOM per product is ACTIVE. Where a planner has
		// already activated one, the seeded version arrives as a DRAFT
		// rather than as a second active recipe.
		tag, err := tx.Exec(ctx, `INSERT INTO bill_of_material (id, tenant_id, bom_number, product_id, product_revision, bom_name, version, status,
			  effective_date, end_date, description, created_by, created_at, updated_by, updated_at)
			VALUES ($1,$2::varchar,$3,$4::varchar,$5,$6,$7,
			  CASE WHEN $8::varchar = 'ACTIVE' AND EXISTS (SELECT 1 FROM bill_of_material WHERE tenant_id = $2::varchar AND product_id = $4::varchar AND status = 'ACTIVE') THEN 'DRAFT' ELSE $8::varchar END,
			  $9::date,$10::date,$11,'Process Engineer',$12::timestamptz,'Process Engineer',$12::timestamptz)
			ON CONFLICT DO NOTHING`,
			b.id, tenantID, b.number, b.productID, b.revision, b.name, b.version, b.status,
			b.effective, end, b.description, b.createdAt)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			continue
		}
		out.Boms++
		for i, l := range b.lines {
			tag, err := tx.Exec(ctx, `INSERT INTO bill_of_material_item (id, bom_id, tenant_id, line_number, component_part_id, component_type,
				  quantity, uom, scrap_percentage, sequence, reference, created_at, updated_at)
				VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$4,$10,$11::timestamptz,$11::timestamptz) ON CONFLICT DO NOTHING`,
				fmt.Sprintf("bomi-%s-%02d", b.id[len("bom-"):], i+1), b.id, tenantID, i+1, l.partID, l.componentType,
				l.quantity, l.uom, l.scrap, l.reference, b.createdAt)
			if err != nil {
				return err
			}
			out.BomItems += int(tag.RowsAffected())
		}
	}
	return nil
}
