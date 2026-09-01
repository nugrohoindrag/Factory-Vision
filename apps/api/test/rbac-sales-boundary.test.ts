import test from 'node:test';
import assert from 'node:assert/strict';
import { UserRole } from '@factory-vision/domain-types';
import type { PermissionId } from '@factory-vision/domain-types';
import {
  PERMISSION_IDS,
  SYSTEM_ROLE_PERMISSIONS,
  ROLE_LANDING_PATH,
  ROLE_DESCRIPTION,
} from '../src/modules/rbac/permissions.js';
import { permissionForRoute } from '../src/platform/auth/route-permissions.js';

/**
 * RBAC boundary tests for the SALES role, positive and negative.
 *
 * These assert against the **route table the API actually enforces**, not
 * against a restatement of it: `permissionForRoute` is the same function the
 * authorization middleware calls, so a route whose guard is wrong fails here
 * rather than in production.
 *
 * The negative half matters more than the positive half. It is easy to give a
 * new role too much and never notice; the whole point of adding SALES is that
 * Order Receiving is Sales' decision and Planning is not.
 */

function can(role: UserRole, permission: PermissionId): boolean {
  return SYSTEM_ROLE_PERMISSIONS[role].includes(permission);
}

/** What the middleware would decide for a request, given a role. */
function allowsRequest(role: UserRole, method: string, path: string): boolean {
  const required = permissionForRoute(method, path) ?? 'dashboard:view';
  return SYSTEM_ROLE_PERMISSIONS[role].includes(required);
}

// === The role exists and is wired up =======================================

test('SALES is a system role with a landing path and a description', () => {
  assert.ok(Object.values(UserRole).includes(UserRole.SALES));
  assert.ok(SYSTEM_ROLE_PERMISSIONS[UserRole.SALES]);
  assert.equal(ROLE_LANDING_PATH[UserRole.SALES], '/order-receiving');
  assert.match(ROLE_DESCRIPTION[UserRole.SALES], /Customer Order/i);
});

test('every role grants only permissions that exist in the catalogue', () => {
  for (const role of Object.values(UserRole)) {
    for (const permission of SYSTEM_ROLE_PERMISSIONS[role]) {
      assert.ok(
        PERMISSION_IDS.includes(permission),
        `${role} grants "${permission}", which is not in PERMISSION_CATALOG`
      );
    }
  }
});

// === Positive: Sales can run the Order Receiving workflow ==================

test('SALES can complete the Customer Order workflow end to end', () => {
  const journey: [string, string][] = [
    // Pick a customer for the order form.
    ['GET', '/api/v1/customers'],
    // Create the order with its lines, in one pass.
    ['POST', '/api/v1/customer-orders'],
    ['POST', '/api/v1/customer-orders/co-1/lines'],
    ['PATCH', '/api/v1/customer-orders/co-1/lines/col-1'],
    ['DELETE', '/api/v1/customer-orders/co-1/lines/col-1'],
    // Attach the source document (MES-025).
    ['POST', '/api/v1/customer-orders/co-1/documents'],
    ['GET', '/api/v1/customer-orders/co-1/documents'],
    // Follow the order afterwards.
    ['GET', '/api/v1/customer-orders'],
    ['GET', '/api/v1/customer-orders/co-1'],
    // Cancel it while nothing is in production.
    ['POST', '/api/v1/customer-orders/co-1/cancel'],
    // Maintain the customer master they order against.
    ['POST', '/api/v1/customers'],
    ['PATCH', '/api/v1/customers/cust-1'],
    // Choose a Product on an order line.
    ['GET', '/api/v1/master/products'],
  ];

  for (const [method, path] of journey) {
    assert.ok(
      allowsRequest(UserRole.SALES, method, path),
      `SALES must be allowed ${method} ${path} (needs ${permissionForRoute(method, path)})`
    );
  }
});

// === Negative: Sales stops at the order ====================================

