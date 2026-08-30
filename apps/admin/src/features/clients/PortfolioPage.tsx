import React, { useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { ClientOverview, LimitUsage } from '@factory-vision/domain-types';
import { Button, Icon } from '@factory-vision/ui';
import {
  MetricCard,
  SurfaceCard,
  toneColor,
  toneContainer,
  toneOnContainer,
  type Tone,
} from '@factory-vision/ui/fv';
import { api, idr, num } from '../../app/api.js';
import { useSession } from '../../app/SessionContext.js';
import { NewClientDialog } from './NewClientDialog.js';

/** Lifecycle to tone, so the same status reads the same colour everywhere. */
const STATUS_TONE: Record<string, Tone> = {
  PROSPECT: 'neutral',
  TRIAL: 'info',
  ACTIVE: 'success',
  SUSPENDED: 'warning',
  CHURNED: 'error',
};

const STATUS_LABEL: Record<string, string> = {
  PROSPECT: 'Prospek',
  TRIAL: 'Trial',
  ACTIVE: 'Aktif',
  SUSPENDED: 'Ditangguhkan',
  CHURNED: 'Berhenti',
};

const SEVERITY_TONE: Record<string, Tone> = {
  CRITICAL: 'error',
  WARNING: 'warning',
  INFORMATIONAL: 'info',
};

/**
 * The portfolio the vendor manages.
 *
 * Ordered so anything needing action is at the top: a lapsed subscription is
 * money already lost, and a client silently over their plan limit is money not
 * yet billed. Both are easier to fix the week they happen.
 */
export const PortfolioPage: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = useSession();

  const [statusFilter, setStatusFilter] = useState<string>('');
  const [search, setSearch] = useState('');
  const [showNew, setShowNew] = useState(false);

  const summary = useQuery({ queryKey: ['summary'], queryFn: () => api.summary() });
  const clients = useQuery({
    queryKey: ['clients', statusFilter, search],
    queryFn: () => api.clients.list({ status: statusFilter || undefined, search: search || undefined }),
  });

  const capture = useMutation({
    mutationFn: () => api.usage.capture(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.invalidateQueries({ queryKey: ['summary'] });
    },
  });

  const s = summary.data;

  return (
    <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: '16px',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h1
            style={{
              margin: 0,
              fontSize: '22px',
              fontWeight: 800,
              letterSpacing: '-0.02em',
              color: 'var(--color-on-surface)',
            }}
          >
            Portofolio Klien
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>
            Status langganan, pemakaian, dan hal yang perlu ditindaklanjuti
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Button
            variant="outlined"
            onClick={() => capture.mutate()}
            disabled={capture.isPending}
            icon={<Icon name="sync" size={16} />}
          >
            {capture.isPending ? 'Mengambil…' : 'Ambil Sampel Pemakaian'}
          </Button>
          {can('client:manage') && (
            <Button variant="filled" onClick={() => setShowNew(true)} icon={<Icon name="add" size={16} />}>
              Klien Baru
            </Button>
          )}
        </div>
      </div>

      <div
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}
      >
        <MetricCard
          label="Total Klien"
          value={num(s?.totalClients)}
          delta={s ? `${s.byStatus.ACTIVE} aktif, ${s.byStatus.TRIAL} trial` : '-'}
          deltaType="neutral"
          tone="primary"
          icon={<Icon name="apartment" size={18} />}
        />
        <MetricCard
          label="MRR Bulanan"
          value={idr(s?.monthlyRecurringIdr)}
          delta="Dari langganan aktif"
          deltaType="neutral"
          tone="success"
          icon={<Icon name="payments" size={18} />}
        />
        <MetricCard
          label="Perpanjangan 30h"
          value={num(s?.renewalsDue30d)}
          delta={s && s.renewalsDue30d > 0 ? 'Perlu ditindaklanjuti' : 'Tidak ada'}
          deltaType={s && s.renewalsDue30d > 0 ? 'negative' : 'positive'}
          tone="warning"
          icon={<Icon name="event" size={18} />}
        />
        <MetricCard
          label="Lewat Batas"
          value={num(s?.clientsOverLimit)}
          delta={s && s.clientsOverLimit > 0 ? 'Peluang upgrade' : 'Semua dalam batas'}
          deltaType={s && s.clientsOverLimit > 0 ? 'negative' : 'positive'}
          tone="error"
          icon={<Icon name="trending_up" size={18} />}
        />
        <MetricCard
          label="Tanpa Aktivitas"
          value={num(s?.clientsWithoutRecentActivity)}
          delta="Lebih dari 14 hari"
          deltaType={s && s.clientsWithoutRecentActivity > 0 ? 'negative' : 'positive'}
          tone="warning"
          icon={<Icon name="warning" size={18} />}
        />
        <MetricCard
          label="Akses Dukungan"
          value={num(s?.openSupportGrants)}
          delta="Ke data pelanggan"
          deltaType="neutral"
          tone="info"
          icon={<Icon name="admin_panel_settings" size={18} />}
        />
      </div>

      <SurfaceCard padding="md">
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari nama klien…"
            style={{
              flex: '1 1 220px',
              padding: '9px 12px',
              fontSize: '13px',
              fontFamily: 'var(--font-family)',
              color: 'var(--color-on-surface)',
              backgroundColor: 'var(--color-surface-container)',
              border: '1px solid var(--color-outline-variant)',
              borderRadius: 'var(--radius-sm, 8px)',
              outline: 'none',
            }}
          />
          {['', 'ACTIVE', 'TRIAL', 'PROSPECT', 'SUSPENDED', 'CHURNED'].map((value) => {
            const selected = statusFilter === value;
            return (
              <button
                key={value || 'ALL'}
                type="button"
                onClick={() => setStatusFilter(value)}
                style={{
                  padding: '8px 14px',
                  borderRadius: 'var(--radius-full, 999px)',
                  border: '1px solid var(--color-outline-variant)',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-family)',
                  fontSize: '12px',
                  fontWeight: 700,
                  backgroundColor: selected ? 'var(--color-primary)' : 'var(--color-surface)',
                  color: selected ? 'var(--color-on-primary)' : 'var(--color-on-surface-variant)',
                }}
              >
                {value ? STATUS_LABEL[value] : 'Semua'}
              </button>
            );
          })}
        </div>
      </SurfaceCard>

      {clients.isLoading && <Placeholder label="Memuat daftar klien…" />}
      {clients.data?.length === 0 && <Placeholder label="Belum ada klien yang cocok dengan filter ini." />}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {clients.data?.map((overview) => (
          <ClientRow
            key={overview.client.id}
            overview={overview}
            onOpen={() => navigate(`/clients/${overview.client.id}`)}
          />
        ))}
      </div>

      {showNew && (
        <NewClientDialog
          onClose={() => setShowNew(false)}
          onCreated={() => {
            setShowNew(false);
            queryClient.invalidateQueries({ queryKey: ['clients'] });
            queryClient.invalidateQueries({ queryKey: ['summary'] });
          }}
        />
      )}
    </div>
  );
};

