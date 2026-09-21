# Runbook Deploy & Akses — Factory Vision MES

Urutan perintah yang benar-benar dipakai untuk menaikkan stack dari nol sampai
seluruh service sehat. `DEPLOYMENT.md` menjelaskan *kenapa* setiap komponen ada;
dokumen ini adalah *apa yang diketik*, berurutan.

Semua perintah dijalankan dari root repository. Windows memakai Git Bash;
di Linux perintahnya identik.

---

## 0. Prasyarat

| Kebutuhan | Versi |
|---|---|
| Docker Engine + Compose v2 | `docker compose version` ≥ 2.20 |
| Node + pnpm, Go 1.26 | hanya untuk `pnpm typecheck` / test di workstation, tidak untuk runtime |
| RAM | 4 GB minimum untuk stack penuh |

Stack membangun image dari source, jadi checkout harus lengkap — bukan hanya
folder `deploy/`.

---

## 1. Siapkan `deploy/.env`

File ini **git-ignored** dan harus dibuat sekali per host.

```bash
cp deploy/.env.example deploy/.env
```

Enam variabel di bawah **wajib** — compose menolak start tanpa mereka:

```dotenv
POSTGRES_PASSWORD=<password superuser postgres>
APP_DB_PASSWORD=<password role factory_app>
BOOTSTRAP_ADMIN_EMAIL=admin@factoryvision.local
BOOTSTRAP_ADMIN_PASSWORD=<minimal 12 karakter>
OBJECT_STORAGE_ACCESS_KEY=<kunci object storage>
OBJECT_STORAGE_SECRET_KEY=<rahasia object storage>
```

Opsional, tapi biasanya diisi untuk instalasi on-premise:

```dotenv
DEPLOYMENT_MODE=ON_PREMISE_SINGLE_TENANT
DEFAULT_TENANT_ID=tenant-pilot-factory-01
AUTH_REQUIRED=true           # ditolak bila false saat NODE_ENV=production
SEED_DEMO_DATA=true          # matikan untuk instalasi pabrik sungguhan
MFA_ENCRYPTION_KEY=<32+ karakter acak>   # tanpa ini MFA tidak bisa diaktifkan
CORS_ALLOWED_ORIGINS=        # kosong = same-origin saja
SECURITY_ALERT_WEBHOOK=      # kosong = alert hanya ke log
BACKUP_PASSPHRASE=<passphrase backup>    # wajib bila backup keluar dari pabrik
BOOTSTRAP_ADMIN_NAME=Administrator
TZ=Asia/Jakarta
```

> `BOOTSTRAP_ADMIN_PASSWORD` yang lebih pendek dari 12 karakter **ditolak diam-diam** —
> API log akan berkata `Refusing to use it` dan tidak ada akun yang bisa masuk.

> Hindari karakter `$` di dalam nilai `.env`. Compose menginterpolasinya sebagai
> variabel dan password yang sampai ke container tidak sama dengan yang Anda tulis.

---

## 2. Build image

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env build
```

Sekitar 3–6 menit pada build pertama. Build ulang setelah perubahan source hanya
perlu service yang terpengaruh:

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env build api worker
```

---

## 3. Nyalakan database lebih dulu

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d db
```

Tunggu sampai `healthy`:

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env ps --format "table {{.Service}}\t{{.Status}}"
```

---

## 4. Jalankan migrasi — langkah yang paling sering terlewat

Service `migrate` berada di **profile terpisah**, jadi `docker compose up -d`
biasa **tidak akan menjalankannya**. Migrasi harus dipanggil eksplisit:

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env \
  --profile migrate run --rm migrate
```

Keluaran yang benar diakhiri dengan:

```
[migrate] factory_app can now log in (NOSUPERUSER, NOBYPASSRLS).
[migrate] seed: 001_initial_seed.sql
[migrate] 21 migration file(s) applied.
```

Langkah ini melakukan tiga hal sekaligus:

1. menerapkan `db/migrations`,
2. **memberi password kepada role `factory_app`** dari `APP_DB_PASSWORD`,
3. menerapkan `db/seeds` bila `SEED_DEMO_DATA=true`.

Tanpa langkah 2, API akan gagal login ke database dengan `28P01` dan masuk
crash loop. Migrasi bersifat idempoten — aman dijalankan ulang.

---

## 5. Nyalakan sisa stack

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d
```

Tunggu sampai tidak ada lagi `health: starting`:

