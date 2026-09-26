import React, { useState, useEffect } from 'react';
import { Routes, Route, Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Icon, StatusBadge } from '@factory-vision/ui';
import { FactoryVisionLogo, FactoryVisionIcon } from '@factory-vision/ui/fv';
import { DashboardPage } from '../features/dashboard/DashboardPage.js';
import { LiveBoardPage } from '../features/live-board/LiveBoardPage.js';
import { WorkOrdersPage } from '../features/work-orders/WorkOrdersPage.js';
import { DowntimeAnalyticsPage } from '../features/downtime/DowntimeAnalyticsPage.js';
import { ReportsPage } from '../features/reports/ReportsPage.js';
import { SettingsPage } from '../features/settings/SettingsPage.js';
import { CorrectionsPage } from '../features/corrections/CorrectionsPage.js';
import { SyncExceptionsPage } from '../features/sync-exceptions/SyncExceptionsPage.js';
import { AuditLogPage } from '../features/audit/AuditLogPage.js';
import { ConsoleAuth, UserSession } from '../features/auth/ConsoleAuth.js';
import { avatarDataUri } from '../features/auth/avatars.js';
import { EditProfileModal } from '../features/auth/EditProfileModal.js';
import { OeeInvestigationPage } from '../features/oee/OeeInvestigationPage.js';
import { BottleneckPage } from '../features/oee/BottleneckPage.js';
import { OeeValidationPage } from '../features/oee/OeeValidationPage.js';
import { TargetVsActualPage } from '../features/target-actual/TargetVsActualPage.js';
import { ShiftHandoverPage } from '../features/shift/ShiftHandoverPage.js';
import { CustomerOrdersPage } from '../features/planning/CustomerOrdersPage.js';
import { CustomerMasterPage } from '../features/planning/CustomerMasterPage.js';
import { DemandForecastPage } from '../features/planning/DemandForecastPage.js';
import { CapacityPlanningPage } from '../features/planning/CapacityPlanningPage.js';
import { ProductionPlansPage } from '../features/planning/ProductionPlansPage.js';
import { ProductionPlanWizardPage } from '../features/planning/ProductionPlanWizardPage.js';
import { MrpPage } from '../features/mes/MrpPage.js';
import { MaterialReadinessPage } from '../features/mes/MaterialReadinessPage.js';
import { MaterialsPage } from '../features/mes/MaterialsPage.js';
import { QualityPage } from '../features/mes/QualityPage.js';
import { MaintenancePage } from '../features/mes/MaintenancePage.js';
import { WorkforcePage } from '../features/mes/WorkforcePage.js';
import { WipPage } from '../features/mes/WipPage.js';
import { ProductionBoardPage } from '../features/mes/ProductionBoardPage.js';
import { EventHistoryPage } from '../features/mes/EventHistoryPage.js';
import { useSession } from './SessionContext.js';
import { OnboardingProvider, OnboardingLayers, OnboardingHeaderTrigger } from '../features/onboarding/index.js';

interface NavSubItem {
  label: string;
  path: string;
  tabKey?: string;
  icon?: string;
  /** The permission this destination needs; the API enforces the same id. */
  permission?: string;
  /**
   * Classification heading this entry sits under.
   *
   * Master Data had grown to twenty-one destinations in one flat list, which is
   * a list nobody reads — they scan it for the word they want and give up. The
   * heading is emitted whenever it changes between two *visible* entries, so a
   * section whose every item is filtered out by permission leaves no orphan
   * label behind. Entries sharing a section must therefore be adjacent.
   */
  section?: string;
}

interface NavGroup {
  id: string;
  label: string;
  icon: string;
  basePath: string;
  children: NavSubItem[];
}

/**
 * The classification heading inside a nav group.
 *
 * Rendered only when `section` differs from the entry above it, so headings
 * follow whatever survives the permission filter rather than being declared
 * up front and stranded when their items disappear.
 */
const NavSectionLabel: React.FC<{ label: string; first: boolean; color?: string }> = ({
  label,
  first,
  color = 'var(--color-on-surface-variant)',
}) => (
  <div
    style={{
      padding: `var(--space-2) var(--space-2) var(--space-1)`,
      marginTop: first ? 0 : 'var(--space-2)',
      fontSize: '10px',
      fontWeight: 800,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      color,
    }}
  >
    {label}
  </div>
);

/**
 * Route-level authorization (US-003).
 *
 * Hiding a nav link is not enough, a bookmarked or pasted URL must be refused
 * too. The API rejects the request regardless; this keeps the user from
 * staring at a page of failed panels while it does.
 */
const Guarded: React.FC<{ need: string; children: React.ReactNode }> = ({ need, children }) => {
  const { can, principal } = useSession();
  if (can(need)) return <>{children}</>;

  return (
    <div
      style={{
        display: 'grid',
        placeItems: 'center',
        minHeight: '60vh',
        padding: 'var(--space-6)',
        textAlign: 'center',
        color: 'var(--color-on-surface-variant)',
        fontFamily: 'var(--font-family)',
      }}
    >
      <div style={{ maxWidth: '380px' }}>
        <Icon name="lock" size={32} />
        <h2
          style={{ margin: `var(--space-3) 0 var(--space-2)`, fontSize: '18px', fontWeight: 800, color: 'var(--color-on-surface)' }}
        >
          Akses ditolak
        </h2>
        <p style={{ margin: 0, fontSize: '13px' }}>
          Peran <strong>{principal?.role}</strong> tidak memiliki izin <code>{need}</code> untuk halaman ini.
          Hubungi administrator bila Anda memerlukan akses.
        </p>
      </div>
    </div>
  );
};

