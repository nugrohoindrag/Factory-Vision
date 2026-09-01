import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FactoryVisionApiClient } from '@factory-vision/api-client';
import { AdvancedDataTable, ColumnDef, Button, Icon, Modal, StatusBadge } from '@factory-vision/ui';
import { Page, Section, Dialog } from '@factory-vision/ui/fv';
import {
  AppUser,
  DeviceTerminal,
  UserRole,
  Product,
  ProductionProcess,
  ProductRouting,
  ProductMachineRate,
  ProductionBatch,
  WorkOrder,
  ProductionBatchStatus,
  Machine,
  ProductionLine,
  Operator,
  DowntimeReason,
  RejectReason,
  DowntimeCategory,
  RejectCategory,
  USER_ROLE_LABEL,
} from '@factory-vision/domain-types';
import { ShiftsTab } from './tabs/ShiftsTab.js';
import { WorkCentersTab } from './tabs/WorkCentersTab.js';
import { MoldsTab } from './tabs/MoldsTab.js';
import { RolesTab } from './tabs/RolesTab.js';
import { ImportExportTab } from './tabs/ImportExportTab.js';
import { SessionsTab } from './tabs/SessionsTab.js';
import { OeeConfigTab } from './tabs/OeeConfigTab.js';
import { AclMatrixTab } from './tabs/AclMatrixTab.js';

const api = new FactoryVisionApiClient({ baseUrl: '' });

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 'var(--radius-md)',
  backgroundColor: 'var(--color-surface-container-high)',
  border: '1px solid var(--color-outline-variant)',
  color: 'var(--color-on-surface)',
  fontSize: '13px',
  boxSizing: 'border-box',
};

// ==========================================
// 0. MULTI-PROCESS & ROUTING MODALS
// ==========================================
interface ProcessModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (payload: {
    code: string;
    name: string;
    description?: string;
    sequenceDefault: number;
    status: 'ACTIVE' | 'INACTIVE';
  }) => void;
  isLoading: boolean;
  initialData?: ProductionProcess | null;
}

const ProcessFormModal: React.FC<ProcessModalProps> = ({ isOpen, onClose, onSave, isLoading, initialData }) => {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [sequenceDefault, setSequenceDefault] = useState<number>(1);
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE'>('ACTIVE');

  useEffect(() => {
    if (initialData) {
      setCode(initialData.code || '');
      setName(initialData.name || '');
      setDescription(initialData.description || '');
      setSequenceDefault(initialData.sequenceDefault || 1);
      setStatus(initialData.status || 'ACTIVE');
    } else {
      setCode('');
      setName('');
      setDescription('');
      setSequenceDefault(1);
      setStatus('ACTIVE');
    }
  }, [initialData, isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({ code, name, description, sequenceDefault: Number(sequenceDefault), status });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={initialData ? `EDIT PROCESS: ${initialData.code}` : 'ADD PRODUCTION PROCESS'}
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '11px',
                fontWeight: 700,
                color: 'var(--color-on-surface-variant)',
                marginBottom: '4px',
              }}
            >
              PROCESS CODE
            </label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="e.g. MIX, TBM, CPR"
              required
              style={inputStyle}
            />
          </div>
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '11px',
                fontWeight: 700,
                color: 'var(--color-on-surface-variant)',
                marginBottom: '4px',
              }}
            >
              DEFAULT SEQUENCE
            </label>
            <input
              type="number"
              value={sequenceDefault}
              onChange={(e) => setSequenceDefault(Number(e.target.value))}
              min={1}
              required
              style={inputStyle}
            />
          </div>
        </div>
        <div>
          <label
            style={{
              display: 'block',
              fontSize: '11px',
              fontWeight: 700,
              color: 'var(--color-on-surface-variant)',
              marginBottom: '4px',
            }}
          >
            PROCESS NAME
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Mixing & Compounding, Tire Building (TBM)"
            required
            style={inputStyle}
          />
        </div>
        <div>
          <label
            style={{
              display: 'block',
              fontSize: '11px',
              fontWeight: 700,
              color: 'var(--color-on-surface-variant)',
              marginBottom: '4px',
            }}
          >
            DESCRIPTION
          </label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Process description and operation notes"
            style={inputStyle}
          />
        </div>
        {initialData && (
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '11px',
                fontWeight: 700,
                color: 'var(--color-on-surface-variant)',
                marginBottom: '4px',
              }}
            >
              STATUS
            </label>
            <select value={status} onChange={(e) => setStatus(e.target.value as any)} style={inputStyle}>
              <option value="ACTIVE">ACTIVE</option>
              <option value="INACTIVE">INACTIVE</option>
            </select>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
          <Button variant="outlined" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="filled" type="submit" disabled={isLoading}>
            {isLoading ? 'Saving, ...' : initialData ? 'Update Process' : 'Save Process'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

interface RoutingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (payload: {
    productId: string;
    processId: string;
    sequence: number;
    machineId?: string;
    standardCycleTimeSeconds?: number;
    active: boolean;
  }) => void;
  isLoading: boolean;
  products: Product[];
  processes: ProductionProcess[];
  machines: Machine[];
  initialData?: ProductRouting | null;
}

const RoutingFormModal: React.FC<RoutingModalProps> = ({
  isOpen,
  onClose,
  onSave,
  isLoading,
  products,
  processes,
  machines,
  initialData,
}) => {
  const [productId, setProductId] = useState('');
  const [processId, setProcessId] = useState('');
  const [sequence, setSequence] = useState<number>(1);
  const [machineId, setMachineId] = useState('');
  const [cycleTime, setCycleTime] = useState<number>(60);
  const [active, setActive] = useState<boolean>(true);

  useEffect(() => {
    if (initialData) {
      setProductId(initialData.productId || (products[0]?.id ?? ''));
      setProcessId(initialData.processId || (processes[0]?.id ?? ''));
      setSequence(initialData.sequence || 1);
      setMachineId(initialData.machineId || '');
      setCycleTime(initialData.standardCycleTimeSeconds || 60);
      setActive(initialData.active ?? true);
    } else {
      setProductId(products[0]?.id ?? '');
      setProcessId(processes[0]?.id ?? '');
      setSequence(1);
      setMachineId('');
      setCycleTime(60);
      setActive(true);
    }
  }, [initialData, isOpen, products, processes]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      productId,
      processId,
      sequence: Number(sequence),
      machineId: machineId || undefined,
      standardCycleTimeSeconds: Number(cycleTime),
      active,
    });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={initialData ? 'EDIT PRODUCT ROUTING STEP' : 'ADD PRODUCT ROUTING STEP'}
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div>
          <label
            style={{
              display: 'block',
              fontSize: '11px',
              fontWeight: 700,
              color: 'var(--color-on-surface-variant)',
              marginBottom: '4px',
            }}
          >
            KODE PRODUK
          </label>
          <select value={productId} onChange={(e) => setProductId(e.target.value)} style={inputStyle} required>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.sku} - {p.name}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '10px' }}>
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '11px',
                fontWeight: 700,
                color: 'var(--color-on-surface-variant)',
                marginBottom: '4px',
              }}
            >
              PROCESS STAGE
            </label>
            <select
              value={processId}
              onChange={(e) => setProcessId(e.target.value)}
              style={inputStyle}
              required
            >
              {processes.map((proc) => (
                <option key={proc.id} value={proc.id}>
                  Seq {proc.sequenceDefault}: {proc.code} - {proc.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '11px',
                fontWeight: 700,
                color: 'var(--color-on-surface-variant)',
                marginBottom: '4px',
              }}
            >
              SEQUENCE #
            </label>
            <input
              type="number"
              value={sequence}
              onChange={(e) => setSequence(Number(e.target.value))}
              min={1}
              required
              style={inputStyle}
            />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '11px',
                fontWeight: 700,
                color: 'var(--color-on-surface-variant)',
                marginBottom: '4px',
              }}
            >
              DEFAULT MACHINE (OPTIONAL)
            </label>
            <select value={machineId} onChange={(e) => setMachineId(e.target.value)} style={inputStyle}>
              <option value="">-- No specific machine --</option>
              {machines.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.code} - {m.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '11px',
                fontWeight: 700,
                color: 'var(--color-on-surface-variant)',
                marginBottom: '4px',
              }}
            >
              STD CYCLE TIME (SEC)
            </label>
            <input
              type="number"
              value={cycleTime}
              onChange={(e) => setCycleTime(Number(e.target.value))}
              min={1}
              required
              style={inputStyle}
            />
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <input
            type="checkbox"
            id="routingActive"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />
          <label
            htmlFor="routingActive"
            style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-on-surface)' }}
          >
            Active Routing Step
          </label>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
          <Button variant="outlined" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="filled" type="submit" disabled={isLoading}>
            {isLoading ? 'Saving, ...' : initialData ? 'Update Routing' : 'Save Routing'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

interface RateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (payload: { productId: string; machineId: string; idealCycleTimeSeconds: number }) => void;
  isLoading: boolean;
  products: Product[];
  machines: Machine[];
  initialData?: ProductMachineRate | null;
}

