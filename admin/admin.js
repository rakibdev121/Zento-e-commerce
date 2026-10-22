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
  chat: '<path d="M21 12a8 8 0 01-11.6 7.1L4 20l1-4.6A8 8 0 1121 12z"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v8h14v-8M12 8v12M12 8c-1.5-4-6-4-5 0 .6 1.6 3 1.2 5 0zM12 8c1.5-4 6-4 5 0-.6 1.6-3 1.2-5 0z"/>',
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
  /* Product create / edit / delete need the server's admin API key */
  const isProductWrite = path.startsWith("/api/products") && options.method && options.method !== "GET";
  if (isProductWrite) {
    const key = store.get("zento_admin_api_key", "");
    if (!key) throw new Error("Admin API key missing. Open Settings, enter the ADMIN_API_TOKEN from Render and save.");
    if (key) headers["X-Admin-Token"] = key;
  }
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    if (isProductWrite && res.status === 401) store.set("zento_admin_api_key", "");
    const err = new Error(res.status === 401 && isProductWrite ? "Wrong Admin API key. Open Settings and enter the correct ADMIN_API_TOKEN from Render." : (data?.message || data?.error || `Request failed (${res.status})`));
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
  const p = await api("/api/products?all=1");
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
const pillFor = (s) => ({ delivered: "good", approved: "info", processing: "info", shipped: "violet", out_for_delivery: "violet", pending: "warn", cancelled: "bad", returned: "bad" }[s] || "info");
const STATUSES = ["pending", "approved", "processing", "shipped", "out_for_delivery", "delivered", "cancelled", "returned"];

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
    <label>Delivery charge<input value="Dhaka division ৳70 · Outside Dhaka ৳130" disabled></label>
    <label class="full">Admin API key (needed to add, edit and delete products)<input id="apiKey" type="password" autocomplete="off" placeholder="ADMIN_API_TOKEN from Render" value="${esc(store.get("zento_admin_api_key", ""))}"></label>
    <label class="full">Low stock alert at (units or fewer)<input id="lowLimit" type="number" min="0" value="${lowLimit()}"></label>
    <div class="full"><button class="btn btn-primary" type="submit">Save Settings</button></div>
  </form></section>
  <section class="card card-pad golive" style="margin-top:16px;max-width:704px">
    <h2>Go live: clear test data</h2>
    <p class="sub" style="margin:6px 0 12px">Removes all test orders, wallet history, withdrawals, reviews, chats and the activity log, so you start with real sales. Products, customers, sellers, coupons and admin accounts stay. This cannot be undone.</p>
    <button class="btn btn-danger" id="resetOpen" type="button">Clear test data…</button>
  </section>`;
}

/* ---------- ZENTO MARKETPLACE (sellers, withdrawals, commission, reviews) ---------- */
Object.assign(I, {
  sellers: '<path d="M3 9l1.5-5h15L21 9"/><path d="M4 9v11h16V9"/><path d="M9 20v-6h6v6"/>',
  wallet: '<rect x="3" y="6" width="18" height="14" rx="2.5"/><path d="M3 10h18M16 15h2"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>'
});
const MP = { sellerFilter: "pending", wdFilter: "pending", appFilter: "pending" };
const mpPill = (s) => ({ approved: "good", pending: "warn", rejected: "bad", suspended: "bad" }[s] || "info");

function mpAsk(title, label, okText, cb) {
  showModal(`<div class="modal-h"><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="Close">${ico("close")}</button></div>
  <div class="modal-b"><div class="form"><label class="full">${esc(label)}<textarea id="mpNote" maxlength="300"></textarea></label></div></div>
  <div class="modal-f"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="mpOk">${esc(okText)}</button></div>`);
  $("#mpOk").addEventListener("click", () => { const v = $("#mpNote").value.trim(); closeModal(); cb(v); });
}

function vSellers() {
  const opts = [["pending", "Pending"], ["approved", "Approved"], ["rejected", "Rejected"], ["suspended", "Suspended"], ["", "All"]]
    .map(([v, l]) => `<option value="${v}"${v === MP.sellerFilter ? " selected" : ""}>${l}</option>`).join("");
  return head("Sellers", "Approve applications, give the Verified badge, suspend stores", `<label class="field"><select id="mpSellerFilter" aria-label="Filter sellers">${opts}</select></label>`) + `
  <section class="card table-card"><div class="tscroll"><table><thead><tr><th>Store</th><th>Owner</th><th>Status</th><th>Products</th><th>Balance</th><th>Actions</th></tr></thead>
  <tbody id="mpBody"><tr><td colspan="6"><div class="empty">Loading...</div></td></tr></tbody></table></div></section>`;
}
async function mpLoadSellers() {
  const body = $("#mpBody"); if (!body) return;
  try {
    const d = await api("/api/admin/sellers" + (MP.sellerFilter ? `?status=${MP.sellerFilter}` : ""));
    if (!$("#mpBody")) return;
    body.innerHTML = d.sellers.length ? d.sellers.map((s) => {
      const acts = [];
      if (s.status !== "approved") acts.push(`<button class="btn btn-sm btn-primary" data-sact="approve" data-sid="${s.id}">Approve</button>`);
      if (s.status === "pending") acts.push(`<button class="btn btn-sm btn-ghost" data-sact="reject" data-sid="${s.id}">Reject</button>`);
      if (s.status === "approved") {
        acts.push(`<button class="btn btn-sm btn-ghost" data-sact="${s.is_verified ? "unverify" : "verify"}" data-sid="${s.id}">${s.is_verified ? "Remove badge" : "✔ Verify"}</button>`);
        acts.push(`<button class="btn btn-sm btn-ghost" data-sact="suspend" data-sid="${s.id}">Suspend</button>`);
      }
      return `<tr><td><b>${esc(s.store_name)}</b>${s.is_verified ? ' <span class="pill info">✔ Verified</span>' : ""}<br><small>${esc(s.phone)} · ${esc(s.city || "")}</small>
        ${s.description ? `<br><small>${esc(s.description).slice(0, 120)}</small>` : ""}${s.payout_method ? `<br><small>Payout: ${esc(s.payout_method)} ${esc(s.payout_account)}</small>` : ""}
        ${s.admin_note ? `<br><small>Note: ${esc(s.admin_note)}</small>` : ""}</td>
        <td>${esc(s.owner_name)}<br><small>${esc(s.owner_email)}</small></td>
        <td><span class="pill ${mpPill(s.status)}">${esc(s.status)}</span><br><small>${dshort(s.created_at)}</small></td>
        <td>${s.product_count}</td><td>${money(s.balance)}</td><td style="white-space:nowrap">${acts.join(" ")}</td></tr>`;
    }).join("") : `<tr><td colspan="6"><div class="empty">No sellers found.</div></td></tr>`;
  } catch (e) { body.innerHTML = `<tr><td colspan="6"><div class="empty">${esc(e.message)}</div></td></tr>`; }
}
async function mpSellerAction(id, act) {
  const put = async (path, payload, msg) => { try { const r = await api(path, { method: "PUT", body: JSON.stringify(payload) }); toast(r.message || msg); mpLoadSellers(); } catch (e) { toast(e.message, "error"); } };
  if (act === "approve") return put(`/api/admin/sellers/${id}/status`, { status: "approved" }, "Seller approved");
  if (act === "verify" || act === "unverify") return put(`/api/admin/sellers/${id}/verify`, { verified: act === "verify" }, "Updated");
  if (act === "reject") return mpAsk("Reject application", "Reason (shown to the seller)", "Reject", (note) => put(`/api/admin/sellers/${id}/status`, { status: "rejected", note }, "Rejected"));
  if (act === "suspend") return mpAsk("Suspend seller", "Reason (shown to the seller). Their products are hidden from the store.", "Suspend", (note) => put(`/api/admin/sellers/${id}/status`, { status: "suspended", note }, "Suspended"));
}

/* ---------- Seller applications: admin approves, system creates the seller login ---------- */
function vApplications() {
  const opts = [["pending", "Pending"], ["approved", "Approved"], ["rejected", "Rejected"], ["", "All"]]
    .map(([v, l]) => `<option value="${v}"${v === MP.appFilter ? " selected" : ""}>${l}</option>`).join("");
  return head("Seller Applications", "Approve to create the seller's login ID and password", `<label class="field"><select id="mpAppFilter" aria-label="Filter applications">${opts}</select></label>`) + `
  <section class="card table-card"><div class="tscroll"><table><thead><tr><th>Store</th><th>Applicant</th><th>Status</th><th>Actions</th></tr></thead>
  <tbody id="mpBody"><tr><td colspan="4"><div class="empty">Loading...</div></td></tr></tbody></table></div></section>`;
}
async function mpLoadApps() {
  const body = $("#mpBody"); if (!body) return;
  try {
    const d = await api("/api/admin/seller-applications" + (MP.appFilter ? `?status=${MP.appFilter}` : ""));
    if (!$("#mpBody")) return;
    body.innerHTML = d.applications.length ? d.applications.map((a) => {
      const acts = a.status === "pending"
        ? `<button class="btn btn-sm btn-primary" data-aact="approve" data-aid="${a.id}" data-astore="${esc(a.store_name)}">Approve</button> <button class="btn btn-sm btn-ghost" data-aact="reject" data-aid="${a.id}">Reject</button>`
        : "";
      return `<tr><td><b>${esc(a.store_name)}</b><br><small>${esc(a.city || "")}${a.address ? " · " + esc(a.address) : ""}</small>
        ${a.description ? `<br><small>${esc(a.description).slice(0, 140)}</small>` : ""}${a.id_number ? `<br><small>NID/Licence: ${esc(a.id_number)}</small>` : ""}
        ${a.admin_note ? `<br><small>Note: ${esc(a.admin_note)}</small>` : ""}</td>
        <td>${esc(a.owner_name)}<br><small>${esc(a.email)}<br>${esc(a.phone)}</small></td>
        <td><span class="pill ${mpPill(a.status)}">${esc(a.status)}</span><br><small>${dshort(a.created_at)}</small></td>
        <td style="white-space:nowrap">${acts}</td></tr>`;
    }).join("") : `<tr><td colspan="4"><div class="empty">No applications found.</div></td></tr>`;
  } catch (e) { body.innerHTML = `<tr><td colspan="4"><div class="empty">${esc(e.message)}</div></td></tr>`; }
}
function mpCredentials(r) {
  const msg = `Zento Seller Center\nLogin ID: ${r.login_id}\nPassword: ${r.password}\nLogin at: ${r.login_url || "(Seller Center address)"}\nPlease change your password after the first login.`;
  showModal(`<div class="modal-h"><h2>Seller approved</h2><button class="icon-btn" data-close aria-label="Close">${ico("close")}</button></div>
  <div class="modal-b"><p>Send these details to <b>${esc(r.store_name)}</b> (${esc(r.phone)}). The password is shown only now, so copy it before closing.</p>
  <textarea id="mpCred" readonly rows="5" style="width:100%">${esc(msg)}</textarea></div>
  <div class="modal-f"><button class="btn btn-ghost" data-close>Close</button><button class="btn btn-primary" id="mpCopy">Copy</button></div>`);
  $("#mpCopy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(msg); toast("Copied"); } catch { $("#mpCred").select(); document.execCommand("copy"); toast("Copied"); }
  });
}
function mpAppAction(id, act, store) {
  if (act === "reject") return mpAsk("Reject application", "Reason (optional)", "Reject", async (note) => {
    try { const r = await api(`/api/admin/seller-applications/${id}/reject`, { method: "POST", body: JSON.stringify({ note }) }); toast(r.message); mpLoadApps(); } catch (e) { toast(e.message, "error"); }
  });
  if (act === "approve") {
    showModal(`<div class="modal-h"><h2>Approve ${esc(store)}</h2><button class="icon-btn" data-close aria-label="Close">${ico("close")}</button></div>
    <div class="modal-b"><div class="form"><label class="full">Password for the seller (leave empty to auto-generate)<input id="mpPw" type="text" minlength="8" maxlength="60" autocomplete="off"></label></div></div>
    <div class="modal-f"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="mpAppOk">Approve and create login</button></div>`);
    $("#mpAppOk").addEventListener("click", async () => {
      const pw = $("#mpPw").value.trim(); closeModal();
      try {
        const r = await api(`/api/admin/seller-applications/${id}/approve`, { method: "POST", body: JSON.stringify(pw ? { password: pw } : {}) });
        mpCredentials(r); mpLoadApps();
      } catch (e) { toast(e.message, "error"); }
    });
  }
}

/* ---------- Coupons (admin coupons are paid by Zento; seller coupons by the seller) ---------- */
const cpDate = (v) => { if (!v) return ""; const d = new Date(v); return isNaN(d) ? "" : d.toLocaleDateString("en-CA", { timeZone: "Asia/Dhaka" }); };
const cpValue = (c) => c.discount_type === "percent" ? `${Number(c.value)}%${c.max_discount != null ? ` (max ${money(c.max_discount)})` : ""}` : money(c.value);
const cpState = (c) => {
  const now = Date.now();
  if (!c.active) return ["Off", "bad"];
  if (c.expires_at && new Date(c.expires_at) < now) return ["Expired", "bad"];
  if (c.starts_at && new Date(c.starts_at) > now) return ["Scheduled", "warn"];
  if (c.usage_limit != null && c.used_count >= c.usage_limit) return ["Fully used", "warn"];
  return ["Live", "good"];
};
function vCoupons() {
  return head("Coupons", "Admin coupons are paid by Zento. Sellers still get their full price.", `<button class="btn btn-primary" id="cpNew">+ New coupon</button>`) + `
  <section class="card table-card"><div class="tscroll"><table><thead><tr><th>Code</th><th>Discount</th><th>Paid by</th><th>Used</th><th>Discount given</th><th>Status</th><th>Actions</th></tr></thead>
  <tbody id="mpBody"><tr><td colspan="7"><div class="empty">Loading...</div></td></tr></tbody></table></div></section>`;
}
async function mpLoadCoupons() {
  const body = $("#mpBody"); if (!body) return;
  try {
    const d = await api("/api/admin/coupons");
    if (!$("#mpBody")) return;
    MP.coupons = d.coupons;
    body.innerHTML = d.coupons.length ? d.coupons.map((c) => {
      const [st, cls] = cpState(c);
      const mine = c.seller_id == null;
      return `<tr><td><b>${esc(c.code)}</b>${Number(c.min_order) > 0 ? `<br><small>Min order ${money(c.min_order)}</small>` : ""}
        <br><small>${c.starts_at ? "From " + cpDate(c.starts_at) + " " : ""}${c.expires_at ? "Until " + cpDate(c.expires_at) : "No expiry"}</small></td>
        <td>${esc(cpValue(c))}</td>
        <td>${mine ? '<span class="pill info">Zento</span>' : `<span class="pill warn">Seller</span><br><small>${esc(c.store_name || "")}</small>`}</td>
        <td>${c.used_count}${c.usage_limit != null ? " / " + c.usage_limit : ""}<br><small>${c.per_user_limit} per customer</small></td>
        <td>${money(c.discount_given)}</td>
        <td><span class="pill ${cls}">${st}</span></td>
        <td style="white-space:nowrap">${mine ? `<button class="btn btn-sm btn-ghost" data-cact="edit" data-cid="${c.id}">Edit</button> ` : ""}
          <button class="btn btn-sm btn-ghost" data-cact="${c.active ? "off" : "on"}" data-cid="${c.id}">${c.active ? "Turn off" : "Turn on"}</button>
          <button class="btn btn-sm btn-ghost" data-cact="del" data-cid="${c.id}">Delete</button></td></tr>`;
    }).join("") : `<tr><td colspan="7"><div class="empty">No coupons yet. Tap "+ New coupon".</div></td></tr>`;
  } catch (e) { body.innerHTML = `<tr><td colspan="7"><div class="empty">${esc(e.message)}</div></td></tr>`; }
}
function mpCouponForm(c) {
  const v = c || { discount_type: "percent", per_user_limit: 1, active: true };
  showModal(`<div class="modal-h"><h2>${c ? "Edit coupon" : "New coupon (paid by Zento)"}</h2><button class="icon-btn" data-close aria-label="Close">${ico("close")}</button></div>
  <div class="modal-b"><div class="form">
    <label class="full">Coupon code<input id="cpCode" maxlength="40" value="${esc(v.code || "")}" placeholder="EID20" style="text-transform:uppercase"></label>
    <label>Type<select id="cpType"><option value="percent"${v.discount_type === "percent" ? " selected" : ""}>Percent (%)</option><option value="fixed"${v.discount_type === "fixed" ? " selected" : ""}>Fixed amount (BDT)</option></select></label>
    <label>Value<input id="cpValue" type="number" min="0" step="0.01" value="${v.value ?? ""}"></label>
    <label>Max discount (BDT, percent only)<input id="cpMax" type="number" min="0" step="0.01" value="${v.max_discount ?? ""}" placeholder="optional"></label>
    <label>Minimum order (BDT)<input id="cpMin" type="number" min="0" step="0.01" value="${Number(v.min_order) || ""}" placeholder="0"></label>
    <label>Total uses allowed<input id="cpLimit" type="number" min="0" step="1" value="${v.usage_limit ?? ""}" placeholder="unlimited"></label>
    <label>Uses per customer<input id="cpPer" type="number" min="1" step="1" value="${v.per_user_limit ?? 1}"></label>
    <label>Starts on<input id="cpStart" type="date" value="${cpDate(v.starts_at)}"></label>
    <label>Ends on<input id="cpEnd" type="date" value="${cpDate(v.expires_at)}"></label>
  </div><p id="cpErr" class="muted" style="color:#c62839;min-height:18px"></p></div>
  <div class="modal-f"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="cpSave">${c ? "Save" : "Create coupon"}</button></div>`);
  $("#cpSave").addEventListener("click", async () => {
    const body = { code: $("#cpCode").value, discount_type: $("#cpType").value, value: $("#cpValue").value, max_discount: $("#cpMax").value,
      min_order: $("#cpMin").value, usage_limit: $("#cpLimit").value, per_user_limit: $("#cpPer").value,
      starts_at: $("#cpStart").value, expires_at: $("#cpEnd").value, active: c ? c.active : true };
    try {
      const r = await api(c ? `/api/admin/coupons/${c.id}` : "/api/admin/coupons", { method: c ? "PUT" : "POST", body: JSON.stringify(body) });
      closeModal(); toast(r.message); mpLoadCoupons();
    } catch (e) { $("#cpErr").textContent = e.message; }
  });
}
async function mpCouponAction(id, act) {
  const c = (MP.coupons || []).find((x) => String(x.id) === String(id));
  try {
    if (act === "edit") return mpCouponForm(c);
    if (act === "on" || act === "off") { const r = await api(`/api/admin/coupons/${id}`, { method: "PUT", body: JSON.stringify({ active: act === "on" }) }); toast(r.message); }
    if (act === "del") { if (!confirm("Delete this coupon?")) return; const r = await api(`/api/admin/coupons/${id}`, { method: "DELETE" }); toast(r.message); }
    mpLoadCoupons();
  } catch (e) { toast(e.message, "error"); }
}

/* ---------- Offers (mystery box, flash sale, quiz, events, coupon drops ...) ---------- */
const OF_KINDS = {
  mystery_box: ["🎁", "Mystery Box", "A box drops on the customer's screen at a random moment. They tap to open it and win a random prize."],
  spin_wheel: ["🎡", "Lucky Spin Wheel", "Customers spin a wheel for a random prize (same prize list as a mystery box)."],
  scratch_card: ["🎟️", "Scratch Card", "Customers scratch a card to reveal a random prize."],
  quiz: ["🧠", "Quiz", "A question with answer options. The right answer wins the prize."],
  flash_sale: ["⚡", "Flash Sale", "Time limited sale price on chosen products, with a countdown and an optional unit limit."],
  event: ["📣", "Event banner", "Festival or campaign message that slides across the top of the website."],
  coupon_drop: ["🏷️", "Coupon Drop", "A coupon any customer can claim. Limit it to the first N customers."],
  free_shipping: ["🚚", "Free Shipping Day", "Customers claim a free delivery coupon."],
  spend_save: ["💸", "Spend and Save", "Spend X taka, save Y. Claimable coupon with a minimum order."],
  welcome: ["👋", "Welcome Gift", "A gift for customers who have not placed any order yet."],
  free_gift: ["🎀", "Free Gift Offer", "Give a free product when the cart reaches a minimum amount."],
  lucky_draw: ["🏆", "Lucky Draw", "Customers enter, and you draw one random winner from the panel."]
};
const OF_PRIZE = { percent: "Percent off", fixed: "Taka off", free_product: "Free product", free_shipping: "Free delivery", nothing: "Nothing (better luck)" };
const OF_PRIZE_KINDS = ["mystery_box", "spin_wheel", "scratch_card", "quiz", "coupon_drop", "spend_save", "welcome", "free_gift", "lucky_draw"];
const OF_MULTI = ["mystery_box", "spin_wheel", "scratch_card", "quiz"];
const ofLocal = (v) => { if (!v) return ""; const d = new Date(v); return isNaN(d) ? "" : d.toLocaleString("sv-SE", { timeZone: "Asia/Dhaka" }).replace(" ", "T").slice(0, 16); };
const ofWhen = (o) => `${o.starts_at ? ofLocal(o.starts_at).replace("T", " ") : "Now"} → ${o.ends_at ? ofLocal(o.ends_at).replace("T", " ") : "No end"}`;
let OF = { list: [], draft: null };

function vOffers() {
  return head("Offers", "Mystery boxes, flash sales, quizzes, events and more. Rewards are paid out as personal coupons, paid by Zento.", `<button class="btn btn-primary" id="ofNew">+ New offer</button>`) + `
  <section class="card table-card"><div class="tscroll"><table><thead><tr><th>Offer</th><th>Owner</th><th>When (Dhaka)</th><th>Results</th><th>Status</th><th>Actions</th></tr></thead>
  <tbody id="ofBody"><tr><td colspan="6"><div class="empty">Loading...</div></td></tr></tbody></table></div></section>`;
}
async function mpLoadOffers() {
  const body = $("#ofBody"); if (!body) return;
  try {
    const d = await api("/api/admin/offers");
    if (!$("#ofBody")) return;
    OF.list = d.offers;
    body.innerHTML = d.offers.length ? d.offers.map((o) => {
      const k = OF_KINDS[o.kind] || ["🎯", o.kind_label, ""];
      const st = o.live ? ["Live", "good"] : !o.active ? ["Off", "bad"] : o.ends_at && new Date(o.ends_at) < Date.now() ? ["Ended", "bad"] : o.starts_at && new Date(o.starts_at) > Date.now() ? ["Scheduled", "warn"] : ["Full", "warn"];
      const s = o.stats || {};
      const mine = o.seller_id == null;
      return `<tr><td><b>${k[0]} ${esc(o.title)}</b><br><small>${esc(k[1])}${o.subtitle ? " · " + esc(o.subtitle) : ""}</small></td>
        <td>${mine ? '<span class="pill info">Zento</span>' : `<span class="pill warn">Seller</span><br><small>${esc(o.store_name || "")}</small>`}</td>
        <td><small>${esc(ofWhen(o))}</small></td>
        <td>${s.plays || 0} played · ${s.wins || 0} won<br><small>${s.redeemed || 0} used · ${money(s.discount_given || 0)} given${o.total_limit != null ? ` · ${o.claimed_count}/${o.total_limit}` : ""}</small></td>
        <td><span class="pill ${st[1]}">${st[0]}</span></td>
        <td style="white-space:nowrap">${mine ? `<button class="btn btn-sm btn-ghost" data-oact="edit" data-oid="${o.id}">Edit</button> ` : ""}
          <button class="btn btn-sm btn-ghost" data-oact="${o.active ? "off" : "on"}" data-oid="${o.id}">${o.active ? "Turn off" : "Turn on"}</button>
          <button class="btn btn-sm btn-ghost" data-oact="entries" data-oid="${o.id}">Entries</button>
          ${o.kind === "lucky_draw" ? `<button class="btn btn-sm btn-primary" data-oact="draw" data-oid="${o.id}">Draw winner</button> ` : ""}
          <button class="btn btn-sm btn-ghost" data-oact="del" data-oid="${o.id}">Delete</button></td></tr>`;
    }).join("") : `<tr><td colspan="6"><div class="empty">No offers yet. Tap "+ New offer" and pick a type.</div></td></tr>`;
  } catch (e) { body.innerHTML = `<tr><td colspan="6"><div class="empty">${esc(e.message)}</div></td></tr>`; }
}
function ofPickKind() {
  showModal(`<div class="modal-h"><h2>Choose an offer type</h2><button class="icon-btn" data-close aria-label="Close">${ico("close")}</button></div>
  <div class="modal-b"><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px">
  ${Object.entries(OF_KINDS).map(([k, v]) => `<button class="card" data-okind="${k}" style="text-align:left;padding:12px;cursor:pointer;border:1px solid var(--line)"><div style="font-size:24px">${v[0]}</div><b>${v[1]}</b><div class="muted" style="font-size:12px;margin-top:4px">${v[2]}</div></button>`).join("")}
  </div></div>`);
}
function ofPrizeRow(p = {}, i = 0) {
  const prods = (S.products || []).filter((x) => x.seller_id == null);
  return `<div class="card" data-prow style="padding:10px;margin-bottom:8px"><div class="form">
    <label>Prize name<input data-f="label" maxlength="60" value="${esc(p.label || "")}" placeholder="70% OFF"></label>
    <label>Type<select data-f="prize_type">${Object.entries(OF_PRIZE).map(([k, v]) => `<option value="${k}"${p.prize_type === k ? " selected" : ""}>${v}</option>`).join("")}</select></label>
    <label>Value (% or ৳)<input data-f="value" type="number" min="0" step="0.01" value="${p.value ?? ""}"></label>
    <label>Max discount ৳ (percent)<input data-f="max_discount" type="number" min="0" step="0.01" value="${p.max_discount ?? ""}" placeholder="optional"></label>
    <label>Minimum order ৳<input data-f="min_order" type="number" min="0" step="0.01" value="${Number(p.min_order) || ""}" placeholder="0"></label>
    <label>Free product<select data-f="product_id"><option value="">-</option>${prods.map((x) => `<option value="${x.id}"${String(p.product_id) === String(x.id) ? " selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label>
    <label>Chance (weight)<input data-f="weight" type="number" min="0" value="${p.weight ?? 10}"></label>
    <label>Stock (how many to give)<input data-f="stock" type="number" min="0" value="${p.stock ?? ""}" placeholder="unlimited"></label>
    <label>Valid for (days)<input data-f="valid_days" type="number" min="1" value="${p.valid_days ?? 7}"></label>
    <label style="justify-content:flex-end"><button class="btn btn-sm btn-ghost" type="button" data-prm>Remove prize</button></label>
    <input type="hidden" data-f="id" value="${p.id ?? ""}"></div></div>`;
}
function ofSaleRow(p = {}) {
  const prods = (S.products || []).filter((x) => x.seller_id == null);
  return `<div class="card" data-srow style="padding:10px;margin-bottom:8px"><div class="form">
    <label class="full">Product<select data-f="product_id">${prods.map((x) => `<option value="${x.id}"${String(p.product_id) === String(x.id) ? " selected" : ""}>${esc(x.name)} (${money(x.price)})</option>`).join("")}</select></label>
    <label>Discount %<input data-f="discount_percent" type="number" min="1" max="99" step="0.5" value="${p.discount_percent ?? 20}"></label>
    <label>Units at sale price<input data-f="qty_limit" type="number" min="1" value="${p.qty_limit ?? ""}" placeholder="unlimited"></label>
    <label class="full" style="align-items:flex-end"><button class="btn btn-sm btn-ghost" type="button" data-srm>Remove product</button></label></div></div>`;
}
function ofForm(kind, o) {
  const v = o || { kind, active: true, show_banner: true, per_user_limit: 1, color: "#00e5c2", config: {}, prizes: [], products: [] };
  const cfg = v.config || {}, k = OF_KINDS[kind];
  const hasPrizes = OF_PRIZE_KINDS.includes(kind);
  const prizes = v.prizes && v.prizes.length ? v.prizes : (hasPrizes ? [{ prize_type: "percent", value: 10, weight: 10 }] : []);
  showModal(`<div class="modal-h"><h2>${o ? "Edit" : "New"} ${k[0]} ${k[1]}</h2><button class="icon-btn" data-close aria-label="Close">${ico("close")}</button></div>
  <div class="modal-b" style="max-height:72vh;overflow:auto"><p class="muted" style="margin-bottom:10px">${k[2]}</p><div class="form">
    <label class="full">Title<input id="ofTitle" maxlength="80" value="${esc(v.title || "")}" placeholder="Eid Mystery Box"></label>
    <label class="full">Short line (optional)<input id="ofSub" maxlength="120" value="${esc(v.subtitle || "")}" placeholder="Win free products and up to 70% off"></label>
    <label class="full">Details (optional)<textarea id="ofDesc" maxlength="600">${esc(v.description || "")}</textarea></label>
    <label>Starts (Dhaka time)<input id="ofStart" type="datetime-local" value="${ofLocal(v.starts_at)}"></label>
    <label>Ends (Dhaka time)<input id="ofEnd" type="datetime-local" value="${ofLocal(v.ends_at)}"></label>
    <label>Colour<input id="ofColor" type="color" value="${esc(v.color || "#00e5c2")}"></label>
    <label>Button text<input id="ofCta" maxlength="24" value="${esc(v.cta_label || "")}" placeholder="Play now"></label>
    ${kind !== "flash_sale" && kind !== "event" ? `<label>Tries per customer<input id="ofPer" type="number" min="1" value="${v.per_user_limit ?? 1}"></label>
    <label>Total available (first N customers)<input id="ofTotal" type="number" min="1" value="${v.total_limit ?? ""}" placeholder="unlimited"></label>` : ""}
    <label>Image link (optional)<input id="ofImg" value="${esc(v.image_url || "")}" placeholder="https://..."></label>
    <label style="flex-direction:row;align-items:center;gap:8px"><input id="ofBanner" type="checkbox" style="width:auto"${v.show_banner !== false ? " checked" : ""}> Slide this offer across the top of the website</label>
    ${kind === "mystery_box" ? `<label>Box appears after (min seconds)<input id="ofDmin" type="number" min="3" value="${cfg.delay_min ?? 8}"></label><label>Box appears before (max seconds)<input id="ofDmax" type="number" min="3" value="${cfg.delay_max ?? 25}"></label>` : ""}
    ${kind === "spend_save" || kind === "free_gift" || kind === "free_shipping" ? `<label>Minimum order ৳<input id="ofMin" type="number" min="0" value="${cfg.min_order ?? ""}"></label>` : ""}
    ${kind === "free_shipping" ? `<label>Coupon valid (days)<input id="ofVd" type="number" min="1" value="${cfg.valid_days ?? 3}"></label>` : ""}
    ${kind === "quiz" ? `<label class="full">Question<input id="ofQ" maxlength="300" value="${esc(cfg.question || "")}"></label>
      <label class="full">Answer options (one per line, 2 to 6)<textarea id="ofOpts">${esc((cfg.options || []).join("\n"))}</textarea></label>
      <label>Correct answer number (1 = first line)<input id="ofAns" type="number" min="1" value="${(cfg.answer_index ?? 0) + 1}"></label>
      <label>Message for a wrong answer<input id="ofWrong" maxlength="160" value="${esc(cfg.wrong_message || "")}"></label>` : ""}
  </div>
  ${hasPrizes ? `<h3 style="margin:16px 0 4px">Prizes</h3><p class="muted" style="margin-bottom:8px">${OF_MULTI.includes(kind) ? "One prize is picked at random using the chance (weight). A bigger weight means it is picked more often. Add a \"Nothing\" prize to make wins rare." : "The first prize is used."}</p><div id="ofPrizes">${prizes.map((p, i) => ofPrizeRow(p, i)).join("")}</div>${OF_MULTI.includes(kind) ? `<button class="btn btn-sm btn-ghost" type="button" id="ofAddPrize">+ Add prize</button>` : ""}` : ""}
  ${kind === "flash_sale" ? `<h3 style="margin:16px 0 4px">Products on sale</h3><p class="muted" style="margin-bottom:8px">Zento's own products only. Sellers run sales on their own products from the Seller Center.</p><div id="ofSale">${(v.products && v.products.length ? v.products : [{}]).map((p) => ofSaleRow(p)).join("")}</div><button class="btn btn-sm btn-ghost" type="button" id="ofAddSale">+ Add product</button>` : ""}
  <p id="ofErr" style="color:#c62839;min-height:18px;margin-top:8px"></p></div>
  <div class="modal-f"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="ofSave">${o ? "Save" : "Create offer"}</button></div>`);
  OF.draft = { kind, id: o ? o.id : null };
  const add = (sel, fn) => { const b = $(sel); if (b) b.addEventListener("click", () => $(sel === "#ofAddPrize" ? "#ofPrizes" : "#ofSale").insertAdjacentHTML("beforeend", fn())); };
  add("#ofAddPrize", () => ofPrizeRow({ prize_type: "percent", value: 10, weight: 10 })); add("#ofAddSale", () => ofSaleRow({}));
  $("#ofSave").addEventListener("click", ofSave);
}
function ofRows(sel, rowAttr) {
  return [...document.querySelectorAll(`${sel} [${rowAttr}]`)].map((r) => { const o = {}; r.querySelectorAll("[data-f]").forEach((el) => { o[el.dataset.f] = el.value; }); return o; });
}
async function ofSave() {
  const { kind, id } = OF.draft, g = (s) => { const e = $(s); return e ? e.value : undefined; };
  const body = { kind, title: g("#ofTitle"), subtitle: g("#ofSub"), description: g("#ofDesc"), starts_at: g("#ofStart"), ends_at: g("#ofEnd"),
    color: g("#ofColor"), cta_label: g("#ofCta"), image_url: g("#ofImg"), per_user_limit: g("#ofPer"), total_limit: g("#ofTotal"),
    show_banner: $("#ofBanner").checked, active: true, config: {} };
  if (kind === "mystery_box") body.config = { delay_min: g("#ofDmin"), delay_max: g("#ofDmax") };
  if (["spend_save", "free_gift", "free_shipping"].includes(kind)) body.config = { min_order: g("#ofMin"), valid_days: g("#ofVd") };
  if (kind === "quiz") body.config = { question: g("#ofQ"), options: (g("#ofOpts") || "").split("\n").map((x) => x.trim()).filter(Boolean), answer_index: Number(g("#ofAns") || 1) - 1, wrong_message: g("#ofWrong") };
  if (OF_PRIZE_KINDS.includes(kind)) body.prizes = ofRows("#ofPrizes", "data-prow");
  if (kind === "flash_sale") body.products = ofRows("#ofSale", "data-srow");
  if (id) { const cur = OF.list.find((x) => x.id === id); if (cur) body.active = cur.active; }
  try {
    const r = await api(id ? `/api/admin/offers/${id}` : "/api/admin/offers", { method: id ? "PUT" : "POST", body: JSON.stringify(body) });
    closeModal(); toast(r.message); mpLoadOffers();
  } catch (e) { $("#ofErr").textContent = e.message; }
}
async function ofAction(id, act) {
  const o = OF.list.find((x) => String(x.id) === String(id));
  try {
    if (act === "edit") return ofForm(o.kind, o);
    if (act === "on" || act === "off") { const r = await api(`/api/admin/offers/${id}`, { method: "PUT", body: JSON.stringify({ active: act === "on" }) }); toast(r.message); }
    if (act === "del") { if (!confirm("Delete this offer?")) return; const r = await api(`/api/admin/offers/${id}`, { method: "DELETE" }); toast(r.message); }
    if (act === "draw") { if (!confirm("Pick a random winner now?")) return; const r = await api(`/api/admin/offers/${id}/draw`, { method: "POST", body: "{}" }); toast(r.message); }
    if (act === "entries") {
      const d = await api(`/api/admin/offers/${id}/entries`);
      return showModal(`<div class="modal-h"><h2>Entries · ${esc(o.title)}</h2><button class="icon-btn" data-close aria-label="Close">${ico("close")}</button></div><div class="modal-b" style="max-height:70vh;overflow:auto"><div class="tscroll"><table><thead><tr><th>Customer</th><th>Result</th><th>Coupon</th><th>When</th></tr></thead><tbody>${d.entries.length ? d.entries.map((e) => `<tr><td>${esc(e.name || "")}<br><small>${esc(e.email || "")}</small></td><td>${e.is_winner ? "🏆 " : ""}${esc(e.prize_label || "")}${e.correct === false ? " (wrong)" : ""}</td><td>${esc(e.coupon_code || "")}</td><td><small>${esc(ofLocal(e.created_at).replace("T", " "))}</small></td></tr>`).join("") : '<tr><td colspan="4"><div class="empty">Nobody yet.</div></td></tr>'}</tbody></table></div></div>`);
    }
    mpLoadOffers();
  } catch (e) { toast(e.message, "error"); }
}
document.addEventListener("click", (e) => {
  const n = e.target.closest("#ofNew"); if (n) return ofPickKind();
  const k = e.target.closest("[data-okind]"); if (k) return ofForm(k.dataset.okind);
  const a = e.target.closest("[data-oact]"); if (a) return ofAction(a.dataset.oid, a.dataset.oact);
  const pr = e.target.closest("[data-prm]"); if (pr) return pr.closest("[data-prow]").remove();
  const sr = e.target.closest("[data-srm]"); if (sr) return sr.closest("[data-srow]").remove();
});

/* ---------- Activity log (who did what) ---------- */
const auLabel = { seller_application_approved: "Approved seller application", seller_application_rejected: "Rejected seller application", seller_status: "Changed seller status",
  withdrawal_approved: "Paid a withdrawal", withdrawal_rejected: "Rejected a withdrawal", marketplace_settings: "Changed marketplace settings",
  coupon_created: "Created coupon", offer_created: "Created offer", offer_updated: "Changed offer", offer_deleted: "Deleted offer", offer_draw: "Drew a lucky draw winner", coupon_updated: "Changed coupon", coupon_deleted: "Deleted coupon", review_removed: "Removed a review",
  order_status: "Changed order status", refund_sent: "Marked refund as sent", commission_taken: "Took out commission" };
function vAudit() {
  return head("Activity log", "Every important admin action, with who did it and when") + `
  <section class="card table-card"><div class="tscroll"><table><thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Details</th></tr></thead>
  <tbody id="mpBody"><tr><td colspan="4"><div class="empty">Loading...</div></td></tr></tbody></table></div></section>`;
}
async function mpLoadAudit() {
  const body = $("#mpBody"); if (!body) return;
  try {
    const d = await api("/api/admin/audit");
    if (!$("#mpBody")) return;
    body.innerHTML = d.entries.length ? d.entries.map((e) => `<tr><td>${dshort(e.created_at)}</td><td>${esc(e.admin_email || "-")}</td>
      <td>${esc(auLabel[e.action] || e.action)}</td><td>${e.target_type ? `<small>${esc(e.target_type)} ${esc(e.target_id)}</small> ` : ""}${esc(e.detail || "")}</td></tr>`).join("")
      : `<tr><td colspan="4"><div class="empty">Nothing recorded yet.</div></td></tr>`;
  } catch (e) { body.innerHTML = `<tr><td colspan="4"><div class="empty">${esc(e.message)}</div></td></tr>`; }
}

/* ---------- Wallet: your commission + the common pool of all customer money ---------- */
MP.walletFilter = "";
const wlType = { commission: "Commission", return_charge: "Return charged to seller", commission_refund: "Commission taken back (return)", coupon_cost: "Zento coupon cost", coupon_cost_refund: "Zento coupon cost given back",
  customer_payment: "Customer payment", customer_refund: "Refund to customer", seller_payout: "Seller payout", owner_withdrawal: "Commission taken out" };
function vWallet() {
  const opts = [["", "All"], ["commission", "Commission wallet"], ["pool", "Customer money pool"]]
    .map(([v, l]) => `<option value="${v}"${v === MP.walletFilter ? " selected" : ""}>${l}</option>`).join("");
  return head("Wallet", "Your commission, and all customer money held in one pool", `<label class="field"><select id="wlFilter" aria-label="Filter wallet history">${opts}</select></label><button class="btn btn-primary" id="wlTake">Take out my commission</button>`) + `
  <div id="wlAlert"></div>
  <div id="wlCards"><div class="empty">Loading...</div></div>
  <section class="card table-card"><div style="padding:14px 16px;font-weight:700">History</div><div class="tscroll"><table><thead><tr><th>Date</th><th>Wallet</th><th>Type</th><th>Details</th><th>Amount</th></tr></thead>
  <tbody id="mpBody"><tr><td colspan="5"><div class="empty">Loading...</div></td></tr></tbody></table></div></section>`;
}
async function mpLoadWallet() {
  const body = $("#mpBody"); if (!body) return;
  try {
    const d = await api("/api/admin/wallet" + (MP.walletFilter ? `?wallet=${MP.walletFilter}` : ""));
    if (!$("#mpBody")) return;
    MP.wallet = d.balances;
    const b = d.balances;
    const card = (l, v, sub, tone = "", hero = false) => `<div class="wl-card ${tone}${hero ? " hero" : ""}"><span class="wl-l">${l}</span><b class="wl-v">${v}</b><span class="wl-s">${sub}</span></div>`;
    const sec = (title, hint, cards) => `<section class="wl-sec"><div class="wl-h"><h3>${title}</h3><p>${hint}</p></div><div class="wl-grid">${cards}</div></section>`;
    const dz = Number(b.delivery_dhaka_orders) || 0, oz = Number(b.delivery_outside_orders) || 0;
    $("#wlCards").innerHTML =
      sec("My money", "What actually belongs to Zento", 
        card("Commission wallet", money(b.commission), `Earned ${money(b.commission_earned)} · Coupons cost ${money(b.coupon_cost)} · Taken out ${money(b.taken_out)}`, "brand", true) +
        card("Delivery charges", money(b.delivery_total), `Dhaka division: ${dz} orders, ${money(b.delivery_dhaka_fees)}<br>Outside Dhaka: ${oz} orders, ${money(b.delivery_outside_fees)}`, "good") +
        card("Own product sales", money(b.own_sales), "Products sold by Zento itself (no seller)", "violet") +
        card("Return charges recovered", money(b.return_recovered), `${Number(b.returned_orders) || 0} returned orders · charged to sellers, not to you`, "warn")) +
      sec("Customer money", "Everything customers paid for delivered orders", 
        card("Money pool", money(b.pool), `Collected ${money(b.collected_total)} · Paid to sellers ${money(b.paid_to_sellers)} · Refunded ${money(b.refunded_to_customers)}`, "info", true) +
        card("Refunds to send", money(b.refunds_due), "Customers waiting for money back (mark each order as refund sent)", Number(b.refunds_due) > 0 ? "bad" : "")) +
      sec("Sellers", "What you owe sellers, and what sellers owe you", 
        card("Owed to sellers", money(b.seller_owed), `Available ${money(b.seller_available)} · Withdrawals waiting ${money(b.pending_withdrawals)}`, "info", true) +
        card("Sellers owe Zento", money(b.sellers_owe_us), "Negative seller balances after returns. New sales of that seller pay it back first.", Number(b.sellers_owe_us) > 0 ? "warn" : ""));
    $("#wlAlert").innerHTML = Number(b.pool) < Number(b.pending_withdrawals)
      ? `<div class="card" style="padding:12px 16px;margin-bottom:12px;border-color:#c62839;color:#c62839">The pool (${money(b.pool)}) is smaller than the withdrawals waiting (${money(b.pending_withdrawals)}). Customer money enters the pool when an order is marked delivered.</div>` : "";
    body.innerHTML = d.transactions.length ? d.transactions.map((t) => `<tr><td>${dshort(t.created_at)}</td>
      <td><span class="pill ${t.wallet === "commission" ? "info" : "warn"}">${t.wallet === "commission" ? "Commission" : "Pool"}</span></td>
      <td>${esc(wlType[t.type] || t.type)}</td><td>${esc(t.note || "")}</td>
      <td style="font-weight:700;color:${Number(t.amount) >= 0 ? "#0a8f5b" : "#c62839"}">${Number(t.amount) >= 0 ? "+" : "−"}${money(Math.abs(t.amount))}</td></tr>`).join("")
      : `<tr><td colspan="5"><div class="empty">No wallet activity yet. It starts when an order is marked delivered.</div></td></tr>`;
  } catch (e) { body.innerHTML = `<tr><td colspan="5"><div class="empty">${esc(e.message)}</div></td></tr>`; }
}
function mpWalletTake() {
  const avail = Number(MP.wallet?.commission || 0);
  showModal(`<div class="modal-h"><h2>Take out my commission</h2><button class="icon-btn" data-close aria-label="Close">${ico("close")}</button></div>
  <div class="modal-b"><p>Commission wallet balance: <b>${money(avail)}</b>. The amount is also taken out of the customer money pool.</p>
  <div class="form"><label class="full">Amount (BDT)<input id="wlAmt" type="number" min="1" step="0.01" max="${avail}"></label>
  <label class="full">Note (optional)<input id="wlNote" maxlength="200" placeholder="e.g. sent to my bKash"></label></div>
  <p id="wlErr" style="color:#c62839;min-height:18px"></p></div>
  <div class="modal-f"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="wlOk">Take out</button></div>`);
  $("#wlOk").addEventListener("click", async () => {
    try {
      const r = await api("/api/admin/wallet/commission-withdraw", { method: "POST", body: JSON.stringify({ amount: $("#wlAmt").value, note: $("#wlNote").value }) });
      closeModal(); toast(r.message); mpLoadWallet();
    } catch (e) { $("#wlErr").textContent = e.message; }
  });
}

function vWithdrawals() {
  const opts = [["pending", "Pending"], ["approved", "Paid"], ["rejected", "Rejected"], ["", "All"]]
    .map(([v, l]) => `<option value="${v}"${v === MP.wdFilter ? " selected" : ""}>${l}</option>`).join("");
  return head("Withdrawals", "Send the money manually, then approve to mark it paid", `<label class="field"><select id="mpWdFilter" aria-label="Filter withdrawals">${opts}</select></label>`) + `
  <section class="card table-card"><div class="tscroll"><table><thead><tr><th>Seller</th><th>Amount</th><th>Send to</th><th>Requested</th><th>Status</th><th>Actions</th></tr></thead>
  <tbody id="mpBody"><tr><td colspan="6"><div class="empty">Loading...</div></td></tr></tbody></table></div></section>`;
}
async function mpLoadWithdrawals() {
  const body = $("#mpBody"); if (!body) return;
  try {
    const d = await api("/api/admin/withdrawals" + (MP.wdFilter ? `?status=${MP.wdFilter}` : ""));
    if (!$("#mpBody")) return;
    body.innerHTML = d.withdrawals.length ? d.withdrawals.map((w) => `<tr>
      <td><b>${esc(w.store_name)}</b><br><small>${esc(w.owner_email)}</small></td><td><b>${money(w.amount)}</b></td>
      <td>${esc(w.method)}<br><b>${esc(w.account)}</b></td><td>${dstr(w.created_at)}</td>
      <td><span class="pill ${w.status === "approved" ? "good" : w.status === "rejected" ? "bad" : "warn"}">${w.status === "approved" ? "paid" : esc(w.status)}</span>${w.admin_note ? `<br><small>${esc(w.admin_note)}</small>` : ""}</td>
      <td style="white-space:nowrap">${w.status === "pending" ? `<button class="btn btn-sm btn-primary" data-wact="approve" data-wid="${w.id}" data-amt="${w.amount}">Approve</button> <button class="btn btn-sm btn-ghost" data-wact="reject" data-wid="${w.id}">Reject</button>` : "-"}</td></tr>`).join("")
      : `<tr><td colspan="6"><div class="empty">No withdrawal requests.</div></td></tr>`;
  } catch (e) { body.innerHTML = `<tr><td colspan="6"><div class="empty">${esc(e.message)}</div></td></tr>`; }
}
function mpWithdrawalAction(id, act, amt) {
  const run = async (note) => { try { const r = await api(`/api/admin/withdrawals/${id}/${act}`, { method: "POST", body: JSON.stringify({ note }) }); toast(r.message); mpLoadWithdrawals(); } catch (e) { toast(e.message, "error"); } };
  if (act === "approve") return mpAsk("Approve withdrawal", `Send ${money(amt)} to the seller first, then paste the transaction ID here (optional).`, "Mark as paid", run);
  return mpAsk("Reject withdrawal", "Reason (the amount goes back to the seller's wallet)", "Reject", run);
}

function vMarket() {
  return head("Marketplace", "Commission, payouts and review moderation") + `<div id="mpBody"><section class="card"><div class="empty">Loading...</div></section></div>`;
}
async function mpLoadMarket() {
  const box = $("#mpBody"); if (!box) return;
  try {
    const d = await api("/api/admin/marketplace");
    if (!$("#mpBody")) return;
    const sc = d.seller_counts || {}, wd = d.withdrawals || {};
    const st = (l, v) => `<div class="card" style="padding:14px"><small>${l}</small><div style="font-size:20px;font-weight:700">${v}</div></div>`;
    box.innerHTML = `
    <div style="display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));margin-bottom:14px">
      ${st("Commission earned", money(d.commission_earned))}${st("Seller sales (delivered)", money(d.seller_sales))}
      ${st("Pending sellers", sc.pending || 0)}${st("Approved sellers", sc.approved || 0)}
      ${st("Withdrawals waiting", (wd.pending?.count || 0) + " · " + money(wd.pending?.amount))}${st("Total paid out", money(wd.approved?.amount))}
    </div>
    <section class="card"><form class="form" id="mpSet" style="padding:16px">
      <label>Platform commission (%)<input id="mpComm" type="number" min="0" max="90" step="0.5" value="${esc(d.settings.commission_percent)}"></label>
      <label>Minimum withdrawal (৳)<input id="mpMin" type="number" min="0" step="1" value="${esc(d.settings.min_withdrawal)}"></label>
      <label>Return period (days after delivery)<input id="mpRet" type="number" min="0" max="60" step="1" value="${esc(d.settings.return_days || 7)}"></label>
      <label class="full" style="flex-direction:row;align-items:center;gap:8px"><input id="mpReq" type="checkbox" style="width:auto"${d.settings.reviews_require_purchase === "true" ? " checked" : ""}> Only customers who received the product can review it</label>
      <div class="full"><button class="btn btn-primary" type="submit">Save settings</button> <small>New commission applies to future deliveries only.</small></div>
    </form></section>
    <section class="card table-card" style="margin-top:14px"><div style="padding:14px 16px;font-weight:700">Latest reviews</div><div class="tscroll"><table><thead><tr><th>Product</th><th>Rating</th><th>Review</th><th>By</th><th></th></tr></thead><tbody>
    ${d.reviews.length ? d.reviews.map((r) => `<tr><td>${esc(r.product_name)}</td><td style="color:#f5a524">${"★".repeat(r.rating)}${"☆".repeat(5 - r.rating)}</td>
      <td>${r.title ? `<b>${esc(r.title)}</b><br>` : ""}${esc(r.comment)}</td><td>${esc(r.user_name)}${r.verified_purchase ? '<br><small>Verified purchase</small>' : ""}<br><small>${dshort(r.created_at)}</small></td>
      <td><button class="btn btn-sm btn-ghost" data-rdel="${r.id}">Remove</button></td></tr>`).join("") : `<tr><td colspan="5"><div class="empty">No reviews yet.</div></td></tr>`}
    </tbody></table></div></section>`;
    $("#mpSet").addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const r = await api("/api/admin/marketplace/settings", { method: "PUT", body: JSON.stringify({ commission_percent: $("#mpComm").value, min_withdrawal: $("#mpMin").value, return_days: $("#mpRet").value, reviews_require_purchase: $("#mpReq").checked }) });
        toast(r.message);
      } catch (err) { toast(err.message, "error"); }
    });
  } catch (e) { box.innerHTML = `<section class="card"><div class="empty">${esc(e.message)}</div></section>`; }
}


