import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import type { LimitUsage } from '@factory-vision/domain-types';
import { Button, Icon } from '@factory-vision/ui';
import { SurfaceCard, toneColor, type Tone } from '@factory-vision/ui/fv';
import { api, idr, InternalApiError, num } from '../../app/api.js';
import { useSession } from '../../app/SessionContext.js';
import { Pill, Placeholder } from './PortfolioPage.js';
import { SupportAccessPanel } from '../support/SupportAccessPanel.js';

const STATUS_LABEL: Record<string, string> = {
  PROSPECT: 'Prospek',
  TRIAL: 'Trial',
  ACTIVE: 'Aktif',
  SUSPENDED: 'Ditangguhkan',
  CHURNED: 'Berhenti',
};

const STATUS_TONE: Record<string, Tone> = {
  PROSPECT: 'neutral',
  TRIAL: 'info',
  ACTIVE: 'success',
  SUSPENDED: 'warning',
  CHURNED: 'error',
};

/** One client in full: entitlement, what they use, and who has reached in. */
export const ClientDetailPage: React.FC = () => {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = useSession();

  const [error, setError] = useState<string | null>(null);

  const client = useQuery({ queryKey: ['client', id], queryFn: () => api.clients.get(id) });
  const usage = useQuery({ queryKey: ['client-usage', id], queryFn: () => api.clients.usage(id, 30) });
  const history = useQuery({ queryKey: ['client-subs', id], queryFn: () => api.clients.subscriptions(id) });
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => api.plans() });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['client', id] });
    queryClient.invalidateQueries({ queryKey: ['clients'] });
    queryClient.invalidateQueries({ queryKey: ['summary'] });
  };

  const setStatus = useMutation({
    mutationFn: (status: string) => api.clients.setStatus(id, status),
    onSuccess: invalidate,
    onError: (err) => setError(err instanceof InternalApiError ? err.message : 'Gagal mengubah status.'),
  });

  const changePlan = useMutation({
    mutationFn: (planId: string) =>
      api.clients.changePlan(id, { planId, startedAt: new Date().toISOString().slice(0, 10) }),
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['client-subs', id] });
    },
    onError: (err) => setError(err instanceof InternalApiError ? err.message : 'Gagal mengubah paket.'),
  });

  if (client.isLoading) return <Placeholder label="Memuat data klien…" />;
  if (!client.data) return <Placeholder label="Klien tidak ditemukan." />;

  const { client: c, subscription, limitReport, daysToRenewal, daysSinceActivity, attention } = client.data;

  return (
    <div style={{ padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <button
        type="button"
        onClick={() => navigate('/')}
        style={{
          alignSelf: 'flex-start',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--color-on-surface-variant)',
          fontSize: '12px',
          fontWeight: 700,
          fontFamily: 'var(--font-family)',
          padding: 0,
        }}
      >
        <Icon name="arrow_back" size={16} />
        Portofolio
      </button>

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <h1
              style={{
                margin: 0,
                fontSize: '22px',
                fontWeight: 800,
                letterSpacing: '-0.02em',
                color: 'var(--color-on-surface)',
              }}
            >
              {c.displayName}
            </h1>
            <Pill tone={STATUS_TONE[c.lifecycleStatus]}>{STATUS_LABEL[c.lifecycleStatus]}</Pill>
          </div>
          <div style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)', marginTop: 'var(--space-1)' }}>
            {c.legalName} · tenant <code>{c.tenantId}</code>
          </div>
        </div>

        {can('client:manage') && (
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
            <select
              value={c.lifecycleStatus}
              onChange={(e) => setStatus.mutate(e.target.value)}
              disabled={setStatus.isPending}
              style={{
                padding: `var(--space-2) var(--space-3)`,
                fontSize: '12px',
                fontFamily: 'var(--font-family)',
                borderRadius: 'var(--radius-sm, 8px)',
                border: '1px solid var(--color-outline-variant)',
                backgroundColor: 'var(--color-surface-container)',
                color: 'var(--color-on-surface)',
              }}
            >
              {Object.entries(STATUS_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {error && (
        <div
          role="alert"
          style={{
            padding: `var(--space-3) var(--space-3)`,
            borderRadius: 'var(--radius-sm, 8px)',
            backgroundColor: 'var(--color-error-container)',
            color: 'var(--color-on-error-container)',
            fontSize: '12px',
            fontWeight: 600,
          }}
        >
          {error}
        </div>
      )}

      {attention.length > 0 && (
        <SurfaceCard
          padding="md"
          railTone={attention.some((a) => a.severity === 'CRITICAL') ? 'error' : 'warning'}
        >
          <div
            style={{ fontSize: '12px', fontWeight: 800, color: 'var(--color-on-surface)', marginBottom: 'var(--space-2)' }}
          >
            Perlu Ditindaklanjuti
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {attention.map((item) => (
              <div key={item.kind} style={{ fontSize: '12.5px', color: 'var(--color-on-surface-variant)' }}>
                • {item.message}
              </div>
            ))}
          </div>
        </SurfaceCard>
      )}

      <div
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: 'var(--space-3)' }}
      >
        <SurfaceCard padding="md">
          <SectionTitle>Kontak</SectionTitle>
          <Row label="Nama" value={c.contactName ?? '—'} />
          <Row label="Email" value={c.contactEmail ?? '—'} />
          <Row label="Telepon" value={c.contactPhone ?? '—'} />
          <Row label="Account Manager" value={c.accountManager ?? '—'} />
          <Row label="Industri" value={c.industry ?? '—'} />
          <Row label="Kota" value={c.city ?? '—'} />
          <Row
            label="Deployment"
            value={c.deploymentMode === 'CLOUD_MULTI_TENANT' ? 'Cloud SaaS' : 'On-Premise'}
          />
        </SurfaceCard>

        <SurfaceCard padding="md">
          <SectionTitle>Langganan</SectionTitle>
          <Row label="Paket" value={subscription?.planName ?? '—'} />
          <Row label="Status" value={subscription?.status ?? '—'} />
          <Row label="Mulai" value={subscription?.startedAt ?? '—'} />
          <Row
            label="Perpanjangan"
            value={
              subscription?.renewsAt
                ? `${subscription.renewsAt}${daysToRenewal !== null ? ` (${daysToRenewal < 0 ? `lewat ${Math.abs(daysToRenewal)}` : daysToRenewal} hari)` : ''}`
                : '—'
            }
            tone={daysToRenewal !== null && daysToRenewal < 0 ? 'error' : undefined}
          />
          <Row
            label="Aktivitas terakhir"
            value={daysSinceActivity === null ? 'Belum ada' : `${daysSinceActivity} hari lalu`}
          />

          {can('subscription:manage') && (
            <div style={{ marginTop: 'var(--space-3)', display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              {plans.data
                ?.filter((p) => p.id !== subscription?.planId)
                .map((p) => (
                  <Button
                    key={p.id}
                    variant="outlined"
                    onClick={() => changePlan.mutate(p.id)}
                    disabled={changePlan.isPending}
                    style={{ fontSize: '11px' }}
                  >
                    Pindah ke {p.name}
                  </Button>
                ))}
            </div>
          )}
        </SurfaceCard>

        <SurfaceCard padding="md">
          <SectionTitle>Pemakaian vs Batas Paket</SectionTitle>
          {limitReport ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <LimitBar label="Plant" limit={limitReport.plants} />
              <LimitBar label="Production Line" limit={limitReport.productionLines} />
              <LimitBar label="Mesin" limit={limitReport.machines} />
              <LimitBar label="Pengguna" limit={limitReport.users} />
              <LimitBar label="Operator" limit={limitReport.operators} />
            </div>
          ) : (
            <div style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>
              Belum ada sampel pemakaian. Jalankan "Ambil Sampel Pemakaian" di portofolio.
            </div>
          )}
        </SurfaceCard>
      </div>

      <SurfaceCard padding="md">
        <SectionTitle>Aktivitas 30 Hari</SectionTitle>
        {usage.data && usage.data.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--color-on-surface-variant)' }}>
                  <th style={cellStyle}>Tanggal</th>
                  <th style={cellStyle}>Work Order</th>
                  <th style={cellStyle}>Catatan Produksi</th>
                  <th style={cellStyle}>Catatan Downtime</th>
                  <th style={cellStyle}>Pengguna Aktif 7h</th>
                  <th style={cellStyle}>Terminal Online</th>
                </tr>
              </thead>
              <tbody>
                {[...usage.data].reverse().map((row) => (
                  <tr key={row.capturedOn} style={{ borderTop: '1px solid var(--color-outline-variant)' }}>
                    <td style={cellStyle}>{row.capturedOn}</td>
                    <td style={cellStyle}>{num(row.workOrdersCreated)}</td>
                    <td style={cellStyle}>{num(row.productionRecords)}</td>
                    <td style={cellStyle}>{num(row.downtimeRecords)}</td>
                    <td style={cellStyle}>{num(row.activeUsers7d)}</td>
                    <td style={cellStyle}>{num(row.terminalsOnline)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>
            Belum ada sampel pemakaian untuk klien ini.
          </div>
        )}
      </SurfaceCard>

      <SupportAccessPanel clientId={id} />

      <SurfaceCard padding="md">
        <SectionTitle>Riwayat Langganan</SectionTitle>
        {history.data?.length ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {history.data.map((s) => (
              <div
                key={s.id}
                style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', gap: 'var(--space-3)' }}
              >
                <span style={{ color: 'var(--color-on-surface)' }}>
                  {s.planName} · {s.startedAt} sampai {s.endedAt ?? 'sekarang'}
                </span>
                <Pill tone={s.status === 'ACTIVE' ? 'success' : 'neutral'}>{s.status}</Pill>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>Belum ada riwayat.</div>
        )}
      </SurfaceCard>
    </div>
  );
};

const cellStyle: React.CSSProperties = { padding: `var(--space-2) var(--space-3)`, whiteSpace: 'nowrap' };

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ fontSize: '12px', fontWeight: 800, color: 'var(--color-on-surface)', marginBottom: 'var(--space-3)' }}>
    {children}
  </div>
);

const Row: React.FC<{ label: string; value: string; tone?: Tone }> = ({ label, value, tone }) => (
  <div
    style={{
      display: 'flex',
      justifyContent: 'space-between',
      gap: 'var(--space-3)',
      fontSize: '12.5px',
      padding: `var(--space-1) 0`,
    }}
  >
    <span style={{ color: 'var(--color-on-surface-variant)' }}>{label}</span>
    <span
      style={{ fontWeight: 700, color: tone ? toneColor[tone] : 'var(--color-on-surface)', textAlign: 'right' }}
    >
      {value}
    </span>
  </div>
);

/** A bar that fills toward the ceiling, and turns red once past it. */
const LimitBar: React.FC<{ label: string; limit: LimitUsage }> = ({ label, limit }) => {
  const pct = limit.limit === null ? 0 : Math.min(100, (limit.used / Math.max(limit.limit, 1)) * 100);
  const tone: Tone = limit.exceeded ? 'error' : pct >= 80 ? 'warning' : 'success';

  return (
    <div>
      <div
        style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11.5px', marginBottom: 'var(--space-1)' }}
      >
        <span style={{ color: 'var(--color-on-surface-variant)' }}>{label}</span>
        <span style={{ fontWeight: 700, color: limit.exceeded ? toneColor.error : 'var(--color-on-surface)' }}>
          {num(limit.used)} / {limit.limit === null ? '∞' : num(limit.limit)}
        </span>
      </div>
      <div
        style={{
          height: '6px',
          borderRadius: 'var(--radius-full, 999px)',
          backgroundColor: 'var(--color-surface-container-highest)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${limit.limit === null ? 4 : pct}%`,
            height: '100%',
            backgroundColor: toneColor[tone],
          }}
        />
      </div>
    </div>
  );
};
