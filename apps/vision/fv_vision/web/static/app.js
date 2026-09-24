// CV Vision dashboard. Plain JS, no build step. Every value from the server is
// written with textContent, never innerHTML.
"use strict";

const HLS_JS = "https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js";
const TZ = "Asia/Jakarta";
const fmtTime = new Intl.DateTimeFormat("id-ID", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const fmtDateTime = new Intl.DateTimeFormat("id-ID", {
  timeZone: TZ, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit",
});
const fmtDay = new Intl.DateTimeFormat("id-ID", { timeZone: TZ, day: "2-digit", month: "short" });

const state = {
  me: null,
  cameras: [],
  camera: null,
  mode: "deteksi",
  range: "today",
  alerts: [],
  live: null,
  ws: null,
  wsRetry: 0,
  hls: null,
  series: [],
};

const $ = (id) => document.getElementById(id);

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    credentials: "same-origin",
    headers: { "X-FV-Request": "1", ...(options.body ? { "Content-Type": "application/json" } : {}) },
  });
  if (res.status === 401) { location.href = "/login"; throw new Error("unauthorised"); }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error?.message || `HTTP ${res.status}`);
  return body;
}

const camera = () => state.cameras.find((c) => c.id === state.camera);

// ---------------------------------------------------------------- theme

function applyThemeLabel() {
  const dark = document.documentElement.dataset.theme === "dark" ||
    (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
  $("theme").textContent = dark ? "Mode terang" : "Mode gelap";
  return dark;
}

$("theme").addEventListener("click", () => {
  const next = applyThemeLabel() ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("fvv-theme", next); } catch (e) { /* private mode */ }
  applyThemeLabel();
  drawChart();
});

// ---------------------------------------------------------------- views

document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-selected", t === tab));
  $("view-pantau").classList.toggle("hidden", tab.dataset.view !== "pantau");
  $("view-riwayat").classList.toggle("hidden", tab.dataset.view !== "riwayat");
  if (tab.dataset.view === "riwayat") loadHistory();
}));

$("logout").addEventListener("click", async () => {
  try { await api("/api/logout", { method: "POST" }); } finally { location.href = "/login"; }
});

// ---------------------------------------------------------------- live view

document.querySelectorAll(".segmented button").forEach((b) => b.addEventListener("click", () => {
  state.mode = b.dataset.mode;
  document.querySelectorAll(".segmented button").forEach((x) => x.setAttribute("aria-selected", x === b));
  startLive();
}));

function stopLive() {
  $("live-img").removeAttribute("src");
  if (state.hls) { state.hls.destroy(); state.hls = null; }
  const video = $("live-video");
  video.pause(); video.removeAttribute("src"); video.load();
}

function showMessage(text) {
  $("live-msg").textContent = text || "";
  $("live-msg").classList.toggle("hidden", !text);
}

async function startLive() {
  stopLive();
  const cam = camera();
  if (!cam) return;
  const detect = state.mode === "deteksi";
  $("live-img").classList.toggle("hidden", !detect);
  $("live-video").classList.toggle("hidden", detect);
  $("meta-mode").textContent = detect
    ? "Deteksi: frame yang dianalisis (±2 per detik), kotak biru = orang dihitung, abu = pengendara, terang = kendaraan"
    : "Video langsung dari kamera, tanpa hasil deteksi";
  showMessage("");
  if (detect) {
    $("live-img").src = `/api/cameras/${encodeURIComponent(cam.id)}/live.mjpg?t=${Date.now()}`;
    return;
  }
  const video = $("live-video");
  try {
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = cam.source;
    } else {
      await loadScript(HLS_JS);
      if (!window.Hls?.isSupported()) { showMessage("Browser ini tidak dapat memutar stream HLS"); return; }
      state.hls = new window.Hls({ liveSyncDurationCount: 2 });
      state.hls.on(window.Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) showMessage("Stream kamera tidak dapat diputar saat ini");
      });
      state.hls.loadSource(cam.source);
      state.hls.attachMedia(video);
    }
    await video.play().catch(() => {});
  } catch (e) {
    showMessage("Pemutar video tidak dapat dimuat (butuh akses internet)");
  }
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = el("script", { src, crossorigin: "anonymous" });
    s.onload = resolve; s.onerror = reject;
    document.head.append(s);
  });
}

// ---------------------------------------------------------------- live figures

const STATUS = {
  lancar: ["ok", "Lancar"], padat: ["warn", "Padat"], macet: ["bad", "Macet"],
};