/* ---------- Warehouse, return requests, complaints ---------- */
Object.assign(I, {
  warehouse: '<path d="M3 21V9l9-5 9 5v12"/><path d="M8 21v-7h8v7"/><path d="M3 21h18"/>',
  returns: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 010 10h-3"/>',
  complaint: '<path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17h.01"/>'
});
Object.assign(MP, { whFilter: "wait", retFilter: "requested", cmpFilter: "open", couriers: [] });
const FUL = { placed: ["Waiting for seller", "warn"], seller_approved: ["Seller approved, not sent yet", "warn"], sent_to_warehouse: ["Sent by seller, on the way", "info"], at_warehouse: ["In warehouse", "good"], with_courier: ["With courier", "good"] };
const mpSel = (id, cur, opts, label) => `<label class="field"><select id="${id}" aria-label="${label}">${opts.map(([v, l]) => `<option value="${v}"${v === cur ? " selected" : ""}>${l}</option>`).join("")}</select></label>`;
const cardMsg = (m) => `<section class="card"><div class="empty">${esc(m)}</div></section>`;

function vWarehouse() {
  return head("Warehouse", "Receive seller products here, then hand each full order to a courier",
    mpSel("whF", MP.whFilter, [["wait", "Waiting for products"], ["ready", "Ready for courier"], ["all", "All"]], "Filter")) + `<div id="mpBody">${cardMsg("Loading...")}</div>`;
}
async function mpLoadWarehouse() {
  const box = $("#mpBody"); if (!box) return;
  try {
    const d = await api("/api/admin/warehouse");
    if (!$("#mpBody")) return;
    MP.couriers = d.couriers || [];
    const list = d.orders.filter((o) => MP.whFilter === "all" || (MP.whFilter === "ready" ? o.ready : !o.ready));
    box.innerHTML = list.length ? list.map((o) => `<section class="card card-pad" style="margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:flex-start">
        <div><b style="font-size:16px">${oid(o.id)}</b> <span class="pill ${o.ready ? "good" : "warn"}">${o.ready ? "Ready for courier" : "Waiting for products"}</span>
          <div class="sub" style="margin-top:4px">${esc(o.customer_name)} · ${esc(o.phone)}<br>${esc(o.address)}, ${esc(o.city)}</div></div>
        <div style="text-align:right"><b>${money(o.total)}</b><div class="sub">${esc(String(o.payment_method).toUpperCase())}${o.payment_trx_id ? `<br>TrxID <b>${esc(o.payment_trx_id)}</b>` : ""}</div></div>
      </div>
      <div class="tscroll"><table style="margin-top:10px"><tbody>${o.items.map((i) => { const f = FUL[i.seller_id == null ? "at_warehouse" : i.fulfil_status] || FUL.placed; return `<tr>
        <td><b>${esc(i.product_name)}</b> × ${i.quantity}<br><small>From: ${esc(i.store_name)}</small></td>
        <td><span class="pill ${f[1]}">${f[0]}</span>${i.to_wh_courier || i.to_wh_tracking ? `<br><small>${esc([i.to_wh_courier, i.to_wh_tracking].filter(Boolean).join(" · "))}</small>` : ""}</td>
        <td style="text-align:right">${["seller_approved", "sent_to_warehouse"].includes(i.fulfil_status) && i.seller_id != null ? `<button class="btn btn-sm btn-primary" data-recv="${i.id}">Received</button>` : ""}</td></tr>`; }).join("")}</tbody></table></div>
      ${o.ready ? `<div style="margin-top:12px"><button class="btn btn-primary" data-hand="${o.id}" data-name="${esc(o.customer_name)}">Hand to courier</button></div>` : ""}
    </section>`).join("") : cardMsg(MP.whFilter === "ready" ? "No order is ready for a courier." : "Nothing is waiting. Orders show up here after a seller approves them.");
  } catch (e) { box.innerHTML = cardMsg(e.message); }
}
function mpHandover(id, name) {
  showModal(`<div class="modal-h"><h2>Hand ${oid(id)} to courier</h2><button class="icon-btn" data-close aria-label="Close">${ico("close")}</button></div>
  <div class="modal-b"><p class="sub" style="margin-top:0">Parcel for <b>${esc(name)}</b>. Check the payment (bKash/Nagad TrxID) before you hand it over.</p><div class="form">
    <label class="full">Courier<select id="hdC">${MP.couriers.map((c) => `<option>${esc(c)}</option>`).join("")}</select></label>
    <label class="full">Tracking number<input id="hdT" maxlength="60" placeholder="Courier tracking / consignment ID"></label></div>
    <p id="hdErr" style="color:#c62839;min-height:18px;margin:8px 0 0"></p></div>
  <div class="modal-f"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="hdGo">Hand over</button></div>`);
  $("#hdGo").addEventListener("click", async () => {
    try { const r = await api(`/api/admin/orders/${id}/handover`, { method: "POST", body: JSON.stringify({ courier: $("#hdC").value, tracking_no: $("#hdT").value }) });
      closeModal(); toast(r.message); mpLoadWarehouse(); loadAll(); } catch (e) { $("#hdErr").textContent = e.message; }
  });
}

