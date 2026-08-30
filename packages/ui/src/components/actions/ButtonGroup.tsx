/**
 * @license MIT
 * ButtonGroup Component — Morphic Design System
 * 
 * Copyright (c) 2026 Morphic Design System Contributors
 */

import React from 'react';

export interface ButtonGroupProps {
  children: React.ReactNode;
  variant?: 'attached' | 'spaced';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const ButtonGroup: React.FC<ButtonGroupProps> = ({
  children,
  variant = 'attached',
  size = 'md',
  className = '',
}) => {
  if (variant === 'spaced') {
    return (
      <div
        className={`morphic-button-group-spaced ${className}`}
        style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
      >
        {children}
      </div>
    );
  }

  return (
    <div
      className={`morphic-button-group-attached ${className}`}
      style={{
        display: 'inline-flex',
        borderRadius: 'var(--radius-pill)',
        overflow: 'hidden',
        border: '1px solid var(--md-sys-color-border)',
      }}
    >
      {React.Children.map(children, (child, index) => {
        if (!React.isValidElement(child)) return child;
        return React.cloneElement(child as React.ReactElement<any>, {
          style: {
            borderRadius: '0',
            border: 'none',
            borderRight: index < React.Children.count(children) - 1 ? '1px solid var(--md-sys-color-border)' : 'none',
            ...(child.props.style || {}),
          },
        });
      })}
    </div>
  );
};