const RateFormModal: React.FC<RateModalProps> = ({
  isOpen,
  onClose,
  onSave,
  isLoading,
  products,
  machines,
  initialData,
}) => {
  const [productId, setProductId] = useState('');
  const [machineId, setMachineId] = useState('');
  const [cycleTime, setCycleTime] = useState<number>(120);

  useEffect(() => {
    if (initialData) {
      setProductId(initialData.productId || (products[0]?.id ?? ''));
      setMachineId(initialData.machineId || (machines[0]?.id ?? ''));
      setCycleTime(initialData.idealCycleTimeSeconds || 120);
    } else {
      setProductId(products[0]?.id ?? '');
      setMachineId(machines[0]?.id ?? '');
      setCycleTime(120);
    }
  }, [initialData, isOpen, products, machines]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      productId,
      machineId,
      idealCycleTimeSeconds: Number(cycleTime),
    });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={initialData ? 'EDIT MACHINE RATE' : 'ADD PRODUCT × MACHINE CYCLE RATE'}
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div>
          <label
            style={{
              display: 'block',
              fontSize: '11px',
              fontWeight: 700,
              color: 'var(--color-on-surface-variant)',
              marginBottom: '4px',
            }}
          >
            KODE PRODUK
          </label>
          <select value={productId} onChange={(e) => setProductId(e.target.value)} style={inputStyle} required>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.sku} - {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label
            style={{
              display: 'block',
              fontSize: '11px',
              fontWeight: 700,
              color: 'var(--color-on-surface-variant)',
              marginBottom: '4px',
            }}
          >
            MACHINE
          </label>
          <select value={machineId} onChange={(e) => setMachineId(e.target.value)} style={inputStyle} required>
            {machines.map((m) => (
              <option key={m.id} value={m.id}>
                {m.code} - {m.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label
            style={{
              display: 'block',
              fontSize: '11px',
              fontWeight: 700,
              color: 'var(--color-on-surface-variant)',
              marginBottom: '4px',
            }}
          >
            IDEAL CYCLE TIME (SEC)
          </label>
          <input
            type="number"
            value={cycleTime}
            onChange={(e) => setCycleTime(Number(e.target.value))}
            min={1}
            required
            style={inputStyle}
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
          <Button variant="outlined" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="filled" type="submit" disabled={isLoading}>
            {isLoading ? 'Saving, ...' : 'Save Rate'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

interface BatchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (payload: {
    batchNumber: string;
    productId: string;
    /**
     * The Work Order this batch subdivides (ADR-29).
     *
     * Required, because `production_batch.work_order_id` is. The API used to
     * guess it from the product, which quietly filed batches under unrelated
     * work; asking here is the honest version of the same question.
     */
    workOrderId: string;
    productionOrderId: string;
    productionDate: string;
    status: ProductionBatchStatus;
  }) => void;
  isLoading: boolean;
  products: Product[];
  workOrders: WorkOrder[];
  initialData?: ProductionBatch | null;
}

const BatchFormModal: React.FC<BatchModalProps> = ({
  isOpen,
  onClose,
  onSave,
  isLoading,
  products,
  workOrders,
  initialData,
}) => {
  const [batchNumber, setBatchNumber] = useState('');
  const [productId, setProductId] = useState('');
  const [workOrderId, setWorkOrderId] = useState('');
  const [productionOrderId, setProductionOrderId] = useState('');
  const [productionDate, setProductionDate] = useState('');
  const [status, setStatus] = useState<ProductionBatchStatus>(ProductionBatchStatus.ACTIVE);

  useEffect(() => {
    if (initialData) {
      setBatchNumber(initialData.batchNumber || '');
      setProductId(initialData.productId || (products[0]?.id ?? ''));
      setWorkOrderId(initialData.workOrderId || '');
      setProductionOrderId(initialData.productionOrderId || '');
      setProductionDate(initialData.productionDate || new Date().toISOString().slice(0, 10));
      setStatus(initialData.status || ProductionBatchStatus.ACTIVE);
    } else {
      setBatchNumber(`B${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-01`);
      setProductId(products[0]?.id ?? '');
      setWorkOrderId('');
      setProductionOrderId('po-260829-001');
      setProductionDate(new Date().toISOString().slice(0, 10));
      setStatus(ProductionBatchStatus.ACTIVE);
    }
  }, [initialData, isOpen, products]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({ batchNumber, productId, workOrderId, productionOrderId, productionDate, status });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={initialData ? `EDIT BATCH: ${initialData.batchNumber}` : 'CREATE PRODUCTION BATCH / LOT'}
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div>
          <label
            style={{
              display: 'block',
              fontSize: '11px',
              fontWeight: 700,
              color: 'var(--color-on-surface-variant)',
              marginBottom: '4px',
            }}
          >
            BATCH / LOT NUMBER
          </label>
          <input
            type="text"
            value={batchNumber}
            onChange={(e) => setBatchNumber(e.target.value)}
            required
            style={inputStyle}
          />
        </div>
        <div>
          <label
            style={{
              display: 'block',
              fontSize: '11px',
              fontWeight: 700,
              color: 'var(--color-on-surface-variant)',
              marginBottom: '4px',
            }}
          >
            KODE PRODUK
          </label>
          <select
            value={productId}
            onChange={(e) => {
              setProductId(e.target.value);
              // The Work Order list narrows to the chosen product, so a stale
              // selection must not survive the change.
              setWorkOrderId('');
            }}
            style={inputStyle}
            required
          >
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.sku} - {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label
            style={{
              display: 'block',
              fontSize: '11px',
              fontWeight: 700,
              color: 'var(--color-on-surface-variant)',
              marginBottom: '4px',
            }}
          >
            WORK ORDER
          </label>
          <select
            value={workOrderId}
            onChange={(e) => setWorkOrderId(e.target.value)}
            style={inputStyle}
            required
          >
            <option value="">Pilih work order…</option>
            {workOrders
              .filter((wo) => !productId || wo.productId === productId)
              .map((wo) => (
                <option key={wo.id} value={wo.id}>
                  {wo.woNumber} · {wo.status}
                </option>
              ))}
          </select>
          <p
            style={{
              margin: '4px 0 0',
              fontSize: '10.5px',
              color: 'var(--color-on-surface-variant)',
            }}
          >
            Batch adalah pembagian quantity di dalam satu work order (ADR-29), sehingga harus
            melekat pada work order tertentu.
          </p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '11px',
                fontWeight: 700,
                color: 'var(--color-on-surface-variant)',
                marginBottom: '4px',
              }}
            >
              PRODUCTION ORDER
            </label>
            <input
              type="text"
              value={productionOrderId}
              onChange={(e) => setProductionOrderId(e.target.value)}
              placeholder="e.g. PO-260829-001"
              required
              style={inputStyle}
            />
          </div>
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '11px',
                fontWeight: 700,
                color: 'var(--color-on-surface-variant)',
                marginBottom: '4px',
              }}
            >
              PRODUCTION DATE
            </label>
            <input
              type="date"
              value={productionDate}
              onChange={(e) => setProductionDate(e.target.value)}
              required
              style={inputStyle}
            />
          </div>
        </div>
        <div>
          <label
            style={{
              display: 'block',
              fontSize: '11px',
              fontWeight: 700,
              color: 'var(--color-on-surface-variant)',
              marginBottom: '4px',
            }}
          >
            BATCH STATUS
          </label>
          <select value={status} onChange={(e) => setStatus(e.target.value as any)} style={inputStyle}>
            <option value="ACTIVE">ACTIVE (In Production)</option>
            <option value="COMPLETED">COMPLETED</option>
            <option value="HOLD">HOLD (QC Quarantine)</option>
            <option value="SCRAPPED">SCRAPPED</option>
          </select>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
          <Button variant="outlined" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="filled" type="submit" disabled={isLoading}>
            {isLoading ? 'Saving, ...' : initialData ? 'Update Batch' : 'Create Batch'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

// ==========================================
// 1. PRODUCT MODALS (CREATE & EDIT)
// ==========================================
interface ProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (payload: {
    sku: string;
    name: string;
    idealCycleTimeSeconds: number;
    unit: string;
    status: 'ACTIVE' | 'INACTIVE';
  }) => void;
  isLoading: boolean;
  initialData?: Product | null;
}

const ProductFormModal: React.FC<ProductModalProps> = ({ isOpen, onClose, onSave, isLoading, initialData }) => {
  const [sku, setSku] = useState('');
  const [name, setName] = useState('');
  const [cycleTime, setCycleTime] = useState<number>(12);
  const [unit, setUnit] = useState('PCS');
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE'>('ACTIVE');

  useEffect(() => {
    if (initialData) {
      setSku(initialData.sku || '');
      setName(initialData.name || '');
      setCycleTime(initialData.idealCycleTimeSeconds || 12);
      setUnit(initialData.unit || 'PCS');
      setStatus(initialData.status || 'ACTIVE');
    } else {
      setSku('');
      setName('');
      setCycleTime(12);
      setUnit('PCS');
      setStatus('ACTIVE');
    }
  }, [initialData, isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({ sku, name, idealCycleTimeSeconds: Number(cycleTime), unit, status });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={initialData ? `Edit Produk: ${initialData.sku}` : 'Tambah Produk'}
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div>
          <label
            style={{
              display: 'block',
              fontSize: '11px',
              fontWeight: 700,
              color: 'var(--color-on-surface-variant)',
              marginBottom: '4px',
            }}
          >
            KODE PRODUK
          </label>
          <input
            type="text"
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            placeholder="e.g. BRK-HVY-003"
            required
            style={inputStyle}
          />
        </div>
        <div>
          <label
            style={{
              display: 'block',
              fontSize: '11px',
              fontWeight: 700,
              color: 'var(--color-on-surface-variant)',
              marginBottom: '4px',
            }}
          >
            PRODUCT NAME
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Heavy Duty Mounting Bracket 12mm"
            required
            style={inputStyle}
          />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '11px',
                fontWeight: 700,
                color: 'var(--color-on-surface-variant)',
                marginBottom: '4px',
              }}
            >
              IDEAL CYCLE TIME (SEC / PCS)
            </label>
            <input
              type="number"
              step="0.1"
              value={cycleTime}
              onChange={(e) => setCycleTime(Number(e.target.value))}
              min={0.1}
              required
              style={inputStyle}
            />
          </div>
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '11px',
                fontWeight: 700,
                color: 'var(--color-on-surface-variant)',
                marginBottom: '4px',
              }}
            >
              UNIT OF MEASURE
            </label>
            <select value={unit} onChange={(e) => setUnit(e.target.value)} style={inputStyle}>
              <option value="PCS">PCS (Pieces)</option>
              <option value="BOX">BOX</option>
              <option value="SET">SET</option>
              <option value="KG">KG</option>
            </select>
          </div>
        </div>
        {initialData && (
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '11px',
                fontWeight: 700,
                color: 'var(--color-on-surface-variant)',
                marginBottom: '4px',
              }}
            >
              STATUS
            </label>
            <select value={status} onChange={(e) => setStatus(e.target.value as any)} style={inputStyle}>
              <option value="ACTIVE">ACTIVE</option>
              <option value="INACTIVE">INACTIVE</option>
            </select>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
          <Button variant="outlined" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="filled" type="submit" disabled={isLoading}>
            {isLoading ? 'Menyimpan…' : initialData ? 'Perbarui Produk' : 'Simpan Produk'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

// ==========================================
// 2. MACHINE MODALS (CREATE & EDIT)
// ==========================================
interface MachineModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (payload: {
    code: string;
    name: string;
    workCenterId: string;
    idealCycleTimeSeconds: number;
    status: 'ACTIVE' | 'INACTIVE';
  }) => void;
  isLoading: boolean;
  initialData?: Machine | null;
}

const MachineFormModal: React.FC<MachineModalProps> = ({ isOpen, onClose, onSave, isLoading, initialData }) => {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [workCenterId, setWorkCenterId] = useState('wc-stamping');
  const [cycleTime, setCycleTime] = useState<number>(15);
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE'>('ACTIVE');

  useEffect(() => {
    if (initialData) {
      setCode(initialData.code || '');
      setName(initialData.name || '');
      setWorkCenterId(initialData.workCenterId || 'wc-stamping');
      setCycleTime(initialData.idealCycleTimeSeconds || 15);
      setStatus(initialData.status || 'ACTIVE');
    } else {
      setCode('');
      setName('');
      setWorkCenterId('wc-stamping');
      setCycleTime(15);
      setStatus('ACTIVE');
    }
  }, [initialData, isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({ code, name, workCenterId, idealCycleTimeSeconds: Number(cycleTime), status });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={initialData ? `EDIT MACHINE: ${initialData.code}` : 'REGISTER PLANT MACHINERY'}
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div>
          <label
            style={{
              display: 'block',
              fontSize: '11px',
              fontWeight: 700,
              color: 'var(--color-on-surface-variant)',
              marginBottom: '4px',
            }}
          >
            MACHINE CODE
          </label>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="e.g. STAMP-300T"
            required
            style={inputStyle}
          />
        </div>
        <div>
          <label
            style={{
              display: 'block',
              fontSize: '11px',
              fontWeight: 700,
              color: 'var(--color-on-surface-variant)',
              marginBottom: '4px',
            }}
          >
            MACHINE NAME
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Hydraulic Mechanical Press 300T"
            required
            style={inputStyle}
          />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '11px',
                fontWeight: 700,
                color: 'var(--color-on-surface-variant)',
                marginBottom: '4px',
              }}
            >
              WORK CENTER
            </label>
            <select value={workCenterId} onChange={(e) => setWorkCenterId(e.target.value)} style={inputStyle}>
              <option value="wc-stamping">Stamping Work Center</option>
              <option value="wc-cnc">CNC Machining Center</option>
              <option value="wc-assembly">Assembly Work Center</option>
              <option value="wc-packaging">Packaging Center</option>
            </select>
          </div>
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '11px',
                fontWeight: 700,
                color: 'var(--color-on-surface-variant)',
                marginBottom: '4px',
              }}
            >
              RATED CYCLE TIME (SEC)
            </label>
            <input
              type="number"
              value={cycleTime}
              onChange={(e) => setCycleTime(Number(e.target.value))}
              min={1}
              required
              style={inputStyle}
            />
          </div>
        </div>
        {initialData && (
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '11px',
                fontWeight: 700,
                color: 'var(--color-on-surface-variant)',
                marginBottom: '4px',
              }}
            >
              STATUS
            </label>
            <select value={status} onChange={(e) => setStatus(e.target.value as any)} style={inputStyle}>
              <option value="ACTIVE">ACTIVE</option>
              <option value="INACTIVE">INACTIVE</option>
            </select>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
          <Button variant="outlined" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="filled" type="submit" disabled={isLoading}>
            {isLoading ? 'Saving, ...' : initialData ? 'Update Machine' : 'Save Machine'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

// ==========================================
// 3. LINE MODALS (CREATE & EDIT)
// ==========================================
interface LineModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (payload: {
    code: string;
    name: string;
    plannedProductionTimeMinutes: number;
    status: 'ACTIVE' | 'INACTIVE';
  }) => void;
  isLoading: boolean;
  initialData?: ProductionLine | null;
}

const LineFormModal: React.FC<LineModalProps> = ({ isOpen, onClose, onSave, isLoading, initialData }) => {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [plannedMinutes, setPlannedMinutes] = useState<number>(480);
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE'>('ACTIVE');

  useEffect(() => {
    if (initialData) {
      setCode(initialData.code || '');
      setName(initialData.name || '');
      setPlannedMinutes(initialData.plannedProductionTimeMinutes || 480);
      setStatus(initialData.status || 'ACTIVE');
    } else {
      setCode('');
      setName('');
      setPlannedMinutes(480);
      setStatus('ACTIVE');
    }
  }, [initialData, isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({ code, name, plannedProductionTimeMinutes: Number(plannedMinutes), status });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={initialData ? `EDIT LINE: ${initialData.code}` : 'ADD PRODUCTION LINE'}
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div>
          <label
            style={{
              display: 'block',
              fontSize: '11px',
              fontWeight: 700,
              color: 'var(--color-on-surface-variant)',
              marginBottom: '4px',
            }}
          >
            LINE CODE
          </label>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="e.g. LINE-04"
            required
            style={inputStyle}
          />
        </div>
        <div>
          <label
            style={{
              display: 'block',
              fontSize: '11px',
              fontWeight: 700,
              color: 'var(--color-on-surface-variant)',
              marginBottom: '4px',
            }}
          >
            LINE NAME
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Line Assembly 04 (Robotic Welding)"
            required
            style={inputStyle}
          />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '11px',
                fontWeight: 700,
                color: 'var(--color-on-surface-variant)',
                marginBottom: '4px',
              }}
            >
              PLANNED TIME / SHIFT (MINS)
            </label>
            <input
              type="number"
              value={plannedMinutes}
              onChange={(e) => setPlannedMinutes(Number(e.target.value))}
              min={60}
              max={1440}
              required
              style={inputStyle}
            />
          </div>
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '11px',
                fontWeight: 700,
                color: 'var(--color-on-surface-variant)',
                marginBottom: '4px',
              }}
            >
              STATUS
            </label>
            <select value={status} onChange={(e) => setStatus(e.target.value as any)} style={inputStyle}>
              <option value="ACTIVE">ACTIVE</option>
              <option value="INACTIVE">INACTIVE</option>
            </select>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
          <Button variant="outlined" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="filled" type="submit" disabled={isLoading}>
            {isLoading ? 'Saving, ...' : initialData ? 'Update Line' : 'Save Line'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

// ==========================================
// 4. OPERATOR MODALS (CREATE & EDIT)
// ==========================================
interface OperatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  lines: ProductionLine[];
  onSave: (payload: {
    employeeNumber: string;
    name: string;
    defaultLineId: string;
    status: 'ACTIVE' | 'INACTIVE';
  }) => void;
  isLoading: boolean;
  initialData?: Operator | null;
}

