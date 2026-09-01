import { MoldStatus, type Mold, type ProductMoldCompatibility } from '@factory-vision/domain-types';
import { withTenant } from '../../platform/db/pool.js';
import { ApiError } from '../../platform/http/api-error.js';
import {
  MoldRepository,
  type MoldFilter,
  type MoldInput,
  type MoldWithCompatibility,
} from './mold.repository.js';

/**
 * Mould master data (MES-006), and the compatibility that ADR-36 reads.
 *
 * The rules here are the ones a schema cannot hold:
 *
 *  - a mould in use cannot be retired, because retiring it would make the Work
 *    Orders running on it unconfirmable half-way through;
 *  - a mould that production has referenced cannot be deleted, only retired,
 *    because the reference is the record of what was actually made;
 *  - a compatibility is deactivated, never dropped, once anything might have
 *    been confirmed against it — see the repository for why.
 */

const EDITABLE_STATUSES = Object.values(MoldStatus) as string[];

export class MoldService {
  private readonly molds = new MoldRepository();

  async list(tenantId: string, filter: MoldFilter = {}): Promise<Mold[]> {
    return withTenant(tenantId, (client) => this.molds.list(client, tenantId, filter));
  }

  async get(tenantId: string, id: string): Promise<MoldWithCompatibility> {
    return withTenant(tenantId, async (client) => {
      const mold = await this.molds.findById(client, tenantId, id);
      if (!mold) throw ApiError.notFound('Mold tidak ditemukan.');
      const compatibilities = await this.molds.listCompatibilities(client, tenantId, {
        moldId: id,
      });
      return { ...mold, compatibilities };
    });
  }

  async create(tenantId: string, input: MoldInput): Promise<Mold> {
    return withTenant(tenantId, async (client) => {
      const existing = await this.molds.findByCode(client, tenantId, input.code);
      // Checked before the insert so the operator sees which code clashed,
      // rather than a unique-violation message naming a constraint.
      if (existing) {
        throw ApiError.conflict(`Kode mold ${input.code} sudah digunakan.`);
      }
      await this.assertMachine(client, tenantId, input.currentMachineId);
      return this.molds.create(client, tenantId, input);
    });
  }

  async update(tenantId: string, id: string, changes: Partial<MoldInput>): Promise<Mold> {
    return withTenant(tenantId, async (client) => {
      const current = await this.molds.findById(client, tenantId, id);
      if (!current) throw ApiError.notFound('Mold tidak ditemukan.');

      if (changes.code && changes.code.toLowerCase() !== current.code.toLowerCase()) {
        const clash = await this.molds.findByCode(client, tenantId, changes.code);
        if (clash) throw ApiError.conflict(`Kode mold ${changes.code} sudah digunakan.`);
      }

      await this.assertMachine(client, tenantId, changes.currentMachineId);

      if (changes.status && changes.status !== current.status) {
        this.assertStatusChange(current, changes.status);
      }

      const updated = await this.molds.update(client, tenantId, id, changes);
      if (!updated) throw ApiError.notFound('Mold tidak ditemukan.');
      return updated;
    });
  }

  /**
   * Deletes a mould, or explains why it cannot be.
   *
   * Retiring is offered in the message because it is almost always what the
   * user actually wants: the mould is gone from the shop floor, but the orders
   * it produced still name it.
   */
  async remove(tenantId: string, id: string): Promise<void> {
    return withTenant(tenantId, async (client) => {
      const mold = await this.molds.findById(client, tenantId, id);
      if (!mold) throw ApiError.notFound('Mold tidak ditemukan.');

      const references = await this.molds.referenceCounts(client, tenantId, id);
      if (references.workOrders > 0 || references.batches > 0) {
        throw ApiError.conflict(
          `Mold ${mold.code} tidak dapat dihapus karena masih dipakai ` +
            `${references.workOrders} work order dan ${references.batches} batch. ` +
            'Ubah statusnya menjadi RETIRED bila mold sudah tidak dipakai.'
        );
      }
      // Compatibility rows belong to the mould and mean nothing without it, so
      // they go with it — unlike production references, which outlive it.
      await client.query(
        'DELETE FROM product_mold_compatibility WHERE tenant_id = $1 AND mold_id = $2',
        [tenantId, id]
      );
      await this.molds.remove(client, tenantId, id);
    });
  }

  // --- Compatibility (ADR-36) -----------------------------------------