```bash
until [ "$(docker compose -f deploy/docker-compose.yml --env-file deploy/.env ps \
  --format '{{.Status}}' | grep -c 'health: starting')" = "0" ]; do sleep 5; done
docker compose -f deploy/docker-compose.yml --env-file deploy/.env ps --format "table {{.Service}}\t{{.Status}}"
```

Kondisi sehat:

```
SERVICE    STATUS
admin      Up (healthy)
api        Up (healthy)
console    Up (healthy)
db         Up (healthy)
operator   Up (healthy)
worker     Up (healthy)
```

---

## 6. Verifikasi

Container hijau belum tentu berarti datanya benar. Tiga pemeriksaan berikut yang
menentukan.

**a. API menjawab**

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec -T api /fv probe /health
# → 200   (image distroless: tidak ada shell/curl; `fv probe` mencetak kode status dari dalam container)
```

**b. Data terisi**

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec -T db \
  psql -U factory -d factory_vision -c \
  "SELECT (SELECT count(*) FROM work_order) wo,
          (SELECT count(*) FROM production_batch) batch,
          (SELECT count(*) FROM production_record) rec,
          (SELECT count(*) FROM app_user) usr;"
```

**c. Execution Path Exclusivity utuh (ADR-35)**

Setiap production record harus memiliki mode eksekusi yang sama persis dengan
work order pemiliknya, dan record batch-managed wajib membawa `batch_id`:

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec -T db \
  psql -U factory -d factory_vision \
  -c "SELECT is_batch_managed, count(*), count(batch_id) AS with_batch
        FROM production_record GROUP BY 1;" \
  -c "SELECT count(*) AS pelanggaran
        FROM production_record pr JOIN work_order wo ON wo.id = pr.work_order_id
       WHERE pr.is_batch_managed <> wo.is_batch_managed;"
```

`pelanggaran` harus `0`, dan baris `t` harus punya `with_batch` sama dengan `count`.

**d. Login administrator**

```bash
curl -s -X POST http://127.0.0.1:3100/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  --data-binary '{"email":"admin@factoryvision.local","password":"<BOOTSTRAP_ADMIN_PASSWORD>"}'
# → {"token":"…","principal":{…,"role":"ADMIN"},…}
```

---

## 7. Akses

| Aplikasi | URL default | Binding | Untuk siapa |
|---|---|---|---|
| Console (supervisor / manajer) | `http://127.0.0.1:3100` | `0.0.0.0` | jaringan pabrik |
| Operator terminal | `http://127.0.0.1:3200` | `0.0.0.0` | tablet shop floor |
| Admin console | `http://127.0.0.1:3300` | `127.0.0.1` saja | administrator di host |
| API | tidak dipublikasikan | internal | diakses via `/api/` pada console/operator |

Port dapat diubah lewat `CONSOLE_PORT`, `OPERATOR_PORT`, `ADMIN_PORT`, dan
binding lewat `WEB_BIND` / `ADMIN_BIND`.

Kredensial awal:

- **Administrator** — `BOOTSTRAP_ADMIN_EMAIL` + `BOOTSTRAP_ADMIN_PASSWORD`.
  Password ditulis ulang setiap boot, jadi mengubah `.env` lalu restart API
  adalah cara reset yang sah.
- **Operator** — masuk di terminal dengan **email + kata sandi** miliknya sendiri,
  yang disetel administrator di Settings → Operator (email lewat Edit, kata
  sandi lewat tombol "Kata sandi"). Tidak ada kredensial operator bawaan pada
  instalasi pabrik sungguhan.

