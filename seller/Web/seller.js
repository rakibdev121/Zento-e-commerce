/* ZENTO SELLER CENTER */
import { supabase } from "./js/supabase.js";

// The Seller Center is its own website/service, so the API is always on the same address.
const API = location.origin;

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
function authShell(mode) {
  $("#tabs").hidden = true; $("#logoutBtn").hidden = true;
  app.innerHTML = `
  <section class="card narrow">
    <h1>Zento Seller Center</h1>
    <p class="muted">Sell your products on Zento. Apply once, and our team will send you your login ID and password.</p>
    <div class="seg" role="tablist">
      <button type="button" data-m="login" class="${mode === "login" ? "on" : ""}">Seller login</button>
      <button type="button" data-m="apply" class="${mode === "apply" ? "on" : ""}">Apply as seller</button>
    </div>
    <div id="authBody"></div>
  </section>`;
  app.querySelectorAll(".seg button").forEach((b) => b.addEventListener("click", () => authShell(b.dataset.m)));
  return $("#authBody");
}

function showLogin() {
  const body = authShell("login");
  body.innerHTML = `
    <form id="loginForm">
      <label>Login ID (email)<input type="email" id="lEmail" autocomplete="username" required></label>
      <label>Password<input type="password" id="lPass" autocomplete="current-password" required></label>
      <button class="btn block" type="submit">Log in</button>
      <div class="err" id="lErr"></div>
    </form>
    <p class="small muted"><a href="#" id="forgotLink">Forgot your password?</a></p>
    <p class="small muted">Got your ID and password from Zento? Enter them above. No ID yet? Tap <b>Apply as seller</b>.</p>`;
  $("#forgotLink").addEventListener("click", (e) => { e.preventDefault(); showForgot(); });
  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.submitter || $("#loginForm button"); busy(btn, true, "Log in");
    try {
      const res = await fetch(API + "/api/seller/login", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: $("#lEmail").value.trim(), password: $("#lPass").value }) });
      const data = await res.json();
      if (!res.ok || data.status !== "success") throw new Error(data.message || "Login failed");
      store.set(TOKEN_KEY, data.token); store.set(USER_KEY, JSON.stringify(data.user));
      start();
    } catch (err) { $("#lErr").textContent = err.message; busy(btn, false, "Log in"); }
  });
}

function showForgot() {
  const body = authShell("login");
  body.innerHTML = `
    <form id="fpForm">
      <p class="muted small" style="margin:6px 0 0">Enter your seller login email. We will send you a link to choose a new password.</p>
      <label>Login ID (email)<input type="email" id="fpEmail" autocomplete="username" required></label>
      <button class="btn block" type="submit">Send reset link</button>
      <div class="err" id="fpErr"></div>
    </form>
    <p class="small muted"><a href="#" id="fpBack">Back to login</a></p>`;
  $("#fpBack").addEventListener("click", (e) => { e.preventDefault(); showLogin(); });
  $("#fpForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#fpForm button"); busy(btn, true, "Send reset link");
    try {
      const res = await fetch(API + "/api/seller/forgot-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: $("#fpEmail").value.trim() }) });
      const data = await res.json();
      $("#fpForm").innerHTML = `<div class="okbox"><b>Check your email</b><p>${esc(data.message || "If this email belongs to a seller account, a reset link has been sent.")}</p><p class="small muted">The link works once and expires in 30 minutes.</p></div>`;
    } catch (err) { $("#fpErr").textContent = "Could not send. Try again."; busy(btn, false, "Send reset link"); }
  });
}

function showReset(token) {
  const body = authShell("login");
  body.innerHTML = `
    <form id="rsForm">
      <p class="muted small" style="margin:6px 0 0">Choose a new password for your seller account.</p>
      <label>New password (min 8 characters)<input type="password" id="rsNew" minlength="8" autocomplete="new-password" required></label>
      <label>Repeat new password<input type="password" id="rsNew2" minlength="8" autocomplete="new-password" required></label>
      <button class="btn block" type="submit">Save password</button>
      <div class="err" id="rsErr"></div>
    </form>`;
  $("#rsForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if ($("#rsNew").value !== $("#rsNew2").value) { $("#rsErr").textContent = "The two passwords do not match"; return; }
    const btn = $("#rsForm button"); busy(btn, true, "Save password");
    try {
      const res = await fetch(API + "/api/seller/reset-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, new_password: $("#rsNew").value }) });
      const data = await res.json();
      if (!res.ok || data.status !== "success") throw new Error(data.message || "Could not reset");
      history.replaceState(null, "", location.pathname);
      toast("Password changed. Please log in.");
      showLogin();
    } catch (err) { $("#rsErr").textContent = err.message; busy(btn, false, "Save password"); }
  });
}

