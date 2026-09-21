/**
 * Factory Vision, internal client management contracts.
 *
 * The vendor's own view of its customers: who they are, what they are
 * entitled to, how much they use the product, and who reached into their
 * data. Deliberately separate from the MES domain, because a customer's
 * console must never be able to see or reason about these records.
 */

// ============================================================
// Plans and entitlements
// ============================================================

export interface SubscriptionPlan {
  id: string;
  code: string;
  name: string;
  description: string;
  /** Null means no ceiling, which is how an enterprise agreement is written. */
  maxPlants: number | null;
  maxProductionLines: number | null;
  maxMachines: number | null;
  maxUsers: number | null;
  maxOperators: number | null;
  monthlyPriceIdr: number | null;
  active: boolean;
}

/** The ceilings actually in force, after per-client overrides are applied. */
export interface EffectiveLimits {
  maxPlants: number | null;
  maxProductionLines: number | null;
  maxMachines: number | null;
  maxUsers: number | null;
  maxOperators: number | null;
}

export type ClientLifecycleStatus = 'PROSPECT' | 'TRIAL' | 'ACTIVE' | 'SUSPENDED' | 'CHURNED';
export type SubscriptionStatus = 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | 'ENDED';

export interface ClientSubscription {
  id: string;
  clientId: string;
  planId: string;
  planCode: string;
  planName: string;
  status: SubscriptionStatus;
  startedAt: string;
  renewsAt: string | null;
  endedAt: string | null;
  overrideMaxPlants: number | null;
  overrideMaxProductionLines: number | null;
  overrideMaxMachines: number | null;
  overrideMaxUsers: number | null;
  overrideMaxOperators: number | null;
}

// ============================================================
// Client record
// ============================================================

export interface ClientAccount {
  id: string;
  tenantId: string;
  legalName: string;
  displayName: string;
  industry: string | null;
  city: string | null;
  country: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  accountManager: string | null;
  lifecycleStatus: ClientLifecycleStatus;
  deploymentMode: 'CLOUD_MULTI_TENANT' | 'ON_PREMISE_SINGLE_TENANT';
  onboardedAt: string | null;
  notes: string | null;
  /** The referral code that admitted a trial; null for accounts created by hand. */
  referralCode: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One usage sample. Sampled daily so a churn trend is visible, not just today. */
export interface ClientUsageSnapshot {
  clientId: string;
  capturedOn: string;
  plants: number;
  productionLines: number;
  machines: number;
  products: number;
  users: number;
  operators: number;
  activeUsers7d: number;
  workOrdersCreated: number;
  productionRecords: number;
  downtimeRecords: number;
  terminalsOnline: number;
  lastActivityAt: string | null;
}

/** How a measured count sits against the ceiling the client is entitled to. */
export interface LimitUsage {
  used: number;
  limit: number | null;
  /** Null when there is no ceiling to be a percentage of. */
  utilisationPct: number | null;
  /** True once the count has passed the ceiling; a commercial conversation. */
  exceeded: boolean;
}

export interface ClientLimitReport {
  plants: LimitUsage;
  productionLines: LimitUsage;
  machines: LimitUsage;
  users: LimitUsage;
  operators: LimitUsage;
}

/**
 * A client as the admin console lists them: the record, what they pay for,
 * the latest usage sample, and whether anything needs attention.
 */
export interface ClientOverview {
  client: ClientAccount;
  subscription: ClientSubscription | null;
  limits: EffectiveLimits;
  usage: ClientUsageSnapshot | null;
  limitReport: ClientLimitReport | null;
  /** Days until the subscription renews. Negative once it has lapsed. */
  daysToRenewal: number | null;
  /** Days since anything was recorded. High numbers precede churn. */
  daysSinceActivity: number | null;
  attention: ClientAttention[];
}

export type ClientAttentionKind =
  | 'LIMIT_EXCEEDED'
  | 'RENEWAL_DUE'
  | 'SUBSCRIPTION_LAPSED'
  | 'NO_RECENT_ACTIVITY'
  | 'TRIAL_ENDING'
  | 'SUPPORT_ACCESS_OPEN';

export interface ClientAttention {
  kind: ClientAttentionKind;
  severity: 'CRITICAL' | 'WARNING' | 'INFORMATIONAL';
  message: string;
}

// ============================================================
// Support access
// ============================================================

export interface SupportAccessGrant {
  id: string;
  clientId: string;
  grantedTo: string;
  grantedBy: string;
  reason: string;
  accessLevel: 'READ_ONLY' | 'READ_WRITE';
  grantedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  revokedBy: string | null;
  lastUsedAt: string | null;
  useCount: number;
  /** Derived: not revoked and not yet expired. */
  active: boolean;
}

// ============================================================
// Internal staff and audit
// ============================================================

export type InternalRole = 'OWNER' | 'ACCOUNT_MANAGER' | 'SUPPORT';

export interface InternalUser {
  id: string;
  email: string;
  name: string;
  role: InternalRole;
  status: 'ACTIVE' | 'SUSPENDED';
  lastLoginAt: string | null;
  createdAt: string;
}

/**
 * A referral code gates the public trial form: no code, no workspace. Issued
 * from the internal console to someone the team has actually spoken to.
 */
export interface ReferralCode {
  id: string;
  /** FV-XXXX-XXXX, from an alphabet without 0/O and 1/I. */
  code: string;
  /** Who or what it was issued for. */
  label: string;
  createdBy: string;
  createdAt: string;
  /** null never expires. */
  expiresAt: string | null;
  maxUses: number;
  useCount: number;
  lastUsedAt: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
  /** Derived: not revoked, not expired, and with registrations left. */
  active: boolean;
}

/** Settings the public landing page reads at load; edited from the internal console. */
export interface SiteSettings {
  siteName: string;
  siteUrl: string;
  siteDescription: string;
  /** GA4 measurement id, G-XXXXXXXXXX; empty disables the tag. */
  gaMeasurementId: string;
  /** The `content` of Search Console's google-site-verification meta tag. */
  searchConsoleToken: string;
  /** Search Console's HTML-file verification name, googleXXXX.html. */
  searchConsoleFile: string;
  updatedAt: string;
  updatedBy: string;
}

export type CmsArticleStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

/** A Markdown article the API renders at /blog/<slug>. */
export interface CmsArticle {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  coverImageUrl: string | null;
  bodyMarkdown: string;
  status: CmsArticleStatus;
  authorName: string | null;
  seoTitle: string | null;
  publishedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedBy: string | null;
  updatedAt: string;
}

export interface InternalAuditEntry {
  id: number;
  actorEmail: string;
  action: string;
  entityType: string;
  entityId: string | null;
  clientId: string | null;
  previousValue: unknown;
  newValue: unknown;
  ip: string | null;
  occurredAt: string;
}

/** The portfolio summary the admin dashboard leads with. */
export interface ClientPortfolioSummary {
  totalClients: number;
  byStatus: Record<ClientLifecycleStatus, number>;
  monthlyRecurringIdr: number;
  renewalsDue30d: number;
  clientsOverLimit: number;
  clientsWithoutRecentActivity: number;
  openSupportGrants: number;
}
