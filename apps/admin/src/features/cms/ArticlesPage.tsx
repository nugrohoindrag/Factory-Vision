import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Icon } from '@factory-vision/ui';
import { SurfaceCard, toneContainer, toneOnContainer, type Tone } from '@factory-vision/ui/fv';
import type { CmsArticle, CmsArticleStatus } from '@factory-vision/domain-types';
import { api, InternalApiError } from '../../app/api.js';
import { useSession } from '../../app/SessionContext.js';

type Draft = {
  title: string;
  slug: string;
  excerpt: string;
  coverImageUrl: string;
  authorName: string;
  seoTitle: string;
  bodyMarkdown: string;
}

const EMPTY: Draft = { title: '', slug: '', excerpt: '', coverImageUrl: '', authorName: '', seoTitle: '', bodyMarkdown: '' };

const STATUS: Record<CmsArticleStatus, { label: string; tone: Tone }> = {
  DRAFT: { label: 'Draf', tone: 'neutral' },
  PUBLISHED: { label: 'Terbit', tone: 'success' },
  ARCHIVED: { label: 'Arsip', tone: 'warning' },
};

/**
 * Articles for the public site. Written in Markdown here, rendered by the API
 * at /blog/<slug> as plain HTML so search engines index them. A save never
 * publishes: publishing is its own button, and the slug of a published
 * article is frozen because its URL is already out there.
 */