function renderLive(live) {
  state.live = live;
  const cam = camera();
  const pill = $("stream-pill");
  if (!live?.available) {
    pill.className = "pill bad"; pill.textContent = "Worker tidak aktif";
    showMessage(state.mode === "deteksi" ? "Belum ada frame dari worker analitik" : "");
  } else if (live.stale || !live.stream_up) {
    pill.className = "pill bad"; pill.textContent = live.stale ? "Tidak ada frame baru" : "Stream putus";
    if (state.mode === "deteksi") showMessage(`Frame terakhir ${Math.round(live.age_seconds)} detik lalu`);
  } else {
    pill.className = "pill ok"; pill.textContent = "Stream OK";
    if (state.mode === "deteksi") showMessage("");
  }
  $("meta-fps").textContent = live?.available ? `${(live.fps || 0).toFixed(1)} frame/detik dianalisis` : "";
  $("meta-age").textContent = live?.available ? `diperbarui ${Math.max(0, Math.round(live.age_seconds))} dtk lalu` : "";

  // People
  const people = live?.people;
  $("v-people").textContent = people ?? "–";
  const over = cam && people != null && people >= cam.crowd.alertCount;
  $("stat-people").classList.toggle("over", !!over);
  $("s-people").textContent = cam
    ? `Ambang alert ${cam.crowd.alertCount} orang selama ${cam.crowd.alertHoldSeconds} dtk · ` +
      `${live?.riders ?? 0} pengendara tidak dihitung`
    : "";

  $("v-peak").textContent = live?.peak_count ?? "–";
  $("s-peak").textContent = live?.peak_wall ? `pukul ${fmtTime.format(new Date(live.peak_wall * 1000))}` : "";

  const g = live?.growth_per_min;
  $("v-growth").textContent = g == null ? "–" : `${g > 0 ? "+" : ""}${Math.round(g)}`;
  const rising = cam && g != null && g >= cam.crowd.alertGrowthPerMin;
  $("stat-growth").classList.toggle("rising", !!rising);
  $("s-growth").textContent = cam ? `orang/menit · ambang +${cam.crowd.alertGrowthPerMin}` : "";

  // Traffic
  const zones = live?.zones || [];
  const box = $("zones");
  box.replaceChildren();
  if (!zones.length) box.append(el("div", { class: "sub" }, "Tidak ada zona jalan untuk kamera ini"));
  for (const z of zones) {
    const [tone, label] = STATUS[z.status] || ["neutral", "–"];
    const since = z.status_since ? ` sejak ${fmtTime.format(new Date(z.status_since * 1000))}` : "";
    box.append(el("div", { class: "zone" },
      el("span", { class: "name", title: z.name }, z.name),
      el("span", { class: "muted num" }, `${z.vehicles} kend.${since}`),
      el("span", { class: `pill ${tone}` }, label)));
  }

  // Weapon
  $("s-weapon").textContent = cam?.weapon.enabled
    ? `Aktif · orang setinggi ≥ ${cam.weapon.minPersonHeightPx} px diperiksa; setiap alert wajib diverifikasi operator`
    : "Nonaktif untuk kamera ini: orang di frame terlalu kecil untuk dikenali, atau model belum tersedia";
}

// ---------------------------------------------------------------- alerts

function alertTitle(a) {
  if (a.type === "senjata") return "Potensi senjata tajam";
  return a.kind === "laju" ? "Kerumunan bertambah cepat" : "Kerumunan melewati ambang";
}

function alertDesc(a) {
  if (a.type === "senjata") return `Confidence ${Math.round(a.confidence * 100)}% · ${a.camera}`;
  return a.kind === "laju"
    ? `${a.count} orang, laju +${a.growthPerMin}/menit (ambang +${a.threshold}) · ${a.camera}`
    : `${a.count} orang (ambang ${a.threshold}) · ${a.camera}`;
}

const DECISION = {
  menunggu: ["warn", "Menunggu verifikasi"],
  konfirmasi: ["bad", "Dikonfirmasi"],
  tolak: ["neutral", "Ditolak"],
};

function snapshotUrl(a) {
  return `/api/snapshots/${encodeURIComponent(a.camera)}/${a.snapshot.split("/").map(encodeURIComponent).join("/")}`;
}