function showApply() {
  const body = authShell("apply");
  body.innerHTML = `
    <form id="pubForm">
      <label>Your full name<input id="pOwner" maxlength="80" autocomplete="name" required></label>
      <label>Store name<input id="pStore" maxlength="60" required></label>
      <label>Email (this will be your login ID)<input id="pEmail" type="email" autocomplete="email" required></label>
      <label>Phone<input id="pPhone" type="tel" autocomplete="tel" required></label>
      <div class="row2">
        <label>City<input id="pCity"></label>
        <label>Address<input id="pAddr"></label>
      </div>
      <label>NID / Trade licence number (optional)<input id="pId" maxlength="40"></label>
      <label>What will you sell?<textarea id="pDesc" maxlength="800"></textarea></label>
      <button class="btn block" type="submit">Submit application</button>
      <div class="err" id="pErr"></div>
    </form>`;
  $("#pubForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#pubForm button[type=submit]"); busy(btn, true, "Submit application");
    try {
      const res = await fetch(API + "/api/seller/apply-public", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner_name: $("#pOwner").value, store_name: $("#pStore").value, email: $("#pEmail").value,
          phone: $("#pPhone").value, city: $("#pCity").value, address: $("#pAddr").value,
          id_number: $("#pId").value, description: $("#pDesc").value }) });
      const data = await res.json();
      if (!res.ok || data.status !== "success") throw new Error(data.message || "Could not submit");
      showApplied(data.message);
    } catch (err) { $("#pErr").textContent = err.message; busy(btn, false, "Submit application"); }
  });
}

function showApplied(msg) {
  const body = authShell("apply");
  body.innerHTML = `<div class="okbox"><b>Application received</b><p>${esc(msg)}</p>
    <p class="small muted">Keep your phone and email handy. After approval you will receive a login ID and a temporary password.</p></div>
    <button class="btn ghost block" id="toLogin">Go to seller login</button>`;
  $("#toLogin").addEventListener("click", showLogin);
}

function showChangePassword(forced) {
  $("#tabs").hidden = true; $("#logoutBtn").hidden = false;
  app.innerHTML = `
  <section class="card narrow">
    <h1>${forced ? "Set your own password" : "Change password"}</h1>
    ${forced ? '<p class="muted">You logged in with a temporary password. Choose a new one to continue.</p>' : ""}
    <form id="cpForm">
      <label>Current (temporary) password<input type="password" id="cpOld" autocomplete="current-password" required></label>
      <label>New password (min 8 characters)<input type="password" id="cpNew" minlength="8" autocomplete="new-password" required></label>
      <label>Repeat new password<input type="password" id="cpNew2" minlength="8" autocomplete="new-password" required></label>
      <button class="btn block" type="submit">Save password</button>
      <div class="err" id="cpErr"></div>
    </form>
  </section>`;
  $("#cpForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#cpForm button"); 
    if ($("#cpNew").value !== $("#cpNew2").value) { $("#cpErr").textContent = "The two new passwords do not match"; return; }
    busy(btn, true, "Save password");
    try {
      await call("/api/seller/change-password", { method: "POST", body: JSON.stringify({ current_password: $("#cpOld").value, new_password: $("#cpNew").value }) });
      toast("Password changed"); start();
    } catch (err) { $("#cpErr").textContent = err.message; busy(btn, false, "Save password"); }
  });
}

