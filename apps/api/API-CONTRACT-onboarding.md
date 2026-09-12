# API Contract — Pendaftaran Trial & Onboarding

Kontrak HTTP untuk alur *self-serve trial*: dari formulir "Coba Gratis" di landing
page sampai onboarding pabrik pertama di console. Dokumen ini adalah sumber
kebenaran untuk **bentuk permintaan dan respons**; implementasinya ada di
`apps/api/src/routes/onboarding.routes.ts`, tipenya di
`packages/domain-types/src/onboarding.ts`, dan bentuk permintaan trial dikunci
oleh `apps/api/test/trial-signup-contract.test.ts`.

Setiap perubahan bentuk (field baru, field diganti nama, kode error baru) wajib
mengubah ketiganya **dan** dokumen ini dalam satu commit.

---

## 1. Konvensi umum

### 1.1 Alamat

| Konteks | Base URL |
|---|---|
| Produksi, lintas host | `https://api.factoryvision.id` |
| Dari landing / console / operator (same-origin) | `/api/v1/…` — nginx di tiap image web mem-proxy `/api/` ke service `api`, sehingga tidak perlu CORS |
| Pengembangan lokal | `http://localhost:4000` (Vite dev server juga mem-proxy `/api`) |

Semua endpoint di dokumen ini berada di bawah prefix `/api/v1`.

### 1.2 Autentikasi

- Endpoint **publik** (§2) tidak memerlukan header apa pun.
- Endpoint **terautentikasi** (§3) memerlukan `Authorization: Bearer <token>`.
  Token diperoleh dari `POST /auth/login` atau — untuk akun trial baru — dari
  respons `POST /auth/trial-register`.
- Tenant selalu diturunkan dari sesi. Header `X-Tenant-Id` **diabaikan** untuk
  akun tenant; jangan mengandalkannya.

### 1.3 Amplop error