function alertNode(a, fresh = false) {
  const children = [el("div", { class: "rail" })];
  if (a.type === "senjata" && a.snapshot) {
    children.push(el("img", {
      class: "thumb", src: snapshotUrl(a), alt: "Snapshot", loading: "lazy",
      onclick: () => openSnapshot(a),
    }));
  }
  const actions = [];
  if (a.type === "senjata") {
    const [tone, label] = DECISION[a.status] || DECISION.menunggu;
    actions.push(el("span", { class: `pill ${tone}` }, label));
    if (a.status === "menunggu") {
      actions.push(el("button", { class: "btn small primary", type: "button", onclick: () => askVerify(a, "konfirmasi") }, "Konfirmasi"));
      actions.push(el("button", { class: "btn small", type: "button", onclick: () => askVerify(a, "tolak") }, "Tolak"));
    } else if (a.verifiedBy) {
      actions.push(el("span", { class: "muted num tiny" },
        `oleh ${a.verifiedBy}, ${fmtDateTime.format(new Date(a.verifiedAt))}`));
    }
  }
  children.push(el("div", { class: "body" },
    el("div", { class: "title" }, alertTitle(a)),
    el("div", { class: "desc num" }, `${fmtDateTime.format(new Date(a.ts))} · ${alertDesc(a)}`),
    a.note ? el("div", { class: "desc" }, `Catatan: ${a.note}`) : null,
    actions.length ? el("div", { class: "actions" }, actions) : null));
  return el("div", { class: `alert ${a.type}${fresh ? " fresh" : ""}`, "data-key": `${a.type}:${a.id}` }, children);
}

function renderAlerts(freshKeys = new Set()) {
  const list = $("alerts");
  const mine = state.alerts.filter((a) => a.camera === state.camera);
  list.replaceChildren();
  if (!mine.length) {
    list.append(el("div", { class: "empty" }, "Belum ada alert untuk kamera ini"));
  }
  for (const a of mine.slice(0, 100)) list.append(alertNode(a, freshKeys.has(`${a.type}:${a.id}`)));
  const pending = mine.filter((a) => a.type === "senjata" && a.status === "menunggu").length;
  $("pending-badge").textContent = pending;
  $("pending-badge").classList.toggle("hidden", !pending);
  document.title = pending ? `(${pending}) CV Vision` : "CV Vision";
}

function mergeAlerts(items, announce) {
  const fresh = new Set();
  for (const a of items) {
    const key = `${a.type}:${a.id}`;
    const i = state.alerts.findIndex((x) => `${x.type}:${x.id}` === key);
    if (i >= 0) state.alerts[i] = a;
    else { state.alerts.push(a); fresh.add(key); if (announce) toast(a); }
  }
  state.alerts.sort((x, y) => (x.ts < y.ts ? 1 : -1));
  renderAlerts(announce ? fresh : new Set());
}

function toast(a) {
  const node = el("div", { class: `toast ${a.type}`, role: "status" },
    el("b", {}, alertTitle(a)), el("span", { class: "num" }, alertDesc(a)));
  $("toasts").append(node);
  setTimeout(() => node.remove(), 8000);
}

function openSnapshot(a) {
  $("snap-title").textContent = `${alertTitle(a)} · ${fmtDateTime.format(new Date(a.ts))}`;
  $("snap-img").src = snapshotUrl(a);
  $("dlg-snapshot").showModal();
}

let verifying = null;
function askVerify(a, decision) {
  verifying = { a, decision };
  $("verify-title").textContent = decision === "konfirmasi" ? "Konfirmasi: benar senjata tajam?" : "Tolak: salah deteksi?";
  $("verify-desc").textContent = `${fmtDateTime.format(new Date(a.ts))} · ${alertDesc(a)}`;
  $("verify-note").value = "";
  $("verify-ok").className = decision === "konfirmasi" ? "btn danger" : "btn primary";
  $("verify-ok").textContent = decision === "konfirmasi" ? "Konfirmasi" : "Tolak alert";
  $("dlg-verify").showModal();
}

$("verify-ok").addEventListener("click", async () => {
  if (!verifying) return;
  const { a, decision } = verifying;
  $("verify-ok").disabled = true;
  try {
    const updated = await api(`/api/alerts/senjata/${a.id}/verify`, {
      method: "POST", body: JSON.stringify({ decision, note: $("verify-note").value }),
    });
    mergeAlerts([updated], false);
    $("dlg-verify").close();
  } catch (e) {
    $("verify-desc").textContent = `Gagal menyimpan: ${e.message}`;
  } finally {
    $("verify-ok").disabled = false;
  }
});

