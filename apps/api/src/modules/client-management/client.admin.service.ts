import type {
  ClientAccount,
  ClientLifecycleStatus,
  ClientSubscription,
  InternalAuditEntry,
  SupportAccessGrant,
} from '@factory-vision/domain-types';
import { ApiError } from '../../platform/http/api-error.js';
import { clients, internalAudit, plans, subscriptions, supportAccess } from './client.repository.js';

/** A support grant lives at most this long, however long was asked for. */
const MAX_SUPPORT_HOURS = 72;

/**
 * The write side of client management.
 *
 * Split from the read service because every method here changes a commercial
 * fact and therefore writes an audit row. Keeping the two apart makes it hard
 * to add a mutation that forgets to record who made it.
 */
export class ClientAdminService {
  // ---------------------------------------------------------
  // Clients
  // ---------------------------------------------------------

  async createClient(
    input: Parameters<typeof clients.create>[0],
    actor: { email: string; ip?: string }
  ): Promise<{ client: ClientAccount; subscription: ClientSubscription }> {
    const plan = await plans.byId(input.planId);
    if (!plan) throw ApiError.validation('Paket langganan tidak dikenal.');

    const result = await clients.create(input);

    await internalAudit.record({
      actorEmail: actor.email,
      action: 'CLIENT_CREATED',
      entityType: 'client_account',
      entityId: result.client.id,
      clientId: result.client.id,
      newValue: {
        displayName: result.client.displayName,
        tenantId: result.client.tenantId,
        plan: plan.code,
        lifecycleStatus: result.client.lifecycleStatus,
      },
      ip: actor.ip,
    });

    return result;
  }

  async updateClient(
    clientId: string,
    patch: Partial<ClientAccount>,
    actor: { email: string; ip?: string }
  ): Promise<ClientAccount> {
    const before = await clients.byId(clientId);
    if (!before) throw ApiError.notFound('Klien tidak ditemukan.');

    const after = await clients.update(clientId, patch);
    if (!after) throw ApiError.notFound('Klien tidak ditemukan.');

    await internalAudit.record({
      actorEmail: actor.email,
      action: before.lifecycleStatus !== after.lifecycleStatus ? 'CLIENT_STATUS_CHANGED' : 'CLIENT_UPDATED',
      entityType: 'client_account',
      entityId: clientId,
      clientId,
      previousValue: before,
      newValue: after,
      ip: actor.ip,
    });

    return after;
  }

  /**
   * Suspending a client stops their subscription too.
   *
   * Leaving the subscription ACTIVE on a suspended account would keep counting
   * them as revenue in the portfolio total, which is the number the business
   * makes decisions from.
   */
  async setLifecycleStatus(
    clientId: string,
    status: ClientLifecycleStatus,
    actor: { email: string; ip?: string }
  ): Promise<ClientAccount> {
    const updated = await this.updateClient(clientId, { lifecycleStatus: status }, actor);

    if (status === 'SUSPENDED') await subscriptions.setStatus(clientId, 'PAST_DUE');
    if (status === 'CHURNED') await subscriptions.setStatus(clientId, 'CANCELLED');

    return updated;
  }

  // ---------------------------------------------------------
  // Subscriptions
  // ---------------------------------------------------------

  async changePlan(
    input: Parameters<typeof subscriptions.changePlan>[0],
    actor: { email: string; ip?: string }
  ): Promise<ClientSubscription> {
    const client = await clients.byId(input.clientId);
    if (!client) throw ApiError.notFound('Klien tidak ditemukan.');
    const plan = await plans.byId(input.planId);
    if (!plan) throw ApiError.validation('Paket langganan tidak dikenal.');

    const previous = await subscriptions.currentFor(input.clientId);
    const next = await subscriptions.changePlan(input);

    await internalAudit.record({
      actorEmail: actor.email,
      action: 'SUBSCRIPTION_CHANGED',
      entityType: 'client_subscription',
      entityId: next.id,
      clientId: input.clientId,
      previousValue: previous ?? null,
      newValue: next,
      ip: actor.ip,
    });

    return next;
  }

  async subscriptionHistory(clientId: string): Promise<ClientSubscription[]> {
    return subscriptions.allFor(clientId);
  }

  // ---------------------------------------------------------
  // Support access
  // ---------------------------------------------------------