- **Akun demo** (`SEED_DEMO_DATA=true`, `db/seeds/003_demo_accounts.sql`) — satu
  akun per role dengan kata sandi yang dipublikasikan, khusus untuk demo:

  | Email | Role | Kata sandi |
  |---|---|---|
  | `admin@factoryvision.id` | ADMIN | `Admin#FV2026!` |
  | `executive@factoryvision.id` | EXECUTIVE | `Executive#FV2026` |
  | `manager@factoryvision.id` | PRODUCTION_MANAGER | `Manager#FV2026` |
  | `supervisor@factoryvision.id` | SUPERVISOR | `Supervisor#FV2026` |
  | `ppic@factoryvision.id` | PPIC | `PPIC#FV2026!` |
  | `quality@factoryvision.id` | QUALITY | `Quality#FV2026` |
  | `maintenance@factoryvision.id` | MAINTENANCE | `Maintenance#FV2026` |
  | `warehouse@factoryvision.id` | WAREHOUSE | `Warehouse#FV2026` |
  | `workforce@factoryvision.id` | WORKFORCE_ADMIN | `Workforce#FV2026` |
  | `sales@factoryvision.id` | SALES | `Sales#FV2026!` |

  Operator pada seed demo (login terminal):

  | Nomor karyawan | Nama | Email | Kata sandi | Line default |
  |---|---|---|---|---|
  | `OP-1001` | Budi Santoso | `budi.santoso@factoryvision.id` | `Operator#FV2026` | `line-01` |
  | `OP-1002` | Siti Rahmawati | `siti.rahmawati@factoryvision.id` | `Operator#FV2026` | `line-01` |
  | `OP-1003` | Agus Prasetyo | `agus.prasetyo@factoryvision.id` | `Operator#FV2026` | `line-02` |

  Uji dari host:

  ```bash
  curl -s -X POST http://127.0.0.1:3200/api/v1/auth/operator-login \
    -H 'Content-Type: application/json' \
    --data-binary '{"email":"budi.santoso@factoryvision.id","password":"Operator#FV2026"}'
  # → {"token":"…","principal":{…,"kind":"OPERATOR"},…}
  ```

> **Windows:** gunakan `127.0.0.1`, bukan `localhost`. `localhost` bisa resolve ke
> `::1` lebih dulu, dan jika ada dev server (`pnpm dev:console`) yang masih hidup
> di `::1:3100`, permintaan Anda mengenai dev server itu — bukan container.
> Periksa dengan:
> ```powershell
> Get-NetTCPConnection -LocalPort 3100 -State Listen
> ```

### Kode referral untuk uji coba gratis

Formulir *Coba Gratis* di landing page **menolak pendaftaran tanpa kode
referral** (migrasi 037). Kode dibuat dari Admin console → **Kode Referral**
oleh peran OWNER atau ACCOUNT_MANAGER: isi untuk siapa kode itu, berapa kali
boleh dipakai (bawaan 1), dan masa berlakunya (bawaan 30 hari). Bentuknya
`FV-XXXX-XXXX`; huruf besar-kecil dan tanda hubung tidak berpengaruh saat
diketik. Kode yang dicabut atau habis tetap tercantum, dan akun klien yang
masuk lewat kode itu menyimpannya di kolom `referral_code`. Lewat API:

```bash
curl -s -X POST http://127.0.0.1:3300/api/internal/v1/referral-codes   -H "Authorization: Bearer <token internal>" -H 'Content-Type: application/json'   -d '{"label":"PT Contoh — demo 24 Sep","maxUses":1,"expiryDays":30}'
```

### CMS: Google Analytics, Search Console, dan artikel

Admin console → **Pengaturan Situs** menyimpan Measurement ID GA4, token
verifikasi Google Search Console (meta tag dan/atau nama file
`googleXXXX.html`), serta nama, URL, dan deskripsi situs (migrasi 038). Landing
page membaca `/site/config.json` saat dimuat dan baru memasang tag GA bila ada
ID-nya; tidak ada rilis ulang. **Artikel** ditulis dalam Markdown, disimpan
sebagai draf, lalu diterbitkan; API merender halamannya sebagai HTML di
`/blog/<slug>` dan mencantumkannya di `/sitemap.xml` (`/robots.txt` menunjuk ke
sana). Image landing memakai `deploy/nginx.landing.conf`, yang mem-proxy
`/blog`, `/site/`, `/sitemap.xml`, `/robots.txt`, dan `/google*.html` ke API,
dengan CSP yang mengizinkan googletagmanager.com dan google-analytics.com.
Setelah verifikasi Search Console berhasil, kirim `https://<domain>/sitemap.xml`
dari halaman Sitemaps.

---

## 8. TLS dan domain publik (opsional)

Traefik ada di profile `proxy`, jadi juga harus dipanggil eksplisit:

```dotenv
# deploy/.env
ACME_EMAIL=ops@contoh.co.id
LANDING_DOMAIN=contoh.co.id
LANDING_WWW_DOMAIN=www.contoh.co.id
DASHBOARD_DOMAIN=dashboard.contoh.co.id
OPERATOR_DOMAIN=operator.contoh.co.id
API_DOMAIN=api.contoh.co.id
ADMIN_DOMAIN=admin.contoh.co.id
```

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env \
  --profile proxy up -d
