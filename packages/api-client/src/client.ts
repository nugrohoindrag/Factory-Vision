import {
  WorkOrder,
  ProductionOrder,
  OEEDaily,
  DowntimeRecord,
  ProductionRecord,
  Plant,
  ProductionLine,
  Machine,
  Product,
  ProductionProcess,
  ProductRouting,
  ProductMachineRate,
  ProductionBatch,
  Operator,
  Shift,
  DowntimeReason,
  RejectReason,
  CorrectionRequest,
  CorrectionStatus,
  AuditLog,
  AppUser,
  DeviceTerminal,
  DowntimeParetoItem,
  RejectParetoItem,
  ExecutiveKpi,
  KpiMetric,
  KpiTarget,
  DailyPerformancePoint,
  ProductionTrendPoint,
  OeeTrendPoint,
  LinePerformanceRow,
  PlantPerformanceRow,
  ProcessPerformanceRow,
  DowntimeSummary,
  QualitySummary,
  OrderStatusSummary,
  OperationalAlert,
  BottleneckRow,
  CsvEntity,
  CsvImportResult,
  CsvTemplate,
  DeploymentInfo,
  LoginResponse,
  MachinePerformanceRow,
  OeeCalculationConfig,
  OeeReportItem,
  OeeValidationEntry,
  OeeValidationItem,
  PermissionDefinition,
  RoleDefinition,
  SessionPrincipal,
  SessionSummary,
  ShiftHandoverContext,
  ShiftHandoverRecord,
  SyncBatchResult,
  TargetVsActualDimension,
  TargetVsActualSummary,
  WorkCenter,
  Mold,
  ProductMoldCompatibility,
  Customer,
  CustomerOrder,
  CustomerOrderLine,
  CustomerOrderDocumentRef,
  CustomerOrderStatus,
  OrderChannel,
  DemandForecast,
  DemandForecastLine,
  DemandForecastComparison,
  CapacityPlan,
  CapacityPlanLine,
  CapacityAssessment,
  ProductionPlan,
  ProductionPlanLine,
  ProductionPlanDemand,
  ProductionPlanDemandBreakdown,
  ProductionPlanWizardState,
  PlanningConfig,
  PlanningJobView,
  ProcessChainView,
  WorkOrderDemandTrace,
} from '@factory-vision/domain-types';
import { ApiRequestError } from './api-error.js';
import { getAuthToken, getTenantId } from './auth-store.js';

/**
 * A compatibility row as the API returns it: the domain type plus the product's
 * own labels, so a list can be rendered without a second lookup per row.
 */
export interface MoldCompatibility extends ProductMoldCompatibility {
  productSku?: string;
  productName?: string;
}

/**
 * A record the shop floor captured and the server refused (MES-082).
 *
 * `reason` is written for a supervisor, not a developer: it is what the list
 * shows, and the whole story is that the record was kept rather than dropped.
 */
export interface SyncExceptionRecord {
  id: string;
  clientEventId: string;
  commandType: string;
  workOrderId?: string;
  workOrderNumber?: string;
  operatorId?: string;
  payload: Record<string, unknown>;
  occurredAt?: string;
  errorCode: string;
  reason: string;
  retryable: boolean;
  lineId?: string;
  lineName?: string;
  shiftDate?: string;
  status: 'OPEN' | 'RESOLVED' | 'IGNORED';
  resolvedBy?: string;
  resolvedAt?: string;
  resolutionNote?: string;
  createdAt?: string;
}

export interface SyncExceptionSummaryRow {
  lineId?: string;
  lineName?: string;
  count: number;
}

export interface ApiClientConfig {
  baseUrl: string;
  getToken?: () => string | null;
  getTenantId?: () => string | null;
}

/**
 * Build a query string, dropping undefined/null entries so an omitted optional
 * parameter does not become the literal string "undefined" on the wire.
 */