const OperatorFormModal: React.FC<OperatorModalProps> = ({
  isOpen,
  onClose,
  lines,
  onSave,
  isLoading,
  initialData,
}) => {
  const [employeeNumber, setEmployeeNumber] = useState('');
  const [name, setName] = useState('');
  const [defaultLineId, setDefaultLineId] = useState(lines[0]?.id || 'line-01');
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE'>('ACTIVE');

  useEffect(() => {
    if (initialData) {
      setEmployeeNumber(initialData.employeeNumber || '');
      setName(initialData.name || '');
      setDefaultLineId(initialData.defaultLineId || lines[0]?.id || 'line-01');
      setStatus(initialData.status || 'ACTIVE');
    } else {
      setEmployeeNumber('');
      setName('');
      setDefaultLineId(lines[0]?.id || 'line-01');
      setStatus('ACTIVE');
    }
  }, [initialData, isOpen, lines]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({ employeeNumber, name, defaultLineId, status });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={initialData ? `EDIT OPERATOR: ${initialData.name}` : 'REGISTER SHOP FLOOR OPERATOR'}
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div>
          <label
            style={{
              display: 'block',
              fontSize: '11px',
              fontWeight: 700,
              color: 'var(--color-on-surface-variant)',
              marginBottom: '4px',
            }}
          >
            EMPLOYEE BADGE / ID
          </label>
          <input
            type="text"
            value={employeeNumber}
            onChange={(e) => setEmployeeNumber(e.target.value)}
            placeholder="e.g. OP-2024-115"
            required
            style={inputStyle}
          />
        </div>
        <div>
          <label
            style={{
              display: 'block',
              fontSize: '11px',
              fontWeight: 700,
              color: 'var(--color-on-surface-variant)',
              marginBottom: '4px',
            }}
          >
            FULL NAME
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Danang Kusuma"
            required
            style={inputStyle}
          />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '11px',
                fontWeight: 700,
                color: 'var(--color-on-surface-variant)',
                marginBottom: '4px',
              }}
            >
              DEFAULT LINE
            </label>
            <select value={defaultLineId} onChange={(e) => setDefaultLineId(e.target.value)} style={inputStyle}>
              {lines.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code}, {l.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '11px',
                fontWeight: 700,
                color: 'var(--color-on-surface-variant)',
                marginBottom: '4px',
              }}
            >
              STATUS
            </label>
            <select value={status} onChange={(e) => setStatus(e.target.value as any)} style={inputStyle}>
              <option value="ACTIVE">ACTIVE</option>
              <option value="INACTIVE">INACTIVE</option>
            </select>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
          <Button variant="outlined" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="filled" type="submit" disabled={isLoading}>
            {isLoading ? 'Saving, ...' : initialData ? 'Update Operator' : 'Save Operator'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

// ==========================================
// 5. DOWNTIME REASON MODALS (CREATE & EDIT)
// ==========================================
interface DowntimeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (payload: {
    code: string;
    name: string;
    category: DowntimeCategory;
    description: string;
    isPlanned: boolean;
    sortOrder: number;
  }) => void;
  isLoading: boolean;
  initialData?: DowntimeReason | null;
}

const DowntimeFormModal: React.FC<DowntimeModalProps> = ({
  isOpen,
  onClose,
  onSave,
  isLoading,
  initialData,
}) => {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState<DowntimeCategory>(DowntimeCategory.MACHINE);
  const [description, setDescription] = useState('');
  const [isPlanned, setIsPlanned] = useState<boolean>(false);
  const [sortOrder, setSortOrder] = useState<number>(1);

  useEffect(() => {
    if (initialData) {
      setCode(initialData.code || '');
      setName(initialData.name || '');
      setCategory(initialData.category || DowntimeCategory.MACHINE);
      setDescription(initialData.description || '');
      setIsPlanned(initialData.isPlanned || false);
      setSortOrder(initialData.sortOrder || 1);
    } else {
      setCode('');
      setName('');
      setCategory(DowntimeCategory.MACHINE);
      setDescription('');
      setIsPlanned(false);
      setSortOrder(1);
    }
  }, [initialData, isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({ code, name, category, description, isPlanned, sortOrder: Number(sortOrder) });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={initialData ? `EDIT DOWNTIME REASON: ${initialData.code}` : 'ADD DOWNTIME / LOSS REASON'}
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '11px',
                fontWeight: 700,
                color: 'var(--color-on-surface-variant)',
                marginBottom: '4px',
              }}
            >
              LOSS CODE
            </label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="e.g. ELEC-PWR"
              required
              style={inputStyle}
            />
          </div>
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '11px',
                fontWeight: 700,
                color: 'var(--color-on-surface-variant)',
                marginBottom: '4px',
              }}
            >
              LOSS CATEGORY
            </label>
            <select value={category} onChange={(e) => setCategory(e.target.value as any)} style={inputStyle}>
              <option value={DowntimeCategory.MACHINE}>MACHINE (Mechanical/Electrical)</option>
              <option value={DowntimeCategory.MATERIAL}>MATERIAL (Stock shortage/delay)</option>
              <option value={DowntimeCategory.PROCESS}>PROCESS (Setup/Tooling/Die Change)</option>
              <option value={DowntimeCategory.QUALITY}>QUALITY (QC wait/hold)</option>
              <option value={DowntimeCategory.PEOPLE}>PEOPLE (Rest/Meeting/Manning)</option>
              <option value={DowntimeCategory.PLANNING}>PLANNING (No order/Scheduled stop)</option>
            </select>
          </div>
        </div>
        <div>
          <label
            style={{
              display: 'block',
              fontSize: '11px',
              fontWeight: 700,
              color: 'var(--color-on-surface-variant)',
              marginBottom: '4px',
            }}
          >
            REASON NAME
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Electrical Power Voltage Surge"
            required
            style={inputStyle}
          />
        </div>
        <div>
          <label
            style={{
              display: 'block',
              fontSize: '11px',
              fontWeight: 700,
              color: 'var(--color-on-surface-variant)',
              marginBottom: '4px',
            }}
          >
            DESCRIPTION / ROOT CAUSE SCOPE
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            style={{ ...inputStyle, resize: 'vertical' }}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <input
            type="checkbox"
            id="dtPlanned"
            checked={isPlanned}
            onChange={(e) => setIsPlanned(e.target.checked)}
          />
          <label
            htmlFor="dtPlanned"
            style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-on-surface)' }}
          >
            Planned Downtime (e.g. Scheduled PM, Die Change, Warm-up)
          </label>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
          <Button variant="outlined" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="filled" type="submit" disabled={isLoading}>
            {isLoading ? 'Saving, ...' : initialData ? 'Update Reason' : 'Save Reason'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

// ==========================================
// 6. REJECT REASON MODALS (CREATE & EDIT)
// ==========================================
interface RejectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (payload: {
    code: string;
    name: string;
    category: RejectCategory;
    description: string;
    sortOrder: number;
  }) => void;
  isLoading: boolean;
  initialData?: RejectReason | null;
}

const RejectFormModal: React.FC<RejectModalProps> = ({ isOpen, onClose, onSave, isLoading, initialData }) => {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState<RejectCategory>(RejectCategory.DIMENSION);
  const [description, setDescription] = useState('');
  const [sortOrder, setSortOrder] = useState<number>(1);

  useEffect(() => {
    if (initialData) {
      setCode(initialData.code || '');
      setName(initialData.name || '');
      setCategory(initialData.category || RejectCategory.DIMENSION);
      setDescription(initialData.description || '');
      setSortOrder(initialData.sortOrder || 1);
    } else {
      setCode('');
      setName('');
      setCategory(RejectCategory.DIMENSION);
      setDescription('');
      setSortOrder(1);
    }
  }, [initialData, isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({ code, name, category, description, sortOrder: Number(sortOrder) });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={initialData ? `EDIT DEFECT CODE: ${initialData.code}` : 'ADD REJECT / DEFECT CODE'}
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '11px',
                fontWeight: 700,
                color: 'var(--color-on-surface-variant)',
                marginBottom: '4px',
              }}
            >
              DEFECT CODE
            </label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="e.g. DIM-WARP"
              required
              style={inputStyle}
            />
          </div>
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '11px',
                fontWeight: 700,
                color: 'var(--color-on-surface-variant)',
                marginBottom: '4px',
              }}
            >
              QC CATEGORY
            </label>
            <select value={category} onChange={(e) => setCategory(e.target.value as any)} style={inputStyle}>
              <option value={RejectCategory.DIMENSION}>DIMENSION (Tolerance/Warping)</option>
              <option value={RejectCategory.APPEARANCE}>APPEARANCE (Scratch/Dent/Color)</option>
              <option value={RejectCategory.MATERIAL}>MATERIAL (Raw defect/Crack)</option>
              <option value={RejectCategory.ASSEMBLY}>ASSEMBLY (Burr/Fitting/Weld)</option>
              <option value={RejectCategory.FUNCTION}>FUNCTION (Electrical/Leak)</option>
              <option value={RejectCategory.OTHER}>OTHER</option>
            </select>
          </div>
        </div>
        <div>
          <label
            style={{
              display: 'block',
              fontSize: '11px',
              fontWeight: 700,
              color: 'var(--color-on-surface-variant)',
              marginBottom: '4px',
            }}
          >
            DEFECT NAME
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Warping and Curvature Exceed Limit"
            required
            style={inputStyle}
          />
        </div>
        <div>
          <label
            style={{
              display: 'block',
              fontSize: '11px',
              fontWeight: 700,
              color: 'var(--color-on-surface-variant)',
              marginBottom: '4px',
            }}
          >
            INSPECTION CRITERIA / DESCRIPTION
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            style={{ ...inputStyle, resize: 'vertical' }}
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
          <Button variant="outlined" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="filled" type="submit" disabled={isLoading}>
            {isLoading ? 'Saving, ...' : initialData ? 'Update Defect Code' : 'Save Defect Code'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

// ==========================================
// 7. USER MODALS (CREATE & EDIT)
// ==========================================
interface UserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (payload: {
    name: string;
    email: string;
    role: UserRole;
    scopeLevel: 'TENANT' | 'PLANT' | 'LINE';
    scopeId?: string;
    status?: AppUser['status'];
  }) => void;
  isLoading: boolean;
  initialData?: AppUser | null;
}

