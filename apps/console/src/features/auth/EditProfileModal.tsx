import React, { useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Icon, Button } from '@factory-vision/ui';
import { UserSession, avatarDataUri } from './ConsoleAuth.js';

/** The largest photo accepted, in kilobytes. */
const MAX_PHOTO_KB = 500;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

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
  const fallbackAvatar = avatarDataUri(session.name);
  // Empty means "no photo": the initials avatar is drawn in its place and the
  // preference is cleared rather than pinned to a generated image.
  const [avatarUrl, setAvatarUrl] = useState(
    session.avatarUrl && session.avatarUrl !== fallbackAvatar ? session.avatarUrl : ''
  );
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [phone, setPhone] = useState(session.phone || '+62 812-3456-7890');
  const [showToast, setShowToast] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset so choosing the same file again after an error still fires change.
    e.target.value = '';
    if (!file) return;

    if (!ACCEPTED_TYPES.includes(file.type)) {
      setPhotoError('Format tidak didukung. Gunakan JPG, PNG, atau WebP.');
      return;
    }
    if (file.size > MAX_PHOTO_KB * 1024) {
      const sizeKb = Math.ceil(file.size / 1024).toLocaleString('id-ID');
      setPhotoError(`Ukuran foto ${sizeKb} KB melebihi batas ${MAX_PHOTO_KB} KB.`);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setAvatarUrl(typeof reader.result === 'string' ? reader.result : '');
      setPhotoError(null);
    };
    reader.onerror = () => setPhotoError('Foto tidak dapat dibaca. Coba file lain.');
    reader.readAsDataURL(file);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const updated: UserSession = {
      ...session,
      name,
      email,
      role,
      plantName,
      avatarUrl: avatarUrl || fallbackAvatar,
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
            border: '1px solid var(--color-border)',
            width: '100%',
            maxWidth: '520px',
            boxShadow: 'var(--elevation-4)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              padding: `var(--space-4) var(--space-5)`,
              borderBottom: '1px solid var(--color-border)',
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

          <form
            onSubmit={handleSubmit}
            style={{ padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}
          >
            {/* Avatar: an uploaded photo, kept as a data URI with the other
                display preferences. 500 KB is the ceiling so the stored
                preference stays well inside localStorage's budget. */}
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
                Foto Profil
              </label>

              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
                <img
                  src={avatarUrl || fallbackAvatar}
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
                    (e.target as HTMLImageElement).src = fallbackAvatar;
                  }}
                />

                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={handleFileChange}
                      style={{ display: 'none' }}
                    />
                    <Button
                      type="button"
                      variant="filled"
                      icon={<Icon name="upload" size={16} />}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      Unggah foto
                    </Button>
                    {avatarUrl && (
                      <Button
                        type="button"
                        variant="text"
                        onClick={() => {
                          setAvatarUrl('');
                          setPhotoError(null);
                        }}
                      >
                        Hapus
                      </Button>
                    )}
                  </div>
                  <span
                    style={{
                      fontSize: '11px',
                      color: photoError ? 'var(--color-error)' : 'var(--color-on-surface-variant)',
                      fontWeight: photoError ? 700 : 500,
                    }}
                    role={photoError ? 'alert' : undefined}
                  >
                    {photoError ?? `JPG, PNG, atau WebP · maksimal ${MAX_PHOTO_KB} KB`}
                  </span>
                </div>
              </div>
            </div>

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
                    border: '1px solid var(--color-border)',
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
                    border: '1px solid var(--color-border)',
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
                    border: '1px solid var(--color-border)',
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
                    border: '1px solid var(--color-border)',
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
                  border: '1px solid var(--color-border)',
                  backgroundColor: 'var(--color-surface-container)',
                  color: 'var(--color-on-surface)',
                  fontSize: '12px',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div
              style={{
                marginTop: 'var(--space-2)',
                paddingTop: 'var(--space-3)',
                borderTop: '1px solid var(--color-border)',
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