```

Port 80 dan 443 harus terbuka dan DNS sudah mengarah ke host sebelum Let's
Encrypt bisa menerbitkan sertifikat. Admin console tetap tidak dipublikasikan
kecuali `ADMIN_PUBLIC=true` diset sadar-sadar.

### Pastikan router benar-benar membawa domain Anda

Setiap `*_DOMAIN` yang tidak diset **jatuh diam-diam** ke `*.localhost`. Stack
tetap naik sehat dan setiap health check hijau — ia hanya tidak menjawab domain
Anda, dan gejalanya adalah `curl` yang mengembalikan `000`, bukan pesan error.
Periksa apa yang benar-benar tertanam di container, bukan apa yang tertulis di
`.env`:

```bash
for c in landing console operator; do
  echo "--- $c"
  docker inspect factory-vision-$c-1 --format '{{json .Config.Labels}}' | tr ',' '\n' | grep 'routers.*rule'
done
```

Tidak boleh ada satu pun `localhost` di keluarannya.

Label ditanamkan **saat container dibuat**, jadi mengubah `.env` saja tidak
cukup: container yang sudah berjalan tetap membawa nilai lamanya sampai dibuat
ulang.

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env --profile proxy up -d --force-recreate landing
```

---

## 9. Operasi rutin

```bash
# Log satu service, mengikuti
docker compose -f deploy/docker-compose.yml --env-file deploy/.env logs -f api

# Restart satu service
docker compose -f deploy/docker-compose.yml --env-file deploy/.env restart api

# Deploy versi baru
git pull
docker compose -f deploy/docker-compose.yml --env-file deploy/.env build
docker compose -f deploy/docker-compose.yml --env-file deploy/.env --profile migrate run --rm migrate
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d

# Backup manual di luar jadwal (backup harian berjalan sendiri, lihat §9a)
docker compose -f deploy/docker-compose.yml --env-file deploy/.env run --rm backup /bin/sh /backup.sh

# Hentikan stack (data tetap, ada di volume)
docker compose -f deploy/docker-compose.yml --env-file deploy/.env down
```

> `down -v` **menghapus volume database**. Jangan pakai pada host produksi.

---

## 9a. Backup dan restore

Service `backup` berjalan otomatis bersama stack: setiap `BACKUP_INTERVAL_SECONDS`
(default harian) ia menulis dump database dan arsip lampiran ke volume
`backup-data`, lalu menghapus berkas yang lebih tua dari `BACKUP_RETENTION_DAYS`.

```bash
# Apa yang sudah tersimpan
docker compose -f deploy/docker-compose.yml --env-file deploy/.env run --rm backup ls -lh /backup/db

# Salin ke host, lalu teruskan ke penyimpanan offsite
docker compose -f deploy/docker-compose.yml --env-file deploy/.env cp backup:/backup ./backup-copy
```

Isi `BACKUP_PASSPHRASE` di `deploy/.env` untuk backup yang meninggalkan pabrik.
Tanpa itu dump ditulis apa adanya, dan skrip mencatat peringatan setiap kali.
Simpan passphrase di tempat lain: kunci yang disimpan bersama data yang
dilindunginya tidak melindungi apa pun.

**Restore.** Uji ini minimal tiap kuartal — backup yang belum pernah direstore
adalah harapan, bukan kontrol.

```bash
# 1. Dekripsi bila terenkripsi
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
  -pass env:BACKUP_PASSPHRASE \
  -in factory-vision-<stamp>.sql.gz.enc -out factory-vision-<stamp>.sql.gz

# 2. Hentikan penulis sebelum memuat ulang
docker compose -f deploy/docker-compose.yml --env-file deploy/.env stop api worker

# 3. Muat ulang
gunzip -c factory-vision-<stamp>.sql.gz | \
  docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec -T db \
  psql -U factory -d factory_vision

# 4. Nyalakan kembali
docker compose -f deploy/docker-compose.yml --env-file deploy/.env start api worker
```

Verifikasi setelah restore: login berhasil, work order hari terakhir muncul,
audit log terisi sampai waktu backup, dan satu alur produksi dapat diselesaikan
dari mulai sampai selesai.

---

## 9b. Rotasi secret

Setiap secret punya pemilik, tempat, dan jadwal (§34). Rotasi yang belum pernah
dicoba akan dicoba pertama kali saat insiden — waktu terburuk untuk mencoba.

