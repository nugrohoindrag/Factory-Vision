import http from 'http';
import express from 'express';
import cors from 'cors';
import { CorrectionEntityType, UserRole, WorkOrderStatus } from '@factory-vision/domain-types';
import { tenantMiddleware } from './platform/tenancy/tenant.middleware.js';
import { RealtimeGateway } from './platform/realtime/socket.gateway.js';
import { MasterDataService } from './modules/master-data/master-data.service.js';
import { ProductionService } from './modules/production/production.service.js';
import { ShopFloorService } from './modules/shopfloor/shopfloor.service.js';
import { PerformanceService } from './modules/performance/performance.service.js';
import { ReportingService } from './modules/reporting/reporting.service.js';
import { CorrectionService } from './modules/correction/correction.service.js';
import { AuditService } from './modules/audit/audit.service.js';
import { RbacService } from './modules/rbac/rbac.service.js';
import { AuthService } from './modules/auth/auth.service.js';
import { OeeService } from './modules/oee/oee.service.js';
import { CsvService } from './modules/csv/csv.service.js';
import { ShiftHandoverService } from './modules/shift/shift.service.js';
import { errorMiddleware, requestIdMiddleware, route } from './platform/http/envelope.js';
import { validate } from './platform/http/validate.js';
import { ApiError } from './platform/http/api-error.js';
import { attachPrincipal, scope } from './platform/auth/auth.middleware.js';
import { authorizeRoutes } from './platform/auth/route-permissions.js';
import { internalRoutes } from './routes/internal.routes.js';
import { ClientManagementService } from './modules/client-management/client.service.js';
import { ClientAdminService } from './modules/client-management/client.admin.service.js';
import { InternalAuthService } from './modules/client-management/internal-auth.service.js';
import { checkDatabase } from './platform/db/pool.js';
import {
  assertDatabaseReady,
  ensureTenant,
  hydrateReferenceData,
  seedDemoPlant,
  seedDemoHistory,
} from './platform/bootstrap.js';
import { withTenant } from './platform/db/pool.js';
import { MasterDataRepository } from './modules/master-data/master-data.repository.js';
import { authRoutes } from './routes/auth.routes.js';
import { rbacRoutes } from './routes/rbac.routes.js';
import { shiftRoutes } from './routes/shift.routes.js';
import { csvRoutes } from './routes/csv.routes.js';
import { oeeRoutes } from './routes/oee.routes.js';
import { metaRoutes } from './routes/meta.routes.js';
import { SEED_DEMO_DATA } from './platform/config/demo-seed.js';

const app = express();
const server = http.createServer(app);
const realtimeGateway = new RealtimeGateway(server);

/**
 * Authentication and authorization are enforced by default and can be switched
 * off for a local demo (`AUTH_REQUIRED=false`). The pilot's on-premise install
 * runs with it on, US-003 requires the API to apply the same rules as the UI,
 * and a flag that defaults to open would quietly defeat that.
 */
const AUTH_REQUIRED = process.env.AUTH_REQUIRED !== 'false';

app.use(cors({ exposedHeaders: ['X-Request-Id'] }));
app.use(express.json({ limit: '8mb' }));
app.use(requestIdMiddleware);
app.use(tenantMiddleware);

// Initialize Services
const masterDataService = new MasterDataService();
const masterDataRepository = new MasterDataRepository();
const productionService = new ProductionService();
const shopFloorService = new ShopFloorService(productionService, masterDataService);
const performanceService = new PerformanceService(productionService, shopFloorService, masterDataService);
const reportingService = new ReportingService(productionService, shopFloorService, masterDataService);
const correctionService = new CorrectionService(productionService);
const auditService = new AuditService();

// The vendor's own client management. It has its own store, its own sessions
// and its own audit trail, so a customer's console cannot reach it.
const internalAuthService = new InternalAuthService();
const clientManagementService = new ClientManagementService(
  masterDataService,
  productionService,
  shopFloorService
);
const clientAdminService = new ClientAdminService();
const rbacService = new RbacService(masterDataService);
const authService = new AuthService(masterDataService, rbacService, auditService);
const oeeService = new OeeService(masterDataService, productionService, shopFloorService);
const csvService = new CsvService(masterDataService);
const shiftHandoverService = new ShiftHandoverService(masterDataService, productionService, shopFloorService);

correctionService.attachDependencies({ shopFloor: shopFloorService, audit: auditService, oee: oeeService });

// Resolve the bearer token before anything reads `req.context`, then apply the
// route to permission policy in one place (US-003, US-054).
app.use(attachPrincipal(authService));
app.use(authorizeRoutes({ enabled: AUTH_REQUIRED }));

// PostgreSQL must be reachable and migrated before anything is served: the
// shop floor's records live there, not in this process (persistence fix §7).
const PILOT_TENANT = 'tenant-pilot-factory-01';

await assertDatabaseReady();
await ensureTenant(PILOT_TENANT);

if (SEED_DEMO_DATA) {
  const plant = await seedDemoPlant(PILOT_TENANT, {
    masterData: masterDataService,
    production: productionService,
  });
  // eslint-disable-next-line no-console
  console.log(
    `[seed] demo plant: ${plant.lines} lines, ${plant.products} products, ` +
      `${plant.productionOrders} production orders, ${plant.workOrders} work orders`
  );

  const history = await seedDemoHistory(PILOT_TENANT, {
    masterData: masterDataService,
    production: productionService,
    shopFloor: shopFloorService,
  });
  // eslint-disable-next-line no-console
  console.log(
    `[seed] shop-floor history: ${history.productionCount} production, ${history.downtimeCount} downtime records across processes`
  );
}

// Shifts, operators, users and roles are read synchronously all over the API,
// so they are served from memory — but the memory is rebuilt from PostgreSQL
// here, and every mutation writes there first. The bootstrap administrator is
// established afterwards so its account and password hash land in the database
// alongside them.
const reference = await hydrateReferenceData(PILOT_TENANT, {
  masterData: masterDataService,
  rbac: rbacService,
  auth: authService,
});
await authService.bootstrapAdminCredential();
const credentials = authService.hydrateCredentials(PILOT_TENANT);

// eslint-disable-next-line no-console
console.log(
  `[db] reference data: ${reference.shifts} shifts, ${reference.operators} operators, ` +
    `${reference.users} users, ${reference.roles} roles, ` +
    `${credentials.users + credentials.operators} stored credentials`
);

const persisted = await shopFloorService.counts(PILOT_TENANT);
// eslint-disable-next-line no-console
console.log(
  `[db] persisted for ${PILOT_TENANT}: ${persisted.production} production records, ` +
    `${persisted.downtime} downtime records, ${persisted.machineStates} machine state entries`
);

// Health check
app.get('/health', async (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString(), tenant: req.context?.tenantId });
});

// Master Data Endpoints
app.get('/api/v1/master/plants', async (req, res) => {
  res.json(masterDataService.getPlants(req.context!.tenantId));
});

