import React from 'react';
import { Icon } from '@factory-vision/ui';

export interface SectionHeadingProps {
  icon: string;
  title: string;
  /** The management question this band answers ( "decision-oriented"). */
  question?: string;
  /** Right-aligned slot for a period selector or a drill-down link. */
  action?: React.ReactNode;
}

/**
 * Band label for one Executive Dashboard section.
 *
 * frames every band as the answer to a management question, so the
 * question is shown next to the title rather than left implicit, it is what
 * lets a reader scan the page in the under-10-seconds asks for.
 */
export const SectionHeading: React.FC<SectionHeadingProps> = ({ icon, title, question, action }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      gap: 'var(--space-3)',
      flexWrap: 'wrap',
      marginTop: 'var(--space-1)',
    }}
  >
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
      <Icon name={icon} size={14} color="var(--color-on-surface-variant)" />
      <span
        style={{
          fontSize: '11px',
          fontWeight: 700,
          color: 'var(--color-on-surface)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}
      >
        {title}
      </span>
      {question && (
        <span style={{ fontSize: '10.5px', color: 'var(--color-on-surface-variant)' }}>, {question}</span>
      )}
    </div>
    {action}
  </div>
);