const ClientRow: React.FC<{ overview: ClientOverview; onOpen: () => void }> = ({ overview, onOpen }) => {
  const { client, subscription, limitReport, daysToRenewal, usage, attention } = overview;
  const worst = attention.find((a) => a.severity === 'CRITICAL') ?? attention[0];

  return (
    <SurfaceCard
      padding="md"
      interactive
      onClick={onOpen}
      railTone={worst ? SEVERITY_TONE[worst.severity] : undefined}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
        <div style={{ minWidth: '220px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '15px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
              {client.displayName}
            </span>
            <Pill tone={STATUS_TONE[client.lifecycleStatus]}>{STATUS_LABEL[client.lifecycleStatus]}</Pill>
          </div>
          <div style={{ fontSize: '11.5px', color: 'var(--color-on-surface-variant)', marginTop: '3px' }}>
            {client.legalName}
            {client.city ? ` · ${client.city}` : ''}
            {client.accountManager ? ` · AM ${client.accountManager}` : ''}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '22px', flexWrap: 'wrap', alignItems: 'center' }}>
          <Stat label="Paket" value={subscription?.planName ?? '—'} />
          <Stat
            label="Perpanjangan"
            value={
              daysToRenewal === null
                ? '—'
                : daysToRenewal < 0
                  ? `Lewat ${Math.abs(daysToRenewal)} hari`
                  : `${daysToRenewal} hari`
            }
            tone={
              daysToRenewal !== null && daysToRenewal < 0
                ? 'error'
                : daysToRenewal !== null && daysToRenewal <= 30
                  ? 'warning'
                  : undefined
            }
          />
          <Stat
            label="Production Line"
            value={limitReport ? formatLimit(limitReport.productionLines) : '—'}
            tone={limitReport?.productionLines.exceeded ? 'error' : undefined}
          />
          <Stat
            label="Pengguna"
            value={limitReport ? formatLimit(limitReport.users) : '—'}
            tone={limitReport?.users.exceeded ? 'error' : undefined}
          />
          <Stat
            label="Aktivitas Terakhir"
            value={
              usage?.lastActivityAt ? new Date(usage.lastActivityAt).toLocaleDateString('id-ID') : 'Belum ada'
            }
          />
          <Icon name="chevron_right" size={18} />
        </div>
      </div>

      {attention.length > 0 && (
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '10px' }}>
          {attention.map((item) => (
            <Pill key={item.kind} tone={SEVERITY_TONE[item.severity]}>
              {item.message}
            </Pill>
          ))}
        </div>
      )}
    </SurfaceCard>
  );
};

const formatLimit = (limit: LimitUsage) =>
  `${num(limit.used)} / ${limit.limit === null ? '∞' : num(limit.limit)}`;

const Stat: React.FC<{ label: string; value: string; tone?: Tone }> = ({ label, value, tone }) => (
  <div>
    <div
      style={{
        fontSize: '10px',
        fontWeight: 700,
        letterSpacing: '0.05em',
        color: 'var(--color-on-surface-variant)',
      }}
    >
      {label.toUpperCase()}
    </div>
    <div
      style={{ fontSize: '13px', fontWeight: 700, color: tone ? toneColor[tone] : 'var(--color-on-surface)' }}
    >
      {value}
    </div>
  </div>
);

export const Pill: React.FC<{ tone: Tone; children: React.ReactNode }> = ({ tone, children }) => (
  <span
    style={{
      padding: '2px 9px',
      borderRadius: 'var(--radius-full, 999px)',
      backgroundColor: toneContainer[tone],
      color: toneOnContainer[tone],
      fontSize: '11px',
      fontWeight: 700,
    }}
  >
    {children}
  </span>
);

export const Placeholder: React.FC<{ label: string }> = ({ label }) => (
  <SurfaceCard padding="lg">
    <div style={{ textAlign: 'center', color: 'var(--color-on-surface-variant)', fontSize: '13px' }}>
      {label}
    </div>
  </SurfaceCard>
);