function notSellerScreen() {
  $("#tabs").hidden = true; $("#logoutBtn").hidden = false;
  app.innerHTML = `<section class="card narrow center"><h1>This is not a seller account</h1>
    <p class="muted">You are logged in with a customer account. Log out and use the seller ID and password sent to you by Zento, or apply as a seller.</p>
    <button class="btn" id="nsOut">Log out</button></section>`;
  $("#nsOut").addEventListener("click", () => logout());
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
const TABS = [["overview", "Overview"], ["products", "Products"], ["orders", "Orders"], ["coupons", "Coupons"], ["wallet", "Wallet"], ["profile", "Store"]];

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
    if (tab === "products") { await loadMe(); S.products = (await call("/api/seller/products")).products; viewProducts(); }
    if (tab === "orders") { S.orders = (await call("/api/seller/orders")).orders; viewOrders(); }
    if (tab === "coupons") { S.coupons = (await call("/api/seller/coupons")).coupons; viewCoupons(); }
    if (tab === "wallet") { S.wallet = await call("/api/seller/wallet"); await loadMe(); viewWallet(); }
    if (tab === "profile") { await loadMe(); viewProfile(); }
  } catch (err) { app.innerHTML = `<div class="card center"><p class="err">${esc(err.message)}</p><button class="btn ghost" id="retry">Try again</button></div>`; $("#retry").addEventListener("click", () => go(tab)); }
}

async function loadMe() { S.me = await call("/api/seller/me"); }

function viewOverview() {
  const m = S.me, w = m.wallet, s = m.seller;
  app.innerHTML = `
  <div class="toolbar"><div><h1>${esc(s.store_name)} ${s.is_verified ? '<span class="badge">✔ Verified</span>' : ""}</h1>
    <span class="muted small">Your public store: ${S.me.store_base_url ? `<a href="${esc(S.me.store_base_url)}/store/${esc(s.slug)}" target="_blank" rel="noopener">${esc(S.me.store_base_url)}/store/${esc(s.slug)}</a>` : `<b>/store/${esc(s.slug)}</b>`}</span></div></div>
  <div class="grid g4">
    <div class="stat hi"><small>Available balance</small><b>${money(w.available)}</b></div>
    <div class="stat"><small>Pending (not delivered)</small><b>${money(w.pending_earnings)}</b></div>
    <div class="stat"><small>Total earned</small><b>${money(w.total_earned)}</b></div>
    <div class="stat"><small>Total profit (after cost)</small><b class="${Number(m.profit_total) >= 0 ? "amt-plus" : "amt-minus"}">${money(m.profit_total)}</b><small>delivered orders only</small></div>
    <div class="stat"><small>Commission paid (${w.commission_percent}%)</small><b>${money(w.commission_paid)}</b></div>
    <div class="stat"><small>Products</small><b>${m.product_count}</b></div>
    <div class="stat"><small>Orders</small><b>${m.order_count}</b></div>
    <div class="stat"><small>Units sold</small><b>${m.units_sold}</b></div>
    <div class="stat"><small>Store rating</small><b><span class="stars">${stars(m.rating_avg)}</span> ${Number(m.rating_avg).toFixed(1)}</b><small>${m.rating_count} reviews</small></div>
  </div>
  ${Number(m.products_missing_cost) > 0 ? `<div class="card warnbox" style="margin-top:14px"><b>${m.products_missing_cost} product(s) have no cost price.</b> Open Products and edit them to add the cost price, so your profit can be calculated.</div>` : ""}
  <div class="card" style="margin-top:14px"><h2>How you get paid</h2>
    <p class="muted" style="margin:0">When an order with your product is marked <b>delivered</b>, Zento keeps ${w.commission_percent}% and the rest is added to your balance. Then request a withdrawal from the Wallet tab.</p>
    <p class="muted small" style="margin:8px 0 0"><b>Coupons:</b> if you give a discount with your own coupon, you pay that discount. If Zento gives a discount coupon, Zento pays it and you still get your full price.</p>
    <p class="muted small" style="margin:8px 0 0"><b>Returns:</b> if a customer returns a delivered order, it is the seller's responsibility. The money you earned is taken back and the delivery charge of that order (৳70 / ৳130) is charged to you. Zento does not carry the cost of returns.${Number(w.returns_charged) > 0 ? ` Return charges so far: <b>${money(w.returns_charged)}</b>.` : ""}</p></div>`;
}

