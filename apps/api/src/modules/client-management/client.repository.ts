import { randomUUID } from 'crypto';
import type {
  ClientAccount,
  ClientLifecycleStatus,
  ClientSubscription,
  ClientUsageSnapshot,
  InternalAuditEntry,
  InternalUser,
  SubscriptionPlan,
  SupportAccessGrant,
} from '@factory-vision/domain-types';
import { query, queryOne, transaction } from '../../platform/db/pool.js';

/**
 * SQL for the vendor-side client records.
 *
 * Kept as a repository rather than pushed into the service so the mapping
 * between snake_case columns and camelCase domain objects lives in exactly one
 * place. Everything here is parameterised; no query interpolates a caller's
 * value into the statement text.
 */

const id = (prefix: string) => `${prefix}-${randomUUID().slice(0, 18)}`;

// --- Row shapes as PostgreSQL returns them -------------------------

interface PlanRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  max_plants: number | null;
  max_production_lines: number | null;
  max_machines: number | null;
  max_users: number | null;
  max_operators: number | null;
  monthly_price_idr: string | null;
  active: boolean;
}

interface ClientRow {
  id: string;
  tenant_id: string;
  legal_name: string;
  display_name: string;
  industry: string | null;
  city: string | null;
  country: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  account_manager: string | null;
  lifecycle_status: ClientLifecycleStatus;
  deployment_mode: 'CLOUD_MULTI_TENANT' | 'ON_PREMISE_SINGLE_TENANT';
  onboarded_at: Date | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

interface SubscriptionRow {
  id: string;
  client_id: string;
  plan_id: string;
  plan_code: string;
  plan_name: string;
  status: ClientSubscription['status'];
  started_at: Date;
  renews_at: Date | null;
  ended_at: Date | null;
  override_max_plants: number | null;
  override_max_production_lines: number | null;
  override_max_machines: number | null;
  override_max_users: number | null;
  override_max_operators: number | null;
}

const iso = (value: Date | null) => (value ? value.toISOString() : null);
const day = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : null);

function toPlan(row: PlanRow): SubscriptionPlan {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description ?? '',
    maxPlants: row.max_plants,
    maxProductionLines: row.max_production_lines,
    maxMachines: row.max_machines,
    maxUsers: row.max_users,
    maxOperators: row.max_operators,
    // BIGINT arrives as a string, because it can exceed a JS safe integer.
    monthlyPriceIdr: row.monthly_price_idr === null ? null : Number(row.monthly_price_idr),
    active: row.active,
  };
}

