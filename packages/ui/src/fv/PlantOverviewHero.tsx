import React, { useRef } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'motion/react';
import { Icon } from '../components/communication/index.js';
import { M3_TRANSITIONS, useReducedMotionSafe } from '../motion/index.js';
import { FactoryHeroScene } from './FactoryHeroScene.js';

/**
 * Factory Vision, plant overview hero ( Surfaces, Motion).
 *
 * Differs from the system example in two ways:
 *
 * - The surface is solid `primary` rather than a gradient or a pale
 * container, per the filled-surface rule in Docs/DESIGN-SYSTEM-GUIDELINE.md.
 * Colour comes from the accent, so the hero re-tints along with the rest
 * of the app, and reads as the boldest surface on the page.
 * - The decorative panel is replaced by `FactoryHeroScene`, a running
 * production-line vector that drifts against the pointer.
 *
 * The copy itself never moves, so the hero stays readable while it animates,
 * and everything collapses to a still frame under `prefers-reduced-motion`.
 */
export interface PlantOverviewHeroProps {
  plantName?: string;
  activeShift?: string;
  oeeScore?: string;
  currentOutput?: string;
  targetOutput?: string;
  completionRate?: string;
  activeLinesCount?: string;
  onNewWorkOrder?: () => void;
  onQualityAudit?: () => void;
  onReportIncident?: () => void;
  className?: string;
}