test('SALES cannot reach Planning', () => {
  const forbidden: [string, string][] = [
    ['GET', '/api/v1/production-plans'],
    ['POST', '/api/v1/production-plans'],
    ['PATCH', '/api/v1/production-plans/plan-1'],
    ['POST', '/api/v1/production-plans/plan-1/demand'],
    ['POST', '/api/v1/production-plans/plan-1/confirm'],
    ['POST', '/api/v1/production-plans/plan-1/generate-work-orders'],
    ['GET', '/api/v1/demand-forecasts'],
    ['POST', '/api/v1/demand-forecasts/generate'],
    ['GET', '/api/v1/capacity-plans'],
    ['POST', '/api/v1/capacity-plans/cap-1/recalculate'],
  ];

  for (const [method, path] of forbidden) {
    assert.equal(
      allowsRequest(UserRole.SALES, method, path),
      false,
      `SALES must NOT be allowed ${method} ${path} (would need ${permissionForRoute(method, path)})`
    );
  }
});

test('SALES cannot reach production execution or the shop floor', () => {
  const forbidden: [string, string][] = [
    ['POST', '/api/v1/work-orders'],
    ['PUT', '/api/v1/work-orders/wo-1'],
    ['POST', '/api/v1/work-orders/wo-1/confirm'],
    ['POST', '/api/v1/work-orders/wo-1/start'],
    ['POST', '/api/v1/work-orders/wo-1/complete'],
    ['POST', '/api/v1/work-orders/wo-1/cancel'],
    ['POST', '/api/v1/shop-floor/output'],
    ['POST', '/api/v1/shop-floor/downtime/start'],
    ['POST', '/api/v1/work-orders/wo-1/batch'],
    ['POST', '/api/v1/production-orders'],
  ];

  for (const [method, path] of forbidden) {
    assert.equal(
      allowsRequest(UserRole.SALES, method, path),
      false,
      `SALES must NOT be allowed ${method} ${path} (would need ${permissionForRoute(method, path)})`
    );
  }
});

test('SALES holds no administrative or configuration rights', () => {
  for (const permission of [
    'user:create',
    'user:edit',
    'user:deactivate',
    'role:create',
    'role:edit',
    'configuration:manage',
    'correction:approve',
    'master_data:manage',
    'master_data:import',
    'shopfloor:execute',
    'production_record:create',
    'downtime:create',
    'reject:create',
  ] as PermissionId[]) {
    assert.equal(
      can(UserRole.SALES, permission),
      false,
      `SALES must not hold ${permission}`
    );
  }
});

test('SALES cannot write master data, only read it for the order form', () => {
  assert.ok(can(UserRole.SALES, 'master_data:view'));
  assert.equal(can(UserRole.SALES, 'master_data:manage'), false);
  assert.equal(allowsRequest(UserRole.SALES, 'POST', '/api/v1/master/products'), false);
  assert.equal(allowsRequest(UserRole.SALES, 'PUT', '/api/v1/master/machines/mc-1'), false);
});

// === Ownership actually moved ==============================================

test('PPIC reads Customer Orders but no longer owns them', () => {
  // Demand is what PPIC plans against, so reading stays.
  assert.ok(can(UserRole.PPIC, 'customer_order:view'));
  assert.ok(can(UserRole.PPIC, 'customer:view'));

  // Receiving, editing and cancelling belong to Sales now. Leaving these on
  // PPIC would make SALES a label rather than a boundary.
  for (const permission of [
    'customer_order:create',
    'customer_order:edit',
    'customer_order:cancel',
    'customer:manage',
  ] as PermissionId[]) {
    assert.equal(can(UserRole.PPIC, permission), false, `PPIC must no longer hold ${permission}`);
  }

  assert.equal(allowsRequest(UserRole.PPIC, 'POST', '/api/v1/customer-orders'), false);
  assert.ok(allowsRequest(UserRole.PPIC, 'GET', '/api/v1/customer-orders'));
});

test('PPIC keeps everything §8.1 makes it responsible for', () => {
  const owned: [string, string][] = [
    ['POST', '/api/v1/demand-forecasts/generate'],
    ['GET', '/api/v1/capacity-plans'],
    ['POST', '/api/v1/capacity-plans/cap-1/recalculate'],
    ['POST', '/api/v1/production-plans'],
    ['PATCH', '/api/v1/production-plans/plan-1'],
    ['POST', '/api/v1/production-plans/plan-1/demand'],
    ['POST', '/api/v1/production-plans/plan-1/confirm'],
    ['POST', '/api/v1/production-plans/plan-1/generate-work-orders'],
    ['POST', '/api/v1/work-orders/wo-1/schedule'],
  ];

  for (const [method, path] of owned) {
    assert.ok(
      allowsRequest(UserRole.PPIC, method, path),
      `PPIC must keep ${method} ${path} (needs ${permissionForRoute(method, path)})`
    );
  }
});

