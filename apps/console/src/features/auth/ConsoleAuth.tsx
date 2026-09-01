import React, { useState } from 'react';
import { UserRole } from '@factory-vision/domain-types';
import { ApiRequestError } from '@factory-vision/api-client';
import { Button, Icon } from '@factory-vision/ui';
import {
  FactoryVisionLogo,
  SurfaceCard,
  toneColor,
  toneContainer,
  toneOnContainer,
  type Tone,
} from '@factory-vision/ui/fv';
import { useSession } from '../../app/SessionContext.js';

/**
 * Session shape the app shell renders the account menu from.
 *
 * Kept as a view model rather than the raw `AppUser` because the header also
 * shows things the account record does not carry, such as the resolved plant
 * name and the locally chosen avatar.
 */
export interface UserSession {
  name: string;
  role: UserRole | string;
  email: string;
  plantName: string;
  avatarUrl?: string;
  phone?: string;
  employeeId?: string;
}

export { OPEN_SOURCE_AVATARS, avatarDataUri, initialsOf } from './avatars.js';

/**
 * The eight Executive KPI the dashboard leads with.
 *
 * The preview shows the product's real KPI set rather than an invented one: a
 * login screen that promises a metric the dashboard does not compute is a
 * promise the first session breaks. The figures are an illustration and the
 * card says so, nobody should mistake them for their own plant's numbers.
 */
const PREVIEW_KPIS: Array<{
  icon: string;
  label: string;
  value: string;
  caption: string;
  tone: Tone;
}> = [
  { icon: 'speed', label: 'OEE', value: '76,0%', caption: 'Target 85% · −9,0', tone: 'warning' },
  { icon: 'schedule', label: 'Availability', value: '89,7%', caption: 'Target 90% · −0,3', tone: 'success' },
  { icon: 'bolt', label: 'Performance', value: '86,0%', caption: 'Target 95% · −9,0', tone: 'warning' },
  { icon: 'verified', label: 'Quality', value: '98,6%', caption: 'Target 99% · −0,4', tone: 'success' },
  { icon: 'inventory', label: 'Output', value: '15.098', caption: 'unit · 7 hari terakhir', tone: 'primary' },
  { icon: 'percent', label: 'Achievement', value: '85,7%', caption: 'Target 100% · −14,3', tone: 'error' },
  { icon: 'cancel', label: 'Reject Rate', value: '1,32%', caption: 'Target 1,5% · di bawah', tone: 'success' },
  { icon: 'timer_off', label: 'Downtime', value: '422', caption: 'menit/hari · target 400', tone: 'warning' },
];

/** Machine OEE ranking, lowest first, the shape the Bottleneck page ranks by. */
const PREVIEW_BOTTLENECKS = [
  {
    machine: 'TBM-002',
    context: 'Tire Building · Line Gamma',
    oee: 59.1,
    achievement: 55.9,
    tone: 'error' as Tone,
  },
  { machine: 'CPR-002', context: 'Curing · Line Gamma', oee: 61.4, achievement: 56.1, tone: 'error' as Tone },
  {
    machine: 'CAL-001',
    context: 'Calendering · Line Beta',
    oee: 73.6,
    achievement: 88.3,
    tone: 'warning' as Tone,
  },
  { machine: 'MIX-002', context: 'Mixing · Line Beta', oee: 75.3, achievement: 90.4, tone: 'warning' as Tone },
  {
    machine: 'TBM-001',
    context: 'Tire Building · Line Alpha',
    oee: 80.1,
    achievement: 99.2,
    tone: 'success' as Tone,
  },
];

const HERO_POINTS = [
  'Pareto Alasan Downtime',
  'Target vs Produksi Aktual',
  'Jumlah Good dan Jumlah Reject',
  'OEE per Mesin dan Proses Produksi',
];

/**
 * Layout rules that inline styles cannot express: the two-column split, and
 * dropping the hero on a narrow window so the form keeps the full width on a
 * supervisor's tablet. Every value resolves to a design token.
 */
