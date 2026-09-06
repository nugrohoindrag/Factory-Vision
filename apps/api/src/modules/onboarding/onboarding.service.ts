import { randomUUID } from 'crypto';
import type {
  AppUser,
  FactoryProfileInput,
  FirstWorkflowResult,
  GuidanceState,
  IndustryTemplateInfo,
  IndustryType,
  OnboardingAnalyticsEvent,
  OnboardingProgress,
  OnboardingStepId,
  OnboardingStepState,
  OnboardingStepStatus,
  ProductRouting,
  TrialRegistrationPayload,
  TrialRegistrationResponse,
} from '@factory-vision/domain-types';
import { ApiError } from '../../platform/http/api-error.js';
import { isDatabaseConfigured, withTenant } from '../../platform/db/pool.js';
import { MasterDataService } from '../master-data/master-data.service.js';
import { MasterReferenceRepository } from '../master-data/master-reference.repository.js';
import { AppUserRepository, ShiftRepository } from '../master-data/reference.repository.js';
import { ProductionService } from '../production/production.service.js';
import { ShopFloorService } from '../shopfloor/shopfloor.service.js';
import { AuthService } from '../auth/auth.service.js';
import { hashSecret } from '../auth/credentials.js';
import { INDUSTRY_TEMPLATES } from './industry-templates.js';

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

const DEFAULT_STEPS: Record<OnboardingStepId, Omit<OnboardingStepState, 'id'>> = {
  factory_profile: {
    title: 'Profil Pabrik & Kalender',
    description: 'Konfigurasi nama pabrik, zona waktu, dan kalender shift produksi.',
    status: 'not_started',
  },
  industry_selection: {
    title: 'Pilih Karakteristik Industri',
    description: 'Pilih industri manufaktur spesifik untuk menentukan alur kerja relevan.',
    status: 'not_started',
  },
  template_application: {
    title: 'Terapkan Industry Seed Template',
    description: 'Clone master data starter industri (produk, mesin, proses, routing).',
    status: 'not_started',
  },
  starter_master_data: {
    title: 'Review Master Data Starter',
    description: 'Pastikan produk, mesin, dan work center siap digunakan.',
    status: 'not_started',
  },
  welcome_tour: {
    title: 'Welcome Tour MES',
    description: 'Pelajari 5 pilar navigasi konsol dan terminal shop floor.',
    status: 'not_started',
  },
  first_production_order: {
    title: 'Buat Production Order Pertama',
    description: 'Buat rencana pesanan produksi perdana dengan jumlah target.',
    status: 'not_started',
  },
  first_work_order: {
    title: 'Rilis Work Order',
    description: 'Bagi rencana pesanan ke stasiun mesin dan work center di lantai pabrik.',
    status: 'not_started',
  },
  first_production_run: {
    title: 'Catat Hasil Produksi Shop Floor',
    description: 'Catat jumlah good unit dan reject unit pertama secara real-time.',
    status: 'not_started',
  },
  first_production_result: {
    title: 'Evaluasi KPI Produksi & OEE',
    description: 'Lihat pencapaian target, reject rate, dan dampak langsung pada dashboard.',
    status: 'not_started',
  },
};

export class OnboardingService {
  private readonly masterRepo = new MasterReferenceRepository();
  private readonly userRepo = new AppUserRepository();
  private readonly shiftRepo = new ShiftRepository();

  // In-memory store for onboarding progress & guidance states (keyed by tenantId)
  private readonly progressStore = new Map<string, OnboardingProgress>();
  private readonly guidanceStore = new Map<string, GuidanceState>();
  private readonly analyticsEvents: OnboardingAnalyticsEvent[] = [];

  constructor(
    private masterData: MasterDataService,
    private production: ProductionService,
    private shopFloor: ShopFloorService,
    private auth: AuthService
  ) {}

  // ---------------------------------------------------------
  // 1. FREE TRIAL REGISTRATION
  // ---------------------------------------------------------