Semua kegagalan, termasuk 404 untuk rute yang tidak ada, memakai satu bentuk:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Lengkapi semua kolom formulir trial.",
    "fields": [{ "field": "factoryName", "code": "REQUIRED", "message": "factoryName wajib diisi." }],
    "requestId": "1c716678-59eb-4db1-bb64-8365bfbaa891"
  }
}
```

- `message` sudah dalam Bahasa Indonesia dan **aman ditampilkan langsung** ke
  pengguna. Klien tidak perlu menerjemahkan.
- `fields` hanya ada pada `VALIDATION_ERROR`, dan memuat **semua** field yang
  gagal sekaligus, bukan hanya yang pertama.
- `requestId` juga dikirim sebagai header `X-Request-Id`. Sertakan saat melapor
  bug; nilainya cocok dengan baris log server dan entri audit.

| `code` | HTTP | Arti |
|---|---|---|
| `VALIDATION_ERROR` | 422 | Bentuk atau nilai permintaan salah; lihat `fields` |
| `UNAUTHENTICATED` | 401 | Tidak ada sesi, atau sesi kedaluwarsa |
| `FORBIDDEN` | 403 | Sesi valid tetapi peran tidak punya izin |
| `OUT_OF_SCOPE` | 403 | Data di luar cakupan tenant/plant pemanggil (dicatat sebagai insiden keamanan) |
| `NOT_FOUND` | 404 | Rute atau data tidak ada — termasuk **memanggil endpoint POST dengan GET** |
| `CONFLICT` | 409 | Bertabrakan dengan data yang sudah ada |
| `INVALID_STATE` | 409 | Aksi tidak sah pada status saat ini |
| `RATE_LIMITED` | 429 | Terlalu sering; header `Retry-After` (detik) selalu disertakan |
| `INTERNAL_ERROR` | 500 | Kesalahan server; laporkan `requestId` |

Kode field pada `VALIDATION_ERROR`: `REQUIRED`, `INVALID_TYPE`, `TOO_SHORT`,
`TOO_LONG`, `INVALID_FORMAT`, `OUT_OF_RANGE`, `UNKNOWN_REFERENCE`.

### 1.4 Aturan untuk klien

1. Kirim `Content-Type: application/json`. Body selain JSON tidak dibaca.
2. Bangun payload dari tipe di `@factory-vision/domain-types`, bukan dari
   `state` formulir mentah — lihat §2.4 untuk kasus yang pernah terjadi.
3. Baca pesan error dari `body.error.message`, **bukan** `body.message`.
4. Jangan mengulang otomatis pada 4xx. Pada 429, hormati `Retry-After`.

---

## 2. `POST /auth/trial-register` — pendaftaran trial (publik)

Membuat tenant baru berstatus `TRIAL`, akun klien, langganan `plan-trial` 14
hari, dan satu pengguna `ADMIN`; lalu langsung membuka sesi untuk pengguna itu.
Satu panggilan, tidak ada langkah verifikasi email.

- **Auth:** tidak ada (terdaftar di `PUBLIC_API_PATHS`).
- **Metode:** hanya `POST`. `GET` pada path ini adalah `404 NOT_FOUND` dengan
  pesan `Endpoint GET /auth/trial-register tidak dikenal.` — itu bukan tanda
  endpoint hilang, melainkan tanda kliennya salah metode (atau URL dibuka
  langsung di browser).

### 2.1 Permintaan — `TrialRegistrationPayload`

| Field | Tipe | Wajib | Aturan | Catatan |
|---|---|---|---|---|
| `fullName` | string | ya | min 2 karakter | Nama kontak; menjadi `contact_name` dan nama pengguna admin |
| `email` | string | ya | format email valid | Dinormalisasi ke huruf kecil; menjadi login pengguna |
| `password` | string | ya | **min 12 karakter**, tidak boleh hanya spasi | Kebijakan yang sama dengan seluruh produk (§4.1 Cyber Security Requirement) |
| `factoryName` | string | ya | min 2 karakter | Nama perusahaan/pabrik. Menjadi nama tenant, `legal_name` dan `display_name` akun klien, serta basis slug `tenantId` |
| `industry` | `IndustryType` | ya | salah satu nilai di bawah | Menentukan template seed yang ditawarkan saat onboarding |
| `city` | string | tidak | — | Default `Jakarta` |
| `plantScale` | string | tidak | maks 64 karakter | Petunjuk ukuran dari formulir, mis. `"4-10 Lini Produksi"`. Disimpan di `client_account.notes` untuk tim sales; **tidak** memengaruhi konfigurasi produk |

`IndustryType`: `automotive` · `electronics` · `fnb` · `packaging` ·
`metal-fabrication` · `furniture` · `pharmaceutical` · `chemical` · `general`.

Field di luar daftar ini diabaikan tanpa error. Karena itu **field yang salah
nama tidak terdeteksi sebagai "tidak dikenal"** — ia terdeteksi sebagai field
wajib yang hilang (`REQUIRED`).

Contoh:

```json
{
  "fullName": "Rina Kusuma",
  "email": "rina@majupresisi.example",
  "password": "RahasiaKuat2026",
  "factoryName": "PT Maju Presisi Nusantara",
  "industry": "automotive",
  "plantScale": "4-10 Lini Produksi"
}
```

### 2.2 Respons `201 Created` — `TrialRegistrationResponse`

```json
{
  "token": "…",
  "tenantId": "tenant-pt-maju-presisi-3f9a1c",
  "userId": "usr-8b2e41d0",
  "email": "rina@majupresisi.example",
  "fullName": "Rina Kusuma",
  "factoryName": "PT Maju Presisi Nusantara",
  "industry": "automotive",
  "trialStart": "2026-09-12T03:15:20.000Z",
  "trialEnd": "2026-09-26T03:15:20.000Z",
  "daysRemaining": 14
}
```

`token` adalah token sesi biasa — sama seperti hasil `POST /auth/login` — dan
langsung bisa dipakai sebagai `Bearer` untuk endpoint §3.

### 2.3 Kegagalan

| HTTP | `code` | Kapan |
|---|---|---|
| 422 | `VALIDATION_ERROR` | Field wajib hilang/salah bentuk. `message`: `Lengkapi semua kolom formulir trial.`; rincian di `fields` |
| 422 | `VALIDATION_ERROR` | Kata sandi di bawah kebijakan. `message`: `Kata sandi minimal 12 karakter.`, `fields[0].field = "password"` |
| 429 | `RATE_LIMITED` | Lihat §2.5 |
| 404 | `NOT_FOUND` | Metode selain `POST` |

### 2.4 Pemetaan dari formulir landing

Formulir di `apps/landing/src/components/TrialSignupModal.tsx` menyimpan
`companyName` di state-nya untuk label UI "Nama Perusahaan / Pabrik", tetapi
**mengirim** `factoryName`. Pemetaan itu eksplisit dan diketik sebagai
`TrialRegistrationPayload`, sehingga jika salah satu sisi mengganti nama field,
`tsc` gagal — bukan pendaftaran di produksi.

Riwayat: sebelum 2026-09-12 formulir mengirim `companyName` apa adanya. Setiap
pendaftaran gagal 422, dan karena modal membaca `data.message` (bukan
`data.error.message`) pengguna hanya melihat pesan generik. Tes
`trial-signup-contract.test.ts` memastikan bentuk lama itu tetap ditolak dengan
`fields: [{ field: "factoryName", code: "REQUIRED" }]`.

### 2.5 Batas laju

Dua pembatas ditumpuk pada path ini, keduanya berjendela **1 jam**:

| Kunci | Batas | Pesan |
|---|---|---|
| `email` + IP sumber | 5 | `Terlalu banyak pendaftaran untuk email ini. Coba lagi nanti.` |
| IP sumber saja | 30 | `Terlalu banyak pendaftaran dari alamat ini. Coba lagi nanti.` |

Yang pertama menahan pengulangan pada satu alamat; yang kedua menahan skrip yang
menyebar banyak email dari satu sumber, tanpa mengunci satu kantor di balik NAT
setelah beberapa rekan mencoba. Setiap penolakan tercatat sebagai
`RATE_LIMIT_HIT` di log keamanan.

### 2.6 Alur setelah berhasil (landing → console)

1. Landing menerima `201` dan menyimpan `token`.
2. Landing mengarahkan browser ke
   `<console>/?token=<token>&trial=1`.
   - `<console>` = `VITE_CONSOLE_URL` bila di-set saat build; jika tidak,
     `https://dashboard.<apex>` (di produksi: `https://dashboard.factoryvision.id`);
     `http://localhost:3100` di pengembangan. Lihat `apps/landing/src/console-url.ts`.
