import test from 'node:test';
import assert from 'node:assert/strict';
import { UserRole } from '@factory-vision/domain-types';
import type { PermissionId } from '@factory-vision/domain-types';
import { SYSTEM_ROLE_PERMISSIONS, ROLE_LANDING_PATH } from '../src/modules/rbac/permissions.js';

/**
 * Console navigation visibility per role.
 *
 * The console renders its navigation by filtering each entry against the
 * session's permissions, and guards each route with the same identifier. So the
 * question "what does a Sales user see?" is answerable from the permission set
 * alone — which is what this asserts, rather than mounting React.
 *
 * The nav table below mirrors `apps/console/src/app/App.tsx`. Keeping it here
 * makes a divergence a test failure instead of a screen a role can open and
 * then be refused by the API.
 */

interface NavEntry {
  label: string;
  path: string;
  permission: PermissionId;
}

const CONSOLE_NAV: NavEntry[] = [
  // Eksekutif & Real-time
  { label: 'Executive Dashboard', path: '/', permission: 'dashboard:view' },
  { label: 'Live Production Board', path: '/live-board', permission: 'work_order:view' },
  { label: 'Target vs Produksi Aktual', path: '/target-vs-actual', permission: 'analytics:view' },
  // Demand & Perencanaan
  { label: 'Penerimaan Order', path: '/order-receiving', permission: 'customer_order:create' },
  { label: 'Customer Order', path: '/customer-orders', permission: 'customer_order:view' },
  { label: 'Demand Forecast', path: '/demand-forecast', permission: 'demand_forecast:view' },
  { label: 'Capacity Planning', path: '/capacity-planning', permission: 'capacity_plan:view' },
  { label: 'Production Plan', path: '/production-plans', permission: 'production_plan:view' },
  // Eksekusi Produksi
  { label: 'Work Order', path: '/work-orders', permission: 'work_order:view' },
  { label: 'Performa & Serah Terima Shift', path: '/shift-handover', permission: 'shift:view' },
  // Analitik
  { label: 'Investigasi OEE', path: '/oee', permission: 'analytics:view' },
  { label: 'Analisis Bottleneck', path: '/bottlenecks', permission: 'analytics:view' },
  { label: 'Pareto Alasan Downtime', path: '/downtime-analytics', permission: 'analytics:view' },
  // Tata kelola
  { label: 'Koreksi Data', path: '/corrections', permission: 'production_record:correct' },
  { label: 'Audit Trail', path: '/audit-logs', permission: 'audit:view' },
  // Master data
  { label: 'Customer', path: '/master-customers', permission: 'customer:view' },
  { label: 'Proses Produksi', path: '/settings?tab=processes', permission: 'master_data:view' },
];

function visibleTo(role: UserRole): string[] {
  const held = SYSTEM_ROLE_PERMISSIONS[role];
  return CONSOLE_NAV.filter((entry) => held.includes(entry.permission)).map((e) => e.label);
}

test('SALES sees the order workflow and nothing downstream of it', () => {
  const visible = visibleTo(UserRole.SALES);

  for (const expected of ['Penerimaan Order', 'Customer Order', 'Customer']) {
    assert.ok(visible.includes(expected), `SALES should see "${expected}"`);
  }

  for (const hidden of [
    'Demand Forecast',
    'Capacity Planning',
    'Production Plan',
    'Work Order',
    'Live Production Board',
    'Koreksi Data',
    'Audit Trail',
    'Investigasi OEE',
  ]) {
    assert.ok(!visible.includes(hidden), `SALES must not see "${hidden}"`);
  }
});

test('SALES lands on the screen where its work starts', () => {
  assert.equal(ROLE_LANDING_PATH[UserRole.SALES], '/order-receiving');
  // And the landing path must be a screen the role can actually open.
  const landing = CONSOLE_NAV.find((e) => e.path === ROLE_LANDING_PATH[UserRole.SALES]);
  assert.ok(landing, 'the landing path must be a known destination');
  assert.ok(
    SYSTEM_ROLE_PERMISSIONS[UserRole.SALES].includes(landing.permission),
    'SALES must hold the permission its landing page needs'
  );
});

test('every role lands somewhere it is entitled to open', () => {
  for (const role of Object.values(UserRole)) {
    const path = ROLE_LANDING_PATH[role];
    const entry = CONSOLE_NAV.find((e) => e.path === path);
    if (!entry) continue; // Operator terminal and settings deep links are elsewhere.
    assert.ok(
      SYSTEM_ROLE_PERMISSIONS[role].includes(entry.permission),
      `${role} lands on ${path} but lacks ${entry.permission}`
    );
  }
});

test('PPIC sees planning but not Order Receiving', () => {
  const visible = visibleTo(UserRole.PPIC);
  assert.ok(visible.includes('Demand Forecast'));
  assert.ok(visible.includes('Capacity Planning'));
  assert.ok(visible.includes('Production Plan'));
  assert.ok(visible.includes('Customer Order'), 'PPIC still reads orders to plan against them');
  assert.ok(!visible.includes('Penerimaan Order'), 'receiving an order is Sales’ job now');
});

test('OPERATOR sees none of the console planning surface', () => {
  const visible = visibleTo(UserRole.OPERATOR);
  for (const hidden of [
    'Penerimaan Order',
    'Customer Order',
    'Demand Forecast',
    'Capacity Planning',
    'Production Plan',
    'Customer',
  ]) {
    assert.ok(!visible.includes(hidden), `OPERATOR must not see "${hidden}"`);
  }
});

test('every navigation entry names a permission that exists', () => {
  const catalogue = new Set(Object.values(SYSTEM_ROLE_PERMISSIONS)[0].concat(
    ...Object.values(SYSTEM_ROLE_PERMISSIONS)
  ));
  for (const entry of CONSOLE_NAV) {
    assert.ok(
      catalogue.has(entry.permission),
      `nav "${entry.label}" needs ${entry.permission}, which no role holds`
    );
  }
});
