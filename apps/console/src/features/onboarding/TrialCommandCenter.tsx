import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { OnboardingChecklistItem } from '@factory-vision/domain-types';
import { Button, Icon } from '@factory-vision/ui';
import { SurfaceCard, toneColor, toneContainer, toneOnContainer } from '@factory-vision/ui/fv';
import { useOnboarding } from './OnboardingContext.js';

/**
 * What a bar is still missing, as links to where each item gets done.
 *
 * A percentage on its own sends the user to guess; the list under it is what
 * the number is made of, so "70%" and "Shift, Operator belum ada" are the same
 * fact said twice. Done items are folded into a count rather than listed —
 * the bar already shows them.
 */
const MissingItems: React.FC<{ items?: OnboardingChecklistItem[]; completeText: string; fallbackText: string }> = ({
  items,
  completeText,
  fallbackText,
}) => {
  const navigate = useNavigate();
  if (!items || items.length === 0) {
    return <span>{fallbackText}</span>;
  }
  const missing = items.filter((item) => !item.done);
  if (missing.length === 0) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
        <Icon name="check_circle" size={13} style={{ color: toneColor.success }} />
        {completeText}
      </span>
    );
  }
  return (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 6px' }}>
      <span>Belum lengkap ({missing.length} dari {items.length}):</span>
      {missing.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={item.path ? () => navigate(item.path!) : undefined}
          title={item.hint ? `${item.hint} (+${item.weight}%)` : `+${item.weight}%`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '3px',
            padding: '1px 8px',
            borderRadius: 'var(--radius-pill)',
            border: 'none',
            backgroundColor: 'var(--color-surface-container-high)',
            color: 'var(--color-primary)',
            fontSize: '10.5px',
            fontWeight: 700,
            cursor: item.path ? 'pointer' : 'default',
            fontFamily: 'inherit',
          }}
        >
          {item.label}
          <span style={{ color: 'var(--color-on-surface-variant)', fontWeight: 600 }}>+{item.weight}%</span>
          {item.path && <Icon name="arrow_forward" size={11} />}
        </button>
      ))}
    </span>
  );
};

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
          border: '1px solid var(--color-primary-soft, var(--color-border))',
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
            borderBottom: collapsed ? 'none' : '1px solid var(--color-border)',
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
                    color: readiness >= 100 ? toneColor.success : toneColor.primary,
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
                    backgroundColor: readiness >= 100 ? toneColor.success : 'var(--color-primary)',
                    borderRadius: 'var(--radius-full, 9999px)',
                    transition: 'width 400ms cubic-bezier(0.2, 0, 0, 1)',
                  }}
                />
              </div>
              <div style={{ fontSize: '10.5px', color: 'var(--color-on-surface-variant)', marginTop: '4px' }}>
                <MissingItems
                  items={progress.readinessItems}
                  completeText="Master data pabrik lengkap: plant, produk, line, mesin, proses, routing, shift, operator."
                  fallbackText="Terapkan Industry Template untuk melengkapi master data secara otomatis."
                />
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
                    color: activation >= 100 ? toneColor.success : toneColor.info,
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
                    backgroundColor: activation >= 100 ? toneColor.success : toneColor.info,
                    borderRadius: 'var(--radius-full, 9999px)',
                    transition: 'width 400ms cubic-bezier(0.2, 0, 0, 1)',
                  }}
                />
              </div>
              <div style={{ fontSize: '10.5px', color: 'var(--color-on-surface-variant)', marginTop: '4px' }}>
                <MissingItems
                  items={progress.activationItems}
                  completeText="Alur produksi lengkap: order → plan → work order → hasil produksi → KPI."
                  fallbackText="Selesaikan pesanan produksi pertama untuk mengaktifkan metrik OEE."
                />
              </div>
            </div>
          </div>
        )}
      </SurfaceCard>
    </div>
  );
};