3. Console (`SessionContext`) membaca `token`, menyimpannya, lalu **menghapusnya
   dari address bar** dengan `history.replaceState`.
4. `trial=1` membuat `OnboardingContext` langsung membuka panduan onboarding.

### 2.7 Contoh `curl`

```bash
curl -i -X POST https://api.factoryvision.id/api/v1/auth/trial-register \
  -H 'Content-Type: application/json' \
  -d '{"fullName":"Rina Kusuma","email":"rina@majupresisi.example",
       "password":"RahasiaKuat2026","factoryName":"PT Maju Presisi Nusantara",
       "industry":"automotive","plantScale":"4-10 Lini Produksi"}'
```

Pemeriksaan pasca-deploy (`deploy/verify-deployment.sh`) mengirim body kosong
`{}` ke endpoint ini dan **mengharapkan 422** — bukti rute terpasang dan
validatornya hidup tanpa membuat tenant.

---

## 3. Endpoint onboarding (terautentikasi)

Semua memerlukan `Bearer` token. Tenant diambil dari sesi. Izin mengikuti
`platform/auth/route-permissions.ts`.

| Metode & path | Izin | Body | Respons |
|---|---|---|---|
| `GET /onboarding/templates` | `master_data:manage` | — | `IndustryTemplateInfo[]` |
| `POST /onboarding/apply-template` | `master_data:manage` | `{ industry, factoryName?, city?, timezone? }` | `{ success, progress: OnboardingProgress }` |
| `POST /onboarding/create-blank` | `master_data:manage` | `{ factoryName, industry?, country?, city?, timezone?, workingCalendar? }` | `{ success, progress }` |
| `GET /onboarding/status` | `master_data:manage` | — | `OnboardingProgress` |
| `PUT /onboarding/step` | `dashboard:view` | `{ stepId: OnboardingStepId, status: OnboardingStepStatus }` | `OnboardingProgress` |
| `GET /onboarding/guidance` | `master_data:manage` | — | `GuidanceState` |
| `PUT /onboarding/guidance` | `dashboard:view` | `Partial<GuidanceState>` | `GuidanceState` |
| `POST /onboarding/first-workflow` | `master_data:manage` | `{ productId?, quantity?, goodQty?, rejectQty? }` | `FirstWorkflowResult` |
| `POST /onboarding/events` | `dashboard:view` | `{ eventName: OnboardingAnalyticsEvent['eventName'], metadata? }` | `{ success: true }` |
| `POST /onboarding/upgrade` | `configuration:manage` | `{ planCode?: string }` (default `GROWTH`) | `{ success, message }` |

