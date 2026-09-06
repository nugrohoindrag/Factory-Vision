import React, { useState } from 'react';
import { Button, Icon } from '@factory-vision/ui';
import { SurfaceCard, toneColor, toneContainer, toneOnContainer } from '@factory-vision/ui/fv';
import { useOnboarding } from './OnboardingContext.js';

export const TrialCommandCenter: React.FC = () => {
  const { progress, openChecklist, openUpgrade, openWizard } = useOnboarding();
  const [collapsed, setCollapsed] = useState<boolean>(false);

  if (!progress || progress.trialStatus === 'converted') {
    return null;
  }

  const daysLeft = progress.daysRemaining ?? 14;
  const readiness = progress.readinessPercent ?? 0;
  const activation = progress.activationPercent ?? 0;

  return (
    <div
      style={{
        padding: `var(--space-2) var(--space-6) 0`,
        position: 'relative',
        zIndex: 20,
      }}
    >
      <SurfaceCard
        padding="none"
        style={{
          borderRadius: 'var(--radius-lg, 12px)',
          border: '1px solid var(--color-primary-soft, var(--color-outline-variant))',
          backgroundColor: 'var(--color-surface)',
          boxShadow: 'var(--elevation-1)',
          overflow: 'hidden',
          transition: 'all 200ms ease',
        }}
      >
        {/* Top Header Bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: `var(--space-2) var(--space-4)`,
            backgroundColor: 'var(--color-surface-container)',
            borderBottom: collapsed ? 'none' : '1px solid var(--color-outline-variant)',
            flexWrap: 'wrap',
            gap: 'var(--space-2)',
          }}
        >
          {/* Trial Tag & Readiness Summary */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 'var(--space-1)',
                padding: `var(--space-1) var(--space-3)`,
                borderRadius: 'var(--radius-full, 9999px)',
                backgroundColor: 'var(--color-primary)',
                color: 'var(--color-on-primary)',
                fontSize: '11.5px',
                fontWeight: 800,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
              }}
            >
              <Icon name="timer" size={14} />
              <span>FREE TRIAL · {daysLeft} HARI TERSISA</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-on-surface)' }}>
                {progress.factoryProfile?.factoryName || 'Factory Vision Workspace'}
              </span>
              {progress.templateApplied && (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 'var(--space-1)',
                    padding: `2px var(--space-2)`,
                    borderRadius: 'var(--radius-xs, 4px)',
                    backgroundColor: toneContainer.info,
                    color: toneOnContainer.info,
                    fontSize: '11px',
                    fontWeight: 700,
                    textTransform: 'capitalize',
                  }}
                >
                  <Icon name="verified" size={12} />
                  Template {progress.templateApplied}
                </span>
              )}
            </div>
          </div>

          {/* Action Buttons & Collapse Toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <Button
              variant="outlined"
              size="sm"
              icon={<Icon name="checklist" size={16} />}
              onClick={openChecklist}
              style={{ height: '32px', fontSize: '12px', fontWeight: 700 }}
            >
              Checklist Onboarding ({readiness}% Siap)
            </Button>

            {readiness === 0 && (
              <Button
                variant="filled"
                size="sm"
                icon={<Icon name="play_arrow" size={16} />}
                onClick={openWizard}
                style={{ height: '32px', fontSize: '12px', fontWeight: 700 }}
              >
                Mulai Setup Pabrik
              </Button>
            )}

            <Button
              variant="filled"
              size="sm"
              icon={<Icon name="stars" size={16} />}
              onClick={openUpgrade}
              style={{
                height: '32px',
                fontSize: '12px',
                fontWeight: 700,
                backgroundColor: 'var(--color-primary)',
                color: 'var(--color-on-primary)',
              }}
            >
              Upgrade Paket
            </Button>

            <button
              type="button"
              onClick={() => setCollapsed(!collapsed)}
              title={collapsed ? 'Perluas detail trial' : 'Sembunyikan detail'}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 'var(--space-1)',
                color: 'var(--color-on-surface-variant)',
              }}
            >
              <Icon name={collapsed ? 'expand_more' : 'expand_less'} size={20} />
            </button>
          </div>
        </div>

        {/* Expanded Progress Strip */}
        {!collapsed && (
          <div
            style={{
              padding: `var(--space-3) var(--space-4)`,
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: 'var(--space-4)',
              alignItems: 'center',
              backgroundColor: 'var(--color-surface)',
            }}
          >
            {/* 1. Factory Readiness Bar */}
            <div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 'var(--space-1)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                  <Icon name="tune" size={14} style={{ color: toneColor.primary }} />
                  <span style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--color-on-surface)' }}>
                    Kesiapan Data Pabrik (Factory Readiness)
                  </span>
                </div>
                <span
                  style={{
                    fontSize: '12px',
                    fontWeight: 800,
                    color: readiness >= 70 ? toneColor.success : toneColor.primary,
                  }}
                >
                  {readiness}%
                </span>
              </div>
              <div
                style={{
                  height: '8px',
                  borderRadius: 'var(--radius-full, 9999px)',
                  backgroundColor: 'var(--color-surface-container-highest)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${readiness}%`,
                    backgroundColor: readiness >= 70 ? toneColor.success : 'var(--color-primary)',
                    borderRadius: 'var(--radius-full, 9999px)',
                    transition: 'width 400ms cubic-bezier(0.2, 0, 0, 1)',
                  }}
                />
              </div>
              <div style={{ fontSize: '10.5px', color: 'var(--color-on-surface-variant)', marginTop: '4px' }}>
                {readiness >= 70
                  ? 'Master data starter, mesin, dan alur proses siap digunakan.'
                  : 'Terapkan Industry Template untuk melengkapi master data secara otomatis.'}
              </div>
            </div>

            {/* 2. MES Activation Bar */}
            <div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 'var(--space-1)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                  <Icon name="rocket_launch" size={14} style={{ color: toneColor.info }} />
                  <span style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--color-on-surface)' }}>
                    Aktivasi Alur Produksi (Activation)
                  </span>
                </div>
                <span
                  style={{
                    fontSize: '12px',
                    fontWeight: 800,
                    color: activation >= 70 ? toneColor.success : toneColor.info,
                  }}
                >
                  {activation}%
                </span>
              </div>
              <div
                style={{
                  height: '8px',
                  borderRadius: 'var(--radius-full, 9999px)',
                  backgroundColor: 'var(--color-surface-container-highest)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${activation}%`,
                    backgroundColor: activation >= 70 ? toneColor.success : toneColor.info,
                    borderRadius: 'var(--radius-full, 9999px)',
                    transition: 'width 400ms cubic-bezier(0.2, 0, 0, 1)',
                  }}
                />
              </div>
              <div style={{ fontSize: '10.5px', color: 'var(--color-on-surface-variant)', marginTop: '4px' }}>
                {activation >= 70
                  ? 'Workflow produksi telah berjalan dan menghasilkan KPI real-time.'
                  : 'Selesaikan pesanan produksi pertama untuk mengaktifkan metrik OEE.'}
              </div>
            </div>
          </div>
        )}
      </SurfaceCard>
    </div>
  );
};
