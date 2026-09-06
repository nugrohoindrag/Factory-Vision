export interface RoleSeed {
  role: string;
  name: string;
  description: string;
}

export const COMMON_ROLES: RoleSeed[] = [
  { role: 'PLANT_MANAGER', name: 'Plant Manager', description: 'Otoritas eksekutif dan manajerial penuh operasional pabrik' },
  { role: 'PRODUCTION_SUPERVISOR', name: 'Production Supervisor', description: 'Pengawas lini produksi, dispatch work order, dan persetujuan output' },
  { role: 'OPERATOR', name: 'Operator Produksi', description: 'Pelaksana operasional pada mesin dan stasiun kerja terminal shop floor' },
  { role: 'QUALITY_INSPECTOR', name: 'Quality Inspector', description: 'Pemeriksaan mutu, pencatatan reject, dan ketertelusuran batch' },
  { role: 'PPIC', name: 'PPIC Planner', description: 'Perencanaan kebutuhan kapasitas, order demand, dan alokasi material' },
  { role: 'MAINTENANCE_ENGINEER', name: 'Maintenance Engineer', description: 'Penanganan insiden downtime, preventive maintenance mesin dan cetakan' },
];
