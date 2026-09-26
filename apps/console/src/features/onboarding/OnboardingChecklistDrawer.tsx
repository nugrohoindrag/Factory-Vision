import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Icon } from '@factory-vision/ui';
import { SurfaceCard, toneColor, toneContainer, toneOnContainer } from '@factory-vision/ui/fv';
import { useOnboarding } from './OnboardingContext.js';

interface OnboardingChecklistDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const OnboardingChecklistDrawer: React.FC<OnboardingChecklistDrawerProps> = ({ isOpen, onClose }) => {
  const navigate = useNavigate();
  const {
    progress,
    openWizard,
    openFirstWorkflow,
    openTour,
    openUpgrade,
    isTrialBannerDismissed,
    restoreTrialBanner,
  } = useOnboarding();

  if (!isOpen || !progress) return null;

  const stepsList = Object.values(progress.steps);
  const completedCount = stepsList.filter((s) => s.status === 'completed').length;
  const totalCount = stepsList.length;
  const showTrial = progress.trialStatus !== 'converted';
  const daysLeft = progress.daysRemaining ?? 14;
  const trialFigures = [
    { label: 'Kesiapan Data Pabrik', value: progress.readinessPercent ?? 0, tone: toneColor.primary },
    { label: 'Aktivasi Alur Produksi', value: progress.activationPercent ?? 0, tone: toneColor.info },
  ];