document.querySelectorAll("dialog [data-close]").forEach((b) =>
  b.addEventListener("click", () => b.closest("dialog").close()));

// ---------------------------------------------------------------- chart

document.querySelectorAll("#range .chip").forEach((c) => c.addEventListener("click", () => {
  state.range = c.dataset.range;
  document.querySelectorAll("#range .chip").forEach((x) => x.setAttribute("aria-pressed", x === c));
  loadSeries();
}));

async function loadSeries() {
  if (!state.camera) return;
  try {
    state.series = await api(`/api/cameras/${encodeURIComponent(state.camera)}/people?range=${state.range}`);
  } catch (e) { state.series = []; }
  drawChart();
}

function niceMax(v) {
  if (v <= 5) return 5;
  const step = Math.pow(10, Math.floor(Math.log10(v)));
  return Math.ceil(v / step) * step;
}

function drawChart() {
  const svg = $("chart");
  const W = svg.clientWidth || 600, H = svg.clientHeight || 240;
  const pad = { l: 36, r: 12, t: 12, b: 26 };
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.replaceChildren();
  const ns = "http://www.w3.org/2000/svg";
  const add = (tag, attrs, text) => {
    const n = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (text != null) n.textContent = text;
    svg.append(n); return n;
  };
  const data = state.series;
  const cam = camera();
  if (!data.length) {
    add("text", { x: W / 2, y: H / 2, "text-anchor": "middle", class: "axis" }, "Belum ada data untuk rentang ini");
    $("chart-tip").textContent = "";
    return;
  }
  const t0 = Date.parse(data[0].t), t1 = Math.max(Date.parse(data[data.length - 1].t), t0 + 60000);
  const threshold = cam?.crowd.alertCount ?? 0;
  const yMax = niceMax(Math.max(...data.map((d) => d.max), threshold, 1));
  const x = (t) => pad.l + ((t - t0) / (t1 - t0)) * (W - pad.l - pad.r);
  const y = (v) => H - pad.b - (v / yMax) * (H - pad.t - pad.b);

  for (let i = 0; i <= 4; i++) {
    const v = (yMax / 4) * i;
    add("line", { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: "grid-line" });
    add("text", { x: pad.l - 6, y: y(v) + 4, "text-anchor": "end", class: "axis" }, Math.round(v));
  }
  const ticks = 6;
  for (let i = 0; i <= ticks; i++) {
    const t = t0 + ((t1 - t0) / ticks) * i;
    const label = state.range === "7d" ? fmtDay.format(new Date(t)) : fmtTime.format(new Date(t));
    add("text", { x: x(t), y: H - 8, "text-anchor": "middle", class: "axis" }, label);
  }
  if (cam?.crowd.enabled && threshold <= yMax) {
    add("line", { x1: pad.l, x2: W - pad.r, y1: y(threshold), y2: y(threshold), class: "threshold" });
    add("text", { x: W - pad.r, y: y(threshold) - 4, "text-anchor": "end", class: "threshold-label" }, `ambang ${threshold}`);
  }
  const pts = data.map((d) => [x(Date.parse(d.t)), d]);
  const band = pts.map(([px, d]) => `${px},${y(d.max)}`).concat(
    pts.slice().reverse().map(([px, d]) => `${px},${y(d.min)}`));
  add("polygon", { points: band.join(" "), class: "band" });
  add("polyline", { points: pts.map(([px, d]) => `${px},${y(d.avg)}`).join(" "), class: "line" });

  const cursor = add("line", { y1: pad.t, y2: H - pad.b, class: "cursor", visibility: "hidden" });
  const dot = add("circle", { r: 4, class: "dot", visibility: "hidden" });
  svg.onmousemove = (ev) => {
    const rect = svg.getBoundingClientRect();
    const mx = ((ev.clientX - rect.left) / rect.width) * W;
    let best = pts[0];
    for (const p of pts) if (Math.abs(p[0] - mx) < Math.abs(best[0] - mx)) best = p;
    const [px, d] = best;
    cursor.setAttribute("x1", px); cursor.setAttribute("x2", px); cursor.setAttribute("visibility", "visible");
    dot.setAttribute("cx", px); dot.setAttribute("cy", y(d.avg)); dot.setAttribute("visibility", "visible");
    const when = state.range === "7d" ? fmtDateTime.format(new Date(d.t)) : fmtTime.format(new Date(d.t));
    $("chart-tip").textContent = `${when} · rata-rata ${d.avg.toFixed(1)} · min ${d.min} · maks ${d.max}`;
  };
  svg.onmouseleave = () => {
    cursor.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden");
    $("chart-tip").textContent = "Arahkan kursor ke grafik untuk detail · pita = rentang min–maks per menit";
  };
  svg.onmouseleave();
}