const UserFormModal: React.FC<UserModalProps> = ({ isOpen, onClose, onSave, isLoading, initialData }) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>(UserRole.SUPERVISOR);
  const [scopeLevel, setScopeLevel] = useState<'TENANT' | 'PLANT' | 'LINE'>('PLANT');
  const [scopeId, setScopeId] = useState('plant-cikarang-01');
  const [status, setStatus] = useState<AppUser['status']>('ACTIVE');

  useEffect(() => {
    if (initialData) {
      setName(initialData.name || '');
      setEmail(initialData.email || '');
      setRole((initialData.role as UserRole) || UserRole.SUPERVISOR);
      setScopeLevel((initialData.scopeLevel as any) || 'PLANT');
      setScopeId(initialData.scopeId || 'plant-cikarang-01');
      setStatus(initialData.status || 'ACTIVE');
    } else {
      setName('');
      setEmail('');
      setRole(UserRole.SUPERVISOR);
      setScopeLevel('PLANT');
      setScopeId('plant-cikarang-01');
      setStatus('ACTIVE');
    }
  }, [initialData, isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      name,
      email,
      role,
      scopeLevel,
      scopeId: scopeLevel === 'PLANT' ? scopeId : undefined,
      // Status is only editable on an existing account; a new one is created
      // ACTIVE by the mutation.
      status: initialData ? status : undefined,
    });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={initialData ? `EDIT USER: ${initialData.name}` : 'INVITE / CREATE APPLICATION USER'}
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div>
          <label
            style={{
              display: 'block',
              fontSize: '11px',
              fontWeight: 700,
              color: 'var(--color-on-surface-variant)',
              marginBottom: '4px',
            }}
          >
            FULL NAME
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Hendra Gunawan"
            required
            style={inputStyle}
          />
        </div>
        <div>
          <label
            style={{
              display: 'block',
              fontSize: '11px',
              fontWeight: 700,
              color: 'var(--color-on-surface-variant)',
              marginBottom: '4px',
            }}
          >
            EMAIL ADDRESS
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="nama@perusahaan.co.id"
            required
            style={inputStyle}
          />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '11px',
                fontWeight: 700,
                color: 'var(--color-on-surface-variant)',
                marginBottom: '4px',
              }}
            >
              SYSTEM ROLE
            </label>
            {/*
              Options come from the enum, not from a hand-written list. The list
              was already missing OPERATOR and would have silently omitted SALES
              too, which would have made a role that exists everywhere else
              impossible to actually assign.

              OPERATOR is the one deliberate exclusion: an operator signs in with
              an employee number and PIN through a registered terminal (§22.1),
              so it is created on the Operator master, not here.
            */}
            <select value={role} onChange={(e) => setRole(e.target.value as UserRole)} style={inputStyle}>
              {Object.values(UserRole)
                .filter((value) => value !== UserRole.OPERATOR)
                .map((value) => (
                  <option key={value} value={value}>
                    {USER_ROLE_LABEL[value]}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '11px',
                fontWeight: 700,
                color: 'var(--color-on-surface-variant)',
                marginBottom: '4px',
              }}
            >
              DATA SCOPE LEVEL
            </label>
            <select
              value={scopeLevel}
              onChange={(e) => setScopeLevel(e.target.value as any)}
              style={inputStyle}
            >
              <option value="PLANT">Plant Level Scope</option>
              <option value="TENANT">Tenant-wide Scope</option>
              <option value="LINE">Single Line Scope</option>
            </select>
          </div>
        </div>

        {/* Account status lives here rather than as a row action: suspending an
 account is an edit to it, and this way the reason for the change is
 made alongside the rest of the record in one save. */}
        {initialData && (
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '11px',
                fontWeight: 700,
                color: 'var(--color-on-surface-variant)',
                marginBottom: '4px',
              }}
            >
              ACCOUNT STATUS
            </label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as AppUser['status'])}
              style={inputStyle}
            >
              <option value="ACTIVE">ACTIVE, dapat masuk dan bekerja</option>
              <option value="SUSPENDED">SUSPENDED, akses ditahan sementara</option>
              <option value="INACTIVE">INACTIVE, nonaktif permanen</option>
              {/* Only offered when it is the account's current state, so the
 field never misreports a pending invitation. */}
              {initialData.status === 'INVITED' && <option value="INVITED">INVITED, menunggu aktivasi</option>}
            </select>
            {status !== 'ACTIVE' && (
              <div
                style={{ fontSize: '10.5px', color: 'var(--color-warning)', marginTop: '4px', fontWeight: 600 }}
              >
                User tidak dapat masuk ke sistem selama status bukan ACTIVE.
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
          <Button variant="outlined" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="filled" type="submit" disabled={isLoading}>
            {isLoading ? 'Saving, ...' : initialData ? 'Update User' : 'Create User & Send Invite'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

// ==========================================
// 8. DEVICE MODALS (CREATE & EDIT)
// ==========================================
interface DeviceModalProps {
  isOpen: boolean;
  onClose: () => void;
  lines: ProductionLine[];
  onSave: (payload: {
    deviceCode: string;
    name: string;
    assignedLineId: string;
    status: DeviceTerminal['status'];
    ipAddress: string;
  }) => void;
  isLoading: boolean;
  initialData?: DeviceTerminal | null;
}

const DeviceFormModal: React.FC<DeviceModalProps> = ({
  isOpen,
  onClose,
  lines,
  onSave,
  isLoading,
  initialData,
}) => {
  const [deviceCode, setDeviceCode] = useState('');
  const [name, setName] = useState('');
  const [assignedLineId, setAssignedLineId] = useState(lines[0]?.id || 'line-01');
  const [ipAddress, setIpAddress] = useState('192.168.10.50');
  const [status, setStatus] = useState<DeviceTerminal['status']>('ONLINE');

  useEffect(() => {
    if (initialData) {
      setDeviceCode(initialData.deviceCode || '');
      setName(initialData.name || '');
      setAssignedLineId(initialData.assignedLineId || lines[0]?.id || 'line-01');
      setIpAddress(initialData.ipAddress || '192.168.10.50');
      setStatus(initialData.status || 'ONLINE');
    } else {
      setDeviceCode('');
      setName('');
      setAssignedLineId(lines[0]?.id || 'line-01');
      setIpAddress('192.168.10.50');
      setStatus('ONLINE');
    }
  }, [initialData, isOpen, lines]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({ deviceCode, name, assignedLineId, ipAddress, status });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={initialData ? `EDIT TERMINAL: ${initialData.deviceCode}` : 'REGISTER SHOP FLOOR TABLET TERMINAL'}
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div>
          <label
            style={{
              display: 'block',
              fontSize: '11px',
              fontWeight: 700,
              color: 'var(--color-on-surface-variant)',
              marginBottom: '4px',
            }}
          >
            DEVICE CODE / ASSET TAG
          </label>
          <input
            type="text"
            value={deviceCode}
            onChange={(e) => setDeviceCode(e.target.value)}
            placeholder="e.g. TAB-LINE04-01"
            required
            style={inputStyle}
          />
        </div>
        <div>
          <label
            style={{
              display: 'block',
              fontSize: '11px',
              fontWeight: 700,
              color: 'var(--color-on-surface-variant)',
              marginBottom: '4px',
            }}
          >
            TERMINAL NAME / LOCATION
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Tablet Terminal Assembly Line 04"
            required
            style={inputStyle}
          />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '11px',
                fontWeight: 700,
                color: 'var(--color-on-surface-variant)',
                marginBottom: '4px',
              }}
            >
              ASSIGNED PRODUCTION LINE
            </label>
            <select
              value={assignedLineId}
              onChange={(e) => setAssignedLineId(e.target.value)}
              style={inputStyle}
            >
              {lines.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code}, {l.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '11px',
                fontWeight: 700,
                color: 'var(--color-on-surface-variant)',
                marginBottom: '4px',
              }}
            >
              STATIC IP ADDRESS
            </label>
            <input
              type="text"
              value={ipAddress}
              onChange={(e) => setIpAddress(e.target.value)}
              placeholder="192.168.10.50"
              style={inputStyle}
            />
          </div>
        </div>
        {initialData && (
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '11px',
                fontWeight: 700,
                color: 'var(--color-on-surface-variant)',
                marginBottom: '4px',
              }}
            >
              NETWORK STATUS
            </label>
            <select value={status} onChange={(e) => setStatus(e.target.value as any)} style={inputStyle}>
              <option value="ONLINE">ONLINE</option>
              <option value="OFFLINE">OFFLINE</option>
              <option value="REVOKED">REVOKED</option>
            </select>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
          <Button variant="outlined" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="filled" type="submit" disabled={isLoading}>
            {isLoading ? 'Saving, ...' : initialData ? 'Update Terminal' : 'Register Terminal'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

// ==========================================
// MAIN SETTINGS PAGE COMPONENT
// ==========================================
export const SettingsPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'products';

  // Live Toast Notification
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // --- MODAL & DIALOG VISIBILITY STATES ---
  // Production Process
  const [showProcessModal, setShowProcessModal] = useState<boolean>(false);
  const [selectedProcess, setSelectedProcess] = useState<ProductionProcess | null>(null);
  const [showDeleteProcessDialog, setShowDeleteProcessDialog] = useState<boolean>(false);

  // Product Routing
  const [showRoutingModal, setShowRoutingModal] = useState<boolean>(false);
  const [selectedRouting, setSelectedRouting] = useState<ProductRouting | null>(null);
  const [showDeleteRoutingDialog, setShowDeleteRoutingDialog] = useState<boolean>(false);

  // Product Machine Rates
  const [showRateModal, setShowRateModal] = useState<boolean>(false);
  const [selectedRate, setSelectedRate] = useState<ProductMachineRate | null>(null);
  const [showDeleteRateDialog, setShowDeleteRateDialog] = useState<boolean>(false);

  // Batches & Lots
  const [showBatchModal, setShowBatchModal] = useState<boolean>(false);
  const [selectedBatch, setSelectedBatch] = useState<ProductionBatch | null>(null);

  // Product
  const [showProductModal, setShowProductModal] = useState<boolean>(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [showDeleteProductDialog, setShowDeleteProductDialog] = useState<boolean>(false);

  // Machine
  const [showMachineModal, setShowMachineModal] = useState<boolean>(false);
  const [selectedMachine, setSelectedMachine] = useState<Machine | null>(null);
  const [showDeleteMachineDialog, setShowDeleteMachineDialog] = useState<boolean>(false);

  // Line
  const [showLineModal, setShowLineModal] = useState<boolean>(false);
  const [selectedLine, setSelectedLine] = useState<ProductionLine | null>(null);
  const [showDeleteLineDialog, setShowDeleteLineDialog] = useState<boolean>(false);

  // Operator
  const [showOperatorModal, setShowOperatorModal] = useState<boolean>(false);
  const [selectedOperator, setSelectedOperator] = useState<Operator | null>(null);
  const [showDeleteOperatorDialog, setShowDeleteOperatorDialog] = useState<boolean>(false);

  // Downtime Reason
  const [showDtModal, setShowDtModal] = useState<boolean>(false);
  const [selectedDt, setSelectedDt] = useState<DowntimeReason | null>(null);
  const [showDeleteDtDialog, setShowDeleteDtDialog] = useState<boolean>(false);

  // Reject Reason
  const [showRejModal, setShowRejModal] = useState<boolean>(false);
  const [selectedRej, setSelectedRej] = useState<RejectReason | null>(null);
  const [showDeleteRejDialog, setShowDeleteRejDialog] = useState<boolean>(false);

  // User
  const [showUserModal, setShowUserModal] = useState<boolean>(false);
  const [selectedUser, setSelectedUser] = useState<AppUser | null>(null);
  const [showDeleteUserDialog, setShowDeleteUserDialog] = useState<boolean>(false);

  // Device Terminal
  const [showDeviceModal, setShowDeviceModal] = useState<boolean>(false);
  const [selectedDevice, setSelectedDevice] = useState<DeviceTerminal | null>(null);
  const [showDeleteDeviceDialog, setShowDeleteDeviceDialog] = useState<boolean>(false);

  // --- QUERIES ---
  const { data: processes } = useQuery({
    queryKey: ['master-processes'],
    queryFn: () => api.master.getProcesses(),
  });

  const { data: routings } = useQuery({
    queryKey: ['master-routings'],
    queryFn: () => api.master.getRoutings(),
  });

  const { data: machineRates } = useQuery({
    queryKey: ['master-machine-rates'],
    queryFn: () => api.master.getProductMachineRates(),
  });

  const { data: batches } = useQuery({
    queryKey: ['master-batches'],
    queryFn: () => api.master.getBatches(),
  });

  const { data: products } = useQuery({
    queryKey: ['master-products'],
    queryFn: () => api.master.getProducts(),
  });

  // A batch subdivides a Work Order (ADR-29), so the batch form has to offer
  // the Work Orders it may subdivide.
  const { data: workOrdersForBatches } = useQuery({
    queryKey: ['master-work-orders-for-batches'],
    queryFn: () => api.workOrders.list(),
  });

  const { data: machines } = useQuery({
    queryKey: ['master-machines'],
    queryFn: () => api.master.getMachines(),
  });

  const { data: lines } = useQuery({
    queryKey: ['master-lines'],
    queryFn: () => api.master.getLines(),
  });

  const { data: operators } = useQuery({
    queryKey: ['master-operators'],
    queryFn: () => api.master.getOperators(),
  });

  const { data: downtimeReasons } = useQuery({
    queryKey: ['master-downtime-reasons'],
    queryFn: () => api.master.getDowntimeReasons(),
  });

  const { data: rejectReasons } = useQuery({
    queryKey: ['master-reject-reasons'],
    queryFn: () => api.master.getRejectReasons(),
  });

  const { data: users } = useQuery({
    queryKey: ['master-users'],
    queryFn: () => api.master.getUsers(),
  });

  const { data: devices } = useQuery({
    queryKey: ['master-devices'],
    queryFn: () => api.master.getDevices(),
  });

  // --- MUTATIONS ---
  // Process
  const saveProcessMutation = useMutation({
    mutationFn: (payload: {
      code: string;
      name: string;
      description?: string;
      sequenceDefault: number;
      status: 'ACTIVE' | 'INACTIVE';
    }) => {
      if (selectedProcess) {
        return api.master.updateProcess(selectedProcess.id, payload);
      } else {
        return api.master.createProcess(payload);
      }
    },
    onSuccess: (p) => {
      queryClient.invalidateQueries({ queryKey: ['master-processes'] });
      setShowProcessModal(false);
      showToast(
        selectedProcess ? `Proses ${p.code} berhasil diperbarui!` : `Proses ${p.code} berhasil ditambahkan!`
      );
    },
    onError: (err: any) => showToast(err.message || 'Gagal menyimpan proses'),
  });

  const deleteProcessMutation = useMutation({
    mutationFn: (id: string) => api.master.deleteProcess(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['master-processes'] });
      setShowDeleteProcessDialog(false);
      showToast('Proses berhasil dihapus!');
    },
    onError: (err: any) => showToast(err.message || 'Gagal menghapus proses'),
  });

  // Routing
  const saveRoutingMutation = useMutation({
    mutationFn: (payload: {
      productId: string;
      processId: string;
      sequence: number;
      machineId?: string;
      standardCycleTimeSeconds?: number;
      active: boolean;
    }) => {
      if (selectedRouting) {
        return api.master.updateRouting(selectedRouting.id, payload);
      } else {
        return api.master.createRouting(payload);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['master-routings'] });
      setShowRoutingModal(false);
      showToast('Alur routing berhasil disimpan!');
    },
    onError: (err: any) => showToast(err.message || 'Gagal menyimpan routing'),
  });

  const deleteRoutingMutation = useMutation({
    mutationFn: (id: string) => api.master.deleteRouting(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['master-routings'] });
      setShowDeleteRoutingDialog(false);
      showToast('Alur routing berhasil dihapus!');
    },
    onError: (err: any) => showToast(err.message || 'Gagal menghapus routing'),
  });

  // Rates
  const saveRateMutation = useMutation({
    mutationFn: (payload: { productId: string; machineId: string; idealCycleTimeSeconds: number }) => {
      return api.master.upsertProductMachineRate(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['master-machine-rates'] });
      setShowRateModal(false);
      showToast('Cycle rate berhasil disimpan!');
    },
    onError: (err: any) => showToast(err.message || 'Gagal menyimpan rate'),
  });

  const deleteRateMutation = useMutation({
    mutationFn: (id: string) => api.master.deleteProductMachineRate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['master-machine-rates'] });
      setShowDeleteRateDialog(false);
      showToast('Cycle rate berhasil dihapus!');
    },
    onError: (err: any) => showToast(err.message || 'Gagal menghapus rate'),
  });

  // Batches
  const saveBatchMutation = useMutation({
    mutationFn: (payload: {
      batchNumber: string;
      productId: string;
      workOrderId: string;
      productionOrderId: string;
      productionDate: string;
      status: ProductionBatchStatus;
    }) => {
      if (selectedBatch) {
        return api.master.updateBatch(selectedBatch.id, payload);
      } else {
        return api.master.createBatch(payload);
      }
    },
    onSuccess: (b) => {
      queryClient.invalidateQueries({ queryKey: ['master-batches'] });
      setShowBatchModal(false);
      showToast(`Batch ${b.batchNumber} berhasil disimpan!`);
    },
    onError: (err: any) => showToast(err.message || 'Gagal menyimpan batch'),
  });

  // Product
  const saveProductMutation = useMutation({
    mutationFn: (payload: {
      sku: string;
      name: string;
      idealCycleTimeSeconds: number;
      unit: string;
      status: 'ACTIVE' | 'INACTIVE';
    }) => {
      if (selectedProduct) {
        return api.master.updateProduct(selectedProduct.id, payload);
      } else {
        return api.master.createProduct(payload);
      }
    },
    onSuccess: (p) => {
      queryClient.invalidateQueries({ queryKey: ['master-products'] });
      setShowProductModal(false);
      showToast(
        selectedProduct ? `Produk ${p.sku} berhasil diperbarui!` : `Produk ${p.sku} berhasil ditambahkan!`
      );
    },
    onError: (err: any) => showToast(err.message || 'Gagal menyimpan Produk'),
  });

  const deleteProductMutation = useMutation({
    mutationFn: (id: string) => api.master.deleteProduct(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['master-products'] });
      setShowDeleteProductDialog(false);
      showToast('Produk berhasil dihapus!');
    },
    onError: (err: any) => showToast(err.message || 'Gagal menghapus Produk'),
  });

  // Machine
  const saveMachineMutation = useMutation({
    mutationFn: (payload: {
      code: string;
      name: string;
      workCenterId: string;
      idealCycleTimeSeconds: number;
      status: 'ACTIVE' | 'INACTIVE';
    }) => {
      if (selectedMachine) {
        return api.master.updateMachine(selectedMachine.id, payload);
      } else {
        return api.master.createMachine(payload);
      }
    },
    onSuccess: (m) => {
      queryClient.invalidateQueries({ queryKey: ['master-machines'] });
      setShowMachineModal(false);
      showToast(
        selectedMachine ? `Mesin ${m.code} berhasil diperbarui!` : `Mesin ${m.code} berhasil ditambahkan!`
      );
    },
    onError: (err: any) => showToast(err.message || 'Gagal menyimpan mesin'),
  });

  const deleteMachineMutation = useMutation({
    mutationFn: (id: string) => api.master.deleteMachine(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['master-machines'] });
      setShowDeleteMachineDialog(false);
      showToast('Mesin berhasil dihapus!');
    },
    onError: (err: any) => showToast(err.message || 'Gagal menghapus mesin'),
  });

  // Line
  const saveLineMutation = useMutation({
    mutationFn: (payload: {
      code: string;
      name: string;
      plannedProductionTimeMinutes: number;
      status: 'ACTIVE' | 'INACTIVE';
    }) => {
      if (selectedLine) {
        return api.master.updateLine(selectedLine.id, payload);
      } else {
        return api.master.createLine({ ...payload, plantId: 'plant-cikarang-01' });
      }
    },
    onSuccess: (l) => {
      queryClient.invalidateQueries({ queryKey: ['master-lines'] });
      setShowLineModal(false);
      showToast(
        selectedLine
          ? `Production Line ${l.code} berhasil diperbarui!`
          : `Production Line ${l.code} berhasil ditambahkan!`
      );
    },
    onError: (err: any) => showToast(err.message || 'Gagal menyimpan lini'),
  });

  const deleteLineMutation = useMutation({
    mutationFn: (id: string) => api.master.deleteLine(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['master-lines'] });
      setShowDeleteLineDialog(false);
      showToast('Production Line berhasil dihapus!');
    },
    onError: (err: any) => showToast(err.message || 'Gagal menghapus lini'),
  });

  // Operator
  const saveOperatorMutation = useMutation({
    mutationFn: (payload: {
      employeeNumber: string;
      name: string;
      defaultLineId: string;
      status: 'ACTIVE' | 'INACTIVE';
    }) => {
      if (selectedOperator) {
        return api.master.updateOperator(selectedOperator.id, payload);
      } else {
        return api.master.createOperator(payload);
      }
    },
    onSuccess: (o) => {
      queryClient.invalidateQueries({ queryKey: ['master-operators'] });
      setShowOperatorModal(false);
      showToast(
        selectedOperator
          ? `Operator ${o.name} berhasil diperbarui!`
          : `Operator ${o.name} berhasil ditambahkan!`
      );
    },
    onError: (err: any) => showToast(err.message || 'Gagal menyimpan operator'),
  });

  const deleteOperatorMutation = useMutation({
    mutationFn: (id: string) => api.master.deleteOperator(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['master-operators'] });
      setShowDeleteOperatorDialog(false);
      showToast('Operator berhasil dihapus!');
    },
    onError: (err: any) => showToast(err.message || 'Gagal menghapus operator'),
  });

  // Downtime Reason
  const saveDtMutation = useMutation({
    mutationFn: (payload: {
      code: string;
      name: string;
      category: DowntimeCategory;
      description: string;
      isPlanned: boolean;
      sortOrder: number;
    }) => {
      if (selectedDt) {
        return api.master.updateDowntimeReason(selectedDt.id, payload);
      } else {
        return api.master.createDowntimeReason({ ...payload, active: true });
      }
    },
    onSuccess: (dt) => {
      queryClient.invalidateQueries({ queryKey: ['master-downtime-reasons'] });
      setShowDtModal(false);
      showToast(
        selectedDt
          ? `Alasan downtime ${dt.code} berhasil diperbarui!`
          : `Alasan downtime ${dt.code} berhasil ditambahkan!`
      );
    },
    onError: (err: any) => showToast(err.message || 'Gagal menyimpan downtime reason'),
  });

  const deleteDtMutation = useMutation({
    mutationFn: (id: string) => api.master.deleteDowntimeReason(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['master-downtime-reasons'] });
      setShowDeleteDtDialog(false);
      showToast('Alasan downtime berhasil dihapus!');
    },
    onError: (err: any) => showToast(err.message || 'Gagal menghapus downtime reason'),
  });

  // Reject Reason
  const saveRejMutation = useMutation({
    mutationFn: (payload: {
      code: string;
      name: string;
      category: RejectCategory;
      description: string;
      sortOrder: number;
    }) => {
      if (selectedRej) {
        return api.master.updateRejectReason(selectedRej.id, payload);
      } else {
        return api.master.createRejectReason({ ...payload, active: true });
      }
    },
    onSuccess: (rej) => {
      queryClient.invalidateQueries({ queryKey: ['master-reject-reasons'] });
      setShowRejModal(false);
      showToast(
        selectedRej
          ? `Kode cacat ${rej.code} berhasil diperbarui!`
          : `Kode cacat ${rej.code} berhasil ditambahkan!`
      );
    },
    onError: (err: any) => showToast(err.message || 'Gagal menyimpan reject reason'),
  });

  const deleteRejMutation = useMutation({
    mutationFn: (id: string) => api.master.deleteRejectReason(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['master-reject-reasons'] });
      setShowDeleteRejDialog(false);
      showToast('Kode cacat/reject berhasil dihapus!');
    },
    onError: (err: any) => showToast(err.message || 'Gagal menghapus reject reason'),
  });

  // User
  const saveUserMutation = useMutation({
    mutationFn: (payload: {
      name: string;
      email: string;
      role: UserRole;
      scopeLevel: 'TENANT' | 'PLANT' | 'LINE';
      scopeId?: string;
      status?: AppUser['status'];
    }) => {
      if (selectedUser) {
        return api.master.updateUser(selectedUser.id, payload);
      } else {
        return api.master.createUser({ ...payload, accountType: 'APPLICATION_USER', status: 'ACTIVE' });
      }
    },
    onSuccess: (u) => {
      queryClient.invalidateQueries({ queryKey: ['master-users'] });
      setShowUserModal(false);
      showToast(selectedUser ? `User ${u.name} berhasil diperbarui!` : `User ${u.name} berhasil ditambahkan!`);
    },
    onError: (err: any) => showToast(err.message || 'Gagal menyimpan user'),
  });

  const deleteUserMutation = useMutation({
    mutationFn: (id: string) => api.master.deleteUser(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['master-users'] });
      setShowDeleteUserDialog(false);
      showToast('User berhasil dihapus!');
    },
    onError: (err: any) => showToast(err.message || 'Gagal menghapus user'),
  });

  // Device
  const saveDeviceMutation = useMutation({
    mutationFn: (payload: {
      deviceCode: string;
      name: string;
      assignedLineId: string;
      status: DeviceTerminal['status'];
      ipAddress: string;
    }) => {
      if (selectedDevice) {
        return api.master.updateDevice(selectedDevice.id, payload);
      } else {
        return api.master.createDevice(payload);
      }
    },
    onSuccess: (d) => {
      queryClient.invalidateQueries({ queryKey: ['master-devices'] });
      setShowDeviceModal(false);
      showToast(
        selectedDevice
          ? `Terminal ${d.deviceCode} berhasil diperbarui!`
          : `Terminal ${d.deviceCode} berhasil didaftarkan!`
      );
    },
    onError: (err: any) => showToast(err.message || 'Gagal menyimpan terminal'),
  });

  const deleteDeviceMutation = useMutation({
    mutationFn: (id: string) => api.master.deleteDevice(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['master-devices'] });
      setShowDeleteDeviceDialog(false);
      showToast('Terminal berhasil dihapus!');
    },
    onError: (err: any) => showToast(err.message || 'Gagal menghapus terminal'),
  });

  // --- TABLE COLUMNS DEFINITIONS WITH ACTION BUTTONS ---
  // Process Columns
  const processColumns: ColumnDef<ProductionProcess>[] = [
    {
      key: 'code',
      header: 'Kode Proses Produksi',
      sortable: true,
      render: (p) => <strong style={{ color: 'var(--color-primary)' }}>{p.code}</strong>,
    },
    { key: 'name', header: 'Nama Proses Produksi', sortable: true },
    {
      key: 'sequenceDefault',
      header: 'Urutan',
      sortable: true,
      render: (p) => <span style={{ fontWeight: 700 }}>#{p.sequenceDefault}</span>,
    },
    { key: 'description', header: 'Deskripsi', render: (p) => p.description || '-' },
    {
      key: 'status',
      header: 'Status',
      render: (p) => (
        <span
          style={{
            padding: '2px 8px',
            borderRadius: 'var(--radius-pill)',
            fontSize: '11px',
            fontWeight: 700,
            backgroundColor:
              p.status === 'ACTIVE' ? 'var(--color-success-container)' : 'var(--color-surface-container)',
            color:
              p.status === 'ACTIVE' ? 'var(--color-on-success-container)' : 'var(--color-on-surface-variant)',
          }}
        >
          {p.status || 'ACTIVE'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Aksi',
      render: (p) => (
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <Button
            variant="tonal"
            size="sm"
            icon={<Icon name="edit" size={15} />}
            onClick={() => {
              setSelectedProcess(p);
              setShowProcessModal(true);
            }}
            title="Edit Process"
          >
            Edit
          </Button>
          <Button
            variant="text"
            size="sm"
            style={{ color: 'var(--color-error)' }}
            icon={<Icon name="delete" size={16} />}
            onClick={() => {
              setSelectedProcess(p);
              setShowDeleteProcessDialog(true);
            }}
            title="Hapus Process"
            aria-label="Hapus Process"
          />
        </div>
      ),
    },
  ];

  // Product Routing Columns
  const routingColumns: ColumnDef<ProductRouting>[] = [
    {
      key: 'productId',
      header: 'Produk',
      sortable: true,
      render: (r) => {
        const prod = (products || []).find((p) => p.id === r.productId);
        return <strong>{prod ? `${prod.sku} - ${prod.name}` : r.productId}</strong>;
      },
    },
    {
      key: 'sequence',
      header: 'Urutan',
      sortable: true,
      render: (r) => <span style={{ fontWeight: 800, color: 'var(--color-primary)' }}>Stage {r.sequence}</span>,
    },
    {
      key: 'processId',
      header: 'Proses Produksi',
      sortable: true,
      render: (r) => {
        const proc = (processes || []).find((p) => p.id === r.processId);
        return proc ? `${proc.code} (${proc.name})` : r.processId;
      },
    },
    {
      key: 'machineId',
      header: 'Mesin',
      render: (r) => {
        const mc = (machines || []).find((m) => m.id === r.machineId);
        return mc ? (
          `${mc.code} - ${mc.name}`
        ) : (
          <span style={{ color: 'var(--color-on-surface-variant)' }}>Dynamic Allocation</span>
        );
      },
    },
    {
      key: 'standardCycleTimeSeconds',
      header: 'Ideal Cycle Time',
      render: (r) => <span style={{ fontWeight: 700 }}>{r.standardCycleTimeSeconds ?? '-'} sec</span>,
    },
    {
      key: 'active',
      header: 'Aktif',
      render: (r) => (
        <span
          style={{
            padding: '2px 8px',
            borderRadius: 'var(--radius-pill)',
            fontSize: '11px',
            fontWeight: 700,
            backgroundColor: r.active ? 'var(--color-success-container)' : 'var(--color-surface-container)',
            color: r.active ? 'var(--color-on-success-container)' : 'var(--color-on-surface-variant)',
          }}
        >
          {r.active ? 'ACTIVE' : 'INACTIVE'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Aksi',
      render: (r) => (
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <Button
            variant="tonal"
            size="sm"
            icon={<Icon name="edit" size={15} />}
            onClick={() => {
              setSelectedRouting(r);
              setShowRoutingModal(true);
            }}
            title="Edit Routing"
          >
            Edit
          </Button>
          <Button
            variant="text"
            size="sm"
            style={{ color: 'var(--color-error)' }}
            icon={<Icon name="delete" size={16} />}
            onClick={() => {
              setSelectedRouting(r);
              setShowDeleteRoutingDialog(true);
            }}
            title="Hapus Routing"
            aria-label="Hapus Routing"
          />
        </div>
      ),
    },
  ];

  // Rate Columns
  const rateColumns: ColumnDef<ProductMachineRate>[] = [
    {
      key: 'productId',
      header: 'Kode Produk',
      sortable: true,
      render: (r) => {
        const prod = (products || []).find((p) => p.id === r.productId);
        return <strong>{prod ? prod.sku : r.productId}</strong>;
      },
    },
    {
      key: 'machineId',
      header: 'Mesin',
      sortable: true,
      render: (r) => {
        const mc = (machines || []).find((m) => m.id === r.machineId);
        return mc ? `${mc.code} (${mc.name})` : r.machineId;
      },
    },
    {
      key: 'idealCycleTimeSeconds',
      header: 'Ideal Cycle Time',
      sortable: true,
      render: (r) => (
        <span style={{ color: 'var(--color-primary)', fontWeight: 700 }}>{r.idealCycleTimeSeconds} sec</span>
      ),
    },
    {
      key: 'actions',
      header: 'Aksi',
      render: (r) => (
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <Button
            variant="tonal"
            size="sm"
            icon={<Icon name="edit" size={15} />}
            onClick={() => {
              setSelectedRate(r);
              setShowRateModal(true);
            }}
            title="Edit Rate"
          >
            Edit
          </Button>
          <Button
            variant="text"
            size="sm"
            style={{ color: 'var(--color-error)' }}
            icon={<Icon name="delete" size={16} />}
            onClick={() => {
              setSelectedRate(r);
              setShowDeleteRateDialog(true);
            }}
            title="Hapus Rate"
            aria-label="Hapus Rate"
          />
        </div>
      ),
    },
  ];

  // Batch Columns
  const batchColumns: ColumnDef<ProductionBatch>[] = [
    {
      key: 'batchNumber',
      header: 'Batch Produksi',
      sortable: true,
      render: (b) => <strong style={{ color: 'var(--color-primary)' }}>{b.batchNumber}</strong>,
    },
    {
      key: 'productId',
      header: 'Kode Produk',
      sortable: true,
      render: (b) => {
        const prod = (products || []).find((p) => p.id === b.productId);
        return prod ? `${prod.sku} - ${prod.name}` : b.productId;
      },
    },
    { key: 'productionOrderId', header: 'Production Order', render: (b) => b.productionOrderId || '-' },
    { key: 'productionDate', header: 'Tanggal', sortable: true },
    {
      key: 'status',
      header: 'Status',
      render: (b) => (
        <span
          style={{
            padding: '2px 8px',
            borderRadius: 'var(--radius-pill)',
            fontSize: '11px',
            fontWeight: 700,
            backgroundColor:
              b.status === 'ACTIVE'
                ? 'var(--color-success-container)'
                : b.status === 'HOLD'
                  ? 'var(--color-warning-container)'
                  : 'var(--color-surface-container)',
            color:
              b.status === 'ACTIVE'
                ? 'var(--color-on-success-container)'
                : b.status === 'HOLD'
                  ? 'var(--color-on-warning-container)'
                  : 'var(--color-on-surface-variant)',
          }}
        >
          {b.status}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Aksi',
      render: (b) => (
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <Button
            variant="tonal"
            size="sm"
            icon={<Icon name="edit" size={15} />}
            onClick={() => {
              setSelectedBatch(b);
              setShowBatchModal(true);
            }}
            title="Edit Batch"
          >
            Edit
          </Button>
        </div>
      ),
    },
  ];

  // Product Columns
  const productColumns: ColumnDef<Product>[] = [
    { key: 'sku', header: 'Kode Produk', sortable: true, render: (p) => <strong>{p.sku}</strong> },
    { key: 'name', header: 'Nama Produk', sortable: true },
    {
      key: 'idealCycleTimeSeconds',
      header: 'Ideal Cycle Time',
      sortable: true,
      render: (p) => (
        <span style={{ color: 'var(--color-primary)', fontWeight: 700 }}>
          {p.idealCycleTimeSeconds} sec / pcs
        </span>
      ),
    },
    { key: 'unit', header: 'Satuan', render: (p) => p.unit || 'PCS' },
    {
      key: 'status',
      header: 'Status',
      render: (p) => (
        <span
          style={{
            padding: '2px 8px',
            borderRadius: 'var(--radius-pill)',
            fontSize: '11px',
            fontWeight: 700,
            backgroundColor:
              p.status === 'ACTIVE' ? 'var(--color-success-container)' : 'var(--color-surface-container)',
            color:
              p.status === 'ACTIVE' ? 'var(--color-on-success-container)' : 'var(--color-on-surface-variant)',
          }}
        >
          {p.status || 'ACTIVE'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Aksi',
      render: (p) => (
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <Button
            variant="tonal"
            size="sm"
            icon={<Icon name="edit" size={15} />}
            onClick={() => {
              setSelectedProduct(p);
              setShowProductModal(true);
            }}
            title="Edit Produk"
          >
            Edit
          </Button>
          <Button
            variant="text"
            size="sm"
            style={{ color: 'var(--color-error)' }}
            icon={<Icon name="delete" size={16} />}
            onClick={() => {
              setSelectedProduct(p);
              setShowDeleteProductDialog(true);
            }}
            title="Hapus Produk"
            aria-label="Hapus Produk"
          />
        </div>
      ),
    },
  ];

  // Machine Columns
  const machineColumns: ColumnDef<Machine>[] = [
    { key: 'code', header: 'Kode Mesin', sortable: true, render: (m) => <strong>{m.code}</strong> },
    { key: 'name', header: 'Nama Mesin', sortable: true },
    { key: 'workCenterId', header: 'Work Center', render: (m) => m.workCenterId?.toUpperCase() || 'STAMPING' },
    {
      key: 'idealCycleTimeSeconds',
      header: 'Ideal Cycle Time',
      render: (m) => `${m.idealCycleTimeSeconds || 12} sec`,
    },
    {
      key: 'status',
      header: 'Status',
      render: (m) => (
        <span
          style={{
            padding: '2px 8px',
            borderRadius: 'var(--radius-pill)',
            fontSize: '11px',
            fontWeight: 700,
            backgroundColor:
              m.status === 'ACTIVE' ? 'var(--color-success-container)' : 'var(--color-surface-container)',
            color:
              m.status === 'ACTIVE' ? 'var(--color-on-success-container)' : 'var(--color-on-surface-variant)',
          }}
        >
          {m.status || 'ACTIVE'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Aksi',
      render: (m) => (
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <Button
            variant="tonal"
            size="sm"
            icon={<Icon name="edit" size={15} />}
            onClick={() => {
              setSelectedMachine(m);
              setShowMachineModal(true);
            }}
            title="Edit Mesin"
          >
            Edit
          </Button>
          <Button
            variant="text"
            size="sm"
            style={{ color: 'var(--color-error)' }}
            icon={<Icon name="delete" size={16} />}
            onClick={() => {
              setSelectedMachine(m);
              setShowDeleteMachineDialog(true);
            }}
            title="Hapus Mesin"
            aria-label="Hapus Mesin"
          />
        </div>
      ),
    },
  ];

  // Line Columns
  const lineColumns: ColumnDef<ProductionLine>[] = [
    { key: 'code', header: 'Kode Production Line', sortable: true, render: (l) => <strong>{l.code}</strong> },
    { key: 'name', header: 'Nama Production Line', sortable: true },
    {
      key: 'plannedProductionTimeMinutes',
      header: 'Planned Production Time',
      render: (l) => `${l.plannedProductionTimeMinutes || 480} mins`,
    },
    {
      key: 'status',
      header: 'Status',
      render: (l) => (
        <span
          style={{
            padding: '2px 8px',
            borderRadius: 'var(--radius-pill)',
            fontSize: '11px',
            fontWeight: 700,
            backgroundColor:
              l.status === 'ACTIVE' ? 'var(--color-success-container)' : 'var(--color-surface-container)',
            color:
              l.status === 'ACTIVE' ? 'var(--color-on-success-container)' : 'var(--color-on-surface-variant)',
          }}
        >
          {l.status || 'ACTIVE'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Aksi',
      render: (l) => (
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <Button
            variant="tonal"
            size="sm"
            icon={<Icon name="edit" size={15} />}
            onClick={() => {
              setSelectedLine(l);
              setShowLineModal(true);
            }}
            title="Edit Production Line"
          >
            Edit
          </Button>
          <Button
            variant="text"
            size="sm"
            style={{ color: 'var(--color-error)' }}
            icon={<Icon name="delete" size={16} />}
            onClick={() => {
              setSelectedLine(l);
              setShowDeleteLineDialog(true);
            }}
            title="Hapus Production Line"
            aria-label="Hapus Production Line"
          />
        </div>
      ),
    },
  ];

  // Operator Columns
  // Issuing an operator's PIN (§22.1 "Reset operator PIN where applicable").
  // The API has always had `POST /operators/:id/pin` and the client has always
  // wrapped it, but nothing in the console called it — so on an install where
  // BOOTSTRAP_OPERATOR_PIN was left empty, no operator could sign in to a
  // terminal and an administrator had no way to fix it from the product.
  const [pinOperator, setPinOperator] = useState<Operator | null>(null);
  const [pinValue, setPinValue] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinDone, setPinDone] = useState<string | null>(null);

  const setOperatorPin = useMutation({
    mutationFn: () => api.auth.setOperatorPin(pinOperator!.id, pinValue),
    onSuccess: () => {
      setPinDone(`PIN untuk ${pinOperator?.name} berhasil disetel.`);
      setPinOperator(null);
      setPinValue('');
      setPinConfirm('');
      setPinError(null);
      window.setTimeout(() => setPinDone(null), 4000);
    },
    onError: (error: unknown) => {
      setPinError(error instanceof Error ? error.message : 'Gagal menyetel PIN.');
    },
  });

  const operatorColumns: ColumnDef<Operator>[] = [
    {
      key: 'employeeNumber',
      header: 'Nomor Karyawan',
      sortable: true,
      render: (o) => <strong>{o.employeeNumber}</strong>,
    },
    { key: 'name', header: 'Nama', sortable: true },
    {
      key: 'defaultLineId',
      header: 'Production Line Default',
      render: (o) => o.defaultLineId?.toUpperCase() || 'LINE-01',
    },
    {
      key: 'status',
      header: 'Status',
      render: (o) => (
        <span
          style={{
            padding: '2px 8px',
            borderRadius: 'var(--radius-pill)',
            fontSize: '11px',
            fontWeight: 700,
            backgroundColor:
              o.status === 'ACTIVE' ? 'var(--color-success-container)' : 'var(--color-surface-container)',
            color:
              o.status === 'ACTIVE' ? 'var(--color-on-success-container)' : 'var(--color-on-surface-variant)',
          }}
        >
          {o.status || 'ACTIVE'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Aksi',
      render: (o) => (
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <Button
            variant="tonal"
            size="sm"
            icon={<Icon name="edit" size={15} />}
            onClick={() => {
              setSelectedOperator(o);
              setShowOperatorModal(true);
            }}
            title="Edit Operator"
          >
            Edit
          </Button>
          <Button
            variant="text"
            size="sm"
            icon={<Icon name="lock" size={15} />}
            onClick={() => {
              setPinOperator(o);
              setPinValue('');
              setPinConfirm('');
              setPinError(null);
            }}
            title="Setel PIN terminal untuk operator ini"
          >
            PIN
          </Button>
          <Button
            variant="text"
            size="sm"
            style={{ color: 'var(--color-error)' }}
            icon={<Icon name="delete" size={16} />}
            onClick={() => {
              setSelectedOperator(o);
              setShowDeleteOperatorDialog(true);
            }}
            title="Hapus Operator"
            aria-label="Hapus Operator"
          />
        </div>
      ),
    },
  ];

  // Downtime Reason Columns
  const downtimeColumns: ColumnDef<DowntimeReason>[] = [
    { key: 'code', header: 'Kode Alasan Downtime', sortable: true, render: (dt) => <strong>{dt.code}</strong> },
    { key: 'name', header: 'Nama Alasan', sortable: true },
    {
      key: 'category',
      header: 'Kategori Alasan Downtime',
      sortable: true,
      render: (dt) => (
        <span
          style={{
            padding: '2px 8px',
            borderRadius: 'var(--radius-pill)',
            fontSize: '11px',
            fontWeight: 800,
            backgroundColor: 'var(--color-warning-container)',
            color: 'var(--color-on-warning-container)',
          }}
        >
          {dt.category}
        </span>
      ),
    },
    { key: 'description', header: 'Deskripsi', render: (dt) => dt.description || '-' },
    {
      key: 'isPlanned',
      header: 'Tipe',
      render: (dt) => (
        <span
          style={{
            fontSize: '11.5px',
            fontWeight: 700,
            color: dt.isPlanned ? 'var(--color-primary)' : 'var(--color-error)',
          }}
        >
          {dt.isPlanned ? 'Planned (Setup/PM)' : 'Unplanned (Breakdown)'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Aksi',
      render: (dt) => (
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <Button
            variant="tonal"
            size="sm"
            icon={<Icon name="edit" size={15} />}
            onClick={() => {
              setSelectedDt(dt);
              setShowDtModal(true);
            }}
            title="Edit Downtime Reason"
          >
            Edit
          </Button>
          <Button
            variant="text"
            size="sm"
            style={{ color: 'var(--color-error)' }}
            icon={<Icon name="delete" size={16} />}
            onClick={() => {
              setSelectedDt(dt);
              setShowDeleteDtDialog(true);
            }}
            title="Hapus Downtime Reason"
            aria-label="Hapus Downtime Reason"
          />
        </div>
      ),
    },
  ];

  // Reject Reason Columns
  const rejectColumns: ColumnDef<RejectReason>[] = [
    { key: 'code', header: 'Kode Alasan Reject', sortable: true, render: (rej) => <strong>{rej.code}</strong> },
    { key: 'name', header: 'Nama Alasan Reject', sortable: true },
    {
      key: 'category',
      header: 'Kategori Alasan Reject',
      sortable: true,
      render: (rej) => (
        <span
          style={{
            padding: '2px 8px',
            borderRadius: 'var(--radius-pill)',
            fontSize: '11px',
            fontWeight: 800,
            backgroundColor: 'var(--color-error-container)',
            color: 'var(--color-on-error-container)',
          }}
        >
          {rej.category}
        </span>
      ),
    },
    {
      key: 'description',
      header: 'Deskripsi',
      render: (rej) => rej.description || '-',
    },
    {
      key: 'actions',
      header: 'Aksi',
      render: (rej) => (
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <Button
            variant="tonal"
            size="sm"
            icon={<Icon name="edit" size={15} />}
            onClick={() => {
              setSelectedRej(rej);
              setShowRejModal(true);
            }}
            title="Edit Alasan Reject"
          >
            Edit
          </Button>
          <Button
            variant="text"
            size="sm"
            style={{ color: 'var(--color-error)' }}
            icon={<Icon name="delete" size={16} />}
            onClick={() => {
              setSelectedRej(rej);
              setShowDeleteRejDialog(true);
            }}
            title="Hapus Alasan Reject"
            aria-label="Hapus Alasan Reject"
          />
        </div>
      ),
    },
  ];

  // Users Columns
  const userColumns: ColumnDef<AppUser>[] = [
    { key: 'name', header: 'Nama', sortable: true, render: (u) => <strong>{u.name}</strong> },
    { key: 'email', header: 'Email', sortable: true },
    {
      key: 'role',
      header: 'Peran',
      sortable: true,
      render: (u) => (
        <span
          style={{
            padding: '2px 8px',
            borderRadius: 'var(--radius-pill)',
            fontSize: '11px',
            fontWeight: 800,
            backgroundColor: 'var(--color-primary-container)',
            color: 'var(--color-on-primary-container)',
          }}
        >
          {u.role}
        </span>
      ),
    },
    {
      key: 'scopeLevel',
      header: 'Cakupan Akses',
      render: (u) => `${u.scopeLevel} ${u.scopeId ? `(${u.scopeId})` : ''}`,
    },
    {
      key: 'status',
      header: 'Status',
      render: (u) => (
        <span
          style={{
            padding: '2px 8px',
            borderRadius: 'var(--radius-pill)',
            fontSize: '11px',
            fontWeight: 700,
            backgroundColor:
              u.status === 'ACTIVE' ? 'var(--color-success-container)' : 'var(--color-surface-container)',
            color:
              u.status === 'ACTIVE' ? 'var(--color-on-success-container)' : 'var(--color-on-surface-variant)',
          }}
        >
          {u.status}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Aksi',
      render: (u) => (
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <Button
            variant="tonal"
            size="sm"
            icon={<Icon name="edit" size={15} />}
            onClick={() => {
              setSelectedUser(u);
              setShowUserModal(true);
            }}
            title="Edit User"
          >
            Edit
          </Button>
          <Button
            variant="text"
            size="sm"
            style={{ color: 'var(--color-error)' }}
            icon={<Icon name="delete" size={16} />}
            onClick={() => {
              setSelectedUser(u);
              setShowDeleteUserDialog(true);
            }}
            title="Hapus User"
            aria-label={`Hapus user ${u.name}`}
          />
        </div>
      ),
    },
  ];

  // Device Columns
  const deviceColumns: ColumnDef<DeviceTerminal>[] = [
    {
      key: 'deviceCode',
      header: 'Kode Terminal',
      sortable: true,
      render: (d) => <strong>{d.deviceCode}</strong>,
    },
    { key: 'name', header: 'Nama Terminal', sortable: true },
    {
      key: 'assignedLineId',
      header: 'Production Line',
      render: (d) => d.assignedLineId?.toUpperCase() || 'GLOBAL',
    },
    { key: 'ipAddress', header: 'Alamat IP', render: (d) => d.ipAddress || '-' },
    {
      key: 'status',
      header: 'Status',
      render: (d) => <StatusBadge status={d.status === 'ONLINE' ? 'online' : 'offline'} label={d.status} />,
    },
    {
      key: 'actions',
      header: 'Aksi',
      render: (d) => (
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <Button
            variant="tonal"
            size="sm"
            icon={<Icon name="edit" size={15} />}
            onClick={() => {
              setSelectedDevice(d);
              setShowDeviceModal(true);
            }}
            title="Edit Terminal"
          >
            Edit
          </Button>
          <Button
            variant="text"
            size="sm"
            style={{ color: 'var(--color-error)' }}
            icon={<Icon name="delete" size={16} />}
            onClick={() => {
              setSelectedDevice(d);
              setShowDeleteDeviceDialog(true);
            }}
            title="Hapus Terminal"
            aria-label="Hapus Terminal"
          />
        </div>
      ),
    },
  ];

  const getActiveTabTitle = () => {
    switch (activeTab) {
      case 'processes':
        return 'Proses Produksi';
      case 'routings':
        return 'Routing Produk';
      case 'rates':
        return 'Ideal Cycle Time per Produk dan Mesin';
      case 'batches':
        return 'Batch Produksi dan Lot';
      case 'products':
        return 'Produk';
      case 'machines':
        return 'Mesin';
      case 'lines':
        return 'Production Line';
      case 'operators':
        return 'Operator';
      case 'downtime-reasons':
        return 'Alasan Downtime';
      case 'reject-reasons':
        return 'Alasan Reject';
      case 'users':
        return 'Pengguna dan Cakupan Akses';
      case 'devices':
        return 'Terminal Shop Floor';
      case 'acl':
        return 'Matriks Hak Akses';
      case 'shifts':
        return 'Shift';
      case 'work-centers':
        return 'Work Center';
      case 'molds':
        return 'Mold dan Kompatibilitas Produk';
      case 'roles':
        return 'Peran & Permission';
      case 'import-export':
        return 'Import dan Export Master Data';
      case 'sessions':
        return 'Sesi Aktif';
      case 'oee-config':
        return 'Definisi OEE';
      default:
        return 'Master Data';
    }
  };

  return (
    <Page style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Header with Direct Action Trigger */}
      <Section
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '11.5px',
              color: 'var(--color-on-surface-variant)',
              fontWeight: 600,
            }}
          >
            <span>Plant Master Data</span>
          </div>
          <h1
            style={{
              fontSize: '20px',
              fontWeight: 800,
              margin: '4px 0 0',
              color: 'var(--color-on-surface)',
              letterSpacing: '-0.02em',
            }}
          >
            {getActiveTabTitle()}
          </h1>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          {activeTab === 'processes' && (
            <Button
              variant="filled"
              icon={<Icon name="add" size={16} />}
              onClick={() => {
                setSelectedProcess(null);
                setShowProcessModal(true);
              }}
            >
              Add Process
            </Button>
          )}

          {activeTab === 'routings' && (
            <Button
              variant="filled"
              icon={<Icon name="alt_route" size={16} />}
              onClick={() => {
                setSelectedRouting(null);
                setShowRoutingModal(true);
              }}
            >
              Add Routing Step
            </Button>
          )}

          {activeTab === 'rates' && (
            <Button
              variant="filled"
              icon={<Icon name="speed" size={16} />}
              onClick={() => {
                setSelectedRate(null);
                setShowRateModal(true);
              }}
            >
              Set Machine Rate
            </Button>
          )}

          {activeTab === 'batches' && (
            <Button
              variant="filled"
              icon={<Icon name="inventory_2" size={16} />}
              onClick={() => {
                setSelectedBatch(null);
                setShowBatchModal(true);
              }}
            >
              Create Batch / Lot
            </Button>
          )}

          {activeTab === 'products' && (
            <Button
              variant="filled"
              icon={<Icon name="add" size={16} />}
              onClick={() => {
                setSelectedProduct(null);
                setShowProductModal(true);
              }}
            >
              Tambah Produk
            </Button>
          )}

          {activeTab === 'machines' && (
            <Button
              variant="filled"
              icon={<Icon name="add" size={16} />}
              onClick={() => {
                setSelectedMachine(null);
                setShowMachineModal(true);
              }}
            >
              Add Machine
            </Button>
          )}

          {activeTab === 'lines' && (
            <Button
              variant="filled"
              icon={<Icon name="add" size={16} />}
              onClick={() => {
                setSelectedLine(null);
                setShowLineModal(true);
              }}
            >
              Add Production Line
            </Button>
          )}

          {activeTab === 'operators' && (
            <Button
              variant="filled"
              icon={<Icon name="person_add" size={16} />}
              onClick={() => {
                setSelectedOperator(null);
                setShowOperatorModal(true);
              }}
            >
              Add Operator
            </Button>
          )}

          {activeTab === 'downtime-reasons' && (
            <Button
              variant="filled"
              icon={<Icon name="add" size={16} />}
              onClick={() => {
                setSelectedDt(null);
                setShowDtModal(true);
              }}
            >
              Add Downtime Reason
            </Button>
          )}

          {activeTab === 'reject-reasons' && (
            <Button
              variant="filled"
              icon={<Icon name="add" size={16} />}
              onClick={() => {
                setSelectedRej(null);
                setShowRejModal(true);
              }}
            >
              Add Reject Code
            </Button>
          )}

          {activeTab === 'users' && (
            <Button
              variant="filled"
              icon={<Icon name="person_add" size={16} />}
              onClick={() => {
                setSelectedUser(null);
                setShowUserModal(true);
              }}
            >
              Invite / Create User
            </Button>
          )}

          {activeTab === 'devices' && (
            <Button
              variant="filled"
              icon={<Icon name="add_to_queue" size={16} />}
              onClick={() => {
                setSelectedDevice(null);
                setShowDeviceModal(true);
              }}
            >
              Register Terminal
            </Button>
          )}
        </div>
      </Section>

      {/* Active Tab Data Table Content */}
      {activeTab === 'processes' && (
        <AdvancedDataTable
          columns={processColumns}
          data={processes || []}
          title="Production Processes & Stages"
          subtitle="Generic master processes (Mixing, Extrusion, Building, Curing, Inspection)"
          searchable={true}
          selectable={true}
          expandable={false}
        />
      )}

      {activeTab === 'routings' && (
        <AdvancedDataTable
          columns={routingColumns}
          data={routings || []}
          title="Product Sequence Routings"
          subtitle="Multi-step manufacturing routing definitions mapping SKUs across processes and machines"
          searchable={true}
          selectable={true}
          expandable={false}
        />
      )}

      {activeTab === 'rates' && (
        <AdvancedDataTable
          columns={rateColumns}
          data={machineRates || []}
          title="Product × Machine Ideal Cycle Rates (Tech Arch)"
          subtitle="Ideal cycle times (takt rates) resolved for Performance component calculation"
          searchable={true}
          selectable={true}
          expandable={false}
        />
      )}

      {activeTab === 'batches' && (
        <AdvancedDataTable
          columns={batchColumns}
          data={batches || []}
          title="Production Batches & Traceability Lots"
          subtitle="Lot number tracking across multi-process work orders"
          searchable={true}
          selectable={true}
          expandable={false}
        />
      )}

      {activeTab === 'products' && (
        <AdvancedDataTable
          columns={productColumns}
          data={products || []}
          title="Product & Part Number Catalog"
          subtitle="Daftar Produk beserta Ideal Cycle Time"
          searchable={true}
          selectable={true}
          expandable={false}
        />
      )}

      {activeTab === 'machines' && (
        <AdvancedDataTable
          columns={machineColumns}
          data={machines || []}
          title="Mesin"
          subtitle="Specifications for stamping presses, CNC milling, and assembly cells"
          searchable={true}
          selectable={true}
          expandable={false}
        />
      )}

      {activeTab === 'lines' && (
        <AdvancedDataTable
          columns={lineColumns}
          data={lines || []}
          title="Production Line Configurations"
          subtitle="Assembly line registry and planned operational shifts"
          searchable={true}
          selectable={true}
          expandable={false}
        />
      )}

      {pinDone && (
        <div
          style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            zIndex: 9999,
            backgroundColor: 'var(--color-success-container)',
            color: 'var(--color-on-success-container)',
            padding: '12px 20px',
            borderRadius: 'var(--radius-md)',
            fontSize: '13px',
            fontWeight: 600,
          }}
        >
          {pinDone}
        </div>
      )}

      <Dialog
        isOpen={Boolean(pinOperator)}
        onClose={() => setPinOperator(null)}
        title={pinOperator ? `Setel PIN — ${pinOperator.name}` : 'Setel PIN'}
        maxWidth="440px"
      >
        <p style={{ margin: '0 0 14px', fontSize: '13px', color: 'var(--color-on-surface-variant)' }}>
          PIN 4–8 digit untuk masuk ke terminal shop floor dengan nomor karyawan{' '}
          <strong>{pinOperator?.employeeNumber}</strong>. PIN lama langsung tidak berlaku, dan
          perubahan tercatat di audit log.
        </p>
        <div style={{ display: 'grid', gap: '12px' }}>
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '11px',
                fontWeight: 700,
                color: 'var(--color-on-surface-variant)',
                marginBottom: '4px',
              }}
            >
              PIN BARU
            </label>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              value={pinValue}
              onChange={(e) => setPinValue(e.target.value.replace(/\D/g, '').slice(0, 8))}
              style={inputStyle}
            />
          </div>
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '11px',
                fontWeight: 700,
                color: 'var(--color-on-surface-variant)',
                marginBottom: '4px',
              }}
            >
              ULANGI PIN
            </label>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              value={pinConfirm}
              onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, '').slice(0, 8))}
              style={inputStyle}
            />
          </div>
        </div>
        {pinError && (
          <p style={{ margin: '10px 0 0', fontSize: '12px', color: 'var(--color-error)' }}>{pinError}</p>
        )}
        {pinValue && pinConfirm && pinValue !== pinConfirm && (
          <p style={{ margin: '10px 0 0', fontSize: '12px', color: 'var(--color-error)' }}>
            Kedua PIN belum sama.
          </p>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '18px' }}>
          <Button variant="text" onClick={() => setPinOperator(null)}>
            Batal
          </Button>
          <Button
            variant="filled"
            disabled={
              setOperatorPin.isPending ||
              pinValue.length < 4 ||
              pinValue !== pinConfirm
            }
            onClick={() => setOperatorPin.mutate()}
          >
            {setOperatorPin.isPending ? 'Menyimpan…' : 'Setel PIN'}
          </Button>
        </div>
      </Dialog>

      {activeTab === 'operators' && (
        <AdvancedDataTable
          columns={operatorColumns}
          data={operators || []}
          title="Shop Floor Operator Directory"
          subtitle="Operator badge IDs, names, and default assigned production lines"
          searchable={true}
          selectable={true}
          expandable={false}
        />
      )}

      {activeTab === 'downtime-reasons' && (
        <AdvancedDataTable
          columns={downtimeColumns}
          data={downtimeReasons || []}
          title="Downtime & Loss Taxonomy Directory"
          subtitle="Standardized categorisation for mechanical breakdowns, raw material shortages, and setup losses"
          searchable={true}
          selectable={true}
          expandable={false}
        />
      )}

      {activeTab === 'reject-reasons' && (
        <AdvancedDataTable
          columns={rejectColumns}
          data={rejectReasons || []}
          title="Quality Defect & Reject Taxonomy"
          subtitle="Standardized defect codes for dimension variance, scratches, burrs, and functional QC tests"
          searchable={true}
          selectable={true}
          expandable={false}
        />
      )}

      {activeTab === 'users' && (
        <AdvancedDataTable
          columns={userColumns}
          data={users || []}
          title="User Management & Access Scopes"
          subtitle="Configure application users, role models, and plant/line data visibility scopes"
          searchable={true}
          selectable={true}
          expandable={false}
        />
      )}

      {activeTab === 'devices' && (
        <AdvancedDataTable
          columns={deviceColumns}
          data={devices || []}
          title="Registered Shop Floor Devices & PWA Terminals ( &)"
          subtitle="Authorized Android tablets with offline-first synchronization capabilities"
          searchable={true}
          selectable={true}
          expandable={false}
        />
      )}

      {/* PRD v1.5 tabs. Each is its own component so this file stays
 readable rather than growing a seventh inline table. */}
      {activeTab === 'shifts' && <ShiftsTab onToast={showToast} />}
      {activeTab === 'work-centers' && <WorkCentersTab onToast={showToast} />}
      {activeTab === 'molds' && <MoldsTab onToast={showToast} />}
      {activeTab === 'roles' && <RolesTab onToast={showToast} />}
      {activeTab === 'import-export' && <ImportExportTab onToast={showToast} />}
      {activeTab === 'sessions' && <SessionsTab onToast={showToast} />}
      {activeTab === 'oee-config' && <OeeConfigTab onToast={showToast} />}

      {activeTab === 'acl' && <AclMatrixTab onToast={showToast} />}

      {/* --- MODAL FORMS --- */}
      {/* 0. Process Form Modal */}
      <ProcessFormModal
        isOpen={showProcessModal}
        onClose={() => setShowProcessModal(false)}
        initialData={selectedProcess}
        onSave={(payload) => saveProcessMutation.mutate(payload)}
        isLoading={saveProcessMutation.isPending}
      />
      <Dialog
        isOpen={showDeleteProcessDialog}
        onClose={() => setShowDeleteProcessDialog(false)}
        title="Hapus Proses Produksi"
        supportingText={`Apakah Anda yakin ingin menghapus proses "${selectedProcess?.code}" (${selectedProcess?.name})?`}
        confirmLabel={deleteProcessMutation.isPending ? 'Menghapus, ...' : 'Hapus Proses'}
        cancelLabel="Batal"
        destructive={true}
        onConfirm={() => {
          if (selectedProcess) deleteProcessMutation.mutate(selectedProcess.id);
        }}
      />

      {/* 0b. Routing Form Modal */}
      <RoutingFormModal
        isOpen={showRoutingModal}
        onClose={() => setShowRoutingModal(false)}
        products={products || []}
        processes={processes || []}
        machines={machines || []}
        initialData={selectedRouting}
        onSave={(payload) => saveRoutingMutation.mutate(payload)}
        isLoading={saveRoutingMutation.isPending}
      />
      <Dialog
        isOpen={showDeleteRoutingDialog}
        onClose={() => setShowDeleteRoutingDialog(false)}
        title="Hapus Alur Routing"
        supportingText="Apakah Anda yakin ingin menghapus tahapan routing ini?"
        confirmLabel={deleteRoutingMutation.isPending ? 'Menghapus, ...' : 'Hapus Routing'}
        cancelLabel="Batal"
        destructive={true}
        onConfirm={() => {
          if (selectedRouting) deleteRoutingMutation.mutate(selectedRouting.id);
        }}
      />

      {/* 0c. Rate Form Modal */}
      <RateFormModal
        isOpen={showRateModal}
        onClose={() => setShowRateModal(false)}
        products={products || []}
        machines={machines || []}
        initialData={selectedRate}
        onSave={(payload) => saveRateMutation.mutate(payload)}
        isLoading={saveRateMutation.isPending}
      />
      <Dialog
        isOpen={showDeleteRateDialog}
        onClose={() => setShowDeleteRateDialog(false)}
        title="Hapus Cycle Rate"
        supportingText="Apakah Anda yakin ingin menghapus cycle rate ini?"
        confirmLabel={deleteRateMutation.isPending ? 'Menghapus, ...' : 'Hapus Rate'}
        cancelLabel="Batal"
        destructive={true}
        onConfirm={() => {
          if (selectedRate) deleteRateMutation.mutate(selectedRate.id);
        }}
      />

      {/* 0d. Batch Form Modal */}
      <BatchFormModal
        isOpen={showBatchModal}
        onClose={() => setShowBatchModal(false)}
        products={products || []}
        workOrders={workOrdersForBatches || []}
        initialData={selectedBatch}
        onSave={(payload) => saveBatchMutation.mutate(payload)}
        isLoading={saveBatchMutation.isPending}
      />

      {/* 1. Product Form Modal */}
      <ProductFormModal
        isOpen={showProductModal}
        onClose={() => setShowProductModal(false)}
        initialData={selectedProduct}
        onSave={(payload) => saveProductMutation.mutate(payload)}
        isLoading={saveProductMutation.isPending}
      />
      <Dialog
        isOpen={showDeleteProductDialog}
        onClose={() => setShowDeleteProductDialog(false)}
        title="Hapus Produk"
        supportingText={`Apakah Anda yakin ingin menghapus Produk "${selectedProduct?.sku}" (${selectedProduct?.name})?`}
        confirmLabel={deleteProductMutation.isPending ? 'Menghapus…' : 'Hapus Produk'}
        cancelLabel="Batal"
        destructive={true}
        onConfirm={() => {
          if (selectedProduct) deleteProductMutation.mutate(selectedProduct.id);
        }}
      />

      {/* 2. Machine Form Modal */}
      <MachineFormModal
        isOpen={showMachineModal}
        onClose={() => setShowMachineModal(false)}
        initialData={selectedMachine}
        onSave={(payload) => saveMachineMutation.mutate(payload)}
        isLoading={saveMachineMutation.isPending}
      />
      <Dialog
        isOpen={showDeleteMachineDialog}
        onClose={() => setShowDeleteMachineDialog(false)}
        title="Hapus Mesin Produksi"
        supportingText={`Apakah Anda yakin ingin menghapus mesin "${selectedMachine?.code}" (${selectedMachine?.name})?`}
        confirmLabel={deleteMachineMutation.isPending ? 'Menghapus, ...' : 'Hapus Mesin'}
        cancelLabel="Batal"
        destructive={true}
        onConfirm={() => {
          if (selectedMachine) deleteMachineMutation.mutate(selectedMachine.id);
        }}
      />

      {/* 3. Line Form Modal */}
      <LineFormModal
        isOpen={showLineModal}
        onClose={() => setShowLineModal(false)}
        initialData={selectedLine}
        onSave={(payload) => saveLineMutation.mutate(payload)}
        isLoading={saveLineMutation.isPending}
      />
      <Dialog
        isOpen={showDeleteLineDialog}
        onClose={() => setShowDeleteLineDialog(false)}
        title="Hapus Production Line"
        supportingText={`Apakah Anda yakin ingin menghapus lini produksi "${selectedLine?.code}" (${selectedLine?.name})?`}
        confirmLabel={deleteLineMutation.isPending ? 'Menghapus…' : 'Hapus Production Line'}
        cancelLabel="Batal"
        destructive={true}
        onConfirm={() => {
          if (selectedLine) deleteLineMutation.mutate(selectedLine.id);
        }}
      />

      {/* 4. Operator Form Modal */}
      <OperatorFormModal
        isOpen={showOperatorModal}
        onClose={() => setShowOperatorModal(false)}
        lines={lines || []}
        initialData={selectedOperator}
        onSave={(payload) => saveOperatorMutation.mutate(payload)}
        isLoading={saveOperatorMutation.isPending}
      />
      <Dialog
        isOpen={showDeleteOperatorDialog}
        onClose={() => setShowDeleteOperatorDialog(false)}
        title="Hapus Data Operator"
        supportingText={`Apakah Anda yakin ingin menghapus operator "${selectedOperator?.name}" (${selectedOperator?.employeeNumber})?`}
        confirmLabel={deleteOperatorMutation.isPending ? 'Menghapus, ...' : 'Hapus Operator'}
        cancelLabel="Batal"
        destructive={true}
        onConfirm={() => {
          if (selectedOperator) deleteOperatorMutation.mutate(selectedOperator.id);
        }}
      />

      {/* 5. Downtime Reason Form Modal */}
      <DowntimeFormModal
        isOpen={showDtModal}
        onClose={() => setShowDtModal(false)}
        initialData={selectedDt}
        onSave={(payload) => saveDtMutation.mutate(payload)}
        isLoading={saveDtMutation.isPending}
      />
      <Dialog
        isOpen={showDeleteDtDialog}
        onClose={() => setShowDeleteDtDialog(false)}
        title="Hapus Alasan Downtime"
        supportingText={`Apakah Anda yakin ingin menghapus alasan downtime "${selectedDt?.code}" (${selectedDt?.name})?`}
        confirmLabel={deleteDtMutation.isPending ? 'Menghapus, ...' : 'Hapus Reason'}
        cancelLabel="Batal"
        destructive={true}
        onConfirm={() => {
          if (selectedDt) deleteDtMutation.mutate(selectedDt.id);
        }}
      />

      {/* 6. Reject Reason Form Modal */}
      <RejectFormModal
        isOpen={showRejModal}
        onClose={() => setShowRejModal(false)}
        initialData={selectedRej}
        onSave={(payload) => saveRejMutation.mutate(payload)}
        isLoading={saveRejMutation.isPending}
      />
      <Dialog
        isOpen={showDeleteRejDialog}
        onClose={() => setShowDeleteRejDialog(false)}
        title="Hapus Kode Reject / Defect"
        supportingText={`Apakah Anda yakin ingin menghapus kode cacat "${selectedRej?.code}" (${selectedRej?.name})?`}
        confirmLabel={deleteRejMutation.isPending ? 'Menghapus, ...' : 'Hapus Defect'}
        cancelLabel="Batal"
        destructive={true}
        onConfirm={() => {
          if (selectedRej) deleteRejMutation.mutate(selectedRej.id);
        }}
      />

      {/* 7. User Form Modal */}
      <UserFormModal
        isOpen={showUserModal}
        onClose={() => setShowUserModal(false)}
        initialData={selectedUser}
        onSave={(payload) => saveUserMutation.mutate(payload)}
        isLoading={saveUserMutation.isPending}
      />
      <Dialog
        isOpen={showDeleteUserDialog}
        onClose={() => setShowDeleteUserDialog(false)}
        title="Hapus Akun Pengguna"
        supportingText={`Apakah Anda yakin ingin menghapus user "${selectedUser?.name}" (${selectedUser?.email})?`}
        confirmLabel={deleteUserMutation.isPending ? 'Menghapus, ...' : 'Hapus User'}
        cancelLabel="Batal"
        destructive={true}
        onConfirm={() => {
          if (selectedUser) deleteUserMutation.mutate(selectedUser.id);
        }}
      />

      {/* 8. Device Form Modal */}
      <DeviceFormModal
        isOpen={showDeviceModal}
        onClose={() => setShowDeviceModal(false)}
        lines={lines || []}
        initialData={selectedDevice}
        onSave={(payload) => saveDeviceMutation.mutate(payload)}
        isLoading={saveDeviceMutation.isPending}
      />
      <Dialog
        isOpen={showDeleteDeviceDialog}
        onClose={() => setShowDeleteDeviceDialog(false)}
        title="Hapus Tablet Terminal"
        supportingText={`Apakah Anda yakin ingin menghapus terminal "${selectedDevice?.deviceCode}" (${selectedDevice?.name})?`}
        confirmLabel={deleteDeviceMutation.isPending ? 'Menghapus, ...' : 'Hapus Terminal'}
        cancelLabel="Batal"
        destructive={true}
        onConfirm={() => {
          if (selectedDevice) deleteDeviceMutation.mutate(selectedDevice.id);
        }}
      />

      {/* Live Toast Alert */}
      {toastMessage && (
        <div
          style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            zIndex: 9999,
            backgroundColor: 'var(--color-inverse-surface)',
            color: 'var(--color-inverse-on-surface)',
            padding: '12px 20px',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--elevation-3)',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            fontSize: '13px',
            fontWeight: 600,
            animation: 'fadeIn 0.2s ease',
          }}
        >
          <Icon name="check_circle" size={18} style={{ color: 'var(--color-success)' }} />
          <span>{toastMessage}</span>
        </div>
      )}
    </Page>
  );
};