app.get('/api/v1/master/lines', async (req, res) => {
  res.json(masterDataService.getLines(req.context!.tenantId));
});

app.post('/api/v1/master/lines', async (req, res) => {
  const line = masterDataService.createLine(req.context!.tenantId, req.body);
  await auditService.record({
    tenantId: req.context!.tenantId,
    actorType: 'USER',
    actorId: 'Admin',
    entityType: 'production_line',
    entityId: line.id,
    action: 'CREATE',
    newValue: line,
  });
  res.status(201).json(line);
});

app.put('/api/v1/master/lines/:id', async (req, res, next) => {
  try {
    const line = masterDataService.updateLine(req.context!.tenantId, req.params.id, req.body);
    await auditService.record({
      tenantId: req.context!.tenantId,
      actorType: 'USER',
      actorId: 'Admin',
      entityType: 'production_line',
      entityId: line.id,
      action: 'UPDATE',
      newValue: line,
    });
    res.json(line);
  } catch (err) {
    next(err);
  }
});

app.delete('/api/v1/master/lines/:id', async (req, res, next) => {
  try {
    masterDataService.deleteLine(req.context!.tenantId, req.params.id);
    await auditService.record({
      tenantId: req.context!.tenantId,
      actorType: 'USER',
      actorId: 'Admin',
      entityType: 'production_line',
      entityId: req.params.id,
      action: 'DELETE',
    });
    res.json({ success: true, message: 'Production line deleted successfully' });
  } catch (err) {
    next(err);
  }
});

app.get('/api/v1/master/machines', async (req, res) => {
  res.json(masterDataService.getMachines(req.context!.tenantId));
});

app.post('/api/v1/master/machines', async (req, res) => {
  const machine = masterDataService.createMachine(req.context!.tenantId, req.body);
  await auditService.record({
    tenantId: req.context!.tenantId,
    actorType: 'USER',
    actorId: 'Admin',
    entityType: 'machine',
    entityId: machine.id,
    action: 'CREATE',
    newValue: machine,
  });
  res.status(201).json(machine);
});

app.put('/api/v1/master/machines/:id', async (req, res, next) => {
  try {
    const machine = masterDataService.updateMachine(req.context!.tenantId, req.params.id, req.body);
    await auditService.record({
      tenantId: req.context!.tenantId,
      actorType: 'USER',
      actorId: 'Admin',
      entityType: 'machine',
      entityId: machine.id,
      action: 'UPDATE',
      newValue: machine,
    });
    res.json(machine);
  } catch (err) {
    next(err);
  }
});

app.delete('/api/v1/master/machines/:id', async (req, res, next) => {
  try {
    masterDataService.deleteMachine(req.context!.tenantId, req.params.id);
    await auditService.record({
      tenantId: req.context!.tenantId,
      actorType: 'USER',
      actorId: 'Admin',
      entityType: 'machine',
      entityId: req.params.id,
      action: 'DELETE',
    });
    res.json({ success: true, message: 'Machine deleted successfully' });
  } catch (err) {
    next(err);
  }
});

app.get('/api/v1/master/products', async (req, res) => {
  res.json(masterDataService.getProducts(req.context!.tenantId));
});

app.post('/api/v1/master/products', async (req, res) => {
  const product = masterDataService.createProduct(req.context!.tenantId, req.body);
  await auditService.record({
    tenantId: req.context!.tenantId,
    actorType: 'USER',
    actorId: 'Admin',
    entityType: 'product',
    entityId: product.id,
    action: 'CREATE',
    newValue: product,
  });
  res.status(201).json(product);
});

app.put('/api/v1/master/products/:id', async (req, res, next) => {
  try {
    const product = masterDataService.updateProduct(req.context!.tenantId, req.params.id, req.body);
    await auditService.record({
      tenantId: req.context!.tenantId,
      actorType: 'USER',
      actorId: 'Admin',
      entityType: 'product',
      entityId: product.id,
      action: 'UPDATE',
      newValue: product,
    });
    res.json(product);
  } catch (err) {
    next(err);
  }
});

app.delete('/api/v1/master/products/:id', async (req, res, next) => {
  try {
    masterDataService.deleteProduct(req.context!.tenantId, req.params.id);
    await auditService.record({
      tenantId: req.context!.tenantId,
      actorType: 'USER',
      actorId: 'Admin',
      entityType: 'product',
      entityId: req.params.id,
      action: 'DELETE',
    });
    res.json({ success: true, message: 'Product deleted successfully' });
  } catch (err) {
    next(err);
  }
});

app.get('/api/v1/master/operators', async (req, res) => {
  res.json(masterDataService.getOperators(req.context!.tenantId));
});

app.post('/api/v1/master/operators', async (req, res) => {
  const operator = await masterDataService.createOperator(req.context!.tenantId, req.body);
  await auditService.record({
    tenantId: req.context!.tenantId,
    actorType: 'USER',
    actorId: 'Admin',
    entityType: 'operator',
    entityId: operator.id,
    action: 'CREATE',
    newValue: operator,
  });
  res.status(201).json(operator);
});

app.put('/api/v1/master/operators/:id', async (req, res, next) => {
  try {
    const operator = await masterDataService.updateOperator(req.context!.tenantId, req.params.id, req.body);
    await auditService.record({
      tenantId: req.context!.tenantId,
      actorType: 'USER',
      actorId: 'Admin',
      entityType: 'operator',
      entityId: operator.id,
      action: 'UPDATE',
      newValue: operator,
    });
    res.json(operator);
  } catch (err) {
    next(err);
  }
});

app.delete('/api/v1/master/operators/:id', async (req, res, next) => {
  try {
    await masterDataService.deleteOperator(req.context!.tenantId, req.params.id);
    await auditService.record({
      tenantId: req.context!.tenantId,
      actorType: 'USER',
      actorId: 'Admin',
      entityType: 'operator',
      entityId: req.params.id,
      action: 'DELETE',
    });
    res.json({ success: true, message: 'Operator deleted successfully' });
  } catch (err) {
    next(err);
  }
});

app.get('/api/v1/master/shifts', async (req, res) => {
  res.json(masterDataService.getShifts(req.context!.tenantId));
});

app.get('/api/v1/master/downtime-reasons', async (req, res) => {
  res.json(masterDataService.getDowntimeReasons(req.context!.tenantId));
});

app.post('/api/v1/master/downtime-reasons', async (req, res) => {
  const reason = masterDataService.createDowntimeReason(req.context!.tenantId, req.body);
  await auditService.record({
    tenantId: req.context!.tenantId,
    actorType: 'USER',
    actorId: 'Admin',
    entityType: 'downtime_reason',
    entityId: reason.id,
    action: 'CREATE',
    newValue: reason,
  });
  res.status(201).json(reason);
});