function toClient(row: ClientRow): ClientAccount {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    legalName: row.legal_name,
    displayName: row.display_name,
    industry: row.industry,
    city: row.city,
    country: row.country,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    accountManager: row.account_manager,
    lifecycleStatus: row.lifecycle_status,
    deploymentMode: row.deployment_mode,
    onboardedAt: iso(row.onboarded_at),
    notes: row.notes,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toSubscription(row: SubscriptionRow): ClientSubscription {
  return {
    id: row.id,
    clientId: row.client_id,
    planId: row.plan_id,
    planCode: row.plan_code,
    planName: row.plan_name,
    status: row.status,
    startedAt: day(row.started_at)!,
    renewsAt: day(row.renews_at),
    endedAt: day(row.ended_at),
    overrideMaxPlants: row.override_max_plants,
    overrideMaxProductionLines: row.override_max_production_lines,
    overrideMaxMachines: row.override_max_machines,
    overrideMaxUsers: row.override_max_users,
    overrideMaxOperators: row.override_max_operators,
  };
}

// --- Plans ---------------------------------------------------------

export const plans = {
  async list(): Promise<SubscriptionPlan[]> {
    const rows = await query<PlanRow>(
      'SELECT * FROM subscription_plan WHERE active = TRUE ORDER BY COALESCE(monthly_price_idr, 0)'
    );
    return rows.map(toPlan);
  },

  async byId(planId: string): Promise<SubscriptionPlan | undefined> {
    const row = await queryOne<PlanRow>('SELECT * FROM subscription_plan WHERE id = $1', [planId]);
    return row ? toPlan(row) : undefined;
  },
};

// --- Clients -------------------------------------------------------

export const clients = {
  async list(filter: { status?: ClientLifecycleStatus; search?: string } = {}): Promise<ClientAccount[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter.status) {
      params.push(filter.status);
      conditions.push(`lifecycle_status = $${params.length}`);
    }
    if (filter.search) {
      params.push(`%${filter.search.toLowerCase()}%`);
      conditions.push(
        `(lower(display_name) LIKE $${params.length} OR lower(legal_name) LIKE $${params.length})`
      );
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = await query<ClientRow>(`SELECT * FROM client_account ${where} ORDER BY display_name`, params);
    return rows.map(toClient);
  },

  async byId(clientId: string): Promise<ClientAccount | undefined> {
    const row = await queryOne<ClientRow>('SELECT * FROM client_account WHERE id = $1', [clientId]);
    return row ? toClient(row) : undefined;
  },

  async byTenant(tenantId: string): Promise<ClientAccount | undefined> {
    const row = await queryOne<ClientRow>('SELECT * FROM client_account WHERE tenant_id = $1', [tenantId]);
    return row ? toClient(row) : undefined;
  },

  /**
   * Creates the tenant, the client record and its first subscription together.
   * A client without a tenant cannot hold data and a tenant without a client
   * record is invisible to the vendor, so neither may exist alone.
   */
  async create(input: {
    tenantId?: string;
    legalName: string;
    displayName: string;
    industry?: string;
    city?: string;
    contactName?: string;
    contactEmail?: string;
    contactPhone?: string;
    accountManager?: string;
    lifecycleStatus: ClientLifecycleStatus;
    deploymentMode: 'CLOUD_MULTI_TENANT' | 'ON_PREMISE_SINGLE_TENANT';
    timezone?: string;
    planId: string;
    startedAt: string;
    renewsAt?: string;
    notes?: string;
  }): Promise<{ client: ClientAccount; subscription: ClientSubscription }> {
    return transaction(async (tx) => {
      const tenantId = input.tenantId ?? `tenant-${slug(input.displayName)}-${randomUUID().slice(0, 8)}`;
      const clientId = id('client');
      const subscriptionId = id('sub');

      await tx.query(
        `INSERT INTO tenant (id, name, timezone, plan, status)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO NOTHING`,
        [tenantId, input.legalName, input.timezone ?? 'Asia/Jakarta', input.planId, 'ACTIVE']
      );

      await tx.query(
        `INSERT INTO client_account
           (id, tenant_id, legal_name, display_name, industry, city, contact_name, contact_email,
            contact_phone, account_manager, lifecycle_status, deployment_mode, onboarded_at, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          clientId,
          tenantId,
          input.legalName,
          input.displayName,
          input.industry ?? null,
          input.city ?? null,
          input.contactName ?? null,
          input.contactEmail ?? null,
          input.contactPhone ?? null,
          input.accountManager ?? null,
          input.lifecycleStatus,
          input.deploymentMode,
          input.lifecycleStatus === 'ACTIVE' ? new Date() : null,
          input.notes ?? null,
        ]
      );

      await tx.query(
        `INSERT INTO client_subscription (id, client_id, plan_id, status, started_at, renews_at)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [subscriptionId, clientId, input.planId, 'ACTIVE', input.startedAt, input.renewsAt ?? null]
      );

      const clientRow = await tx.query<ClientRow>('SELECT * FROM client_account WHERE id = $1', [clientId]);
      const subRow = await tx.query<SubscriptionRow>(
        `SELECT s.*, p.code AS plan_code, p.name AS plan_name
           FROM client_subscription s JOIN subscription_plan p ON p.id = s.plan_id
          WHERE s.id = $1`,
        [subscriptionId]
      );

      return { client: toClient(clientRow.rows[0]), subscription: toSubscription(subRow.rows[0]) };
    });
  },

  async update(
    clientId: string,
    patch: Partial<Omit<ClientAccount, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>>
  ): Promise<ClientAccount | undefined> {
    const columns: Record<string, unknown> = {
      legal_name: patch.legalName,
      display_name: patch.displayName,
      industry: patch.industry,
      city: patch.city,
      contact_name: patch.contactName,
      contact_email: patch.contactEmail,
      contact_phone: patch.contactPhone,
      account_manager: patch.accountManager,
      lifecycle_status: patch.lifecycleStatus,
      notes: patch.notes,
    };

    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [column, value] of Object.entries(columns)) {
      if (value === undefined) continue;
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    }
    if (sets.length === 0) return this.byId(clientId);

    // Moving a client to ACTIVE is what starts their clock, so stamp it once.
    if (patch.lifecycleStatus === 'ACTIVE') {
      sets.push('onboarded_at = COALESCE(onboarded_at, CURRENT_TIMESTAMP)');
    }
    sets.push('updated_at = CURRENT_TIMESTAMP');

    params.push(clientId);
    const row = await queryOne<ClientRow>(
      `UPDATE client_account SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    return row ? toClient(row) : undefined;
  },
};

// --- Subscriptions -------------------------------------------------

export const subscriptions = {
  async currentFor(clientId: string): Promise<ClientSubscription | undefined> {
    const row = await queryOne<SubscriptionRow>(
      `SELECT s.*, p.code AS plan_code, p.name AS plan_name
         FROM client_subscription s JOIN subscription_plan p ON p.id = s.plan_id
        WHERE s.client_id = $1 AND s.status IN ('ACTIVE', 'PAST_DUE')
        ORDER BY s.started_at DESC LIMIT 1`,
      [clientId]
    );
    return row ? toSubscription(row) : undefined;
  },

  async allFor(clientId: string): Promise<ClientSubscription[]> {
    const rows = await query<SubscriptionRow>(
      `SELECT s.*, p.code AS plan_code, p.name AS plan_name
         FROM client_subscription s JOIN subscription_plan p ON p.id = s.plan_id
        WHERE s.client_id = $1 ORDER BY s.started_at DESC`,
      [clientId]
    );
    return rows.map(toSubscription);
  },

  /**
   * Ends the running subscription and starts a new one, rather than editing in
   * place: what a customer was entitled to last quarter is a fact worth
   * keeping when a dispute arrives.
   */
  async changePlan(input: {
    clientId: string;
    planId: string;
    startedAt: string;
    renewsAt?: string;
    overrides?: Partial<
      Record<'maxPlants' | 'maxProductionLines' | 'maxMachines' | 'maxUsers' | 'maxOperators', number | null>
    >;
  }): Promise<ClientSubscription> {
    return transaction(async (tx) => {
      await tx.query(
        `UPDATE client_subscription
            SET status = 'ENDED', ended_at = $2, updated_at = CURRENT_TIMESTAMP
          WHERE client_id = $1 AND status IN ('ACTIVE', 'PAST_DUE')`,
        [input.clientId, input.startedAt]
      );

      const subscriptionId = id('sub');
      const o = input.overrides ?? {};
      await tx.query(
        `INSERT INTO client_subscription
           (id, client_id, plan_id, status, started_at, renews_at,
            override_max_plants, override_max_production_lines, override_max_machines,
            override_max_users, override_max_operators)
         VALUES ($1,$2,$3,'ACTIVE',$4,$5,$6,$7,$8,$9,$10)`,
        [
          subscriptionId,
          input.clientId,
          input.planId,
          input.startedAt,
          input.renewsAt ?? null,
          o.maxPlants ?? null,
          o.maxProductionLines ?? null,
          o.maxMachines ?? null,
          o.maxUsers ?? null,
          o.maxOperators ?? null,
        ]
      );

      const row = await tx.query<SubscriptionRow>(
        `SELECT s.*, p.code AS plan_code, p.name AS plan_name
           FROM client_subscription s JOIN subscription_plan p ON p.id = s.plan_id
          WHERE s.id = $1`,
        [subscriptionId]
      );
      return toSubscription(row.rows[0]);
    });
  },

  async setStatus(clientId: string, status: ClientSubscription['status']): Promise<void> {
    await query(
      `UPDATE client_subscription SET status = $2, updated_at = CURRENT_TIMESTAMP
        WHERE client_id = $1 AND status IN ('ACTIVE', 'PAST_DUE')`,
      [clientId, status]
    );
  },
};

// --- Usage ---------------------------------------------------------

interface UsageRow {
  client_id: string;
  captured_on: Date;
  plants: number;
  production_lines: number;
  machines: number;
  products: number;
  users: number;
  operators: number;
  active_users_7d: number;
  work_orders_created: number;
  production_records: number;
  downtime_records: number;
  terminals_online: number;
  last_activity_at: Date | null;
}

const toUsage = (row: UsageRow): ClientUsageSnapshot => ({
  clientId: row.client_id,
  capturedOn: day(row.captured_on)!,
  plants: row.plants,
  productionLines: row.production_lines,
  machines: row.machines,
  products: row.products,
  users: row.users,
  operators: row.operators,
  activeUsers7d: row.active_users_7d,
  workOrdersCreated: row.work_orders_created,
  productionRecords: row.production_records,
  downtimeRecords: row.downtime_records,
  terminalsOnline: row.terminals_online,
  lastActivityAt: iso(row.last_activity_at),
});

export const usage = {
  async latestFor(clientId: string): Promise<ClientUsageSnapshot | undefined> {
    const row = await queryOne<UsageRow>(
      'SELECT * FROM client_usage_snapshot WHERE client_id = $1 ORDER BY captured_on DESC LIMIT 1',
      [clientId]
    );
    return row ? toUsage(row) : undefined;
  },

  async latestForAll(): Promise<Map<string, ClientUsageSnapshot>> {
    const rows = await query<UsageRow>(
      `SELECT DISTINCT ON (client_id) * FROM client_usage_snapshot
        ORDER BY client_id, captured_on DESC`
    );
    return new Map(rows.map((row) => [row.client_id, toUsage(row)]));
  },

  async historyFor(clientId: string, days: number): Promise<ClientUsageSnapshot[]> {
    const rows = await query<UsageRow>(
      `SELECT * FROM client_usage_snapshot
        WHERE client_id = $1 AND captured_on > CURRENT_DATE - $2::int
        ORDER BY captured_on`,
      [clientId, days]
    );
    return rows.map(toUsage);
  },

  /** One sample per client per day; re-running the sampler overwrites today. */
  async record(snapshot: ClientUsageSnapshot): Promise<void> {
    await query(
      `INSERT INTO client_usage_snapshot
         (client_id, captured_on, plants, production_lines, machines, products, users, operators,
          active_users_7d, work_orders_created, production_records, downtime_records,
          terminals_online, last_activity_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (client_id, captured_on) DO UPDATE SET
         plants = EXCLUDED.plants,
         production_lines = EXCLUDED.production_lines,
         machines = EXCLUDED.machines,
         products = EXCLUDED.products,
         users = EXCLUDED.users,
         operators = EXCLUDED.operators,
         active_users_7d = EXCLUDED.active_users_7d,
         work_orders_created = EXCLUDED.work_orders_created,
         production_records = EXCLUDED.production_records,
         downtime_records = EXCLUDED.downtime_records,
         terminals_online = EXCLUDED.terminals_online,
         last_activity_at = EXCLUDED.last_activity_at`,
      [
        snapshot.clientId,
        snapshot.capturedOn,
        snapshot.plants,
        snapshot.productionLines,
        snapshot.machines,
        snapshot.products,
        snapshot.users,
        snapshot.operators,
        snapshot.activeUsers7d,
        snapshot.workOrdersCreated,
        snapshot.productionRecords,
        snapshot.downtimeRecords,
        snapshot.terminalsOnline,
        snapshot.lastActivityAt,
      ]
    );
  },
};

// --- Support access ------------------------------------------------

interface GrantRow {
  id: string;
  client_id: string;
  granted_to: string;
  granted_by: string;
  reason: string;
  access_level: 'READ_ONLY' | 'READ_WRITE';
  granted_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
  revoked_by: string | null;
  last_used_at: Date | null;
  use_count: number;
}

const toGrant = (row: GrantRow): SupportAccessGrant => ({
  id: row.id,
  clientId: row.client_id,
  grantedTo: row.granted_to,
  grantedBy: row.granted_by,
  reason: row.reason,
  accessLevel: row.access_level,
  grantedAt: row.granted_at.toISOString(),
  expiresAt: row.expires_at.toISOString(),
  revokedAt: iso(row.revoked_at),
  revokedBy: row.revoked_by,
  lastUsedAt: iso(row.last_used_at),
  useCount: row.use_count,
  active: row.revoked_at === null && row.expires_at.getTime() > Date.now(),
});

export const supportAccess = {
  async listFor(clientId: string): Promise<SupportAccessGrant[]> {
    const rows = await query<GrantRow>(
      'SELECT * FROM support_access_grant WHERE client_id = $1 ORDER BY granted_at DESC',
      [clientId]
    );
    return rows.map(toGrant);
  },

  async listActive(): Promise<SupportAccessGrant[]> {
    const rows = await query<GrantRow>(
      `SELECT * FROM support_access_grant
        WHERE revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP
        ORDER BY expires_at`
    );
    return rows.map(toGrant);
  },

  async grant(input: {
    clientId: string;
    grantedTo: string;
    grantedBy: string;
    reason: string;
    accessLevel: 'READ_ONLY' | 'READ_WRITE';
    expiresAt: string;
  }): Promise<SupportAccessGrant> {
    const grantId = id('grant');
    const row = await queryOne<GrantRow>(
      `INSERT INTO support_access_grant
         (id, client_id, granted_to, granted_by, reason, access_level, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        grantId,
        input.clientId,
        input.grantedTo,
        input.grantedBy,
        input.reason,
        input.accessLevel,
        input.expiresAt,
      ]
    );
    return toGrant(row!);
  },

  async revoke(grantId: string, revokedBy: string): Promise<SupportAccessGrant | undefined> {
    const row = await queryOne<GrantRow>(
      `UPDATE support_access_grant
          SET revoked_at = CURRENT_TIMESTAMP, revoked_by = $2
        WHERE id = $1 AND revoked_at IS NULL RETURNING *`,
      [grantId, revokedBy]
    );
    return row ? toGrant(row) : undefined;
  },

  /** Records that a grant was actually exercised, not merely issued. */
  async markUsed(grantId: string): Promise<void> {
    await query(
      `UPDATE support_access_grant
          SET last_used_at = CURRENT_TIMESTAMP, use_count = use_count + 1
        WHERE id = $1`,
      [grantId]
    );
  },
};

// --- Internal staff and audit --------------------------------------

interface InternalUserRow {
  id: string;
  email: string;
  name: string;
  role: InternalUser['role'];
  status: InternalUser['status'];
  password_hash: string | null;
  last_login_at: Date | null;
  created_at: Date;
}

const toInternalUser = (row: InternalUserRow): InternalUser => ({
  id: row.id,
  email: row.email,
  name: row.name,
  role: row.role,
  status: row.status,
  lastLoginAt: iso(row.last_login_at),
  createdAt: row.created_at.toISOString(),
});

export const internalUsers = {
  async list(): Promise<InternalUser[]> {
    const rows = await query<InternalUserRow>('SELECT * FROM internal_user ORDER BY name');
    return rows.map(toInternalUser);
  },

  async byEmail(email: string): Promise<(InternalUser & { passwordHash: string | null }) | undefined> {
    const row = await queryOne<InternalUserRow>('SELECT * FROM internal_user WHERE lower(email) = lower($1)', [
      email,
    ]);
    return row ? { ...toInternalUser(row), passwordHash: row.password_hash } : undefined;
  },

  async upsert(input: {
    email: string;
    name: string;
    role: InternalUser['role'];
    passwordHash?: string;
  }): Promise<InternalUser> {
    const row = await queryOne<InternalUserRow>(
      `INSERT INTO internal_user (id, email, name, role, password_hash)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (email) DO UPDATE SET
         name = EXCLUDED.name,
         role = EXCLUDED.role,
         password_hash = COALESCE(EXCLUDED.password_hash, internal_user.password_hash)
       RETURNING *`,
      [id('iu'), input.email.toLowerCase(), input.name, input.role, input.passwordHash ?? null]
    );
    return toInternalUser(row!);
  },

  async touchLogin(email: string): Promise<void> {
    await query('UPDATE internal_user SET last_login_at = CURRENT_TIMESTAMP WHERE lower(email) = lower($1)', [
      email,
    ]);
  },
};

export const internalAudit = {
  async record(entry: {
    actorEmail: string;
    action: string;
    entityType: string;
    entityId?: string | null;
    clientId?: string | null;
    previousValue?: unknown;
    newValue?: unknown;
    ip?: string | null;
  }): Promise<void> {
    await query(
      `INSERT INTO internal_audit_log
         (actor_email, action, entity_type, entity_id, client_id, previous_value, new_value, ip)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        entry.actorEmail,
        entry.action,
        entry.entityType,
        entry.entityId ?? null,
        entry.clientId ?? null,
        entry.previousValue === undefined ? null : JSON.stringify(entry.previousValue),
        entry.newValue === undefined ? null : JSON.stringify(entry.newValue),
        entry.ip ?? null,
      ]
    );
  },

  async list(filter: { clientId?: string; limit?: number } = {}): Promise<InternalAuditEntry[]> {
    const params: unknown[] = [];
    let where = '';
    if (filter.clientId) {
      params.push(filter.clientId);
      where = `WHERE client_id = $${params.length}`;
    }
    params.push(Math.min(filter.limit ?? 100, 500));
    const rows = await query<{
      id: string;
      actor_email: string;
      action: string;
      entity_type: string;
      entity_id: string | null;
      client_id: string | null;
      previous_value: unknown;
      new_value: unknown;
      ip: string | null;
      occurred_at: Date;
    }>(`SELECT * FROM internal_audit_log ${where} ORDER BY occurred_at DESC LIMIT $${params.length}`, params);

    return rows.map((row) => ({
      id: Number(row.id),
      actorEmail: row.actor_email,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      clientId: row.client_id,
      previousValue: row.previous_value,
      newValue: row.new_value,
      ip: row.ip,
      occurredAt: row.occurred_at.toISOString(),
    }));
  },
};

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24);
}