  const handleStepAction = (stepId: string) => {
    onClose();
    switch (stepId) {
      case 'factory_profile':
      case 'industry_selection':
      case 'template_application':
        openWizard();
        break;
      case 'starter_master_data':
        navigate('/settings?tab=products');
        break;
      case 'welcome_tour':
        openTour();
        break;
      case 'first_production_order':
      case 'first_work_order':
      case 'first_production_run':
      case 'first_production_result':
        openFirstWorkflow();
        break;
      default:
        break;
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1040,
        display: 'flex',
        justifyContent: 'flex-end',
        backgroundColor: 'color-mix(in srgb, var(--color-scrim) 50%, transparent)',
        backdropFilter: 'blur(4px)',
        fontFamily: 'var(--font-family)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '460px',
          height: '100%',
          backgroundColor: 'var(--color-surface)',
          borderLeft: '1px solid var(--color-border)',
          boxShadow: 'var(--elevation-5)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            padding: `var(--space-5) var(--space-6)`,
            borderBottom: '1px solid var(--color-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: 'var(--color-surface-container)',
          }}
        >
          <div>
            <div style={{ fontSize: '11px', fontWeight: 800, color: 'var(--color-primary)', textTransform: 'uppercase' }}>
              PANDUAN AKTIVASI MES
            </div>
            <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
              Checklist Onboarding
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--color-on-surface-variant)',
              padding: 'var(--space-2)',
            }}
          >
            <Icon name="close" size={20} />
          </button>
        </div>

        {/* Trial status: what the banner above the page shows, kept here so it
            can still be checked from any page after the banner is closed. */}
        {showTrial && (
          <div
            style={{
              padding: `var(--space-4) var(--space-6)`,
              borderBottom: '1px solid var(--color-border)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-3)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 'var(--space-1)',
                  padding: `var(--space-1) var(--space-3)`,
                  borderRadius: 'var(--radius-full, 9999px)',
                  backgroundColor: 'var(--color-primary)',
                  color: 'var(--color-on-primary)',
                  fontSize: '11px',
                  fontWeight: 800,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                }}
              >
                <Icon name="timer" size={14} />
                Free Trial · {daysLeft} hari tersisa
              </span>
              <Button
                variant="filled"
                size="sm"
                icon={<Icon name="stars" size={16} />}
                onClick={() => {
                  onClose();
                  openUpgrade();
                }}
                style={{ height: '30px', fontSize: '11.5px', fontWeight: 700 }}
              >
                Upgrade Paket
              </Button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
              {trialFigures.map((figure) => (
                <div key={figure.label}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-on-surface-variant)' }}>
                      {figure.label}
                    </span>
                    <span
                      style={{
                        fontSize: '12px',
                        fontWeight: 800,
                        color: figure.value >= 100 ? toneColor.success : figure.tone,
                      }}
                    >
                      {figure.value}%
                    </span>
                  </div>
                  <div
                    style={{
                      height: '6px',
                      borderRadius: '9999px',
                      backgroundColor: 'var(--color-surface-container-highest)',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: `${figure.value}%`,
                        backgroundColor: figure.value >= 100 ? toneColor.success : figure.tone,
                        borderRadius: '9999px',
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>

            {isTrialBannerDismissed && (
              <button
                type="button"
                onClick={restoreTrialBanner}
                style={{
                  alignSelf: 'flex-start',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 'var(--space-1)',
                  padding: 0,
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--color-primary)',
                  fontSize: '11.5px',
                  fontWeight: 700,
                  fontFamily: 'inherit',
                }}
              >
                <Icon name="visibility" size={14} />
                Tampilkan lagi banner trial di atas halaman
              </button>
            )}
          </div>
        )}

        <div
          style={{
            padding: `var(--space-4) var(--space-6)`,
            backgroundColor: 'var(--color-surface-container-low)',
            borderBottom: '1px solid var(--color-border)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
            <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-on-surface)' }}>
              Progres Setup ({completedCount} dari {totalCount} Selesai)
            </span>
            <span style={{ fontSize: '14px', fontWeight: 800, color: toneColor.primary }}>
              {Math.round((completedCount / totalCount) * 100)}%
            </span>
          </div>

          <div
            style={{
              height: '8px',
              borderRadius: '9999px',
              backgroundColor: 'var(--color-surface-container-highest)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${(completedCount / totalCount) * 100}%`,
                backgroundColor: 'var(--color-primary)',
                borderRadius: '9999px',
                transition: 'width 300ms ease',
              }}
            />
          </div>
        </div>

        <div style={{ flex: 1, padding: `var(--space-4) var(--space-6)`, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {stepsList.map((stepItem, idx) => {
            const isCompleted = stepItem.status === 'completed';
            return (
              <div
                key={stepItem.id}
                style={{
                  padding: 'var(--space-3) var(--space-4)',
                  borderRadius: 'var(--radius-md, 10px)',
                  border: '1px solid var(--color-border)',
                  backgroundColor: isCompleted ? 'var(--color-surface-container)' : 'var(--color-surface)',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 'var(--space-3)',
                }}
              >
                <div style={{ marginTop: '2px', flexShrink: 0 }}>
                  {isCompleted ? (
                    <span style={{ color: toneColor.success }}>
                      <Icon name="check_circle" size={20} />
                    </span>
                  ) : (
                    <span style={{ color: 'var(--color-outline)', display: 'inline-flex' }}>
                      <Icon name="radio_button_unchecked" size={20} />
                    </span>
                  )}
                </div>

                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div
                      style={{
                        fontSize: '13.5px',
                        fontWeight: 700,
                        color: isCompleted ? 'var(--color-on-surface)' : 'var(--color-on-surface)',
                        textDecoration: isCompleted ? 'none' : 'none',
                      }}
                    >
                      {idx + 1}. {stepItem.title}
                    </div>
                  </div>

                  <p style={{ margin: `var(--space-1) 0 var(--space-2)`, fontSize: '11.5px', color: 'var(--color-on-surface-variant)', lineHeight: 1.4 }}>
                    {stepItem.description}
                  </p>

                  {!isCompleted && (
                    <Button
                      variant="outlined"
                      size="sm"
                      onClick={() => handleStepAction(stepItem.id)}
                      icon={<Icon name="arrow_forward" size={14} />}
                      style={{ height: '28px', fontSize: '11.5px', padding: '0 var(--space-3)' }}
                    >
                      Mulai Langkah Ini
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div
          style={{
            padding: `var(--space-4) var(--space-6)`,
            borderTop: '1px solid var(--color-border)',
            backgroundColor: 'var(--color-surface-container)',
          }}
        >
          <Button
            variant="filled"
            onClick={() => {
              onClose();
              openFirstWorkflow();
            }}
            icon={<Icon name="play_arrow" size={16} />}
            style={{ width: '100%', height: '42px', fontWeight: 700 }}
          >
            Jalankan Alur Produksi Pertama
          </Button>
        </div>
      </div>
    </div>
  );
};
