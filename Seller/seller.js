/* ZENTO SELLER CENTER */
import { supabase } from "/js/supabase.js";

const HOST = location.hostname;
const API = (HOST === "localhost" || HOST === "127.0.0.1" || HOST.endsWith("onrender.com"))
  ? location.origin
  : "https://zento-e-commerce-all.onrender.com";

const TOKEN_KEY = "zento_token";
const USER_KEY = "zento_user";
const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => "৳" + Number(n || 0).toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const when = (s) => { const d = new Date(s); return isNaN(d) ? "-" : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }); };
const stars = (n) => { const r = Math.round(Number(n) || 0); return "★".repeat(r) + "☆".repeat(5 - r); };
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  del: (k) => { try { localStorage.removeItem(k); } catch {} }
};

const S = { me: null, tab: "overview", products: [], orders: [], wallet: null };
const app = $("#app");

/* ---------- helpers ---------- */
function toast(msg, type = "ok") {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast" + (type === "error" ? " error" : "");
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.hidden = true), 3200);
}

async function call(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (opts.body) headers["Content-Type"] = "application/json";
  const token = store.get(TOKEN_KEY);
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(API + path, { ...opts, headers });
  let data = {};
  try { data = await res.json(); } catch {}
  if (res.status === 401 && token) { logout(false); throw new Error("Session expired. Please log in again."); }
  if (!res.ok || data.status === "error") throw new Error(data.message || `Request failed (${res.status})`);
  return data;
}

