import type {
  ClientAttention,
  ClientLifecycleStatus,
  ClientLimitReport,
  ClientOverview,
  ClientPortfolioSummary,
  ClientUsageSnapshot,
  EffectiveLimits,
  LimitUsage,
  SubscriptionPlan,
} from '@factory-vision/domain-types';
import { ApiError } from '../../platform/http/api-error.js';
import { isDatabaseConfigured } from '../../platform/db/pool.js';
import { MasterDataService } from '../master-data/master-data.service.js';
import { ProductionService } from '../production/production.service.js';
import { ShopFloorService } from '../shopfloor/shopfloor.service.js';
import { clients, internalAudit, plans, subscriptions, supportAccess, usage } from './client.repository.js';

/** A renewal inside this many days is worth surfacing before it lapses. */
const RENEWAL_WARNING_DAYS = 30;

/** Silence for longer than this is the earliest visible sign of churn. */
const INACTIVITY_WARNING_DAYS = 14;

/**
 * Client management for the vendor's own console.
 *
 * The rules that matter here are commercial rather than manufacturing: what a
 * customer is entitled to, whether they have outgrown it, whether their
 * agreement is about to lapse, and whether anyone from the vendor currently
 * holds access to their data.
 */
export class ClientManagementService {
  constructor(
    private masterData: MasterDataService,
    private production: ProductionService,
    private shopFloor: ShopFloorService
  ) {}

  /** Client management is the one module that cannot run without a database. */
  private requireDatabase(): void {
    if (!isDatabaseConfigured()) {
      throw new ApiError(
        'INTERNAL_ERROR',
        'Client management memerlukan DATABASE_URL. Data klien harus bertahan lintas restart.',
        503
      );
    }
  }

  // ---------------------------------------------------------
  // Plans
  // ---------------------------------------------------------

  async listPlans(): Promise<SubscriptionPlan[]> {
    this.requireDatabase();
    return plans.list();
  }

  // ---------------------------------------------------------
  // Entitlement arithmetic
  // ---------------------------------------------------------

  /**
   * A per-client override beats the plan's ceiling, because a signed exception
   * is a fact about this customer rather than a new plan for everyone.
   */
  private effectiveLimits(
    plan: SubscriptionPlan | undefined,
    subscription: Awaited<ReturnType<typeof subscriptions.currentFor>>
  ): EffectiveLimits {
    const pick = (override: number | null | undefined, planLimit: number | null | undefined) =>
      override ?? planLimit ?? null;

    return {
      maxPlants: pick(subscription?.overrideMaxPlants, plan?.maxPlants),
      maxProductionLines: pick(subscription?.overrideMaxProductionLines, plan?.maxProductionLines),
      maxMachines: pick(subscription?.overrideMaxMachines, plan?.maxMachines),
      maxUsers: pick(subscription?.overrideMaxUsers, plan?.maxUsers),
      maxOperators: pick(subscription?.overrideMaxOperators, plan?.maxOperators),
    };
  }

  private limitUsage(used: number, limit: number | null): LimitUsage {
    return {
      used,
      limit,
      utilisationPct: limit && limit > 0 ? Number(((used / limit) * 100).toFixed(1)) : null,
      exceeded: limit !== null && used > limit,
    };
  }

  private limitReport(usageRow: ClientUsageSnapshot, limits: EffectiveLimits): ClientLimitReport {
    return {
      plants: this.limitUsage(usageRow.plants, limits.maxPlants),
      productionLines: this.limitUsage(usageRow.productionLines, limits.maxProductionLines),
      machines: this.limitUsage(usageRow.machines, limits.maxMachines),
      users: this.limitUsage(usageRow.users, limits.maxUsers),
      operators: this.limitUsage(usageRow.operators, limits.maxOperators),
    };
  }

  private daysBetween(from: Date, to: Date): number {
    return Math.round((to.getTime() - from.getTime()) / 86_400_000);
  }

