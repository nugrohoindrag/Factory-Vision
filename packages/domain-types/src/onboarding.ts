/**
 * Factory Vision MES 2.0 — Free Trial & Self Onboarding Domain Types
 * Based on PRD — Factory Vision MES 2.0 Onboarding
 */

export type IndustryType =
  | 'automotive'
  | 'electronics'
  | 'fnb'
  | 'packaging'
  | 'metal-fabrication'
  | 'furniture'
  | 'pharmaceutical'
  | 'chemical'
  | 'general';

export type OnboardingStepId =
  | 'factory_profile'
  | 'industry_selection'
  | 'template_application'
  | 'starter_master_data'
  | 'welcome_tour'
  | 'first_production_order'
  | 'first_work_order'
  | 'first_production_run'
  | 'first_production_result';

export type OnboardingStepStatus = 'not_started' | 'in_progress' | 'completed' | 'skipped';

export type TrialLifecycleStatus = 'active' | 'expired' | 'converted' | 'cancelled';

export interface IndustryTemplateInfo {
  id: string;
  name: string;
  industry: IndustryType;
  version: string;
  description: string;
  status: 'active' | 'draft' | 'deprecated';
  icon: string;
  productsCount: number;
  machinesCount: number;
  workCentersCount: number;
  processesCount: number;
  sampleProducts: string[];
  sampleProcesses: string[];
  highlights: string[];
}

export interface OnboardingStepState {
  id: OnboardingStepId;
  title: string;
  description: string;
  status: OnboardingStepStatus;
  completedAt?: string;
  optional?: boolean;
}

export interface FactoryProfileInput {
  factoryName: string;
  industry: IndustryType;
  country: string;
  city?: string;
  timezone: string;
  workingCalendar: string;
}

/**
 * One thing the trial needs before a bar reaches 100%, with where to do it.
 * The bar's percentage is the sum of `weight` over items that are `done`, so
 * the number and the list can never disagree.
 */
export interface OnboardingChecklistItem {
  id: string;
  label: string;
  /** Points this item contributes; items of one bar sum to 100. */
  weight: number;
  done: boolean;
  /** Console route where the item is completed. */
  path?: string;
  /** One line on what "done" means, for the tooltip. */
  hint?: string;
}

export interface OnboardingProgress {
  tenantId: string;
  userId: string;
  trialStatus: TrialLifecycleStatus;
  trialStart: string;
  trialEnd: string;
  daysRemaining: number;
  readinessPercent: number;
  activationPercent: number;
  /** What readinessPercent is made of; absent only on a very old cache. */
  readinessItems?: OnboardingChecklistItem[];
  /** What activationPercent is made of. */
  activationItems?: OnboardingChecklistItem[];
  experienceType?: 'template' | 'blank' | 'demo';
  templateApplied?: string;
  factoryProfile?: FactoryProfileInput;
  steps: Record<OnboardingStepId, OnboardingStepState>;
  updatedAt: string;
}

export interface GuidanceState {
  tourCompleted: boolean;
  tourSkipped: boolean;
  dismissedTooltips: string[];
  activeTourStep?: number;
}

export interface FirstWorkflowResult {
  orderNumber: string;
  woNumber: string;
  productName: string;
  plannedQuantity: number;
  producedQuantity: number;
  rejectQuantity: number;
  achievementRate: number;
  defectRate: number;
  occurredAt: string;
}

export interface OnboardingAnalyticsEvent {
  eventName:
    | 'signup_started'
    | 'signup_completed'
    | 'factory_created'
    | 'industry_selected'
    | 'industry_template_viewed'
    | 'industry_template_applied'
    | 'blank_factory_selected'
    | 'onboarding_started'
    | 'onboarding_step_started'
    | 'onboarding_step_completed'
    | 'onboarding_skipped'
    | 'onboarding_completed'
    | 'welcome_tour_started'
    | 'welcome_tour_completed'
    | 'welcome_tour_skipped'
    | 'tooltip_viewed'
    | 'tooltip_completed'
    | 'guide_started'
    | 'guide_completed'
    | 'guide_skipped'
    | 'production_order_created'
    | 'work_order_created'
    | 'production_started'
    | 'production_completed'
    | 'upgrade_viewed'
    | 'upgrade_clicked'
    | 'trial_expired'
    | 'trial_converted';
  tenantId?: string;
  userId?: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

/**
 * The public trial form (`POST /auth/trial-register`). The landing page and the
 * API both build from this type, so a renamed field fails at `tsc` on either
 * side instead of as a 422 in production.
 */
export interface TrialRegistrationPayload {
  fullName: string;
  email: string;
  password: string;
  /** The company or plant name; becomes the tenant and client account name. */
  factoryName: string;
  industry: IndustryType;
  city?: string;
  /**
   * Free-text sizing hint from the form ("4-10 Lini Produksi"). Kept on the
   * client account for sales; it shapes nothing in the product.
   */
  plantScale?: string;
}

export interface TrialRegistrationResponse {
  token: string;
  tenantId: string;
  userId: string;
  email: string;
  fullName: string;
  factoryName: string;
  industry: IndustryType;
  trialStart: string;
  trialEnd: string;
  daysRemaining: number;
}