function qs(params?: Record<string, string | number | boolean | undefined>): string {
  if (!params) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

// Analytics contracts live in @factory-vision/domain-types so the API and the
// client cannot drift apart. Re-exported here for callers that already import
// from this package.
export type {
  DowntimeParetoItem,
  RejectParetoItem,
  ExecutiveKpi,
  KpiMetric,
  KpiTarget,
  DailyPerformancePoint,
  ProductionTrendPoint,
  OeeTrendPoint,
  LinePerformanceRow,
  PlantPerformanceRow,
  ProcessPerformanceRow,
  DowntimeSummary,
  QualitySummary,
  OrderStatusSummary,
  OperationalAlert,
};

export interface ProductionReportItem {
  workOrderId: string;
  woNumber: string;
  productSku: string;
  productName: string;
  lineId: string;
  lineName: string;
  targetQuantity: number;
  goodQuantity: number;
  rejectQuantity: number;
  achievementPct: number;
  variance: number;
  status: string;
  plannedStart: string;
  actualStart: string;
  actualEnd: string;
}

export interface DowntimeReportItem {
  id: string;
  shiftDate: string;
  shiftId: string;
  lineId: string;
  lineName: string;
  machineId: string;
  machineName: string;
  reasonCategory: string;
  reasonName: string;
  isPlanned: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  status: string;
  notes: string;
}

export interface ShiftReportItem {
  lineId: string;
  lineName: string;
  shiftId: string;
  shiftName: string;
  shiftDate: string;
  totalTarget: number;
  totalGood: number;
  totalReject: number;
  totalDowntimeMinutes: number;
  achievementPct: number;
  activeWorkOrdersCount: number;
  notes: string;
}

export class FactoryVisionApiClient {
  private baseUrl: string;
  private getToken?: () => string | null;
  private getTenantId?: () => string | null;

  constructor(config: ApiClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    // Falling back to the shared store means every screen's client is
    // authorised by one `setAuthToken` at login, including clients created
    // at module scope before the user signed in.
    this.getToken = config.getToken ?? getAuthToken;
    this.getTenantId = config.getTenantId ?? getTenantId;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    };

    const token = this.getToken?.();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const tenantId = this.getTenantId?.();
    if (tenantId) {
      headers['X-Tenant-Id'] = tenantId;
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, { ...options, headers });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw ApiRequestError.from(response, errorBody, endpoint);
    }

    // 204 and CSV-style endpoints have no JSON body to parse.
    if (response.status === 204) return undefined as T;
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      return (await response.text()) as unknown as T;
    }

    return response.json();
  }

  /** Fetches a text/CSV endpoint, used by the export and template downloads. */
  private async requestText(endpoint: string): Promise<string> {
    const headers: Record<string, string> = {};
    const token = this.getToken?.();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const tenantId = this.getTenantId?.();
    if (tenantId) headers['X-Tenant-Id'] = tenantId;

    const response = await fetch(`${this.baseUrl}${endpoint}`, { headers });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw ApiRequestError.from(response, errorBody, endpoint);
    }
    return response.text();
  }

  // Master Data API
  readonly master = {
    getPlants: () => this.request<Plant[]>('/api/v1/master/plants'),

    // Production Lines
    getLines: () => this.request<ProductionLine[]>('/api/v1/master/lines'),
    createLine: (body: Omit<ProductionLine, 'id' | 'tenantId'>) =>
      this.request<ProductionLine>('/api/v1/master/lines', { method: 'POST', body: JSON.stringify(body) }),
    updateLine: (id: string, body: Partial<Omit<ProductionLine, 'id' | 'tenantId'>>) =>
      this.request<ProductionLine>(`/api/v1/master/lines/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    deleteLine: (id: string) =>
      this.request<{ success: boolean; message: string }>(`/api/v1/master/lines/${id}`, { method: 'DELETE' }),

    // Machines
    getMachines: () => this.request<Machine[]>('/api/v1/master/machines'),
    createMachine: (body: Omit<Machine, 'id' | 'tenantId' | 'currentState' | 'currentStateSince'>) =>
      this.request<Machine>('/api/v1/master/machines', { method: 'POST', body: JSON.stringify(body) }),
    updateMachine: (id: string, body: Partial<Omit<Machine, 'id' | 'tenantId'>>) =>
      this.request<Machine>(`/api/v1/master/machines/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    deleteMachine: (id: string) =>
      this.request<{ success: boolean; message: string }>(`/api/v1/master/machines/${id}`, {
        method: 'DELETE',
      }),

    // Products / SKUs
    getProducts: () => this.request<Product[]>('/api/v1/master/products'),
    createProduct: (body: Omit<Product, 'id' | 'tenantId'>) =>
      this.request<Product>('/api/v1/master/products', { method: 'POST', body: JSON.stringify(body) }),
    updateProduct: (id: string, body: Partial<Omit<Product, 'id' | 'tenantId'>>) =>
      this.request<Product>(`/api/v1/master/products/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    deleteProduct: (id: string) =>
      this.request<{ success: boolean; message: string }>(`/api/v1/master/products/${id}`, {
        method: 'DELETE',
      }),

    // Operators
    getOperators: () => this.request<Operator[]>('/api/v1/master/operators'),
    createOperator: (body: Omit<Operator, 'id' | 'tenantId'>) =>
      this.request<Operator>('/api/v1/master/operators', { method: 'POST', body: JSON.stringify(body) }),
    updateOperator: (id: string, body: Partial<Omit<Operator, 'id' | 'tenantId'>>) =>
      this.request<Operator>(`/api/v1/master/operators/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    deleteOperator: (id: string) =>
      this.request<{ success: boolean; message: string }>(`/api/v1/master/operators/${id}`, {
        method: 'DELETE',
      }),

    // Shifts
    getShifts: () => this.request<Shift[]>('/api/v1/master/shifts'),

    // Downtime Reasons
    getDowntimeReasons: () => this.request<DowntimeReason[]>('/api/v1/master/downtime-reasons'),
    createDowntimeReason: (body: Omit<DowntimeReason, 'id' | 'tenantId'>) =>
      this.request<DowntimeReason>('/api/v1/master/downtime-reasons', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    updateDowntimeReason: (id: string, body: Partial<Omit<DowntimeReason, 'id' | 'tenantId'>>) =>
      this.request<DowntimeReason>(`/api/v1/master/downtime-reasons/${id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    deleteDowntimeReason: (id: string) =>
      this.request<{ success: boolean; message: string }>(`/api/v1/master/downtime-reasons/${id}`, {
        method: 'DELETE',
      }),

    // Reject Reasons
    getRejectReasons: () => this.request<RejectReason[]>('/api/v1/master/reject-reasons'),
    createRejectReason: (body: Omit<RejectReason, 'id' | 'tenantId'>) =>
      this.request<RejectReason>('/api/v1/master/reject-reasons', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    updateRejectReason: (id: string, body: Partial<Omit<RejectReason, 'id' | 'tenantId'>>) =>
      this.request<RejectReason>(`/api/v1/master/reject-reasons/${id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    deleteRejectReason: (id: string) =>
      this.request<{ success: boolean; message: string }>(`/api/v1/master/reject-reasons/${id}`, {
        method: 'DELETE',
      }),

    // PRD v1.3: User Management & Access Control
    getUsers: () => this.request<AppUser[]>('/api/v1/master/users'),
    getUser: (id: string) => this.request<AppUser>(`/api/v1/master/users/${id}`),
    createUser: (body: Omit<AppUser, 'id' | 'tenantId' | 'createdAt'>) =>
      this.request<AppUser>('/api/v1/master/users', { method: 'POST', body: JSON.stringify(body) }),
    updateUser: (id: string, body: Partial<Omit<AppUser, 'id' | 'tenantId' | 'createdAt'>>) =>
      this.request<AppUser>(`/api/v1/master/users/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    deleteUser: (id: string) =>
      this.request<{ success: boolean; message: string }>(`/api/v1/master/users/${id}`, { method: 'DELETE' }),
    updateUserStatus: (id: string, status: AppUser['status']) =>
      this.request<AppUser>(`/api/v1/master/users/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }),

    // PRD v1.3: Devices & Terminals
    getDevices: () => this.request<DeviceTerminal[]>('/api/v1/master/devices'),
    createDevice: (body: Omit<DeviceTerminal, 'id' | 'tenantId' | 'registeredAt'>) =>
      this.request<DeviceTerminal>('/api/v1/master/devices', { method: 'POST', body: JSON.stringify(body) }),
    updateDevice: (id: string, body: Partial<Omit<DeviceTerminal, 'id' | 'tenantId'>>) =>
      this.request<DeviceTerminal>(`/api/v1/master/devices/${id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    deleteDevice: (id: string) =>
      this.request<{ success: boolean; message: string }>(`/api/v1/master/devices/${id}`, { method: 'DELETE' }),

    /** KPI targets driving the Executive Dashboard's target/variance/status. */
    getKpiTargets: () => this.request<KpiTarget[]>('/api/v1/master/kpi-targets'),
    upsertKpiTarget: (metric: KpiMetric, body: Partial<Omit<KpiTarget, 'id' | 'tenantId' | 'metric'>>) =>
      this.request<KpiTarget>(`/api/v1/master/kpi-targets/${metric}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),

    // Production Processes
    getProcesses: () => this.request<ProductionProcess[]>('/api/v1/master/processes'),
    createProcess: (body: Omit<ProductionProcess, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>) =>
      this.request<ProductionProcess>('/api/v1/master/processes', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    updateProcess: (
      id: string,
      body: Partial<Omit<ProductionProcess, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>>
    ) =>
      this.request<ProductionProcess>(`/api/v1/master/processes/${id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    deleteProcess: (id: string) =>
      this.request<{ success: boolean; message: string }>(`/api/v1/master/processes/${id}`, {
        method: 'DELETE',
      }),

    // Product Routings
    getRoutings: (params?: { productId?: string }) =>
      this.request<ProductRouting[]>(`/api/v1/master/routings${qs(params)}`),
    createRouting: (body: Omit<ProductRouting, 'id' | 'tenantId'>) =>
      this.request<ProductRouting>('/api/v1/master/routings', { method: 'POST', body: JSON.stringify(body) }),
    updateRouting: (id: string, body: Partial<Omit<ProductRouting, 'id' | 'tenantId'>>) =>
      this.request<ProductRouting>(`/api/v1/master/routings/${id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    deleteRouting: (id: string) =>
      this.request<{ success: boolean; message: string }>(`/api/v1/master/routings/${id}`, {
        method: 'DELETE',
      }),

    // Product Machine Rates (Ideal Cycle Time per Product × Machine)
    getProductMachineRates: (params?: { productId?: string; machineId?: string }) =>
      this.request<ProductMachineRate[]>(`/api/v1/master/machine-rates${qs(params)}`),
    upsertProductMachineRate: (body: Omit<ProductMachineRate, 'id' | 'tenantId'>) =>
      this.request<ProductMachineRate>('/api/v1/master/machine-rates', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    deleteProductMachineRate: (id: string) =>
      this.request<{ success: boolean; message: string }>(`/api/v1/master/machine-rates/${id}`, {
        method: 'DELETE',
      }),

    // Batches & Lots
    getBatches: (params?: { productId?: string; status?: string }) =>
      this.request<ProductionBatch[]>(`/api/v1/master/batches${qs(params)}`),
    createBatch: (body: Omit<ProductionBatch, 'id' | 'tenantId' | 'createdAt'>) =>
      this.request<ProductionBatch>('/api/v1/master/batches', { method: 'POST', body: JSON.stringify(body) }),
    updateBatch: (id: string, body: Partial<Omit<ProductionBatch, 'id' | 'tenantId' | 'createdAt'>>) =>
      this.request<ProductionBatch>(`/api/v1/master/batches/${id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
  };

  // Production Orders API
  readonly productionOrders = {
    list: () => this.request<ProductionOrder[]>('/api/v1/production-orders'),
    get: (id: string) => this.request<ProductionOrder>(`/api/v1/production-orders/${id}`),
    create: (body: {
      orderNumber: string;
      productId: string;
      quantity: number;
      dueDate: string;
      createdBy: string;
    }) =>
      this.request<ProductionOrder>('/api/v1/production-orders', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    update: (
      id: string,
      body: Partial<{ orderNumber: string; productId: string; quantity: number; dueDate: string; status: any }>
    ) =>
      this.request<ProductionOrder>(`/api/v1/production-orders/${id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    delete: (id: string) =>
      this.request<{ success: boolean; message: string }>(`/api/v1/production-orders/${id}`, {
        method: 'DELETE',
      }),
    release: (id: string) =>
      this.request<ProductionOrder>(`/api/v1/production-orders/${id}/release`, { method: 'POST' }),
  };

  // Work Orders API
  readonly workOrders = {
    list: (params?: { lineId?: string; status?: string; processId?: string }) => {
      const query = new URLSearchParams(params as Record<string, string>).toString();
      return this.request<WorkOrder[]>(`/api/v1/work-orders${query ? `?${query}` : ''}`);
    },
    get: (id: string) => this.request<WorkOrder>(`/api/v1/work-orders/${id}`),
    create: (body: {
      productionOrderId: string;
      productId: string;
      lineId: string;
      processId?: string;
      sequence?: number;
      batchId?: string;
      workCenterId?: string;
      machineId?: string;
      targetQuantity: number;
      unit?: string;
      priority?: number;
      plannedStart: string;
      plannedEnd: string;
    }) => this.request<WorkOrder>('/api/v1/work-orders', { method: 'POST', body: JSON.stringify(body) }),
    update: (
      id: string,
      body: Partial<{
        productId: string;
        lineId: string;
        processId?: string;
        sequence?: number;
        batchId?: string;
        workCenterId?: string;
        machineId?: string;
        targetQuantity: number;
        unit?: string;
        priority?: number;
        plannedStart: string;
        plannedEnd: string;
        status?: any;
      }>
    ) => this.request<WorkOrder>(`/api/v1/work-orders/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    delete: (id: string) =>
      this.request<{ success: boolean; message: string }>(`/api/v1/work-orders/${id}`, { method: 'DELETE' }),
    release: (id: string) => this.request<WorkOrder>(`/api/v1/work-orders/${id}/release`, { method: 'POST' }),
    start: (id: string, body: { operatorId: string; clientEventId: string; occurredAt: string }) =>
      this.request<WorkOrder>(`/api/v1/work-orders/${id}/start`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    pause: (id: string, body: { clientEventId?: string; occurredAt?: string }) =>
      this.request<WorkOrder>(`/api/v1/work-orders/${id}/pause`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    resume: (id: string, body: { clientEventId?: string; occurredAt?: string }) =>
      this.request<WorkOrder>(`/api/v1/work-orders/${id}/resume`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    complete: (id: string, body: { clientEventId?: string; occurredAt: string }) =>
      this.request<WorkOrder>(`/api/v1/work-orders/${id}/complete`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    cancel: (id: string) => this.request<WorkOrder>(`/api/v1/work-orders/${id}/cancel`, { method: 'POST' }),
  };

  // Shop Floor Execution API
  readonly shopFloor = {
    recordOutput: (body: {
      workOrderId: string;
      machineId: string;
      operatorId: string;
      shiftId: string;
      goodQuantity: number;
      rejectQuantity: number;
      rejectReasonId?: string;
      clientEventId: string;
      occurredAt: string;
      notes?: string;
    }) =>
      this.request<ProductionRecord>('/api/v1/shop-floor/output', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    recordDowntime: (body: {
      machineId: string;
      lineId: string;
      workOrderId?: string;
      reasonId: string;
      notes?: string;
      clientEventId: string;
      occurredAt: string;
      isPlanned?: boolean;
    }) =>
      this.request<DowntimeRecord>('/api/v1/shop-floor/downtime/start', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    resolveDowntime: (downtimeId: string, body: { clientEventId: string; occurredAt: string }) =>
      this.request<DowntimeRecord>(`/api/v1/shop-floor/downtime/${downtimeId}/resolve`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    getDowntimes: (params?: { lineId?: string }) => {
      const query = new URLSearchParams(params as Record<string, string>).toString;
      return this.request<DowntimeRecord[]>(`/api/v1/shop-floor/downtime${query ? `?${query}` : ''}`);
    },
    syncBatch: (commands: unknown[]) =>
      this.request<{ processed: number; failed: number }>('/api/v1/shop-floor/sync-batch', {
        method: 'POST',
        body: JSON.stringify({ commands }),
      }),
  };

  // Analytics API
  readonly analytics = {
    getLiveProductionBoard: () =>
      this.request<
        Array<{
          lineId: string;
          workOrder: WorkOrder;
          achievementPct: number;
          hasActiveDowntime: boolean;
          oee: number;
          availability: number;
          performance: number;
          quality: number;
        }>
      >('/api/v1/analytics/live-board'),
    getDowntimePareto: (params?: { lineId?: string }) => {
      const query = new URLSearchParams(params as Record<string, string>).toString;
      return this.request<DowntimeParetoItem[]>(`/api/v1/analytics/downtime-pareto${query ? `?${query}` : ''}`);
    },

    // --- Executive Dashboard ---

    /**, the eight KPI cards, with target, variance and previous-period delta. */
    getExecutiveKpi: (params?: { days?: number }) =>
      this.request<ExecutiveKpi[]>(`/api/v1/analytics/executive-kpi${qs(params)}`),

    /**, target vs actual over time, with the preceding window overlaid. */
    getProductionTrend: (params?: { days?: number }) =>
      this.request<ProductionTrendPoint[]>(`/api/v1/analytics/production-trend${qs(params)}`),

    /**, OEE actual vs target vs previous period. */
    getOeeTrend: (params?: { days?: number }) =>
      this.request<OeeTrendPoint[]>(`/api/v1/analytics/oee-trend${qs(params)}`),

    /**, per-line comparison with Good / Watch / Critical status. */
    getLinePerformance: (params?: { days?: number }) =>
      this.request<LinePerformanceRow[]>(`/api/v1/analytics/line-performance${qs(params)}`),

    /** Plant rollup of line performance. */
    getPlantPerformance: (params?: { days?: number }) =>
      this.request<PlantPerformanceRow[]>(`/api/v1/analytics/plant-performance${qs(params)}`),

    /** Multi-process performance breakdown (Mixing, Building, Curing, etc.). */
    getProcessPerformance: (params?: { days?: number }) =>
      this.request<ProcessPerformanceRow[]>(`/api/v1/analytics/process-performance${qs(params)}`),

    /**, loss overview, Pareto, by line, and the worst machines. */
    getDowntimeSummary: (params?: { days?: number }) =>
      this.request<DowntimeSummary>(`/api/v1/analytics/downtime-summary${qs(params)}`),

    /**, defect Pareto, ranked by reject quantity. */
    getRejectPareto: (params?: { lineId?: string }) =>
      this.request<RejectParetoItem[]>(`/api/v1/analytics/reject-pareto${qs(params)}`),

    /**, reject rate and quality against target, plus the defect Pareto. */
    getQualitySummary: (params?: { days?: number }) =>
      this.request<QualitySummary>(`/api/v1/analytics/quality-summary${qs(params)}`),

    /**, schedule health and the orders that need attention. */
    getOrderStatus: () => this.request<OrderStatusSummary>('/api/v1/analytics/order-status'),

    /**, the exception layer, each alert carrying its drill-down route. */
    getAlerts: (params?: { days?: number }) =>
      this.request<OperationalAlert[]>(`/api/v1/analytics/alerts${qs(params)}`),

    /** The daily aggregate every trend above is built from. */
    getDailyPerformance: (params?: { days?: number }) =>
      this.request<DailyPerformancePoint[]>(`/api/v1/analytics/daily-performance${qs(params)}`),
  };

  // Reporting & Export API
  readonly reports = {
    getProduction: (params?: { lineId?: string; shiftDate?: string }) => {
      const query = new URLSearchParams(params as Record<string, string>).toString;
      return this.request<ProductionReportItem[]>(`/api/v1/reports/production${query ? `?${query}` : ''}`);
    },
    getDowntime: (params?: { lineId?: string }) => {
      const query = new URLSearchParams(params as Record<string, string>).toString;
      return this.request<DowntimeReportItem[]>(`/api/v1/reports/downtime${query ? `?${query}` : ''}`);
    },
    getShift: (params?: { shiftDate?: string }) => {
      const query = new URLSearchParams(params as Record<string, string>).toString;
      return this.request<ShiftReportItem[]>(`/api/v1/reports/shift${query ? `?${query}` : ''}`);
    },
    getCsvUrl: (type: 'production' | 'downtime' | 'shift', params?: Record<string, string>) => {
      const query = new URLSearchParams({ ...params, format: 'csv' }).toString;
      return `${this.baseUrl}/api/v1/reports/${type}?${query}`;
    },
  };

  // Data Correction Workflow API
  readonly corrections = {
    list: (status?: CorrectionStatus) => {
      const query = status ? `?status=${status}` : '';
      return this.request<CorrectionRequest[]>(`/api/v1/corrections${query}`);
    },
    create: (body: {
      entityType: string;
      entityId: string;
      shiftDate: string;
      fieldChanges: Record<string, { from: unknown; to: unknown }>;
      reason: string;
      requestedBy: string;
    }) =>
      this.request<CorrectionRequest>('/api/v1/corrections', { method: 'POST', body: JSON.stringify(body) }),
    approve: (id: string, body: { approvedBy: string }) =>
      this.request<CorrectionRequest>(`/api/v1/corrections/${id}/approve`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    reject: (id: string, body: { rejectedBy: string }) =>
      this.request<CorrectionRequest>(`/api/v1/corrections/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  };

  // Audit Logs API
  readonly audit = {
    list: (params?: { entityType?: string; action?: string }) => {
      const query = new URLSearchParams(params as Record<string, string>).toString;
      return this.request<AuditLog[]>(`/api/v1/audit-logs${query ? `?${query}` : ''}`);
    },
  };

  // ============================================================
  // PRD v1.5
  // ============================================================

  /** US-001, US-002, US-005, authentication and session administration. */
  readonly auth = {
    login: (email: string, password: string) =>
      this.request<LoginResponse>('/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }),
    operatorLogin: (employeeNumber: string, pin: string) =>
      this.request<LoginResponse>('/api/v1/auth/operator-login', {
        method: 'POST',
        body: JSON.stringify({ employeeNumber, pin }),
      }),
    session: () =>
      this.request<{ principal: SessionPrincipal; user?: AppUser; operator?: Operator }>(
        '/api/v1/auth/session'
      ),
    logout: () => this.request<{ success: boolean }>('/api/v1/auth/logout', { method: 'POST' }),

    listSessions: (params?: { subjectId?: string }) =>
      this.request<SessionSummary[]>(`/api/v1/sessions${qs(params)}`),
    revokeSession: (sessionId: string) =>
      this.request<{ success: boolean; revoked: number }>(`/api/v1/sessions/${sessionId}`, {
        method: 'DELETE',
      }),
    revokeUserSessions: (subjectId: string) =>
      this.request<{ success: boolean; revoked: number }>(`/api/v1/sessions${qs({ subjectId })}`, {
        method: 'DELETE',
      }),
    setUserPassword: (userId: string, password: string) =>
      this.request<{ success: boolean; message: string }>(`/api/v1/users/${userId}/password`, {
        method: 'POST',
        body: JSON.stringify({ password }),
      }),
    setOperatorPin: (operatorId: string, pin: string) =>
      this.request<{ success: boolean; message: string }>(`/api/v1/operators/${operatorId}/pin`, {
        method: 'POST',
        body: JSON.stringify({ pin }),
      }),
  };

  /** US-006, roles and the permission catalogue. */
  readonly rbac = {
    getPermissions: () => this.request<PermissionDefinition[]>('/api/v1/permissions'),
    getRoles: () => this.request<RoleDefinition[]>('/api/v1/roles'),
    getRole: (id: string) => this.request<RoleDefinition>(`/api/v1/roles/${id}`),
    createRole: (body: {
      key: string;
      name: string;
      description?: string;
      permissions: string[];
      landingPath?: string;
    }) => this.request<RoleDefinition>('/api/v1/roles', { method: 'POST', body: JSON.stringify(body) }),
    updateRole: (
      id: string,
      body: { name?: string; description?: string; permissions?: string[]; landingPath?: string }
    ) => this.request<RoleDefinition>(`/api/v1/roles/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    deleteRole: (id: string) =>
      this.request<{ success: boolean; message: string }>(`/api/v1/roles/${id}`, { method: 'DELETE' }),
  };

  /** US-007, work centres complete the plant hierarchy. */
  readonly workCenters = {
    list: () => this.request<WorkCenter[]>('/api/v1/master/work-centers'),
    create: (body: Omit<WorkCenter, 'id' | 'tenantId'>) =>
      this.request<WorkCenter>('/api/v1/master/work-centers', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: string, body: Partial<Omit<WorkCenter, 'id' | 'tenantId'>>) =>
      this.request<WorkCenter>(`/api/v1/master/work-centers/${id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    delete: (id: string) =>
      this.request<{ success: boolean; message: string }>(`/api/v1/master/work-centers/${id}`, {
        method: 'DELETE',
      }),
  };

  /**
   * MES-006, the mould register, and the compatibility ADR-36 reads.
   *
   * `list({ productId })` is the query the Work Order form asks: ADR-36 makes a
   * mould mandatory exactly when a product has at least one active
   * compatibility, so an empty answer means "this product needs no mould"
   * rather than "no mould available".
   */
  readonly molds = {
    list: (params?: { status?: string; search?: string; productId?: string; machineId?: string }) =>
      this.request<Mold[]>(`/api/v1/molds${qs(params)}`),
    get: (id: string) =>
      this.request<Mold & { compatibilities: MoldCompatibility[] }>(`/api/v1/molds/${id}`),
    create: (body: {
      code: string;
      name: string;
      cavityCount: number;
      status?: string;
      currentMachineId?: string | null;
    }) => this.request<Mold>('/api/v1/molds', { method: 'POST', body: JSON.stringify(body) }),
    update: (
      id: string,
      body: {
        code?: string;
        name?: string;
        cavityCount?: number;
        status?: string;
        currentMachineId?: string | null;
      }
    ) => this.request<Mold>(`/api/v1/molds/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    delete: (id: string) => this.request<void>(`/api/v1/molds/${id}`, { method: 'DELETE' }),

    listCompatibilities: (moldId: string, params?: { activeOnly?: boolean }) =>
      this.request<MoldCompatibility[]>(`/api/v1/molds/${moldId}/compatibilities${qs(params)}`),
    addCompatibility: (moldId: string, productId: string) =>
      this.request<MoldCompatibility>(`/api/v1/molds/${moldId}/compatibilities`, {
        method: 'POST',
        body: JSON.stringify({ productId }),
      }),
    setCompatibilityActive: (moldId: string, compatibilityId: string, active: boolean) =>
      this.request<MoldCompatibility>(
        `/api/v1/molds/${moldId}/compatibilities/${compatibilityId}`,
        { method: 'PATCH', body: JSON.stringify({ active }) }
      ),
    removeCompatibility: (moldId: string, compatibilityId: string) =>
      this.request<void>(`/api/v1/molds/${moldId}/compatibilities/${compatibilityId}`, {
        method: 'DELETE',
      }),
  };

  /**
   * Sync exceptions (MES-082).
   *
   * The list defaults to OPEN server-side, so a supervisor opening the screen
   * sees what still needs attention rather than every failure ever recorded.
   */
  readonly syncExceptions = {
    list: (params?: {
      lineId?: string;
      shiftDate?: string;
      status?: string;
      workOrderId?: string;
    }) => this.request<SyncExceptionRecord[]>(`/api/v1/shop-floor/sync-exceptions${qs(params)}`),
    summary: () =>
      this.request<SyncExceptionSummaryRow[]>('/api/v1/shop-floor/sync-exceptions/summary'),
    setStatus: (id: string, status: 'RESOLVED' | 'IGNORED' | 'OPEN', note?: string) =>
      this.request<SyncExceptionRecord>(`/api/v1/shop-floor/sync-exceptions/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status, note }),
      }),
  };

  /** US-021, US-022, US-023, shift configuration, performance and handover. */
  readonly shifts = {
    list: () => this.request<Shift[]>('/api/v1/shifts'),
    create: (body: Omit<Shift, 'id' | 'tenantId' | 'crossesMidnight'>) =>
      this.request<Shift>('/api/v1/shifts', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: string, body: Partial<Omit<Shift, 'id' | 'tenantId'>>) =>
      this.request<Shift>(`/api/v1/shifts/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    delete: (id: string) =>
      this.request<{ success: boolean; message: string }>(`/api/v1/shifts/${id}`, { method: 'DELETE' }),

    performance: (params?: { lineId?: string; shiftId?: string; shiftDate?: string }) =>
      this.request<ShiftHandoverContext[]>(`/api/v1/shifts/performance${qs(params)}`),

    handoverContext: (params: { lineId: string; shiftId?: string; shiftDate?: string }) =>
      this.request<ShiftHandoverContext>(`/api/v1/shifts/handover/context${qs(params)}`),
    listHandovers: (params?: { lineId?: string; shiftDate?: string }) =>
      this.request<ShiftHandoverRecord[]>(`/api/v1/shifts/handover${qs(params)}`),
    createHandover: (body: {
      lineId: string;
      shiftId: string;
      shiftDate: string;
      notes: string;
      openIssues?: string[];
      incomingSupervisorId?: string;
      incomingSupervisorName?: string;
    }) =>
      this.request<ShiftHandoverRecord>('/api/v1/shifts/handover', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    acknowledgeHandover: (id: string) =>
      this.request<ShiftHandoverRecord>(`/api/v1/shifts/handover/${id}/acknowledge`, { method: 'POST' }),
  };

  /** US-025, US-027, US-032-US-037, US-041, OEE engine surfaces. */
  readonly oee = {
    getConfig: () => this.request<OeeCalculationConfig>('/api/v1/oee/config'),
    updateConfig: (body: {
      pptExcludesPlannedDowntime?: boolean;
      idealCycleSource?: 'PRODUCT_MACHINE' | 'ROUTING' | 'PRODUCT';
      allowIdealCycleFallback?: boolean;
    }) =>
      this.request<OeeCalculationConfig>('/api/v1/oee/config', { method: 'PUT', body: JSON.stringify(body) }),

    machinePerformance: (params?: OeeQuery) =>
      this.request<MachinePerformanceRow[]>(`/api/v1/oee/machine-performance${qs(params)}`),

    bottlenecks: (params?: OeeQuery & { kind?: 'PROCESS' | 'MACHINE' }) =>
      this.request<BottleneckRow[]>(`/api/v1/oee/bottlenecks${qs(params)}`),

    targetVsActual: (params?: OeeQuery & { dimension?: TargetVsActualDimension }) =>
      this.request<TargetVsActualSummary>(`/api/v1/oee/target-vs-actual${qs(params)}`),

    report: (params?: OeeQuery) => this.request<OeeReportItem[]>(`/api/v1/oee/report${qs(params)}`),
    reportCsv: (params?: OeeQuery) => this.requestText(`/api/v1/oee/report${qs({ ...params, format: 'csv' })}`),

    validation: () =>
      this.request<{
        entries: OeeValidationEntry[];
        gate: { passed: boolean; open: OeeValidationItem[] };
        config: OeeCalculationConfig;
      }>('/api/v1/oee/validation'),
    updateValidation: (
      item: OeeValidationItem,
      body: Partial<{
        scopeLabel: string;
        shiftDate: string;
        mesValue: number;
        factoryValue: number;
        gapClass: OeeValidationEntry['gapClass'];
        status: OeeValidationEntry['status'];
        resolution: string;
        resolvedByConfigChange: boolean;
        notes: string;
      }>
    ) =>
      this.request<OeeValidationEntry>(`/api/v1/oee/validation/${item}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
  };

  /** US-008, CSV import / export. */
  readonly csv = {
    entities: () => this.request<Array<{ entity: CsvEntity; label: string }>>('/api/v1/csv/entities'),
    template: (entity: CsvEntity) => this.request<CsvTemplate>(`/api/v1/csv/${entity}/template`),
    exportCsv: (entity: CsvEntity) => this.requestText(`/api/v1/csv/${entity}/export`),
    import: (entity: CsvEntity, content: string, opts: { dryRun?: boolean } = {}) =>
      this.request<CsvImportResult>(`/api/v1/csv/${entity}/import`, {
        method: 'POST',
        body: JSON.stringify({ content, dryRun: opts.dryRun ?? false }),
      }),
  };

  /** US-013, batch/lot attachment, and US-052/053 deployment info. */
  readonly platform = {
    attachBatch: (workOrderId: string, batchId: string) =>
      this.request<WorkOrder>(`/api/v1/work-orders/${workOrderId}/batch`, {
        method: 'POST',
        body: JSON.stringify({ batchId }),
      }),
    deployment: () => this.request<DeploymentInfo>('/api/v1/meta/deployment'),
    correctionPolicy: (shiftDate?: string) =>
      this.request<{
        windowHours: number;
        shiftDate: string;
        closed: boolean;
        withinWindow: boolean;
        hoursElapsed: number;
        canApprove: boolean;
        correctableFields: Record<string, string[]>;
      }>(`/api/v1/corrections/policy${qs({ shiftDate })}`),
  };

  /**
   * Demand and planning (MES Improvement v1.0, Sprints 3-6).
   *
   * Grouped rather than flattened onto the client so a screen imports the one
   * area it works in, and so the planning surface stays visibly separate from
   * shop-floor execution - the same boundary the API enforces (MES-019).
   */
  readonly planning = {
    // --- Customer master (MES-029) ---------------------------------
    getCustomers: (params?: { status?: string; search?: string; activeOnly?: boolean }) =>
      this.request<Customer[]>(`/api/v1/customers${qs(params)}`),
    getCustomer: (id: string) => this.request<Customer>(`/api/v1/customers/${id}`),
    createCustomer: (body: Omit<Customer, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>) =>
      this.request<Customer>('/api/v1/customers', { method: 'POST', body: JSON.stringify(body) }),
    updateCustomer: (id: string, body: Partial<Omit<Customer, 'id' | 'tenantId'>>) =>
      this.request<Customer>(`/api/v1/customers/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

    // --- Customer Order (MES-021, MES-022, MES-024, MES-026) -------
    getOrders: (params?: {
      status?: string;
      customerId?: string;
      productId?: string;
      deliveryFrom?: string;
      deliveryTo?: string;
      search?: string;
    }) => this.request<CustomerOrderDetailView[]>(`/api/v1/customer-orders${qs(params)}`),
    getOrder: (id: string) => this.request<CustomerOrderDetailView>(`/api/v1/customer-orders/${id}`),
    createOrder: (body: CreateCustomerOrderBody) =>
      this.request<CustomerOrderDetailView>('/api/v1/customer-orders', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    updateOrder: (id: string, body: Partial<Omit<CreateCustomerOrderBody, 'lines'>>) =>
      this.request<CustomerOrderDetailView>(`/api/v1/customer-orders/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    addOrderLine: (orderId: string, body: CreateCustomerOrderLineBody) =>
      this.request<CustomerOrderLine>(`/api/v1/customer-orders/${orderId}/lines`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    updateOrderLine: (orderId: string, lineId: string, body: Partial<CreateCustomerOrderLineBody>) =>
      this.request<CustomerOrderLine>(`/api/v1/customer-orders/${orderId}/lines/${lineId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    removeOrderLine: (orderId: string, lineId: string) =>
      this.request<{ success: boolean }>(`/api/v1/customer-orders/${orderId}/lines/${lineId}`, {
        method: 'DELETE',
      }),
    cancelOrder: (id: string, reason: string) =>
      this.request<CustomerOrder>(`/api/v1/customer-orders/${id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }),
    setOrderLogisticsStatus: (id: string, status: CustomerOrderStatus) =>
      this.request<CustomerOrder>(`/api/v1/customer-orders/${id}/logistics-status`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      }),

    // --- Documents (MES-025) ---------------------------------------
    getOrderDocuments: (orderId: string) =>
      this.request<CustomerOrderDocumentRef[]>(`/api/v1/customer-orders/${orderId}/documents`),
    /** `content` is base64; the bytes go to storage, never into a table. */
    attachOrderDocument: (
      orderId: string,
      body: { fileName: string; contentType: string; sizeBytes: number; content: string }
    ) =>
      this.request<CustomerOrderDocumentRef>(`/api/v1/customer-orders/${orderId}/documents`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    removeOrderDocument: (orderId: string, documentId: string) =>
      this.request<{ success: boolean }>(
        `/api/v1/customer-orders/${orderId}/documents/${documentId}`,
        { method: 'DELETE' }
      ),

    // --- Demand Forecast (MES-027, MES-028, MES-030) ---------------
    getForecasts: (params?: { status?: string }) =>
      this.request<DemandForecast[]>(`/api/v1/demand-forecasts${qs(params)}`),
    getForecast: (id: string) =>
      this.request<
        DemandForecast & {
          lines: DemandForecastLine[];
          usedByPlans: { productionPlanId: string; planNumber: string; status: string }[];
        }
      >(`/api/v1/demand-forecasts/${id}`),
    getForecastComparison: (id: string) =>
      this.request<DemandForecastComparison>(`/api/v1/demand-forecasts/${id}/comparison`),
    /** Returns 202 and a job id: the aggregation runs on the worker (MES-027). */
    generateForecast: (body: {
      periodStart: string;
      periodEnd: string;
      lookbackMonths: 3 | 6 | 12;
      productIds?: string[];
      perCustomer?: boolean;
    }) =>
      this.request<{ jobId: string; status: string; message: string }>(
        '/api/v1/demand-forecasts/generate',
        { method: 'POST', body: JSON.stringify(body) }
      ),
    getForecastJob: (jobId: string) =>
      this.request<PlanningJobView>(`/api/v1/demand-forecasts/jobs/${jobId}`),
    getForecastJobs: () => this.request<PlanningJobView[]>('/api/v1/demand-forecasts/jobs'),

    // --- Capacity (MES-031..MES-034) -------------------------------
    getCapacityPlans: (params?: { status?: string }) =>
      this.request<CapacityPlan[]>(`/api/v1/capacity-plans${qs(params)}`),
    getCurrentCapacityPlan: (periodStart?: string) =>
      this.request<{ periodStart: string; plan: CapacityPlan | null; lines: CapacityPlanLine[] }>(
        `/api/v1/capacity-plans/current${qs({ periodStart })}`
      ),
    getCapacityPlan: (id: string) =>
      this.request<CapacityPlan & { lines: CapacityPlanLine[] }>(`/api/v1/capacity-plans/${id}`),
    computeCapacityPlan: (body: {
      periodStart: string;
      periodEnd: string;
      planningUtilizationPct?: number;
      plantId?: string;
      lineId?: string;
    }) =>
      this.request<CapacityPlan & { lines: CapacityPlanLine[] }>('/api/v1/capacity-plans', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    recalculateCapacityPlan: (id: string) =>
      this.request<{ jobId: string; status: string; message: string }>(
        `/api/v1/capacity-plans/${id}/recalculate`,
        { method: 'POST' }
      ),
    /** Capacity for one product and quantity, without writing a snapshot. */
    assessCapacity: (params: {
      productId: string;
      periodStart: string;
      periodEnd: string;
      demandQuantity: number;
    }) => this.request<CapacityAssessment>(`/api/v1/capacity-plans/assess${qs(params)}`),

    // --- Production Plan (MES-035..MES-043) ------------------------
    getPlans: (params?: { status?: string; periodStart?: string; periodEnd?: string }) =>
      this.request<ProductionPlan[]>(`/api/v1/production-plans${qs(params)}`),
    getPlan: (id: string) =>
      this.request<ProductionPlan & { lines: ProductionPlanLine[]; demands: ProductionPlanDemand[] }>(
        `/api/v1/production-plans/${id}`
      ),
    createPlan: (body: {
      periodStart: string;
      periodEnd: string;
      demandForecastId?: string;
      capacityPlanId?: string;
    }) =>
      this.request<ProductionPlan & { lines: ProductionPlanLine[]; demands: ProductionPlanDemand[] }>(
        '/api/v1/production-plans',
        { method: 'POST', body: JSON.stringify(body) }
      ),
    /** `version` is mandatory: the wizard is optimistically locked (MES-039-3). */
    updatePlan: (
      id: string,
      version: number,
      body: {
        periodStart?: string;
        periodEnd?: string;
        demandForecastId?: string;
        capacityPlanId?: string;
        wizardStep?: number;
        wizardState?: Record<string, unknown>;
      }
    ) =>
      this.request<ProductionPlan & { lines: ProductionPlanLine[]; demands: ProductionPlanDemand[] }>(
        `/api/v1/production-plans/${id}`,
        { method: 'PATCH', body: JSON.stringify({ ...body, version }) }
      ),
    getPlanWizard: (id: string) =>
      this.request<ProductionPlanWizardState>(`/api/v1/production-plans/${id}/wizard`),
    getPlanLines: (id: string) =>
      this.request<ProductionPlanLine[]>(`/api/v1/production-plans/${id}/lines`),
    updatePlanLine: (
      planId: string,
      lineId: string,
      body: { plannedQuantity?: number; priority?: number; requiredDeliveryDate?: string }
    ) =>
      this.request<ProductionPlanLine>(`/api/v1/production-plans/${planId}/lines/${lineId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    getPlanDemand: (id: string) =>
      this.request<ProductionPlanDemandBreakdown[]>(`/api/v1/production-plans/${id}/demand`),
    addPlanDemand: (id: string, body: { customerOrderLineId: string; demandQuantity?: number }) =>
      this.request<{ line: ProductionPlanLine; demand: ProductionPlanDemand }>(
        `/api/v1/production-plans/${id}/demand`,
        { method: 'POST', body: JSON.stringify(body) }
      ),
    removePlanDemand: (id: string, demandId: string) =>
      this.request<{ success: boolean }>(`/api/v1/production-plans/${id}/demand/${demandId}`, {
        method: 'DELETE',
      }),
    generateWorkOrders: (id: string) =>
      this.request<{
        productionPlanId: string;
        created: WorkOrder[];
        existing: WorkOrder[];
        skippedPlanLineIds: string[];
        createdCount: number;
        existingCount: number;
        message: string;
      }>(`/api/v1/production-plans/${id}/generate-work-orders`, { method: 'POST' }),
    confirmPlan: (id: string) =>
      this.request<ProductionPlan & { lines: ProductionPlanLine[] }>(
        `/api/v1/production-plans/${id}/confirm`,
        { method: 'POST' }
      ),
    cancelPlan: (id: string, reason: string) =>
      this.request<ProductionPlan>(`/api/v1/production-plans/${id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }),

    // --- Work Order traceability (MES-018, ADR-22) -----------------
    getWorkOrderChain: (workOrderId: string) =>
      this.request<ProcessChainView>(`/api/v1/work-orders/${workOrderId}/chain`),
    getWorkOrderDemand: (workOrderId: string) =>
      this.request<WorkOrderDemandTrace>(`/api/v1/work-orders/${workOrderId}/demand`),
    getWorkOrderAvailableQuantity: (workOrderId: string) =>
      this.request<{
        workOrderId: string;
        availableQuantity: number;
        inputs: { predecessorTransferred: number; ownInput: number };
        isFirstProcess: boolean;
      }>(`/api/v1/work-orders/${workOrderId}/available-quantity`),

    // --- Policy (S13, S45.6) ---------------------------------------
    getConfig: () => this.request<PlanningConfig>('/api/v1/planning/config'),
    updateConfig: (body: { planningUtilizationPct?: number; strictProcessSequence?: boolean }) =>
      this.request<PlanningConfig>('/api/v1/planning/config', {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
  };

  /** US-046, the offline queue drain, with per-command results. */
  syncOfflineBatch(commands: unknown[]): Promise<SyncBatchResult> {
    return this.request<SyncBatchResult>('/api/v1/shop-floor/sync-batch', {
      method: 'POST',
      body: JSON.stringify({ commands }),
    });
  }
}

/**
 * Filter contract shared by every OEE and analytics drill-down.
 *
 * The index signature lets a query object flow straight into `qs` while the
 * named keys keep call sites honest about what the API understands.
 */
export interface OeeQuery {
  days?: number;
  from?: string;
  to?: string;
  lineId?: string;
  processId?: string;
  machineId?: string;
  shiftId?: string;
  productId?: string;
  [key: string]: string | number | boolean | undefined;
}

/** A Customer Order with its lines and documents, as the API returns it. */
export interface CustomerOrderDetailView extends CustomerOrder {
  lines: CustomerOrderLine[];
  documents: CustomerOrderDocumentRef[];
}

export interface CreateCustomerOrderLineBody {
  productId: string;
  orderedQuantity: number;
  unit?: string;
  modelType?: string;
  requestedDeliveryDate?: string;
}

export interface CreateCustomerOrderBody {
  customerId: string;
  orderChannel: OrderChannel;
  requestedDeliveryDate: string;
  orderDate?: string;
  poNumber?: string;
  customerPic?: string;
  deliveryAddress?: string;
  dockNumber?: string;
  lines?: CreateCustomerOrderLineBody[];
}