addEventListener("resize", () => drawChart());

// ---------------------------------------------------------------- websocket

function connect() {
  if (state.ws) { state.ws.onclose = null; state.ws.close(); }
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws?camera=${encodeURIComponent(state.camera)}`);
  state.ws = ws;
  ws.onopen = () => { state.wsRetry = 0; };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "live") renderLive(msg.data);
    if (msg.type === "alerts") mergeAlerts(msg.data, true);
  };
  ws.onclose = (ev) => {
    if (ev.code === 4401) { location.href = "/login"; return; }
    $("stream-pill").className = "pill neutral";
    $("stream-pill").textContent = "Menghubungkan ulang…";
    const delay = Math.min(30000, 1000 * 2 ** state.wsRetry++);
    setTimeout(connect, delay);
  };
}

// ---------------------------------------------------------------- history

function historyQuery() {
  const p = new URLSearchParams();
  if (state.camera) p.set("camera", state.camera);
  p.set("type", $("f-type").value);
  if ($("f-start").value) p.set("start", $("f-start").value);
  if ($("f-end").value) p.set("end", $("f-end").value);
  return p;
}

async function loadHistory() {
  const p = historyQuery();
  p.set("limit", "1000");
  $("export-alerts").href = `/api/export/alerts.csv?${historyQuery()}`;
  const pp = new URLSearchParams(historyQuery());
  pp.delete("type");
  $("export-people").href = `/api/export/people.csv?${pp}`;
  const body = $("history");
  body.replaceChildren(el("tr", {}, el("td", { colspan: 7, class: "muted" }, "Memuat…")));
  let rows = [];
  try { rows = await api(`/api/alerts?${p}`); } catch (e) {
    body.replaceChildren(el("tr", {}, el("td", { colspan: 7 }, `Gagal memuat: ${e.message}`)));
    return;
  }
  body.replaceChildren();
  if (!rows.length) body.append(el("tr", {}, el("td", { colspan: 7, class: "muted" }, "Tidak ada alert pada rentang ini")));
  for (const a of rows) {
    const [tone, label] = a.type === "senjata" ? (DECISION[a.status] || DECISION.menunggu) : ["neutral", "—"];
    body.append(el("tr", {},
      el("td", { class: "num" }, fmtDateTime.format(new Date(a.ts))),
      el("td", {}, a.camera),
      el("td", {}, alertTitle(a)),
      el("td", {}, alertDesc(a), a.note ? el("div", { class: "muted" }, `Catatan: ${a.note}`) : null),
      el("td", {}, a.type === "senjata" ? el("span", { class: `pill ${tone}` }, label) : el("span", { class: "muted" }, "—")),
      el("td", {}, a.verifiedBy || "—"),
      el("td", { class: "fv-num" }, a.secondsToVerify != null ? `${a.secondsToVerify} dtk` : "—")));
  }
}

$("f-apply").addEventListener("click", loadHistory);

// ---------------------------------------------------------------- start

async function selectCamera(id) {
  state.camera = id;
  const cam = camera();
  $("live-title").textContent = `Live view · ${id}`;
  startLive();
  connect();
  loadSeries();
  if (!$("view-riwayat").classList.contains("hidden")) loadHistory();
  renderAlerts();
  renderLive(null);
  if (cam) renderLive(await api(`/api/cameras/${encodeURIComponent(id)}/live`).catch(() => null));
}

async function init() {
  applyThemeLabel();
  state.me = await api("/api/me");
  $("user-name").textContent = state.me.displayName;
  $("user-role").textContent = state.me.role === "admin" ? "Admin" : "Operator";
  state.cameras = await api("/api/cameras");
  const select = $("camera");
  for (const c of state.cameras) select.append(el("option", { value: c.id }, c.id));
  select.addEventListener("change", () => selectCamera(select.value));
  mergeAlerts(await api("/api/alerts?limit=200"), false);
  if (state.cameras.length) await selectCamera(state.cameras[0].id);
  else showMessage("Belum ada kamera yang dikonfigurasi");
  setInterval(loadSeries, 60000);
}

init().catch((e) => console.error(e));