const LAYOUT_CSS = `
.fv-login {
  min-height: 100vh;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  /* White, not the grey page background: the sign-in screen is one clean sheet
     with the hero panel sitting on it, so the form side reads as paper rather
     than as an empty dashboard shell. */
  background-color: var(--color-surface);
  color: var(--color-on-surface);
  font-family: var(--font-family);
}

.fv-login__form-col {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-10) var(--space-8);
  overflow-y: auto;
}

.fv-login__hero-col {
  display: none;
}

.fv-login__kpi-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3);
}

@media (min-width: 1080px) {
  .fv-login {
    grid-template-columns: minmax(440px, 44%) minmax(0, 56%);
  }
  .fv-login__hero-col {
    display: block;
    padding: var(--space-5) var(--space-5) var(--space-5) 0;
  }
  .fv-login__kpi-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}
`;

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '12px',
  fontWeight: 700,
  color: 'var(--color-on-surface-variant)',
  marginBottom: 'var(--space-2)',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: `var(--space-3) var(--space-4)`,
  fontSize: '14px',
  fontFamily: 'var(--font-family)',
  color: 'var(--color-on-surface)',
  backgroundColor: 'var(--color-surface-container)',
  border: '1px solid var(--color-outline-variant)',
  borderRadius: 'var(--radius-sm, 8px)',
  outline: 'none',
  boxSizing: 'border-box',
};

type Mode = 'CONSOLE' | 'OPERATOR';

/**
 * US-001, Login Aplikasi.
 *
 * Authentication is a real server round trip: the form cannot know whether an
 * account is suspended, out of scope or simply wrong, and pretending otherwise
 * in the client is exactly the gap the acceptance criteria close.
 *
 * The screen is split because the two front doors in the PRD are genuinely
 * different: an application user signs in here with email and password
 * (US-001), while an operator signs in on the shop-floor terminal with an
 * employee number and a PIN (US-002). The segmented control says so rather
 * than leaving an operator to discover it by failing to log in.
 */