  async listCompatibilities(
    tenantId: string,
    filter: { moldId?: string; productId?: string; activeOnly?: boolean } = {}
  ): Promise<ProductMoldCompatibility[]> {
    return withTenant(tenantId, (client) =>
      this.molds.listCompatibilities(client, tenantId, filter)
    );
  }

  async addCompatibility(
    tenantId: string,
    moldId: string,
    productId: string
  ): Promise<ProductMoldCompatibility> {
    return withTenant(tenantId, async (client) => {
      const mold = await this.molds.findById(client, tenantId, moldId);
      if (!mold) throw ApiError.notFound('Mold tidak ditemukan.');
      if (mold.status === MoldStatus.RETIRED) {
        throw ApiError.invalidState(
          `Mold ${mold.code} sudah RETIRED, sehingga tidak dapat dijadikan kompatibel dengan produk baru.`
        );
      }
      if (!(await this.molds.productExists(client, tenantId, productId))) {
        throw ApiError.validation('Produk tidak ditemukan.', [
          { field: 'productId', code: 'NOT_FOUND', message: 'Produk tidak ditemukan.' },
        ]);
      }
      return this.molds.upsertCompatibility(client, tenantId, moldId, productId, true);
    });
  }

  /**
   * Turns a compatibility on or off.
   *
   * Deactivating one is a real production decision, not a tidy-up: ADR-36 says
   * a Work Order needs a mould only while its product has an active
   * compatibility, so this is the switch that makes the mould field required or
   * optional on the confirmation checklist.
   */
  async setCompatibilityActive(
    tenantId: string,
    moldId: string,
    compatibilityId: string,
    active: boolean
  ): Promise<ProductMoldCompatibility> {
    return withTenant(tenantId, async (client) => {
      const existing = await this.molds.findCompatibility(client, tenantId, compatibilityId);
      if (!existing || existing.moldId !== moldId) {
        throw ApiError.notFound('Kompatibilitas mold tidak ditemukan.');
      }
      const updated = await this.molds.setCompatibilityActive(
        client,
        tenantId,
        compatibilityId,
        active
      );
      if (!updated) throw ApiError.notFound('Kompatibilitas mold tidak ditemukan.');
      return updated;
    });
  }

  async removeCompatibility(
    tenantId: string,
    moldId: string,
    compatibilityId: string
  ): Promise<void> {
    return withTenant(tenantId, async (client) => {
      const existing = await this.molds.findCompatibility(client, tenantId, compatibilityId);
      if (!existing || existing.moldId !== moldId) {
        throw ApiError.notFound('Kompatibilitas mold tidak ditemukan.');
      }
      await client.query(
        'DELETE FROM product_mold_compatibility WHERE tenant_id = $1 AND id = $2',
        [tenantId, compatibilityId]
      );
    });
  }

  /** Moulds a product may run on — what the Work Order form offers (ADR-36). */
  async listForProduct(tenantId: string, productId: string): Promise<Mold[]> {
    return withTenant(tenantId, (client) =>
      this.molds.list(client, tenantId, { productId, status: undefined })
    );
  }

  // --- Rules ----------------------------------------------------------

  private assertStatusChange(current: Mold, next: string): void {
    if (!EDITABLE_STATUSES.includes(next)) {
      throw ApiError.validation(`Status mold ${next} tidak dikenal.`);
    }
    if (current.status === MoldStatus.IN_USE && next === MoldStatus.RETIRED) {
      // A mould cannot leave the register while a machine is running it: the
      // Work Order confirmed against it would lose the thing it was confirmed
      // against, mid-run.
      throw ApiError.invalidState(
        `Mold ${current.code} sedang IN_USE dan tidak dapat langsung di-RETIRED. ` +
          'Lepaskan dari mesin terlebih dahulu.'
      );
    }
  }

  private async assertMachine(
    client: { query: (text: string, params?: unknown[]) => Promise<unknown> },
    tenantId: string,
    machineId: string | null | undefined
  ): Promise<void> {
    if (!machineId) return;
    const exists = await this.molds.machineExists(
      client as Parameters<MoldRepository['machineExists']>[0],
      tenantId,
      machineId
    );
    if (!exists) {
      throw ApiError.validation('Mesin tidak ditemukan.', [
        { field: 'currentMachineId', code: 'NOT_FOUND', message: 'Mesin tidak ditemukan.' },
      ]);
    }
  }
}