export const PlantOverviewHero: React.FC<PlantOverviewHeroProps> = ({
  plantName = 'Smart Factory Plant, Cikarang',
  activeShift = 'Shift 1 (Pagi) • 07:00 - 15:00 WIB',
  oeeScore = '88.4%',
  currentOutput = '142.850 Unit',
  targetOutput = '160.000 Unit Target',
  completionRate = '89.3% Tercapai',
  activeLinesCount = '7 dari 8 Lini Beroperasi Aktif',
  onNewWorkOrder,
  onQualityAudit,
  onReportIncident,
  className = '',
}) => {
  const reduced = useReducedMotionSafe();
  const ref = useRef<HTMLDivElement>(null);

  const pointerX = useMotionValue(0.5);
  const pointerY = useMotionValue(0.5);
  const smoothX = useSpring(pointerX, { stiffness: 220, damping: 26 });
  const smoothY = useSpring(pointerY, { stiffness: 220, damping: 26 });

  // The scene drifts against the pointer; the copy stays put.
  const sceneX = useTransform(smoothX, [0, 1], reduced ? [0, 0] : [14, -14]);
  const sceneY = useTransform(smoothY, [0, 1], reduced ? [0, 0] : [10, -10]);

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (reduced) return;
    const r = e.currentTarget.getBoundingClientRect();
    pointerX.set((e.clientX - r.left) / r.width);
    pointerY.set((e.clientY - r.top) / r.height);
  };

  const resetPointer = () => {
    pointerX.set(0.5);
    pointerY.set(0.5);
  };

  const secondaryActions = [
    { label: 'Inspeksi Kualitas (QC)', icon: 'fact_check', onClick: onQualityAudit },
    { label: 'Lapor Downtime Mesin', icon: 'warning_amber', onClick: onReportIncident },
  ];

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: reduced ? 0 : 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={M3_TRANSITIONS.enter}
      onPointerMove={handlePointerMove}
      onPointerLeave={resetPointer}
      style={{
        borderRadius: 'var(--radius-hero)',
        padding: '18px 20px',
        backgroundColor: 'var(--color-primary)',
        color: 'var(--color-on-primary)',
        border: '1px solid var(--color-border)',
        position: 'relative',
        overflow: 'hidden',
        boxShadow: 'var(--elevation-1)',
      }}
      className={`fv-plant-hero ${className}`}
    >
      <FactoryHeroScene reduced={reduced} parallaxX={sceneX} parallaxY={sceneY} />

      {/* Header: plant identity and OEE */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: '16px',
          position: 'relative',
          zIndex: 1,
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <motion.span
              animate={reduced ? undefined : { opacity: [1, 0.35, 1] }}
              transition={reduced ? undefined : { duration: 2, repeat: Infinity, ease: 'easeInOut' }}
              style={{
                width: '8px',
                height: '8px',
                borderRadius: 'var(--radius-pill)',
                backgroundColor: 'var(--color-success)',
                display: 'inline-block',
              }}
            />
            <span
              style={{
                fontSize: '12px',
                fontWeight: 700,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
              }}
            >
              {plantName}
            </span>
          </div>
          <div style={{ fontSize: '11px', marginTop: '3px', opacity: 0.85 }}>
            {activeShift} • <strong>{activeLinesCount}</strong>
          </div>
        </div>

        <div
          style={{
            padding: '5px 13px',
            borderRadius: 'var(--radius-pill)',
            backgroundColor: 'var(--color-surface)',
            color: 'var(--color-on-surface)',
            fontSize: 'var(--font-size-meta)',
            fontWeight: 700,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            whiteSpace: 'nowrap',
          }}
        >
          <Icon name="verified" size={16} />
          <span>OEE: {oeeScore}</span>
        </div>
      </div>

      {/* Throughput */}
      <div style={{ margin: '18px 0 20px', position: 'relative', zIndex: 1 }}>
        <div style={{ fontSize: '12px', fontWeight: 500, opacity: 0.85 }}>
          Throughput Produksi Real-time Shift Ini
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: '16px',
            marginTop: '4px',
            flexWrap: 'wrap',
          }}
        >
          <span
            style={{
              fontSize: 'var(--md-sys-typescale-metric-size)',
              fontWeight: 'var(--md-sys-typescale-metric-weight)' as React.CSSProperties['fontWeight'],
              letterSpacing: 'var(--md-sys-typescale-metric-tracking)',
              lineHeight: 'var(--md-sys-typescale-metric-line-height)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {currentOutput}
          </span>
          <span style={{ fontSize: '14px', fontWeight: 600, opacity: 0.85 }}>/ {targetOutput}</span>
          <span
            style={{
              fontSize: '12px',
              padding: '3px 10px',
              borderRadius: 'var(--radius-pill)',
              backgroundColor: 'var(--color-success)',
              color: 'var(--color-on-success)',
              fontWeight: 400,
            }}
          >
            {completionRate}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div
        style={{
          display: 'flex',
          gap: '10px',
          flexWrap: 'wrap',
          position: 'relative',
          zIndex: 1,
        }}
      >
        <motion.button
          whileHover={reduced ? undefined : { y: -2 }}
          whileTap={reduced ? undefined : { scale: 0.97 }}
          transition={M3_TRANSITIONS.button}
          onClick={onNewWorkOrder}
          style={{
            height: '36px',
            padding: '0 16px',
            borderRadius: 'var(--radius-pill)',
            border: 'none',
            backgroundColor: 'var(--color-on-primary)',
            color: 'var(--color-primary)',
            fontWeight: 700,
            fontSize: '13px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            cursor: 'pointer',
            boxShadow: 'var(--elevation-1)',
          }}
        >
          <Icon name="add_task" size={16} />
          <span>Jadwalkan Work Order</span>
        </motion.button>

        {secondaryActions.map((action) => (
          <motion.button
            key={action.label}
            whileHover={reduced ? undefined : { y: -2 }}
            whileTap={reduced ? undefined : { scale: 0.97 }}
            transition={M3_TRANSITIONS.button}
            onClick={action.onClick}
            style={{
              height: '36px',
              padding: '0 15px',
              borderRadius: 'var(--radius-pill)',
              border: 'none',
              backgroundColor: 'var(--color-surface)',
              color: 'var(--color-on-surface)',
              fontWeight: 600,
              fontSize: '13px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              cursor: 'pointer',
            }}
          >
            <Icon name={action.icon} size={16} />
            <span>{action.label}</span>
          </motion.button>
        ))}
      </div>
    </motion.div>
  );
};