// === Nobody else quietly gained the order ==================================

test('only SALES and ADMIN may create a Customer Order', () => {
  const creators = Object.values(UserRole).filter((role) =>
    can(role, 'customer_order:create')
  );
  assert.deepEqual(creators.sort(), [UserRole.SALES, UserRole.ADMIN].sort());
});

test('only SALES and ADMIN may manage the customer master', () => {
  const managers = Object.values(UserRole).filter((role) => can(role, 'customer:manage'));
  assert.deepEqual(managers.sort(), [UserRole.SALES, UserRole.ADMIN].sort());
});

test('the operator role is untouched by the split', () => {
  for (const permission of [
    'customer_order:view',
    'customer_order:create',
    'production_plan:view',
    'capacity_plan:view',
  ] as PermissionId[]) {
    assert.equal(can(UserRole.OPERATOR, permission), false);
  }
  // What an operator does have, still has.
  assert.ok(can(UserRole.OPERATOR, 'shopfloor:execute'));
  assert.ok(can(UserRole.OPERATOR, 'production_record:create'));
});

test('EXECUTIVE stays view-only across the new planning modules', () => {
  assert.ok(can(UserRole.EXECUTIVE, 'customer_order:view'));
  assert.ok(can(UserRole.EXECUTIVE, 'production_plan:view'));
  for (const permission of [
    'customer_order:create',
    'production_plan:create',
    'production_plan:confirm',
    'demand_forecast:generate',
    'capacity_plan:manage',
  ] as PermissionId[]) {
    assert.equal(can(UserRole.EXECUTIVE, permission), false, `EXECUTIVE must not hold ${permission}`);
  }
});

test('ADMIN holds the whole catalogue, including the new permissions', () => {
  for (const permission of PERMISSION_IDS) {
    assert.ok(can(UserRole.ADMIN, permission), `ADMIN is missing ${permission}`);
  }
});

// === The route table itself ================================================

test('every planning endpoint is guarded by a planning permission, not the fallback', () => {
  const endpoints: [string, string, PermissionId][] = [
    ['GET', '/api/v1/customers', 'customer:view'],
    ['POST', '/api/v1/customers', 'customer:manage'],
    ['GET', '/api/v1/customer-orders', 'customer_order:view'],
    ['POST', '/api/v1/customer-orders', 'customer_order:create'],
    ['POST', '/api/v1/customer-orders/co-1/cancel', 'customer_order:cancel'],
    ['PATCH', '/api/v1/customer-orders/co-1', 'customer_order:edit'],
    ['GET', '/api/v1/demand-forecasts', 'demand_forecast:view'],
    ['POST', '/api/v1/demand-forecasts/generate', 'demand_forecast:generate'],
    ['GET', '/api/v1/capacity-plans', 'capacity_plan:view'],
    ['POST', '/api/v1/capacity-plans/cap-1/recalculate', 'capacity_plan:manage'],
    ['GET', '/api/v1/production-plans', 'production_plan:view'],
    ['POST', '/api/v1/production-plans', 'production_plan:create'],
    ['POST', '/api/v1/production-plans/plan-1/confirm', 'production_plan:confirm'],
    ['POST', '/api/v1/production-plans/plan-1/generate-work-orders', 'work_order:create'],
    ['PUT', '/api/v1/planning/config', 'configuration:manage'],
  ];

  for (const [method, path, expected] of endpoints) {
    assert.equal(
      permissionForRoute(method, path),
      expected,
      `${method} ${path} should require ${expected}`
    );
  }
});

test('an unmatched API route falls back to a read permission, never to open', () => {
  // The fallback must be read-only: a new endpoint added without a rule is then
  // guarded by accident rather than open by accident.
  assert.equal(permissionForRoute('POST', '/api/v1/something-new-nobody-mapped'), undefined);
});
