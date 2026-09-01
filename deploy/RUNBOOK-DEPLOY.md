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
| Node + pnpm | hanya untuk `pnpm typecheck` / test, tidak untuk runtime |
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
AUTH_REQUIRED=true
SEED_DEMO_DATA=true          # matikan untuk instalasi pabrik sungguhan
BOOTSTRAP_ADMIN_NAME=Administrator
BOOTSTRAP_OPERATOR_PIN=<4–8 digit>   # PIN awal terminal, hanya untuk operator yang belum punya
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
docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec -T api \
  node -e "fetch('http://localhost:4000/health').then(r=>r.text()).then(console.log)"
# → {"status":"ok","time":"…","tenant":"tenant-pilot-factory-01"}
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
- **Operator** — masuk dengan **nomor karyawan + PIN**, bukan email. PIN diambil
  dari `BOOTSTRAP_OPERATOR_PIN` dan hanya diberikan kepada operator yang
  `pin_hash`-nya masih kosong; PIN yang sudah diterbitkan administrator tidak
  akan tertimpa.

  Operator pada seed demo:

  | Nomor karyawan | Nama | Line default |
  |---|---|---|
  | `OP-1001` | Budi Santoso | `line-01` |
  | `OP-1002` | Siti Rahmawati | `line-01` |
  | `OP-1003` | Agus Prasetyo | `line-02` |

  Uji dari host:

  ```bash
  curl -s -X POST http://127.0.0.1:3200/api/v1/auth/operator-login \
    -H 'Content-Type: application/json' \
    --data-binary '{"employeeNumber":"OP-1001","pin":"<BOOTSTRAP_OPERATOR_PIN>"}'
  # → {"token":"…","principal":{…,"kind":"OPERATOR"},…}
  ```

> **Windows:** gunakan `127.0.0.1`, bukan `localhost`. `localhost` bisa resolve ke
> `::1` lebih dulu, dan jika ada dev server (`pnpm dev:console`) yang masih hidup
> di `::1:3100`, permintaan Anda mengenai dev server itu — bukan container.
> Periksa dengan:
> ```powershell
> Get-NetTCPConnection -LocalPort 3100 -State Listen
> ```

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

# Backup database
docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec -T db \
  pg_dump -U factory factory_vision | gzip > backup-$(date +%F).sql.gz

# Hentikan stack (data tetap, ada di volume)
docker compose -f deploy/docker-compose.yml --env-file deploy/.env down
```

> `down -v` **menghapus volume database**. Jangan pakai pada host produksi.

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

### Operator 401 walau PIN sesuai `BOOTSTRAP_OPERATOR_PIN`

Periksa isi kolomnya — harus berupa digest, bukan PIN mentah:

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec -T db \
  psql -U factory -d factory_vision \
  -c "SELECT id, employee_number, left(pin_hash,7) FROM operator ORDER BY id;"
```

Nilai yang benar diawali `scrypt$`. Bila berisi PIN mentah, database itu diisi
oleh seed lama: nilainya tidak akan pernah cocok, **dan** karena kolomnya tidak
NULL bootstrap melewati operator tersebut sehingga PIN yang sah tidak pernah
diterbitkan. Kosongkan lalu restart API supaya bootstrap mengisinya:

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec -T db \
  psql -U factory -d factory_vision \
  -c "UPDATE operator SET pin_hash = NULL WHERE pin_hash NOT LIKE 'scrypt\$%';"
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d api
```

### `migrate` gagal di tahap seed

Migrasi sudah diterapkan; hanya seed yang gagal. Perbaiki seed, build ulang
image API (seed ikut ke dalam image), lalu jalankan ulang `migrate`.

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env build api
docker compose -f deploy/docker-compose.yml --env-file deploy/.env --profile migrate run --rm migrate
```
