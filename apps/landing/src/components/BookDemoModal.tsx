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
            color: '#8E9BAE',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '4px',
            borderRadius: '50%',
          }}
        >
          <Icon name="close" size={24} />
        </button>

        {!submitted ? (
          <div>
            <div style={{ marginBottom: '24px' }}>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '4px 12px',
                  borderRadius: '9999px',
                  backgroundColor: 'rgba(56, 189, 248, 0.15)',
                  color: '#38BDF8',
                  border: '1px solid rgba(56, 189, 248, 0.35)',
                  fontSize: '12px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  marginBottom: '10px',
                }}
              >
                <Icon name="calendar_today" size={14} />
                Live Demo
              </div>
              <h3 style={{ fontSize: '26px', fontWeight: 800, color: '#FFFFFF', marginBottom: '6px' }}>
                Schedule a Guided Plant Walkthrough
              </h3>
              <p style={{ fontSize: '14px', color: '#BDD8E9', lineHeight: 1.5 }}>
                See how Factory Vision can digitize your specific manufacturing workflow, work orders, and OEE tracking.
              </p>
            </div>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, marginBottom: '6px', color: '#FFFFFF' }}>
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
                      padding: '12px 14px',
                      borderRadius: '10px',
                      border: '1px solid #282C37',
                      backgroundColor: '#121418',
                      color: '#FFFFFF',
                      fontSize: '14px',
                      outline: 'none',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, marginBottom: '6px', color: '#FFFFFF' }}>
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
                      padding: '12px 14px',
                      borderRadius: '10px',
                      border: '1px solid #282C37',
                      backgroundColor: '#121418',
                      color: '#FFFFFF',
                      fontSize: '14px',
                      outline: 'none',
                    }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, marginBottom: '6px', color: '#FFFFFF' }}>
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
                      padding: '12px 14px',
                      borderRadius: '10px',
                      border: '1px solid #282C37',
                      backgroundColor: '#121418',
                      color: '#FFFFFF',
                      fontSize: '14px',
                      outline: 'none',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, marginBottom: '6px', color: '#FFFFFF' }}>
                    Job Role
                  </label>
                  <input
                    type="text"
                    placeholder="Plant Manager / PPIC Lead"
                    value={formData.role}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '12px 14px',
                      borderRadius: '10px',
                      border: '1px solid #282C37',
                      backgroundColor: '#121418',
                      color: '#FFFFFF',
                      fontSize: '14px',
                      outline: 'none',
                    }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, marginBottom: '6px', color: '#FFFFFF' }}>
                    Plant Scale
                  </label>
                  <select
                    value={formData.plantScale}
                    onChange={(e) => setFormData({ ...formData, plantScale: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '12px 14px',
                      borderRadius: '10px',
                      border: '1px solid #282C37',
                      backgroundColor: '#121418',
                      color: '#FFFFFF',
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
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, marginBottom: '6px', color: '#FFFFFF' }}>
                    Industry Sector
                  </label>
                  <select
                    value={formData.industry}
                    onChange={(e) => setFormData({ ...formData, industry: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '12px 14px',
                      borderRadius: '10px',
                      border: '1px solid #282C37',
                      backgroundColor: '#121418',
                      color: '#FFFFFF',
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
                  padding: '14px',
                  fontSize: '16px',
                  marginTop: '8px',
                }}
              >
                Confirm Demo Request
                <Icon name="arrow_forward" size={18} />
              </button>
            </form>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '24px 12px' }}>
            <div
              style={{
                width: '64px',
                height: '64px',
                borderRadius: '50%',
                backgroundColor: 'rgba(16, 185, 129, 0.15)',
                color: '#10B981',
                border: '1px solid rgba(16, 185, 129, 0.35)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 20px',
              }}
            >
              <Icon name="check_circle" size={36} />
            </div>
            <h3 style={{ fontSize: '24px', fontWeight: 800, color: '#FFFFFF', marginBottom: '8px' }}>
              Demo Request Received!
            </h3>
            <p style={{ fontSize: '15px', color: '#BDD8E9', maxWidth: '420px', margin: '0 auto 24px', lineHeight: 1.55 }}>
              Thank you, <strong style={{ color: '#FFFFFF' }}>{formData.name}</strong>. Our solutions engineering team will reach out to <strong style={{ color: '#38BDF8' }}>{formData.email}</strong> within 24 hours to coordinate your custom plant walkthrough.
            </p>
            <button
              onClick={() => {
                setSubmitted(false);
                onClose();
              }}
              className="fv-btn-secondary"
              style={{ padding: '12px 28px' }}
            >
              Close Window
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
