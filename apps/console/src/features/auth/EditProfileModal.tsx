import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Icon, Button } from '@factory-vision/ui';
import { UserSession, OPEN_SOURCE_AVATARS } from './ConsoleAuth.js';

interface EditProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  session: UserSession;
  onSave: (updatedSession: UserSession) => void;
}

export const EditProfileModal: React.FC<EditProfileModalProps> = ({ isOpen, onClose, session, onSave }) => {
  const [name, setName] = useState(session.name);
  const [email, setEmail] = useState(session.email);
  const [role, setRole] = useState(session.role);
  const [plantName, setPlantName] = useState(session.plantName || 'Main Plant Cikarang');
  const [avatarUrl, setAvatarUrl] = useState(session.avatarUrl || OPEN_SOURCE_AVATARS[0].url);
  const [phone, setPhone] = useState(session.phone || '+62 812-3456-7890');
  const [customAvatarInput, setCustomAvatarInput] = useState('');
  const [showToast, setShowToast] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const updated: UserSession = {
      ...session,
      name,
      email,
      role,
      plantName,
      avatarUrl: customAvatarInput.trim() || avatarUrl,
      phone,
    };
    onSave(updated);
    setShowToast(true);
    setTimeout(() => {
      setShowToast(false);
      onClose();
    }, 800);
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          // The scrim token, mixed rather than a fixed black: on the light
          // theme a 65% black scrim is heavier than the design system intends.
          backgroundColor: 'color-mix(in srgb, var(--color-scrim) 65%, transparent)',
          backdropFilter: 'blur(6px)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 'var(--space-4)',
        }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ duration: 0.2 }}
          style={{
            backgroundColor: 'var(--color-surface)',
            borderRadius: 'var(--radius-xl)',
            border: '1px solid var(--color-outline-variant)',
            width: '100%',
            maxWidth: '520px',
            boxShadow: 'var(--elevation-4)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: `var(--space-4) var(--space-5)`,
              borderBottom: '1px solid var(--color-outline-variant)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              backgroundColor: 'var(--color-surface-container-low)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'var(--color-primary-container)',
                  color: 'var(--color-on-primary-container)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon name="manage_accounts" size={18} />
              </div>
              <div>
                <h2 style={{ fontSize: '15px', fontWeight: 800, margin: 0, color: 'var(--color-on-surface)' }}>
                  Update User Profile
                </h2>
                <p style={{ fontSize: '11px', margin: `var(--space-1) 0 0`, color: 'var(--color-on-surface-variant)' }}>
                  Modify your personal information, photo, and assigned plant
                </p>
              </div>
            </div>

            <button
              onClick={onClose}
              style={{
                width: '30px',
                height: '30px',
                borderRadius: '50%',
                border: 'none',
                backgroundColor: 'var(--color-surface-container)',
                color: 'var(--color-on-surface-variant)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name="close" size={16} />
            </button>
          </div>

          {/* Body Form */}
          <form
            onSubmit={handleSubmit}
            style={{ padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}
          >
            {/* Avatar Section */}
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '11px',
                  fontWeight: 700,
                  color: 'var(--color-on-surface-variant)',
                  textTransform: 'uppercase',
                  marginBottom: 'var(--space-2)',
                }}
              >
                Profile Photo (Select Open Source Preset or Custom URL)
              </label>

              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', marginBottom: 'var(--space-3)' }}>
                <img
                  src={customAvatarInput.trim() || avatarUrl}
                  alt={name}
                  style={{
                    width: '64px',
                    height: '64px',
                    borderRadius: '50%',
                    objectFit: 'cover',
                    border: '3px solid var(--color-primary)',
                    boxShadow: 'var(--elevation-2)',
                    flexShrink: 0,
                  }}
                  onError={(e) => {
                    // Fallback if custom URL fails
                    (e.target as HTMLImageElement).src = OPEN_SOURCE_AVATARS[0].url;
                  }}
                />

                {/* Preset Avatars Gallery */}
                <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                  {OPEN_SOURCE_AVATARS.map((av) => {
                    const isSelected = avatarUrl === av.url && !customAvatarInput.trim();
                    return (
                      <button
                        type="button"
                        key={av.id}
                        onClick={() => {
                          setAvatarUrl(av.url);
                          setCustomAvatarInput('');
                        }}
                        style={{
                          border: '2px solid transparent',
                          padding: 'var(--space-1)',
                          borderRadius: '50%',
                          backgroundColor: isSelected ? 'var(--color-primary)' : 'transparent',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                        title={av.label}
                      >
                        <img
                          src={av.url}
                          alt={av.label}
                          style={{
                            width: '36px',
                            height: '36px',
                            borderRadius: '50%',
                            objectFit: 'cover',
                          }}
                        />
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Custom Image URL Option */}
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <input
                  type="text"
                  placeholder="Or paste custom image URL (https://...)"
                  value={customAvatarInput}
                  onChange={(e) => setCustomAvatarInput(e.target.value)}
                  style={{
                    flex: 1,
                    padding: `var(--space-2) var(--space-3)`,
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--color-outline-variant)',
                    backgroundColor: 'var(--color-surface-container)',
                    color: 'var(--color-on-surface)',
                    fontSize: '11.5px',
                  }}
                />
              </div>
            </div>

            {/* Grid Fields */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '11px',
                    fontWeight: 700,
                    color: 'var(--color-on-surface-variant)',
                    marginBottom: 'var(--space-1)',
                  }}
                >
                  Full Name
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  style={{
                    width: '100%',
                    padding: `var(--space-2) var(--space-3)`,
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--color-outline-variant)',
                    backgroundColor: 'var(--color-surface-container)',
                    color: 'var(--color-on-surface)',
                    fontSize: '12px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '11px',
                    fontWeight: 700,
                    color: 'var(--color-on-surface-variant)',
                    marginBottom: 'var(--space-1)',
                  }}
                >
                  Email Address
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  style={{
                    width: '100%',
                    padding: `var(--space-2) var(--space-3)`,
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--color-outline-variant)',
                    backgroundColor: 'var(--color-surface-container)',
                    color: 'var(--color-on-surface)',
                    fontSize: '12px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '11px',
                    fontWeight: 700,
                    color: 'var(--color-on-surface-variant)',
                    marginBottom: 'var(--space-1)',
                  }}
                >
                  Operational Role
                </label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  style={{
                    width: '100%',
                    padding: `var(--space-2) var(--space-3)`,
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--color-outline-variant)',
                    backgroundColor: 'var(--color-surface-container)',
                    color: 'var(--color-on-surface)',
                    fontSize: '12px',
                    boxSizing: 'border-box',
                  }}
                >
                  <option value="SUPERVISOR">Production Supervisor</option>
                  <option value="PRODUCTION_MANAGER">Production Manager</option>
                  <option value="PPIC">PPIC Planner</option>
                  <option value="EXECUTIVE">Executive / Plant GM</option>
                  <option value="ADMIN">System Administrator</option>
                </select>
              </div>

              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '11px',
                    fontWeight: 700,
                    color: 'var(--color-on-surface-variant)',
                    marginBottom: 'var(--space-1)',
                  }}
                >
                  Assigned Plant
                </label>
                <select
                  value={plantName}
                  onChange={(e) => setPlantName(e.target.value)}
                  style={{
                    width: '100%',
                    padding: `var(--space-2) var(--space-3)`,
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--color-outline-variant)',
                    backgroundColor: 'var(--color-surface-container)',
                    color: 'var(--color-on-surface)',
                    fontSize: '12px',
                    boxSizing: 'border-box',
                  }}
                >
                  <option value="Main Plant Cikarang">Main Plant Cikarang</option>
                  <option value="Plant Karawang 2">Plant Karawang 2</option>
                  <option value="Plant Surabaya West">Plant Surabaya West</option>
                </select>
              </div>
            </div>

            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '11px',
                  fontWeight: 700,
                  color: 'var(--color-on-surface-variant)',
                  marginBottom: 'var(--space-1)',
                }}
              >
                Phone / WhatsApp Contact
              </label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                style={{
                  width: '100%',
                  padding: `var(--space-2) var(--space-3)`,
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--color-outline-variant)',
                  backgroundColor: 'var(--color-surface-container)',
                  color: 'var(--color-on-surface)',
                  fontSize: '12px',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Footer Actions */}
            <div
              style={{
                marginTop: 'var(--space-2)',
                paddingTop: 'var(--space-3)',
                borderTop: '1px solid var(--color-outline-variant)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              {showToast ? (
                <span
                  style={{
                    fontSize: '12px',
                    color: 'var(--color-success)',
                    fontWeight: 800,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-1)',
                  }}
                >
                  <Icon name="check_circle" size={16} /> Profile Saved Successfully!
                </span>
              ) : (
                <span style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
                  Changes take effect immediately
                </span>
              )}

              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <Button type="button" variant="text" onClick={onClose}>
                  Cancel
                </Button>
                <Button type="submit" variant="filled" icon={<Icon name="save" size={16} />}>
                  Save Changes
                </Button>
              </div>
            </div>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