  /**
   * What an account manager should look at, ordered by how much it costs to
   * ignore. A lapsed subscription is money already lost; a client silently
   * over their limit is money not yet billed.
   */
  private attentionFor(overview: Omit<ClientOverview, 'attention'>, openGrants: number): ClientAttention[] {
    const items: ClientAttention[] = [];
    const { client, subscription, limitReport, daysToRenewal, daysSinceActivity } = overview;

    if (subscription && daysToRenewal !== null && daysToRenewal < 0) {
      items.push({
        kind: 'SUBSCRIPTION_LAPSED',
        severity: 'CRITICAL',
        message: `Langganan lewat tanggal perpanjangan ${Math.abs(daysToRenewal)} hari lalu.`,
      });
    } else if (daysToRenewal !== null && daysToRenewal <= RENEWAL_WARNING_DAYS) {
      items.push({
        kind: 'RENEWAL_DUE',
        severity: 'WARNING',
        message: `Perpanjangan jatuh tempo dalam ${daysToRenewal} hari.`,
      });
    }

    if (limitReport) {
      const over = Object.entries(limitReport)
        .filter(([, value]) => (value as LimitUsage).exceeded)
        .map(([key]) => key);
      if (over.length > 0) {
        items.push({
          kind: 'LIMIT_EXCEEDED',
          severity: 'WARNING',
          message: `Melebihi batas paket pada: ${over.join(', ')}.`,
        });
      }
    }

    if (daysSinceActivity !== null && daysSinceActivity >= INACTIVITY_WARNING_DAYS) {
      items.push({
        kind: 'NO_RECENT_ACTIVITY',
        severity: client.lifecycleStatus === 'ACTIVE' ? 'WARNING' : 'INFORMATIONAL',
        message: `Tidak ada aktivitas tercatat selama ${daysSinceActivity} hari.`,
      });
    }

    if (client.lifecycleStatus === 'TRIAL' && daysToRenewal !== null && daysToRenewal <= 14) {
      items.push({
        kind: 'TRIAL_ENDING',
        severity: 'WARNING',
        message: `Masa trial berakhir dalam ${daysToRenewal} hari.`,
      });
    }

    if (openGrants > 0) {
      items.push({
        kind: 'SUPPORT_ACCESS_OPEN',
        severity: 'INFORMATIONAL',
        message: `${openGrants} akses dukungan masih aktif ke data klien ini.`,
      });
    }

    return items;
  }

  // ---------------------------------------------------------
  // Reads
  // ---------------------------------------------------------

  async listClients(
    filter: { status?: ClientLifecycleStatus; search?: string } = {}
  ): Promise<ClientOverview[]> {
    this.requireDatabase();

    const [accounts, allPlans, latestUsage, activeGrants] = await Promise.all([
      clients.list(filter),
      plans.list(),
      usage.latestForAll(),
      supportAccess.listActive(),
    ]);

    const planById = new Map(allPlans.map((p) => [p.id, p]));
    const grantsByClient = new Map<string, number>();
    for (const grant of activeGrants) {
      grantsByClient.set(grant.clientId, (grantsByClient.get(grant.clientId) ?? 0) + 1);
    }

    const overviews: ClientOverview[] = [];
    for (const client of accounts) {
      const subscription = (await subscriptions.currentFor(client.id)) ?? null;
      const plan = subscription ? planById.get(subscription.planId) : undefined;
      const limits = this.effectiveLimits(plan, subscription ?? undefined);
      const usageRow = latestUsage.get(client.id) ?? null;

      const now = new Date();
      const daysToRenewal = subscription?.renewsAt
        ? this.daysBetween(now, new Date(`${subscription.renewsAt}T00:00:00Z`))
        : null;
      const daysSinceActivity = usageRow?.lastActivityAt
        ? this.daysBetween(new Date(usageRow.lastActivityAt), now)
        : null;

      const base = {
        client,
        subscription,
        limits,
        usage: usageRow,
        limitReport: usageRow ? this.limitReport(usageRow, limits) : null,
        daysToRenewal,
        daysSinceActivity,
      };

      overviews.push({ ...base, attention: this.attentionFor(base, grantsByClient.get(client.id) ?? 0) });
    }

    // Anything needing action first; the rest alphabetically.
    return overviews.sort((a, b) => {
      const weight = (o: ClientOverview) =>
        o.attention.some((x) => x.severity === 'CRITICAL') ? 0 : o.attention.length > 0 ? 1 : 2;
      return weight(a) - weight(b) || a.client.displayName.localeCompare(b.client.displayName);
    });
  }

  async getClient(clientId: string): Promise<ClientOverview> {
    this.requireDatabase();
    const client = await clients.byId(clientId);
    if (!client) throw ApiError.notFound('Klien tidak ditemukan.');

    const [subscription, allPlans, usageRow, grants] = await Promise.all([
      subscriptions.currentFor(client.id),
      plans.list(),
      usage.latestFor(client.id),
      supportAccess.listFor(client.id),
    ]);

    const plan = subscription ? allPlans.find((p) => p.id === subscription.planId) : undefined;
    const limits = this.effectiveLimits(plan, subscription);
    const now = new Date();

    const base = {
      client,
      subscription: subscription ?? null,
      limits,
      usage: usageRow ?? null,
      limitReport: usageRow ? this.limitReport(usageRow, limits) : null,
      daysToRenewal: subscription?.renewsAt
        ? this.daysBetween(now, new Date(`${subscription.renewsAt}T00:00:00Z`))
        : null,
      daysSinceActivity: usageRow?.lastActivityAt
        ? this.daysBetween(new Date(usageRow.lastActivityAt), now)
        : null,
    };

    return { ...base, attention: this.attentionFor(base, grants.filter((g) => g.active).length) };
  }

