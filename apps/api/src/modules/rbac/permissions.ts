import { UserRole } from '@factory-vision/domain-types';
import type { PermissionDefinition, PermissionId } from '@factory-vision/domain-types';

/**
 * The MVP permission catalogue.
 *
 * Every identifier is `module:action`. This list is the single source of truth:
 * a custom role may only be built from permissions that appear here, and the
 * `privileged` flag marks the ones restricts to administrators.
 */
export const PERMISSION_CATALOG: PermissionDefinition[] = [
  perm('dashboard:view', 'Melihat dashboard eksekutif dan produksi'),

  perm('production_order:view', 'Melihat production order'),
  perm('production_order:create', 'Membuat production order'),
  perm('production_order:edit', 'Mengubah production order'),
  perm('production_order:release', 'Merilis production order'),
  perm('production_order:delete', 'Menghapus production order'),

  // --- MES Improvement v1.0: demand & planning (Sprint 3–6) -----------
  perm('customer:view', 'Melihat master customer'),
  perm('customer:manage', 'Mengelola master customer'),

  perm('customer_order:view', 'Melihat customer order'),
  perm('customer_order:create', 'Membuat customer order'),
  perm('customer_order:edit', 'Mengubah customer order dan order line'),
  perm('customer_order:cancel', 'Membatalkan customer order'),

  perm('demand_forecast:view', 'Melihat demand forecast'),
  perm('demand_forecast:generate', 'Menghasilkan demand forecast'),

  perm('capacity_plan:view', 'Melihat capacity plan'),
  perm('capacity_plan:manage', 'Menghitung ulang capacity plan'),

  perm('production_plan:view', 'Melihat production plan'),
  perm('production_plan:create', 'Membuat production plan'),
  perm('production_plan:edit', 'Mengubah production plan dan plan line'),
  perm('production_plan:confirm', 'Mengonfirmasi production plan'),

  perm('work_order:view', 'Melihat work order'),
  perm('work_order:create', 'Membuat work order'),
  perm('work_order:edit', 'Mengubah work order'),
  perm('work_order:schedule', 'Menjadwalkan work order'),
  // ADR-18 retired RELEASED in favour of CONFIRMED. `work_order:release` stays
  // in the catalogue so a tenant that customised its roles against it does not
  // silently lose the grant, but confirmation is the v1.0 gate and has its own
  // permission — it is what puts a Work Order on the operator terminal (§25.7).
  perm('work_order:release', 'Merilis work order ke shop floor (dialihkan ke work_order:confirm, ADR-18)'),
  perm('work_order:confirm', 'Mengonfirmasi work order sehingga muncul di terminal operator'),
  perm('work_order:cancel', 'Membatalkan work order'),

  perm('batch:view', 'Melihat batch/lot produksi'),
  perm('batch:create', 'Membuat batch/lot produksi'),
  perm('batch:edit', 'Mengubah dan melampirkan batch/lot'),

  perm('shopfloor:execute', 'Menjalankan perintah shop floor pada WO yang ditugaskan'),

  perm('production_record:create', 'Mencatat output produksi'),
  perm('production_record:correct', 'Mengoreksi catatan produksi'),

  perm('downtime:create', 'Mencatat downtime'),
  perm('downtime:correct', 'Mengoreksi catatan downtime'),

  perm('reject:create', 'Mencatat reject/defect'),
  perm('reject:correct', 'Mengoreksi catatan reject'),

  perm('correction:approve', 'Menyetujui permintaan koreksi data', true),

  perm('shift:view', 'Melihat konfigurasi dan performa shift'),
  perm('shift:manage', 'Mengelola konfigurasi shift'),
  perm('shift:handover', 'Melakukan serah terima shift'),

  perm('analytics:view', 'Melihat OEE, downtime, reject, dan bottleneck analytics'),
  perm('report:export', 'Mengekspor laporan'),

  perm('master_data:view', 'Melihat master data manufaktur'),
  perm('master_data:manage', 'Mengelola master data manufaktur'),
  perm('master_data:import', 'Mengimpor master data melalui CSV'),

  perm('device:view', 'Melihat terminal shop floor'),
  perm('device:manage', 'Mengelola terminal shop floor'),

  perm('user:view', 'Melihat daftar pengguna'),
  perm('user:create', 'Membuat pengguna', true),
  perm('user:edit', 'Mengubah profil, peran, dan scope pengguna', true),
  perm('user:deactivate', 'Menonaktifkan pengguna dan mencabut sesi', true),

  perm('role:view', 'Melihat peran dan permission'),
  perm('role:create', 'Membuat peran khusus tenant', true),
  perm('role:edit', 'Mengubah permission sebuah peran', true),

  perm('audit:view', 'Melihat audit trail', true),
  perm('configuration:manage', 'Mengubah konfigurasi sistem dan OEE', true),

  // --- MES Improvement v2.0 (Improvement PRD §34) ---------------------
  //
  // One permission per operational decision, not per screen: `material:consume`
  // is what an operator terminal needs and `material:adjust` is what a stock
  // take needs, and the two are different rights even though both change stock.
  perm('material:view', 'Melihat inventory, kebutuhan, dan konsumsi material'),
  perm('material:reserve', 'Mereservasi material untuk work order'),
  perm('material:consume', 'Mencatat konsumsi material terhadap work order'),
  perm('material:return', 'Mencatat pengembalian material ke gudang'),
  perm('material:adjust', 'Menyesuaikan stok material dan melakukan override konsumsi', true),

  perm('mrp:view', 'Melihat hasil MRP'),
  perm('mrp:run', 'Menjalankan MRP'),
  perm('mrp:approve', 'Menyetujui rekomendasi MRP', true),

  perm('quality:view', 'Melihat inspeksi, hold, disposition, dan NCR'),
  perm('quality:inspect', 'Menjalankan inspeksi kualitas'),
  perm('quality:hold', 'Menahan kuantitas karena masalah kualitas'),
  perm('quality:release', 'Melepas hold kualitas'),
  perm('quality:disposition', 'Menetapkan disposition atas kuantitas gagal'),
  // The PRD writes these `quality:ncr:create` and `quality:ncr:manage`, but
  // every identifier in this catalogue is `module:action` and US-006 asserts
  // it — a third segment makes the id malformed and leaves `perm()` parsing
  // the action as "ncr". NCR is its own entity in §13, so it becomes the
  // module and the meaning is unchanged.
  perm('ncr:create', 'Membuat Non-Conformance Record'),
  perm('ncr:manage', 'Mengelola NCR dan corrective action'),

  perm('maintenance:view', 'Melihat rencana, permintaan, dan riwayat maintenance'),
  perm('maintenance:create', 'Membuat rencana dan permintaan maintenance'),
  perm('maintenance:assign', 'Menugaskan teknisi maintenance'),
  perm('maintenance:execute', 'Menjalankan pekerjaan maintenance'),
  perm('maintenance:complete', 'Menyelesaikan pekerjaan maintenance'),

  perm('workforce:view', 'Melihat operator, skill, dan kualifikasi'),
  perm('workforce:manage', 'Mengelola skill dan requirement kualifikasi'),
  perm('workforce:qualification', 'Mengelola kualifikasi operator'),
  perm('workforce:assignment', 'Menugaskan operator ke work order dan shift'),
  perm('workforce:availability', 'Mengubah status ketersediaan operator'),

  perm('wip:view', 'Melihat WIP dan transfer antar proses'),
  perm('wip:create', 'Membuat catatan WIP'),
  perm('wip:transfer', 'Mentransfer WIP ke proses berikutnya'),
  perm('wip:receive', 'Menerima WIP di proses tujuan'),
  perm('wip:hold', 'Menahan WIP'),
  perm('wip:release', 'Melepas WIP yang ditahan'),

  perm('production_board:view', 'Melihat Visual Production Board'),
  perm('production_board:reschedule', 'Menjadwalkan ulang work order dari board'),
  perm('production_board:assign', 'Mengubah penugasan mesin dan operator dari board'),
  perm('production_board:dispatch', 'Mengonfirmasi dan membatalkan dispatch dari board'),

  perm('event:view', 'Melihat Event History operasional'),
];

