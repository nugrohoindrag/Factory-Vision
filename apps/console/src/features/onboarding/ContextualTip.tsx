import React from 'react';
import { Button, Icon } from '@factory-vision/ui';
import { SurfaceCard, toneContainer, toneOnContainer } from '@factory-vision/ui/fv';
import { useOnboarding } from './OnboardingContext.js';

interface ContextualTipProps {
  id: string;
  title: string;
  description: string;
  icon?: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: React.CSSProperties;
}

export const ContextualTip: React.FC<ContextualTipProps> = ({
  id,
  title,
  description,
  icon = 'lightbulb',
  actionLabel,
  onAction,
  style,
}) => {
  const { isTooltipDismissed, dismissTooltip } = useOnboarding();

  if (isTooltipDismissed(id)) {
    return null;
  }

  return (
    <SurfaceCard
      padding="md"
      railTone="primary"
      style={{
        marginBottom: 'var(--space-4)',
        borderRadius: 'var(--radius-lg, 12px)',
        backgroundColor: 'var(--color-surface-container)',
        border: '1px solid var(--color-border)',
        ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '8px',
              backgroundColor: toneContainer.info,
              color: toneOnContainer.info,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Icon name={icon} size={18} />
          </div>

          <div>
            <div style={{ fontSize: '13.5px', fontWeight: 800, color: 'var(--color-on-surface)' }}>{title}</div>
            <div style={{ fontSize: '12.5px', color: 'var(--color-on-surface-variant)', marginTop: '2px', lineHeight: 1.5 }}>
              {description}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexShrink: 0 }}>
          {actionLabel && onAction && (
            <Button variant="outlined" size="sm" onClick={onAction} style={{ height: '28px', fontSize: '12px' }}>
              {actionLabel}
            </Button>
          )}

          <Button
            variant="text"
            size="sm"
            onClick={() => void dismissTooltip(id)}
            style={{ height: '28px', fontSize: '12px', color: 'var(--color-on-surface-variant)' }}
          >
            Paham
          </Button>
        </div>
      </div>
    </SurfaceCard>
  );
};