function vReturns() {
  return head("Return requests", "Customers can ask to return a delivered order. An accepted return is charged to the seller.",
    mpSel("retF", MP.retFilter, [["requested", "Waiting"], ["approved", "Accepted"], ["rejected", "Rejected"], ["", "All"]], "Filter")) + `
  <section class="card table-card"><div class="tscroll"><table><thead><tr><th>Order</th><th>Customer</th><th>Products / sellers</th><th>Reason</th><th>Status</th><th>Actions</th></tr></thead>
  <tbody id="mpBody"><tr><td colspan="6"><div class="empty">Loading...</div></td></tr></tbody></table></div></section>`;
}
async function mpLoadReturns() {
  const body = $("#mpBody"); if (!body) return;
  try {
    const d = await api("/api/admin/returns" + (MP.retFilter ? `?status=${MP.retFilter}` : ""));
    if (!$("#mpBody")) return;
    body.innerHTML = d.returns.length ? d.returns.map((r) => `<tr>
      <td><b>${oid(r.order_id)}</b><br><small>${dstr(r.created_at)}</small><br><b>${money(r.total)}</b></td>
      <td>${esc(r.customer_name)}<br><small>${esc(r.phone)}<br>${esc(r.email)}</small></td>
      <td>${esc(r.items)}<br><small>Seller: <b>${esc(r.sellers)}</b></small></td>
      <td style="max-width:260px">${esc(r.reason)}</td>
      <td><span class="pill ${r.status === "approved" ? "good" : r.status === "rejected" ? "bad" : "warn"}">${r.status === "approved" ? "accepted" : esc(r.status)}</span>${r.admin_note ? `<br><small>${esc(r.admin_note)}</small>` : ""}</td>
      <td style="white-space:nowrap">${r.status === "requested" ? `<button class="btn btn-sm btn-primary" data-ret="approve" data-rid="${r.id}">Accept</button> <button class="btn btn-sm btn-ghost" data-ret="reject" data-rid="${r.id}">Reject</button>` : "-"}</td></tr>`).join("")
      : `<tr><td colspan="6"><div class="empty">No return requests.</div></td></tr>`;
  } catch (e) { body.innerHTML = `<tr><td colspan="6"><div class="empty">${esc(e.message)}</div></td></tr>`; }
}
function mpReturnAction(id, act) {
  const run = async (note) => { try { const r = await api(`/api/admin/returns/${id}/${act}`, { method: "POST", body: JSON.stringify({ note }) }); toast(r.message); mpLoadReturns(); } catch (e) { toast(e.message, "error"); } };
  if (act === "approve") return mpAsk("Accept this return", "The sale is taken back from the seller and the delivery charge is charged to the seller. The customer refund becomes due. Add a note (optional).", "Accept return", run);
  return mpAsk("Reject this return", "Reason (the customer will see it)", "Reject", run);
}