export const ArticlesPage: React.FC = () => {
  const { can } = useSession();
  const queryClient = useQueryClient();
  const articles = useQuery({ queryKey: ['cms-articles'], queryFn: () => api.cms.articles() });
  const settings = useQuery({ queryKey: ['site-settings'], queryFn: () => api.cms.settings() });

  const [editing, setEditing] = useState<CmsArticle | null | 'new'>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (editing === 'new') setDraft(EMPTY);
    else if (editing) {
      setDraft({
        title: editing.title,
        slug: editing.slug,
        excerpt: editing.excerpt ?? '',
        coverImageUrl: editing.coverImageUrl ?? '',
        authorName: editing.authorName ?? '',
        seoTitle: editing.seoTitle ?? '',
        bodyMarkdown: editing.bodyMarkdown,
      });
    }
    setError(null);
    setFieldErrors({});
  }, [editing]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['cms-articles'] });
  const fail = (fallback: string) => (err: unknown) => {
    if (err instanceof InternalApiError) {
      setError(err.message);
      setFieldErrors(Object.fromEntries(err.fields.map((f) => [f.field, f.message])));
    } else {
      setError(fallback);
    }
  };

  const save = useMutation({
    mutationFn: () => (editing === 'new' || !editing ? api.cms.createArticle(draft) : api.cms.updateArticle(editing.id, draft)),
    onSuccess: (a) => {
      setEditing(a);
      setError(null);
      setFieldErrors({});
      refresh();
    },
    onError: fail('Gagal menyimpan artikel.'),
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: CmsArticleStatus }) => api.cms.setArticleStatus(id, status),
    onSuccess: (a) => {
      if (editing && editing !== 'new' && editing.id === a.id) setEditing(a);
      refresh();
    },
    onError: fail('Gagal mengubah status artikel.'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.cms.deleteArticle(id),
    onSuccess: () => {
      setEditing(null);
      refresh();
    },
    onError: fail('Gagal menghapus artikel.'),
  });

  const siteUrl = settings.data?.siteUrl || 'https://factoryvision.id';
  const manage = can('cms:manage');
  const set = (key: keyof Draft) => (value: string) => setDraft((d) => ({ ...d, [key]: value }));
  const current = editing && editing !== 'new' ? editing : null;
  const slugFrozen = current?.status === 'PUBLISHED';

  return (
    <div style={{ padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--color-on-surface)' }}>
            Artikel
          </h1>
          <p style={{ margin: `var(--space-1) 0 0`, fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>
            Tulisan untuk {siteUrl}/blog, ditulis dalam Markdown dan dirender sebagai halaman HTML untuk mesin pencari
          </p>
        </div>
        {manage && (
          <Button variant="filled" icon={<Icon name="add" size={16} />} onClick={() => setEditing('new')}>
            Artikel baru
          </Button>
        )}
      </div>

      {editing && (
        <SurfaceCard padding="lg">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <span style={{ fontSize: '15px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
                {current ? `Edit: ${current.title}` : 'Artikel baru'}
              </span>
              {current && <StatusPill status={current.status} />}
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              {current?.status === 'PUBLISHED' && (
                <a
                  href={`${siteUrl}/blog/${current.slug}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', fontSize: '12.5px', fontWeight: 700, color: 'var(--color-primary)' }}
                >
                  <Icon name="open_in_new" size={14} /> Lihat halaman
                </a>
              )}
              <Button variant="text" onClick={() => setEditing(null)}>
                Tutup
              </Button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 'var(--space-3)' }}>
            <Field label="Judul" required value={draft.title} onChange={set('title')} error={fieldErrors.title} disabled={!manage} />
            <Field
              label="Slug (URL)"
              value={draft.slug}
              onChange={set('slug')}
              error={fieldErrors.slug}
              placeholder="dibentuk dari judul bila kosong"
              mono
              disabled={!manage || slugFrozen}
              hint={slugFrozen ? 'Slug artikel yang sudah terbit tidak dapat diubah.' : `${siteUrl}/blog/${draft.slug || '…'}`}
            />
            <Field label="Penulis" value={draft.authorName} onChange={set('authorName')} error={fieldErrors.authorName} disabled={!manage} />
            <Field label="Judul SEO (opsional)" value={draft.seoTitle} onChange={set('seoTitle')} error={fieldErrors.seoTitle} placeholder="Judul di tab browser dan hasil pencarian" disabled={!manage} />
            <Field label="URL gambar sampul" value={draft.coverImageUrl} onChange={set('coverImageUrl')} error={fieldErrors.coverImageUrl} placeholder="https://… atau /assets/…" mono disabled={!manage} />
          </div>
          <div style={{ marginTop: 'var(--space-3)' }}>
            <Field
              label="Ringkasan (meta description)"
              value={draft.excerpt}
              onChange={set('excerpt')}
              error={fieldErrors.excerpt}
              placeholder="1–2 kalimat yang tampil di daftar artikel dan hasil pencarian"
              disabled={!manage}
              multiline
              rows={2}
            />
          </div>
          <div style={{ marginTop: 'var(--space-3)' }}>
            <Field
              label="Isi artikel (Markdown)"
              value={draft.bodyMarkdown}
              onChange={set('bodyMarkdown')}
              error={fieldErrors.bodyMarkdown}
              placeholder={'## Judul bagian\n\nParagraf pembuka…\n\n- poin satu\n- poin dua\n\n![keterangan](https://…/gambar.jpg)'}
              disabled={!manage}
              multiline
              mono
              rows={18}
            />
            <p style={{ margin: `var(--space-2) 0 0`, fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
              Mendukung heading (##), tebal (**teks**), daftar, tautan, gambar, tabel, dan kutipan (&gt;). HTML mentah tidak dirender.
            </p>
          </div>

          {error && <p style={{ margin: `var(--space-3) 0 0`, fontSize: '12px', color: 'var(--color-error)' }}>{error}</p>}

          {manage && (
            <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-4)', flexWrap: 'wrap', alignItems: 'center' }}>
              <Button variant="filled" icon={<Icon name="save" size={16} />} disabled={save.isPending || draft.title.trim().length < 3} onClick={() => save.mutate()}>
                {save.isPending ? 'Menyimpan…' : current ? 'Simpan perubahan' : 'Simpan sebagai draf'}
              </Button>
              {current && current.status !== 'PUBLISHED' && (
                <Button
                  variant="tonal"
                  icon={<Icon name="publish" size={16} />}
                  disabled={setStatus.isPending || !current.bodyMarkdown.trim()}
                  onClick={() => setStatus.mutate({ id: current.id, status: 'PUBLISHED' })}
                  title={!current.bodyMarkdown.trim() ? 'Simpan isi artikel dulu' : undefined}
                >
                  Terbitkan
                </Button>
              )}
              {current?.status === 'PUBLISHED' && (
                <Button variant="tonal" icon={<Icon name="unpublished" size={16} />} disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: current.id, status: 'DRAFT' })}>
                  Tarik dari publikasi
                </Button>
              )}
              {current && current.status !== 'PUBLISHED' && (
                <Button
                  variant="text"
                  style={{ color: 'var(--color-error)' }}
                  icon={<Icon name="delete" size={16} />}
                  disabled={remove.isPending}
                  onClick={() => {
                    if (window.confirm(`Hapus artikel "${current.title}"?`)) remove.mutate(current.id);
                  }}
                >
                  Hapus
                </Button>
              )}
            </div>
          )}
        </SurfaceCard>
      )}

      <SurfaceCard padding="none">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--color-primary)', color: 'var(--color-on-primary)', textAlign: 'left' }}>
                <th style={cell}>Judul</th>
                <th style={cell}>Slug</th>
                <th style={cell}>Status</th>
                <th style={cell}>Terbit</th>
                <th style={cell}>Diubah</th>
                <th style={cell} />
              </tr>
            </thead>
            <tbody>
              {articles.data?.map((a) => (
                <tr key={a.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                  <td style={{ ...cell, whiteSpace: 'normal', minWidth: '240px', fontWeight: 700, color: 'var(--color-on-surface)' }}>{a.title}</td>
                  <td style={{ ...cell, fontFamily: 'var(--font-family-mono, monospace)' }}>{a.slug}</td>
                  <td style={cell}>
                    <StatusPill status={a.status} />
                  </td>
                  <td style={cell}>{a.publishedAt ? new Date(a.publishedAt).toLocaleDateString('id-ID') : '—'}</td>
                  <td style={cell}>
                    {new Date(a.updatedAt).toLocaleString('id-ID')}
                    {a.updatedBy ? ` · ${a.updatedBy}` : ''}
                  </td>
                  <td style={cell}>
                    <Button variant="text" size="sm" icon={<Icon name="edit" size={14} />} onClick={() => setEditing(a)}>
                      {manage ? 'Edit' : 'Lihat'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {articles.data?.length === 0 && (
          <div style={{ padding: 'var(--space-6)', textAlign: 'center', fontSize: '13px', color: 'var(--color-on-surface-variant)' }}>
            Belum ada artikel. Tulis yang pertama, simpan sebagai draf, lalu terbitkan.
          </div>
        )}
      </SurfaceCard>
    </div>
  );
};

const StatusPill: React.FC<{ status: CmsArticleStatus }> = ({ status }) => {
  const s = STATUS[status] ?? STATUS.DRAFT;
  return (
    <span
      style={{
        padding: `var(--space-1) var(--space-2)`,
        borderRadius: 'var(--radius-full, 999px)',
        fontSize: '11px',
        fontWeight: 700,
        backgroundColor: toneContainer[s.tone],
        color: toneOnContainer[s.tone],
      }}
    >
      {s.label}
    </span>
  );
};

const cell: React.CSSProperties = { padding: `var(--space-3) var(--space-3)`, whiteSpace: 'nowrap' };

const fieldStyle: React.CSSProperties = {
  width: '100%',
  padding: `var(--space-3) var(--space-3)`,
  fontSize: '13px',
  fontFamily: 'var(--font-family)',
  color: 'var(--color-on-surface)',
  backgroundColor: 'var(--color-surface-container)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  outline: 'none',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '11px',
  fontWeight: 700,
  color: 'var(--color-on-surface-variant)',
  marginBottom: 'var(--space-2)',
};

const Field: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  placeholder?: string;
  error?: string;
  hint?: string;
  mono?: boolean;
  disabled?: boolean;
  multiline?: boolean;
  rows?: number;
}> = ({ label, value, onChange, required, placeholder, error, hint, mono, disabled, multiline, rows }) => {
  const style = {
    ...fieldStyle,
    borderColor: error ? 'var(--color-error)' : 'var(--color-border)',
    fontFamily: mono ? 'var(--font-family-mono, monospace)' : fieldStyle.fontFamily,
  };
  return (
    <div>
      <label style={labelStyle}>
        {label}
        {required && <span style={{ color: 'var(--color-error)' }}> *</span>}
      </label>
      {multiline ? (
        <textarea value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} disabled={disabled} rows={rows ?? 3} style={{ ...style, resize: 'vertical', lineHeight: 1.5 }} />
      ) : (
        <input type="text" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} disabled={disabled} spellCheck={false} style={style} />
      )}
      {error ? (
        <span style={{ fontSize: '10.5px', color: 'var(--color-error)' }}>{error}</span>
      ) : hint ? (
        <span style={{ fontSize: '10.5px', color: 'var(--color-on-surface-variant)' }}>{hint}</span>
      ) : null}
    </div>
  );
};
