import { supabase } from "../js/supabase.js";

/* =========================================================
   ZENTO ADMIN PANEL
   Same backend as before:
   POST /api/login          GET /api/profile
   GET/POST/PUT/DELETE /api/products
   GET /api/admin/orders    PUT /api/admin/orders/:id/status
   POST /api/admin/orders/:id/approve
   Supabase storage bucket: product-images
========================================================= */

const API_BASE = window.location.origin;
const TOKEN_KEY = "zento_admin_token";
const USER_KEY = "zento_admin_user";
const DAY = 86400000;
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => "৳" + Number(n || 0).toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const store = {
  get: (k, d = "") => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  del: (k) => { try { localStorage.removeItem(k); } catch {} }
};

/* ---------- icons ---------- */
const I = {
  dashboard: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/>',
  products: '<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  orders: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.5 12h11l2-8H6"/>',
  customers: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.5 3-6 6.5-6s6.5 2.5 6.5 6"/><path d="M16 4.5a3.5 3.5 0 010 7M18 14.5c2.2.6 3.5 2.6 3.5 5.5"/>',
  analytics: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  lowstock: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>',
  recent: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  revenue: '<path d="M12 3v9h9"/><circle cx="12" cy="12" r="9"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  cal: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'
};
const ico = (k) => `<svg class="ico" viewBox="0 0 24 24">${I[k]}</svg>`;

/* ---------- state ---------- */
const S = {
  products: [], orders: [], loaded: false, loading: false, error: "",
  pq: "", oq: "", os: "all", cq: "", rq: "", range: 30
};
const getToken = () => store.get(TOKEN_KEY);
const getUser = () => { try { return JSON.parse(store.get(USER_KEY, "null")); } catch { return null; } };
const lowLimit = () => Math.max(0, Number(store.get("zento_low_stock_threshold", "10")) || 10);