app.put('/api/v1/master/downtime-reasons/:id', async (req, res, next) => {
  try {
    const reason = masterDataService.updateDowntimeReason(req.context!.tenantId, req.params.id, req.body);
    await auditService.record({
      tenantId: req.context!.tenantId,
      actorType: 'USER',
      actorId: 'Admin',
      entityType: 'downtime_reason',
      entityId: reason.id,
      action: 'UPDATE',
      newValue: reason,
    });
    res.json(reason);
  } catch (err) {
    next(err);
  }
});

app.delete('/api/v1/master/downtime-reasons/:id', async (req, res, next) => {
  try {
    masterDataService.deleteDowntimeReason(req.context!.tenantId, req.params.id);
    await auditService.record({
      tenantId: req.context!.tenantId,
      actorType: 'USER',
      actorId: 'Admin',
      entityType: 'downtime_reason',
      entityId: req.params.id,
      action: 'DELETE',
    });
    res.json({ success: true, message: 'Downtime reason deleted successfully' });
  } catch (err) {
    next(err);
  }
});

app.get('/api/v1/master/reject-reasons', async (req, res) => {
  res.json(masterDataService.getRejectReasons(req.context!.tenantId));
});

app.post('/api/v1/master/reject-reasons', async (req, res) => {
  const reason = masterDataService.createRejectReason(req.context!.tenantId, req.body);
  await auditService.record({
    tenantId: req.context!.tenantId,
    actorType: 'USER',
    actorId: 'Admin',
    entityType: 'reject_reason',
    entityId: reason.id,
    action: 'CREATE',
    newValue: reason,
  });
  res.status(201).json(reason);
});

app.put('/api/v1/master/reject-reasons/:id', async (req, res, next) => {
  try {
    const reason = masterDataService.updateRejectReason(req.context!.tenantId, req.params.id, req.body);
    await auditService.record({
      tenantId: req.context!.tenantId,
      actorType: 'USER',
      actorId: 'Admin',
      entityType: 'reject_reason',
      entityId: reason.id,
      action: 'UPDATE',
      newValue: reason,
    });
    res.json(reason);
  } catch (err) {
    next(err);
  }
});

app.delete('/api/v1/master/reject-reasons/:id', async (req, res, next) => {
  try {
    masterDataService.deleteRejectReason(req.context!.tenantId, req.params.id);
    await auditService.record({
      tenantId: req.context!.tenantId,
      actorType: 'USER',
      actorId: 'Admin',
      entityType: 'reject_reason',
      entityId: req.params.id,
      action: 'DELETE',
    });
    res.json({ success: true, message: 'Reject reason deleted successfully' });
  } catch (err) {
    next(err);
  }
});

// PRD v1.3: User Management & Access Control Endpoints
app.get('/api/v1/master/users', async (req, res) => {
  res.json(masterDataService.getUsers(req.context!.tenantId));
});

app.get('/api/v1/master/users/:id', async (req, res) => {
  const user = masterDataService.getUserById(req.context!.tenantId, req.params.id);
  if (!user) return res.status(404).json({ message: 'User not found' });
  res.json(user);
});

/**
 * US-004, Create & assign user.
 *
 * An initial password may be supplied so the account can be used immediately;
 * it is hashed by AuthService and never stored on the user record, which the
 * console reads freely.
 */
app.post(
  '/api/v1/master/users',
  route(async (req, res) => {
    const tenantId = req.context!.tenantId;
    const v = validate(req.body);
    const email = v.email('email');
    const name = v.string('name', { min: 2, max: 120 });
    const role = v.oneOf('role', Object.values(UserRole) as UserRole[]);
    const scopeLevel = v.oneOf('scopeLevel', ['TENANT', 'PLANT', 'LINE', 'WORK_CENTER'] as const, {
      optional: true,
    });
    const scopeId = v.string('scopeId', { optional: true });
    const password = v.string('password', { optional: true, min: 8 });
    v.done();

    if (masterDataService.getUsers(tenantId).some((u) => u.email.toLowerCase() === email!.toLowerCase())) {
      throw ApiError.conflict('Email tersebut sudah terdaftar.');
    }
    if (scopeLevel && scopeLevel !== 'TENANT' && !scopeId) {
      throw ApiError.validation('Scope ID wajib diisi untuk scope selain TENANT.', [
        { field: 'scopeId', code: 'REQUIRED', message: 'Pilih plant, line, atau work center.' },
      ]);
    }

    // Built field by field rather than spreading the request: spreading would
    // carry `password` onto the stored record and straight back out in the
    // response, since AppUser is the shape the console reads freely.
    const user = await masterDataService.createUser(tenantId, {
      email: email!,
      name: name!,
      role: role!,
      accountType: req.body.accountType === 'OPERATOR' ? 'OPERATOR' : 'APPLICATION_USER',
      scopeLevel: scopeLevel ?? 'TENANT',
      scopeId,
      employeeNumber: typeof req.body.employeeNumber === 'string' ? req.body.employeeNumber : undefined,
      status: req.body.status === 'ACTIVE' ? 'ACTIVE' : 'INVITED',
    });

    if (password) await authService.registerUserPassword(tenantId, user.id, password);

    recordAudit(req, 'app_user', user.id, 'CREATE_USER', undefined, {
      email: user.email,
      role: user.role,
      scopeLevel: user.scopeLevel,
      scopeId: user.scopeId,
      status: user.status,
    });
    res.status(201).json(user);
  })
);

app.put(
  '/api/v1/master/users/:id',
  route(async (req, res) => {
    const tenantId = req.context!.tenantId;
    const before = masterDataService.getUserById(tenantId, req.params.id);
    if (!before) throw ApiError.notFound('Pengguna tidak ditemukan.');
    const previous = {
      role: before.role,
      scopeLevel: before.scopeLevel,
      scopeId: before.scopeId,
      status: before.status,
    };

    const user = await masterDataService.updateUser(tenantId, req.params.id, req.body);

    // distinguishes a role change from a scope change; recording the
    // specific action is what makes the audit trail answerable later.
    const roleChanged = previous.role !== user.role;
    const scopeChanged = previous.scopeLevel !== user.scopeLevel || previous.scopeId !== user.scopeId;
    const action = roleChanged ? 'ROLE_CHANGED' : scopeChanged ? 'SCOPE_CHANGED' : 'UPDATE_USER';

    recordAudit(req, 'app_user', user.id, action, previous, {
      role: user.role,
      scopeLevel: user.scopeLevel,
      scopeId: user.scopeId,
      status: user.status,
    });

    // A narrowed scope or a different role must take effect now, not at the
    // user's next login.
    if (roleChanged || scopeChanged) {
      await authService.revokeSessions(tenantId, { subjectId: user.id }, req.principal?.subjectId ?? 'system');
    }

    res.json(user);
  })
);

app.delete(
  '/api/v1/master/users/:id',
  route(async (req, res) => {
    const tenantId = req.context!.tenantId;
    const before = masterDataService.getUserById(tenantId, req.params.id);
    if (!before) throw ApiError.notFound('Pengguna tidak ditemukan.');

    await masterDataService.deleteUser(tenantId, req.params.id);
    await authService.revokeSessions(tenantId, { subjectId: req.params.id }, req.principal?.subjectId ?? 'system');
    recordAudit(
      req,
      'app_user',
      req.params.id,
      'DELETE_USER',
      { email: before.email, role: before.role },
      undefined
    );
    res.json({ success: true, message: 'Pengguna dihapus.' });
  })
);