export const ConsoleAuth: React.FC = () => {
  const { login } = useSession();

  const [mode, setMode] = useState<Mode>('CONSOLE');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setFieldErrors({});
    setSubmitting(true);

    try {
      await login(email.trim(), password);
      // Navigation is handled by the shell once a principal exists, which is
      // what makes "landing page mengikuti role" a server-decided route.
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(err.message);
        setFieldErrors(Object.fromEntries(err.fields.map((f) => [f.field, f.message])));
      } else {
        setError('Tidak dapat menghubungi server. Periksa koneksi jaringan Anda.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fv-login">
      <style>{LAYOUT_CSS}</style>

      {/* ───────────────────────── Form column ───────────────────────── */}
      <div className="fv-login__form-col">
        <div
          style={{ width: '100%', maxWidth: '460px', display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}
        >
          <FactoryVisionLogo size="md" variant="full" />

          <div>
            <h1
              style={{
                margin: `0 0 var(--space-2)`,
                fontSize: '30px',
                fontWeight: 800,
                letterSpacing: '-0.03em',
                color: 'var(--color-on-surface)',
              }}
            >
              Selamat datang kembali
            </h1>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--color-on-surface-variant)' }}>
              Masukkan kredensial Anda untuk mengakses workspace pabrik.
            </p>
          </div>

          {/* Segmented control. The selected segment fills solid primary,
 the one "this is the current choice" fill used product-wide. */}
          <div
            role="tablist"
            aria-label="Pilih jenis akses"
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 'var(--space-1)',
              padding: 'var(--space-1)',
              borderRadius: 'var(--radius-md, 12px)',
              backgroundColor: 'var(--color-surface-container)',
              border: '1px solid var(--color-outline-variant)',
            }}
          >
            {[
              { key: 'CONSOLE' as Mode, label: 'Konsol Manajemen' },
              { key: 'OPERATOR' as Mode, label: 'Terminal Operator' },
            ].map((tab) => {
              const selected = mode === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setMode(tab.key)}
                  style={{
                    padding: `var(--space-3) var(--space-3)`,
                    borderRadius: 'var(--radius-sm, 8px)',
                    border: 'none',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-family)',
                    fontSize: '13px',
                    fontWeight: 700,
                    backgroundColor: selected ? 'var(--color-primary)' : 'transparent',
                    color: selected ? 'var(--color-on-primary)' : 'var(--color-on-surface-variant)',
                    transition: 'background-color 150ms ease, color 150ms ease',
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {mode === 'CONSOLE' ? (
            <>
              <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                <div>
                  <label htmlFor="fv-email" style={labelStyle}>
                    Email
                  </label>
                  <input
                    id="fv-email"
                    type="email"
                    autoComplete="username"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="nama@pabrik.co.id"
                    style={{
                      ...inputStyle,
                      borderColor: fieldErrors.email ? 'var(--color-error)' : 'var(--color-outline-variant)',
                    }}
                  />
                  {fieldErrors.email && (
                    <span style={{ fontSize: '11px', color: 'var(--color-error)' }}>{fieldErrors.email}</span>
                  )}
                </div>

                <div>
                  <label htmlFor="fv-password" style={labelStyle}>
                    Kata Sandi
                  </label>
                  <div style={{ position: 'relative' }}>
                    <input
                      id="fv-password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      style={{
                        ...inputStyle,
                        paddingRight: 'var(--space-12)',
                        borderColor: fieldErrors.password
                          ? 'var(--color-error)'
                          : 'var(--color-outline-variant)',
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}
                      style={{
                        position: 'absolute',
                        right: '6px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: 'var(--space-2)',
                        color: 'var(--color-on-surface-variant)',
                        display: 'flex',
                      }}
                    >
                      <Icon name={showPassword ? 'visibility_off' : 'visibility'} size={18} />
                    </button>
                  </div>
                  {fieldErrors.password && (
                    <span style={{ fontSize: '11px', color: 'var(--color-error)' }}>
                      {fieldErrors.password}
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-primary)' }}>
                    Lupa kata sandi?
                  </span>
                </div>

                {error && (
                  <div
                    role="alert"
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 'var(--space-2)',
                      padding: `var(--space-3) var(--space-3)`,
                      borderRadius: 'var(--radius-sm, 8px)',
                      backgroundColor: 'var(--color-error-container)',
                      color: 'var(--color-on-error-container)',
                      fontSize: '12px',
                      fontWeight: 600,
                    }}
                  >
                    <Icon name="error" size={16} />
                    <span>{error}</span>
                  </div>
                )}

                <Button
                  type="submit"
                  variant="filled"
                  disabled={submitting}
                  icon={<Icon name="login" size={16} />}
                  style={{ width: '100%', height: '46px' }}
                >
                  {submitting ? 'Memverifikasi…' : 'Masuk'}
                </Button>
              </form>

              <p
                style={{
                  margin: 0,
                  textAlign: 'center',
                  fontSize: '12px',
                  color: 'var(--color-on-surface-variant)',
                }}
              >
                Belum punya akses? Administrator workspace Anda yang membuat akun.
              </p>
            </>
          ) : (
            /* US-002, operators do not sign in here. Saying so is kinder than
 letting them fail against a form that has no PIN field. */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <SurfaceCard padding="lg" railTone="primary">
                <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-start' }}>
                  <Icon name="tablet_android" size={22} />
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
                      Operator masuk lewat terminal shop floor
                    </div>
                    <p
                      style={{
                        margin: `var(--space-2) 0 0`,
                        fontSize: '12.5px',
                        color: 'var(--color-on-surface-variant)',
                        lineHeight: 1.65,
                      }}
                    >
                      Terminal memakai <strong>nomor karyawan + PIN</strong> pada papan angka, bukan email dan
                      kata sandi. Sesi terminal sengaja dibuat singkat dan keluar otomatis setelah 15 menit
                      tanpa aktivitas, karena satu tablet dipakai bergantian di lantai produksi.
                    </p>
                  </div>
                </div>
              </SurfaceCard>

              <SurfaceCard padding="lg">
                <div
                  style={{
                    fontSize: '12px',
                    fontWeight: 800,
                    color: 'var(--color-on-surface)',
                    marginBottom: 'var(--space-2)',
                  }}
                >
                  Alamat terminal
                </div>
                <code
                  style={{
                    display: 'block',
                    padding: `var(--space-3) var(--space-3)`,
                    borderRadius: 'var(--radius-sm, 8px)',
                    backgroundColor: 'var(--color-surface-container-high)',
                    color: 'var(--color-on-surface)',
                    fontSize: '12.5px',
                    fontWeight: 700,
                  }}
                >
                  {typeof window === 'undefined'
                    ? 'http://<host>:3200'
                    : `${window.location.protocol}//${window.location.hostname}:3200`}
                </code>
                <p
                  style={{
                    margin: `var(--space-3) 0 0`,
                    fontSize: '11.5px',
                    color: 'var(--color-on-surface-variant)',
                    lineHeight: 1.6,
                  }}
                >
                  Buka alamat itu di tablet, lalu tambahkan ke layar utama. Setelah termuat, pencatatan produksi
                  tetap berjalan saat Wi-Fi terputus dan tersinkron otomatis ketika koneksi kembali.
                </p>
              </SurfaceCard>
            </div>
          )}
        </div>
      </div>

      {/* ───────────────────────── Hero column ───────────────────────── */}
      <div className="fv-login__hero-col">
        <div
          style={{
            height: '100%',
            borderRadius: 'var(--radius-xl)',
            backgroundColor: 'var(--color-primary)',
            color: 'var(--color-on-primary)',
            padding: `var(--space-10) var(--space-10) 0`,
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-5)',
            overflow: 'hidden',
          }}
        >
          <div>
            <h2
              style={{
                margin: `0 0 var(--space-3)`,
                fontSize: '27px',
                fontWeight: 800,
                letterSpacing: '-0.025em',
                lineHeight: 1.2,
              }}
            >
              Kenapa line berhenti, dan berapa biayanya
            </h2>
            <p
              style={{
                margin: `0 0 var(--space-4)`,
                fontSize: '13.5px',
                lineHeight: 1.6,
                opacity: 0.92,
                textAlign: 'justify',
              }}
            >
              Alasan Downtime, Target Produksi versus Produksi Aktual per Shift, Quality, dan jejak waktu:
              lapisan yang mengubah papan status menjadi penjelasan.
            </p>

            <ul
              style={{
                listStyle: 'none',
                margin: 0,
                padding: 0,
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                columnGap: 'var(--space-5)',
                rowGap: 'var(--space-2)',
              }}
            >
              {HERO_POINTS.map((point) => (
                <li
                  key={point}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-3)',
                    fontSize: '13px',
                    fontWeight: 600,
                  }}
                >
                  <Icon name="arrow_right_alt" size={17} />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Product preview. Anchored to the bottom edge and allowed to run
 past it, the way the reference does, it reads as a window onto
 the console rather than a screenshot pasted into a box. */}
          <SurfaceCard
            padding="lg"
            style={{
              marginTop: 'auto',
              borderRadius: 'var(--radius-xl) var(--radius-xl) 0 0',
              flexShrink: 0,
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: 'var(--space-4)',
                marginBottom: 'var(--space-4)',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: '10px',
                    fontWeight: 800,
                    letterSpacing: '0.09em',
                    color: 'var(--color-primary)',
                    marginBottom: 'var(--space-1)',
                  }}
                >
                  CONTOH TAMPILAN
                </div>
                <div
                  style={{
                    fontSize: '19px',
                    fontWeight: 800,
                    color: 'var(--color-on-surface)',
                    letterSpacing: '-0.02em',
                  }}
                >
                  Executive Dashboard
                </div>
                <p
                  style={{
                    margin: `var(--space-1) 0 0`,
                    fontSize: '11.5px',
                    color: 'var(--color-on-surface-variant)',
                    lineHeight: 1.55,
                  }}
                >
                  Delapan KPI eksekutif dengan target, variance, dan status. Setiap angka dibaca dari transaksi
                  shop floor, tidak ada yang dihitung ulang di browser.
                </p>
              </div>

              <span
                style={{
                  flexShrink: 0,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                  padding: `var(--space-2) var(--space-3)`,
                  borderRadius: 'var(--radius-sm, 8px)',
                  border: '1px solid var(--color-outline-variant)',
                  backgroundColor: 'var(--color-surface-container)',
                  color: 'var(--color-on-surface-variant)',
                  fontSize: '11.5px',
                  fontWeight: 700,
                }}
              >
                7 hari
                <Icon name="expand_more" size={15} />
              </span>
            </div>

            {/*, the surface is identical across the row; only the icon
 and the figure are toned, so the data carries the difference
 rather than eight competing fills. */}
            <div className="fv-login__kpi-grid">
              {PREVIEW_KPIS.map((kpi) => (
                <div
                  key={kpi.label}
                  style={{
                    padding: 'var(--space-3)',
                    borderRadius: 'var(--radius-md, 12px)',
                    backgroundColor: 'var(--color-surface-container)',
                    border: '1px solid var(--color-outline-variant)',
                    borderLeft: `3px solid ${toneColor[kpi.tone]}`,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 'var(--space-2)',
                    }}
                  >
                    <span
                      style={{
                        display: 'inline-flex',
                        width: '22px',
                        height: '22px',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: 'var(--radius-xs, 6px)',
                        backgroundColor: toneContainer[kpi.tone],
                        color: toneOnContainer[kpi.tone],
                      }}
                    >
                      <Icon name={kpi.icon} size={13} />
                    </span>
                    <span
                      style={{ fontSize: '10.5px', fontWeight: 700, color: 'var(--color-on-surface-variant)' }}
                    >
                      {kpi.label}
                    </span>
                  </div>

                  <div
                    style={{
                      marginTop: 'var(--space-2)',
                      fontSize: '19px',
                      fontWeight: 800,
                      letterSpacing: '-0.02em',
                      color: toneColor[kpi.tone],
                    }}
                  >
                    {kpi.value}
                  </div>
                  <div style={{ fontSize: '10px', color: 'var(--color-on-surface-variant)', marginTop: 'var(--space-1)' }}>
                    {kpi.caption}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 'var(--space-4)' }}>
              <div
                style={{
                  fontSize: '10px',
                  fontWeight: 800,
                  letterSpacing: '0.09em',
                  color: 'var(--color-primary)',
                  marginBottom: 'var(--space-1)',
                }}
              >
                ANALISIS BOTTLENECK
              </div>
              <div
                style={{
                  fontSize: '14.5px',
                  fontWeight: 800,
                  color: 'var(--color-on-surface)',
                  marginBottom: 'var(--space-3)',
                }}
              >
                Mesin mana yang menahan output
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {PREVIEW_BOTTLENECKS.map((row) => (
                  <div
                    key={row.machine}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'minmax(120px, 1fr) minmax(0, 2fr) auto',
                      alignItems: 'center',
                      gap: 'var(--space-3)',
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '11.5px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
                        {row.machine}
                      </div>
                      <div style={{ fontSize: '10px', color: 'var(--color-on-surface-variant)' }}>
                        {row.context}
                      </div>
                    </div>

                    <div
                      style={{
                        height: '7px',
                        borderRadius: 'var(--radius-full, 999px)',
                        backgroundColor: 'var(--color-surface-container-highest)',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          width: `${row.achievement}%`,
                          height: '100%',
                          backgroundColor: toneColor[row.tone],
                        }}
                      />
                    </div>

                    <span
                      style={{
                        fontSize: '11.5px',
                        fontWeight: 800,
                        color: 'var(--color-on-surface)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      OEE {row.oee.toFixed(1)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </SurfaceCard>
        </div>
      </div>
    </div>
  );
};