  /**
   * Grants time-boxed access into a customer's console.
   *
   * Reading someone else's production data needs a reason and an end date. The
   * ceiling is enforced here rather than trusted from the request, because an
   * open-ended grant is the one that gets forgotten.
   */
  async grantSupportAccess(
    input: {
      clientId: string;
      grantedTo: string;
      reason: string;
      accessLevel: 'READ_ONLY' | 'READ_WRITE';
      hours: number;
    },
    actor: { email: string; ip?: string }
  ): Promise<SupportAccessGrant> {
    const client = await clients.byId(input.clientId);
    if (!client) throw ApiError.notFound('Klien tidak ditemukan.');

    if (input.reason.trim().length < 10) {
      throw ApiError.validation('Alasan akses harus dijelaskan, minimal 10 karakter.', [
        { field: 'reason', code: 'TOO_SHORT', message: 'Tuliskan alasan akses yang dapat diaudit.' },
      ]);
    }

    const hours = Math.min(Math.max(input.hours, 1), MAX_SUPPORT_HOURS);
    const expiresAt = new Date(Date.now() + hours * 3_600_000).toISOString();

    const grant = await supportAccess.grant({
      clientId: input.clientId,
      grantedTo: input.grantedTo,
      grantedBy: actor.email,
      reason: input.reason.trim(),
      accessLevel: input.accessLevel,
      expiresAt,
    });

    await internalAudit.record({
      actorEmail: actor.email,
      action: 'SUPPORT_ACCESS_GRANTED',
      entityType: 'support_access_grant',
      entityId: grant.id,
      clientId: input.clientId,
      newValue: {
        grantedTo: grant.grantedTo,
        accessLevel: grant.accessLevel,
        expiresAt: grant.expiresAt,
        reason: grant.reason,
      },
      ip: actor.ip,
    });

    return grant;
  }

  async revokeSupportAccess(
    grantId: string,
    actor: { email: string; ip?: string }
  ): Promise<SupportAccessGrant> {
    const grant = await supportAccess.revoke(grantId, actor.email);
    if (!grant) throw ApiError.notFound('Akses dukungan tidak ditemukan atau sudah dicabut.');

    await internalAudit.record({
      actorEmail: actor.email,
      action: 'SUPPORT_ACCESS_REVOKED',
      entityType: 'support_access_grant',
      entityId: grantId,
      clientId: grant.clientId,
      previousValue: { expiresAt: grant.expiresAt, grantedTo: grant.grantedTo },
      ip: actor.ip,
    });

    return grant;
  }

  async listSupportAccess(clientId: string): Promise<SupportAccessGrant[]> {
    return supportAccess.listFor(clientId);
  }

  async listActiveSupportAccess(): Promise<SupportAccessGrant[]> {
    return supportAccess.listActive();
  }

  /**
   * Exchanges a live grant for the tenant it opens.
   *
   * This is the only path from the vendor console into customer data, and it
   * records the use, so "who looked at this factory's numbers" is answerable
   * afterwards rather than inferred.
   */
  async useSupportAccess(
    grantId: string,
    actor: { email: string; ip?: string }
  ): Promise<{ tenantId: string; accessLevel: 'READ_ONLY' | 'READ_WRITE'; expiresAt: string }> {
    const grants = await supportAccess.listActive();
    const grant = grants.find((g) => g.id === grantId);
    if (!grant) throw ApiError.forbidden('Akses dukungan tidak aktif atau sudah kedaluwarsa.');
    if (grant.grantedTo.toLowerCase() !== actor.email.toLowerCase()) {
      throw ApiError.forbidden('Akses dukungan ini diberikan kepada orang lain.');
    }

    const client = await clients.byId(grant.clientId);
    if (!client) throw ApiError.notFound('Klien tidak ditemukan.');

    await supportAccess.markUsed(grantId);
    await internalAudit.record({
      actorEmail: actor.email,
      action: 'SUPPORT_ACCESS_USED',
      entityType: 'support_access_grant',
      entityId: grantId,
      clientId: grant.clientId,
      newValue: { tenantId: client.tenantId, accessLevel: grant.accessLevel },
      ip: actor.ip,
    });

    return { tenantId: client.tenantId, accessLevel: grant.accessLevel, expiresAt: grant.expiresAt };
  }

  // ---------------------------------------------------------
  // Audit
  // ---------------------------------------------------------

  async auditTrail(filter: { clientId?: string; limit?: number } = {}): Promise<InternalAuditEntry[]> {
    return internalAudit.list(filter);
  }
}