function vComplaints() {
  return head("Complaints", "Customers complain about a seller from their order",
    mpSel("cmpF", MP.cmpFilter, [["open", "Open"], ["resolved", "Resolved"], ["dismissed", "Dismissed"], ["", "All"]], "Filter")) + `
  <section class="card table-card"><div class="tscroll"><table><thead><tr><th>Seller</th><th>Customer</th><th>Complaint</th><th>Status</th><th>Actions</th></tr></thead>
  <tbody id="mpBody"><tr><td colspan="5"><div class="empty">Loading...</div></td></tr></tbody></table></div></section>`;
}
async function mpLoadComplaints() {
  const body = $("#mpBody"); if (!body) return;
  try {
    const d = await api("/api/admin/complaints" + (MP.cmpFilter ? `?status=${MP.cmpFilter}` : ""));
    if (!$("#mpBody")) return;
    body.innerHTML = d.complaints.length ? d.complaints.map((c) => `<tr>
      <td><b>${esc(c.store_name)}</b><br><small>${c.seller_total} complaint${Number(c.seller_total) === 1 ? "" : "s"} in total</small></td>
      <td>${esc(c.customer)}<br><small>${esc(c.phone || "")}<br>${esc(c.email)}</small></td>
      <td style="max-width:320px"><b>${esc(c.subject)}</b> <small>· ${c.order_id ? oid(c.order_id) : ""} · ${dstr(c.created_at)}</small><br>${esc(c.message)}</td>
      <td><span class="pill ${c.status === "open" ? "warn" : c.status === "resolved" ? "good" : "info"}">${esc(c.status)}</span>${c.admin_note ? `<br><small>${esc(c.admin_note)}</small>` : ""}</td>
      <td style="white-space:nowrap">${c.status === "open" ? `<button class="btn btn-sm btn-primary" data-cmp="resolved" data-cid="${c.id}">Resolve</button> <button class="btn btn-sm btn-ghost" data-cmp="dismissed" data-cid="${c.id}">Dismiss</button>` : "-"}</td></tr>`).join("")
      : `<tr><td colspan="5"><div class="empty">No complaints.</div></td></tr>`;
  } catch (e) { body.innerHTML = `<tr><td colspan="5"><div class="empty">${esc(e.message)}</div></td></tr>`; }
}
document.addEventListener("click", (e) => {
  const rc = e.target.closest("[data-recv]");
  if (rc) { rc.disabled = true; api(`/api/admin/order-items/${rc.dataset.recv}/receive`, { method: "POST", body: "{}" }).then((r) => { toast(r.message); mpLoadWarehouse(); loadAll(); }).catch((err) => { toast(err.message, "error"); rc.disabled = false; }); return; }
  const h = e.target.closest("[data-hand]"); if (h) return mpHandover(h.dataset.hand, h.dataset.name);
  const rt = e.target.closest("[data-ret]"); if (rt) return mpReturnAction(rt.dataset.rid, rt.dataset.ret);
  const cm = e.target.closest("[data-cmp]");
  if (cm) mpAsk(cm.dataset.cmp === "resolved" ? "Resolve complaint" : "Dismiss complaint", "Note for the record (optional)", "Save", async (note) => {
    try { const r = await api(`/api/admin/complaints/${cm.dataset.cid}/resolve`, { method: "POST", body: JSON.stringify({ status: cm.dataset.cmp, note }) }); toast(r.message); mpLoadComplaints(); } catch (err) { toast(err.message, "error"); }
  });
});