/** US-005, activate, suspend or deactivate, then drop live sessions. */
app.patch(
  '/api/v1/master/users/:id/status',
  route(async (req, res) => {
    const tenantId = req.context!.tenantId;
    const v = validate(req.body);
    const status = v.oneOf('status', ['INVITED', 'ACTIVE', 'SUSPENDED', 'INACTIVE'] as const);
    v.done();

    const before = masterDataService.getUserById(tenantId, req.params.id);
    if (!before) throw ApiError.notFound('Pengguna tidak ditemukan.');

    const user = await masterDataService.updateUserStatus(tenantId, req.params.id, status!);

    const action =
      status === 'ACTIVE' ? 'USER_ACTIVATED' : status === 'SUSPENDED' ? 'USER_SUSPENDED' : 'USER_DEACTIVATED';
    recordAudit(req, 'app_user', user.id, action, { status: before.status }, { status: user.status });

    // Changing status only stops the next login; the session already issued
    // has to be revoked for access to actually end (US-005).
    let revoked = 0;
    if (status !== 'ACTIVE') {
      revoked = await authService.revokeSessions(
        tenantId,
        { subjectId: user.id },
        req.principal?.subjectId ?? 'system'
      );
    }

    res.json({ ...user, revokedSessions: revoked });
  })
);

// PRD v1.3: Shop Floor Device / Terminal Management ( &)
app.get('/api/v1/master/devices', async (req, res) => {
  res.json(masterDataService.getDevices(req.context!.tenantId));
});

app.post('/api/v1/master/devices', async (req, res) => {
  const device = masterDataService.createDevice(req.context!.tenantId, req.body);
  await auditService.record({
    tenantId: req.context!.tenantId,
    actorType: 'USER',
    actorId: 'Admin',
    entityType: 'device_terminal',
    entityId: device.id,
    action: 'REGISTER_DEVICE',
    newValue: device,
  });
  res.status(201).json(device);
});

app.put('/api/v1/master/devices/:id', async (req, res, next) => {
  try {
    const device = masterDataService.updateDevice(req.context!.tenantId, req.params.id, req.body);
    await auditService.record({
      tenantId: req.context!.tenantId,
      actorType: 'USER',
      actorId: 'Admin',
      entityType: 'device_terminal',
      entityId: device.id,
      action: 'UPDATE_DEVICE',
      newValue: device,
    });
    res.json(device);
  } catch (err) {
    next(err);
  }
});

app.delete('/api/v1/master/devices/:id', async (req, res, next) => {
  try {
    masterDataService.deleteDevice(req.context!.tenantId, req.params.id);
    await auditService.record({
      tenantId: req.context!.tenantId,
      actorType: 'USER',
      actorId: 'Admin',
      entityType: 'device_terminal',
      entityId: req.params.id,
      action: 'DELETE_DEVICE',
    });
    res.json({ success: true, message: 'Device deleted successfully' });
  } catch (err) {
    next(err);
  }
});

// Production Processes
app.get('/api/v1/master/processes', async (req, res) => {
  res.json(masterDataService.getProcesses(req.context!.tenantId));
});

app.post('/api/v1/master/processes', async (req, res, next) => {
  try {
    const process = masterDataService.createProcess(req.context!.tenantId, req.body);
    res.status(201).json(process);
  } catch (err) {
    next(err);
  }
});

app.put('/api/v1/master/processes/:id', async (req, res, next) => {
  try {
    const process = masterDataService.updateProcess(req.context!.tenantId, req.params.id, req.body);
    res.json(process);
  } catch (err) {
    next(err);
  }
});

app.delete('/api/v1/master/processes/:id', async (req, res, next) => {
  try {
    masterDataService.deleteProcess(req.context!.tenantId, req.params.id);
    res.json({ success: true, message: 'Production process deleted successfully' });
  } catch (err) {
    next(err);
  }
});

// Product Routings
app.get('/api/v1/master/routings', async (req, res) => {
  res.json(masterDataService.getProductRoutings(req.context!.tenantId, req.query.productId as string));
});

app.post('/api/v1/master/routings', async (req, res, next) => {
  try {
    const routing = masterDataService.createRouting(req.context!.tenantId, req.body);
    res.status(201).json(routing);
  } catch (err) {
    next(err);
  }
});

app.put('/api/v1/master/routings/:id', async (req, res, next) => {
  try {
    const routing = masterDataService.updateRouting(req.context!.tenantId, req.params.id, req.body);
    res.json(routing);
  } catch (err) {
    next(err);
  }
});

app.delete('/api/v1/master/routings/:id', async (req, res, next) => {
  try {
    masterDataService.deleteRouting(req.context!.tenantId, req.params.id);
    res.json({ success: true, message: 'Product routing deleted successfully' });
  } catch (err) {
    next(err);
  }
});

// Product Machine Rates
app.get('/api/v1/master/machine-rates', async (req, res) => {
  res.json(
    masterDataService.getProductMachineRates(
      req.context!.tenantId,
      req.query.productId as string,
      req.query.machineId as string
    )
  );
});

app.post('/api/v1/master/machine-rates', async (req, res, next) => {
  try {
    const rate = masterDataService.upsertProductMachineRate(req.context!.tenantId, req.body);
    res.status(201).json(rate);
  } catch (err) {
    next(err);
  }
});

app.delete('/api/v1/master/machine-rates/:id', async (req, res, next) => {
  try {
    masterDataService.deleteProductMachineRate(req.context!.tenantId, req.params.id);
    res.json({ success: true, message: 'Product machine rate deleted successfully' });
  } catch (err) {
    next(err);
  }
});

// Batches & Lots
app.get('/api/v1/master/batches', async (req, res) => {
  res.json(
    masterDataService.getBatches(
      req.context!.tenantId,
      req.query.productId as string,
      req.query.status as string
    )
  );
});

app.post('/api/v1/master/batches', async (req, res, next) => {
  try {
    const tenantId = req.context!.tenantId;
    const batch = masterDataService.createBatch(tenantId, req.body);
    // work_order.batch_id is a foreign key, so a batch that exists only in
    // memory cannot be attached to a work order (US-013).
    await withTenant(tenantId, (client) => masterDataRepository.upsertBatch(client, tenantId, batch));
    res.status(201).json(batch);
  } catch (err) {
    next(err);
  }
});

app.put('/api/v1/master/batches/:id', async (req, res, next) => {
  try {
    const batch = masterDataService.updateBatch(req.context!.tenantId, req.params.id, req.body);
    res.json(batch);
  } catch (err) {
    next(err);
  }
});

