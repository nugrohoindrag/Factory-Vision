import React from 'react';

export interface FactoryVisionIconProps {
  size?: number | string;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * The FactoryVision emblem: concentric rings of dots.
 *
 * The colours are literal hex on purpose and this is one of the two files
 * allowed to name them. A logo is a fixed brand asset, not a themed surface —
 * re-pointing it at `--color-primary` would make it change with the palette,
 * which is the one thing a mark must never do.
 */
export const FactoryVisionIcon: React.FC<FactoryVisionIconProps> = ({
  size = 32,
  className,
  style,
}) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0, ...style }}
    >
      {/* Center dot - Deep Cobalt / Navy */}
      <circle cx="50" cy="50" r="9" fill="#00358E" />

      {/* Ring 1 - 6 Medium Navy / Royal Blue Dots */}
      <circle cx="70" cy="50" r="6.8" fill="#1D5BC7" />
      <circle cx="60" cy="67.32" r="6.8" fill="#1D5BC7" />
      <circle cx="40" cy="67.32" r="6.8" fill="#1D5BC7" />
      <circle cx="30" cy="50" r="6.8" fill="#1D5BC7" />
      <circle cx="40" cy="32.68" r="6.8" fill="#1D5BC7" />
      <circle cx="60" cy="32.68" r="6.8" fill="#1D5BC7" />

      {/* Ring 2 - 12 Royal / Sky Blue Dots */}
      <circle cx="83" cy="50" r="5" fill="#4280EA" />
      <circle cx="78.58" cy="66.5" r="5" fill="#4280EA" />
      <circle cx="66.5" cy="78.58" r="5" fill="#4280EA" />
      <circle cx="50" cy="83" r="5" fill="#4280EA" />
      <circle cx="33.5" cy="78.58" r="5" fill="#4280EA" />
      <circle cx="21.42" cy="66.5" r="5" fill="#4280EA" />
      <circle cx="17" cy="50" r="5" fill="#4280EA" />
      <circle cx="21.42" cy="33.5" r="5" fill="#4280EA" />
      <circle cx="33.5" cy="21.42" r="5" fill="#4280EA" />
      <circle cx="50" cy="17" r="5" fill="#4280EA" />
      <circle cx="66.5" cy="21.42" r="5" fill="#4280EA" />
      <circle cx="78.58" cy="33.5" r="5" fill="#4280EA" />

      {/* Ring 3 - 12 Outer Light Blue Dots */}
      <circle cx="92.5" cy="61.4" r="3.2" fill="#78A7F7" />
      <circle cx="81.1" cy="81.1" r="3.2" fill="#78A7F7" />
      <circle cx="61.4" cy="92.5" r="3.2" fill="#78A7F7" />
      <circle cx="38.6" cy="92.5" r="3.2" fill="#78A7F7" />
      <circle cx="18.9" cy="81.1" r="3.2" fill="#78A7F7" />
      <circle cx="7.5" cy="61.4" r="3.2" fill="#78A7F7" />
      <circle cx="7.5" cy="38.6" r="3.2" fill="#78A7F7" />
      <circle cx="18.9" cy="18.9" r="3.2" fill="#78A7F7" />
      <circle cx="38.6" cy="7.5" r="3.2" fill="#78A7F7" />
      <circle cx="61.4" cy="7.5" r="3.2" fill="#78A7F7" />
      <circle cx="81.1" cy="18.9" r="3.2" fill="#78A7F7" />
      <circle cx="92.5" cy="38.6" r="3.2" fill="#78A7F7" />
    </svg>
  );
};

export interface FactoryVisionLogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  variant?: 'full' | 'compact' | 'icon-only';
  tagline?: string;
  showTagline?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

const sizeConfig = {
  sm: {
    iconSize: 26,
    titleSize: '13.5px',
    taglineSize: '8.5px',
    gap: '8px',
  },
  md: {
    iconSize: 34,
    titleSize: '16px',
    taglineSize: '9.5px',
    gap: '10px',
  },
  lg: {
    iconSize: 44,
    titleSize: '20px',
    taglineSize: '11px',
    gap: '12px',
  },
  xl: {
    iconSize: 56,
    titleSize: '26px',
    taglineSize: '12.5px',
    gap: '14px',
  },
};

/**
 * FactoryVision Brand Logo Component
 * Incorporates the dot cluster emblem and the "FactoryVision" typography.
 */
export const FactoryVisionLogo: React.FC<FactoryVisionLogoProps> = ({
  size = 'md',
  variant = 'full',
  tagline = 'Manufacturing Execution System',
  showTagline = true,
  className = '',
  style,
}) => {
  const conf = sizeConfig[size];

  if (variant === 'icon-only') {
    return <FactoryVisionIcon size={conf.iconSize} className={className} style={style} />;
  }

  return (
    <div
      className={`factoryvision-brand-logo ${className}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: conf.gap,
        userSelect: 'none',
        ...style,
      }}
    >
      <FactoryVisionIcon size={conf.iconSize} />

      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', lineHeight: 1.15 }}>
        <div
          style={{
            fontWeight: 800,
            fontSize: conf.titleSize,
            letterSpacing: '-0.025em',
            color: 'var(--fv-text-main, var(--color-on-surface, #001D39))',
            display: 'flex',
            alignItems: 'baseline',
          }}
        >
          <span>Factory</span>
          <span style={{ color: 'var(--fv-deep, var(--color-primary, #0A4174))' }}>Vision</span>
        </div>

        {(variant === 'full' || showTagline) && tagline && (
          <div
            style={{
              fontSize: conf.taglineSize,
              fontWeight: 600,
              letterSpacing: '-0.01em',
              color: 'var(--fv-text-muted, var(--color-on-surface-variant, #49769F))',
              marginTop: '1.5px',
              whiteSpace: 'nowrap',
            }}
          >
            {tagline}
          </div>
        )}
      </div>
    </div>
  );
};