| Secret | Jadwal | Dampak saat dirotasi |
|---|---|---|
| `APP_DB_PASSWORD` | 12 bulan, atau segera saat bocor | API dan worker restart |
| `POSTGRES_PASSWORD` | 12 bulan | Hanya migrate dan backup |
| `BOOTSTRAP_ADMIN_PASSWORD` | Saat personel berganti | Tidak ada; hanya dipakai saat instalasi |
| `INTERNAL_ADMIN_PASSWORD` | Saat personel berganti | Sesi konsol internal berakhir |
| `MFA_ENCRYPTION_KEY` | Hanya saat kompromi | **Semua enrolment MFA hangus, pengguna mendaftar ulang** |
| `BACKUP_PASSPHRASE` | Saat kompromi | Backup lama tetap butuh passphrase lama — simpan keduanya sampai retensi habis |
| `OBJECT_STORAGE_*` | 12 bulan | API restart |
| Sertifikat TLS | Otomatis oleh Traefik | Tidak ada |

Prosedur rotasi password database aplikasi:

```bash
# 1. Ubah APP_DB_PASSWORD di deploy/.env

# 2. Terapkan ke database. Migrate menetapkan password role dari env.
docker compose -f deploy/docker-compose.yml --env-file deploy/.env --profile migrate run --rm migrate

# 3. Restart pemakainya
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d api worker

# 4. Verifikasi
curl -sf http://localhost:3100/api/v1/health && echo OK
```

Setelah personel dengan akses produksi keluar: rotasi `INTERNAL_ADMIN_PASSWORD`,
cabut kunci SSH mereka, cabut sesi mereka di Pengaturan → Sesi, dan periksa
audit log untuk aktivitas terakhir mereka.

---

## 9c. Respons insiden

Alur singkat saat akun diduga disalahgunakan (§64, §66):

```bash
# 1. Cabut sesi akun tersebut (bertahan melewati restart)
#    Konsol: Pengaturan → Sesi → Cabut
#    atau:
curl -X DELETE "http://localhost:3100/api/v1/sessions?subjectId=<userId>"   -H "Authorization: Bearer <token admin>"

# 2. Nonaktifkan akun
curl -X PATCH "http://localhost:3100/api/v1/master/users/<userId>/status"   -H "Authorization: Bearer <token admin>" -H 'Content-Type: application/json'   -d '{"status":"SUSPENDED"}'

# 3. Baca jejaknya
curl "http://localhost:3100/api/v1/audit-logs?entityType=auth"   -H "Authorization: Bearer <token admin>"

# 4. Lihat apa yang tercatat kontrol keamanan sejak proses berjalan
curl "http://localhost:3100/api/v1/security/summary"   -H "Authorization: Bearer <token admin>"
```

Urutan itu disengaja: cabut sesi **sebelum** menonaktifkan akun. Menonaktifkan
lebih dulu tetap menyisakan sesi yang aktif sampai permintaan berikutnya.

Untuk insiden yang menyentuh data pribadi, kewajiban notifikasi ada pada
pelanggan sebagai Pengendali Data Pribadi; Factory Vision sebagai Prosesor
wajib memberi informasi yang cukup dan tepat waktu (lihat bab UU PDP pada
dokumen Cyber Security Requirement).

---

## 9d. Deploy otomatis dari CI

Sejak rilis ini, push ke `master` (langkah terakhir promosi
`branch → staging → production → master`) tidak hanya menerbitkan image:
job `deploy` di `.github/workflows/ci.yml` masuk ke host lewat SSH dan
menjalankan `deploy/deploy.sh` — urutan §9 "Deploy versi baru" sebagai satu
skrip: **dump database → pull → migrate → up → verifikasi**. Berhenti pada
kegagalan pertama, tanpa rollback otomatis; dump pra-deploy ada di
`/var/backups/factory-vision/` (10 terakhir disimpan).

Job ini **tidak melakukan apa pun** sampai empat secret repository diisi
(Settings → Secrets and variables → Actions):

| Secret | Isi |
|---|---|
| `DEPLOY_HOST` | IP atau hostname host produksi |
| `DEPLOY_USER` | user SSH (yang punya `sudo` tanpa password) |
| `DEPLOY_SSH_KEY` | kunci privat **khusus deploy** (lihat di bawah), utuh termasuk baris BEGIN/END |
| `DEPLOY_KNOWN_HOSTS` | keluaran `ssh-keyscan -t ed25519 <host>` — agar host key dipin, bukan dipercaya saat pertama kali |

Variabel opsional `DEPLOY_CHECKOUT` (Settings → Variables) bila checkout di host
bukan `/opt/factory-vision`.

