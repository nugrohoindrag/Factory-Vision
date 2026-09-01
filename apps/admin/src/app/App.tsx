import React from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Icon } from '@factory-vision/ui';
import { toneContainer, toneOnContainer } from '@factory-vision/ui/fv';
import { useSession } from './SessionContext.js';
import { AdminLogin } from '../features/auth/AdminLogin.js';
import { PortfolioPage } from '../features/clients/PortfolioPage.js';
import { ClientDetailPage } from '../features/clients/ClientDetailPage.js';
import { AuditPage } from '../features/audit/AuditPage.js';

const NAV = [
  { path: '/', label: 'Portofolio Klien', icon: 'apartment' },
  { path: '/audit', label: 'Audit Internal', icon: 'history' },
];

/**
 * The internal console shell.
 *
 * A standing banner marks it as internal: this tool shows every customer's
 * commercial record, and someone glancing at a shared screen should be able to
 * tell at once that it is not a customer's own console.
 */
export const App: React.FC = () => {
  const { principal, restoring, logout } = useSession();
  const location = useLocation();

  if (restoring) {
    return (
      <div
        style={{
          height: '100vh',
          display: 'grid',
          placeItems: 'center',
          backgroundColor: 'var(--color-background)',
          color: 'var(--color-on-background)',
          fontFamily: 'var(--font-family)',
        }}
      >
        Memuat sesi internal…
      </div>
    );
  }

  if (!principal) return <AdminLogin />;

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: 'var(--color-background)',
        color: 'var(--color-on-background)',
        fontFamily: 'var(--font-family)',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--space-4)',
          padding: `0 var(--space-5)`,
          height: '54px',
          backgroundColor: 'var(--color-surface)',
          borderBottom: '1px solid var(--color-outline-variant)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-5)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <span
              style={{
                padding: `var(--space-1) var(--space-3)`,
                borderRadius: 'var(--radius-full, 999px)',
                backgroundColor: toneContainer.warning,
                color: toneOnContainer.warning,
                fontSize: '10px',
                fontWeight: 800,
                letterSpacing: '0.05em',
              }}
            >
              INTERNAL
            </span>
            <span style={{ fontSize: '14px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
              Manajemen Klien
            </span>
          </div>

          <nav style={{ display: 'flex', gap: 'var(--space-1)' }}>
            {NAV.map((item) => {
              const active = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-2)',
                    padding: `var(--space-2) var(--space-3)`,
                    borderRadius: 'var(--radius-sm, 8px)',
                    textDecoration: 'none',
                    fontSize: '12.5px',
                    fontWeight: 700,
                    backgroundColor: active ? 'var(--color-primary)' : 'transparent',
                    color: active ? 'var(--color-on-primary)' : 'var(--color-on-surface-variant)',
                  }}
                >
                  <Icon name={item.icon} size={16} />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-on-surface)' }}>
              {principal.name}
            </div>
            <div style={{ fontSize: '10.5px', color: 'var(--color-on-surface-variant)' }}>{principal.role}</div>
          </div>
          <button
            type="button"
            onClick={logout}
            style={{
              padding: `var(--space-2) var(--space-3)`,
              borderRadius: 'var(--radius-sm, 8px)',
              border: '1px solid var(--color-outline-variant)',
              backgroundColor: 'var(--color-surface-container)',
              color: 'var(--color-on-surface-variant)',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: 'var(--font-family)',
            }}
          >
            Keluar
          </button>
        </div>
      </header>

      <main style={{ maxWidth: '1400px', margin: '0 auto' }}>
        <Routes>
          <Route path="/" element={<PortfolioPage />} />
          <Route path="/clients/:id" element={<ClientDetailPage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
};

export default App;
