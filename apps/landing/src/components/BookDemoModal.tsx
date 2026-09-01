import React, { useState } from 'react';
import { Icon } from '@factory-vision/ui';

interface BookDemoModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const BookDemoModal: React.FC<BookDemoModalProps> = ({ isOpen, onClose }) => {
  const [submitted, setSubmitted] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    company: '',
    role: '',
    plantScale: '1-3 Lines',
    industry: 'Discrete Machining & Assembly',
    notes: '',
  });

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
  };

  return (
    <div className="fv-modal-overlay" onClick={onClose}>
      <div className="fv-modal-content" onClick={(e) => e.stopPropagation()}>
        {/* Close Button */}
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '24px',
            right: '24px',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--color-on-surface-variant)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 'var(--space-1)',
            borderRadius: '50%',
          }}
        >
          <Icon name="close" size={24} />
        </button>

        {!submitted ? (
          <div>
            <div style={{ marginBottom: 'var(--space-6)' }}>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                  padding: `var(--space-1) var(--space-3)`,
                  borderRadius: '9999px',
                  backgroundColor: 'var(--color-info-container)',
                  color: 'var(--color-on-info-container)',
                  border: '1px solid var(--color-info-container)',
                  fontSize: '12px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  marginBottom: 'var(--space-3)',
                }}
              >
                <Icon name="calendar_today" size={14} />
                Live Demo
              </div>
              <h3 style={{ fontSize: '26px', fontWeight: 800, color: 'var(--color-on-primary)', marginBottom: 'var(--space-2)' }}>
                Schedule a Guided Plant Walkthrough
              </h3>
              <p style={{ fontSize: '14px', color: 'var(--color-on-primary)', lineHeight: 1.5 }}>
                See how Factory Vision can digitize your specific manufacturing workflow, work orders, and OEE tracking.
              </p>
            </div>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, marginBottom: 'var(--space-2)', color: 'var(--color-on-primary)' }}>
                    Your Name *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Budi Pratama"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    style={{
                      width: '100%',
                      padding: `var(--space-3) var(--space-4)`,
                      borderRadius: '10px',
                      border: '1px solid color-mix(in srgb, var(--color-on-primary) 24%, transparent)',
                      backgroundColor: 'var(--color-primary)',
                      color: 'var(--color-on-primary)',
                      fontSize: '14px',
                      outline: 'none',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, marginBottom: 'var(--space-2)', color: 'var(--color-on-primary)' }}>
                    Work Email *
                  </label>
                  <input
                    type="email"
                    required
                    placeholder="budi@company.com"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    style={{
                      width: '100%',
                      padding: `var(--space-3) var(--space-4)`,
                      borderRadius: '10px',
                      border: '1px solid color-mix(in srgb, var(--color-on-primary) 24%, transparent)',
                      backgroundColor: 'var(--color-primary)',
                      color: 'var(--color-on-primary)',
                      fontSize: '14px',
                      outline: 'none',
                    }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, marginBottom: 'var(--space-2)', color: 'var(--color-on-primary)' }}>
                    Company / Factory *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="PT Precision Parts"
                    value={formData.company}
                    onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                    style={{
                      width: '100%',
                      padding: `var(--space-3) var(--space-4)`,
                      borderRadius: '10px',
                      border: '1px solid color-mix(in srgb, var(--color-on-primary) 24%, transparent)',
                      backgroundColor: 'var(--color-primary)',
                      color: 'var(--color-on-primary)',
                      fontSize: '14px',
                      outline: 'none',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, marginBottom: 'var(--space-2)', color: 'var(--color-on-primary)' }}>
                    Job Role
                  </label>
                  <input
                    type="text"
                    placeholder="Plant Manager / PPIC Lead"
                    value={formData.role}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                    style={{
                      width: '100%',
                      padding: `var(--space-3) var(--space-4)`,
                      borderRadius: '10px',
                      border: '1px solid color-mix(in srgb, var(--color-on-primary) 24%, transparent)',
                      backgroundColor: 'var(--color-primary)',
                      color: 'var(--color-on-primary)',
                      fontSize: '14px',
                      outline: 'none',
                    }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, marginBottom: 'var(--space-2)', color: 'var(--color-on-primary)' }}>
                    Plant Scale
                  </label>
                  <select
                    value={formData.plantScale}
                    onChange={(e) => setFormData({ ...formData, plantScale: e.target.value })}
                    style={{
                      width: '100%',
                      padding: `var(--space-3) var(--space-4)`,
                      borderRadius: '10px',
                      border: '1px solid color-mix(in srgb, var(--color-on-primary) 24%, transparent)',
                      backgroundColor: 'var(--color-primary)',
                      color: 'var(--color-on-primary)',
                      fontSize: '14px',
                      outline: 'none',
                    }}
                  >
                    <option value="1-3 Lines">1 – 3 Production Lines</option>
                    <option value="4-10 Lines">4 – 10 Production Lines</option>
                    <option value="10+ Lines">10+ Lines (Multi-Plant Enterprise)</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, marginBottom: 'var(--space-2)', color: 'var(--color-on-primary)' }}>
                    Industry Sector
                  </label>
                  <select
                    value={formData.industry}
                    onChange={(e) => setFormData({ ...formData, industry: e.target.value })}
                    style={{
                      width: '100%',
                      padding: `var(--space-3) var(--space-4)`,
                      borderRadius: '10px',
                      border: '1px solid color-mix(in srgb, var(--color-on-primary) 24%, transparent)',
                      backgroundColor: 'var(--color-primary)',
                      color: 'var(--color-on-primary)',
                      fontSize: '14px',
                      outline: 'none',
                    }}
                  >
                    <option value="Discrete Machining & Assembly">Discrete Machining & Assembly</option>
                    <option value="Automotive & Tier-1 Components">Automotive & Tier-1 Components</option>
                    <option value="Electronics & PCB Manufacturing">Electronics & PCB Manufacturing</option>
                    <option value="FMCG & Packaging">FMCG & Packaging</option>
                    <option value="Plastic Injection & Stamping">Plastic Injection & Stamping</option>
                    <option value="Other Manufacturing">Other Manufacturing</option>
                  </select>
                </div>
              </div>

              <button
                type="submit"
                className="fv-btn-primary"
                style={{
                  width: '100%',
                  padding: 'var(--space-4)',
                  fontSize: '16px',
                  marginTop: 'var(--space-2)',
                }}
              >
                Confirm Demo Request
                <Icon name="arrow_forward" size={18} />
              </button>
            </form>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: `var(--space-6) var(--space-3)` }}>
            <div
              style={{
                width: '64px',
                height: '64px',
                borderRadius: '50%',
                backgroundColor: 'var(--color-success-container)',
                color: 'var(--color-on-success-container)',
                border: '1px solid var(--color-success-container)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 20px',
              }}
            >
              <Icon name="check_circle" size={36} />
            </div>
            <h3 style={{ fontSize: '24px', fontWeight: 800, color: 'var(--color-on-primary)', marginBottom: 'var(--space-2)' }}>
              Demo Request Received!
            </h3>
            <p style={{ fontSize: '15px', color: 'var(--color-on-primary)', maxWidth: '420px', margin: '0 auto 24px', lineHeight: 1.55 }}>
              Thank you, <strong style={{ color: 'var(--color-on-primary)' }}>{formData.name}</strong>. Our solutions engineering team will reach out to <strong style={{ color: 'var(--color-info)' }}>{formData.email}</strong> within 24 hours to coordinate your custom plant walkthrough.
            </p>
            <button
              onClick={() => {
                setSubmitted(false);
                onClose();
              }}
              className="fv-btn-secondary"
              style={{ padding: `var(--space-3) var(--space-8)` }}
            >
              Close Window
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