// Production Orders Endpoints
app.get('/api/v1/production-orders', async (req, res) => {
  res.json(await productionService.getProductionOrders(req.context!.tenantId));
});

app.get('/api/v1/production-orders/:id', async (req, res) => {
  const po = await productionService.getProductionOrderById(req.context!.tenantId, req.params.id);
  if (!po) return res.status(404).json({ message: 'Production order not found' });
  res.json(po);
});

app.post('/api/v1/production-orders', async (req, res, next) => {
  try {
    const po = await productionService.createProductionOrder(req.context!.tenantId, req.body);
    realtimeGateway.emitTenantEvent(req.context!.tenantId, 'production-order:created', po);
    res.status(201).json(po);
  } catch (err) {
    next(err);
  }
});

app.post('/api/v1/production-orders/:id/release', async (req, res, next) => {
  try {
    const po = await productionService.releaseProductionOrder(
      req.context!.tenantId,
      req.params.id,
      masterDataService.getProductRoutings(req.context!.tenantId)
    );
    realtimeGateway.emitTenantEvent(req.context!.tenantId, 'production-order:updated', po);
    res.json(po);
  } catch (err) {
    next(err);
  }
});

app.put('/api/v1/production-orders/:id', async (req, res, next) => {
  try {
    const po = await productionService.updateProductionOrder(req.context!.tenantId, req.params.id, req.body);
    realtimeGateway.emitTenantEvent(req.context!.tenantId, 'production-order:updated', po);
    res.json(po);
  } catch (err) {
    next(err);
  }
});

app.delete('/api/v1/production-orders/:id', async (req, res, next) => {
  try {
    await productionService.deleteProductionOrder(req.context!.tenantId, req.params.id);
    realtimeGateway.emitTenantEvent(req.context!.tenantId, 'production-order:deleted', { id: req.params.id });
    res.json({ success: true, message: 'Production order deleted' });
  } catch (err) {
    next(err);
  }
});

// Work Orders Endpoints
app.get(
  '/api/v1/work-orders',
  route(async (req, res) => {
    const { lineId, status } = req.query as { lineId?: string; status?: string };
    const all = await productionService.getWorkOrders(req.context!.tenantId, { lineId, status });
    // US-014: an operator sees only the work assigned to their line, and
    // US-003 narrows every other role to its plant/line scope. Filtering here
    // rather than in the UI is what makes the rule real.
    res.json(scope.lines(req.principal, all));
  })
);

app.get(
  '/api/v1/work-orders/:id',
  route(async (req, res) => {
    const wo = await productionService.getWorkOrderById(req.context!.tenantId, req.params.id);
    if (!wo) throw ApiError.notFound('Work order tidak ditemukan.');
    scope.assertLine(req.principal, wo.lineId);
    res.json(wo);
  })
);

app.post('/api/v1/work-orders', async (req, res, next) => {
  try {
    const wo = await productionService.createWorkOrder(req.context!.tenantId, req.body);
    await auditService.record({
      tenantId: req.context!.tenantId,
      actorType: 'USER',
      actorId: 'PPIC',
      entityType: 'work_order',
      entityId: wo.id,
      action: 'CREATE',
      newValue: wo,
    });
    realtimeGateway.emitTenantEvent(req.context!.tenantId, 'work-order:created', wo);
    res.status(201).json(wo);
  } catch (err) {
    next(err);
  }
});

app.put('/api/v1/work-orders/:id', async (req, res, next) => {
  try {
    const wo = await productionService.updateWorkOrder(req.context!.tenantId, req.params.id, req.body);
    await auditService.record({
      tenantId: req.context!.tenantId,
      actorType: 'USER',
      actorId: 'PPIC',
      entityType: 'work_order',
      entityId: wo.id,
      action: 'UPDATE',
      newValue: wo,
    });
    realtimeGateway.emitTenantEvent(req.context!.tenantId, 'work-order:updated', wo);
    res.json(wo);
  } catch (err) {
    next(err);
  }
});

app.delete('/api/v1/work-orders/:id', async (req, res, next) => {
  try {
    await productionService.deleteWorkOrder(req.context!.tenantId, req.params.id);
    await auditService.record({
      tenantId: req.context!.tenantId,
      actorType: 'USER',
      actorId: 'Supervisor',
      entityType: 'work_order',
      entityId: req.params.id,
      action: 'DELETE',
    });
    realtimeGateway.emitTenantEvent(req.context!.tenantId, 'work-order:deleted', { id: req.params.id });
    res.json({ success: true, message: 'Work order deleted successfully' });
  } catch (err) {
    next(err);
  }
});

app.post(
  '/api/v1/work-orders/:id/release',
  route(async (req, res) => {
    const tenantId = req.context!.tenantId;
    const before = await productionService.getWorkOrderById(tenantId, req.params.id);
    if (!before) throw ApiError.notFound('Work order tidak ditemukan.');
    scope.assertLine(req.principal, before.lineId);

    const wo = await productionService.releaseWorkOrder(tenantId, req.params.id);
    recordAudit(req, 'work_order', wo.id, 'RELEASE', { status: before.status }, { status: wo.status });
    realtimeGateway.emitTenantEvent(tenantId, 'work-order:updated', wo);
    res.json(wo);
  })
);

/**
 * US-015, Start production.
 *
 * The preconditions are checked here, not in the terminal: an operator may be
 * running an offline queue built minutes ago, and the machine may have been
 * taken out of service since. Refusing at the server is what keeps the
 * recorded start time honest.
 */
app.post(
  '/api/v1/work-orders/:id/start',
  route(async (req, res) => {
    const tenantId = req.context!.tenantId;
    const wo = await productionService.getWorkOrderById(tenantId, req.params.id);
    if (!wo) throw ApiError.notFound('Work order tidak ditemukan.');

    const operatorId = req.body?.operatorId ?? req.principal?.subjectId;
    scope.assertAssignedWorkOrder(req.principal, wo, operatorId);

    if (![WorkOrderStatus.RELEASED, WorkOrderStatus.PAUSED].includes(wo.status)) {
      throw ApiError.invalidState(
        `Work order berstatus ${wo.status} tidak dapat dimulai. Work order harus sudah dirilis.`
      );
    }

    const operator = operatorId ? masterDataService.getOperatorById(tenantId, operatorId) : undefined;
    if (!operator || operator.status !== 'ACTIVE') {
      throw ApiError.validation('Operator tidak valid atau tidak aktif.', [
        { field: 'operatorId', code: 'UNKNOWN_REFERENCE', message: 'Operator tidak dikenal atau nonaktif.' },
      ]);
    }

    if (wo.machineId) {
      const machine = masterDataService.getMachineById(tenantId, wo.machineId);
      if (!machine || machine.status !== 'ACTIVE') {
        throw ApiError.invalidState('Mesin pada work order ini tidak aktif.');
      }
      const openDowntime = await shopFloorService.getActiveDowntimeForMachine(tenantId, wo.machineId);
      if (openDowntime) {
        throw ApiError.invalidState(
          'Mesin sedang dalam kondisi downtime. Selesaikan downtime terlebih dahulu.'
        );
      }
    }

    if (masterDataService.getShifts(tenantId).filter((s) => s.active).length === 0) {
      throw ApiError.invalidState('Tidak ada shift aktif yang terkonfigurasi.');
    }

    const started = await productionService.startWorkOrder(tenantId, req.params.id, {
      operatorId,
      occurredAt: req.body?.occurredAt,
    });
    recordAudit(
      req,
      'work_order',
      started.id,
      'START',
      { status: wo.status },
      { status: started.status, operatorId }
    );
    realtimeGateway.emitTenantEvent(tenantId, 'work-order:updated', started);
    res.json(started);
  })
);