Catatan per endpoint:

- **`apply-template`** meng-clone master data starter (produk, mesin, work
  center, proses, routing) untuk industri yang dipilih. **Tidak idempoten:**
  setiap panggilan membuat plant baru dengan id acak beserta master datanya.
  Panggil sekali per tenant; klien wajib menonaktifkan tombol selama menunggu.
- **`create-blank`** adalah alternatif tanpa seed; `factoryName` wajib, min 2
  karakter.
- **`step`** — `stepId` salah satu dari `factory_profile`, `industry_selection`,
  `template_application`, `starter_master_data`, `welcome_tour`,
  `first_production_order`, `first_work_order`, `first_production_run`,
  `first_production_result`; `status` salah satu dari `not_started`,
  `in_progress`, `completed`, `skipped`.
- **`first-workflow`** menjalankan PO → WO → hasil produksi → KPI dalam satu
  panggilan dan menandai empat langkah terakhir `completed`. Gagal `422` bila
  tenant belum punya produk (`Belum ada produk terdaftar…`).
- **`events`** — *deviasi yang diketahui:* `eventName` kosong dijawab
  `400 { "error": "eventName wajib diisi." }`, bukan amplop §1.3. Klien yang
  membaca `error.message` akan mendapat `undefined` pada kasus ini.

Bentuk `OnboardingProgress`, `GuidanceState`, `IndustryTemplateInfo`, dan
`FirstWorkflowResult` didefinisikan lengkap di
`packages/domain-types/src/onboarding.ts` dan tidak diduplikasi di sini.

---

## 4. Status onboarding & masa trial

- `trialStatus`: `active` → `converted` (setelah `POST /onboarding/upgrade`).
  Nilai `expired` ada di tipe tetapi **belum pernah di-set oleh server**: lewat
  `trialEnd`, `daysRemaining` menjadi `0` sementara `trialStatus` tetap
  `active`. Klien yang perlu menampilkan "trial berakhir" harus memakai
  `daysRemaining === 0`, bukan `trialStatus`.
- `daysRemaining` dihitung server dari `trialEnd` pada setiap `GET /onboarding/status`;
  jangan dihitung ulang di klien.
- `readinessPercent` mengukur kesiapan master data; `activationPercent`
  mengukur langkah onboarding yang selesai. Keduanya 0–100.

---

## 5. Riwayat perubahan kontrak

| Tanggal | Perubahan |
|---|---|
| 2026-09-12 | `plantScale` (opsional, maks 64) ditambahkan ke `TrialRegistrationPayload`. Batas laju `trial-register` diubah dari 5/jam/IP menjadi 5/jam/(email+IP) dan 30/jam/IP. Dokumen ini dibuat. |
| 2026-09-06 | Endpoint `trial-register` dan modul onboarding dirilis (commit `939c7ff`). Kebijakan sandi disamakan dengan produk (min 12). |