async function uploadImage(file) {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const name = `seller-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await supabase.storage.from("product-images").upload(name, file, { upsert: false, contentType: file.type });
  if (error) throw error;
  return supabase.storage.from("product-images").getPublicUrl(name).data?.publicUrl || "";
}

function logout(render = true) {
  store.del(TOKEN_KEY); store.del(USER_KEY);
  S.me = null;
  if (render) start();
}
$("#logoutBtn").addEventListener("click", () => logout());

function busy(btn, on, label) { btn.disabled = on; if (label) btn.textContent = on ? "Please wait..." : label; }

/* ---------- screens ---------- */
function showLogin() {
  $("#tabs").hidden = true; $("#logoutBtn").hidden = true;
  app.innerHTML = `
  <section class="card narrow">
    <h1>Sell on Zento</h1>
    <p class="muted">Open your own store, add products and get paid. Log in with your Zento account to begin.</p>
    <form id="loginForm">
      <label>Email<input type="email" id="lEmail" autocomplete="username" required></label>
      <label>Password<input type="password" id="lPass" autocomplete="current-password" required></label>
      <button class="btn block" type="submit">Log in</button>
      <div class="err" id="lErr"></div>
    </form>
    <p class="small muted">No account yet? <a href="/">Create one on the store</a> first, then come back here and apply as a seller.</p>
  </section>`;
  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.submitter || $("#loginForm button"); busy(btn, true, "Log in");
    try {
      const res = await fetch(API + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: $("#lEmail").value.trim(), password: $("#lPass").value }) });
      const data = await res.json();
      if (!res.ok || data.status !== "success") throw new Error(data.message || "Login failed");
      store.set(TOKEN_KEY, data.token); store.set(USER_KEY, JSON.stringify(data.user));
      start();
    } catch (err) { $("#lErr").textContent = err.message; busy(btn, false, "Log in"); }
  });
}

function applyForm(prefill = {}, note = "") {
  $("#tabs").hidden = true; $("#logoutBtn").hidden = false;
  app.innerHTML = `
  <section class="card narrow">
    <h1>Become a seller</h1>
    ${note ? `<p class="err" style="margin:0 0 8px">${esc(note)}</p>` : ""}
    <p class="muted">Tell us about your store. Our team reviews every application.</p>
    <form id="applyForm">
      <label>Store name<input id="aName" maxlength="60" value="${esc(prefill.store_name)}" required></label>
      <label>Phone<input id="aPhone" type="tel" value="${esc(prefill.phone)}" required></label>
      <div class="row2">
        <label>City<input id="aCity" value="${esc(prefill.city)}"></label>
        <label>Address<input id="aAddr" value="${esc(prefill.address)}"></label>
      </div>
      <label>What will you sell?<textarea id="aDesc" maxlength="800">${esc(prefill.description)}</textarea></label>
      <button class="btn block" type="submit">Submit application</button>
      <div class="err" id="aErr"></div>
    </form>
  </section>`;
  $("#applyForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#applyForm button"); busy(btn, true, "Submit application");
    try {
      await call("/api/seller/apply", { method: "POST", body: JSON.stringify({
        store_name: $("#aName").value, phone: $("#aPhone").value, city: $("#aCity").value,
        address: $("#aAddr").value, description: $("#aDesc").value }) });
      toast("Application submitted");
      start();
    } catch (err) { $("#aErr").textContent = err.message; busy(btn, false, "Submit application"); }
  });
}

function statusScreen(seller) {
  $("#tabs").hidden = true; $("#logoutBtn").hidden = false;
  if (seller.status === "rejected") return applyForm(seller, "Your application was rejected." + (seller.admin_note ? " Reason: " + seller.admin_note : "") + " You can fix it and apply again.");
  const msg = seller.status === "pending"
    ? "Your application is waiting for admin approval. You will be able to add products as soon as it is approved."
    : "Your seller account is suspended." + (seller.admin_note ? " Reason: " + seller.admin_note : "") + " Please contact support.";
  app.innerHTML = `<section class="card narrow center"><h1>${esc(seller.store_name)}</h1>
    <span class="pill ${seller.status === "pending" ? "warn" : "bad"}">${esc(seller.status)}</span>
    <p class="muted">${esc(msg)}</p><button class="btn ghost" id="refresh">Check again</button></section>`;
  $("#refresh").addEventListener("click", start);
}

/* ---------- dashboard ---------- */
const TABS = [["overview", "Overview"], ["products", "Products"], ["orders", "Orders"], ["wallet", "Wallet"], ["profile", "Store"]];

function buildTabs() {
  const t = $("#tabs"); t.hidden = false;
  t.innerHTML = TABS.map(([k, l]) => `<button data-t="${k}"${k === S.tab ? ' aria-current="page"' : ""}>${l}</button>`).join("");
  t.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => go(b.dataset.t)));
}

async function go(tab) {
  S.tab = tab; location.hash = tab; buildTabs();
  app.innerHTML = `<div class="center muted">Loading...</div>`;
  try {
    if (tab === "overview") { await loadMe(); viewOverview(); }
    if (tab === "products") { S.products = (await call("/api/seller/products")).products; viewProducts(); }
    if (tab === "orders") { S.orders = (await call("/api/seller/orders")).orders; viewOrders(); }
    if (tab === "wallet") { S.wallet = await call("/api/seller/wallet"); await loadMe(); viewWallet(); }
    if (tab === "profile") { await loadMe(); viewProfile(); }
  } catch (err) { app.innerHTML = `<div class="card center"><p class="err">${esc(err.message)}</p><button class="btn ghost" id="retry">Try again</button></div>`; $("#retry").addEventListener("click", () => go(tab)); }
}

async function loadMe() { S.me = await call("/api/seller/me"); }

function viewOverview() {
  const m = S.me, w = m.wallet, s = m.seller;
  app.innerHTML = `
  <div class="toolbar"><div><h1>${esc(s.store_name)} ${s.is_verified ? '<span class="badge">✔ Verified</span>' : ""}</h1>
    <span class="muted small">Your public store: <a href="/store/${esc(s.slug)}" target="_blank">${esc(location.origin)}/store/${esc(s.slug)}</a></span></div></div>
  <div class="grid g4">
    <div class="stat hi"><small>Available balance</small><b>${money(w.available)}</b></div>
    <div class="stat"><small>Pending (not delivered)</small><b>${money(w.pending_earnings)}</b></div>
    <div class="stat"><small>Total earned</small><b>${money(w.total_earned)}</b></div>
    <div class="stat"><small>Commission paid (${w.commission_percent}%)</small><b>${money(w.commission_paid)}</b></div>
    <div class="stat"><small>Products</small><b>${m.product_count}</b></div>
    <div class="stat"><small>Orders</small><b>${m.order_count}</b></div>
    <div class="stat"><small>Units sold</small><b>${m.units_sold}</b></div>
    <div class="stat"><small>Store rating</small><b><span class="stars">${stars(m.rating_avg)}</span> ${Number(m.rating_avg).toFixed(1)}</b><small>${m.rating_count} reviews</small></div>
  </div>
  <div class="card" style="margin-top:14px"><h2>How you get paid</h2>
    <p class="muted" style="margin:0">When an order with your product is marked <b>delivered</b>, Zento keeps ${w.commission_percent}% and the rest is added to your balance. Then request a withdrawal from the Wallet tab.</p></div>`;
}

/* products */
function viewProducts() {
  app.innerHTML = `<div class="toolbar"><h1>My products</h1><button class="btn" id="addP">+ Add product</button></div>
  <div class="card"><div class="tscroll"><table><thead><tr><th>Product</th><th>Category</th><th>Price</th><th>Stock</th><th>Rating</th><th></th></tr></thead><tbody>
  ${S.products.length ? S.products.map((p) => `<tr>
    <td><div class="pcell">${p.image_url ? `<img src="${esc(p.image_url)}" alt="">` : '<span class="thumb">🛍️</span>'}<b>${esc(p.name)}</b></div></td>
    <td>${esc(p.category || "-")}</td><td>${money(p.price)}</td>
    <td>${Number(p.stock) <= 0 ? '<span class="pill bad">Out</span>' : Number(p.stock) <= 5 ? `<span class="pill warn">${p.stock}</span>` : p.stock}</td>
    <td><span class="stars">${stars(p.rating_avg)}</span> <span class="muted small">(${p.rating_count})</span></td>
    <td style="white-space:nowrap"><button class="btn ghost sm" data-edit="${p.id}">Edit</button> <button class="btn danger sm" data-del="${p.id}">Delete</button></td></tr>`).join("")
    : `<tr><td colspan="6" class="center muted">No products yet. Add your first product.</td></tr>`}
  </tbody></table></div></div>`;
  $("#addP").addEventListener("click", () => productModal());
  app.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => productModal(S.products.find((p) => p.id == b.dataset.edit))));
  app.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm("Delete this product?")) return;
    try { await call(`/api/seller/products/${b.dataset.del}`, { method: "DELETE" }); toast("Product deleted"); go("products"); } catch (e) { toast(e.message, "error"); }
  }));
}

function openModal(html) {
  const bg = document.createElement("div"); bg.className = "modal-bg";
  bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  bg.addEventListener("mousedown", (e) => { if (e.target === bg) bg.remove(); });
  document.body.appendChild(bg);
  return bg;
}

function productModal(p) {
  const bg = openModal(`<h2>${p ? "Edit product" : "Add product"}</h2>
  <form id="pf">
    <label>Photo</label>
    <input type="file" id="pImg" accept="image/png,image/jpeg,image/webp">
    ${p && p.image_url ? `<img class="upload-preview" id="pPrev" src="${esc(p.image_url)}" alt="">` : '<img class="upload-preview" id="pPrev" hidden alt="">'}
    <label>Name<input id="pName" maxlength="200" value="${esc(p?.name)}" required></label>
    <div class="row2">
      <label>Category<input id="pCat" value="${esc(p?.category)}"></label>
      <label>Price (BDT)<input id="pPrice" type="number" min="0" step="0.01" value="${p ? p.price : ""}" required></label>
    </div>
    <label>Stock<input id="pStock" type="number" min="0" step="1" value="${p ? p.stock : ""}" required></label>
    <label>Description<textarea id="pDesc" maxlength="3000">${esc(p?.description)}</textarea></label>
    <div class="err" id="pErr"></div>
    <div style="display:flex;gap:10px;margin-top:12px"><button type="button" class="btn ghost" id="pCancel">Cancel</button><button class="btn" style="flex:1" type="submit">Save</button></div>
  </form>`);
  let file = null;
  $("#pCancel", bg).addEventListener("click", () => bg.remove());
  $("#pImg", bg).addEventListener("change", (e) => {
    file = e.target.files[0] || null;
    if (file) { const prev = $("#pPrev", bg); prev.src = URL.createObjectURL(file); prev.hidden = false; }
  });
  $("#pf", bg).addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#pf button[type=submit]", bg); busy(btn, true, "Save");
    try {
      let image_url = p?.image_url || "";
      if (file) image_url = await uploadImage(file);
      const body = JSON.stringify({ name: $("#pName", bg).value, category: $("#pCat", bg).value, price: $("#pPrice", bg).value,
        stock: $("#pStock", bg).value, description: $("#pDesc", bg).value, image_url });
      if (p) await call(`/api/seller/products/${p.id}`, { method: "PUT", body });
      else await call("/api/seller/products", { method: "POST", body });
      bg.remove(); toast(p ? "Product updated" : "Product added"); go("products");
    } catch (err) { $("#pErr", bg).textContent = err.message || "Could not save"; busy(btn, false, "Save"); }
  });
}

/* orders */
const pillFor = (s) => ({ delivered: "good", pending: "warn" }[s] || "info");
function viewOrders() {
  app.innerHTML = `<div class="toolbar"><h1>Orders</h1></div>
  <div class="card"><div class="tscroll"><table><thead><tr><th>Order</th><th>Product</th><th>Qty</th><th>Sale</th><th>You earn</th><th>Status</th><th>Customer</th></tr></thead><tbody>
  ${S.orders.length ? S.orders.map((o) => `<tr>
    <td><b>#ZT-${String(o.order_id).padStart(4, "0")}</b><br><span class="muted small">${when(o.created_at)}</span></td>
    <td>${esc(o.product_name)}</td><td>${o.quantity}</td><td>${money(o.subtotal)}</td>
    <td>${o.credited_at ? `<span class="amt-plus">${money(o.seller_earning)}</span><br><span class="muted small">−${money(o.commission_amount)} fee</span>` : '<span class="muted small">after delivery</span>'}</td>
    <td><span class="pill ${pillFor(o.status)}">${esc(String(o.status).replace(/_/g, " "))}</span></td>
    <td>${esc(o.customer_name)}<br><span class="muted small">${esc(o.phone)}<br>${esc(o.address)}${o.city ? ", " + esc(o.city) : ""}</span></td></tr>`).join("")
    : `<tr><td colspan="7" class="center muted">No orders yet.</td></tr>`}
  </tbody></table></div></div>`;
}

/* wallet */
function viewWallet() {
  const w = S.wallet.wallet, min = S.me.min_withdrawal, seller = S.me.seller;
  const hasPayout = seller.payout_method && seller.payout_account;
  app.innerHTML = `<div class="toolbar"><h1>Wallet</h1></div>
  <div class="grid g3">
    <div class="stat hi"><small>Available to withdraw</small><b>${money(w.available)}</b></div>
    <div class="stat"><small>Pending withdrawals</small><b>${money(w.pending_withdrawal)}</b></div>
    <div class="stat"><small>Already paid out</small><b>${money(w.withdrawn)}</b></div>
  </div>
  <div class="card" style="margin-top:14px"><h2>Request withdrawal</h2>
    ${hasPayout ? `<p class="muted small" style="margin:0 0 6px">Money will be sent to your ${esc(seller.payout_method)} account <b>${esc(seller.payout_account)}</b>. Minimum ${money(min)}.</p>
    <form id="wf" style="display:flex;gap:10px;flex-wrap:wrap"><input id="wAmt" type="number" min="1" step="0.01" placeholder="Amount" style="flex:1;min-width:140px" required><button class="btn" type="submit">Request</button></form><div class="err" id="wErr"></div>`
    : `<p class="muted">Add your bKash / Nagad / bank account in the <a href="#profile" id="goProfile">Store tab</a> before withdrawing.</p>`}
  </div>
  <div class="card"><h2>Withdrawal requests</h2><div class="tscroll"><table><thead><tr><th>Date</th><th>Amount</th><th>To</th><th>Status</th><th>Note</th></tr></thead><tbody>
  ${S.wallet.withdrawals.length ? S.wallet.withdrawals.map((x) => `<tr><td>${when(x.created_at)}</td><td>${money(x.amount)}</td><td>${esc(x.method)} ${esc(x.account)}</td>
    <td><span class="pill ${x.status === "approved" ? "good" : x.status === "rejected" ? "bad" : "warn"}">${x.status === "approved" ? "paid" : esc(x.status)}</span></td><td>${esc(x.admin_note)}</td></tr>`).join("")
    : `<tr><td colspan="5" class="center muted">No withdrawals yet.</td></tr>`}</tbody></table></div></div>
  <div class="card"><h2>Transactions</h2><div class="tscroll"><table><thead><tr><th>Date</th><th>Details</th><th>Amount</th></tr></thead><tbody>
  ${S.wallet.transactions.length ? S.wallet.transactions.map((t) => `<tr><td>${when(t.created_at)}</td><td>${esc(t.note)}</td>
    <td class="${t.amount >= 0 ? "amt-plus" : "amt-minus"}">${t.amount >= 0 ? "+" : "−"}${money(Math.abs(t.amount))}</td></tr>`).join("")
    : `<tr><td colspan="3" class="center muted">No transactions yet.</td></tr>`}</tbody></table></div></div>`;
  const g = $("#goProfile"); if (g) g.addEventListener("click", (e) => { e.preventDefault(); go("profile"); });
  const f = $("#wf");
  if (f) f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#wf button"); busy(btn, true, "Request");
    try { await call("/api/seller/withdrawals", { method: "POST", body: JSON.stringify({ amount: $("#wAmt").value }) }); toast("Withdrawal request sent"); go("wallet"); }
    catch (err) { $("#wErr").textContent = err.message; busy(btn, false, "Request"); }
  });
}

/* profile */
function viewProfile() {
  const s = S.me.seller;
  app.innerHTML = `<div class="toolbar"><h1>Store profile</h1><a class="btn ghost sm" href="/store/${esc(s.slug)}" target="_blank">View my store</a></div>
  <form class="card" id="sf">
    <h2>Store page</h2>
    <label>Store name<input id="sName" maxlength="60" value="${esc(s.store_name)}" required></label>
    <label>About your store<textarea id="sDesc" maxlength="800">${esc(s.description)}</textarea></label>
    <div class="row2">
      <div><label>Logo</label><input type="file" id="sLogo" accept="image/png,image/jpeg,image/webp">${s.logo_url ? `<img class="upload-preview" id="sLogoP" src="${esc(s.logo_url)}" alt="">` : '<img class="upload-preview" id="sLogoP" hidden alt="">'}</div>
      <div><label>Banner</label><input type="file" id="sBanner" accept="image/png,image/jpeg,image/webp">${s.banner_url ? `<img class="upload-preview" id="sBannerP" src="${esc(s.banner_url)}" alt="">` : '<img class="upload-preview" id="sBannerP" hidden alt="">'}</div>
    </div>
    <div class="row2"><label>Phone<input id="sPhone" value="${esc(s.phone)}"></label><label>City<input id="sCity" value="${esc(s.city)}"></label></div>
    <label>Address<input id="sAddr" value="${esc(s.address)}"></label>
    <h2 style="margin-top:18px">Payout account</h2>
    <div class="row2">
      <label>Method<select id="sPM"><option value="">Select</option>${["bkash", "nagad", "rocket", "bank"].map((m) => `<option value="${m}"${s.payout_method === m ? " selected" : ""}>${m}</option>`).join("")}</select></label>
      <label>Account number<input id="sPA" value="${esc(s.payout_account)}" placeholder="01XXXXXXXXX or bank details"></label>
    </div>
    <button class="btn block" type="submit">Save</button><div class="err" id="sErr"></div>
  </form>`;
  const files = {};
  [["sLogo", "sLogoP", "logo"], ["sBanner", "sBannerP", "banner"]].forEach(([inp, prev, key]) => {
    $("#" + inp).addEventListener("change", (e) => {
      files[key] = e.target.files[0]; if (files[key]) { $("#" + prev).src = URL.createObjectURL(files[key]); $("#" + prev).hidden = false; }
    });
  });
  $("#sf").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#sf button[type=submit]"); busy(btn, true, "Save");
    try {
      const logo_url = files.logo ? await uploadImage(files.logo) : s.logo_url;
      const banner_url = files.banner ? await uploadImage(files.banner) : s.banner_url;
      await call("/api/seller/me", { method: "PUT", body: JSON.stringify({
        store_name: $("#sName").value, description: $("#sDesc").value, logo_url, banner_url, phone: $("#sPhone").value,
        city: $("#sCity").value, address: $("#sAddr").value, payout_method: $("#sPM").value, payout_account: $("#sPA").value }) });
      toast("Store saved"); go("profile");
    } catch (err) { $("#sErr").textContent = err.message || "Could not save"; busy(btn, false, "Save"); }
  });
}

/* ---------- boot ---------- */
async function start() {
  if (!store.get(TOKEN_KEY)) return showLogin();
  $("#logoutBtn").hidden = false;
  try {
    await loadMe();
  } catch (err) { if (!store.get(TOKEN_KEY)) return showLogin(); app.innerHTML = `<div class="card center"><p class="err">${esc(err.message)}</p><button class="btn ghost" onclick="location.reload()">Reload</button></div>`; return; }
  const seller = S.me.seller;
  if (!seller) return applyForm();
  if (seller.status !== "approved") return statusScreen(seller);
  const h = (location.hash || "").slice(1);
  go(TABS.some(([k]) => k === h) ? h : "overview");
}
start();