/* products */
function viewProducts() {
  app.innerHTML = `<div class="toolbar"><h1>My products</h1><button class="btn" id="addP">+ Add product</button></div>
  <div class="card"><div class="tscroll"><table><thead><tr><th>Product</th><th>Category</th><th>Price</th><th>Cost</th><th>Profit / unit</th><th>Stock</th><th>Rating</th><th></th></tr></thead><tbody>
  ${S.products.length ? S.products.map((p) => `<tr>
    <td><div class="pcell">${p.image_url ? `<img src="${esc(p.image_url)}" alt="">` : '<span class="thumb">🛍️</span>'}<b>${esc(p.name)}</b></div></td>
    <td>${esc(p.category || "-")}</td><td>${money(p.price)}</td>
    <td>${p.cost_price == null ? '<span class="pill warn">Add cost</span>' : money(p.cost_price)}</td>
    <td>${p.profit_per_unit == null ? '<span class="muted small">-</span>' : `<span class="${Number(p.profit_per_unit) >= 0 ? "amt-plus" : "amt-minus"}">${money(p.profit_per_unit)}</span>`}</td>
    <td>${Number(p.stock) <= 0 ? '<span class="pill bad">Out</span>' : Number(p.stock) <= 5 ? `<span class="pill warn">${p.stock}</span>` : p.stock}</td>
    <td><span class="stars">${stars(p.rating_avg)}</span> <span class="muted small">(${p.rating_count})</span></td>
    <td style="white-space:nowrap"><button class="btn ghost sm" data-edit="${p.id}">Edit</button> <button class="btn danger sm" data-del="${p.id}">Delete</button></td></tr>`).join("")
    : `<tr><td colspan="8" class="center muted">No products yet. Add your first product.</td></tr>`}
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
    <label>Category<input id="pCat" value="${esc(p?.category)}"></label>
    <div class="row2">
      <label>Cost price (BDT) <span class="muted small">what you pay to buy or make it</span><input id="pCost" type="number" min="0" step="0.01" value="${p && p.cost_price != null ? p.cost_price : ""}" required></label>
      <label>Selling price (BDT)<input id="pPrice" type="number" min="0" step="0.01" value="${p ? p.price : ""}" required></label>
    </div>
    <div class="profit-box" id="pProfit" aria-live="polite"></div>
    <label>Stock<input id="pStock" type="number" min="0" step="1" value="${p ? p.stock : ""}" required></label>
    <label>Description<textarea id="pDesc" maxlength="3000">${esc(p?.description)}</textarea></label>
    <div class="err" id="pErr"></div>
    <div style="display:flex;gap:10px;margin-top:12px"><button type="button" class="btn ghost" id="pCancel">Cancel</button><button class="btn" style="flex:1" type="submit">Save</button></div>
  </form>`);
  let file = null;
  const rate = Number(S.me?.wallet?.commission_percent ?? 10);
  const showProfit = () => {
    const price = Number($("#pPrice", bg).value), cost = Number($("#pCost", bg).value);
    const box = $("#pProfit", bg);
    if (!$("#pPrice", bg).value || !$("#pCost", bg).value || isNaN(price) || isNaN(cost)) { box.innerHTML = '<span class="muted small">Enter cost and selling price to see your profit.</span>'; return; }
    const fee = Math.round(price * rate) / 100, profit = price - fee - cost;
    const margin = price > 0 ? (profit / price) * 100 : 0;
    box.innerHTML = `<div><span>Selling price</span><b>${money(price)}</b></div>
      <div><span>Zento commission (${rate}%)</span><b>−${money(fee)}</b></div>
      <div><span>Your cost</span><b>−${money(cost)}</b></div>
      <div class="tot"><span>Profit per unit</span><b class="${profit >= 0 ? "amt-plus" : "amt-minus"}">${money(profit)} (${margin.toFixed(0)}%)</b></div>
      ${profit < 0 ? '<p class="err" style="margin:6px 0 0;min-height:0">You will lose money on every sale at this price.</p>' : ""}`;
  };
  ["pPrice", "pCost"].forEach((id) => $("#" + id, bg).addEventListener("input", showProfit));
  showProfit();
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
      const body = JSON.stringify({ name: $("#pName", bg).value, category: $("#pCat", bg).value, price: $("#pPrice", bg).value, cost_price: $("#pCost", bg).value,
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
  <div class="card"><div class="tscroll"><table><thead><tr><th>Order</th><th>Product</th><th>Qty</th><th>Sale</th><th>You earn</th><th>Profit</th><th>Status</th><th>Shipping</th><th>Customer</th></tr></thead><tbody>
  ${S.orders.length ? S.orders.map((o) => `<tr>
    <td><b>#ZT-${String(o.order_id).padStart(4, "0")}</b><br><span class="muted small">${when(o.created_at)}</span></td>
    <td>${esc(o.product_name)}</td><td>${o.quantity}</td><td>${money(o.subtotal)}</td>
    <td>${o.credited_at ? `<span class="amt-plus">${money(o.seller_earning)}</span><br><span class="muted small">−${money(o.commission_amount)} fee</span>` : '<span class="muted small">after delivery</span>'}</td>
    <td>${o.profit == null ? '<span class="muted small">no cost</span>' : `<span class="${Number(o.profit) >= 0 ? "amt-plus" : "amt-minus"}">${money(o.profit)}</span>${o.profit_is_estimate ? '<br><span class="muted small">estimate</span>' : ""}<br><span class="muted small">cost ${money(o.cost_total)}</span>`}</td>
    <td><span class="pill ${pillFor(o.status)}">${esc(String(o.status).replace(/_/g, " "))}</span></td>
    <td>${o.tracking_no ? `<b>${esc(o.courier)}</b><br><span class="muted small">${esc(o.tracking_no)}</span>${["approved", "processing", "shipped"].includes(o.status) ? `<br><button class="btn ghost sm" data-ship="${o.id}">Edit</button>` : ""}`
      : ["approved", "processing"].includes(o.status) ? `<button class="btn sm" data-ship="${o.id}">Mark shipped</button>`
      : o.status === "pending" ? '<span class="muted small">After Zento approves</span>' : '<span class="muted small">-</span>'}</td>
    <td>${esc(o.customer_name)}<br><span class="muted small">${esc(o.phone)}<br>${esc(o.address)}${o.city ? ", " + esc(o.city) : ""}</span></td></tr>`).join("")
    : `<tr><td colspan="9" class="center muted">No orders yet.</td></tr>`}
  </tbody></table></div></div>`;
  app.querySelectorAll("[data-ship]").forEach((b) => b.addEventListener("click", () => shipModal(S.orders.find((x) => x.id == b.dataset.ship))));
}

const COURIERS = ["Pathao", "Steadfast", "RedX", "Paperfly", "eCourier", "Sundarban", "SA Paribahan", "Own delivery", "Other"];
function shipModal(o) {
  const bg = openModal(`<h2>Ship: ${esc(o.product_name)} × ${o.quantity}</h2>
  <p class="muted small" style="margin:0 0 6px">Order #ZT-${String(o.order_id).padStart(4, "0")} · ${esc(o.customer_name)}, ${esc(o.phone)}</p>
  <form id="sf2">
    <label>Courier<select id="shC">${COURIERS.map((c) => `<option${o.courier === c ? " selected" : ""}>${c}</option>`).join("")}</select></label>
    <label>Tracking number <span class="muted small">(for own delivery write the rider name or phone)</span><input id="shT" maxlength="60" value="${esc(o.tracking_no || "")}" required></label>
    <div class="err" id="shErr"></div>
    <div style="display:flex;gap:10px;margin-top:12px"><button type="button" class="btn ghost" id="shCancel">Cancel</button><button class="btn" style="flex:1" type="submit">Save and mark shipped</button></div>
  </form>`);
  $("#shCancel", bg).addEventListener("click", () => bg.remove());
  $("#sf2", bg).addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#sf2 button[type=submit]", bg); busy(btn, true, "Save and mark shipped");
    try {
      await call(`/api/seller/orders/${o.id}/ship`, { method: "POST", body: JSON.stringify({ courier: $("#shC", bg).value, tracking_no: $("#shT", bg).value }) });
      bg.remove(); toast("Marked as shipped"); go("orders");
    } catch (err) { $("#shErr", bg).textContent = err.message; busy(btn, false, "Save and mark shipped"); }
  });
}

/* coupons */
const cpDate = (v) => { if (!v) return ""; const d = new Date(v); return isNaN(d) ? "" : d.toLocaleDateString("en-CA", { timeZone: "Asia/Dhaka" }); };
const cpValue = (c) => c.discount_type === "percent" ? `${Number(c.value)}%${c.max_discount != null ? ` (max ${money(c.max_discount)})` : ""}` : money(c.value);
function cpState(c) {
  const now = Date.now();
  if (!c.active) return ["Off", "bad"];
  if (c.expires_at && new Date(c.expires_at) < now) return ["Expired", "bad"];
  if (c.starts_at && new Date(c.starts_at) > now) return ["Scheduled", "warn"];
  if (c.usage_limit != null && c.used_count >= c.usage_limit) return ["Fully used", "warn"];
  return ["Live", "good"];
}
function viewCoupons() {
  app.innerHTML = `<div class="toolbar"><h1>My coupons</h1><button class="btn" id="addC">+ New coupon</button></div>
  <div class="card"><p class="muted small" style="margin:0">Your coupons work only on your products. The discount is paid from your sale price. Zento commission is then taken on the price the customer paid.</p></div>
  <div class="card"><div class="tscroll"><table><thead><tr><th>Code</th><th>Discount</th><th>Used</th><th>Discount given</th><th>Status</th><th></th></tr></thead><tbody>
  ${S.coupons.length ? S.coupons.map((c) => { const [st, cls] = cpState(c); return `<tr>
    <td><b>${esc(c.code)}</b>${Number(c.min_order) > 0 ? `<br><span class="muted small">Min order ${money(c.min_order)}</span>` : ""}<br><span class="muted small">${c.expires_at ? "Until " + cpDate(c.expires_at) : "No expiry"}</span></td>
    <td>${esc(cpValue(c))}</td>
    <td>${c.used_count}${c.usage_limit != null ? " / " + c.usage_limit : ""}<br><span class="muted small">${c.per_user_limit} per customer</span></td>
    <td>${money(c.discount_given)}</td>
    <td><span class="pill ${cls}">${st}</span></td>
    <td style="white-space:nowrap"><button class="btn ghost sm" data-cedit="${c.id}">Edit</button> <button class="btn ghost sm" data-ctog="${c.id}">${c.active ? "Turn off" : "Turn on"}</button> <button class="btn danger sm" data-cdel="${c.id}">Delete</button></td></tr>`; }).join("")
    : `<tr><td colspan="6" class="center muted">No coupons yet. Create one to attract customers.</td></tr>`}
  </tbody></table></div></div>`;
  $("#addC").addEventListener("click", () => couponModal());
  app.querySelectorAll("[data-cedit]").forEach((b) => b.addEventListener("click", () => couponModal(S.coupons.find((c) => c.id == b.dataset.cedit))));
  app.querySelectorAll("[data-ctog]").forEach((b) => b.addEventListener("click", async () => {
    const c = S.coupons.find((x) => x.id == b.dataset.ctog);
    try { await call(`/api/seller/coupons/${c.id}`, { method: "PUT", body: JSON.stringify({ active: !c.active }) }); go("coupons"); } catch (e) { toast(e.message, "error"); }
  }));
  app.querySelectorAll("[data-cdel]").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm("Delete this coupon?")) return;
    try { const r = await call(`/api/seller/coupons/${b.dataset.cdel}`, { method: "DELETE" }); toast(r.message); go("coupons"); } catch (e) { toast(e.message, "error"); }
  }));
}

function couponModal(c) {
  const v = c || { discount_type: "percent", per_user_limit: 1, active: true };
  const bg = openModal(`<h2>${c ? "Edit coupon" : "New coupon"}</h2>
  <form id="cf">
    <label>Coupon code<input id="cCode" maxlength="40" value="${esc(v.code || "")}" placeholder="SAVE10" style="text-transform:uppercase" required></label>
    <div class="row2">
      <label>Type<select id="cType"><option value="percent"${v.discount_type === "percent" ? " selected" : ""}>Percent (%)</option><option value="fixed"${v.discount_type === "fixed" ? " selected" : ""}>Fixed amount (BDT)</option></select></label>
      <label>Value<input id="cValue" type="number" min="0" step="0.01" value="${v.value ?? ""}" required></label>
    </div>
    <div class="row2">
      <label>Max discount (BDT, percent only)<input id="cMax" type="number" min="0" step="0.01" value="${v.max_discount ?? ""}" placeholder="optional"></label>
      <label>Minimum order (BDT)<input id="cMin" type="number" min="0" step="0.01" value="${Number(v.min_order) || ""}" placeholder="0"></label>
    </div>
    <div class="row2">
      <label>Total uses allowed<input id="cLimit" type="number" min="0" step="1" value="${v.usage_limit ?? ""}" placeholder="unlimited"></label>
      <label>Uses per customer<input id="cPer" type="number" min="1" step="1" value="${v.per_user_limit ?? 1}"></label>
    </div>
    <div class="row2">
      <label>Starts on<input id="cStart" type="date" value="${cpDate(v.starts_at)}"></label>
      <label>Ends on<input id="cEnd" type="date" value="${cpDate(v.expires_at)}"></label>
    </div>
    <div class="err" id="cErr"></div>
    <div style="display:flex;gap:10px;margin-top:12px"><button type="button" class="btn ghost" id="cCancel">Cancel</button><button class="btn" style="flex:1" type="submit">${c ? "Save" : "Create coupon"}</button></div>
  </form>`);
  $("#cCancel", bg).addEventListener("click", () => bg.remove());
  $("#cf", bg).addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#cf button[type=submit]", bg); busy(btn, true, c ? "Save" : "Create coupon");
    const body = JSON.stringify({ code: $("#cCode", bg).value, discount_type: $("#cType", bg).value, value: $("#cValue", bg).value,
      max_discount: $("#cMax", bg).value, min_order: $("#cMin", bg).value, usage_limit: $("#cLimit", bg).value,
      per_user_limit: $("#cPer", bg).value, starts_at: $("#cStart", bg).value, expires_at: $("#cEnd", bg).value, active: c ? c.active : true });
    try {
      const r = await call(c ? `/api/seller/coupons/${c.id}` : "/api/seller/coupons", { method: c ? "PUT" : "POST", body });
      bg.remove(); toast(r.message); go("coupons");
    } catch (err) { $("#cErr", bg).textContent = err.message; busy(btn, false, c ? "Save" : "Create coupon"); }
  });
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
  ${Number(w.available) < 0 ? `<div class="card warnbox" style="margin-top:14px"><b>Your balance is negative (${money(w.available)}).</b> Returned orders were charged to you. New sales will cover it first; you cannot withdraw until it is positive.</div>` : ""}
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
  app.innerHTML = `<div class="toolbar"><h1>Store profile</h1>${S.me.store_base_url ? `<a class="btn ghost sm" href="${esc(S.me.store_base_url)}/store/${esc(s.slug)}" target="_blank" rel="noopener">View my store</a>` : ""}</div>
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
  </form>
  <div class="card"><h2>Account</h2><p class="muted small" style="margin:0 0 8px">Login ID: <b>${esc(S.me.login_id || "")}</b></p>
    <button class="btn ghost" id="chgPw" type="button">Change password</button></div>`;
  $("#chgPw").addEventListener("click", () => showChangePassword(false));
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
  const resetToken = new URLSearchParams(location.search).get("reset");
  if (resetToken) return showReset(resetToken);
  if (!store.get(TOKEN_KEY)) return showLogin();
  $("#logoutBtn").hidden = false;
  try {
    await loadMe();
  } catch (err) { if (!store.get(TOKEN_KEY)) return showLogin(); app.innerHTML = `<div class="card center"><p class="err">${esc(err.message)}</p><button class="btn ghost" onclick="location.reload()">Reload</button></div>`; return; }
  const seller = S.me.seller;
  if (!seller) return notSellerScreen();
  if (seller.must_change_password) return showChangePassword(true);
  if (seller.status !== "approved") return statusScreen(seller);
  const h = (location.hash || "").slice(1);
  go(TABS.some(([k]) => k === h) ? h : "overview");
}
start();
