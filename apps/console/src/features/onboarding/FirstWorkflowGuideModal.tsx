import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Icon } from '@factory-vision/ui';
import { SurfaceCard, toneColor, toneContainer, toneOnContainer } from '@factory-vision/ui/fv';
import type { FirstWorkflowResult } from '@factory-vision/domain-types';
import { useOnboarding } from './OnboardingContext.js';

interface FirstWorkflowGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const FirstWorkflowGuideModal: React.FC<FirstWorkflowGuideModalProps> = ({ isOpen, onClose }) => {
  const navigate = useNavigate();
  const { progress, executeFirstWorkflow, refreshStatus } = useOnboarding();

  const [step, setStep] = useState<number>(1);
  const [quantity, setQuantity] = useState<number>(500);
  const [dueDate, setDueDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  });
  const [running, setRunning] = useState<boolean>(false);
  const [result, setResult] = useState<FirstWorkflowResult | null>(null);

  if (!isOpen) return null;

  const handleRunWorkflow = async () => {
    setRunning(true);
    try {
      const goodQty = Math.round(quantity * 0.96);
      const rejectQty = quantity - goodQty;
      const res = await executeFirstWorkflow({
        quantity,
        goodQty,
        rejectQty,
      });
      setResult(res);
      await refreshStatus();
      setStep(3); // Result step
    } catch {
      // Error handled
    } finally {
      setRunning(false);
    }
  };

  const handleViewDashboard = () => {
    onClose();
    navigate('/');
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1060,
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
          maxWidth: '680px',
          backgroundColor: 'var(--color-surface)',
          borderRadius: 'var(--radius-xl, 16px)',
          border: '1px solid var(--color-outline-variant)',
          boxShadow: 'var(--elevation-5)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: `var(--space-4) var(--space-6)`,
            borderBottom: '1px solid var(--color-outline-variant)',
            backgroundColor: 'var(--color-surface-container)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '10px',
                backgroundColor: 'var(--color-primary)',
                color: 'var(--color-on-primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name="play_circle" size={22} />
            </div>
            <div>
              <div style={{ fontSize: '11px', fontWeight: 800, color: 'var(--color-primary)', textTransform: 'uppercase' }}>
                INTERACTIVE GUIDE · ACTIVATION
              </div>
              <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
                {step === 1 && 'Langkah 1: Rencanakan Production Order Pertama'}
                {step === 2 && 'Langkah 2: Rilis Work Order & Simulasi Eksekusi Shop Floor'}
                {step === 3 && 'Alur Produksi Selesai! (Nilai Nyata MES Anda)'}
              </h2>
            </div>
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
        <div style={{ padding: `var(--space-6)` }}>
          {/* STEP 1: PO PARAMETERS */}
          {step === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <p style={{ margin: 0, fontSize: '13.5px', color: 'var(--color-on-surface-variant)', lineHeight: 1.6 }}>
                Di Factory Vision, seluruh siklus kerja dimulai dari pesanan produksi yang terukur. Tentukan jumlah target yang ingin Anda hasilkan:
              </p>

              <SurfaceCard padding="md">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: 'var(--space-1)', color: 'var(--color-on-surface)' }}>
                      Produk Manufaktur
                    </label>
                    <div
                      style={{
                        padding: `var(--space-3) var(--space-4)`,
                        borderRadius: '8px',
                        backgroundColor: 'var(--color-surface-container)',
                        border: '1px solid var(--color-outline-variant)',
                        fontSize: '13.5px',
                        fontWeight: 700,
                        color: 'var(--color-on-surface)',
                      }}
                    >
                      Brake Disc Ventilated 280mm (AUTO-BRK-280)
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: 'var(--space-1)', color: 'var(--color-on-surface)' }}>
                        Jumlah Rencana (Target Qty)
                      </label>
                      <input
                        type="number"
                        min={10}
                        max={10000}
                        value={quantity}
                        onChange={(e) => setQuantity(Number(e.target.value))}
                        style={{
                          width: '100%',
                          padding: `var(--space-3) var(--space-4)`,
                          fontSize: '14px',
                          borderRadius: '8px',
                          border: '1px solid var(--color-outline-variant)',
                          backgroundColor: 'var(--color-surface-container)',
                          color: 'var(--color-on-surface)',
                          outline: 'none',
                          boxSizing: 'border-box',
                        }}
                      />
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: 'var(--space-1)', color: 'var(--color-on-surface)' }}>
                        Batas Waktu (Due Date)
                      </label>
                      <input
                        type="date"
                        value={dueDate}
                        onChange={(e) => setDueDate(e.target.value)}
                        style={{
                          width: '100%',
                          padding: `var(--space-3) var(--space-4)`,
                          fontSize: '14px',
                          borderRadius: '8px',
                          border: '1px solid var(--color-outline-variant)',
                          backgroundColor: 'var(--color-surface-container)',
                          color: 'var(--color-on-surface)',
                          outline: 'none',
                          boxSizing: 'border-box',
                        }}
                      />
                    </div>
                  </div>
                </div>
              </SurfaceCard>
            </div>
          )}

          {/* STEP 2: WORK ORDER & EXECUTION PREVIEW */}
          {step === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <p style={{ margin: 0, fontSize: '13.5px', color: 'var(--color-on-surface-variant)', lineHeight: 1.6 }}>
                Sistem akan secara otomatis memperluas Production Order ini ke dalam urutan <strong>Work Order</strong> per stasiun kerja:
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {[
                  { seq: 1, proc: 'Machining Bubut & Milling', mc: 'CNC Lathe Doosan Lynx 220', time: '45 dtk/unit' },
                  { seq: 2, proc: 'Precision Surface Grinding', mc: 'Surface Grinder Okamoto 350', time: '30 dtk/unit' },
                  { seq: 3, proc: 'Sub-Assembly & Riveting', mc: 'Hydraulic Press 50T', time: '25 dtk/unit' },
                  { seq: 4, proc: 'Final Quality Inspection', mc: 'Mitutoyo CMM Station', time: '15 dtk/unit' },
                ].map((item) => (
                  <div
                    key={item.seq}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: `var(--space-3) var(--space-4)`,
                      borderRadius: '8px',
                      backgroundColor: 'var(--color-surface-container)',
                      border: '1px solid var(--color-outline-variant)',
                      fontSize: '13px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                      <span
                        style={{
                          width: '24px',
                          height: '24px',
                          borderRadius: '50%',
                          backgroundColor: 'var(--color-primary)',
                          color: 'var(--color-on-primary)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '11px',
                          fontWeight: 800,
                        }}
                      >
                        {item.seq}
                      </span>
                      <div>
                        <div style={{ fontWeight: 700, color: 'var(--color-on-surface)' }}>{item.proc}</div>
                        <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>{item.mc}</div>
                      </div>
                    </div>

                    <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-on-surface-variant)' }}>
                      {item.time}
                    </span>
                  </div>
                ))}
              </div>

              <div
                style={{
                  padding: 'var(--space-3) var(--space-4)',
                  borderRadius: '8px',
                  backgroundColor: toneContainer.info,
                  color: toneOnContainer.info,
                  fontSize: '12.5px',
                  lineHeight: 1.5,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                }}
              >
                <Icon name="info" size={18} />
                <span>
                  Klik tombol <strong>Eksekusi Alur Produksi</strong> di bawah untuk mensimulasikan pencatatan produksi real-time (480 unit Good, 20 unit Reject).
                </span>
              </div>
            </div>
          )}

          {/* STEP 3: FIRST VALUE RESULT (PRD §27) */}
          {step === 3 && result && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <div style={{ textAlign: 'center' }}>
                <div
                  style={{
                    width: '56px',
                    height: '56px',
                    borderRadius: '50%',
                    backgroundColor: toneContainer.success,
                    color: toneOnContainer.success,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto var(--space-3)',
                  }}
                >
                  <Icon name="task_alt" size={32} />
                </div>
                <h3 style={{ margin: 0, fontSize: '20px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
                  Produksi Perdana Selesai Dicatat!
                </h3>
                <p style={{ margin: `var(--space-1) 0 0`, fontSize: '13px', color: 'var(--color-on-surface-variant)' }}>
                  Order <strong>{result.orderNumber}</strong> ({result.productName})
                </p>
              </div>

              {/* Four Value Metrics Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--space-3)' }}>
                <SurfaceCard padding="md" style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-on-surface-variant)' }}>RENCANA</div>
                  <div style={{ fontSize: '22px', fontWeight: 800, color: 'var(--color-on-surface)', marginTop: '4px' }}>
                    {result.plannedQuantity}
                  </div>
                  <div style={{ fontSize: '10.5px', color: 'var(--color-on-surface-variant)' }}>pcs</div>
                </SurfaceCard>

                <SurfaceCard padding="md" style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: toneColor.success }}>PRODUKSI BAIK</div>
                  <div style={{ fontSize: '22px', fontWeight: 800, color: toneColor.success, marginTop: '4px' }}>
                    {result.producedQuantity}
                  </div>
                  <div style={{ fontSize: '10.5px', color: 'var(--color-on-surface-variant)' }}>good pcs</div>
                </SurfaceCard>

                <SurfaceCard padding="md" style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: toneColor.error }}>REJECT</div>
                  <div style={{ fontSize: '22px', fontWeight: 800, color: toneColor.error, marginTop: '4px' }}>
                    {result.rejectQuantity}
                  </div>
                  <div style={{ fontSize: '10.5px', color: 'var(--color-on-surface-variant)' }}>reject pcs</div>
                </SurfaceCard>

                <SurfaceCard padding="md" style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: toneColor.primary }}>KETERCAPAIAN</div>
                  <div style={{ fontSize: '22px', fontWeight: 800, color: toneColor.primary, marginTop: '4px' }}>
                    {result.achievementRate}%
                  </div>
                  <div style={{ fontSize: '10.5px', color: 'var(--color-on-surface-variant)' }}>laju target</div>
                </SurfaceCard>
              </div>

              <SurfaceCard padding="md" railTone="success">
                <div style={{ fontSize: '13px', color: 'var(--color-on-surface)', lineHeight: 1.6 }}>
                  <strong>Nilai Nyata MES (First Value):</strong> Seluruh data di atas kini telah menjadi transaksi aktual di database Anda. Dashboard eksekutif, live monitoring lini, dan modul OEE telah terbarui secara instan.
                </div>
              </SurfaceCard>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: `var(--space-4) var(--space-6)`,
            borderTop: '1px solid var(--color-outline-variant)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: 'var(--color-surface-container)',
          }}
        >
          {step < 3 ? (
            <>
              <Button
                variant="text"
                disabled={step === 1 || running}
                onClick={() => setStep(step - 1)}
                icon={<Icon name="arrow_back" size={16} />}
              >
                Kembali
              </Button>

              {step === 1 ? (
                <Button
                  variant="filled"
                  onClick={() => setStep(2)}
                  icon={<Icon name="arrow_forward" size={16} />}
                >
                  Lanjut ke Rilis Work Order
                </Button>
              ) : (
                <Button
                  variant="filled"
                  disabled={running}
                  onClick={handleRunWorkflow}
                  icon={<Icon name="rocket_launch" size={16} />}
                >
                  {running ? 'Mengeksekusi Produksi…' : 'Eksekusi Alur Produksi'}
                </Button>
              )}
            </>
          ) : (
            <div style={{ width: '100%', display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
              <Button variant="outlined" onClick={onClose}>
                Tutup Panduan
              </Button>
              <Button
                variant="filled"
                onClick={handleViewDashboard}
                icon={<Icon name="space_dashboard" size={16} />}
              >
                Lihat di Dashboard Analitik
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
