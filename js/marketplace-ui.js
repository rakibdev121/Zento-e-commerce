/* ZENTO MARKETPLACE UI (storefront)
   - star rating + seller name on product cards
   - reviews + "write a review" inside the product popup
   - "Sell on Zento" link in the footer                      */
(function () {
  var HOST = location.hostname;
  var API = (HOST === "localhost" || HOST === "127.0.0.1" || HOST.slice(-10) === "onrender.com")
    ? location.origin : "https://zento-e-commerce-all.onrender.com";

  var products = {};
  var lastCardId = null;

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function stars(n) { var r = Math.round(Number(n) || 0); return "★★★★★".slice(0, r) + "☆☆☆☆☆".slice(0, 5 - r); }
  function token() { try { return localStorage.getItem("zento_token"); } catch (e) { return null; } }
  function notify(msg) {
    if (typeof window.zentoToast === "function") return window.zentoToast(msg);
    var t = document.createElement("div"); t.className = "mp-toast"; t.textContent = msg;
    document.body.appendChild(t); setTimeout(function () { t.remove(); }, 2800);
  }
  function api(path, opts) {
    opts = opts || {}; var h = { "Content-Type": "application/json" };
    if (token()) h.Authorization = "Bearer " + token();
    return fetch(API + path, { method: opts.method || "GET", headers: h, body: opts.body, cache: "no-store" })
      .then(function (r) { return r.json().then(function (d) { if (!r.ok || d.status === "error") throw new Error(d.message || "Request failed"); return d; }); });
  }

  /* ---------- product cards ---------- */
  function decorateCards(list) {
    products = {};
    (list || []).forEach(function (p) { products[String(p.id)] = p; });
    document.querySelectorAll(".product-card[data-id]").forEach(function (card) {
      var p = products[card.getAttribute("data-id")];
      var info = card.querySelector(".product-info");
      if (!p || !info || info.querySelector(".mp-meta")) return;
      var html = '<div class="mp-meta">';
      html += '<span class="mp-stars" aria-label="' + Number(p.rating_avg).toFixed(1) + ' out of 5">' + stars(p.rating_avg) + "</span>" +
        '<span class="mp-count">' + (p.rating_count ? "(" + p.rating_count + ")" : "No reviews yet") + "</span>";
      if (p.seller_name) {
        html += '<a class="mp-seller" href="/store/' + encodeURIComponent(p.seller_slug) + '">' + esc(p.seller_name) +
          (p.seller_verified ? ' <span class="mp-ver" title="Verified seller">✔</span>' : "") + "</a>";
      }
      html += "</div>";
      var h3 = info.querySelector("h3");
      if (h3) h3.insertAdjacentHTML("afterend", html); else info.insertAdjacentHTML("afterbegin", html);
    });
  }
  document.addEventListener("zentoProductsLoaded", function (e) { decorateCards(e.detail); });

  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest(".mp-seller");
    if (a) e.stopPropagation();           // open the store page instead of the popup
    var card = e.target.closest && e.target.closest(".product-card");
    if (card) lastCardId = card.getAttribute("data-id");
  }, true);

  /* ---------- reviews inside the product popup ---------- */
  var modal = document.getElementById("productModal");

  function sectionHtml(pid, d) {
    var s = d.summary, total = s.count || 0, h = "";
    h += '<div class="mp-rev-head"><div class="mp-big">' + Number(s.average).toFixed(1) + '</div><div><div class="mp-stars">' + stars(s.average) +
      '</div><div class="mp-count">' + total + " review" + (total === 1 ? "" : "s") + "</div></div></div>";
    h += '<div class="mp-bars">' + [5, 4, 3, 2, 1].map(function (i) {
      var n = s.breakdown[String(i)] || 0, pct = total ? Math.round(n * 100 / total) : 0;
      return '<div class="mp-bar"><span>' + i + '★</span><i><b style="width:' + pct + '%"></b></i><span>' + n + "</span></div>";
    }).join("") + "</div>";

    if (d.can_review) {
      var my = d.my_review;
      h += '<form class="mp-form" id="mpForm"><b>' + (my ? "Edit your review" : "Write a review") + "</b>" +
        '<div class="mp-pick" id="mpPick">' + [1, 2, 3, 4, 5].map(function (i) {
          return '<button type="button" data-r="' + i + '" aria-label="' + i + ' star">★</button>';
        }).join("") + "</div>" +
        '<input id="mpTitle" maxlength="100" placeholder="Headline (optional)" value="' + esc(my ? my.title : "") + '">' +
        '<textarea id="mpComment" maxlength="1500" placeholder="What did you like or dislike?">' + esc(my ? my.comment : "") + "</textarea>" +
        '<button class="mp-btn" type="submit">' + (my ? "Update review" : "Submit review") + "</button>" +
        (my ? ' <button class="mp-btn mp-ghost" type="button" id="mpDel">Delete</button>' : "") + "</form>";
    } else {
      h += '<p class="mp-note">' + esc(d.reason || "") + "</p>";
    }

    h += '<div class="mp-list">' + (d.reviews.length ? d.reviews.map(function (r) {
      return '<div class="mp-item"><div class="mp-stars">' + stars(r.rating) + "</div>" +
        (r.title ? "<b>" + esc(r.title) + "</b>" : "") +
        '<div class="mp-by">' + esc(r.user_name) + (r.verified_purchase ? ' · <span class="mp-vp">Verified purchase</span>' : "") + "</div>" +
        (r.comment ? "<p>" + esc(r.comment).replace(/\n/g, "<br>") + "</p>" : "") + "</div>";
    }).join("") : '<p class="mp-note">No reviews yet. Be the first to review this product.</p>') + "</div>";
    return h;
  }

  function loadReviews(pid, box) {
    box.innerHTML = '<p class="mp-note">Loading reviews...</p>';
    api("/api/products/" + pid + "/reviews").then(function (d) {
      box.innerHTML = sectionHtml(pid, d);
      var chosen = d.my_review ? d.my_review.rating : 0;
      var pick = box.querySelector("#mpPick");
      function paint() { if (pick) pick.querySelectorAll("button").forEach(function (b) { b.classList.toggle("on", Number(b.getAttribute("data-r")) <= chosen); }); }
      if (pick) { pick.addEventListener("click", function (e) { var b = e.target.closest("button"); if (b) { chosen = Number(b.getAttribute("data-r")); paint(); } }); paint(); }
      var form = box.querySelector("#mpForm");
      if (form) form.addEventListener("submit", function (e) {
        e.preventDefault();
        if (!chosen) return notify("Please choose 1 to 5 stars");
        api("/api/products/" + pid + "/reviews", { method: "POST", body: JSON.stringify({
          rating: chosen, title: box.querySelector("#mpTitle").value, comment: box.querySelector("#mpComment").value }) })
          .then(function () { notify("Thanks for your review!"); loadReviews(pid, box); refreshList(); })
          .catch(function (err) { notify(err.message); });
      });
      var del = box.querySelector("#mpDel");
      if (del) del.addEventListener("click", function () {
        api("/api/products/" + pid + "/reviews", { method: "DELETE" }).then(function () { loadReviews(pid, box); refreshList(); });
      });
    }).catch(function (err) { box.innerHTML = '<p class="mp-note">' + esc(err.message) + "</p>"; });
  }

  function refreshList() { if (typeof window.loadZentoProducts === "function") window.loadZentoProducts(); }

  function onModalOpen() {
    var p = products[String(lastCardId)];
    if (!p) return;
    var content = modal.querySelector(".modal-product-content");
    if (!content) return;
    var rating = document.getElementById("modalProductRating");
    if (rating) rating.innerHTML = '<span class="mp-stars">' + stars(p.rating_avg) + "</span> " + Number(p.rating_avg).toFixed(1) +
      " <small>(" + p.rating_count + " reviews)</small>";
    var old = content.querySelector(".mp-reviews"); if (old) old.remove();
    var sold = "";
    if (p.seller_name) sold = '<div class="mp-sold">Sold by <a href="/store/' + encodeURIComponent(p.seller_slug) + '">' + esc(p.seller_name) + "</a>" +
      (p.seller_verified ? ' <span class="mp-ver">✔ Verified seller</span>' : "") + "</div>";
    var box = document.createElement("section");
    box.className = "mp-reviews";
    box.innerHTML = sold + '<h4>Customer reviews</h4><div id="mpBody"></div>';
    content.appendChild(box);
    loadReviews(p.id, box.querySelector("#mpBody"));
  }

  if (modal) {
    new MutationObserver(function () { if (modal.classList.contains("active")) onModalOpen(); })
      .observe(modal, { attributes: true, attributeFilter: ["class"] });
  }

  /* The Seller Center is a separate website now: the store shows no "sell" option. */
})();