function mpWire(k) {
  if (!["sellers", "withdrawals", "marketplace", "applications", "coupons", "offers", "audit", "wallet", "warehouse", "returns", "complaints"].includes(k)) return;
  if (k === "warehouse") { mpLoadWarehouse(); const f = $("#whF"); if (f) f.addEventListener("change", (e) => { MP.whFilter = e.target.value; mpLoadWarehouse(); }); }
  if (k === "returns") { mpLoadReturns(); const f = $("#retF"); if (f) f.addEventListener("change", (e) => { MP.retFilter = e.target.value; mpLoadReturns(); }); }
  if (k === "complaints") { mpLoadComplaints(); const f = $("#cmpF"); if (f) f.addEventListener("change", (e) => { MP.cmpFilter = e.target.value; mpLoadComplaints(); }); }
  if (k === "audit") mpLoadAudit();
  if (k === "wallet") { mpLoadWallet(); const f = $("#wlFilter"); if (f) f.addEventListener("change", (e) => { MP.walletFilter = e.target.value; mpLoadWallet(); }); const t = $("#wlTake"); if (t) t.addEventListener("click", mpWalletTake); }
  if (k === "offers") mpLoadOffers();
  if (k === "coupons") { mpLoadCoupons(); const b = $("#cpNew"); if (b) b.addEventListener("click", () => mpCouponForm()); }
  if (k === "applications") { mpLoadApps(); const f = $("#mpAppFilter"); if (f) f.addEventListener("change", (e) => { MP.appFilter = e.target.value; mpLoadApps(); }); }
  if (k === "sellers") { mpLoadSellers(); const f = $("#mpSellerFilter"); if (f) f.addEventListener("change", (e) => { MP.sellerFilter = e.target.value; mpLoadSellers(); }); }
  if (k === "withdrawals") { mpLoadWithdrawals(); const f = $("#mpWdFilter"); if (f) f.addEventListener("change", (e) => { MP.wdFilter = e.target.value; mpLoadWithdrawals(); }); }
  if (k === "marketplace") mpLoadMarket();
}
/* one delegated listener for all marketplace buttons (registered once) */
document.addEventListener("click", (e) => {
  const cp = e.target.closest("[data-cact]"); if (cp) return mpCouponAction(cp.dataset.cid, cp.dataset.cact);
  const ap = e.target.closest("[data-aact]"); if (ap) return mpAppAction(ap.dataset.aid, ap.dataset.aact, ap.dataset.astore);
  const s = e.target.closest("[data-sact]"); if (s) return mpSellerAction(s.dataset.sid, s.dataset.sact);
  const w = e.target.closest("[data-wact]"); if (w) return mpWithdrawalAction(w.dataset.wid, w.dataset.wact, w.dataset.amt);
  const r = e.target.closest("[data-rdel]");
  if (r && confirm("Remove this review?")) api(`/api/admin/reviews/${r.dataset.rdel}`, { method: "DELETE" }).then(() => { toast("Review removed"); mpLoadMarket(); }).catch((err) => toast(err.message, "error"));
});

