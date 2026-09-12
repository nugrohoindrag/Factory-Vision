import React, { useState } from 'react';
import { Button, Icon } from '@factory-vision/ui';
import { SurfaceCard, toneColor, toneContainer, toneOnContainer } from '@factory-vision/ui/fv';
import { useOnboarding } from './OnboardingContext.js';

interface WelcomeTourModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface TourStep {
  title: string;
  badge: string;
  icon: string;
  summary: string;
  details: string[];
  moduleUrl: string;
}

const TOUR_STEPS: TourStep[] = [
  {
    title: 'Executive Dashboard (Visibilitas Real-time)',
    badge: 'PILAR 1 DARI 5',
    icon: 'space_dashboard',
    summary:
      'Pusat kendali eksekutif menyajikan 8 KPI operasional pabrik yang dihitung langsung dari transaksi di lantai produksi.',
    details: [
      'OEE Pabrik dengan breakdown Availability, Performance, dan Quality.',
      'Target vs Produksi Aktual secara dinamis per shift.',
      'Downtime harian dan laju cacat (reject rate) terkini.',
    ],
    moduleUrl: '/',
  },
  {
    title: 'Demand & Perencanaan Produksi',
    badge: 'PILAR 2 DARI 5',
    icon: 'calendar_month',
    summary:
      'Hubungkan penerimaan pesanan pelanggan (Customer Order) langsung ke peramalan permintaan dan kalkulasi kapasitas lini.',
    details: [
      'Penerimaan order sales dengan status pengiriman yang terpantau.',
      'Kalkulasi kapasitas mesin agar tidak terjadi kelebihan beban (overload).',
      'Pembuatan Production Plan yang dapat langsung dirilis menjadi Work Order.',
    ],
    moduleUrl: '/production-plans',
  },
  {
    title: 'Eksekusi Produksi & Work Order',
    badge: 'PILAR 3 DARI 5',
    icon: 'list_alt',
    summary:
      'Pusat pembagian kerja ke lantai produksi. Memastikan setiap operator dan mesin memproduksi part yang tepat sesuai urutan proses.',
    details: [
      'Pelacakan status Work Order: Draft, Released, In Production, Completed.',
      'Dukungan split batch untuk fleksibilitas pembagian lini.',
      'Visibilitas antrean bahan baku dan komponen per stasiun kerja.',
    ],
    moduleUrl: '/work-orders',
  },
  {
    title: 'Terminal Shop Floor Operator',
    badge: 'PILAR 4 DARI 5',
    icon: 'tablet_android',
    summary:
      'Antarmuka khusus tablet di samping mesin. Cepat, bebas latensi, dan tetap berfungsi saat jaringan Wi-Fi pabrik terputus.',
    details: [
      'Masuk menggunakan nomor karyawan dan PIN tanpa perlu mengetik email.',
      'Pencatatan unit Good dan Reject dalam sekali sentuh.',
      'Sinkronisasi otomatis ke server saat koneksi internet kembali.',
    ],
    moduleUrl: '/live-board',
  },
  {
    title: 'Analitik & Investigasi OEE',
    badge: 'PILAR 5 DARI 5',
    icon: 'insights',
    summary:
      'Ubah data mentah menjadi wawasan bisnis. Ketahui secara pasti mengapa lini berhenti dan mesin mana yang menjadi bottleneck.',
    details: [
      'Diagram Pareto Alasan Downtime untuk perbaikan berkesinambungan (Kaizen).',
      'Peringkat bottleneck mesin terhambat yang menahan laju output pabrik.',
      'Laporan shift dan audit trail lengkap untuk kepatuhan tata kelola.',
    ],
    moduleUrl: '/oee',
  },
];