function perm(id: PermissionId, description: string, privileged = false): PermissionDefinition {
  const [module, action] = id.split(':');
  return { id, module, action, description, privileged };
}

export const PERMISSION_IDS: PermissionId[] = PERMISSION_CATALOG.map((p) => p.id);

const ALL = PERMISSION_IDS;

/** Read-only view of everything, no execution and no administration. */
const VIEW_ONLY: PermissionId[] = [
  'dashboard:view',
  'production_order:view',
  'customer:view',
  'customer_order:view',
  'demand_forecast:view',
  'capacity_plan:view',
  'production_plan:view',
  'work_order:view',
  'batch:view',
  'shift:view',
  'analytics:view',
  'report:export',
  'master_data:view',
  'audit:view',
  'material:view',
  'mrp:view',
  'quality:view',
  'maintenance:view',
  'workforce:view',
  'wip:view',
  'production_board:view',
  'event:view',
];

/**
 * System role → permission mapping, transcribed from the ACL baseline.
 *
 * Executive is deliberately view-only across the board: rule 5 says
 * Executive has tenant-wide visibility but cannot execute shop-floor actions.
 */
export const SYSTEM_ROLE_PERMISSIONS: Record<UserRole, PermissionId[]> = {
  [UserRole.EXECUTIVE]: VIEW_ONLY,

  [UserRole.PRODUCTION_MANAGER]: [
    'dashboard:view',
    'customer:view',
    'customer_order:view',
    'demand_forecast:view',
    'capacity_plan:view',
    'capacity_plan:manage',
    'production_plan:view',
    'production_plan:create',
    'production_plan:edit',
    'production_plan:confirm',
    'production_order:view',
    'production_order:create',
    'production_order:edit',
    'production_order:release',
    'production_order:delete',
    'work_order:view',
    'work_order:create',
    'work_order:edit',
    'work_order:schedule',
    'work_order:release',
    'work_order:confirm',
    'work_order:cancel',
    'batch:view',
    'batch:create',
    'batch:edit',
    'shopfloor:execute',
    'production_record:create',
    'production_record:correct',
    'downtime:create',
    'downtime:correct',
    'reject:create',
    'reject:correct',
    'correction:approve',
    'shift:view',
    'shift:manage',
    'shift:handover',
    'analytics:view',
    'report:export',
    'master_data:view',
    'master_data:manage',
    'master_data:import',
    'device:view',
    'audit:view',
    // §35 — the Production Manager owns production, WIP, labour, quality
    // performance and maintenance impact. Execution of quality and maintenance
    // work belongs to those roles; visibility and disposition do not.
    'material:view',
    'material:reserve',
    'mrp:view',
    'mrp:run',
    'mrp:approve',
    'quality:view',
    'quality:hold',
    'quality:disposition',
    'ncr:create',
    'ncr:manage',
    'maintenance:view',
    'maintenance:create',
    'workforce:view',
    'workforce:assignment',
    'wip:view',
    'wip:hold',
    'wip:release',
    'production_board:view',
    'production_board:reschedule',
    'production_board:assign',
    'production_board:dispatch',
    'event:view',
  ],

  [UserRole.SUPERVISOR]: [
    'dashboard:view',
    'customer_order:view',
    'production_plan:view',
    'capacity_plan:view',
    'production_order:view',
    'work_order:view',
    'work_order:edit',
    'work_order:schedule',
    'work_order:release',
    'work_order:confirm',
    'batch:view',
    'batch:create',
    'batch:edit',
    'shopfloor:execute',
    'production_record:create',
    'production_record:correct',
    'downtime:create',
    'downtime:correct',
    'reject:create',
    'reject:correct',
    'shift:view',
    'shift:handover',
    'analytics:view',
    'report:export',
    'master_data:view',
    'device:view',
    'device:manage',
    'audit:view',
    // §35 — the Supervisor dispatches, assigns operators, and keeps WIP and
    // quality moving on the floor.
    'material:view',
    'material:reserve',
    'material:consume',
    'material:return',
    'quality:view',
    'quality:inspect',
    'quality:hold',
    'ncr:create',
    'maintenance:view',
    'maintenance:create',
    'workforce:view',
    'workforce:assignment',
    'workforce:availability',
    'wip:view',
    'wip:create',
    'wip:transfer',
    'wip:receive',
    'wip:hold',
    'production_board:view',
    'production_board:reschedule',
    'production_board:assign',
    'production_board:dispatch',
    'event:view',
  ],

  // "Assigned Execute", the operator's reach is narrowed further by scope,
  // which restricts them to their own work orders.
  [UserRole.OPERATOR]: [
    'work_order:view',
    'batch:view',
    'shopfloor:execute',
    'production_record:create',
    'downtime:create',
    'reject:create',
    'shift:view',
    // The ACL grants the Operator "Assigned" access to the reason and process
    // master, not none: recording a downtime or a reject means choosing a
    // configured code, so the terminal has to be able to read that list.
    // Scope still narrows what the rows can be, and no write is granted.
    'master_data:view',
    // §35 — an operator consumes material, inspects where assigned, and moves
    // WIP to the next process. Everything else in the improvement is read-only
    // or absent for them.
    'material:view',
    'material:consume',
    'material:return',
    'quality:view',
    'quality:inspect',
    'maintenance:create',
    'wip:view',
    'wip:create',
    'wip:transfer',
    'wip:receive',
  ],

  [UserRole.PPIC]: [
    'dashboard:view',
    // PPIC reads Customer Orders because demand is what it plans against, but
    // it no longer owns them: receiving, editing and cancelling an order is
    // Sales' responsibility (Improvement PRD §5, §8.1).
    'customer:view',
    'customer_order:view',
    'demand_forecast:view',
    'demand_forecast:generate',
    'capacity_plan:view',
    'capacity_plan:manage',
    'production_plan:view',
    'production_plan:create',
    'production_plan:edit',
    'production_plan:confirm',
    'production_order:view',
    'production_order:create',
    'production_order:edit',
    'production_order:release',
    'production_order:delete',
    'work_order:view',
    'work_order:create',
    'work_order:edit',
    'work_order:schedule',
    'work_order:confirm',
    'batch:view',
    'batch:create',
    'batch:edit',
    'shift:view',
    'analytics:view',
    'report:export',
    'master_data:view',
    'master_data:manage',
    'master_data:import',
    'audit:view',
    // §35 — MRP and material readiness are PPIC's primary responsibility, and
    // the board is where the plan becomes a dispatch.
    'material:view',
    'material:reserve',
    'mrp:view',
    'mrp:run',
    'quality:view',
    'maintenance:view',
    'workforce:view',
    'wip:view',
    'production_board:view',
    'production_board:reschedule',
    'production_board:assign',
    'event:view',
  ],

  [UserRole.QUALITY]: [
    'dashboard:view',
    'customer_order:view',
    'production_plan:view',
    'production_order:view',
    'work_order:view',
    'batch:view',
    'reject:create',
    'reject:correct',
    'shift:view',
    'analytics:view',
    'report:export',
    'master_data:view',
    'master_data:manage',
    'audit:view',
    // §35 — Quality owns the whole lifecycle: inspection, hold, disposition,
    // NCR and corrective action. It also holds the WIP hold/release pair,
    // because a quality gate that cannot stop a transfer is not a gate (BR-H04).
    'quality:view',
    'quality:inspect',
    'quality:hold',
    'quality:release',
    'quality:disposition',
    'ncr:create',
    'ncr:manage',
    'material:view',
    'wip:view',
    'wip:hold',
    'wip:release',
    'event:view',
  ],

  /**
   * Maintenance: the machine's health, and nothing about what it produces.
   *
   * Read access to work orders and the board is deliberate — a technician
   * needs to know what is scheduled on a machine before taking it offline
   * (BR-MT04) — but no production, quality or planning write is granted.
   */
  [UserRole.MAINTENANCE]: [
    'dashboard:view',
    'work_order:view',
    'production_board:view',
    'analytics:view',
    'report:export',
    'master_data:view',
    'shift:view',
    'downtime:create',
    'maintenance:view',
    'maintenance:create',
    'maintenance:assign',
    'maintenance:execute',
    'maintenance:complete',
    'event:view',
  ],

  /**
   * Warehouse / Material Controller: stock, issue, return, and the ledger.
   *
   * `material:adjust` is privileged and granted here, because a stock take is
   * this role's job and nobody else's.
   */
  [UserRole.WAREHOUSE]: [
    'dashboard:view',
    'work_order:view',
    'master_data:view',
    'report:export',
    'material:view',
    'material:reserve',
    'material:consume',
    'material:return',
    'material:adjust',
    'mrp:view',
    'wip:view',
    'event:view',
  ],

  /**
   * HR / Workforce admin: who is qualified, who is on which shift, who is in.
   *
   * No production write at all: this role decides who may run a machine, not
   * what the machine does.
   */
  [UserRole.WORKFORCE_ADMIN]: [
    'dashboard:view',
    'master_data:view',
    'report:export',
    'shift:view',
    'analytics:view',
    'workforce:view',
    'workforce:manage',
    'workforce:qualification',
    'workforce:assignment',
    'workforce:availability',
    'event:view',
  ],

  /**
   * Sales: Order Receiving, and nothing downstream of it.
   *
   * The list is short on purpose. Sales answers "apakah order ini bisa dipenuhi,
   * dan kapan" from the order's own derived status (Received → Planned → In
   * Production → Produced), which `customer_order:view` already carries — so
   * there is no reason to hand them the Planning module to get it. No
   * `production_plan:*`, no `work_order:*`, no `shopfloor:execute`.
   */
  [UserRole.SALES]: [
    'dashboard:view',
    'customer:view',
    'customer:manage',
    'customer_order:view',
    'customer_order:create',
    'customer_order:edit',
    'customer_order:cancel',
    // Choosing a Product on an order line needs the product master readable;
    // scope still narrows the rows, and no write is granted.
    'master_data:view',
    'report:export',
  ],

  [UserRole.ADMIN]: ALL,
};