const ROUTES = {
  dashboard: { t: "Dashboard", i: "dashboard", v: vDashboard },
  products: { t: "Products", i: "products", v: vProducts },
  orders: { t: "Orders", i: "orders", v: vOrders },
  customers: { t: "Customers", i: "customers", v: vCustomers },
  analytics: { t: "Analytics", i: "analytics", v: vAnalytics },
  lowstock: { t: "Low Stock Alerts", i: "lowstock", v: vLow },
  recent: { t: "Recent Orders", i: "recent", v: vRecent },
  revenue: { t: "Revenue by Category", i: "revenue", v: vRevenue },
  messages: { t: "Messages", i: "chat", v: vMessages },
  settings: { t: "Settings", i: "settings", v: vSettings },
  applications: { t: "Seller Applications", i: "sellers", v: vApplications },
  sellers: { t: "Sellers", i: "sellers", v: vSellers },
  withdrawals: { t: "Withdrawals", i: "wallet", v: vWithdrawals },
  wallet: { t: "Wallet", i: "wallet", v: vWallet },
  audit: { t: "Activity log", i: "analytics", v: vAudit },
  coupons: { t: "Coupons", i: "star", v: vCoupons },
  offers: { t: "Offers & Events", i: "gift", v: vOffers },
  marketplace: { t: "Marketplace", i: "star", v: vMarket },
  warehouse: { t: "Warehouse", i: "warehouse", v: vWarehouse },
  returns: { t: "Return requests", i: "returns", v: vReturns },
  complaints: { t: "Complaints", i: "complaint", v: vComplaints }
};
const MAIN = ["dashboard", "products", "orders", "warehouse", "returns", "complaints", "messages", "customers", "applications", "sellers", "withdrawals", "wallet", "coupons", "offers", "marketplace", "audit", "analytics"];
const REPORTS = ["lowstock", "recent", "revenue"];
const curRoute = () => { const k = (location.hash || "#dashboard").slice(1); return ROUTES[k] ? k : "dashboard"; };