export const WelcomeTourModal: React.FC<WelcomeTourModalProps> = ({ isOpen, onClose }) => {
  const { closeTour } = useOnboarding();
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(0);

  if (!isOpen) return null;

  const current = TOUR_STEPS[currentStepIndex];
  const isLast = currentStepIndex === TOUR_STEPS.length - 1;

  const handleNext = () => {
    if (isLast) {
      closeTour();
    } else {
      setCurrentStepIndex(currentStepIndex + 1);
    }
  };

  const handlePrev = () => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex(currentStepIndex - 1);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1050,
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
          border: '1px solid var(--color-border)',
          boxShadow: 'var(--elevation-5)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header with step pills */}
        <div
          style={{
            padding: `var(--space-4) var(--space-6)`,
            borderBottom: '1px solid var(--color-border)',
            backgroundColor: 'var(--color-surface-container)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: `3px var(--space-3)`,
                borderRadius: '9999px',
                backgroundColor: 'var(--color-primary)',
                color: 'var(--color-on-primary)',
                fontSize: '11px',
                fontWeight: 800,
                letterSpacing: '0.04em',
              }}
            >
              <Icon name="explore" size={13} />
              {current.badge}
            </span>
          </div>

          {/* Stepper dots */}
          <div style={{ display: 'flex', gap: '6px' }}>
            {TOUR_STEPS.map((_, i) => (
              <div
                key={i}
                style={{
                  width: i === currentStepIndex ? '20px' : '8px',
                  height: '8px',
                  borderRadius: '9999px',
                  backgroundColor: i === currentStepIndex ? 'var(--color-primary)' : 'var(--color-outline-variant)',
                  transition: 'all 200ms ease',
                }}
              />
            ))}
          </div>
        </div>

        {/* Tour Body */}
        <div style={{ padding: `var(--space-6)` }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-4)', marginBottom: 'var(--space-5)' }}>
            <div
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '12px',
                backgroundColor: 'var(--color-primary)',
                color: 'var(--color-on-primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <Icon name={current.icon} size={28} />
            </div>

            <div>
              <h3
                style={{
                  margin: `0 0 var(--space-2)`,
                  fontSize: '20px',
                  fontWeight: 800,
                  color: 'var(--color-on-surface)',
                  letterSpacing: '-0.02em',
                }}
              >
                {current.title}
              </h3>
              <p
                style={{
                  margin: 0,
                  fontSize: '13.5px',
                  color: 'var(--color-on-surface-variant)',
                  lineHeight: 1.6,
                }}
              >
                {current.summary}
              </p>
            </div>
          </div>

          <SurfaceCard padding="md" style={{ borderRadius: 'var(--radius-lg, 12px)' }}>
            <div
              style={{
                fontSize: '11px',
                fontWeight: 800,
                letterSpacing: '0.06em',
                color: 'var(--color-primary)',
                textTransform: 'uppercase',
                marginBottom: 'var(--space-2)',
              }}
            >
              Fitur Utama Modul Ini:
            </div>
            <ul style={{ margin: 0, paddingLeft: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {current.details.map((detail, idx) => (
                <li key={idx} style={{ fontSize: '13px', color: 'var(--color-on-surface)', lineHeight: 1.5 }}>
                  {detail}
                </li>
              ))}
            </ul>
          </SurfaceCard>
        </div>

        {/* Footer controls */}
        <div
          style={{
            padding: `var(--space-4) var(--space-6)`,
            borderTop: '1px solid var(--color-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: 'var(--color-surface-container)',
          }}
        >
          <Button variant="text" size="sm" onClick={onClose} style={{ color: 'var(--color-on-surface-variant)' }}>
            Lewati Tur
          </Button>

          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <Button
              variant="outlined"
              size="sm"
              disabled={currentStepIndex === 0}
              onClick={handlePrev}
              icon={<Icon name="arrow_back" size={16} />}
            >
              Sebelumnya
            </Button>

            <Button
              variant="filled"
              size="sm"
              onClick={handleNext}
              icon={<Icon name={isLast ? 'check' : 'arrow_forward'} size={16} />}
            >
              {isLast ? 'Selesai & Mulai Eksplorasi' : 'Lanjut'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