app.post('/api/v1/work-orders/:id/pause', async (req, res, next) => {
  try {
    const wo = await productionService.pauseWorkOrder(req.context!.tenantId, req.params.id);
    realtimeGateway.emitTenantEvent(req.context!.tenantId, 'work-order:updated', wo);
    res.json(wo);
  } catch (err) {
    next(err);
  }
});

app.post('/api/v1/work-orders/:id/resume', async (req, res, next) => {
  try {
    const wo = await productionService.resumeWorkOrder(req.context!.tenantId, req.params.id);
    realtimeGateway.emitTenantEvent(req.context!.tenantId, 'work-order:updated', wo);
    res.json(wo);
  } catch (err) {
    next(err);
  }
});

/**
 * US-020, Complete Work Order.
 *
 * An open downtime is refused rather than silently closed: leaving a stoppage
 * running against a finished order corrupts Availability for that shift, and
 * closing it automatically would invent an end time nobody observed.
 */
app.post(
  '/api/v1/work-orders/:id/complete',
  route(async (req, res) => {
    const tenantId = req.context!.tenantId;
    const wo = await productionService.getWorkOrderById(tenantId, req.params.id);
    if (!wo) throw ApiError.notFound('Work order tidak ditemukan.');
    scope.assertLine(req.principal, wo.lineId);

    const openDowntime = await shopFloorService.getActiveDowntimeForWorkOrder(tenantId, wo.id);
    if (openDowntime) {
      throw ApiError.invalidState(
        'Masih ada downtime aktif pada work order ini. Selesaikan downtime sebelum menutup work order.'
      );
    }

    const completed = await productionService.completeWorkOrder(tenantId, req.params.id, req.body ?? {});
    recordAudit(
      req,
      'work_order',
      completed.id,
      'COMPLETE',
      { status: wo.status },
      {
        status: completed.status,
        goodQuantity: completed.goodQuantity,
        rejectQuantity: completed.rejectQuantity,
        actualEnd: completed.actualEnd,
      }
    );
    realtimeGateway.emitTenantEvent(tenantId, 'work-order:updated', completed);
    res.json(completed);
  })
);

app.post(
  '/api/v1/work-orders/:id/cancel',
  route(async (req, res) => {
    const tenantId = req.context!.tenantId;
    const before = await productionService.getWorkOrderById(tenantId, req.params.id);
    if (!before) throw ApiError.notFound('Work order tidak ditemukan.');
    scope.assertLine(req.principal, before.lineId);

    const wo = await productionService.cancelWorkOrder(tenantId, req.params.id);
    recordAudit(req, 'work_order', wo.id, 'CANCEL', { status: before.status }, { status: wo.status });
    realtimeGateway.emitTenantEvent(tenantId, 'work-order:updated', wo);
    res.json(wo);
  })
);

// Shop Floor Execution Endpoints
app.post('/api/v1/shop-floor/output', async (req, res, next) => {
  try {
    const record = await shopFloorService.recordOutput(req.context!.tenantId, req.body);
    realtimeGateway.emitTenantEvent(req.context!.tenantId, 'production:output-recorded', record);
    res.status(201).json(record);
  } catch (err) {
    next(err);
  }
});

app.post('/api/v1/shop-floor/downtime/start', async (req, res, next) => {
  try {
    const record = await shopFloorService.startDowntime(req.context!.tenantId, req.body);
    realtimeGateway.emitTenantEvent(req.context!.tenantId, 'downtime:started', record);
    res.status(201).json(record);
  } catch (err) {
    next(err);
  }
});

app.post('/api/v1/shop-floor/downtime/:id/resolve', async (req, res, next) => {
  try {
    const record = await shopFloorService.resolveDowntime(req.context!.tenantId, req.params.id, req.body);
    realtimeGateway.emitTenantEvent(req.context!.tenantId, 'downtime:resolved', record);
    res.json(record);
  } catch (err) {
    next(err);
  }
});

app.get('/api/v1/shop-floor/downtime', async (req, res) => {
  const { lineId } = req.query as { lineId?: string };
  res.json(await shopFloorService.getDowntimeRecords(req.context!.tenantId, lineId));
});