/* ---------- API (same contract as the old panel) ---------- */
async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (!headers["Content-Type"] && options.body) headers["Content-Type"] = "application/json";
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const err = new Error(data?.message || data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function adminLogin(email, password) {
  const box = $("#loginError");
  box.textContent = "";
  try {
    const res = await fetch(`${API_BASE}/api/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok || data.status !== "success") throw new Error(data?.message || data?.error || "Invalid email or password.");
    if (data.user?.role !== "admin") throw new Error("This account does not have admin access.");
    const token = data.token || data.access_token || data.jwt || "";
    if (!token) throw new Error("Login succeeded but no authentication token was returned.");
    store.set(TOKEN_KEY, token);
    store.set(USER_KEY, JSON.stringify(data.user));
    enterApp();
    toast("Admin login successful.");
  } catch (e) {
    box.textContent = e.message;
  }
}

async function checkSession() {
  if (!getToken()) return showLogin();
  try {
    const data = await api("/api/profile");
    const user = data.user || data;
    if (user?.role !== "admin") throw new Error("Not an admin.");
    store.set(USER_KEY, JSON.stringify(user));
    enterApp();
  } catch {
    store.del(TOKEN_KEY); store.del(USER_KEY);
    showLogin();
  }
}
function showLogin() {
  $("#loginScreen").hidden = false; $("#adminApp").hidden = true; $("#tabbar").hidden = true;
}
function enterApp() {
  $("#loginScreen").hidden = true; $("#adminApp").hidden = false; $("#tabbar").hidden = false;
  const u = getUser() || {};
  const name = u.name || u.full_name || u.email || "Admin";
  ["#sideName", "#topName"].forEach((s) => ($(s).textContent = name));
  ["#sideAvatar", "#topAvatar"].forEach((s) => ($(s).textContent = name.trim().charAt(0).toUpperCase() || "A"));
  S.loaded = false;
  route();
  loadAll();
}
function logout() {
  store.del(TOKEN_KEY); store.del(USER_KEY);
  S.products = []; S.orders = []; S.loaded = false;
  showLogin(); toast("Logged out.");
}

/* ---------- data loading ---------- */
async function loadAll() {
  S.loading = true; S.error = ""; renderView();
  try {
    const [p, o] = await Promise.all([api("/api/products"), api("/api/admin/orders")]);
    S.products = Array.isArray(p) ? p : p.products || p.data || [];
    S.orders = Array.isArray(o) ? o : o.orders || o.data || [];
    S.loaded = true;
  } catch (e) {
    if (e.status === 401) { logout(); return; }
    S.error = e.message || "Could not load data.";
  }
  S.loading = false;
  renderView(); updateBell();
}
async function reloadProducts() {
  const p = await api("/api/products");
  S.products = Array.isArray(p) ? p : p.products || p.data || [];
  updateBell();
}
async function reloadOrders() {
  const o = await api("/api/admin/orders");
  S.orders = Array.isArray(o) ? o : o.orders || o.data || [];
}

/* ---------- derived data ---------- */
const pdate = (s) => new Date(String(s || "").replace(" ", "T"));
const dstr = (s) => { const d = pdate(s); return isNaN(d) ? "-" : `${MON[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const dshort = (s) => { const d = pdate(s); return isNaN(d) ? "-" : `${MON[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`; };
const oid = (id) => "#ZT-" + String(id).padStart(4, "0");
const sod = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
const statusLabel = (s) => ({ out_for_delivery: "Out for delivery" }[s] || String(s || "pending").replace(/^./, (c) => c.toUpperCase()));
const pillFor = (s) => ({ delivered: "good", approved: "info", processing: "info", shipped: "violet", out_for_delivery: "violet", pending: "warn" }[s] || "info");
const STATUSES = ["pending", "approved", "processing", "shipped", "out_for_delivery", "delivered"];

function inWindow(days, back = 0) {
  const end = sod(Date.now()) + DAY - back * days * DAY, start = end - days * DAY;
  return S.orders.filter((o) => { const t = pdate(o.created_at).getTime(); return t >= start && t < end; });
}
const sum = (list) => list.reduce((a, o) => a + Number(o.total || 0), 0);
const pct = (cur, prev) => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null);
function dailySeries(days) {
  const today = sod(Date.now()), out = [];
  for (let i = days - 1; i >= 0; i--) { const t = today - i * DAY; const d = new Date(t); out.push({ t, label: `${MON[d.getMonth()]} ${d.getDate()}`, v: 0, n: 0 }); }
  S.orders.forEach((o) => {
    const t = sod(pdate(o.created_at)); const b = out.find((x) => x.t === t);
    if (b) { b.v += Number(o.total || 0); b.n += 1; }
  });
  return out;
}
function customersList() {
  const map = new Map();
  S.orders.forEach((o) => {
    const k = o.user_id ?? o.phone;
    const c = map.get(k) || { name: o.customer_name, phone: o.phone, city: o.city, orders: 0, spent: 0, first: o.created_at, last: o.created_at };
    c.orders += 1; c.spent += Number(o.total || 0);
    if (pdate(o.created_at) < pdate(c.first)) c.first = o.created_at;
    if (pdate(o.created_at) >= pdate(c.last)) { c.last = o.created_at; c.name = o.customer_name; c.phone = o.phone; c.city = o.city; }
    map.set(k, c);
  });
  return [...map.values()].sort((a, b) => pdate(b.last) - pdate(a.last));
}
function lowStockList() {
  const lim = lowLimit();
  return S.products.filter((p) => Number(p.stock) <= lim).sort((a, b) => a.stock - b.stock);
}
const catOf = (p) => (p && p.category) || "Uncategorized";
function categoryRevenue(orders) {
  const byId = new Map(S.products.map((p) => [String(p.id), p]));
  const byName = new Map(S.products.map((p) => [p.name, p]));
  const m = new Map();
  orders.forEach((o) => (o.items || []).forEach((it) => {
    const p = byId.get(String(it.product_id)) || byName.get(it.name);
    const c = catOf(p);
    m.set(c, (m.get(c) || 0) + Number(it.subtotal || it.price * it.quantity || 0));
  }));
  return [...m.entries()].map(([n, v]) => ({ n, v })).sort((a, b) => b.v - a.v);
}
function topProducts(orders) {
  const byId = new Map(S.products.map((p) => [String(p.id), p]));
  const m = new Map();
  orders.forEach((o) => (o.items || []).forEach((it) => {
    const k = String(it.product_id ?? it.name);
    const r = m.get(k) || { name: it.name, amt: 0, qty: 0, img: (byId.get(String(it.product_id)) || {}).image_url };
    r.amt += Number(it.subtotal || 0); r.qty += Number(it.quantity || 0); m.set(k, r);
  }));
  return [...m.values()].sort((a, b) => b.amt - a.amt).slice(0, 4);
}
const COLORS = ["var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)", "var(--c5)", "var(--c6)"];
function shares(list, max) {
  const total = list.reduce((a, d) => a + d.v, 0);
  if (!total) return [];
  let head = list.slice(0, max), rest = list.slice(max);
  if (rest.length) head = [...head, { n: "Others", v: rest.reduce((a, d) => a + d.v, 0) }];
  return head.map((d, i) => ({ n: d.n, v: Math.round((d.v / total) * 100), raw: d.v, c: COLORS[i % COLORS.length] }));
}

/* ---------- charts (measured, redrawn on resize) ---------- */
function niceScale(max, n) {
  if (max <= 0) return { max: n * 250, step: 250 };
  const raw = max / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  return { max: step * n, step };
}
const kfmt = (v) => (v === 0 ? "৳0" : v >= 1000 ? "৳" + +(v / 1000).toFixed(1) + "K" : "৳" + +v.toFixed(0));
function drawArea(el, series) {
  const w = Math.max(260, el.clientWidth), h = w < 420 ? 190 : 230, L = w < 420 ? 40 : 46, R = 10, T = 10, B = 26;
  const iw = w - L - R, ih = h - T - B, n = series.length;
  const sc = niceScale(Math.max(...series.map((d) => d.v)), 4);
  const X = (i) => L + (n === 1 ? 0 : (i * iw) / (n - 1)), Y = (v) => T + ih - (v / sc.max) * ih;
  const pts = series.map((d, i) => [X(i), Y(d.v)]);
  const line = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const gid = "g" + Math.random().toString(36).slice(2, 7);
  const grid = Array.from({ length: 5 }, (_, i) => i * sc.step).map((v) => `<line x1="${L}" x2="${w - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)" stroke-dasharray="3 4"/><text x="${L - 8}" y="${Y(v) + 4}" text-anchor="end" font-size="10.5" fill="var(--muted)">${kfmt(v)}</text>`).join("");
  const step = Math.max(1, Math.ceil(n / (w < 420 ? 4 : 8)));
  const xt = series.map((d, i) => (i % step === 0 ? `<text x="${X(i)}" y="${h - 6}" text-anchor="${i === 0 ? "start" : "middle"}" font-size="10.5" fill="var(--muted)">${d.label}</text>` : "")).join("");
  const last = pts[n - 1];
  el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Sales over time"><defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--brand)" stop-opacity=".28"/><stop offset="1" stop-color="var(--brand)" stop-opacity="0"/></linearGradient></defs>${grid}${xt}<path d="${line} L${X(n - 1)} ${T + ih} L${X(0)} ${T + ih}Z" fill="url(#${gid})"/><path d="${line}" fill="none" stroke="var(--brand)" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${last[0]}" cy="${last[1]}" r="4.5" fill="var(--surface)" stroke="var(--brand)" stroke-width="2.2"/></svg>`;
}
function drawBars(el, items) {
  const w = Math.max(260, el.clientWidth), h = w < 420 ? 230 : 270, L = w < 420 ? 42 : 50, R = 8, T = 24, B = 26;
  const iw = w - L - R, ih = h - T - B, n = items.length, slot = iw / n, bw = Math.min(64, slot * 0.62);
  const sc = niceScale(Math.max(...items.map((d) => d.v)), 5), Y = (v) => T + ih - (v / sc.max) * ih;
  const grid = Array.from({ length: 6 }, (_, i) => i * sc.step).map((v) => `<line x1="${L}" x2="${w - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)" stroke-dasharray="3 4"/><text x="${L - 8}" y="${Y(v) + 4}" text-anchor="end" font-size="10.5" fill="var(--muted)">${kfmt(v)}</text>`).join("");
  const bars = items.map((d, i) => {
    const x = L + i * slot + (slot - bw) / 2, y = Y(d.v), name = d.n.length > 11 ? d.n.slice(0, 10) + "…" : d.n;
    return `<rect x="${x}" y="${y}" width="${bw}" height="${Math.max(0, T + ih - y)}" rx="4" fill="${d.c}"/><text x="${x + bw / 2}" y="${y - 7}" text-anchor="middle" font-size="11" font-weight="600" fill="var(--ink)">${kfmt(d.v)}</text><text x="${x + bw / 2}" y="${h - 6}" text-anchor="middle" font-size="10.5" fill="var(--muted)">${esc(name)}</text>`;
  }).join("");
  el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Revenue by category">${grid}${bars}</svg>`;
}
function donut(items) {
  const r = 52, C = 2 * Math.PI * r, total = items.reduce((a, d) => a + d.v, 0);
  let off = 0;
  const segs = items.map((d) => { const len = (C * d.v) / total; const s = `<circle r="${r}" cx="75" cy="75" fill="none" stroke="${d.c}" stroke-width="22" stroke-dasharray="${Math.max(0, len - 1.5).toFixed(2)} ${(C - len + 1.5).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 75 75)"/>`; off += len; return s; }).join("");
  return `<svg class="donut" viewBox="0 0 150 150" role="img" aria-label="Share chart">${segs}</svg>`;
}
const legend = (items) => `<div class="legend">${items.map((d) => `<div><i style="background:${d.c}"></i><span>${esc(d.n)}</span><span>${d.v}%</span></div>`).join("")}</div>`;
const donutCard = (items) => (items.length ? `<div class="donut-wrap">${donut(items)}${legend(items)}</div>` : `<div class="state">No data yet.</div>`);
function sparkSvg(a) {
  if (!a || a.length < 2) return "";
  const w = 84, h = 34, mx = Math.max(...a), mn = Math.min(...a);
  const P = a.map((v, i) => [(i * w) / (a.length - 1), h - 3 - ((v - mn) / (mx - mn || 1)) * (h - 8)]);
  const d = P.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const gid = "s" + Math.random().toString(36).slice(2, 7);
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--brand)" stop-opacity=".25"/><stop offset="1" stop-color="var(--brand)" stop-opacity="0"/></linearGradient></defs><path d="${d} L${w} ${h} L0 ${h}Z" fill="url(#${gid})"/><path d="${d}" fill="none" stroke="var(--brand)" stroke-width="1.8" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
}
const deltaTag = (d) => (d === null || d === undefined ? "" : `<span class="delta${d < 0 ? " down" : ""}">${Math.abs(d)}%</span>`);
const kpi = (l, v, d, s) => `<div class="card kpi"><div><div class="lbl">${l}</div><div class="val">${v}${deltaTag(d)}</div></div>${sparkSvg(s)}</div>`;

let specs = {};
const chartBox = (id, fn) => { specs[id] = fn; return `<div class="chart" data-chart="${id}"></div>`; };
function paintCharts() {
  document.querySelectorAll("[data-chart]").forEach((el) => { const f = specs[el.dataset.chart]; if (f) f(el); });
}

/* ---------- views ---------- */
const head = (t, p, right = "") => `<div class="head"><div><h1>${t}</h1><p>${p}</p></div>${right ? `<div class="tools">${right}</div>` : ""}</div>`;
const searchField = (id, ph, val = "") => `<label class="field">${ico("search")}<input id="${id}" type="search" value="${esc(val)}" placeholder="${ph}" aria-label="${ph}"></label>`;
const prodThumb = (p) => (p && p.image_url ? `<img class="prod-img" src="${esc(p.image_url)}" alt="" loading="lazy">` : `<div class="ph">${ico("products")}</div>`);
const statePanel = (html) => `<div class="card"><div class="state">${html}</div></div>`;

function vDashboard() {
  const cur = inWindow(30), prev = inWindow(30, 1);
  const cs = customersList(), returning = cs.length ? Math.round((cs.filter((c) => c.orders > 1).length / cs.length) * 100) : 0;
  const ds = dailySeries(12);
  const tp = topProducts(S.orders).slice(0, 3);
  const total = sum(S.orders);
  return head("Dashboard", "Welcome back! Here's what's happening with your store today.") + `
  <div class="kpis">
    ${kpi("Gross Sales", money(total), pct(sum(cur), sum(prev)), ds.map((d) => d.v))}
    ${kpi("Orders", S.orders.length.toLocaleString(), pct(cur.length, prev.length), ds.map((d) => d.n))}
    ${kpi("Customers", cs.length.toLocaleString(), null)}
    ${kpi("Returning Customers", returning + "%", null)}
  </div>
  <div class="grid-2">
    <section class="card card-pad"><h2>Total sales over time</h2><p class="sub" style="margin:2px 0 0">Last 30 days</p><div class="big" style="margin-top:6px">${money(sum(cur))}${deltaTag(pct(sum(cur), sum(prev)))}</div>${chartBox("sales30", (el) => drawArea(el, dailySeries(30)))}</section>
    <section class="card card-pad"><h2>Top products</h2>${tp.length ? `<div class="tp">${tp.map((p) => `<div class="tp-row"><div class="thumb">${p.img ? `<img src="${esc(p.img)}" alt="" loading="lazy">` : ico("products")}</div><div class="nm">${esc(p.name)}</div><div class="amt">${money(p.amt)}<small>${p.qty} sold</small></div></div>`).join("")}</div>` : `<div class="state">No sales yet.</div>`}</section>
  </div>`;
}
function vAnalytics() {
  const d = S.range, cur = inWindow(d), prev = inWindow(d, 1);
  const aov = cur.length ? sum(cur) / cur.length : 0, aovPrev = prev.length ? sum(prev) / prev.length : 0;
  const rate = (l) => (l.length ? Math.round((l.filter((o) => o.status === "delivered").length / l.length) * 100) : 0);
  const ser = dailySeries(d);
  const opts = [7, 30, 90].map((n) => `<option value="${n}"${n === d ? " selected" : ""}>Last ${n} days</option>`).join("");
  return head("Sales Analytics", "Detailed sales performance and trends", `<label class="field">${ico("cal")}<select id="range" aria-label="Date range">${opts}</select></label>`) + `
  <div class="kpis">
    ${kpi("Total Sales", money(sum(cur)), pct(sum(cur), sum(prev)), ser.slice(-12).map((x) => x.v))}
    ${kpi("Total Orders", cur.length.toLocaleString(), pct(cur.length, prev.length), ser.slice(-12).map((x) => x.n))}
    ${kpi("Average Order Value", money(aov), pct(aov, aovPrev))}
    ${kpi("Delivered Rate", rate(cur) + "%", null)}
  </div>
  <div class="grid-2b">
    <section class="card card-pad"><h2>Sales Overview</h2>${chartBox("salesR", (el) => drawArea(el, dailySeries(S.range)))}</section>
    <section class="card card-pad"><h2>Sales by Category</h2>${donutCard(shares(categoryRevenue(cur), 4))}</section>
  </div>`;
}
function productRows() {
  const q = S.pq.trim().toLowerCase(), lim = lowLimit();
  const list = S.products.filter((p) => !q || (p.name || "").toLowerCase().includes(q) || (p.category || "").toLowerCase().includes(q));
  if (!list.length) return `<tr><td colspan="7"><div class="empty">${S.products.length ? `No products match "${esc(S.pq)}".` : "No products yet. Add your first product."}</div></td></tr>`;
  return list.map((p) => `<tr><td>${prodThumb(p)}</td><td style="font-weight:500">${esc(p.name)}</td><td>${esc(p.category || "-")}</td><td>${money(p.price)}</td><td>${Number(p.stock)}</td><td><span class="pill ${Number(p.stock) <= lim ? "bad" : "good"}">${Number(p.stock) <= lim ? "Low Stock" : "In Stock"}</span></td><td><div class="acts"><button class="act" data-edit="${p.id}" aria-label="Edit ${esc(p.name)}">${ico("edit")}</button><button class="act del" data-del="${p.id}" aria-label="Delete ${esc(p.name)}">${ico("trash")}</button></div></td></tr>`).join("");
}
function vProducts() {
  return head("Products", "Manage your store products", searchField("pq", "Search products...", S.pq) + `<button class="btn btn-primary" id="addProduct">${ico("plus")}Add Product</button>`) + `
  <section class="card table-card"><div class="tscroll"><table><thead><tr><th>Image</th><th>Product Name</th><th>Category</th><th>Price</th><th>Stock</th><th>Status</th><th>Actions</th></tr></thead><tbody id="prodBody">${productRows()}</tbody></table></div><div class="tfoot"><span id="prodCount">${S.products.length} products</span><span>Low stock at ${lowLimit()} units or fewer</span></div></section>`;
}
function orderRows() {
  const q = S.oq.trim().toLowerCase();
  const list = S.orders.filter((o) => (S.os === "all" || o.status === S.os) && (!q || (o.customer_name || "").toLowerCase().includes(q) || oid(o.id).toLowerCase().includes(q) || String(o.id) === q.replace("#", "")));
  if (!list.length) return `<tr><td colspan="6"><div class="empty">No orders found.</div></td></tr>`;
  return list.map((o) => `<tr><td style="font-weight:600">${oid(o.id)}</td><td>${esc(o.customer_name)}</td><td>${dstr(o.created_at)}</td><td>${money(o.total)}</td><td><span class="pill ${pillFor(o.status)}">${statusLabel(o.status)}</span></td><td><button class="btn btn-sm btn-soft" data-order="${o.id}">View</button></td></tr>`).join("");
}
function vOrders() {
  const opts = [["all", "All Status"], ...STATUSES.map((s) => [s, statusLabel(s)])].map(([v, l]) => `<option value="${v}"${v === S.os ? " selected" : ""}>${l}</option>`).join("");
  return head("Orders", "Track and manage customer orders", searchField("oq", "Search orders...", S.oq) + `<label class="field"><select id="os" aria-label="Filter by status">${opts}</select></label>`) + `
  <section class="card table-card"><div class="tscroll"><table><thead><tr><th>Order ID</th><th>Customer</th><th>Date</th><th>Total</th><th>Status</th><th>Actions</th></tr></thead><tbody id="ordBody">${orderRows()}</tbody></table></div></section>`;
}
function custRows() {
  const q = S.cq.trim().toLowerCase(), now = Date.now();
  const list = customersList().filter((c) => !q || (c.name || "").toLowerCase().includes(q) || (c.phone || "").toLowerCase().includes(q));
  if (!list.length) return `<tr><td colspan="7"><div class="empty">${S.orders.length ? `No customers match "${esc(S.cq)}".` : "Customers appear here after their first order."}</div></td></tr>`;
  return list.map((c) => { const active = now - pdate(c.last).getTime() < 60 * DAY; return `<tr><td style="font-weight:500">${esc(c.name)}</td><td>${esc(c.phone || "-")}</td><td>${esc(c.city || "-")}</td><td>${c.orders}</td><td>${money(c.spent)}</td><td>${dshort(c.first)}</td><td><span class="pill ${active ? "good" : "warn"}">${active ? "Active" : "Inactive"}</span></td></tr>`; }).join("");
}
function vCustomers() {
  return head("Customers", "Customers who have placed orders", searchField("cq", "Search customers...", S.cq)) + `
  <section class="card table-card"><div class="tscroll"><table><thead><tr><th>Name</th><th>Phone</th><th>City</th><th>Total Orders</th><th>Spent</th><th>First Order</th><th>Status</th></tr></thead><tbody id="custBody">${custRows()}</tbody></table></div></section>`;
}
function lowRows() {
  const l = lowStockList();
  if (!l.length) return `<tr><td colspan="5"><div class="empty">Every product is well stocked.</div></td></tr>`;
  return l.map((p) => `<tr><td><div class="pcell">${prodThumb(p)}<span style="font-weight:500">${esc(p.name)}</span></div></td><td>${esc(p.category || "-")}</td><td>${Number(p.stock)}</td><td><span class="pill bad">${Number(p.stock) === 0 ? "Out of Stock" : "Low Stock"}</span></td><td><button class="btn btn-sm btn-primary" data-restock="${p.id}">Restock</button></td></tr>`).join("");
}
function vLow() {
  return head("Low Stock Products", "Products that are running low on stock") + `
  <section class="card table-card"><div class="tscroll"><table><thead><tr><th>Product</th><th>Category</th><th>Current Stock</th><th>Status</th><th>Action</th></tr></thead><tbody>${lowRows()}</tbody></table></div></section>`;
}
function recentRows() {
  const q = S.rq.trim().toLowerCase();
  const l = [...S.orders].sort((a, b) => pdate(b.created_at) - pdate(a.created_at)).filter((o) => !q || (o.customer_name || "").toLowerCase().includes(q) || oid(o.id).toLowerCase().includes(q)).slice(0, 10);
  if (!l.length) return `<tr><td colspan="6"><div class="empty">No orders found.</div></td></tr>`;
  return l.map((o) => `<tr><td style="font-weight:600">${oid(o.id)}</td><td>${esc(o.customer_name)}</td><td>${dstr(o.created_at)}</td><td>${money(o.total)}</td><td><span class="pill ${pillFor(o.status)}">${statusLabel(o.status)}</span></td><td><button class="btn btn-sm btn-ghost" data-order="${o.id}">View</button></td></tr>`).join("");
}
function vRecent() {
  return head("Recent Orders", "Latest customer orders", searchField("rq", "Search customers...", S.rq)) + `
  <section class="card table-card"><div class="tscroll"><table><thead><tr><th>Order ID</th><th>Customer</th><th>Date</th><th>Total</th><th>Status</th><th>Action</th></tr></thead><tbody id="recBody">${recentRows()}</tbody></table></div></section>`;
}
function vRevenue() {
  const rev = categoryRevenue(S.orders), bars = rev.slice(0, 6).map((d, i) => ({ ...d, c: COLORS[i % COLORS.length] }));
  const counts = new Map(); S.products.forEach((p) => counts.set(catOf(p), (counts.get(catOf(p)) || 0) + 1));
  const rows = [...new Set([...rev.map((r) => r.n), ...counts.keys()])].map((n) => ({ n, v: (rev.find((r) => r.n === n) || {}).v || 0, c: counts.get(n) || 0 })).sort((a, b) => b.v - a.v);
  const st = new Map(); S.orders.forEach((o) => st.set(o.status, (st.get(o.status) || 0) + 1));
  const statusShares = shares([...st.entries()].map(([k, v]) => ({ n: statusLabel(k), v })).sort((a, b) => b.v - a.v), 6);
  return head("Revenue by Category", "Sales distribution across product categories") + `
  <div class="grid-2b">
    <section class="card card-pad">${bars.length ? chartBox("catbars", (el) => drawBars(el, bars)) : `<div class="state">No sales yet.</div>`}</section>
    <section class="card card-pad"><h2>Order Status</h2>${donutCard(statusShares)}</section>
  </div>
  <section class="card table-card"><div class="tscroll"><table><thead><tr><th>Category</th><th>Products</th><th class="r">Revenue</th></tr></thead><tbody>${rows.length ? rows.map((r) => `<tr><td style="font-weight:500">${esc(r.n)}</td><td>${r.c}</td><td class="r">${money(r.v)}</td></tr>`).join("") : `<tr><td colspan="3"><div class="empty">No categories yet.</div></td></tr>`}</tbody></table></div></section>`;
}
function vSettings() {
  return head("Settings", "Basic Zento store settings") + `
  <section class="card card-pad"><form class="form" id="setForm" style="max-width:640px" novalidate>
    <label class="full">Store name<input id="storeName" value="${esc(store.get("zento_store_name", "Zento"))}"></label>
    <label>Currency<input value="BDT / ৳" readonly></label>
    <label>Delivery charge<input id="deliveryCharge" type="number" min="0" value="${esc(store.get("zento_delivery_charge", ""))}"></label>
    <label class="full">Low stock alert at (units or fewer)<input id="lowLimit" type="number" min="0" value="${lowLimit()}"></label>
    <div class="full"><button class="btn btn-primary" type="submit">Save Settings</button></div>
  </form></section>`;
}

const ROUTES = {
  dashboard: { t: "Dashboard", i: "dashboard", v: vDashboard },
  products: { t: "Products", i: "products", v: vProducts },
  orders: { t: "Orders", i: "orders", v: vOrders },
  customers: { t: "Customers", i: "customers", v: vCustomers },
  analytics: { t: "Analytics", i: "analytics", v: vAnalytics },
  lowstock: { t: "Low Stock Alerts", i: "lowstock", v: vLow },
  recent: { t: "Recent Orders", i: "recent", v: vRecent },
  revenue: { t: "Revenue by Category", i: "revenue", v: vRevenue },
  settings: { t: "Settings", i: "settings", v: vSettings }
};
const MAIN = ["dashboard", "products", "orders", "customers", "analytics"];
const REPORTS = ["lowstock", "recent", "revenue"];
const curRoute = () => { const k = (location.hash || "#dashboard").slice(1); return ROUTES[k] ? k : "dashboard"; };

function buildNav(cur) {
  const link = (k) => `<a href="#${k}" data-go="${k}"${k === cur ? ' aria-current="page"' : ""}>${ico(ROUTES[k].i)}${ROUTES[k].t}</a>`;
  $("#nav").innerHTML = MAIN.map(link).join("") + '<div class="nav-label">Reports</div>' + REPORTS.map(link).join("") + '<div class="nav-label">Store</div>' + link("settings");
  const tabs = [["dashboard", "Home"], ["products", "Products"], ["orders", "Orders"]];
  $("#tabbar").innerHTML = tabs.map(([k, l]) => `<button data-go="${k}"${k === cur ? ' aria-current="page"' : ""}>${ico(ROUTES[k].i)}${l}</button>`).join("") + `<button id="moreBtn"${!["dashboard", "products", "orders"].includes(cur) ? ' aria-current="page"' : ""}>${ico("more")}More</button>`;
}
function renderView() {
  if ($("#adminApp").hidden) return;
  const k = curRoute();
  buildNav(k);
  specs = {};
  const view = $("#view");
  if (k === "settings") view.innerHTML = vSettings();
  else if (S.loading && !S.loaded) view.innerHTML = head(ROUTES[k].t, "Loading your store data...") + statePanel('<div class="spinner"></div>Loading...');
  else if (S.error && !S.loaded) view.innerHTML = head(ROUTES[k].t, "Something went wrong") + statePanel(`<div>${esc(S.error)}</div><button class="btn btn-primary" id="retryBtn">Try again</button>`);
  else view.innerHTML = ROUTES[k].v();
  paintCharts(); wire(k);
}
function route() {
  document.body.classList.remove("nav-open");
  renderView();
  window.scrollTo(0, 0);
}
function updateBell() { const d = $("#bellDot"); if (d) d.hidden = !lowStockList().length; }

/* ---------- interactions ---------- */
function wire() {
  const on = (sel, ev, fn) => { const e = $(sel); if (e) e.addEventListener(ev, fn); };
  on("#pq", "input", (e) => { S.pq = e.target.value; $("#prodBody").innerHTML = productRows(); });
  on("#oq", "input", (e) => { S.oq = e.target.value; $("#ordBody").innerHTML = orderRows(); });
  on("#os", "change", (e) => { S.os = e.target.value; $("#ordBody").innerHTML = orderRows(); });
  on("#cq", "input", (e) => { S.cq = e.target.value; $("#custBody").innerHTML = custRows(); });
  on("#rq", "input", (e) => { S.rq = e.target.value; $("#recBody").innerHTML = recentRows(); });
  on("#range", "change", (e) => { S.range = Number(e.target.value); renderView(); });
  on("#addProduct", "click", () => productModal());
  on("#retryBtn", "click", loadAll);
  on("#setForm", "submit", (e) => {
    e.preventDefault();
    store.set("zento_store_name", $("#storeName").value.trim());
    store.set("zento_delivery_charge", $("#deliveryCharge").value);
    store.set("zento_low_stock_threshold", String(Math.max(0, Number($("#lowLimit").value) || 0)));
    updateBell(); toast("Settings saved.");
  });
}
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-go],[data-edit],[data-del],[data-order],[data-restock],#moreBtn");
  if (!t) return;
  if (t.id === "moreBtn") { document.body.classList.add("nav-open"); return; }
  if (t.dataset.go) { if (t.tagName === "A") e.preventDefault(); if (location.hash === "#" + t.dataset.go) route(); else location.hash = t.dataset.go; return; }
  if (t.dataset.edit) return productModal(S.products.find((p) => String(p.id) === t.dataset.edit));
  if (t.dataset.restock) return productModal(S.products.find((p) => String(p.id) === t.dataset.restock), true);
  if (t.dataset.order) return orderModal(S.orders.find((o) => String(o.id) === t.dataset.order));
  if (t.dataset.del) {
    const p = S.products.find((x) => String(x.id) === t.dataset.del);
    confirmModal(`Delete "${p.name}"?`, "This action cannot be undone.", async () => {
      try {
        await api(`/api/products/${p.id}`, { method: "DELETE" });
        await reloadProducts(); renderView(); toast("Product deleted successfully.");
      } catch (err) { toast(err.message || "Failed to delete product.", "error"); }
    });
  }
});
$("#adminLoginForm").addEventListener("submit", (e) => { e.preventDefault(); adminLogin($("#adminEmail").value.trim(), $("#adminPassword").value); });
$("#logoutBtn").addEventListener("click", logout);
$("#menuBtn").addEventListener("click", () => document.body.classList.add("nav-open"));
$("#scrimNav").addEventListener("click", () => document.body.classList.remove("nav-open"));
$("#bellBtn").addEventListener("click", () => { location.hash = "lowstock"; });
$("#refreshBtn").addEventListener("click", () => { loadAll(); toast("Refreshing..."); });
$("#gsearch").addEventListener("keydown", (e) => { if (e.key === "Enter") { S.pq = e.target.value; e.target.value = ""; if (location.hash === "#products") route(); else location.hash = "products"; } });
function applyTheme(t) { if (t) document.documentElement.dataset.theme = t; }
applyTheme(store.get("zento_admin_theme"));
$("#themeBtn").addEventListener("click", () => {
  const r = document.documentElement;
  const dark = r.dataset.theme ? r.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  const next = dark ? "light" : "dark"; r.dataset.theme = next; store.set("zento_admin_theme", next); paintCharts();
});
addEventListener("hashchange", route);
let rt; addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(paintCharts, 120); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

/* ---------- modal + toast ---------- */
function closeModal() { $("#layer").innerHTML = ""; }
function showModal(html) {
  $("#layer").innerHTML = `<div class="scrim" id="scrim"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
  $("#scrim").addEventListener("mousedown", (e) => { if (e.target.id === "scrim") closeModal(); });
  $("#layer").querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", closeModal));
  const f = $("#layer input:not([type=file]),#layer select,#layer button"); if (f) f.focus();
}
let tt;
function toast(m, type = "success") {
  const old = $(".toast"); if (old) old.remove();
  const d = document.createElement("div"); d.className = "toast"; d.setAttribute("role", "status"); d.textContent = m;
  if (type === "error") d.style.background = "var(--bad)", d.style.color = "#fff";
  document.body.appendChild(d); clearTimeout(tt); tt = setTimeout(() => d.remove(), 2800);
}
function confirmModal(title, msg, ok) {
  showModal(`<div class="modal-h"><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="Close">${ico("close")}</button></div><div style="padding:6px 20px;color:var(--muted)">${esc(msg)}</div><div class="modal-f"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-danger" id="okBtn">Delete</button></div>`);
  $("#okBtn").addEventListener("click", () => { closeModal(); ok(); });
}

function orderModal(o) {
  const items = (o.items || o.order_items || []);
  const opts = STATUSES.map((s) => `<option value="${s}"${s === o.status ? " selected" : ""}>${statusLabel(s)}</option>`).join("");
  showModal(`<div class="modal-h"><h2>Order ${oid(o.id)}</h2><button class="icon-btn" data-close aria-label="Close">${ico("close")}</button></div>
  <dl class="detail">
    <dt>Customer</dt><dd>${esc(o.customer_name)}</dd><dt>Phone</dt><dd>${esc(o.phone || "-")}</dd>
    <dt>Address</dt><dd>${esc(o.address || "-")}${o.city ? ", " + esc(o.city) : ""}</dd>
    <dt>Placed</dt><dd>${dstr(o.created_at)}</dd><dt>Payment</dt><dd>${esc(String(o.payment_method || "cod").toUpperCase())}</dd>
    <dt>Items</dt><dd class="items">${items.length ? items.map((it) => `<div><span>${esc(it.name || it.product_name)} × ${it.quantity}</span><span>${money(it.subtotal)}</span></div>`).join("") : "-"}</dd>
    <dt>Subtotal</dt><dd>${money(o.subtotal)}</dd><dt>Delivery</dt><dd>${money(o.delivery_fee)}</dd><dt>Total</dt><dd><b>${money(o.total)}</b></dd>
    <dt>Status</dt><dd class="status-row"><select class="sel" id="stSel" aria-label="Order status">${opts}</select><button class="btn btn-sm btn-primary" id="stSave">Update</button>${o.status === "pending" ? '<button class="btn btn-sm btn-soft" id="stApprove">Approve</button>' : ""}</dd>
  </dl><div class="modal-f"><button class="btn btn-ghost" data-close>Close</button></div>`);
  const run = async (fn, msg) => {
    try { await fn(); await reloadOrders(); closeModal(); renderView(); toast(msg); }
    catch (e) { toast(e.message || "Request failed.", "error"); }
  };
  $("#stSave").addEventListener("click", () => run(() => api(`/api/admin/orders/${o.id}/status`, { method: "PUT", body: JSON.stringify({ status: $("#stSel").value }) }), `Order ${oid(o.id)} updated.`));
  const ap = $("#stApprove"); if (ap) ap.addEventListener("click", () => run(() => api(`/api/admin/orders/${o.id}/approve`, { method: "POST" }), `Order ${oid(o.id)} approved.`));
}

async function uploadProductImage(file) {
  if (!supabase) throw new Error("Supabase client is not available.");
  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const name = `product-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await supabase.storage.from("product-images").upload(name, file, { upsert: false, contentType: file.type });
  if (error) throw error;
  const { data } = supabase.storage.from("product-images").getPublicUrl(name);
  return data?.publicUrl || "";
}
function productModal(p, focusStock = false) {
  const edit = !!p; let file = null;
  const cats = [...new Set(S.products.map((x) => x.category).filter(Boolean))];
  showModal(`<div class="modal-h"><h2>${edit ? "Edit Product" : "Add New Product"}</h2><button class="icon-btn" data-close aria-label="Close">${ico("close")}</button></div>
  <form id="pf" novalidate><div class="modal-b">
    <label class="upload" id="up">${ico("camera")}<span>Click to upload image<br>(JPG, PNG, WebP)</span><input id="pimg" type="file" accept="image/png,image/jpeg,image/webp" aria-label="Product image"></label>
    <div class="form">
      <label>Product Name<input id="pn" placeholder="Enter product name" value="${p ? esc(p.name) : ""}"></label>
      <label>Category<input id="pc" list="catList" placeholder="Select or type category" value="${p ? esc(p.category || "") : ""}"><datalist id="catList">${cats.map((c) => `<option value="${esc(c)}">`).join("")}</datalist></label>
      <label>Price (BDT ৳)<input id="pp" type="number" min="0" step="0.01" placeholder="Enter price" value="${p ? p.price : ""}"></label>
      <label>Stock<input id="ps" type="number" min="0" step="1" placeholder="Enter stock quantity" value="${p ? p.stock : ""}"></label>
      <label class="full">Description<textarea id="pd" placeholder="Enter product description...">${p ? esc(p.description || "") : ""}</textarea></label>
    </div></div>
  <div class="modal-f"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button type="submit" class="btn btn-primary" id="psave">${edit ? "Save Changes" : "Save Product"}</button></div></form>`);
  if (p && p.image_url) $("#up").insertAdjacentHTML("beforeend", `<img src="${esc(p.image_url)}" alt="Current image">`);
  if (focusStock) $("#ps").focus();
  $("#pimg").addEventListener("change", (e) => {
    file = e.target.files[0]; if (!file) return;
    const r = new FileReader();
    r.onload = () => { const o = $("#up img"); if (o) o.remove(); $("#up").insertAdjacentHTML("beforeend", `<img src="${r.result}" alt="Preview">`); };
    r.readAsDataURL(file);
  });
  $("#pf").addEventListener("submit", async (e) => {
    e.preventDefault();
    const n = $("#pn"), pr = $("#pp"), s = $("#ps");
    const bad = [[n, !n.value.trim()], [pr, pr.value === "" || +pr.value < 0], [s, s.value === "" || +s.value < 0]];
    bad.forEach(([el, b]) => el.classList.toggle("err", b));
    if (bad.some(([, b]) => b)) return toast("Fill in the highlighted fields.", "error");
    const btn = $("#psave"); btn.disabled = true; btn.textContent = edit ? "Saving..." : "Creating...";
    try {
      let image_url = p ? p.image_url || "" : "";
      if (file) image_url = await uploadProductImage(file);
      const payload = { name: n.value.trim(), description: $("#pd").value.trim(), price: Number(pr.value), image_url, category: $("#pc").value.trim(), stock: Math.round(Number(s.value)) };
      if (edit) await api(`/api/products/${p.id}`, { method: "PUT", body: JSON.stringify(payload) });
      else await api("/api/products", { method: "POST", body: JSON.stringify(payload) });
      await reloadProducts(); closeModal(); renderView();
      toast(edit ? "Product updated successfully." : "Product created successfully.");
    } catch (err) {
      btn.disabled = false; btn.textContent = edit ? "Save Changes" : "Save Product";
      toast(err.message || "Failed to save product.", "error");
    }
  });
}

checkSession();