  async registerTrial(
    payload: TrialRegistrationPayload,
    clientContext?: { ip?: string; userAgent?: string }
  ): Promise<TrialRegistrationResponse> {
    if (!payload.fullName?.trim()) throw ApiError.validation('Nama lengkap wajib diisi.');
    if (!payload.email?.trim() || !payload.email.includes('@')) throw ApiError.validation('Email tidak valid.');
    if (!payload.password || payload.password.length < 6) {
      throw ApiError.validation('Kata sandi minimal 6 karakter.');
    }
    if (!payload.factoryName?.trim()) throw ApiError.validation('Nama pabrik wajib diisi.');

    const tenantSlug = slug(payload.factoryName).slice(0, 16) || 'factory';
    const tenantId = `tenant-${tenantSlug}-${randomUUID().slice(0, 6)}`;
    const userId = `usr-${randomUUID().slice(0, 8)}`;
    const clientId = `client-${randomUUID().slice(0, 8)}`;
    const subId = `sub-${randomUUID().slice(0, 8)}`;
    const now = new Date();
    const trialEnd = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000); // 14 days

    if (isDatabaseConfigured()) {
      await withTenant(tenantId, async (client) => {
        // 1. Tenant
        await client.query(
          `INSERT INTO tenant (id, name, timezone, plan, status)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (id) DO NOTHING`,
          [tenantId, payload.factoryName, 'Asia/Jakarta', 'TRIAL', 'ACTIVE']
        );

        // 2. Client Account
        await client.query(
          `INSERT INTO client_account
             (id, tenant_id, legal_name, display_name, industry, city, contact_name, contact_email,
              lifecycle_status, deployment_mode, onboarded_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
           ON CONFLICT (tenant_id) DO NOTHING`,
          [
            clientId,
            tenantId,
            payload.factoryName,
            payload.factoryName,
            payload.industry,
            payload.city ?? 'Jakarta',
            payload.fullName,
            payload.email.toLowerCase().trim(),
            'TRIAL',
            'CLOUD_MULTI_TENANT',
          ]
        );

        // 3. Subscription
        await client.query(
          `INSERT INTO client_subscription
             (id, client_id, plan_id, status, started_at, renews_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (id) DO NOTHING`,
          [subId, clientId, 'plan-trial', 'ACTIVE', now.toISOString().slice(0, 10), trialEnd.toISOString().slice(0, 10)]
        );

        // 4. App User (Admin)
        const passwordHash = hashSecret(payload.password);
        await this.userRepo.upsert(
          client,
          {
            id: userId,
            tenantId,
            email: payload.email.toLowerCase().trim(),
            name: payload.fullName,
            role: 'ADMIN',
            accountType: 'APPLICATION',
            scopeLevel: 'TENANT',
            status: 'ACTIVE',
            createdAt: now.toISOString(),
          },
          passwordHash
        );
      });
    }

    // Hydrate caches so user can authenticate immediately
    await this.masterData.hydrate(tenantId);
    this.auth.hydrateCredentials(tenantId);

    // Login user to obtain session token
    const loginRes = await this.auth.login(
      tenantId,
      payload.email.toLowerCase().trim(),
      payload.password,
      clientContext ?? {}
    );

    // Initialise onboarding progress
    const steps: Record<OnboardingStepId, OnboardingStepState> = {} as any;
    for (const [key, val] of Object.entries(DEFAULT_STEPS)) {
      steps[key as OnboardingStepId] = {
        id: key as OnboardingStepId,
        ...val,
      };
    }

    const progress: OnboardingProgress = {
      tenantId,
      userId,
      trialStatus: 'active',
      trialStart: now.toISOString(),
      trialEnd: trialEnd.toISOString(),
      daysRemaining: 14,
      readinessPercent: 0,
      activationPercent: 0,
      factoryProfile: {
        factoryName: payload.factoryName,
        industry: payload.industry,
        country: 'Indonesia',
        city: payload.city ?? 'Jakarta',
        timezone: 'Asia/Jakarta',
        workingCalendar: '2 Shift / 5 Hari Kerja',
      },
      steps,
      updatedAt: now.toISOString(),
    };

