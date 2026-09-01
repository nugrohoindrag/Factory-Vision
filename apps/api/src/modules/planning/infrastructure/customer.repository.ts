import type { Customer } from '@factory-vision/domain-types';
import { asOptionalIsoString, orUndefined, type Executor } from '../../../platform/db/executor.js';

/** `customer` (MES-004, MES-029). */

const COLUMNS = `
  id, tenant_id, code, name, pic_name, pic_contact, delivery_address, dock_number,
  status, created_at, updated_at
`;

interface Row {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
  pic_name: string | null;
  pic_contact: string | null;
  delivery_address: string | null;
  dock_number: string | null;
  status: string;
  created_at: Date | string | null;
  updated_at: Date | string | null;
}

function toDomain(row: Row): Customer {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    code: row.code,
    name: row.name,
    picName: orUndefined(row.pic_name),
    picContact: orUndefined(row.pic_contact),
    deliveryAddress: orUndefined(row.delivery_address),
    dockNumber: orUndefined(row.dock_number),
    status: (row.status as Customer['status']) ?? 'ACTIVE',
    createdAt: asOptionalIsoString(row.created_at),
    updatedAt: asOptionalIsoString(row.updated_at),
  };
}

export class CustomerRepository {
  async list(
    exec: Executor,
    tenantId: string,
    filter: { status?: string; search?: string } = {}
  ): Promise<Customer[]> {
    const where = ['tenant_id = $1'];
    const params: unknown[] = [tenantId];
    if (filter.status) {
      params.push(filter.status);
      where.push(`status = $${params.length}`);
    }
    if (filter.search) {
      params.push(`%${filter.search.toLowerCase()}%`);
      where.push(`(LOWER(code) LIKE $${params.length} OR LOWER(name) LIKE $${params.length})`);
    }
    const result = await exec.query<Row>(
      `SELECT ${COLUMNS} FROM customer WHERE ${where.join(' AND ')} ORDER BY code`,
      params
    );
    return result.rows.map(toDomain);
  }

  async findById(exec: Executor, tenantId: string, id: string): Promise<Customer | undefined> {
    const result = await exec.query<Row>(
      `SELECT ${COLUMNS} FROM customer WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id]
    );
    return result.rows[0] ? toDomain(result.rows[0]) : undefined;
  }

  async findByCode(exec: Executor, tenantId: string, code: string): Promise<Customer | undefined> {
    const result = await exec.query<Row>(
      `SELECT ${COLUMNS} FROM customer WHERE tenant_id = $1 AND code = $2`,
      [tenantId, code]
    );
    return result.rows[0] ? toDomain(result.rows[0]) : undefined;
  }

  async insert(exec: Executor, customer: Customer): Promise<Customer> {
    const result = await exec.query<Row>(
      `INSERT INTO customer (
         id, tenant_id, code, name, pic_name, pic_contact, delivery_address, dock_number, status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING ${COLUMNS}`,
      [
        customer.id,
        customer.tenantId,
        customer.code,
        customer.name,
        customer.picName ?? null,
        customer.picContact ?? null,
        customer.deliveryAddress ?? null,
        customer.dockNumber ?? null,
        customer.status,
      ]
    );
    return toDomain(result.rows[0]);
  }

  async update(
    exec: Executor,
    tenantId: string,
    id: string,
    patch: Partial<Omit<Customer, 'id' | 'tenantId'>>
  ): Promise<Customer | undefined> {
    const result = await exec.query<Row>(
      `UPDATE customer SET
         code = COALESCE($3, code),
         name = COALESCE($4, name),
         pic_name = COALESCE($5, pic_name),
         pic_contact = COALESCE($6, pic_contact),
         delivery_address = COALESCE($7, delivery_address),
         dock_number = COALESCE($8, dock_number),
         status = COALESCE($9, status),
         updated_at = CURRENT_TIMESTAMP
       WHERE tenant_id = $1 AND id = $2
       RETURNING ${COLUMNS}`,
      [
        tenantId,
        id,
        patch.code ?? null,
        patch.name ?? null,
        patch.picName ?? null,
        patch.picContact ?? null,
        patch.deliveryAddress ?? null,
        patch.dockNumber ?? null,
        patch.status ?? null,
      ]
    );
    return result.rows[0] ? toDomain(result.rows[0]) : undefined;
  }
}
