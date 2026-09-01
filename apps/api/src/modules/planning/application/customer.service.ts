import { randomUUID } from 'crypto';
import type { Customer } from '@factory-vision/domain-types';
import { withTenant } from '../../../platform/db/pool.js';
import { ApiError } from '../../../platform/http/api-error.js';
import { CustomerRepository } from '../infrastructure/customer.repository.js';
import { PlanningAudit } from '../infrastructure/planning-audit.js';

/**
 * Customer master (MES-029).
 *
 * `code` is unique per tenant, and an inactive customer disappears from the
 * order form's picker but never from an order that already names it — an order
 * whose customer went inactive still has to be readable, or last quarter's
 * history stops making sense.
 */

export interface CustomerInput {
  code: string;
  name: string;
  picName?: string;
  picContact?: string;
  deliveryAddress?: string;
  dockNumber?: string;
  status?: 'ACTIVE' | 'INACTIVE';
}

export class CustomerService {
  private readonly repo = new CustomerRepository();
  private readonly audit = new PlanningAudit();

  async list(
    tenantId: string,
    filter: { status?: string; search?: string; activeOnly?: boolean } = {}
  ): Promise<Customer[]> {
    return withTenant(tenantId, (client) =>
      this.repo.list(client, tenantId, {
        status: filter.activeOnly ? 'ACTIVE' : filter.status,
        search: filter.search,
      })
    );
  }

  async get(tenantId: string, id: string): Promise<Customer> {
    const customer = await withTenant(tenantId, (client) => this.repo.findById(client, tenantId, id));
    if (!customer) throw ApiError.notFound('Customer tidak ditemukan.');
    return customer;
  }

  async create(tenantId: string, input: CustomerInput, actorId: string): Promise<Customer> {
    return withTenant(tenantId, async (client) => {
      const existing = await this.repo.findByCode(client, tenantId, input.code);
      if (existing) {
        throw ApiError.conflict(`Customer dengan code ${input.code} sudah ada.`);
      }

      const customer: Customer = {
        id: `cust-${randomUUID()}`,
        tenantId,
        code: input.code,
        name: input.name,
        picName: input.picName,
        picContact: input.picContact,
        deliveryAddress: input.deliveryAddress,
        dockNumber: input.dockNumber,
        status: input.status ?? 'ACTIVE',
      };

      const created = await this.repo.insert(client, customer);
      await this.audit.record(client, {
        tenantId,
        actorId,
        entityType: 'customer',
        entityId: created.id,
        action: 'CREATE',
        newValue: created,
      });
      return created;
    });
  }

  async update(
    tenantId: string,
    id: string,
    patch: Partial<CustomerInput>,
    actorId: string
  ): Promise<Customer> {
    return withTenant(tenantId, async (client) => {
      const before = await this.repo.findById(client, tenantId, id);
      if (!before) throw ApiError.notFound('Customer tidak ditemukan.');

      if (patch.code && patch.code !== before.code) {
        const clash = await this.repo.findByCode(client, tenantId, patch.code);
        if (clash) throw ApiError.conflict(`Customer dengan code ${patch.code} sudah ada.`);
      }

      const updated = await this.repo.update(client, tenantId, id, patch);
      if (!updated) throw ApiError.notFound('Customer tidak ditemukan.');

      await this.audit.record(client, {
        tenantId,
        actorId,
        entityType: 'customer',
        entityId: id,
        action: 'UPDATE',
        previousValue: before,
        newValue: updated,
      });
      return updated;
    });
  }

  /**
   * Deactivation rather than deletion.
   *
   * Orders reference customers by foreign key; deleting one would either fail
   * or orphan history that an auditor will ask about.
   */
  async deactivate(tenantId: string, id: string, actorId: string): Promise<Customer> {
    return this.update(tenantId, id, { status: 'INACTIVE' }, actorId);
  }
}