  async portfolioSummary(): Promise<ClientPortfolioSummary> {
    this.requireDatabase();
    const overviews = await this.listClients({});
    const allPlans = await plans.list();
    const planById = new Map(allPlans.map((p) => [p.id, p]));

    const byStatus: Record<ClientLifecycleStatus, number> = {
      PROSPECT: 0,
      TRIAL: 0,
      ACTIVE: 0,
      SUSPENDED: 0,
      CHURNED: 0,
    };
    let monthlyRecurringIdr = 0;
    let renewalsDue30d = 0;
    let clientsOverLimit = 0;
    let clientsWithoutRecentActivity = 0;

    for (const o of overviews) {
      byStatus[o.client.lifecycleStatus] += 1;

      // Only a live subscription is revenue; a trial or a lapsed one is not.
      if (o.subscription?.status === 'ACTIVE' && o.client.lifecycleStatus === 'ACTIVE') {
        monthlyRecurringIdr += planById.get(o.subscription.planId)?.monthlyPriceIdr ?? 0;
      }
      if (o.daysToRenewal !== null && o.daysToRenewal >= 0 && o.daysToRenewal <= RENEWAL_WARNING_DAYS) {
        renewalsDue30d += 1;
      }
      if (o.attention.some((a) => a.kind === 'LIMIT_EXCEEDED')) clientsOverLimit += 1;
      if (o.attention.some((a) => a.kind === 'NO_RECENT_ACTIVITY')) clientsWithoutRecentActivity += 1;
    }

    const openSupportGrants = (await supportAccess.listActive()).length;

    return {
      totalClients: overviews.length,
      byStatus,
      monthlyRecurringIdr,
      renewalsDue30d,
      clientsOverLimit,
      clientsWithoutRecentActivity,
      openSupportGrants,
    };
  }

  // ---------------------------------------------------------
  // Usage sampling
  // ---------------------------------------------------------

  /**
   * Samples what each client's tenant currently holds.
   *
   * Counts come from the live MES services, which is why this is a snapshot
   * written to the database rather than a query over one: the MES layer keeps
   * its state in memory, so a number not written down today is gone tomorrow.
   */
  async captureUsage(actorEmail = 'system'): Promise<ClientUsageSnapshot[]> {
    this.requireDatabase();
    const accounts = await clients.list({});
    const capturedOn = new Date().toISOString().slice(0, 10);
    const captured: ClientUsageSnapshot[] = [];

    for (const client of accounts) {
      const tenantId = client.tenantId;
      const productionRecords = this.shopFloor.getProductionRecords(tenantId);
      const downtimeRecords = this.shopFloor.getDowntimeRecords(tenantId);
      const users = this.masterData.getUsers(tenantId);

      const timestamps = [
        ...productionRecords.map((r) => r.recordedAt),
        ...downtimeRecords.map((r) => r.startTime),
        ...users.map((u) => u.lastLoginAt).filter((v): v is string => Boolean(v)),
      ]
        .filter(Boolean)
        .sort();

      const sevenDaysAgo = Date.now() - 7 * 86_400_000;
      const snapshot: ClientUsageSnapshot = {
        clientId: client.id,
        capturedOn,
        plants: this.masterData.getPlants(tenantId).length,
        productionLines: this.masterData.getLines(tenantId).length,
        machines: this.masterData.getMachines(tenantId).length,
        products: this.masterData.getProducts(tenantId).length,
        users: users.length,
        operators: this.masterData.getOperators(tenantId).length,
        activeUsers7d: users.filter((u) => u.lastLoginAt && Date.parse(u.lastLoginAt) >= sevenDaysAgo).length,
        workOrdersCreated: this.production.getWorkOrders(tenantId).length,
        productionRecords: productionRecords.length,
        downtimeRecords: downtimeRecords.length,
        terminalsOnline: this.masterData.getDevices(tenantId).filter((d) => d.status === 'ONLINE').length,
        lastActivityAt: timestamps.length ? timestamps[timestamps.length - 1] : null,
      };

      await usage.record(snapshot);
      captured.push(snapshot);
    }

    await internalAudit.record({
      actorEmail,
      action: 'USAGE_CAPTURED',
      entityType: 'client_usage_snapshot',
      newValue: { clients: captured.length, capturedOn },
    });

    return captured;
  }

  async usageHistory(clientId: string, days = 30): Promise<ClientUsageSnapshot[]> {
    this.requireDatabase();
    return usage.historyFor(clientId, days);
  }
}