/** Where each role lands after login (, US-001). */
export const ROLE_LANDING_PATH: Record<UserRole, string> = {
  [UserRole.EXECUTIVE]: '/',
  [UserRole.PRODUCTION_MANAGER]: '/',
  [UserRole.SUPERVISOR]: '/live-board',
  [UserRole.OPERATOR]: '/terminal',
  [UserRole.PPIC]: '/work-orders',
  [UserRole.QUALITY]: '/quality',
  [UserRole.SALES]: '/order-receiving',
  [UserRole.MAINTENANCE]: '/maintenance',
  [UserRole.WAREHOUSE]: '/material-inventory',
  [UserRole.WORKFORCE_ADMIN]: '/workforce',
  [UserRole.ADMIN]: '/settings?tab=users',
};

export const ROLE_DESCRIPTION: Record<UserRole, string> = {
  [UserRole.EXECUTIVE]: 'Visibilitas KPI pabrik tingkat tenant, tanpa perintah shop floor.',
  [UserRole.PRODUCTION_MANAGER]: 'Kendali penuh eksekusi produksi, analitik, dan persetujuan koreksi.',
  [UserRole.SUPERVISOR]: 'Kendali shift, rilis work order, dan koreksi shift berjalan.',
  [UserRole.OPERATOR]: 'Eksekusi work order yang ditugaskan pada terminal shop floor.',
  [UserRole.PPIC]: 'Perencanaan production order, work order, dan penjadwalan.',
  [UserRole.QUALITY]: 'Pencatatan dan analisis reject serta traceability kualitas.',
  [UserRole.SALES]:
    'Penerimaan dan pencatatan Customer Order, beserta status pemenuhannya. Tanpa akses planning maupun eksekusi produksi.',
  [UserRole.MAINTENANCE]:
    'Preventive, corrective, dan emergency maintenance mesin. Tanpa akses eksekusi produksi.',
  [UserRole.WAREHOUSE]:
    'Inventory, issue, return, dan penyesuaian stok material beserta ledger transaksinya.',
  [UserRole.WORKFORCE_ADMIN]:
    'Skill, kualifikasi, penugasan shift, dan ketersediaan operator. Tanpa akses eksekusi produksi.',
  [UserRole.ADMIN]: 'Administrasi tenant: pengguna, peran, master data, dan audit.',
};

export function isPrivileged(permission: PermissionId): boolean {
  return PERMISSION_CATALOG.find((p) => p.id === permission)?.privileged ?? false;
}