export const App: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();

  // The authenticated principal is the source of truth for identity, role and
  // permissions (US-001, US-003). Presentation-only preferences, avatar and
  // contact details the account record does not carry, stay local.
  const { principal, user, restoring, logout, canAny } = useSession();

  const [profileOverrides, setProfileOverrides] = useState<Partial<UserSession>>(() => {
    try {
      return JSON.parse(localStorage.getItem('fv_profile_prefs') ?? '{}');
    } catch {
      return {};
    }
  });

  const session: UserSession | null = principal
    ? {
        name: principal.name,
        role: principal.role,
        email: user?.email ?? '',
        plantName: principal.scope.level === 'TENANT' ? 'Semua Plant' : (principal.scope.id ?? 'Plant'),
        avatarUrl: profileOverrides.avatarUrl ?? avatarDataUri(principal.name),
        phone: profileOverrides.phone,
        employeeId: user?.employeeNumber ?? principal.subjectId,
      }
    : null;

  const [isEditProfileOpen, setIsEditProfileOpen] = useState<boolean>(false);
  /*
   * Light is the default.
   *
   * A plant office is a lit room and the console is read on a desk monitor, so
   * dark was the wrong ground to open on. The choice is also remembered: it
   * used to reset to the default on every reload, which made the toggle look
   * broken to anyone who set it and came back.
   */
  const [themeMode, setThemeMode] = useState<'dark' | 'light'>(() => {
    try {
      return localStorage.getItem('fv_theme') === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });

  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);
  const [hoveredGroupId, setHoveredGroupId] = useState<string | null>(null);
  // Where the hovered group's button sits on screen. The collapsed flyout is
  // positioned `fixed` from this rather than `absolute` inside the nav: the
  // nav scrolls (`overflow-y: auto`), and a scroll container clips on both
  // axes whatever `overflow-x` says, so an absolute flyout was cut off at the
  // sidebar's edge and showed as a sliver.
  const [hoverAnchor, setHoverAnchor] = useState<{ top: number; bottom: number } | null>(null);

  // Track which sidebar groups are expanded (when in expanded mode)
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    overview: true,
    production: true,
    analytics: true,
    governance: true,
    master: true,
  });

  const toggleGroup = (groupId: string) => {
    setExpandedGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  const handleSaveProfile = (updatedSession: UserSession) => {
    // Name, role, email and scope come from the account record and are changed
    // in User Management (US-004), not here; only display preferences persist.
    const prefs = { avatarUrl: updatedSession.avatarUrl, phone: updatedSession.phone };
    setProfileOverrides(prefs);
    localStorage.setItem('fv_profile_prefs', JSON.stringify(prefs));
  };

  const handleLogout = () => {
    void logout();
  };

  /**
   * Drops entries the session is not entitled to, then drops any group left
   * with nothing in it, an empty accordion header is worse than no header.
   */
  const filterNav = (groups: NavGroup[]): NavGroup[] =>
    groups
      .map((group) => ({
        ...group,
        children: group.children.filter((child) => !child.permission || canAny(child.permission)),
      }))
      .filter((group) => group.children.length > 0);

  // Sync data-theme to <html>. There is no accent axis: fv/palette.css defines
  // the one Factory Vision palette for both themes.
  //
  // The sign-in screen is always light. It is the product's front door, seen
  // before anyone has expressed a preference, and the theme toggle lives
  // behind the session anyway, so a dark login would be a state the visitor
  // could not have chosen and cannot change. The toggle resumes control the
  // moment a session exists.
  useEffect(() => {
    const effectiveTheme = principal ? themeMode : 'light';
    document.documentElement.setAttribute('data-theme', effectiveTheme);
    try {
      localStorage.setItem('fv_theme', themeMode);
    } catch {
      /* a locked-down browser just loses the preference, it does not break */
    }
    if (effectiveTheme === 'dark') {
      document.body.classList.add('morphic-theme-dark');
      document.body.classList.remove('morphic-theme-light');
    } else {
      document.body.classList.add('morphic-theme-light');
      document.body.classList.remove('morphic-theme-dark');
    }
  }, [themeMode, principal]);

  // A stored token is validated before first paint, so an expired session
  // never flashes the dashboard on its way to the login screen.
  if (restoring) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          backgroundColor: 'var(--color-background)',
          color: 'var(--color-on-surface-variant)',
          fontFamily: 'var(--font-family)',
          fontSize: '13px',
        }}
      >
        Memulihkan sesi…
      </div>
    );
  }

  if (!session || !principal) {
    return <ConsoleAuth />;
  }

  /**
   * Navigation is derived from the session's permissions (US-003).
   *
   * Each entry declares the permission its destination needs, and the same
   * identifier guards the route on the API, so a link the user cannot follow
   * is never rendered, and a deep link they are not entitled to is refused by
   * the server rather than only hidden here.
   */
  const navGroups: NavGroup[] = filterNav([
    {
      id: 'overview',
      label: 'Eksekutif & Real-time',
      icon: 'dashboard',
      basePath: '/',
      children: [
        { label: 'Executive Dashboard', path: '/', icon: 'space_dashboard', permission: 'dashboard:view' },
        {
          label: 'Live Production Board',
          path: '/live-board',
          icon: 'precision_manufacturing',
          permission: 'work_order:view',
        },
        {
          label: 'Target vs Produksi Aktual',
          path: '/target-vs-actual',
          icon: 'compare_arrows',
          permission: 'analytics:view',
        },
      ],
    },
    {
      // Demand and planning (MES Improvement v1.0). Sits above execution because
      // that is the order the work happens in: an order arrives, becomes a plan,
      // and only then becomes work orders on the floor.
      id: 'demand-planning',
      label: 'Demand & Perencanaan',
      icon: 'calendar_month',
      basePath: '/customer-orders',
      children: [
        {
          // Creating an order is the list's primary action ("Buat Order"), not a
          // menu of its own: one place to go for orders.
          label: 'Customer Order',
          path: '/customer-orders',
          icon: 'description',
          permission: 'customer_order:view',
        },
        {
          label: 'Demand Forecast',
          path: '/demand-forecast',
          icon: 'query_stats',
          permission: 'demand_forecast:view',
        },
        {
          label: 'Capacity Planning',
          path: '/capacity-planning',
          icon: 'factory',
          permission: 'capacity_plan:view',
        },
        {
          label: 'Production Plan',
          path: '/production-plans',
          icon: 'inventory_2',
          permission: 'production_plan:view',
        },
        {
          label: 'MRP',
          path: '/mrp',
          icon: 'calculate',
          permission: 'mrp:view',
        },
        {
          label: 'Material Readiness',
          path: '/material-readiness',
          icon: 'checklist',
          permission: 'material:view',
        },
      ],
    },
    {
      id: 'production',
      label: 'Eksekusi Produksi',
      icon: 'assignment',
      basePath: '/work-orders',
      children: [
        {
          label: 'Production Board',
          path: '/production-board',
          icon: 'calendar_view_week',
          permission: 'production_board:view',
        },
        {
          label: 'Work Order',
          path: '/work-orders',
          icon: 'list_alt',
          permission: 'work_order:view',
        },
        {
          label: 'WIP & Handoff',
          path: '/wip',
          icon: 'swap_horiz',
          permission: 'wip:view',
        },
        {
          label: 'Performa & Serah Terima Shift',
          path: '/shift-handover',
          icon: 'handshake',
          permission: 'shift:view',
        },
      ],
    },
    {
      /*
       * The improvement's four operational modules (Improvement PRD §21).
       *
       * One group rather than four, because each is a single screen with tabs
       * and four one-item groups would be four collapsed headings a user has
       * to open before finding anything.
       */
      id: 'operations',
      label: 'Material, Mutu & Sumber Daya',
      icon: 'precision_manufacturing',
      basePath: '/material-inventory',
      children: [
        {
          label: 'Material & Inventory',
          path: '/material-inventory',
          icon: 'inventory_2',
          permission: 'material:view',
        },
        {
          label: 'Quality',
          path: '/quality',
          icon: 'verified',
          permission: 'quality:view',
        },
        {
          label: 'Maintenance',
          path: '/maintenance',
          icon: 'build',
          permission: 'maintenance:view',
        },
        {
          label: 'Workforce & Labor',
          path: '/workforce',
          icon: 'engineering',
          permission: 'workforce:view',
        },
      ],
    },
    {
      id: 'analytics',
      label: 'Analitik & Laporan',
      icon: 'insights',
      basePath: '/oee',
      children: [
        { label: 'Investigasi OEE', path: '/oee', icon: 'speed', permission: 'analytics:view' },
        { label: 'Analisis Bottleneck', path: '/bottlenecks', icon: 'compress', permission: 'analytics:view' },
        {
          label: 'Pareto Alasan Downtime',
          path: '/downtime-analytics',
          icon: 'query_stats',
          permission: 'analytics:view',
        },
        {
          label: 'Laporan Produksi',
          path: '/reports?tab=production',
          tabKey: 'production',
          icon: 'bar_chart',
          permission: 'report:export',
        },
        {
          label: 'Laporan Downtime',
          path: '/reports?tab=downtime',
          tabKey: 'downtime',
          icon: 'timer',
          permission: 'report:export',
        },
        {
          label: 'Laporan Shift',
          path: '/reports?tab=shift',
          tabKey: 'shift',
          icon: 'schedule',
          permission: 'report:export',
        },
        {
          label: 'Laporan OEE',
          path: '/reports?tab=oee',
          tabKey: 'oee',
          icon: 'monitoring',
          permission: 'report:export',
        },
        // Improvement PRD §24. Each is guarded by its own module's view
        // permission rather than by `report:export`: a warehouse controller
        // may read the material report without being handed the OEE one.
        {
          label: 'Laporan Material',
          path: '/reports?tab=material',
          tabKey: 'material',
          icon: 'inventory_2',
          permission: 'material:view',
        },
        {
          label: 'Laporan Quality',
          path: '/reports?tab=quality',
          tabKey: 'quality',
          icon: 'verified',
          permission: 'quality:view',
        },
        {
          label: 'Laporan Maintenance',
          path: '/reports?tab=maintenance',
          tabKey: 'maintenance',
          icon: 'build',
          permission: 'maintenance:view',
        },
        {
          label: 'Laporan Workforce',
          path: '/reports?tab=workforce',
          tabKey: 'workforce',
          icon: 'engineering',
          permission: 'workforce:view',
        },
        {
          label: 'Laporan WIP',
          path: '/reports?tab=wip',
          tabKey: 'wip',
          icon: 'swap_horiz',
          permission: 'wip:view',
        },
      ],
    },
    {
      id: 'governance',
      label: 'Tata Kelola & Audit',
      icon: 'security',
      basePath: '/corrections',
      children: [
        {
          label: 'Koreksi Data',
          path: '/corrections',
          icon: 'published_with_changes',
          permission: 'production_record:correct',
        },
        {
          label: 'Exception Sinkronisasi',
          path: '/sync-exceptions',
          icon: 'compare_arrows',
          permission: 'work_order:view',
        },
        { label: 'Event History', path: '/event-history', icon: 'timeline', permission: 'event:view' },
        { label: 'Audit Trail', path: '/audit-logs', icon: 'history', permission: 'audit:view' },
        { label: 'Validasi OEE', path: '/oee-validation', icon: 'fact_check', permission: 'analytics:view' },
      ],
    },
    {
      id: 'master',
      label: 'Master Data',
      icon: 'tune',
      basePath: '/settings',
      children: [
        {
          label: 'Customer',
          path: '/master-customers',
          icon: 'apartment',
          permission: 'customer:view',
          section: 'Produk & Proses',
        },
        {
          label: 'Produk',
          path: '/settings?tab=products',
          tabKey: 'products',
          icon: 'category',
          permission: 'master_data:view',
          section: 'Produk & Proses',
        },
        {
          label: 'Bill of Material (BOM)',
          path: '/settings?tab=bom',
          tabKey: 'bom',
          icon: 'schema',
          permission: 'master_data:view',
          section: 'Produk & Proses',
        },
        {
          label: 'Proses Produksi',
          path: '/settings?tab=processes',
          tabKey: 'processes',
          icon: 'account_tree',
          permission: 'master_data:view',
          section: 'Produk & Proses',
        },
        {
          label: 'Routing Produk',
          path: '/settings?tab=routings',
          tabKey: 'routings',
          icon: 'alt_route',
          permission: 'master_data:view',
          section: 'Produk & Proses',
        },
        {
          label: 'Ideal Cycle Time',
          path: '/settings?tab=rates',
          tabKey: 'rates',
          icon: 'speed',
          permission: 'master_data:view',
          section: 'Produk & Proses',
        },
        {
          label: 'Batch Produksi & Lot',
          path: '/settings?tab=batches',
          tabKey: 'batches',
          icon: 'inventory_2',
          permission: 'batch:view',
          section: 'Produk & Proses',
        },
        {
          label: 'Production Line',
          path: '/settings?tab=lines',
          tabKey: 'lines',
          icon: 'view_stream',
          permission: 'master_data:view',
          section: 'Fasilitas & Aset',
        },
        {
          label: 'Work Center',
          path: '/settings?tab=work-centers',
          tabKey: 'work-centers',
          icon: 'grid_view',
          permission: 'master_data:view',
          section: 'Fasilitas & Aset',
        },
        {
          label: 'Mesin',
          path: '/settings?tab=machines',
          tabKey: 'machines',
          icon: 'precision_manufacturing',
          permission: 'master_data:view',
          section: 'Fasilitas & Aset',
        },
        {
          label: 'Mold',
          path: '/settings?tab=molds',
          tabKey: 'molds',
          icon: 'compress',
          permission: 'master_data:view',
          section: 'Fasilitas & Aset',
        },
        {
          label: 'Terminal Shop Floor',
          path: '/settings?tab=devices',
          tabKey: 'devices',
          icon: 'tablet_android',
          permission: 'device:view',
          section: 'Fasilitas & Aset',
        },
        {
          label: 'Shift',
          path: '/settings?tab=shifts',
          tabKey: 'shifts',
          icon: 'schedule',
          permission: 'shift:view',
          section: 'Tenaga Kerja',
        },
        {
          label: 'Operator',
          path: '/settings?tab=operators',
          tabKey: 'operators',
          icon: 'badge',
          permission: 'master_data:view',
          section: 'Tenaga Kerja',
        },
        {
          label: 'Alasan Downtime',
          path: '/settings?tab=downtime-reasons',
          tabKey: 'downtime-reasons',
          icon: 'timer_off',
          permission: 'master_data:view',
          section: 'Klasifikasi',
        },
        {
          label: 'Alasan Reject',
          path: '/settings?tab=reject-reasons',
          tabKey: 'reject-reasons',
          icon: 'cancel',
          permission: 'master_data:view',
          section: 'Klasifikasi',
        },
        {
          label: 'Definisi OEE',
          path: '/settings?tab=oee-config',
          tabKey: 'oee-config',
          icon: 'calculate',
          permission: 'analytics:view',
          section: 'Klasifikasi',
        },
        {
          label: 'Pengguna',
          path: '/settings?tab=users',
          tabKey: 'users',
          icon: 'manage_accounts',
          permission: 'user:view',
          section: 'Pengguna & Akses',
        },
        {
          label: 'Peran & Permission',
          path: '/settings?tab=roles',
          tabKey: 'roles',
          icon: 'admin_panel_settings',
          permission: 'role:view',
          section: 'Pengguna & Akses',
        },
        {
          label: 'Matriks Hak Akses',
          path: '/settings?tab=acl',
          tabKey: 'acl',
          icon: 'verified_user',
          permission: 'master_data:view',
          section: 'Pengguna & Akses',
        },
        {
          label: 'Sesi Aktif',
          path: '/settings?tab=sessions',
          tabKey: 'sessions',
          icon: 'devices',
          permission: 'user:view',
          section: 'Pengguna & Akses',
        },
        {
          label: 'Import / Export CSV',
          path: '/settings?tab=import-export',
          tabKey: 'import-export',
          icon: 'swap_vert',
          permission: 'master_data:view',
          section: 'Pemeliharaan Data',
        },
      ],
    },
  ]);

  const currentFullUrl = `${location.pathname}${location.search}`;

  return (
    <OnboardingProvider>
      <div
        style={{
          display: 'flex',
          height: '100vh',
          overflow: 'hidden',
          backgroundColor: 'var(--color-background)',
          color: 'var(--color-on-background)',
          fontFamily: 'var(--font-family)',
        }}
      >
      {/* Floating sidebar panel in the brand fill; the active group is cut
          out of it as a tab in the page ground (fv/sidebar.css). */}
      <aside
        className="fv-sidebar"
        style={{
          width: isCollapsed ? '72px' : '220px',
        }}
      >
        <div
          style={{
            padding: isCollapsed ? '16px 8px 8px' : '20px 14px 12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: isCollapsed ? 'center' : 'flex-start',
            height: '64px',
            boxSizing: 'border-box',
          }}
        >
          {isCollapsed ? (
            /* Collapsed Header: Clickable Logo with Instant Expand */
            <button
              onClick={() => {
                setIsCollapsed(false);
                setHoveredGroupId(null);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: 'none',
                backgroundColor: 'transparent',
                cursor: 'pointer',
                padding: 'var(--space-1)',
                borderRadius: 'var(--radius-md)',
              }}
              title="Click to expand sidebar (Uncollapse)"
            >
              <FactoryVisionIcon size={30} tone="white" />
            </button>
          ) : (
            /* Expanded Header: Clean Logo + Brand Name */
            <div style={{ display: 'flex', alignItems: 'center', overflow: 'hidden' }}>
              <FactoryVisionLogo size="md" variant="compact" showTagline={false} tone="white" />
            </div>
          )}
        </div>

        {/* Navigation Items with Accordion / Flyout Sub-Menus.
            No right padding: the active tab must reach the panel edge, and a
            negative margin inside a scroll box would become horizontal
            overflow. Every other item keeps the edge gap as its own margin. */}
        <nav
          className="fv-sidebar__nav"
          style={{
            padding: isCollapsed ? '16px 0 12px 0' : '16px 0 12px 8px',
            display: 'flex',
            flexDirection: 'column',
            gap: isCollapsed ? '8px' : '4px',
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
          }}
        >
          {navGroups.map((group) => {
            const isGroupActive =
              location.pathname.startsWith(group.basePath) &&
              (group.basePath !== '/' || location.pathname === '/');
            const isExpanded = expandedGroups[group.id] ?? true;
            const isHovered = hoveredGroupId === group.id;

            if (isCollapsed) {
              // Collapsed Mode: Direct React Router Navigation with hover flyout
              return (
                <div
                  key={group.id}
                  style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}
                  onMouseEnter={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    setHoverAnchor({ top: r.top, bottom: r.bottom });
                    setHoveredGroupId(group.id);
                  }}
                  onMouseLeave={() => setHoveredGroupId(null)}
                >
                  <button
                    className={isGroupActive ? 'fv-sidebar__tab' : undefined}
                    onClick={() => {
                      if (group.children.length > 0) {
                        navigate(group.children[0].path);
                        setHoveredGroupId(null);
                      }
                    }}
                    style={{
                      // Every icon sits on the panel's centre line (36px). The
                      // active tab runs from there to the panel edge, and its
                      // right padding keeps the icon on that same line.
                      width: isGroupActive ? '57px' : '42px',
                      marginLeft: isGroupActive ? 'auto' : 0,
                      paddingRight: isGroupActive ? '15px' : 0,
                      height: '42px',
                      borderRadius: isGroupActive ? undefined : 'var(--radius-md)',
                      border: 'none',
                      backgroundColor: isGroupActive
                        ? undefined
                        : isHovered
                          ? 'var(--fv-sidebar-fill-raised)'
                          : 'transparent',
                      color: isGroupActive ? 'var(--color-primary)' : 'var(--fv-sidebar-ink)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      transition: 'background-color 0.15s ease',
                    }}
                    title={group.label}
                  >
                    {isGroupActive && (
                      <>
                        <span className="fv-sidebar__corner fv-sidebar__corner--top" aria-hidden="true" />
                        <span className="fv-sidebar__corner fv-sidebar__corner--bottom" aria-hidden="true" />
                      </>
                    )}
                    <Icon
                      name={group.icon}
                      size={20}
                      color={isGroupActive ? 'var(--color-primary)' : 'var(--fv-sidebar-ink)'}
                    />
                  </button>

                  <AnimatePresence>
                    {isHovered && hoverAnchor && (
                      <motion.div
                        initial={{ opacity: 0, x: -6, scale: 0.96 }}
                        animate={{ opacity: 1, x: 0, scale: 1 }}
                        exit={{ opacity: 0, x: -6, scale: 0.96 }}
                        transition={{ duration: 0.15, ease: 'easeOut' }}
                        style={{
                          // Viewport-anchored so the nav's scroll box cannot
                          // clip it. Still a child of the group's wrapper, so
                          // moving the pointer onto it keeps the hover; the
                          // transparent left padding covers the gap between
                          // the sidebar edge and the panel for the same reason.
                          position: 'fixed',
                          left: '72px',
                          paddingLeft: '8px',
                          // Open downward from the button; near the bottom of
                          // the viewport open upward instead, so the last
                          // groups never spill below the screen.
                          ...(hoverAnchor.top > window.innerHeight * 0.6
                            ? { bottom: window.innerHeight - hoverAnchor.bottom }
                            : { top: hoverAnchor.top }),
                          zIndex: 100,
                        }}
                      >
                      <div
                        style={{
                          width: '210px',
                          // The room left on the side it opens towards; a
                          // long group (Master Data) scrolls inside the panel
                          // rather than running off the screen.
                          maxHeight:
                            hoverAnchor.top > window.innerHeight * 0.6
                              ? `${hoverAnchor.bottom - 16}px`
                              : `calc(100vh - ${hoverAnchor.top + 16}px)`,
                          overflowY: 'auto',
                          boxSizing: 'border-box',
                          backgroundColor: 'var(--color-surface-container-highest)',
                          borderRadius: 'var(--radius-md)',
                          boxShadow: 'var(--elevation-3)',
                          padding: 'var(--space-2)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 'var(--space-1)',
                        }}
                      >
                        <div
                          style={{
                            padding: `var(--space-1) var(--space-2) var(--space-2)`,
                            fontSize: '11px',
                            fontWeight: 800,
                            color: 'var(--color-primary)',
                            marginBottom: 'var(--space-1)',
                            letterSpacing: '0.02em',
                          }}
                        >
                          {group.label.toUpperCase()}
                        </div>

                        {group.children.map((sub, subIndex) => {
                          const sectionChanged =
                            sub.section && sub.section !== group.children[subIndex - 1]?.section;
                          const isSubActive =
                            sub.path === currentFullUrl ||
                            (sub.path === location.pathname && !location.search && !sub.tabKey) ||
                            (!sub.tabKey && location.pathname.startsWith(`${sub.path}/`));

                          return (
                            <React.Fragment key={sub.path}>
                              {sectionChanged && (
                                <NavSectionLabel label={sub.section!} first={subIndex === 0} />
                              )}
                            <Link
                              to={sub.path}
                              onClick={() => setHoveredGroupId(null)}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 'var(--space-2)',
                                padding: `var(--space-2) var(--space-2)`,
                                borderRadius: 'var(--radius-sm)',
                                textDecoration: 'none',
                                fontSize: '11.5px',
                                fontWeight: isSubActive ? 800 : 500,
                                backgroundColor: isSubActive ? 'var(--color-surface-container)' : 'transparent',
                                color: isSubActive ? 'var(--color-primary)' : 'var(--color-on-surface)',
                                transition: 'all 0.12s ease',
                              }}
                            >
                              <Icon
                                name={sub.icon || 'circle'}
                                size={14}
                                color={isSubActive ? 'var(--color-primary)' : 'var(--color-on-surface-variant)'}
                              />
                              <span
                                style={{ minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                              >
                                {sub.label}
                              </span>
                            </Link>
                          </React.Fragment>
                          );
                        })}
                      </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            }

            // Expanded Mode: Hierarchical Accordion Sub-Menus
            return (
              <div key={group.id} style={{ display: 'flex', flexDirection: 'column' }}>
                {/* Main Category Header / Toggle. The active one is the tab
                    cut out of the panel; it runs to the panel edge while the
                    others keep the 12px edge gap as their own margin. */}
                <button
                  className={isGroupActive ? 'fv-sidebar__tab' : undefined}
                  onClick={() => toggleGroup(group.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginRight: isGroupActive ? 0 : '8px',
                    padding: isGroupActive
                      ? `var(--space-2) var(--space-4) var(--space-2) var(--space-2)`
                      : `var(--space-2) var(--space-2)`,
                    borderRadius: isGroupActive ? undefined : 'var(--radius-pill)',
                    border: 'none',
                    backgroundColor: isGroupActive ? undefined : 'transparent',
                    color: isGroupActive ? 'var(--color-primary)' : 'var(--fv-sidebar-ink)',
                    cursor: 'pointer',
                    fontSize: '11.5px',
                    fontWeight: isGroupActive ? 800 : 700,
                    textAlign: 'left',
                    transition: 'background-color 0.15s ease',
                  }}
                >
                  {isGroupActive && (
                    <>
                      <span className="fv-sidebar__corner fv-sidebar__corner--top" aria-hidden="true" />
                      <span className="fv-sidebar__corner fv-sidebar__corner--bottom" aria-hidden="true" />
                    </>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minWidth: 0 }}>
                    <span
                      style={{
                        width: '26px',
                        height: '26px',
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        backgroundColor: isGroupActive ? 'var(--color-primary)' : 'var(--fv-sidebar-fill-raised)',
                      }}
                    >
                      <Icon
                        name={group.icon}
                        size={17}
                        color={isGroupActive ? 'var(--color-on-primary)' : 'var(--fv-sidebar-ink)'}
                      />
                    </span>
                    <span style={{ minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {group.label}
                    </span>
                  </div>

                  <motion.div
                    animate={{ rotate: isExpanded ? 180 : 0 }}
                    transition={{ duration: 0.2 }}
                    style={{ display: 'flex', alignItems: 'center' }}
                  >
                    <Icon
                      name="expand_more"
                      size={15}
                      color={isGroupActive ? 'var(--color-primary)' : 'var(--fv-sidebar-ink-muted)'}
                    />
                  </motion.div>
                </button>

                <AnimatePresence initial={false}>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: 'easeOut' }}
                      style={{
                        overflow: 'hidden',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 'var(--space-1)',
                        paddingLeft: 'var(--space-5)',
                        marginRight: '8px',
                        marginTop: 'var(--space-2)',
                      }}
                    >
                      {group.children.map((sub, subIndex) => {
                          const sectionChanged =
                            sub.section && sub.section !== group.children[subIndex - 1]?.section;
                        const isSubActive =
                          sub.path === currentFullUrl ||
                          (sub.path === location.pathname && !location.search && !sub.tabKey) ||
                          (!sub.tabKey && location.pathname.startsWith(`${sub.path}/`));

                        return (
                          <React.Fragment key={sub.path}>
                            {sectionChanged && (
                              <NavSectionLabel
                                label={sub.section!}
                                first={subIndex === 0}
                                color="var(--fv-sidebar-ink-muted)"
                              />
                            )}
                          <Link
                            to={sub.path}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 'var(--space-2)',
                              padding: `var(--space-2) var(--space-2)`,
                              borderRadius: 'var(--radius-pill)',
                              textDecoration: 'none',
                              fontSize: '11px',
                              fontWeight: isSubActive ? 800 : 500,
                              backgroundColor: isSubActive ? 'var(--fv-sidebar-fill-raised)' : 'transparent',
                              color: isSubActive ? 'var(--fv-sidebar-ink)' : 'var(--fv-sidebar-ink-muted)',
                              transition: 'background-color 0.15s ease',
                            }}
                          >
                            <Icon
                              name={sub.icon || 'circle'}
                              size={13}
                              color={isSubActive ? 'var(--fv-sidebar-ink)' : 'var(--fv-sidebar-ink-muted)'}
                            />
                            <span
                              style={{ minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                            >
                              {sub.label}
                            </span>
                          </Link>
                        </React.Fragment>
                        );
                      })}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </nav>
      </aside>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
        <header
          style={{
            height: '52px',
            backgroundColor: 'var(--color-surface)',
            padding: `0 var(--space-5)`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <button
              onClick={() => {
                setIsCollapsed(!isCollapsed);
                setHoveredGroupId(null);
              }}
              style={{
                width: '32px',
                height: '32px',
                borderRadius: 'var(--radius-md)',
                border: 'none',
                backgroundColor: 'var(--color-surface-container)',
                color: 'var(--color-primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              <Icon name={isCollapsed ? 'menu' : 'menu_open'} size={18} />
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <Icon name="factory" size={17} color="var(--color-primary)" />
              <span style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--color-on-surface)' }}>
                {session.plantName || 'Main Plant Cikarang'}
              </span>
            </div>

            {/* Decorative divider, not content: it carries no meaning a screen
                reader should announce, and holding it to text contrast would
                make it read as text. */}
            <span aria-hidden="true" style={{ color: 'var(--color-border)' }}>
              |
            </span>
            <span style={{ fontSize: '11.5px', color: 'var(--color-on-surface-variant)' }}>
              Shift 1 (07:00, 15:00 UTC+7)
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <OnboardingHeaderTrigger />
            {/* StatusBadge is a mirror component with no solid-fill prop,
 its default is a pale success-container pill. Overriding to
 a solid fill is scoped to this one instance, not global. */}
            <style>{`.fv-live-badge { background-color: var(--color-success)!important; color: var(--color-on-success)!important; }.fv-live-badge > span { background-color: var(--color-on-success)!important; box-shadow: 0 0 6px var(--color-on-success)!important; }
 `}</style>
            <StatusBadge status="online" label="Live" className="fv-live-badge" />

            <button
              onClick={() => setThemeMode(themeMode === 'dark' ? 'light' : 'dark')}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '32px',
                height: '32px',
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'var(--color-surface-container)',
                border: 'none',
                color: 'var(--color-on-surface)',
                cursor: 'pointer',
              }}
              title="Toggle Light/Dark Theme"
            >
              <Icon name={themeMode === 'dark' ? 'light_mode' : 'dark_mode'} size={16} />
            </button>

            <button
              onClick={() => setIsEditProfileOpen(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                border: 'none',
                backgroundColor: 'transparent',
                cursor: 'pointer',
                padding: 'var(--space-1)',
              }}
              title="Edit profile"
            >
              <img
                src={session.avatarUrl || avatarDataUri(session.name)}
                alt={session.name}
                style={{
                  width: '30px',
                  height: '30px',
                  borderRadius: '50%',
                  objectFit: 'cover',
                  border: '1.5px solid var(--color-primary)',
                }}
              />
              <span
                style={{
                  fontSize: '12px',
                  fontWeight: 700,
                  color: 'var(--color-on-surface)',
                  maxWidth: '140px',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {session.name}
              </span>
            </button>

            {/* Keluar. Lives here rather than under the nav so the sidebar is
                navigation only, the way the shell was redrawn. */}
            <button
              onClick={handleLogout}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-1)',
                height: '32px',
                padding: `0 var(--space-3)`,
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'var(--color-surface-container)',
                border: 'none',
                color: 'var(--color-on-surface)',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
              title="Keluar dari akun (Logout)"
            >
              <Icon name="logout" size={16} />
              <span>Keluar</span>
            </button>
          </div>
        </header>

        <OnboardingLayers />

        <main style={{ flex: 1, overflowY: 'auto' }}>
          <Routes>
            <Route
              path="/"
              element={
                <Guarded need="dashboard:view">
                  <DashboardPage />
                </Guarded>
              }
            />
            <Route
              path="/live-board"
              element={
                <Guarded need="work_order:view">
                  <LiveBoardPage />
                </Guarded>
              }
            />
            <Route
              path="/work-orders"
              element={
                <Guarded need="work_order:view">
                  <WorkOrdersPage />
                </Guarded>
              }
            />
            <Route
              path="/customer-orders"
              element={
                <Guarded need="customer_order:view">
                  <CustomerOrdersPage />
                </Guarded>
              }
            />
            {/* The form used to be its own destination; bookmarks land on the list with the dialog open. */}
            <Route path="/order-receiving" element={<Navigate to="/customer-orders?add=1" replace />} />
            <Route path="/customer-orders/new" element={<Navigate to="/customer-orders?add=1" replace />} />
            <Route
              path="/master-customers"
              element={
                <Guarded need="customer:view">
                  <CustomerMasterPage />
                </Guarded>
              }
            />
            <Route
              path="/demand-forecast"
              element={
                <Guarded need="demand_forecast:view">
                  <DemandForecastPage />
                </Guarded>
              }
            />
            <Route
              path="/capacity-planning"
              element={
                <Guarded need="capacity_plan:view">
                  <CapacityPlanningPage />
                </Guarded>
              }
            />
            <Route
              path="/production-plans"
              element={
                <Guarded need="production_plan:view">
                  <ProductionPlansPage />
                </Guarded>
              }
            />
            <Route
              path="/production-plans/:planId"
              element={
                <Guarded need="production_plan:view">
                  <ProductionPlanWizardPage />
                </Guarded>
              }
            />
            <Route
              path="/downtime-analytics"
              element={
                <Guarded need="analytics:view">
                  <DowntimeAnalyticsPage />
                </Guarded>
              }
            />
            <Route
              path="/oee"
              element={
                <Guarded need="analytics:view">
                  <OeeInvestigationPage />
                </Guarded>
              }
            />
            <Route
              path="/bottlenecks"
              element={
                <Guarded need="analytics:view">
                  <BottleneckPage />
                </Guarded>
              }
            />
            <Route
              path="/oee-validation"
              element={
                <Guarded need="analytics:view">
                  <OeeValidationPage />
                </Guarded>
              }
            />
            <Route
              path="/target-vs-actual"
              element={
                <Guarded need="analytics:view">
                  <TargetVsActualPage />
                </Guarded>
              }
            />
            <Route
              path="/shift-handover"
              element={
                <Guarded need="shift:view">
                  <ShiftHandoverPage />
                </Guarded>
              }
            />
            <Route
              path="/reports"
              element={
                <Guarded need="report:export">
                  <ReportsPage />
                </Guarded>
              }
            />
            <Route
              path="/corrections"
              element={
                <Guarded need="production_record:correct">
                  <CorrectionsPage userRole={session.role} userName={session.name} />
                </Guarded>
              }
            />
            {/*
              Guarded on `work_order:view` rather than on the permission that
              resolves an exception: seeing that a record was not accepted is
              wider than being able to act on it, and hiding the list from the
              people closest to the line is how a rejection goes unnoticed.
            */}
            <Route
              path="/sync-exceptions"
              element={
                <Guarded need="work_order:view">
                  <SyncExceptionsPage />
                </Guarded>
              }
            />
            <Route
              path="/settings"
              element={
                <Guarded need="master_data:view">
                  <SettingsPage />
                </Guarded>
              }
            />
            {/*
              MES Improvement v2.0 (Improvement PRD §21). Each destination is
              guarded by the same permission id the API's route table uses, so
              a pasted URL is refused by the server as well as hidden here.
            */}
            <Route
              path="/mrp"
              element={
                <Guarded need="mrp:view">
                  <MrpPage />
                </Guarded>
              }
            />
            <Route
              path="/material-readiness"
              element={
                <Guarded need="material:view">
                  <MaterialReadinessPage />
                </Guarded>
              }
            />
            <Route
              path="/material-inventory"
              element={
                <Guarded need="material:view">
                  <MaterialsPage />
                </Guarded>
              }
            />
            <Route
              path="/production-board"
              element={
                <Guarded need="production_board:view">
                  <ProductionBoardPage />
                </Guarded>
              }
            />
            <Route
              path="/wip"
              element={
                <Guarded need="wip:view">
                  <WipPage />
                </Guarded>
              }
            />
            <Route
              path="/quality"
              element={
                <Guarded need="quality:view">
                  <QualityPage />
                </Guarded>
              }
            />
            <Route
              path="/maintenance"
              element={
                <Guarded need="maintenance:view">
                  <MaintenancePage />
                </Guarded>
              }
            />
            <Route
              path="/workforce"
              element={
                <Guarded need="workforce:view">
                  <WorkforcePage />
                </Guarded>
              }
            />
            <Route
              path="/event-history"
              element={
                <Guarded need="event:view">
                  <EventHistoryPage />
                </Guarded>
              }
            />
            <Route
              path="/audit-logs"
              element={
                <Guarded need="audit:view">
                  <AuditLogPage />
                </Guarded>
              }
            />
          </Routes>
        </main>
      </div>

      <EditProfileModal
        isOpen={isEditProfileOpen}
        onClose={() => setIsEditProfileOpen(false)}
        session={session}
        onSave={handleSaveProfile}
      />
    </div>
    </OnboardingProvider>
  );
};

export default App;