Buat pasangan kunci khusus, jangan pakai kunci login pribadi:

```bash
ssh-keygen -t ed25519 -N "" -C "github-actions deploy" -f deploy-key
# di host, sebagai user SSH:
cat deploy-key.pub >> ~/.ssh/authorized_keys
# isi DEPLOY_SSH_KEY dengan isi file `deploy-key` (privat), lalu hapus kedua file dari laptop
```

Persetujuan manual sebelum deploy: buat *environment* bernama `production`
(Settings → Environments) dan tambahkan *required reviewers*. Job `deploy`
mendeklarasikan environment itu, jadi setiap push ke `master` akan menunggu
persetujuan sebelum menyentuh host.

Menjalankan hal yang sama dengan tangan, dari checkout di host:

```bash
git pull --ff-only origin master && sh deploy/deploy.sh
```

Yang berubah dari kebiasaan lama: push ke `production` tetap hanya menerbitkan
`:latest`; **push ke `master` kini men-deploy**. Cadangkan dulu bila ragu (§9a),
dan jangan promosikan ke `master` sebelum CI di `production` hijau.

---

## 10. Troubleshooting

### API restart terus, log berisi `28P01` / `auth_failed`

Role `factory_app` belum menerima password. Penyebab hampir selalu sama:
langkah 4 tidak dijalankan karena `migrate` ada di profile terpisah.

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env \
  --profile migrate run --rm migrate
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d api
```

API tidak boleh terhubung sebagai `POSTGRES_USER`: superuser membawa `BYPASSRLS`
dan akan melewati seluruh isolasi tenant.

### Log API: `[storage] filesystem /var/lib/factory-vision/documents tidak dapat ditulis`

Volume `document-data` dibuat oleh image lama dengan uid lain; image Go
(distroless) berjalan sebagai uid 65532 tanpa root dan tanpa shell, jadi tidak
bisa memperbaikinya sendiri. Sekali saja:

```bash
docker run --rm -v factory-vision_document-data:/d alpine chown 65532:65532 /d
docker compose -f deploy/docker-compose.yml --env-file deploy/.env restart api
```

Instalasi baru tidak mengalaminya: direktori itu ada di dalam image dengan
pemilik yang benar, dan Docker menyalin kepemilikannya ke volume yang baru.

### `duplicate key … uq_work_order_machine_in_production` saat seeding

Dua work order berstatus `IN_PRODUCTION` menempati mesin yang sama. Satu mesin
hanya boleh menjalankan satu work order sekaligus (migrasi 021). Perbaiki data
seed, bukan constraint-nya.

### `null value in column "production_plan_line_id"`

Sejak Sprint 2 setiap work order wajib menunjuk Production Plan Line. Tidak ada
nilai default yang sah — pemanggil harus menyediakannya.

### `violates foreign key constraint "fk_prod_record_wo_exec_mode"`

Production record mengklaim mode eksekusi yang berbeda dari work order
pemiliknya. Ini Execution Path Exclusivity bekerja sebagaimana mestinya:
record harus mencerminkan `is_batch_managed` dan `has_child_work_order` milik
work order, dan record batch-managed wajib membawa `batch_id`.

### Login 401 padahal password benar

Cek log API untuk baris `[auth] Bootstrap administrator ready: …`. Bila tidak
ada, password kurang dari 12 karakter atau `BOOTSTRAP_ADMIN_EMAIL` kosong.
Bila ada, pastikan Anda memukul container dan bukan dev server — lihat catatan
`127.0.0.1` di bagian 7.

### Operator 401 walau kata sandi benar

Operator hanya bisa masuk bila barisnya punya email **dan** digest kata sandi:

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec -T db \
  psql -U factory -d factory_vision \
  -c "SELECT id, employee_number, email, left(password_hash,7) FROM operator ORDER BY id;"
```

Nilai yang benar diawali `scrypt$`. Bila email kosong atau digest NULL, setel
keduanya dari Settings → Operator; login dicocokkan ke email tanpa membedakan
huruf besar-kecil, dan satu email hanya boleh dipakai satu operator per tenant.

### `migrate` gagal di tahap seed

Migrasi sudah diterapkan; hanya seed yang gagal. Perbaiki seed, build ulang
image API (seed ikut ke dalam image), lalu jalankan ulang `migrate`.

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env build api
docker compose -f deploy/docker-compose.yml --env-file deploy/.env --profile migrate run --rm migrate
```