app.post('/api/v1/shop-floor/sync-batch', async (req, res, next) => {
  try {
    const result = await shopFloorService.syncBatch(req.context!.tenantId, req.body.commands || []);
    realtimeGateway.emitTenantEvent(req.context!.tenantId, 'shop-floor:batch-synced', result);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Analytics & Dashboard Endpoints
app.get('/api/v1/analytics/live-board', async (req, res) => {
  res.json(await performanceService.getLiveProductionBoard(req.context!.tenantId));
});

app.get('/api/v1/analytics/downtime-pareto', async (req, res) => {
  const { lineId } = req.query as { lineId?: string };
  res.json(await performanceService.getDowntimePareto(req.context!.tenantId, lineId));
});

// --- Executive Dashboard ---

/** Parse?days=, clamped to a sane analysis window. */
const parseDays = (raw: unknown, fallback: number): number => {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(90, Math.max(1, Math.trunc(value)));
};

// Executive KPI, value, target, variance, status, previous-period delta
app.get('/api/v1/analytics/executive-kpi', async (req, res) => {
  res.json(await performanceService.getExecutiveKpi(req.context!.tenantId, parseDays(req.query.days, 7)));
});

// Production Performance, target vs actual over time
app.get('/api/v1/analytics/production-trend', async (req, res) => {
  res.json(await performanceService.getProductionTrend(req.context!.tenantId, parseDays(req.query.days, 7)));
});

// OEE Performance, actual vs target vs previous period
app.get('/api/v1/analytics/oee-trend', async (req, res) => {
  res.json(await performanceService.getOeeTrend(req.context!.tenantId, parseDays(req.query.days, 7)));
});

// Plant / Line Performance
app.get('/api/v1/analytics/line-performance', async (req, res) => {
  res.json(await performanceService.getLinePerformance(req.context!.tenantId, parseDays(req.query.days, 7)));
});

app.get('/api/v1/analytics/plant-performance', async (req, res) => {
  res.json(await performanceService.getPlantPerformance(req.context!.tenantId, parseDays(req.query.days, 7)));
});

//// Process Performance Breakdown
app.get('/api/v1/analytics/process-performance', async (req, res) => {
  res.json(await performanceService.getProcessPerformance(req.context!.tenantId, parseDays(req.query.days, 7)));
});

// Downtime Analysis, loss overview + Pareto + by line + top machines
app.get('/api/v1/analytics/downtime-summary', async (req, res) => {
  res.json(await performanceService.getDowntimeSummary(req.context!.tenantId, parseDays(req.query.days, 7)));
});

// Quality Performance, reject rate, quality vs target, defect Pareto
app.get('/api/v1/analytics/reject-pareto', async (req, res) => {
  const { lineId } = req.query as { lineId?: string };
  res.json(await performanceService.getRejectPareto(req.context!.tenantId, lineId));
});

app.get('/api/v1/analytics/quality-summary', async (req, res) => {
  res.json(await performanceService.getQualitySummary(req.context!.tenantId, parseDays(req.query.days, 7)));
});

// Production Order / Schedule Status
app.get('/api/v1/analytics/order-status', async (req, res) => {
  res.json(await performanceService.getOrderStatusSummary(req.context!.tenantId));
});

// Operational Alerts / Exceptions
app.get('/api/v1/analytics/alerts', async (req, res) => {
  res.json(await performanceService.getOperationalAlerts(req.context!.tenantId, parseDays(req.query.days, 7)));
});

// Daily aggregate backing every trend above; useful for export and debugging.
app.get('/api/v1/analytics/daily-performance', async (req, res) => {
  res.json(await performanceService.getDailyPerformance(req.context!.tenantId, parseDays(req.query.days, 30)));
});

// KPI target configuration
app.get('/api/v1/master/kpi-targets', async (req, res) => {
  res.json(masterDataService.getKpiTargets(req.context!.tenantId));
});

app.put('/api/v1/master/kpi-targets/:metric', async (req, res, next) => {
  try {
    const target = masterDataService.upsertKpiTarget(req.context!.tenantId, req.params.metric as any, req.body);
    res.json(target);
  } catch (err) {
    next(err);
  }
});

// Reporting & CSV Endpoints
/**
 * US-038 to US-041, reports.
 *
 * Every report is filtered to the caller's scope before it is serialised, so a
 * line supervisor's CSV export contains their line and nothing else. Doing it
 * once here, on the rows, means the JSON view and the CSV download can never
 * disagree about what the user is allowed to see.
 */
function scopeRows<T extends { lineId?: string }>(req: express.Request, rows: T[]): T[] {
  return scope.lines(req.principal, rows);
}

app.get(
  '/api/v1/reports/production',
  route(async (req, res) => {
    const { lineId, shiftDate, format } = req.query as { lineId?: string; shiftDate?: string; format?: string };
    scope.assertLine(req.principal, lineId);
    const data = scopeRows(
      req,
      await reportingService.getProductionReport(req.context!.tenantId, { lineId, shiftDate })
    );
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="production-report.csv"');
      res.send(reportingService.exportToCsv(data));
      return;
    }
    res.json(data);
  })
);

app.get(
  '/api/v1/reports/downtime',
  route(async (req, res) => {
    const { lineId, format } = req.query as { lineId?: string; format?: string };
    scope.assertLine(req.principal, lineId);
    const data = scopeRows(req, await reportingService.getDowntimeReport(req.context!.tenantId, { lineId }));
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="downtime-report.csv"');
      res.send(reportingService.exportToCsv(data));
      return;
    }
    res.json(data);
  })
);

app.get(
  '/api/v1/reports/shift',
  route(async (req, res) => {
    const { shiftDate, format } = req.query as { shiftDate?: string; format?: string };
    const data = scopeRows(req, await reportingService.getShiftReport(req.context!.tenantId, shiftDate));
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="shift-report.csv"');
      res.send(reportingService.exportToCsv(data));
      return;
    }
    res.json(data);
  })
);

// Correction Workflow Endpoints
app.get('/api/v1/corrections', async (req, res) => {
  const { status } = req.query as { status?: any };
  res.json(correctionService.getCorrections(req.context!.tenantId, status));
});

app.post(
  '/api/v1/corrections',
  route(async (req, res) => {
    const corr = await correctionService.createCorrectionRequest(req.context!.tenantId, {
      ...req.body,
      requestedBy: req.body.requestedBy ?? req.principal?.name ?? 'System',
      requestedById: req.principal?.subjectId,
      // Whether the correction applies straight away or waits for approval is
      // decided from the requester's real permissions, not from the payload.
      permissions: req.principal?.permissions,
    });
    res.status(201).json(corr);
  })
);

app.post(
  '/api/v1/corrections/:id/approve',
  route(async (req, res) => {
    const corr = await correctionService.approveCorrection(
      req.context!.tenantId,
      req.params.id,
      req.body?.approvedBy || req.principal?.name || 'Supervisor',
      req.principal?.subjectId
    );
    res.json(corr);
  })
);

app.post(
  '/api/v1/corrections/:id/reject',
  route(async (req, res) => {
    const corr = await correctionService.rejectCorrection(
      req.context!.tenantId,
      req.params.id,
      req.body?.rejectedBy || req.principal?.name || 'Supervisor',
      req.principal?.subjectId
    );
    res.json(corr);
  })
);

/** The window state and correctable field list the console needs. */
app.get(
  '/api/v1/corrections/policy',
  route(async (req, res) => {
    const shiftDate =
      typeof req.query.shiftDate === 'string' ? req.query.shiftDate : new Date().toISOString().slice(0, 10);
    res.json({
      windowHours: 24,
      shiftDate,
      ...correctionService.assessWindow(shiftDate),
      canApprove: req.principal?.permissions.includes('correction:approve') ?? false,
      correctableFields: {
        PRODUCTION_RECORD: correctionService.getCorrectableFields(CorrectionEntityType.PRODUCTION_RECORD),
        DOWNTIME_RECORD: correctionService.getCorrectableFields(CorrectionEntityType.DOWNTIME_RECORD),
      },
    });
  })
);

// Audit Log Endpoints
app.get('/api/v1/audit-logs', async (req, res) => {
  const { entityType, action } = req.query as { entityType?: string; action?: string };
  res.json(await auditService.getAuditLogs(req.context!.tenantId, { entityType, action }));
});

// ============================================================
// PRD v1.5, endpoints added for the MVP user stories
// ============================================================

// US-007, work centre master data completes the plant hierarchy.
app.get(
  '/api/v1/master/work-centers',
  route(async (req, res) => res.json(masterDataService.getWorkCenters(req.context!.tenantId)))
);

app.post(
  '/api/v1/master/work-centers',
  route(async (req, res) => {
    const v = validate(req.body);
    const productionLineId = v.string('productionLineId');
    const code = v.string('code', { min: 2, max: 40 });
    const name = v.string('name', { min: 2, max: 80 });
    const sequence = v.number('sequence', { min: 1, integer: true, optional: true });
    v.done();

    scope.assertLine(req.principal, productionLineId);
    const workCenter = masterDataService.createWorkCenter(req.context!.tenantId, {
      productionLineId: productionLineId!,
      code: code!,
      name: name!,
      sequence: sequence ?? 1,
    });
    recordAudit(req, 'work_center', workCenter.id, 'CREATE', undefined, workCenter);
    res.status(201).json(workCenter);
  })
);