    this.progressStore.set(tenantId, progress);
    this.guidanceStore.set(tenantId, {
      tourCompleted: false,
      tourSkipped: false,
      dismissedTooltips: [],
    });

    this.recordAnalyticsEvent({
      eventName: 'signup_completed',
      tenantId,
      userId,
      timestamp: now.toISOString(),
      metadata: { industry: payload.industry, factoryName: payload.factoryName },
    });

    return {
      token: loginRes.token,
      tenantId,
      userId,
      email: payload.email.toLowerCase().trim(),
      fullName: payload.fullName,
      factoryName: payload.factoryName,
      industry: payload.industry,
      trialStart: now.toISOString(),
      trialEnd: trialEnd.toISOString(),
      daysRemaining: 14,
    };
  }

  // ---------------------------------------------------------
  // 2. INDUSTRY SEED TEMPLATES
  // ---------------------------------------------------------

  listTemplates(): IndustryTemplateInfo[] {
    return Object.values(INDUSTRY_TEMPLATES).map((t) => t.info);
  }

  getTemplate(industry: IndustryType) {
    return INDUSTRY_TEMPLATES[industry] || INDUSTRY_TEMPLATES.general;
  }

  // ---------------------------------------------------------
  // 3. TEMPLATE APPLICATION & CLONING
  // ---------------------------------------------------------

  async applyTemplate(
    tenantId: string,
    industry: IndustryType,
    profile?: Partial<FactoryProfileInput>
  ): Promise<{ success: boolean; progress: OnboardingProgress }> {
    const tmpl = this.getTemplate(industry);
    const factoryName = profile?.factoryName || tmpl.defaultPlantName;
    const plantId = `plant-${slug(factoryName).slice(0, 16)}-${randomUUID().slice(0, 4)}`;

    if (isDatabaseConfigured()) {
      await withTenant(tenantId, async (client) => {
        // 1. Plant
        await this.masterRepo.upsertPlant(client, {
          id: plantId,
          tenantId,
          name: factoryName,
          location: profile?.city || 'Kawasan Industri, Indonesia',
          timezone: profile?.timezone || 'Asia/Jakarta',
          status: 'ACTIVE',
        });

        // 2. Lines
        const lineIdMap = new Map<number, string>();
        for (let i = 0; i < tmpl.lines.length; i++) {
          const l = tmpl.lines[i];
          const lineId = `line-${slug(l.code)}-${randomUUID().slice(0, 4)}`;
          lineIdMap.set(i, lineId);
          await this.masterRepo.upsertLine(client, {
            id: lineId,
            tenantId,
            plantId,
            code: l.code,
            name: l.name,
            status: l.status,
            plannedProductionTimeMinutes: l.plannedProductionTimeMinutes,
          });
        }

        // 3. Work Centers
        const wcIdMap = new Map<number, string>();
        for (let i = 0; i < tmpl.workCenters.length; i++) {
          const wc = tmpl.workCenters[i];
          const wcId = `wc-${slug(wc.code)}-${randomUUID().slice(0, 4)}`;
          wcIdMap.set(i, wcId);
          const lineId = lineIdMap.get(wc.lineIndex) || lineIdMap.get(0)!;
          await this.masterRepo.upsertWorkCenter(client, {
            id: wcId,
            tenantId,
            productionLineId: lineId,
            code: wc.code,
            name: wc.name,
            sequence: wc.sequence,
          });
        }

        // 4. Processes
        const procIdMap = new Map<number, string>();
        for (let i = 0; i < tmpl.processes.length; i++) {
          const proc = tmpl.processes[i];
          const procId = `proc-${slug(proc.code)}-${randomUUID().slice(0, 4)}`;
          procIdMap.set(i, procId);
          await this.masterRepo.upsertProcess(client, {
            id: procId,
            tenantId,
            code: proc.code,
            name: proc.name,
            sequenceDefault: proc.sequenceDefault,
            status: proc.status,
          });
        }

        // 5. Machines
        const machineIdMap = new Map<number, string>();
        for (let i = 0; i < tmpl.machines.length; i++) {
          const m = tmpl.machines[i];
          const machineId = `mch-${slug(m.code)}-${randomUUID().slice(0, 4)}`;
          machineIdMap.set(i, machineId);
          const wcId = wcIdMap.get(m.workCenterIndex) || wcIdMap.get(0)!;
          await this.masterRepo.upsertMachine(client, {
            id: machineId,
            tenantId,
            workCenterId: wcId,
            code: m.code,
            name: m.name,
            status: m.status,
            idealCycleTimeSeconds: m.idealCycleTimeSeconds,
            currentState: m.currentState,
            currentStateSince: m.currentStateSince,
          });
        }

        // 6. Products
        const productIdMap = new Map<number, string>();
        for (let i = 0; i < tmpl.products.length; i++) {
          const p = tmpl.products[i];
          const productId = `prod-${slug(p.sku)}-${randomUUID().slice(0, 4)}`;
          productIdMap.set(i, productId);
          await this.masterRepo.upsertProduct(client, {
            id: productId,
            tenantId,
            sku: p.sku,
            name: p.name,
            unit: p.unit,
            idealCycleTimeSeconds: p.idealCycleTimeSeconds,
            status: p.status,
          });
        }

        // 7. Product Routings
        for (let i = 0; i < tmpl.routings.length; i++) {
          const r = tmpl.routings[i];
          const productId = productIdMap.get(r.productIndex);
          const processId = procIdMap.get(r.processIndex);
          const workCenterId = wcIdMap.get(r.workCenterIndex);
          const machineId = machineIdMap.get(r.machineIndex);
          if (productId && processId && workCenterId && machineId) {
            const routing: ProductRouting = {
              id: `rtg-${productId}-${r.sequence}`,
              tenantId,
              productId,
              processId,
              sequence: r.sequence,
              workCenterId,
              machineId,
              standardCycleTimeSeconds: r.standardCycleTimeSeconds,
              active: true,
            };
            await this.masterRepo.upsertRouting(client, routing);
          }
        }

        // 8. Shifts
        for (const s of tmpl.shifts) {
          const shiftId = `shift-${slug(s.name)}-${randomUUID().slice(0, 4)}`;
          await this.shiftRepo.upsert(client, {
            id: shiftId,
            tenantId,
            plantId,
            name: s.name,
            startTime: s.startTime,
            endTime: s.endTime,
            breakMinutes: s.breakMinutes,
            crossesMidnight: s.crossesMidnight,
            active: s.active,
          });
        }

        // 9. Downtime Reasons
        for (const r of tmpl.downtimeReasons) {
          await this.masterRepo.upsertDowntimeReason(client, {
            id: `dtr-${slug(r.code)}-${randomUUID().slice(0, 4)}`,
            tenantId,
            category: r.category,
            code: r.code,
            name: r.name,
            isPlanned: r.isPlanned,
            active: r.active,
            sortOrder: r.sortOrder,
          });
        }

        // 10. Reject Reasons
        for (const r of tmpl.rejectReasons) {
          await this.masterRepo.upsertRejectReason(client, {
            id: `rjr-${slug(r.code)}-${randomUUID().slice(0, 4)}`,
            tenantId,
            category: r.category,
            code: r.code,
            name: r.name,
            active: r.active,
            sortOrder: r.sortOrder,
          });
        }
      });
    }

    // Refresh memory cache in MasterDataService
    await this.masterData.hydrate(tenantId);

    // Pre-create initial sample Production Order so the user can immediately experience the workflow
    try {
      const sampleProd = this.masterData.getProducts(tenantId)[0];
      if (sampleProd) {
        await this.production.createProductionOrder(tenantId, {
          orderNumber: `${tmpl.sampleOrder.orderNumberPrefix}-001`,
          productId: sampleProd.id,
          quantity: tmpl.sampleOrder.quantity,
          dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
          createdBy: 'system-onboarding',
        });
      }
    } catch {
      // Non-fatal if order creation has slight validation mismatch
    }

    // Update progress state
    const progress = await this.getStatus(tenantId);
    progress.experienceType = 'template';
    progress.templateApplied = industry;
    progress.readinessPercent = 70;

    const completedTime = new Date().toISOString();
    progress.steps.factory_profile.status = 'completed';
    progress.steps.factory_profile.completedAt = completedTime;
    progress.steps.industry_selection.status = 'completed';
    progress.steps.industry_selection.completedAt = completedTime;
    progress.steps.template_application.status = 'completed';
    progress.steps.template_application.completedAt = completedTime;
    progress.steps.starter_master_data.status = 'completed';
    progress.steps.starter_master_data.completedAt = completedTime;

    this.progressStore.set(tenantId, progress);

    this.recordAnalyticsEvent({
      eventName: 'industry_template_applied',
      tenantId,
      timestamp: completedTime,
      metadata: { industry, productsCount: tmpl.products.length, machinesCount: tmpl.machines.length },
    });

    return { success: true, progress };
  }

  // ---------------------------------------------------------
  // 4. BLANK FACTORY SETUP
  // ---------------------------------------------------------

  async createBlankFactory(
    tenantId: string,
    profile: FactoryProfileInput
  ): Promise<{ success: boolean; progress: OnboardingProgress }> {
    const plantId = `plant-${slug(profile.factoryName).slice(0, 16)}-${randomUUID().slice(0, 4)}`;

    if (isDatabaseConfigured()) {
      await withTenant(tenantId, async (client) => {
        await this.masterRepo.upsertPlant(client, {
          id: plantId,
          tenantId,
          name: profile.factoryName,
          location: profile.city || 'Indonesia',
          timezone: profile.timezone || 'Asia/Jakarta',
          status: 'ACTIVE',
        });
      });
    }

    await this.masterData.hydrate(tenantId);

    const progress = await this.getStatus(tenantId);
    progress.experienceType = 'blank';
    progress.readinessPercent = 25;
    const now = new Date().toISOString();
    progress.steps.factory_profile.status = 'completed';
    progress.steps.factory_profile.completedAt = now;
    progress.steps.industry_selection.status = 'completed';
    progress.steps.industry_selection.completedAt = now;
    progress.steps.template_application.status = 'skipped';
    progress.steps.template_application.completedAt = now;

    this.progressStore.set(tenantId, progress);

    this.recordAnalyticsEvent({
      eventName: 'blank_factory_selected',
      tenantId,
      timestamp: now,
      metadata: { industry: profile.industry, factoryName: profile.factoryName },
    });

    return { success: true, progress };
  }

  // ---------------------------------------------------------
  // 5. ONBOARDING STATUS & CHECKLIST
  // ---------------------------------------------------------

  async getStatus(tenantId: string, userId?: string): Promise<OnboardingProgress> {
    let progress = this.progressStore.get(tenantId);

    if (!progress) {
      const now = new Date();
      const steps: Record<OnboardingStepId, OnboardingStepState> = {} as any;
      for (const [key, val] of Object.entries(DEFAULT_STEPS)) {
        steps[key as OnboardingStepId] = {
          id: key as OnboardingStepId,
          ...val,
        };
      }

      progress = {
        tenantId,
        userId: userId ?? 'usr-default',
        trialStatus: 'active',
        trialStart: now.toISOString(),
        trialEnd: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        daysRemaining: 14,
        readinessPercent: 0,
        activationPercent: 0,
        steps,
        updatedAt: now.toISOString(),
      };
      this.progressStore.set(tenantId, progress);
    }

    // Calculate dynamic counts from actual data
    const plants = this.masterData.getPlants(tenantId);
    const products = this.masterData.getProducts(tenantId);
    const machines = this.masterData.getMachines(tenantId);
    const lines = this.masterData.getLines(tenantId);
    const workCenters = this.masterData.getWorkCenters(tenantId);

    // Readiness evaluation
    let readiness = 0;
    if (plants.length > 0) readiness += 20;
    if (products.length > 0) readiness += 20;
    if (machines.length > 0 && workCenters.length > 0) readiness += 15;
    if (lines.length > 0) readiness += 15;
    progress.readinessPercent = Math.min(100, Math.max(progress.readinessPercent, readiness));

    // Dynamic activation evaluation
    try {
      const orders = await this.production.getProductionOrders(tenantId);
      const workOrders = await this.production.getWorkOrders(tenantId);

      if (orders.length > 0) {
        progress.steps.first_production_order.status = 'completed';
      }
      if (workOrders.length > 0) {
        progress.steps.first_work_order.status = 'completed';
      }

      let activation = 0;
      if (orders.length > 0) activation += 35;
      if (workOrders.length > 0) activation += 35;
      if (progress.steps.first_production_run.status === 'completed') activation += 15;
      if (progress.steps.first_production_result.status === 'completed') activation += 15;
      progress.activationPercent = Math.min(100, activation);
    } catch {
      // Keep existing
    }

    // Days remaining calculation
    if (progress.trialEnd) {
      const remainingMs = new Date(progress.trialEnd).getTime() - Date.now();
      progress.daysRemaining = Math.max(0, Math.ceil(remainingMs / (1000 * 60 * 60 * 24)));
    }

    return progress;
  }

  updateStep(
    tenantId: string,
    stepId: OnboardingStepId,
    status: OnboardingStepStatus
  ): OnboardingProgress {
    let progress = this.progressStore.get(tenantId);
    if (!progress) {
      throw ApiError.notFound('Data onboarding tidak ditemukan.');
    }

    if (progress.steps[stepId]) {
      progress.steps[stepId].status = status;
      if (status === 'completed') {
        progress.steps[stepId].completedAt = new Date().toISOString();
      }
    }
    progress.updatedAt = new Date().toISOString();
    this.progressStore.set(tenantId, progress);

    this.recordAnalyticsEvent({
      eventName: 'onboarding_step_completed',
      tenantId,
      timestamp: progress.updatedAt,
      metadata: { stepId, status },
    });

    return progress;
  }

  // ---------------------------------------------------------
  // 6. GUIDANCE & WELCOME TOUR PERSISTENCE
  // ---------------------------------------------------------

  getGuidance(tenantId: string): GuidanceState {
    return (
      this.guidanceStore.get(tenantId) ?? {
        tourCompleted: false,
        tourSkipped: false,
        dismissedTooltips: [],
      }
    );
  }

  updateGuidance(tenantId: string, patch: Partial<GuidanceState>): GuidanceState {
    const current = this.getGuidance(tenantId);
    const updated: GuidanceState = {
      ...current,
      ...patch,
      dismissedTooltips: patch.dismissedTooltips
        ? Array.from(new Set([...current.dismissedTooltips, ...patch.dismissedTooltips]))
        : current.dismissedTooltips,
    };
    this.guidanceStore.set(tenantId, updated);

    if (patch.tourCompleted) {
      this.recordAnalyticsEvent({
        eventName: 'welcome_tour_completed',
        tenantId,
        timestamp: new Date().toISOString(),
      });
    }

    return updated;
  }

  // ---------------------------------------------------------
  // 7. FIRST PRODUCTION WORKFLOW & VALUE EXECUTION
  // ---------------------------------------------------------

  async executeFirstWorkflow(
    tenantId: string,
    payload?: {
      productId?: string;
      quantity?: number;
      goodQty?: number;
      rejectQty?: number;
    }
  ): Promise<FirstWorkflowResult> {
    const products = this.masterData.getProducts(tenantId);
    const targetProduct = (payload?.productId ? products.find((p) => p.id === payload.productId) : null) || products[0];
    if (!targetProduct) {
      throw ApiError.validation('Belum ada produk terdaftar untuk menjalankan alur produksi.');
    }

    const plannedQuantity = payload?.quantity ?? 500;
    const goodQuantity = payload?.goodQty ?? Math.round(plannedQuantity * 0.96);
    const rejectQuantity = payload?.rejectQty ?? (plannedQuantity - goodQuantity);

    // 1. Create or resolve Production Order
    const poNumber = `PO-FIRST-${Date.now().toString().slice(-4)}`;
    const po = await this.production.createProductionOrder(tenantId, {
      orderNumber: poNumber,
      productId: targetProduct.id,
      quantity: plannedQuantity,
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      createdBy: 'onboarding-wizard',
    });

    // 2. Release to Work Order
    const routings = this.masterData.getProductRoutings(tenantId);
    await this.production.releaseProductionOrder(tenantId, po.id, routings);

    // Retrieve created work orders
    const allWorkOrders = await this.production.getWorkOrders(tenantId);
    const wo = allWorkOrders.find((w) => w.productionOrderId === po.id) || allWorkOrders[0];
    const woNumber = wo?.woNumber || `${poNumber}-WO1`;

    // 3. Update Step Progress
    const now = new Date().toISOString();
    this.updateStep(tenantId, 'first_production_order', 'completed');
    this.updateStep(tenantId, 'first_work_order', 'completed');
    this.updateStep(tenantId, 'first_production_run', 'completed');
    this.updateStep(tenantId, 'first_production_result', 'completed');

    const achievementRate = Number(((goodQuantity / plannedQuantity) * 100).toFixed(1));
    const defectRate = Number(((rejectQuantity / plannedQuantity) * 100).toFixed(2));

    this.recordAnalyticsEvent({
      eventName: 'production_completed',
      tenantId,
      timestamp: now,
      metadata: {
        orderNumber: poNumber,
        product: targetProduct.name,
        planned: plannedQuantity,
        good: goodQuantity,
        reject: rejectQuantity,
        achievementRate,
      },
    });

    return {
      orderNumber: poNumber,
      woNumber,
      productName: targetProduct.name,
      plannedQuantity,
      producedQuantity: goodQuantity,
      rejectQuantity,
      achievementRate,
      defectRate,
      occurredAt: now,
    };
  }

  // ---------------------------------------------------------
  // 8. ANALYTICS & CONVERSION
  // ---------------------------------------------------------

  recordAnalyticsEvent(event: OnboardingAnalyticsEvent) {
    this.analyticsEvents.push(event);
    if (this.analyticsEvents.length > 500) {
      this.analyticsEvents.shift();
    }
  }

  getAnalyticsEvents(tenantId?: string): OnboardingAnalyticsEvent[] {
    return tenantId ? this.analyticsEvents.filter((e) => e.tenantId === tenantId) : this.analyticsEvents;
  }

  async upgradePlan(tenantId: string, planCode: string): Promise<{ success: boolean; message: string }> {
    const progress = await this.getStatus(tenantId);
    progress.trialStatus = 'converted';
    this.progressStore.set(tenantId, progress);

    this.recordAnalyticsEvent({
      eventName: 'trial_converted',
      tenantId,
      timestamp: new Date().toISOString(),
      metadata: { planCode },
    });

    return {
      success: true,
      message: `Permintaan upgrade ke paket ${planCode.toUpperCase()} telah diterima. Tim sales kami akan segera menghubungi Anda.`,
    };
  }
}
