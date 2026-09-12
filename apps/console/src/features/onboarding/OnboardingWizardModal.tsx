import React, { useState } from 'react';
import { Button, Icon } from '@factory-vision/ui';
import { SurfaceCard, toneColor, toneContainer, toneOnContainer } from '@factory-vision/ui/fv';
import type { IndustryType } from '@factory-vision/domain-types';
import { useOnboarding } from './OnboardingContext.js';

interface OnboardingWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type ExperienceOption = 'template' | 'blank' | 'demo';

export const OnboardingWizardModal: React.FC<OnboardingWizardModalProps> = ({ isOpen, onClose }) => {
  const { templates, applyTemplate, createBlank, openTour, openFirstWorkflow } = useOnboarding();

  const [step, setStep] = useState<number>(1);
  const [factoryName, setFactoryName] = useState<string>('PT Manufaktur Maju Sejahtera');
  const [selectedIndustry, setSelectedIndustry] = useState<IndustryType>('automotive');
  const [country, setCountry] = useState<string>('Indonesia');
  const [city, setCity] = useState<string>('Cikarang, Jawa Barat');
  const [timezone, setTimezone] = useState<string>('Asia/Jakarta (WIB)');
  const [workingCalendar, setWorkingCalendar] = useState<string>('2 Shift / 5 Hari Kerja');
  const [experience, setExperience] = useState<ExperienceOption>('template');

  const [applying, setApplying] = useState<boolean>(false);
  const [appliedSuccess, setAppliedSuccess] = useState<boolean>(false);

  if (!isOpen) return null;

  const currentTemplate = templates.find((t) => t.industry === selectedIndustry) || templates[0];

  const handleApply = async () => {
    setApplying(true);
    try {
      if (experience === 'template' || experience === 'demo') {
        await applyTemplate(selectedIndustry, {
          factoryName,
          city,
          timezone: 'Asia/Jakarta',
          workingCalendar,
        });
      } else {
        await createBlank({
          factoryName,
          industry: selectedIndustry,
          country,
          city,
          timezone: 'Asia/Jakarta',
          workingCalendar,
        });
      }
      setAppliedSuccess(true);
      setStep(5);
    } catch {
      // Error handled in service
    } finally {
      setApplying(false);
    }
  };

  const handleStartTour = () => {
    onClose();
    openTour();
  };

  const handleStartFirstWorkflow = () => {
    onClose();
    openFirstWorkflow();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'color-mix(in srgb, var(--color-scrim) 65%, transparent)',
        backdropFilter: 'blur(8px)',
        padding: 'var(--space-4)',
        fontFamily: 'var(--font-family)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '860px',
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
        {/* Modal Header */}
        <div
          style={{
            padding: `var(--space-4) var(--space-6)`,
            borderBottom: '1px solid var(--color-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: 'var(--color-surface-container)',
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
              <Icon name="factory" size={20} />
            </div>
            <div>
              <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-primary)', textTransform: 'uppercase' }}>
                Factory Vision MES 2.0 · Self Onboarding
              </div>
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
                {step === 1 && 'Langkah 1 dari 4: Konfigurasi Profil Pabrik'}
                {step === 2 && 'Langkah 2 dari 4: Pilih Karakteristik Industri'}
                {step === 3 && 'Langkah 3 dari 4: Tentukan Pengalaman Awal Anda'}
                {step === 4 && 'Langkah 4 dari 4: Terapkan Industry Seed Template'}
                {step === 5 && 'Setup Pabrik Selesai! Selamat Datang di MES Anda'}
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

        {/* Modal Body */}
        <div style={{ flex: 1, padding: `var(--space-6)`, overflowY: 'auto' }}>
          {/* STEP 1: FACTORY PROFILE */}
          {step === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <p style={{ margin: 0, fontSize: '13.5px', color: 'var(--color-on-surface-variant)', lineHeight: 1.6 }}>
                Lengkapi identitas dasar pabrik Anda. Informasi ini akan menjadi basis seluruh alur kerja, jadwal shift, dan pelaporan operasional.
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'var(--space-4)' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: 'var(--space-1)', color: 'var(--color-on-surface)' }}>
                    Nama Pabrik / Manufaktur
                  </label>
                  <input
                    type="text"
                    value={factoryName}
                    onChange={(e) => setFactoryName(e.target.value)}
                    placeholder="Contoh: PT Sumber Logam Presisi"
                    style={{
                      width: '100%',
                      padding: `var(--space-3) var(--space-4)`,
                      fontSize: '14px',
                      borderRadius: '8px',
                      border: '1px solid var(--color-border)',
                      backgroundColor: 'var(--color-surface-container)',
                      color: 'var(--color-on-surface)',
                      outline: 'none',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: 'var(--space-1)', color: 'var(--color-on-surface)' }}>
                    Lokasi / Kota Pabrik
                  </label>
                  <input
                    type="text"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="Contoh: Cikarang, Karawang, Surabaya"
                    style={{
                      width: '100%',
                      padding: `var(--space-3) var(--space-4)`,
                      fontSize: '14px',
                      borderRadius: '8px',
                      border: '1px solid var(--color-border)',
                      backgroundColor: 'var(--color-surface-container)',
                      color: 'var(--color-on-surface)',
                      outline: 'none',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: 'var(--space-1)', color: 'var(--color-on-surface)' }}>
                    Negara
                  </label>
                  <select
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    style={{
                      width: '100%',
                      padding: `var(--space-3) var(--space-4)`,
                      fontSize: '14px',
                      borderRadius: '8px',
                      border: '1px solid var(--color-border)',
                      backgroundColor: 'var(--color-surface-container)',
                      color: 'var(--color-on-surface)',
                      outline: 'none',
                      boxSizing: 'border-box',
                    }}
                  >
                    <option value="Indonesia">Indonesia</option>
                    <option value="Malaysia">Malaysia</option>
                    <option value="Vietnam">Vietnam</option>
                    <option value="Thailand">Thailand</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: 'var(--space-1)', color: 'var(--color-on-surface)' }}>
                    Zona Waktu Operasional
                  </label>
                  <select
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    style={{
                      width: '100%',
                      padding: `var(--space-3) var(--space-4)`,
                      fontSize: '14px',
                      borderRadius: '8px',
                      border: '1px solid var(--color-border)',
                      backgroundColor: 'var(--color-surface-container)',
                      color: 'var(--color-on-surface)',
                      outline: 'none',
                      boxSizing: 'border-box',
                    }}
                  >
                    <option value="Asia/Jakarta (WIB)">WIB (GMT+7 · Jakarta)</option>
                    <option value="Asia/Makassar (WITA)">WITA (GMT+8 · Makassar)</option>
                    <option value="Asia/Jayapura (WIT)">WIT (GMT+9 · Jayapura)</option>
                  </select>
                </div>

                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: 'var(--space-1)', color: 'var(--color-on-surface)' }}>
                    Pola Shift Kerja Awal
                  </label>
                  <select
                    value={workingCalendar}
                    onChange={(e) => setWorkingCalendar(e.target.value)}
                    style={{
                      width: '100%',
                      padding: `var(--space-3) var(--space-4)`,
                      fontSize: '14px',
                      borderRadius: '8px',
                      border: '1px solid var(--color-border)',
                      backgroundColor: 'var(--color-surface-container)',
                      color: 'var(--color-on-surface)',
                      outline: 'none',
                      boxSizing: 'border-box',
                    }}
                  >
                    <option value="2 Shift / 5 Hari Kerja">2 Shift per Hari (Pagi 07:00–15:00, Siang 15:00–23:00)</option>
                    <option value="3 Shift / 24 Jam Non-Stop">3 Shift per Hari (Pagi 07:00–15:00, Siang 15:00–23:00, Malam 23:00–07:00)</option>
                    <option value="1 Shift Normal">1 Shift Siang (08:00–17:00)</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: INDUSTRY SELECTION */}
          {step === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <p style={{ margin: 0, fontSize: '13.5px', color: 'var(--color-on-surface-variant)', lineHeight: 1.6 }}>
                Pilihan industri menentukan template data awal (produk sampel, mesin, alur proses, dan kategori reject) sehingga Anda tidak memulai dari layar kosong.
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 'var(--space-3)' }}>
                {templates.map((tmpl) => {
                  const isSelected = selectedIndustry === tmpl.industry;
                  return (
                    <div
                      key={tmpl.id}
                      onClick={() => setSelectedIndustry(tmpl.industry)}
                      style={{
                        padding: 'var(--space-4)',
                        borderRadius: 'var(--radius-lg, 12px)',
                        border: `2px solid ${isSelected ? 'var(--color-primary)' : 'var(--color-border)'}`,
                        backgroundColor: isSelected ? 'var(--color-surface-container-high)' : 'var(--color-surface)',
                        cursor: 'pointer',
                        transition: 'all 150ms ease',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 'var(--space-2)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div
                          style={{
                            width: '36px',
                            height: '36px',
                            borderRadius: '8px',
                            backgroundColor: isSelected ? 'var(--color-primary)' : 'var(--color-surface-container)',
                            color: isSelected ? 'var(--color-on-primary)' : 'var(--color-primary)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <Icon name={tmpl.icon} size={20} />
                        </div>
                        {isSelected && (
                          <span style={{ color: 'var(--color-primary)', fontWeight: 800 }}>
                            <Icon name="check_circle" size={20} />
                          </span>
                        )}
                      </div>

                      <div style={{ fontSize: '14px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
                        {tmpl.name}
                      </div>

                      <div style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)', lineHeight: 1.5 }}>
                        {tmpl.description}
                      </div>

                      <div style={{ marginTop: 'auto', paddingTop: 'var(--space-2)', fontSize: '11px', fontWeight: 700, color: 'var(--color-primary)' }}>
                        Contoh: {tmpl.sampleProducts.slice(0, 2).join(', ')}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* STEP 3: EXPERIENCE OPTION */}
          {step === 3 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <p style={{ margin: 0, fontSize: '13.5px', color: 'var(--color-on-surface-variant)', lineHeight: 1.6 }}>
                Pilih cara Anda ingin memulai penjelajahan Factory Vision MES:
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {/* Option 1: Template */}
                <div
                  onClick={() => setExperience('template')}
                  style={{
                    padding: 'var(--space-4) var(--space-5)',
                    borderRadius: 'var(--radius-lg, 12px)',
                    border: `2px solid ${experience === 'template' ? 'var(--color-primary)' : 'var(--color-border)'}`,
                    backgroundColor: experience === 'template' ? 'var(--color-surface-container-high)' : 'var(--color-surface)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 'var(--space-4)',
                  }}
                >
                  <div
                    style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '10px',
                      backgroundColor: 'var(--color-primary)',
                      color: 'var(--color-on-primary)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <Icon name="auto_fix_high" size={22} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                      <div style={{ fontSize: '15px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
                        Gunakan Industry Seed Template (Sangat Disarankan)
                      </div>
                      <span
                        style={{
                          padding: `2px var(--space-2)`,
                          borderRadius: '4px',
                          backgroundColor: toneContainer.success,
                          color: toneOnContainer.success,
                          fontSize: '10.5px',
                          fontWeight: 800,
                        }}
                      >
                        SIAP PAKAI
                      </span>
                    </div>
                    <p style={{ margin: `var(--space-1) 0 0`, fontSize: '12.5px', color: 'var(--color-on-surface-variant)', lineHeight: 1.5 }}>
                      Pabrik Anda langsung dilengkapi produk relevan, mesin, routing proses, shift, dan sampel work order. Data hasil clone dapat diedit atau dihapus sepenuhnya kapan saja.
                    </p>
                  </div>
                </div>

                {/* Option 2: Blank */}
                <div
                  onClick={() => setExperience('blank')}
                  style={{
                    padding: 'var(--space-4) var(--space-5)',
                    borderRadius: 'var(--radius-lg, 12px)',
                    border: `2px solid ${experience === 'blank' ? 'var(--color-primary)' : 'var(--color-border)'}`,
                    backgroundColor: experience === 'blank' ? 'var(--color-surface-container-high)' : 'var(--color-surface)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 'var(--space-4)',
                  }}
                >
                  <div
                    style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '10px',
                      backgroundColor: 'var(--color-surface-container)',
                      color: 'var(--color-on-surface)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <Icon name="create_new_folder" size={22} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '15px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
                      Mulai dari Pabrik Kosong (Blank Factory)
                    </div>
                    <p style={{ margin: `var(--space-1) 0 0`, fontSize: '12.5px', color: 'var(--color-on-surface-variant)', lineHeight: 1.5 }}>
                      Buat struktur pabrik tanpa data bawaan. Anda akan dipandu langkah demi langkah menginput master data produk dan mesin Anda sendiri secara manual atau via CSV.
                    </p>
                  </div>
                </div>

                {/* Option 3: Demo */}
                <div
                  onClick={() => setExperience('demo')}
                  style={{
                    padding: 'var(--space-4) var(--space-5)',
                    borderRadius: 'var(--radius-lg, 12px)',
                    border: `2px solid ${experience === 'demo' ? 'var(--color-primary)' : 'var(--color-border)'}`,
                    backgroundColor: experience === 'demo' ? 'var(--color-surface-container-high)' : 'var(--color-surface)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 'var(--space-4)',
                  }}
                >
                  <div
                    style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '10px',
                      backgroundColor: toneContainer.info,
                      color: toneOnContainer.info,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <Icon name="explore" size={22} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '15px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
                      Jelajahi Demo Factory (Eksplorasi Langsung)
                    </div>
                    <p style={{ margin: `var(--space-1) 0 0`, fontSize: '12.5px', color: 'var(--color-on-surface-variant)', lineHeight: 1.5 }}>
                      Melihat langsung bagaimana MES bekerja dengan riwayat produksi, grafik OEE hidup, dan Work Order aktif yang sudah berjalan di lantai produksi.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: TEMPLATE REVIEW & APPLY */}
          {step === 4 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <p style={{ margin: 0, fontSize: '13.5px', color: 'var(--color-on-surface-variant)', lineHeight: 1.6 }}>
                Periksa rincian starter kit yang akan di-clone ke tenant pabrik Anda (
                <strong>{factoryName}</strong>):
              </p>

              {currentTemplate && (
                <SurfaceCard padding="lg" railTone="primary">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
                    <div
                      style={{
                        width: '38px',
                        height: '38px',
                        borderRadius: '10px',
                        backgroundColor: 'var(--color-primary)',
                        color: 'var(--color-on-primary)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Icon name={currentTemplate.icon} size={22} />
                    </div>
                    <div>
                      <div style={{ fontSize: '16px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
                        {currentTemplate.name}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
                        Template Versi {currentTemplate.version} · Status Aktif
                      </div>
                    </div>
                  </div>

                  {/* Checklist of what will be generated */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 'var(--space-3)', margin: `var(--space-3) 0` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: '13px' }}>
                      <Icon name="check_circle" size={16} style={{ color: toneColor.success }} />
                      <span>{currentTemplate.productsCount} Produk Jadi & UoM</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: '13px' }}>
                      <Icon name="check_circle" size={16} style={{ color: toneColor.success }} />
                      <span>{currentTemplate.machinesCount} Mesin & Parameter Siklus</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: '13px' }}>
                      <Icon name="check_circle" size={16} style={{ color: toneColor.success }} />
                      <span>{currentTemplate.workCentersCount} Work Center Terintegrasi</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: '13px' }}>
                      <Icon name="check_circle" size={16} style={{ color: toneColor.success }} />
                      <span>{currentTemplate.processesCount} Routing & Proses Produksi</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: '13px' }}>
                      <Icon name="check_circle" size={16} style={{ color: toneColor.success }} />
                      <span>Kalender Shift Operasional</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: '13px' }}>
                      <Icon name="check_circle" size={16} style={{ color: toneColor.success }} />
                      <span>Katalog Alasan Downtime & Defect</span>
                    </div>
                  </div>

                  <div
                    style={{
                      padding: 'var(--space-3)',
                      borderRadius: '8px',
                      backgroundColor: 'var(--color-surface-container)',
                      fontSize: '12px',
                      color: 'var(--color-on-surface-variant)',
                      lineHeight: 1.5,
                    }}
                  >
                    <strong>Aturan Isolasi Data:</strong> Data di-clone menjadi milik eksklusif pabrik Anda. Seluruh item dapat diubah atau dihapus sesuai kebutuhan operasional Anda yang sebenarnya.
                  </div>
                </SurfaceCard>
              )}
            </div>
          )}

          {/* STEP 5: SUCCESS / COMPLETED */}
          {step === 5 && (
            <div style={{ textAlign: 'center', padding: `var(--space-6) 0` }}>
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
                <Icon name="verified" size={36} />
              </div>

              <h3 style={{ margin: `0 0 var(--space-2)`, fontSize: '22px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
                Pabrik Anda Telah Siap!
              </h3>

              <p style={{ margin: `0 auto var(--space-6)`, maxWidth: '520px', fontSize: '13.5px', color: 'var(--color-on-surface-variant)', lineHeight: 1.6 }}>
                Master data starter telah berhasil dibuat di workspace Anda. Tingkat kesiapan pabrik Anda kini mencapai <strong>70%</strong>. Sekarang Anda dapat melihat tur sistem atau langsung menjalankan pesanan produksi pertama.
              </p>

              <div style={{ display: 'flex', justifyContent: 'center', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
                <Button
                  variant="outlined"
                  size="lg"
                  icon={<Icon name="tour" size={18} />}
                  onClick={handleStartTour}
                  style={{ minWidth: '180px' }}
                >
                  Mulai Welcome Tour
                </Button>

                <Button
                  variant="filled"
                  size="lg"
                  icon={<Icon name="play_arrow" size={18} />}
                  onClick={handleStartFirstWorkflow}
                  style={{ minWidth: '220px' }}
                >
                  Jalankan Alur Produksi Pertama
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer Controls */}
        {step < 5 && (
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
            <Button
              variant="text"
              disabled={step === 1 || applying}
              onClick={() => setStep(step - 1)}
              icon={<Icon name="arrow_back" size={16} />}
            >
              Kembali
            </Button>

            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              {step < 4 ? (
                <Button
                  variant="filled"
                  onClick={() => setStep(step + 1)}
                  icon={<Icon name="arrow_forward" size={16} />}
                >
                  Lanjut
                </Button>
              ) : (
                <Button
                  variant="filled"
                  disabled={applying}
                  onClick={handleApply}
                  icon={<Icon name="bolt" size={16} />}
                >
                  {applying ? 'Mengkloning Data Starter…' : 'Terapkan & Selesaikan Setup'}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
