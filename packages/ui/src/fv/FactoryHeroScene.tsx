import React from 'react';
import { motion, type MotionValue } from 'motion/react';

/**
 * The animated vector scene behind the plant hero.
 *
 * It is a stylised production line rather than decoration: gears drive a
 * conveyor, parts travel along it, a sensor sweeps the cell and the throughput
 * trace draws itself. Everything is stroked in `currentColor`, so the scene
 * inherits the hero's on-container text colour and follows theme and accent
 * with no colour of its own.
 *
 * Every looping animation is switched off when `reduced` is set; the scene then
 * renders as a still composition rather than disappearing.
 *
 * Strokes read `--color-on-primary`, the foreground meant to sit on a solid
 * `--color-primary` card (the hero's own background), not `--color-primary`
 * itself, which would paint the scene the same colour as what is behind it.
 */
export interface FactoryHeroSceneProps {
  reduced?: boolean;
  parallaxX?: MotionValue<number>;
  parallaxY?: MotionValue<number>;
}

const spin = (seconds: number, direction: 1 | -1) => ({
  animate: { rotate: 360 * direction },
  transition: { duration: seconds, repeat: Infinity, ease: 'linear' as const },
});

const Gear: React.FC<{
  cx: number;
  cy: number;
  r: number;
  teeth: number;
  seconds: number;
  direction: 1 | -1;
  reduced: boolean;
  opacity?: number;
}> = ({ cx, cy, r, teeth, seconds, direction, reduced, opacity = 0.5 }) => {
  const motionProps = reduced ? {} : spin(seconds, direction);
  return (
    <motion.g {...motionProps} style={{ transformOrigin: `${cx}px ${cy}px` }} opacity={opacity}>
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke="var(--color-on-primary, currentColor)"
        strokeWidth="2"
      />
      <circle
        cx={cx}
        cy={cy}
        r={r * 0.42}
        fill="none"
        stroke="var(--color-on-primary, currentColor)"
        strokeWidth="2"
      />
      {Array.from({ length: teeth }).map((_, i) => {
        const angle = (i / teeth) * Math.PI * 2;
        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r;
        return (
          <rect
            key={i}
            x={x - 3.5}
            y={y - 3.5}
            width="7"
            height="7"
            rx="1.5"
            fill="var(--color-on-primary, currentColor)"
            transform={`rotate(${(i / teeth) * 360} ${x} ${y})`}
          />
        );
      })}
    </motion.g>
  );
};

export const FactoryHeroScene: React.FC<FactoryHeroSceneProps> = ({
  reduced = false,
  parallaxX,
  parallaxY,
}) => {
  // Throughput trace, the same shape the KPI row reports, drawn as a curve.
  const trace = 'M 20 150 C 70 150, 80 118, 120 112 S 190 96, 226 68 S 290 44, 340 34';

  return (
    <motion.svg
      aria-hidden="true"
      viewBox="0 0 380 200"
      fill="none"
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        height: '100%',
        width: '46%',
        minWidth: '340px',
        pointerEvents: 'none',
        x: parallaxX,
        y: parallaxY,
      }}
    >
      {/* Cell floor grid */}
      <g opacity="0.14">
        <path
          d="M 0 40 H 380 M 0 90 H 380 M 0 140 H 380 M 0 190 H 380"
          stroke="var(--color-on-primary, currentColor)"
          strokeWidth="1"
          strokeDasharray="3 6"
        />
        <path
          d="M 60 0 V 200 M 140 0 V 200 M 220 0 V 200 M 300 0 V 200"
          stroke="var(--color-on-primary, currentColor)"
          strokeWidth="1"
          strokeDasharray="3 6"
        />
      </g>

      {/* Sensor sweep over the cell */}
      {!reduced &&
        [0, 1.6, 3.2].map((delay) => (
          <motion.circle
            key={delay}
            cx="300"
            cy="62"
            r="10"
            fill="none"
            stroke="var(--color-on-primary, currentColor)"
            strokeWidth="1.5"
            initial={{ r: 10, opacity: 0.5 }}
            animate={{ r: 58, opacity: 0 }}
            transition={{ duration: 4.8, repeat: Infinity, delay, ease: 'easeOut' }}
          />
        ))}
      <circle cx="300" cy="62" r="4" fill="var(--color-on-primary, currentColor)" opacity="0.8" />

      {/* Drive gears */}
      <Gear cx={78} cy={66} r={26} teeth={10} seconds={14} direction={1} reduced={reduced} opacity={0.6} />
      <Gear cx={126} cy={92} r={17} teeth={8} seconds={9} direction={-1} reduced={reduced} opacity={0.45} />

      {/* Conveyor rail, dashes travel to suggest flow */}
      <motion.path
        d="M 40 172 H 340"
        stroke="var(--color-on-primary, currentColor)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray="14 10"
        opacity="0.5"
        animate={reduced ? undefined : { strokeDashoffset: [0, -48] }}
        transition={reduced ? undefined : { duration: 1.6, repeat: Infinity, ease: 'linear' }}
      />

      {/* Parts riding the conveyor */}
      {!reduced &&
        [0, 1.3, 2.6].map((delay) => (
          <motion.rect
            key={delay}
            y="160"
            width="12"
            height="12"
            rx="2.5"
            fill="var(--color-on-primary, currentColor)"
            opacity="0.75"
            initial={{ x: 34 }}
            animate={{ x: 330 }}
            transition={{ duration: 3.9, repeat: Infinity, delay, ease: 'linear' }}
          />
        ))}

      {/* Throughput trace, drawn on entry */}
      <motion.path
        d={trace}
        stroke="var(--color-on-primary, currentColor)"
        strokeWidth="2.5"
        strokeLinecap="round"
        opacity="0.85"
        initial={reduced ? { pathLength: 1 } : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1.5, ease: [0.05, 0.7, 0.1, 1] }}
      />

      {/* Live tip of the trace */}
      <motion.circle
        cx="340"
        cy="34"
        r="4.5"
        fill="var(--color-on-primary, currentColor)"
        animate={reduced ? undefined : { opacity: [1, 0.35, 1], scale: [1, 1.5, 1] }}
        transition={reduced ? undefined : { duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
        style={{ transformOrigin: '340px 34px' }}
      />
    </motion.svg>
  );
};
