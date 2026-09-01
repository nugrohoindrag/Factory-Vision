import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Icon } from '@factory-vision/ui';
import {
  getSyncStatus,
  listFailedCommands,
  retryFailedCommands,
  subscribeSyncStatus,
  syncQueue,
  type SyncStatus,
} from '../../offline/queue.js';
import type { OfflineCommand } from '@factory-vision/domain-types';

/**
 * US-046, "Sync status dapat diketahui operator."
 *
 * An operator recording production over a dropped connection needs to know
 * three things without leaving the screen they are working on: whether the
 * terminal is online, how much is still waiting to be sent, and whether
 * anything was rejected. Anything less and the honest question, "did my count
 * actually save?", has no answer, which is how paper backups creep back in.
 */
export const SyncStatusBar: React.FC = () => {
  const [status, setStatus] = useState<SyncStatus>(getSyncStatus());
  const [showDetail, setShowDetail] = useState(false);
  const [failed, setFailed] = useState<OfflineCommand[]>([]);

  useEffect(() => subscribeSyncStatus(setStatus), []);

  useEffect(() => {
    if (!showDetail) return;
    void listFailedCommands().then(setFailed);
  }, [showDetail, status.failed]);

  const tone = !status.online
    ? {
        bg: 'var(--color-error-container)',
        fg: 'var(--color-on-error-container)',
        icon: 'cloud_off',
        label: 'OFFLINE',
      }
    : status.failed > 0
      ? {
          bg: 'var(--color-error-container)',
          fg: 'var(--color-on-error-container)',
          icon: 'error',
          label: `${status.failed} GAGAL`,
        }
      : status.syncing
        ? {
            bg: 'var(--color-warning-container)',
            fg: 'var(--color-on-warning-container)',
            icon: 'sync',
            label: 'MENGIRIM…',
          }
        : status.pending > 0
          ? {
              bg: 'var(--color-warning-container)',
              fg: 'var(--color-on-warning-container)',
              icon: 'schedule',
              label: `${status.pending} ANTRE`,
            }
          : {
              bg: 'var(--color-success-container)',
              fg: 'var(--color-on-success-container)',
              icon: 'cloud_done',
              label: 'TERSINKRON',
            };

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setShowDetail((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          padding: `var(--space-2) var(--space-3)`,
          minHeight: '34px',
          borderRadius: 'var(--radius-full, 999px)',
          border: 'none',
          backgroundColor: tone.bg,
          color: tone.fg,
          fontSize: '11px',
          fontWeight: 800,
          letterSpacing: '0.03em',
          cursor: 'pointer',
          fontFamily: 'var(--font-family)',
        }}
      >
        <motion.span
          animate={status.syncing ? { rotate: 360 } : { rotate: 0 }}
          transition={status.syncing ? { repeat: Infinity, duration: 1.2, ease: 'linear' } : { duration: 0 }}
          style={{ display: 'flex' }}
        >
          <Icon name={tone.icon} size={16} />
        </motion.span>
        <span>{tone.label}</span>
      </button>

      <AnimatePresence>
        {showDetail && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            style={{
              position: 'absolute',
              top: 'calc(100% + 8px)',
              right: 0,
              zIndex: 50,
              width: '320px',
              padding: 'var(--space-4)',
              borderRadius: 'var(--radius-md, 12px)',
              backgroundColor: 'var(--color-surface-container-high)',
              border: '1px solid var(--color-outline-variant)',
              boxShadow: 'var(--elevation-3)',
              fontFamily: 'var(--font-family)',
            }}
          >
            <div
              style={{
                fontSize: '13px',
                fontWeight: 800,
                color: 'var(--color-on-surface)',
                marginBottom: 'var(--space-2)',
              }}
            >
              Status Sinkronisasi
            </div>

            <Row label="Koneksi" value={status.online ? 'Online' : 'Offline'} />
            <Row label="Menunggu dikirim" value={String(status.pending)} />
            <Row label="Gagal" value={String(status.failed)} tone={status.failed > 0 ? 'error' : undefined} />
            <Row
              label="Terakhir tersinkron"
              value={status.lastSyncedAt ? new Date(status.lastSyncedAt).toLocaleTimeString('id-ID') : ', '}
            />

            {status.lastError && (
              <div
                style={{
                  marginTop: 'var(--space-2)',
                  padding: `var(--space-2) var(--space-3)`,
                  borderRadius: 'var(--radius-sm, 8px)',
                  backgroundColor: 'var(--color-error-container)',
                  color: 'var(--color-on-error-container)',
                  fontSize: '11px',
                  fontWeight: 600,
                }}
              >
                {status.lastError}
              </div>
            )}

            {failed.length > 0 && (
              <div style={{ marginTop: 'var(--space-3)' }}>
                <div
                  style={{
                    fontSize: '11px',
                    fontWeight: 800,
                    color: 'var(--color-on-surface)',
                    marginBottom: 'var(--space-1)',
                  }}
                >
                  Perintah yang ditolak
                </div>
                <div
                  style={{
                    maxHeight: '140px',
                    overflowY: 'auto',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--space-1)',
                  }}
                >
                  {failed.map((cmd) => (
                    <div
                      key={cmd.clientEventId}
                      style={{
                        padding: `var(--space-2) var(--space-2)`,
                        borderRadius: 'var(--radius-xs, 6px)',
                        backgroundColor: 'var(--color-surface-container)',
                        fontSize: '10.5px',
                        color: 'var(--color-on-surface-variant)',
                      }}
                    >
                      <strong style={{ color: 'var(--color-on-surface)' }}>{cmd.type}</strong> ·{' '}
                      {new Date(cmd.queuedAt).toLocaleTimeString('id-ID')}
                      <div style={{ color: 'var(--color-error)' }}>{cmd.errorMessage}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
              <ActionButton onClick={() => void syncQueue()} label="Sinkron Sekarang" />
              {status.failed > 0 && (
                <ActionButton onClick={() => void retryFailedCommands()} label="Coba Lagi" tone="error" />
              )}
            </div>

            <p
              style={{
                margin: 'var(--space-3) 0 0',
                fontSize: '10.5px',
                color: 'var(--color-on-surface-variant)',
                lineHeight: 1.5,
              }}
            >
              Semua pencatatan disimpan di perangkat terlebih dahulu dan dikirim otomatis saat koneksi tersedia.
              Tidak ada data yang hilang.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const Row: React.FC<{ label: string; value: string; tone?: 'error' }> = ({ label, value, tone }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', padding: 'var(--space-1) 0' }}>
    <span style={{ color: 'var(--color-on-surface-variant)' }}>{label}</span>
    <strong style={{ color: tone === 'error' ? 'var(--color-error)' : 'var(--color-on-surface)' }}>
      {value}
    </strong>
  </div>
);

const ActionButton: React.FC<{ label: string; onClick: () => void; tone?: 'error' }> = ({
  label,
  onClick,
  tone,
}) => (
  <button
    type="button"
    onClick={onClick}
    style={{
      flex: 1,
      minHeight: '36px',
      borderRadius: 'var(--radius-sm, 8px)',
      border: 'none',
      backgroundColor: tone === 'error' ? 'var(--color-error)' : 'var(--color-primary)',
      color: tone === 'error' ? 'var(--color-on-error)' : 'var(--color-on-primary)',
      fontSize: '12px',
      fontWeight: 700,
      cursor: 'pointer',
      fontFamily: 'var(--font-family)',
    }}
  >
    {label}
  </button>
);