app.put(
  '/api/v1/master/work-centers/:id',
  route(async (req, res) => {
    const tenantId = req.context!.tenantId;
    const before = masterDataService.getWorkCenterById(tenantId, req.params.id);
    const updated = masterDataService.updateWorkCenter(tenantId, req.params.id, req.body);
    recordAudit(req, 'work_center', req.params.id, 'UPDATE', before, updated);
    res.json(updated);
  })
);

app.delete(
  '/api/v1/master/work-centers/:id',
  route(async (req, res) => {
    const tenantId = req.context!.tenantId;
    const before = masterDataService.getWorkCenterById(tenantId, req.params.id);
    masterDataService.deleteWorkCenter(tenantId, req.params.id);
    recordAudit(req, 'work_center', req.params.id, 'DELETE', before, undefined);
    res.json({ success: true, message: 'Work center dihapus.' });
  })
);

/**
 * US-013, attach a Production Batch/Lot to an eligible Work Order.
 *
 * The batch must belong to the same product and still be usable: attaching a
 * scrapped lot, or one from a different SKU, would poison every downstream
 * traceability query that assumes the link is meaningful.
 */
app.post(
  '/api/v1/work-orders/:id/batch',
  route(async (req, res) => {
    const tenantId = req.context!.tenantId;
    const v = validate(req.body);
    const batchId = v.string('batchId');
    v.done();

    const workOrder = await productionService.getWorkOrderById(tenantId, req.params.id);
    if (!workOrder) throw ApiError.notFound('Work order tidak ditemukan.');
    scope.assertLine(req.principal, workOrder.lineId);

    const batch = masterDataService.getBatchById(tenantId, batchId!);
    if (!batch) throw ApiError.notFound('Batch/Lot tidak ditemukan.');

    if (batch.productId !== workOrder.productId) {
      throw ApiError.validation('Batch/Lot tidak sesuai dengan produk pada work order.', [
        {
          field: 'batchId',
          code: 'INVALID_COMBINATION',
          message: 'Produk batch berbeda dengan produk work order.',
        },
      ]);
    }
    if (batch.status === 'SCRAPPED' || batch.status === 'COMPLETED') {
      throw ApiError.invalidState(`Batch/Lot berstatus ${batch.status} tidak dapat dilampirkan.`);
    }
    if ([WorkOrderStatus.COMPLETED, WorkOrderStatus.CANCELLED].includes(workOrder.status)) {
      throw ApiError.invalidState(`Work order berstatus ${workOrder.status} tidak dapat diubah.`);
    }

    const previousBatchId = workOrder.batchId;
    const updated = await productionService.updateWorkOrder(tenantId, req.params.id, { batchId: batch.id });
    recordAudit(
      req,
      'work_order',
      updated.id,
      'ATTACH_BATCH',
      { batchId: previousBatchId },
      { batchId: batch.id }
    );

    res.json(updated);
  })
);

/** US-022, shift performance for one line and shift date. */
app.get(
  '/api/v1/shifts/performance',
  route(async (req, res) => {
    const tenantId = req.context!.tenantId;
    const lineId = typeof req.query.lineId === 'string' ? req.query.lineId : undefined;
    const lines = lineId
      ? [lineId]
      : req.principal && req.principal.scope.level !== 'TENANT'
        ? req.principal.scope.lineIds
        : masterDataService.getLines(tenantId).map((l) => l.id);

    // One context per line, gathered concurrently: each is an independent
    // read, so awaiting them in sequence would make a ten-line plant ten times
    // slower for no reason.
    res.json(
      await Promise.all(
        lines.map((id) =>
          shiftHandoverService.buildContext(tenantId, {
            lineId: id,
            shiftId: typeof req.query.shiftId === 'string' ? req.query.shiftId : undefined,
            shiftDate: typeof req.query.shiftDate === 'string' ? req.query.shiftDate : undefined,
          })
        )
      )
    );
  })
);

/** US-041, OEE report is also reachable under the reports namespace. */
app.get(
  '/api/v1/reports/oee',
  route(async (req, res) => {
    const tenantId = req.context!.tenantId;
    const rows = await oeeService.getOeeReport(tenantId, {
      days: req.query.days ? Number(req.query.days) : undefined,
      lineId: typeof req.query.lineId === 'string' ? req.query.lineId : undefined,
      machineId: typeof req.query.machineId === 'string' ? req.query.machineId : undefined,
      shiftId: typeof req.query.shiftId === 'string' ? req.query.shiftId : undefined,
      productId: typeof req.query.productId === 'string' ? req.query.productId : undefined,
      allowedLineIds:
        req.principal && req.principal.scope.level !== 'TENANT' ? req.principal.scope.lineIds : undefined,
    });
    res.json(rows);
  })
);

app.use('/api/v1', authRoutes(authService, masterDataService));
app.use('/api/v1', rbacRoutes(rbacService, auditService));
app.use('/api/v1', shiftRoutes(masterDataService, shiftHandoverService, auditService));
app.use('/api/v1', csvRoutes(csvService, auditService));
app.use('/api/v1', oeeRoutes(oeeService, auditService));
app.use('/api/v1', metaRoutes());
app.use('/api/internal/v1', internalRoutes(internalAuthService, clientManagementService, clientAdminService));

/** Records a master-data or execution change against the acting principal. */
function recordAudit(
  req: express.Request,
  entityType: string,
  entityId: string,
  action: string,
  previousValue?: unknown,
  newValue?: unknown
): void {
  // Detached on purpose: the action being audited has already committed, and
  // a database hiccup here must not turn a successful request into a 500.
  auditService.recordDetached({
    tenantId: req.context!.tenantId,
    actorType: req.principal?.kind === 'OPERATOR' ? 'OPERATOR' : 'USER',
    actorId: req.principal?.subjectId ?? req.context?.userId ?? 'system',
    entityType,
    entityId,
    action,
    previousValue,
    newValue,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });
}

// Unknown API routes get the same envelope as everything else.
app.use('/api/v1', (req, _res, next) =>
  next(ApiError.notFound(`Endpoint ${req.method} ${req.path} tidak dikenal.`))
);

// Terminal error handler, must be registered last (US-054).
app.use(errorMiddleware);

const PORT = process.env.PORT || 4000;
void (async () => {
  const db = await checkDatabase();
  // eslint-disable-next-line no-console
  console.log(`[db] ${db.ok ? 'connected' : `unavailable: ${db.detail}`}`);
  if (db.ok) await internalAuthService.bootstrap();
})();

server.listen(PORT, () => {
  console.log(`[Factory Vision API] Server listening on port http://localhost:${PORT}`);
});
