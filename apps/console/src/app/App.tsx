import React, { useState, useEffect } from 'react';
import { Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom';
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
import { OrderReceivingPage } from '../features/planning/OrderReceivingPage.js';
import { CustomerOrdersPage } from '../features/planning/CustomerOrdersPage.js';
import { CustomerMasterPage } from '../features/planning/CustomerMasterPage.js';
import { DemandForecastPage } from '../features/planning/DemandForecastPage.js';
import { CapacityPlanningPage } from '../features/planning/CapacityPlanningPage.js';
import { ProductionPlansPage } from '../features/planning/ProductionPlansPage.js';
import { ProductionPlanWizardPage } from '../features/planning/ProductionPlanWizardPage.js';
import { useSession } from './SessionContext.js';

interface NavSubItem {
  label: string;
  path: string;
  tabKey?: string;
  icon?: string;
  /** The permission this destination needs; the API enforces the same id. */
  permission?: string;
}

interface NavGroup {
  id: string;
  label: string;
  icon: string;
  basePath: string;
  children: NavSubItem[];
}

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
  const [themeMode, setThemeMode] = useState<'dark' | 'light'>('dark');

  // Sidebar Collapsed State
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);
  const [hoveredGroupId, setHoveredGroupId] = useState<string | null>(null);

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
          label: 'Penerimaan Order',
          path: '/order-receiving',
          icon: 'add',
          permission: 'customer_order:create',
        },
        {
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
      ],
    },
    {
      id: 'production',
      label: 'Eksekusi Produksi',
      icon: 'assignment',
      basePath: '/work-orders',
      children: [
        {
          label: 'Work Order',
          path: '/work-orders',
          icon: 'list_alt',
          permission: 'work_order:view',
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
        },
        {
          label: 'Proses Produksi',
          path: '/settings?tab=processes',
          tabKey: 'processes',
          icon: 'account_tree',
          permission: 'master_data:view',
        },
        {
          label: 'Routing Produk',
          path: '/settings?tab=routings',
          tabKey: 'routings',
          icon: 'alt_route',
          permission: 'master_data:view',
        },
        {
          label: 'Produk',
          path: '/settings?tab=products',
          tabKey: 'products',
          icon: 'category',
          permission: 'master_data:view',
        },
        {
          label: 'Ideal Cycle Time',
          path: '/settings?tab=rates',
          tabKey: 'rates',
          icon: 'speed',
          permission: 'master_data:view',
        },
        {
          label: 'Batch Produksi & Lot',
          path: '/settings?tab=batches',
          tabKey: 'batches',
          icon: 'inventory_2',
          permission: 'batch:view',
        },
        {
          label: 'Mesin',
          path: '/settings?tab=machines',
          tabKey: 'machines',
          icon: 'precision_manufacturing',
          permission: 'master_data:view',
        },
        {
          label: 'Production Line',
          path: '/settings?tab=lines',
          tabKey: 'lines',
          icon: 'view_stream',
          permission: 'master_data:view',
        },
        {
          label: 'Work Center',
          path: '/settings?tab=work-centers',
          tabKey: 'work-centers',
          icon: 'grid_view',
          permission: 'master_data:view',
        },
        {
          label: 'Mold',
          path: '/settings?tab=molds',
          tabKey: 'molds',
          icon: 'compress',
          permission: 'master_data:view',
        },
        {
          label: 'Shift',
          path: '/settings?tab=shifts',
          tabKey: 'shifts',
          icon: 'schedule',
          permission: 'shift:view',
        },
        {
          label: 'Operator',
          path: '/settings?tab=operators',
          tabKey: 'operators',
          icon: 'badge',
          permission: 'master_data:view',
        },
        {
          label: 'Alasan Downtime',
          path: '/settings?tab=downtime-reasons',
          tabKey: 'downtime-reasons',
          icon: 'timer_off',
          permission: 'master_data:view',
        },
        {
          label: 'Alasan Reject',
          path: '/settings?tab=reject-reasons',
          tabKey: 'reject-reasons',
          icon: 'cancel',
          permission: 'master_data:view',
        },
        {
          label: 'Import / Export CSV',
          path: '/settings?tab=import-export',
          tabKey: 'import-export',
          icon: 'swap_vert',
          permission: 'master_data:view',
        },
        {
          label: 'Pengguna',
          path: '/settings?tab=users',
          tabKey: 'users',
          icon: 'manage_accounts',
          permission: 'user:view',
        },
        {
          label: 'Peran & Permission',
          path: '/settings?tab=roles',
          tabKey: 'roles',
          icon: 'admin_panel_settings',
          permission: 'role:view',
        },
        {
          label: 'Sesi Aktif',
          path: '/settings?tab=sessions',
          tabKey: 'sessions',
          icon: 'devices',
          permission: 'user:view',
        },
        {
          label: 'Terminal Shop Floor',
          path: '/settings?tab=devices',
          tabKey: 'devices',
          icon: 'tablet_android',
          permission: 'device:view',
        },
        {
          label: 'Definisi OEE',
          path: '/settings?tab=oee-config',
          tabKey: 'oee-config',
          icon: 'calculate',
          permission: 'analytics:view',
        },
        {
          label: 'Matriks Hak Akses',
          path: '/settings?tab=acl',
          tabKey: 'acl',
          icon: 'verified_user',
          permission: 'master_data:view',
        },
      ],
    },
  ]);

  const currentFullUrl = `${location.pathname}${location.search}`;

  return (
    <div
      style={{
        display: 'flex',
        minHeight: '100vh',
        backgroundColor: 'var(--color-background)',
        color: 'var(--color-on-background)',
        fontFamily: 'var(--font-family)',
      }}
    >
      {/* Morphic Collapsible Sidebar */}
      <aside
        style={{
          width: isCollapsed ? '72px' : '270px',
          transition: 'width 0.22s cubic-bezier(0.2, 0, 0, 1)',
          backgroundColor: 'var(--color-surface)',
          borderRight: '1px solid var(--color-outline-variant)',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
          zIndex: 20,
          position: 'relative',
        }}
      >
        {/* Brand Header */}
        <div
          style={{
            padding: isCollapsed ? '12px 8px' : '16px 16px',
            borderBottom: '1px solid var(--color-outline-variant)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: isCollapsed ? 'center' : 'flex-start',
            height: '56px',
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
              <FactoryVisionIcon size={28} />
            </button>
          ) : (
            /* Expanded Header: Clean Logo + Brand Name */
            <div style={{ display: 'flex', alignItems: 'center', overflow: 'hidden' }}>
              <FactoryVisionLogo size="md" variant="full" />
            </div>
          )}
        </div>

        {/* Navigation Items with Accordion / Flyout Sub-Menus */}
        <nav
          style={{
            padding: isCollapsed ? '12px 8px' : '12px 10px',
            display: 'flex',
            flexDirection: 'column',
            gap: isCollapsed ? '8px' : '4px',
            flex: 1,
            overflowY: 'auto',
            overflowX: 'visible',
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
                  onMouseEnter={() => setHoveredGroupId(group.id)}
                  onMouseLeave={() => setHoveredGroupId(null)}
                >
                  <button
                    onClick={() => {
                      if (group.children.length > 0) {
                        navigate(group.children[0].path);
                        setHoveredGroupId(null);
                      }
                    }}
                    style={{
                      width: '42px',
                      height: '42px',
                      borderRadius: 'var(--radius-md)',
                      border: isGroupActive ? '1px solid var(--color-primary)' : '1px solid transparent',
                      backgroundColor: isGroupActive
                        ? 'var(--color-surface-container-high)'
                        : isHovered
                          ? 'var(--color-surface-container)'
                          : 'transparent',
                      color: isGroupActive ? 'var(--color-primary)' : 'var(--color-on-surface-variant)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      position: 'relative',
                    }}
                    title={group.label}
                  >
                    <Icon
                      name={group.icon}
                      size={20}
                      color={isGroupActive ? 'var(--color-primary)' : 'var(--color-on-surface-variant)'}
                    />
                    {isGroupActive && (
                      <span
                        style={{
                          position: 'absolute',
                          left: '-4px',
                          width: '3px',
                          height: '18px',
                          borderRadius: 'var(--radius-pill)',
                          backgroundColor: 'var(--color-primary)',
                        }}
                      />
                    )}
                  </button>

                  {/* Flyout Sub-menu Popover on Hover (when Collapsed) */}
                  <AnimatePresence>
                    {isHovered && (
                      <motion.div
                        initial={{ opacity: 0, x: -6, scale: 0.96 }}
                        animate={{ opacity: 1, x: 0, scale: 1 }}
                        exit={{ opacity: 0, x: -6, scale: 0.96 }}
                        transition={{ duration: 0.15, ease: 'easeOut' }}
                        style={{
                          position: 'absolute',
                          left: '52px',
                          top: 0,
                          width: '210px',
                          backgroundColor: 'var(--color-surface-container-highest)',
                          borderRadius: 'var(--radius-md)',
                          border: '1px solid var(--color-outline-variant)',
                          boxShadow: 'var(--elevation-3)',
                          padding: 'var(--space-2)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 'var(--space-1)',
                          zIndex: 100,
                        }}
                      >
                        <div
                          style={{
                            padding: `var(--space-1) var(--space-2) var(--space-2)`,
                            fontSize: '11px',
                            fontWeight: 800,
                            color: 'var(--color-primary)',
                            borderBottom: '1px solid var(--color-outline-variant)',
                            marginBottom: 'var(--space-1)',
                            letterSpacing: '0.02em',
                          }}
                        >
                          {group.label.toUpperCase()}
                        </div>

                        {group.children.map((sub) => {
                          const isSubActive =
                            sub.path === currentFullUrl ||
                            (sub.path === location.pathname && !location.search && !sub.tabKey);

                          return (
                            <Link
                              key={sub.path}
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
                                style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                              >
                                {sub.label}
                              </span>
                            </Link>
                          );
                        })}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            }

            // Expanded Mode: Hierarchical Accordion Sub-Menus
            return (
              <div key={group.id} style={{ display: 'flex', flexDirection: 'column' }}>
                {/* Main Category Header / Toggle */}
                <button
                  onClick={() => toggleGroup(group.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    width: '100%',
                    padding: `var(--space-2) var(--space-3)`,
                    borderRadius: 'var(--radius-md)',
                    border: 'none',
                    backgroundColor: isGroupActive ? 'var(--color-surface-container)' : 'transparent',
                    color: isGroupActive ? 'var(--color-primary)' : 'var(--color-on-surface)',
                    cursor: 'pointer',
                    fontSize: '12px',
                    fontWeight: isGroupActive ? 800 : 700,
                    textAlign: 'left',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <Icon
                      name={group.icon}
                      size={17}
                      color={isGroupActive ? 'var(--color-primary)' : 'var(--color-on-surface-variant)'}
                    />
                    <span style={{ whiteSpace: 'nowrap' }}>{group.label}</span>
                  </div>

                  <motion.div
                    animate={{ rotate: isExpanded ? 180 : 0 }}
                    transition={{ duration: 0.2 }}
                    style={{ display: 'flex', alignItems: 'center' }}
                  >
                    <Icon name="expand_more" size={15} color="var(--color-on-surface-variant)" />
                  </motion.div>
                </button>

                {/* Collapsible Sub-Menu Items */}
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
                        paddingLeft: 'var(--space-4)',
                        marginTop: 'var(--space-1)',
                        borderLeft: '2px solid var(--color-outline-variant)',
                        marginLeft: 'var(--space-4)',
                      }}
                    >
                      {group.children.map((sub) => {
                        const isSubActive =
                          sub.path === currentFullUrl ||
                          (sub.path === location.pathname && !location.search && !sub.tabKey);

                        return (
                          <Link
                            key={sub.path}
                            to={sub.path}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 'var(--space-2)',
                              padding: `var(--space-2) var(--space-2)`,
                              borderRadius: 'var(--radius-sm)',
                              textDecoration: 'none',
                              fontSize: '11px',
                              fontWeight: isSubActive ? 800 : 500,
                              backgroundColor: isSubActive
                                ? 'var(--color-surface-container-high)'
                                : 'transparent',
                              color: isSubActive ? 'var(--color-primary)' : 'var(--color-on-surface-variant)',
                              transition: 'all 0.15s ease',
                            }}
                          >
                            <Icon
                              name={sub.icon || 'circle'}
                              size={13}
                              color={isSubActive ? 'var(--color-primary)' : 'var(--color-on-surface-variant)'}
                            />
                            <span
                              style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                            >
                              {sub.label}
                            </span>
                          </Link>
                        );
                      })}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </nav>

        {/* User / Session Footer with Interactive Avatar & Edit Action */}
        <div
          style={{
            padding: isCollapsed ? '10px 8px' : '12px 14px',
            borderTop: '1px solid var(--color-outline-variant)',
            backgroundColor: 'var(--color-surface-container-low)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: isCollapsed ? 'center' : 'stretch',
            gap: 'var(--space-2)',
          }}
        >
          {isCollapsed ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 'var(--space-2)',
                width: '100%',
              }}
            >
              {/* Dedicated Expand Button when Collapsed */}
              <button
                onClick={() => {
                  setIsCollapsed(false);
                  setHoveredGroupId(null);
                }}
                style={{
                  width: '38px',
                  height: '38px',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'var(--color-surface-container-high)',
                  border: '1px solid var(--color-outline-variant)',
                  color: 'var(--color-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  boxShadow: 'var(--elevation-1)',
                  transition: 'all 0.15s ease',
                }}
                title="Expand sidebar (Uncollapse)"
              >
                <Icon name="chevron_right" size={20} />
              </button>

              {/* User Avatar Photo with Click to Edit */}
              <button
                onClick={() => setIsEditProfileOpen(true)}
                style={{
                  width: '38px',
                  height: '38px',
                  borderRadius: '50%',
                  padding: 0,
                  border: '2px solid var(--color-primary)',
                  backgroundColor: 'transparent',
                  cursor: 'pointer',
                  overflow: 'hidden',
                  boxShadow: 'var(--elevation-1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                title={`${session.name} (${session.role}), Click to edit profile`}
              >
                <img
                  src={session.avatarUrl || avatarDataUri(session.name)}
                  alt={session.name}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-2)' }}>
              {/* Profile Card Trigger */}
              <div
                onClick={() => setIsEditProfileOpen(true)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-3)',
                  overflow: 'hidden',
                  cursor: 'pointer',
                  flex: 1,
                  padding: `var(--space-1) var(--space-1)`,
                  borderRadius: 'var(--radius-sm)',
                  transition: 'background-color 0.15s ease',
                }}
                title="Click to update your profile details"
              >
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  <img
                    src={session.avatarUrl || avatarDataUri(session.name)}
                    alt={session.name}
                    style={{
                      width: '38px',
                      height: '38px',
                      borderRadius: '50%',
                      objectFit: 'cover',
                      border: '2px solid var(--color-primary)',
                      boxShadow: 'var(--elevation-1)',
                    }}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      bottom: '-1px',
                      right: '-1px',
                      width: '10px',
                      height: '10px',
                      borderRadius: '50%',
                      backgroundColor: 'var(--color-success)',
                      border: '2px solid var(--color-surface)',
                    }}
                  />
                </div>

                <div style={{ overflow: 'hidden' }}>
                  <div
                    style={{
                      fontWeight: 800,
                      fontSize: '12px',
                      color: 'var(--color-on-surface)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {session.name}
                  </div>
                  <div
                    style={{
                      color: 'var(--color-on-surface-variant)',
                      fontSize: '10.5px',
                      marginTop: 'var(--space-1)',
                      fontWeight: 600,
                    }}
                  >
                    Role: <span style={{ color: 'var(--color-primary)', fontWeight: 800 }}>{session.role}</span>
                  </div>
                </div>
              </div>

              {/* Actions: Edit + Switch */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                <button
                  onClick={() => setIsEditProfileOpen(true)}
                  style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'var(--color-surface-container)',
                    border: '1px solid var(--color-outline-variant)',
                    color: 'var(--color-on-surface-variant)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                  }}
                  title="Edit Profile"
                >
                  <Icon name="edit" size={14} />
                </button>

                <button
                  onClick={handleLogout}
                  style={{
                    padding: `var(--space-1) var(--space-2)`,
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'var(--color-surface-container)',
                    border: '1px solid var(--color-outline-variant)',
                    color: 'var(--color-on-surface-variant)',
                    fontSize: '10.5px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                  title="Switch profile / login with other role"
                >
                  Switch
                </button>
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* Main App Content Area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
        {/* Top App Bar Header with Expand/Collapse Trigger */}
        <header
          style={{
            height: '52px',
            backgroundColor: 'var(--color-surface)',
            borderBottom: '1px solid var(--color-outline-variant)',
            padding: `0 var(--space-5)`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
          }}
        >
          {/* Left Context Info & Sidebar Toggle */}
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
                border: '1px solid var(--color-outline-variant)',
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

            {/* Sharp Vector Material Icon instead of raw emoji */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <Icon name="factory" size={17} color="var(--color-primary)" />
              <span style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--color-on-surface)' }}>
                {session.plantName || 'Main Plant Cikarang'}
              </span>
            </div>

            {/* Decorative divider, not content: it carries no meaning a screen
                reader should announce, and holding it to text contrast would
                make it read as text. */}
            <span aria-hidden="true" style={{ color: 'var(--color-outline-variant)' }}>
              |
            </span>
            <span style={{ fontSize: '11.5px', color: 'var(--color-on-surface-variant)' }}>
              Shift 1 (07:00, 15:00 UTC+7)
            </span>
          </div>

          {/* Right Controls: Telemetry + Theme Selector + Quick User Photo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            {/* StatusBadge is a mirror component with no solid-fill prop,
 its default is a pale success-container pill. Overriding to
 a solid fill is scoped to this one instance, not global. */}
            <style>{`.fv-live-badge { background-color: var(--color-success)!important; color: var(--color-on-success)!important; }.fv-live-badge > span { background-color: var(--color-on-success)!important; box-shadow: 0 0 6px var(--color-on-success)!important; }
 `}</style>
            <StatusBadge status="online" label="Live" className="fv-live-badge" />

            {/* Dark / Light Toggle */}
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
                border: '1px solid var(--color-outline-variant)',
                color: 'var(--color-on-surface)',
                cursor: 'pointer',
              }}
              title="Toggle Light/Dark Theme"
            >
              <Icon name={themeMode === 'dark' ? 'light_mode' : 'dark_mode'} size={16} />
            </button>

            {/* Topbar Quick Profile Avatar Trigger */}
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
            </button>
          </div>
        </header>

        {/* Page View Body */}
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
              path="/order-receiving"
              element={
                <Guarded need="customer_order:create">
                  <OrderReceivingPage />
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

      {/* Edit Profile Modal */}
      <EditProfileModal
        isOpen={isEditProfileOpen}
        onClose={() => setIsEditProfileOpen(false)}
        session={session}
        onSave={handleSaveProfile}
      />
    </div>
  );
};

export default App;
