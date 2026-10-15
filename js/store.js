/* ZENTO SELLER STORE PAGE  (/store/<slug>) */
(function () {
  var HOST = location.hostname;
  var API = (HOST === "localhost" || HOST === "127.0.0.1" || HOST.slice(-10) === "onrender.com")
    ? location.origin : "https://zento-e-commerce-all.onrender.com";
  var app = document.getElementById("app");
  var slug = decodeURIComponent((location.pathname.split("/store/")[1] || "").split("/")[0]);

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function stars(n) { var r = Math.round(Number(n) || 0); return "★★★★★".slice(0, r) + "☆☆☆☆☆".slice(0, 5 - r); }
  function cssUrl(u) { return /^https?:\/\//i.test(u || "") ? "url('" + String(u).replace(/['"\\()\s]/g, encodeURIComponent) + "')" : ""; }
  function toast(msg) {
    var t = document.getElementById("toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(function () { t.hidden = true; }, 2600);
  }

  function cartKey() {
    try { var u = JSON.parse(localStorage.getItem("zento_user") || "null"); if (u && u.id) return "zento_cart_user_" + u.id; } catch (e) {}
    return "novacart_cart";
  }
  function addToCart(name, price) {
    var key = cartKey(), cart = [];
    try { cart = JSON.parse(localStorage.getItem(key) || "[]") || []; } catch (e) {}
    var found = cart.filter(function (i) { return i.name === name; })[0];
    if (found) found.quantity = Number(found.quantity || 0) + 1; else cart.push({ name: name, price: Number(price) || 0, quantity: 1 });
    try { localStorage.setItem(key, JSON.stringify(cart)); toast(name + " added to cart. Open the store to check out."); }
    catch (e) { toast("Could not save your cart"); }
  }

  function render(data) {
    var s = data.store, ps = data.products;
    document.title = s.store_name + " | Zento";
    var banner = cssUrl(s.banner_url), logo = cssUrl(s.logo_url);
    app.innerHTML =
      '<div class="banner"' + (banner ? ' style="background-image:' + banner + '"' : "") + "></div>" +
      '<div class="shead"><div class="logo"' + (logo ? ' style="background-image:' + logo + '"' : "") + ">" + (logo ? "" : "🏪") + "</div>" +
      '<div class="sinfo"><h1>' + esc(s.store_name) + (s.is_verified ? ' <span class="badge">✔ Verified seller</span>' : "") + "</h1>" +
      '<div class="muted small"><span class="stars">' + stars(s.rating_avg) + "</span> " + Number(s.rating_avg).toFixed(1) +
      " (" + s.rating_count + " reviews) · " + s.product_count + " products" + (s.city ? " · " + esc(s.city) : "") + "</div></div></div>" +
      (s.description ? '<div class="card" style="margin-top:16px">' + esc(s.description).replace(/\n/g, "<br>") + "</div>" : '<div style="height:16px"></div>') +
      "<h2>Products</h2>" +
      (ps.length ? '<div class="pgrid">' + ps.map(function (p) {
        var out = Number(p.stock) <= 0;
        return '<article class="pc"><div class="im">' + (/^https?:\/\//i.test(p.image_url || "") ? '<img loading="lazy" alt="" src="' + esc(p.image_url) + '">' : "🛍️") + "</div>" +
          '<div class="bd"><h3>' + esc(p.name) + "</h3>" +
          '<div class="small"><span class="stars">' + stars(p.rating_avg) + '</span> <span class="muted">(' + p.rating_count + ")</span></div>" +
          '<div class="pr"><b>৳' + Number(p.price).toFixed(2) + '</b><button class="btn sm" data-add="' + esc(p.id) + '"' + (out ? " disabled" : "") + ">" + (out ? "Sold out" : "Add") + "</button></div></div></article>";
      }).join("") + "</div>" : '<div class="card center muted">This store has no products yet.</div>');
    app.querySelectorAll("[data-add]").forEach(function (b) {
      b.addEventListener("click", function () {
        var p = ps.filter(function (x) { return String(x.id) === b.getAttribute("data-add"); })[0];
        if (p) addToCart(p.name, p.price);
      });
    });
  }

  if (!slug) { app.innerHTML = '<div class="card center">Store not found.</div>'; return; }
  fetch(API + "/api/stores/" + encodeURIComponent(slug), { cache: "no-store" })
    .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
    .then(function (x) {
      if (!x.ok || x.d.status !== "success") throw new Error(x.d.message || "Store not found");
      render(x.d);
    })
    .catch(function (e) { app.innerHTML = '<div class="card center"><h2>Store not found</h2><p class="muted">' + esc(e.message) + '</p><a class="btn" href="/">Go to Zento</a></div>'; });
})();
