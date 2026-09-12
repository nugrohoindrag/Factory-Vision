import React, { useState } from 'react';
import { Button, Icon } from '@factory-vision/ui';
import { SurfaceCard, toneColor, toneContainer, toneOnContainer } from '@factory-vision/ui/fv';
import { useOnboarding } from './OnboardingContext.js';

interface UpgradePlanModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const UpgradePlanModal: React.FC<UpgradePlanModalProps> = ({ isOpen, onClose }) => {
  const { requestUpgrade } = useOnboarding();
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSelectPlan = async (planCode: string) => {
    setSubmitting(true);
    try {
      const res = await requestUpgrade(planCode);
      setSuccessMessage(res.message);
    } catch {
      setSuccessMessage('Permintaan upgrade telah dicatat. Tim sales kami akan segera menghubungi Anda.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1080,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'color-mix(in srgb, var(--color-scrim) 70%, transparent)',
        backdropFilter: 'blur(8px)',
        padding: 'var(--space-4)',
        fontFamily: 'var(--font-family)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '920px',
          maxHeight: '90vh',
          backgroundColor: 'var(--color-surface)',
          borderRadius: 'var(--radius-xl, 16px)',
          border: '1px solid var(--color-border)',
          boxShadow: 'var(--elevation-5)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: `var(--space-5) var(--space-6)`,
            borderBottom: '1px solid var(--color-border)',
            backgroundColor: 'var(--color-surface-container)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <div style={{ fontSize: '11px', fontWeight: 800, color: 'var(--color-primary)', textTransform: 'uppercase' }}>
              TRIAL CONVERSION · UPGRADE PLAN
            </div>
            <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
              Tingkatkan Kapasitas Pabrik Anda
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--color-on-surface-variant)',
              padding: 'var(--space-2)',
            }}
          >
            <Icon name="close" size={20} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, padding: `var(--space-6)`, overflowY: 'auto' }}>
          {successMessage ? (
            <div style={{ textAlign: 'center', padding: `var(--space-8) 0` }}>
              <div
                style={{
                  width: '64px',
                  height: '64px',
                  borderRadius: '50%',
                  backgroundColor: toneContainer.success,
                  color: toneOnContainer.success,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto var(--space-4)',
                }}
              >
                <Icon name="check_circle" size={36} />
              </div>
              <h3 style={{ margin: `0 0 var(--space-2)`, fontSize: '20px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
                Terima Kasih atas Minat Anda!
              </h3>
              <p style={{ margin: `0 auto var(--space-6)`, maxWidth: '480px', fontSize: '14px', color: 'var(--color-on-surface-variant)', lineHeight: 1.6 }}>
                {successMessage}
              </p>
              <Button variant="filled" onClick={onClose}>
                Kembali ke Workspace
              </Button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
              <p style={{ margin: 0, fontSize: '13.5px', color: 'var(--color-on-surface-variant)', lineHeight: 1.6 }}>
                Pilih paket langganan yang sesuai dengan skala lini manufaktur Anda. Seluruh data trial dan riwayat produksi Anda akan tetap aman dan langsung dilanjutkan ke paket berbayar.
              </p>

              {/* 3 Tier Cards Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 'var(--space-4)' }}>
                {/* 1. Starter Plan */}
                <SurfaceCard padding="lg" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                  <div style={{ fontSize: '12px', fontWeight: 800, color: 'var(--color-on-surface-variant)', textTransform: 'uppercase' }}>
                    STARTER
                  </div>
                  <div style={{ fontSize: '22px', fontWeight: 800, color: 'var(--color-on-surface)', margin: `var(--space-1) 0 var(--space-3)` }}>
                    Rp 4.500.000 <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-on-surface-variant)' }}>/bulan</span>
                  </div>
                  <p style={{ margin: `0 0 var(--space-4)`, fontSize: '12px', color: 'var(--color-on-surface-variant)', lineHeight: 1.5 }}>
                    Ideal untuk 1 lini percontohan atau pabrik skala kecil yang ingin memulai digitalisasi.
                  </p>

                  <ul style={{ margin: `0 0 var(--space-5)`, paddingLeft: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', fontSize: '12.5px', color: 'var(--color-on-surface)' }}>
                    <li>1 Lini Produksi</li>
                    <li>Hingga 5 Mesin Terkoneksi</li>
                    <li>10 Akun Operator Tablet</li>
                    <li>Executive OEE Dashboard</li>
                    <li>Dukungan Email Jam Kerja</li>
                  </ul>

                  <Button
                    variant="outlined"
                    disabled={submitting}
                    onClick={() => handleSelectPlan('STARTER')}
                    style={{ marginTop: 'auto', width: '100%' }}
                  >
                    Pilih Paket Starter
                  </Button>
                </SurfaceCard>

                {/* 2. Growth Plan (Featured) */}
                <SurfaceCard
                  padding="lg"
                  railTone="primary"
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    height: '100%',
                    border: '2px solid var(--color-primary)',
                    position: 'relative',
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      top: '-12px',
                      right: 'var(--space-4)',
                      padding: `2px var(--space-3)`,
                      borderRadius: '9999px',
                      backgroundColor: 'var(--color-primary)',
                      color: 'var(--color-on-primary)',
                      fontSize: '10.5px',
                      fontWeight: 800,
                      letterSpacing: '0.04em',
                    }}
                  >
                    PALING POPULER
                  </div>

                  <div style={{ fontSize: '12px', fontWeight: 800, color: 'var(--color-primary)', textTransform: 'uppercase' }}>
                    GROWTH
                  </div>
                  <div style={{ fontSize: '22px', fontWeight: 800, color: 'var(--color-on-surface)', margin: `var(--space-1) 0 var(--space-3)` }}>
                    Rp 12.500.000 <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-on-surface-variant)' }}>/bulan</span>
                  </div>
                  <p style={{ margin: `0 0 var(--space-4)`, fontSize: '12px', color: 'var(--color-on-surface-variant)', lineHeight: 1.5 }}>
                    Solusi lengkap untuk pabrik mid-market yang membutuhkan demand planning dan kontrol mutu.
                  </p>

                  <ul style={{ margin: `0 0 var(--space-5)`, paddingLeft: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', fontSize: '12.5px', color: 'var(--color-on-surface)' }}>
                    <li>Hingga 5 Lini Produksi</li>
                    <li>Hingga 25 Mesin Terkoneksi</li>
                    <li>Unlimited Akun Operator</li>
                    <li>Demand Forecast & Capacity Plan</li>
                    <li>Pareto Downtime & Bottleneck Analisis</li>
                    <li>Dedicated Account Manager</li>
                  </ul>

                  <Button
                    variant="filled"
                    disabled={submitting}
                    onClick={() => handleSelectPlan('GROWTH')}
                    style={{ marginTop: 'auto', width: '100%' }}
                  >
                    Pilih Paket Growth
                  </Button>
                </SurfaceCard>

                {/* 3. Enterprise Plan */}
                <SurfaceCard padding="lg" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                  <div style={{ fontSize: '12px', fontWeight: 800, color: 'var(--color-on-surface-variant)', textTransform: 'uppercase' }}>
                    ENTERPRISE
                  </div>
                  <div style={{ fontSize: '22px', fontWeight: 800, color: 'var(--color-on-surface)', margin: `var(--space-1) 0 var(--space-3)` }}>
                    Kustomisasi <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-on-surface-variant)' }}>/tahunan</span>
                  </div>
                  <p style={{ margin: `0 0 var(--space-4)`, fontSize: '12px', color: 'var(--color-on-surface-variant)', lineHeight: 1.5 }}>
                    Untuk multi-plant enterprise dengan integrasi ERP dan kebutuhan deployment on-premise.
                  </p>

                  <ul style={{ margin: `0 0 var(--space-5)`, paddingLeft: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', fontSize: '12.5px', color: 'var(--color-on-surface)' }}>
                    <li>Multi-Plant (Banyak Pabrik)</li>
                    <li>Kapasitas Mesin & Lini Tak Terbatas</li>
                    <li>Integrasi SAP / Oracle ERP</li>
                    <li>Opsi On-Premise Single-Tenant</li>
                    <li>24/7 SLA Guarantee & Priority Support</li>
                  </ul>

                  <Button
                    variant="outlined"
                    disabled={submitting}
                    onClick={() => handleSelectPlan('ENTERPRISE')}
                    style={{ marginTop: 'auto', width: '100%' }}
                  >
                    Hubungi Tim Enterprise
                  </Button>
                </SurfaceCard>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