function buildNav(cur) {
  const link = (k) => `<a href="#${k}" data-go="${k}"${k === cur ? ' aria-current="page"' : ""}>${ico(ROUTES[k].i)}${ROUTES[k].t}</a>`;
  $("#nav").innerHTML = MAIN.map(link).join("") + '<div class="nav-label">Reports</div>' + REPORTS.map(link).join("") + '<div class="nav-label">Store</div>' + link("settings");
  const tabs = [["dashboard", "Home"], ["products", "Products"], ["orders", "Orders"], ["messages", "Chat"]];
  $("#tabbar").innerHTML = tabs.map(([k, l]) => `<button data-go="${k}"${k === cur ? ' aria-current="page"' : ""}>${ico(ROUTES[k].i)}${l}</button>`).join("") + `<button id="moreBtn"${!["dashboard", "products", "orders", "messages"].includes(cur) ? ' aria-current="page"' : ""}>${ico("more")}More</button>`;
}
function renderView() {
  if ($("#adminApp").hidden) return;
  const k = curRoute();
  buildNav(k);
  specs = {};
  stopChat();
  const view = $("#view");
  if (k === "settings") view.innerHTML = vSettings();
  else if (k === "messages") view.innerHTML = vMessages();
  else if (S.loading && !S.loaded) view.innerHTML = head(ROUTES[k].t, "Loading your store data...") + statePanel('<div class="spinner"></div>Loading...');
  else if (S.error && !S.loaded) view.innerHTML = head(ROUTES[k].t, "Something went wrong") + statePanel(`<div>${esc(S.error)}</div><button class="btn btn-primary" id="retryBtn">Try again</button>`);
  else view.innerHTML = ROUTES[k].v();
  paintCharts(); wire(k); mpWire(k);
  setBadge(C.unread);
  if (k === "messages") chatStart();
}
function route() {
  document.body.classList.remove("nav-open");
  renderView();
  window.scrollTo(0, 0);
}
function updateBell() { const d = $("#bellDot"); if (d) d.hidden = !lowStockList().length; }


/* ---------- Live chat (customer messages) ---------- */
const C = { threads: [], uid: null, name: "", msgs: [], last: 0, timer: null, unread: 0 };
const tshort = (s) => { const d = pdate(s); return isNaN(d) ? "" : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const tlist = (s) => { const d = pdate(s); if (isNaN(d)) return ""; return d.toDateString() === new Date().toDateString() ? tshort(s) : `${MON[d.getMonth()]} ${d.getDate()}`; };

function vMessages() {
  return head("Messages", "Chat with your customers") + `<section class="card chat${C.uid ? " open" : ""}" id="chatRoot"><div class="chat-list" id="chatList"></div><div class="chat-conv" id="chatConv"></div></section>`;
}
function setBadge(n) {
  C.unread = n || 0;
  document.querySelectorAll('[data-go="messages"]').forEach((a) => {
    let b = a.querySelector(".cbadge");
    if (C.unread > 0) {
      if (!b) { b = document.createElement("i"); b.className = "cbadge"; a.appendChild(b); }
      b.textContent = C.unread > 99 ? "99+" : String(C.unread);
    } else if (b) b.remove();
  });
}
function stopChat() { clearInterval(C.timer); C.timer = null; }
async function loadThreads() {
  try {
    const d = await api("/api/admin/chat/threads");
    C.threads = d.threads || [];
    setBadge(d.unread_total || 0);
    drawThreads();
  } catch (e) { if (e.status === 401) logout(); }
}
function drawThreads() {
  const box = $("#chatList"); if (!box) return;
  box.innerHTML = C.threads.length ? C.threads.map((t) => `<button type="button" class="chat-item${t.user_id === C.uid ? " on" : ""}" data-chat="${t.user_id}"><div class="avatar">${esc((t.name || "?").charAt(0).toUpperCase())}</div><div class="ci-b"><b>${esc(t.name || t.email)}</b><span>${t.last_sender === "admin" ? "You: " : ""}${esc(t.last_body)}</span></div><div class="ci-m"><small>${tlist(t.last_at)}</small>${t.unread ? `<i class="cbadge">${t.unread}</i>` : ""}</div></button>`).join("") : `<div class="empty">No messages yet. When a customer writes from the app, it appears here.</div>`;
}
function bubble(m) { return `<div class="cm ${m.sender === "admin" ? "me" : "them"}"><p>${esc(m.body)}</p><small>${tshort(m.created_at)}</small></div>`; }
function openConv(uid) {
  const t = C.threads.find((x) => x.user_id === uid) || {};
  C.uid = uid; C.name = t.name || t.email || "Customer"; C.msgs = []; C.last = 0;
  const root = $("#chatRoot"); if (root) root.classList.add("open");
  $("#chatConv").innerHTML = `<div class="conv-h"><button type="button" class="icon-btn conv-back" id="chatBack" aria-label="Back">&larr;</button><div><b>${esc(C.name)}</b><small>${esc(t.email || "")}</small></div></div><div class="conv-m" id="chatMsgs"></div><form class="conv-f" id="chatForm"><textarea id="chatInput" rows="1" maxlength="1000" placeholder="Write a reply..." aria-label="Reply"></textarea><button class="btn btn-primary" type="submit">Send</button></form>`;
  $("#chatBack").addEventListener("click", closeConv);
  $("#chatForm").addEventListener("submit", sendReply);
  $("#chatInput").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $("#chatForm").requestSubmit(); } });
  drawThreads(); loadMsgs(true);
}
function closeConv() {
  C.uid = null;
  const root = $("#chatRoot"); if (root) root.classList.remove("open");
  const c = $("#chatConv"); if (c) c.innerHTML = `<div class="conv-empty">Select a conversation</div>`;
  drawThreads();
}
async function loadMsgs(first) {
  const uid = C.uid; if (!uid) return;
  try {
    const d = await api(`/api/admin/chat/threads/${uid}?after=${C.last}`);
    if (uid !== C.uid) return;
    const list = d.messages || [];
    if (list.length) addMsgs(list, first);
    if (first) loadThreads();
  } catch (e) { if (e.status === 401) logout(); }
}
function addMsgs(list, force) {
  const box = $("#chatMsgs"); if (!box) return;
  const near = force || box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  list.forEach((m) => { C.msgs.push(m); C.last = Math.max(C.last, m.id); });
  box.insertAdjacentHTML("beforeend", list.map(bubble).join(""));
  if (near) box.scrollTop = box.scrollHeight;
}
async function sendReply(e) {
  e.preventDefault();
  const inp = $("#chatInput"), body = inp.value.trim(); if (!body || !C.uid) return;
  inp.value = ""; inp.disabled = true;
  try {
    const d = await api(`/api/admin/chat/threads/${C.uid}`, { method: "POST", body: JSON.stringify({ body }) });
    if (d.message && d.message.id > C.last) addMsgs([d.message], true);
    loadThreads();
  } catch (err) { inp.value = body; toast(err.message || "Could not send.", "error"); }
  inp.disabled = false; inp.focus();
}
function chatStart() {
  const c = $("#chatConv");
  if (C.uid) openConv(C.uid); else if (c) c.innerHTML = `<div class="conv-empty">Select a conversation</div>`;
  loadThreads();
  C.timer = setInterval(() => { if (document.visibilityState === "hidden") return; loadThreads(); loadMsgs(false); }, 5000);
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-chat]"); if (b) openConv(Number(b.dataset.chat));
});
/* unread badge while the admin is on another page */
setInterval(() => {
  if (!$("#adminApp") || $("#adminApp").hidden || document.visibilityState === "hidden" || C.timer) return;
  loadThreads();
}, 30000);

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
  on("#resetOpen", "click", async () => {
    try {
      const d = await api("/api/admin/reset-data");
      const rows = d.tables.map((t) => `<tr><td>${esc(t.label)}</td><td class="r"><b>${t.count}</b></td></tr>`).join("");
      showModal(`<div class="modal-h"><h2>Clear test data</h2><button class="icon-btn" data-close aria-label="Close">${ico("close")}</button></div>
      <div class="modal-b"><p style="margin-top:0">These will be <b>permanently deleted</b>:</p>
      <table style="width:100%;margin-bottom:12px"><tbody>${rows}</tbody></table>
      <p class="sub">Kept: ${d.kept.map(esc).join(", ")}.</p>
      <label class="full">Type <b>${esc(d.confirm_word)}</b> to confirm<input id="rsWord" autocomplete="off" placeholder="${esc(d.confirm_word)}"></label>
      <p id="rsErr" style="color:#c62839;min-height:18px;margin:8px 0 0"></p></div>
      <div class="modal-f"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-danger" id="rsGo">Delete everything above</button></div>`);
      $("#rsGo").addEventListener("click", async () => {
        try {
          const r = await api("/api/admin/reset-data", { method: "POST", body: JSON.stringify({ confirm: $("#rsWord").value }) });
          closeModal(); toast(r.message); loadAll();
        } catch (e) { $("#rsErr").textContent = e.message; }
      });
    } catch (e) { toast(e.message, "error"); }
  });
  on("#setForm", "submit", (e) => {
    e.preventDefault();
    store.set("zento_store_name", $("#storeName").value.trim());
    store.set("zento_low_stock_threshold", String(Math.max(0, Number($("#lowLimit").value) || 0)));
    store.set("zento_admin_api_key", $("#apiKey").value.trim());
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
    <dt>Placed</dt><dd>${dstr(o.created_at)}</dd><dt>Payment</dt><dd>${esc(String(o.payment_method || "cod").toUpperCase())}</dd>${o.payment_trx_id ? `<dt>TrxID</dt><dd><b>${esc(o.payment_trx_id)}</b></dd><dt>Paid from</dt><dd>${esc(o.payment_sender || "-")}</dd>` : ""}
    <dt>Items</dt><dd class="items">${items.length ? items.map((it) => `<div><span>${esc(it.name || it.product_name)} × ${it.quantity}${it.tracking_no ? `<br><small>${esc(it.courier)} · ${esc(it.tracking_no)}</small>` : ""}</span><span>${money(it.subtotal)}</span></div>`).join("") : "-"}</dd>
    <dt>Subtotal</dt><dd>${money(o.subtotal)}</dd>${Number(o.discount_total) > 0 ? `<dt>Coupon ${esc(o.coupon_code)}</dt><dd>-${money(o.discount_total)}</dd>` : ""}<dt>Delivery</dt><dd>${money(o.delivery_fee)}</dd><dt>Total</dt><dd><b>${money(o.total)}</b></dd>
    ${o.cancel_reason && (o.status === "cancelled" || o.status === "returned") ? `<dt>Reason</dt><dd>${esc(o.cancel_reason)}</dd>` : ""}${o.refund_status === "due" ? `<dt>Refund</dt><dd><b style="color:#c62839">Refund due ${money(o.refund_amount)}</b> <button class="btn btn-sm btn-primary" id="refundDone">Mark refund sent</button></dd>` : o.refund_status === "refunded" ? `<dt>Refund</dt><dd>Sent ${money(o.refund_amount)}</dd>` : ""}<dt>Status</dt><dd class="status-row"><select class="sel" id="stSel" aria-label="Order status">${opts}</select><button class="btn btn-sm btn-primary" id="stSave">Update</button>${o.status === "pending" ? '<button class="btn btn-sm btn-soft" id="stApprove">Approve</button>' : ""}</dd>
  </dl><div class="modal-f"><button class="btn btn-ghost" data-close>Close</button></div>`);
  const run = async (fn, msg) => {
    try { await fn(); await reloadOrders(); closeModal(); renderView(); toast(msg); }
    catch (e) { toast(e.message || "Request failed.", "error"); }
  };
  $("#stSave").addEventListener("click", () => {
    const status = $("#stSel").value;
    let reason = "";
    if (status === "cancelled" || status === "returned") {
      reason = prompt(status === "cancelled" ? "Why is this order cancelled? (shown to the customer)" : "Why is it returned?", "") ;
      if (reason === null) return;
      if (!confirm(status === "cancelled" ? "Cancel this order? Stock goes back to the shelf." : "Mark as returned? Stock goes back. The seller's money for this order is taken back and the delivery charge is charged to the SELLER (not to you).")) return;
    }
    run(() => api(`/api/admin/orders/${o.id}/status`, { method: "PUT", body: JSON.stringify({ status, reason }) }), `Order ${oid(o.id)} updated.`);
  });
  const rd = $("#refundDone"); if (rd) rd.addEventListener("click", () => run(() => api(`/api/admin/orders/${o.id}/refund-done`, { method: "POST", body: JSON.stringify({}) }), "Refund marked as sent."));
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

/* ---------- Android app hooks ---------- */
if (/ZentoApp/.test(navigator.userAgent)) document.documentElement.classList.add("in-app");
function syncNativeTheme() {
  try {
    const r = document.documentElement;
    const dark = r.dataset.theme ? r.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    if (window.ZentoNative && window.ZentoNative.setTheme) window.ZentoNative.setTheme(dark ? "dark" : "light");
  } catch (e) {}
}
syncNativeTheme();
$("#themeBtn").addEventListener("click", () => setTimeout(syncNativeTheme, 0));
window.zentoHandleBack = function () {
  if ($("#layer") && $("#layer").innerHTML.trim()) { closeModal(); return true; }
  if (C.uid) { closeConv(); return true; }
  if (location.hash && location.hash !== "#dashboard" && location.hash !== "#") { location.hash = "dashboard"; return true; }
  return false;
};
