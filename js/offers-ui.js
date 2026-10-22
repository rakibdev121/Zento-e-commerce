/* =========================================================
   ZENTO OFFERS UI (storefront)
   - event slider at the very top (admin events + any offer with a banner)
   - mystery box that suddenly drops on the screen and opens with an animation
   - quiz / spin wheel / scratch card / coupon drops / free shipping / lucky draw
   - flash sale row with countdown
   - "My rewards" drawer and reward chips at checkout
   - hero carousel + footer links of the neon design
   Winners are always decided by the server; this file only shows things.
========================================================= */
(function () {
  "use strict";

  var HOST = location.hostname;
  var API = (HOST === "localhost" || HOST === "127.0.0.1" || HOST.slice(-10) === "onrender.com")
    ? location.origin : "https://zento-e-commerce-all.onrender.com";

  var ICON = { mystery_box: "🎁", spin_wheel: "🎡", scratch_card: "🎟️", quiz: "🧠", flash_sale: "⚡", event: "🎉",
    coupon_drop: "🏷️", free_shipping: "🚚", spend_save: "💰", welcome: "👋", free_gift: "🎀", lucky_draw: "🍀" };
  var CTA = { mystery_box: "Open box", spin_wheel: "Spin now", scratch_card: "Scratch", quiz: "Play quiz", event: "View",
    coupon_drop: "Claim", free_shipping: "Claim", spend_save: "Claim", welcome: "Claim gift", free_gift: "Claim gift",
    lucky_draw: "Enter draw" };

  var S = { offers: [], offset: 0, rewards: [], loaded: false, tokenSeen: "" };
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function token() { try { return localStorage.getItem("zento_token"); } catch (e) { return null; } }
  function toast(msg) {
    var t = $("#toast"); if (!t) return;
    t.textContent = msg; t.classList.add("show");
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove("show"); }, 2600);
  }
  function api(path, opts) {
    opts = opts || {};
    var h = { "Content-Type": "application/json" };
    if (token()) h.Authorization = "Bearer " + token();
    return fetch(API + path, { method: opts.method || "GET", headers: h, body: opts.body, cache: "no-store" })
      .then(function (r) {
        return r.json().then(function (d) {
          if (!r.ok || d.status === "error") { var e = new Error(d.message || "Something went wrong"); e.status = r.status; throw e; }
          return d;
        });
      });
  }
  function nowMs() { return Date.now() + S.offset; }
  function fmtLeft(ms) {
    if (ms <= 0) return "00:00:00";
    var s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
    var p = function (n) { return String(n).padStart(2, "0"); };
    return d > 0 ? d + "d " + p(h) + "h " + p(m) + "m" : p(h) + ":" + p(m) + ":" + p(x);
  }
  function kindLabel(o) { return o.kind_label || o.kind; }
  function offerColor(o) { return /^#[0-9a-f]{6}$/i.test(o.color || "") ? o.color : "#00e5c2"; }
  function scrollToEl(el) { if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); }

  /* ---------------------------------------------------------
     LOAD
  --------------------------------------------------------- */
  function load() {
    return api("/api/offers").then(function (d) {
      S.offers = d.offers || [];
      S.offset = d.now ? Date.parse(d.now) - Date.now() : 0;
      S.loaded = true;
      renderAll();
      scheduleBox();
    }).catch(function () { /* offers are optional: the shop works without them */ });
  }
  function loadRewards() {
    if (!token()) { S.rewards = []; paintRewardCount(); return Promise.resolve(); }
    return api("/api/offers/my-rewards").then(function (d) {
      S.rewards = d.rewards || [];
      paintRewardCount();
    }).catch(function () {});
  }
  function readyRewards() { return S.rewards.filter(function (r) { return r.status === "ready"; }); }
  function paintRewardCount() {
    var b = $("#rewardsCount"), n = readyRewards().length;
    if (b) { b.textContent = n; b.hidden = n === 0; }
  }

  function renderAll() {
    renderSlider(); renderOfferGrid(); renderFlash(); renderHeroOffer();
  }

  /* ---------------------------------------------------------
     TOP EVENT SLIDER
  --------------------------------------------------------- */
  var slideTimer = null, slideIdx = 0;
  function renderSlider() {
    var wrap = $("#eventSlider"); if (!wrap) return;
    $$(".topbar-slide.is-event", wrap).forEach(function (n) { n.remove(); });
    S.offers.filter(function (o) { return o.show_banner; }).forEach(function (o) {
      var el = document.createElement("div");
      el.className = "topbar-slide is-event"; el.dataset.oid = o.id;
      el.innerHTML = "<span>" + (ICON[o.kind] || "🎉") + " <b>" + esc(o.title) + "</b> " + esc(o.subtitle || "") + "</span>" +
        (o.ends_at ? '<span class="cd" data-cd="' + esc(o.ends_at) + '"></span>' : "") +
        '<span style="color:#00e5c2;font-weight:700">' + esc(o.cta_label || CTA[o.kind] || "View") + " →</span>";
      wrap.appendChild(el);
    });
    var slides = $$(".topbar-slide", wrap);
    slideIdx = 0;
    slides.forEach(function (s, i) { s.classList.toggle("is-on", i === 0); s.classList.remove("is-out"); });
    clearInterval(slideTimer);
    if (slides.length > 1) slideTimer = setInterval(nextSlide, 5000);
  }
  function nextSlide() {
    var wrap = $("#eventSlider"); if (!wrap) return;
    var slides = $$(".topbar-slide", wrap); if (slides.length < 2) return;
    var cur = slides[slideIdx % slides.length];
    slideIdx = (slideIdx + 1) % slides.length;
    var nxt = slides[slideIdx];
    cur.classList.add("is-out"); cur.classList.remove("is-on");
    nxt.classList.add("is-on");
    setTimeout(function () { cur.classList.remove("is-out"); }, 650);
  }
  document.addEventListener("click", function (e) {
    var s = e.target.closest && e.target.closest(".topbar-slide.is-event");
    if (!s) return;
    var o = S.offers.filter(function (x) { return String(x.id) === s.dataset.oid; })[0];
    if (o) openOffer(o);
  });

  /* ---------------------------------------------------------
     OFFER CARDS + FLASH SALE + HERO
  --------------------------------------------------------- */
  function renderOfferGrid() {
    var sec = $("#offersSection"), grid = $("#offerGrid"); if (!sec || !grid) return;
    var list = S.offers.filter(function (o) { return o.kind !== "flash_sale"; });
    sec.hidden = list.length === 0;
    grid.innerHTML = list.map(function (o) {
      var done = o.done && o.kind !== "event";
      return '<button class="offer-card' + (done ? " is-done" : "") + '" type="button" data-oid="' + o.id + '" style="--oc:' + offerColor(o) + '">' +
        '<span class="offer-ico">' + (ICON[o.kind] || "🎁") + "</span>" +
        '<span class="offer-body"><small>' + esc(kindLabel(o)) + "</small><b>" + esc(o.title) + "</b>" +
        (o.subtitle ? "<span>" + esc(o.subtitle) + "</span>" : "") +
        (o.store_name ? '<span class="by">by ' + esc(o.store_name) + "</span>" : "") +
        (o.ends_at ? '<span>Ends in <span class="of-cd" style="margin:0" data-cd="' + esc(o.ends_at) + '"></span></span>' : "") +
        (o.left != null ? "<span>" + o.left + " left</span>" : "") +
        '<span class="cta">' + (done ? "Done ✓" : esc(o.cta_label || CTA[o.kind] || "View")) + "</span></span></button>";
    }).join("");
  }
  document.addEventListener("click", function (e) {
    var c = e.target.closest && e.target.closest(".offer-card"); if (!c) return;
    var o = S.offers.filter(function (x) { return String(x.id) === c.dataset.oid; })[0];
    if (o) openOffer(o);
  });

  function renderFlash() {
    var sec = $("#flashSection"), row = $("#flashRow"); if (!sec || !row) return;
    var sales = S.offers.filter(function (o) { return o.kind === "flash_sale" && o.products && o.products.length; });
    sec.hidden = sales.length === 0;
    if (!sales.length) return;
    $("#flashTitle").textContent = sales[0].title;
    $("#flashSub").textContent = sales[0].subtitle || "Limited time prices";
    var items = [];
    sales.forEach(function (o) { o.products.forEach(function (p) { items.push(p); }); });
    row.innerHTML = items.map(function (p) {
      return '<button class="flash-card" type="button" data-pid="' + p.product_id + '"><span class="pct">-' + Math.round(p.percent) + '%</span>' +
        '<span class="img">' + (p.image_url ? '<img loading="lazy" src="' + esc(p.image_url) + '" alt="">' : "🛍️") + "</span>" +
        '<span class="meta"><b>' + esc(p.name) + "</b><span><strong>৳" + Number(p.sale_price).toFixed(2) + "</strong><del>৳" +
        Number(p.price).toFixed(2) + "</del></span>" + (p.left != null ? "<small>Only " + p.left + " left</small>" : "") + "</span></button>";
    }).join("");
  }
  document.addEventListener("click", function (e) {
    var c = e.target.closest && e.target.closest(".flash-card"); if (!c) return;
    var card = $('.product-card[data-id="' + c.dataset.pid + '"]');
    if (card) card.click(); else { scrollToEl($("#products")); }
  });

  function paintFlashTimer() {
    var el = $("#flashTimer"); if (!el) return;
    var ends = S.offers.filter(function (o) { return o.kind === "flash_sale" && o.ends_at; })
      .map(function (o) { return Date.parse(o.ends_at); }).sort()[0];
    if (!ends) { el.innerHTML = ""; return; }
    var left = ends - nowMs();
    if (left <= 0) { el.innerHTML = ""; return; }
    var p = fmtLeft(left).split(/[: ]/);
    el.innerHTML = p.map(function (x, i) { return (i ? "<i>:</i>" : "") + "<span>" + esc(x) + "</span>"; }).join("");
  }

  var heroOffer = null;
  function renderHeroOffer() {
    var pick = S.offers.filter(function (o) { return o.kind !== "flash_sale"; })[0] || S.offers[0];
    heroOffer = pick || null;
    if (!pick) return;
    var l = $("#heroOfferLabel"), t = $("#heroOfferTitle"), p = $("#heroOfferText"), b = $("#heroOfferBtn");
    if (l) l.textContent = kindLabel(pick);
    if (t) t.innerHTML = esc(pick.title) + (pick.subtitle ? "<span>" + esc(pick.subtitle) + "</span>" : "");
    if (p) p.textContent = pick.description || "Tap below to join. Winners get a personal coupon for their next order.";
    if (b) b.firstChild.textContent = (pick.cta_label || CTA[pick.kind] || "See offers") + " ";
  }

  /* ---------------------------------------------------------
     COUNTDOWNS (all [data-cd] elements, once a second)
  --------------------------------------------------------- */
  setInterval(function () {
    $$("[data-cd]").forEach(function (el) {
      var end = Date.parse(el.dataset.cd); if (!end) { el.textContent = ""; return; }
      var left = end - nowMs();
      el.textContent = left > 0 ? fmtLeft(left) : "ended";
    });
    paintFlashTimer();
    var ended = S.offers.some(function (o) { return o.ends_at && Date.parse(o.ends_at) < nowMs() - 1500; });
    if (ended) { S.offers = S.offers.filter(function (o) { return !o.ends_at || Date.parse(o.ends_at) >= nowMs() - 1500; }); renderAll(); }
  }, 1000);

  /* ---------------------------------------------------------
     MODALS
  --------------------------------------------------------- */
  function layer() { return $("#offerLayer"); }
  function closeModals() { $$(".of-modal, .drawer", layer()).forEach(function (n) { n.remove(); }); }
  function modal(o, html) {
    closeModals();
    var m = document.createElement("div"); m.className = "of-modal";
    m.style.setProperty("--of", o ? offerColor(o) : "#00e5c2");
    m.innerHTML = '<div class="of-box" role="dialog" aria-modal="true"><button class="of-close" type="button" aria-label="Close">×</button>' + html + "</div>";
    m.addEventListener("click", function (e) { if (e.target === m || e.target.closest(".of-close")) m.remove(); });
    layer().appendChild(m);
    return m;
  }

  function confetti() {
    var c = document.createElement("div"); c.className = "confetti";
    var cols = ["#00e5c2", "#ffd23f", "#ff4d6d", "#7c5cff", "#ffffff", "#3ddc97"];
    for (var i = 0; i < 70; i++) {
      var p = document.createElement("i");
      p.style.left = Math.random() * 100 + "%";
      p.style.background = cols[i % cols.length];
      p.style.animationDuration = 2 + Math.random() * 2.2 + "s";
      p.style.animationDelay = Math.random() * .5 + "s";
      p.style.transform = "rotate(" + Math.random() * 360 + "deg)";
      c.appendChild(p);
    }
    document.body.appendChild(c);
    setTimeout(function () { c.remove(); }, 5200);
  }

  function copyCode(code) {
    function done() { toast("Code " + code + " copied"); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).then(done, done); else done();
  }

  function needLogin() {
    if (token()) return false;
    toast("Please log in to join this offer");
    return true;
  }

  function claim(o, answer) {
    return api("/api/offers/" + o.id + "/claim", { method: "POST", body: JSON.stringify({ answer: answer }) }).then(function (r) {
      o.done = o.kind !== "event"; o.mine = (o.mine || 0) + 1;
      renderOfferGrid(); loadRewards();
      return r;
    });
  }

  function resultHtml(r) {
    if (r.entered) return '<div class="prize"><div class="big">You are in! 🍀</div><p>' + esc(r.message) + "</p></div>";
    if (!r.won) {
      return '<div class="prize lose"><div class="big">' + esc(r.message || "Better luck next time") + "</div>" +
        (r.right_answer ? "<p>Right answer: <b>" + esc(r.right_answer) + "</b></p>" : "") + "</div>";
    }
    var p = r.prize || {};
    var exp = p.expires_at ? new Date(p.expires_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
    return '<div class="prize"><div class="big">' + esc(p.label) + "</div><p>Your reward is saved in My Rewards.</p>" +
      '<div class="code-row"><code>' + esc(p.code) + '</code><button type="button" data-copy="' + esc(p.code) + '">Copy</button></div>' +
      "<small>" + (p.min_order ? "Minimum order ৳" + Math.round(p.min_order) + ". " : "") + (exp ? "Use before " + exp + "." : "") + "</small>" +
      '<button class="of-btn" type="button" data-use="' + esc(p.code) + '">Use at checkout</button></div>';
  }
  document.addEventListener("click", function (e) {
    var cp = e.target.closest && e.target.closest("[data-copy]");
    if (cp) { copyCode(cp.dataset.copy); return; }
    var use = e.target.closest && e.target.closest("[data-use]");
    if (use) { copyCode(use.dataset.use); closeModals(); toast("Open your cart and paste the code at checkout"); }
    var go = e.target.closest && e.target.closest("[data-go='products']");
    if (go) { scrollToEl($("#shop")); }
  });

  function finish(m, r) {
    var holder = $(".of-result", m); if (!holder) return;
    holder.innerHTML = resultHtml(r);
    if (r.won) confetti();
    var btn = $(".of-act", m); if (btn) btn.remove();
  }
  function fail(m, err) {
    var msg = $(".of-msg", m); if (msg) msg.textContent = err.message;
    var btn = $(".of-act", m); if (btn) btn.disabled = false;
    if (err.status === 409 || err.status === 410) { var o = null; load(); }
  }

  /* ---- opening any offer ---- */
  function openOffer(o) {
    if (o.kind === "flash_sale") { scrollToEl($("#flashSection")); return; }
    if (o.kind === "event") return openEvent(o);
    if (o.done) { toast("You have already joined this offer"); return; }
    if (needLogin()) return;
    if (o.kind === "mystery_box") return openBox(o);
    if (o.kind === "spin_wheel") return openWheel(o);
    if (o.kind === "scratch_card") return openScratch(o);
    if (o.kind === "quiz") return openQuiz(o);
    return openSimple(o);
  }
  window.ZentoOffers = { open: openOffer, refresh: load };

  function head(o, kicker) {
    return '<div class="of-kicker">' + esc(kicker || kindLabel(o)) + "</div><h3>" + esc(o.title) + "</h3>" +
      (o.subtitle ? "<p>" + esc(o.subtitle) + "</p>" : "") + (o.store_name ? '<p style="font-size:12px">by ' + esc(o.store_name) + "</p>" : "");
  }

  function openEvent(o) {
    var m = modal(o, (o.image_url ? '<img class="of-event-img" alt="" src="' + esc(o.image_url) + '">' : "") + head(o, "Event") +
      (o.description ? "<p style='margin-top:10px'>" + esc(o.description) + "</p>" : "") +
      (o.ends_at ? '<span class="of-cd" data-cd="' + esc(o.ends_at) + '"></span>' : "") +
      '<button class="of-btn" type="button" data-go="products">' + esc(o.cta_label || "Shop now") + "</button>");
    $(".of-btn", m).addEventListener("click", function () { m.remove(); });
  }

  function giftBoxHtml() {
    return '<div class="gbox"><div class="lid"></div><div class="rib v" style="top:12px"></div><div class="body"></div><div class="q">?</div></div>';
  }

  function openBox(o) {
    var m = modal(o, head(o, "Mystery box") + '<div class="stage"><span class="burst"></span>' + giftBoxHtml() + "</div>" +
      '<div class="of-result"></div><p class="of-msg"></p><button class="of-btn of-act" type="button">Open the box</button>');
    var btn = $(".of-act", m), box = $(".gbox", m), stage = $(".stage", m);
    btn.addEventListener("click", function () {
      btn.disabled = true; btn.textContent = "Opening...";
      box.classList.add("shake");
      var t0 = Date.now();
      claim(o).then(function (r) {
        setTimeout(function () {
          box.classList.remove("shake"); box.classList.add("open"); stage.classList.add("go");
          setTimeout(function () { stage.style.height = "70px"; finish(m, r); }, 650);
        }, Math.max(0, 1100 - (Date.now() - t0)));
      }).catch(function (err) { box.classList.remove("shake"); btn.textContent = "Open the box"; fail(m, err); });
    });
  }

  function openScratch(o) {
    var m = modal(o, head(o) + '<div class="card-flip"><div class="card-in"><div class="card-f">Scratch me</div><div class="card-b" id="cardBack">?</div></div></div>' +
      '<div class="of-result"></div><p class="of-msg"></p><button class="of-btn of-act" type="button">Scratch &amp; reveal</button>');
    var btn = $(".of-act", m);
    btn.addEventListener("click", function () {
      btn.disabled = true;
      claim(o).then(function (r) {
        $("#cardBack", m).textContent = r.won ? r.prize.label : (r.message || "Try again");
        $(".card-flip", m).classList.add("go");
        setTimeout(function () { finish(m, r); }, 1000);
      }).catch(function (err) { fail(m, err); });
    });
  }

  function openWheel(o) {
    var pr = o.prizes || [], n = Math.max(pr.length, 2), seg = 360 / n;
    var cols = ["#00e5c2", "#ffd23f", "#7c5cff", "#ff8a3d", "#3ddc97", "#ff4d6d"];
    var grad = pr.map(function (p, i) { return cols[i % cols.length] + " " + (i * seg) + "deg " + ((i + 1) * seg) + "deg"; }).join(",");
    var labels = pr.map(function (p, i) {
      return '<span style="transform:rotate(' + ((i + .5) * seg - 90) + 'deg)">' + esc(p.label.slice(0, 16)) + "</span>";
    }).join("");
    var m = modal(o, head(o) + '<div class="wheel-wrap"><div class="wheel-pin"></div><div class="wheel" id="wheelEl" style="background:conic-gradient(' + grad + ')">' +
      labels + '</div><div class="wheel-hub"></div></div><div class="of-result"></div><p class="of-msg"></p><button class="of-btn of-act" type="button">Spin the wheel</button>');
    var btn = $(".of-act", m), wheel = $("#wheelEl", m);
    btn.addEventListener("click", function () {
      btn.disabled = true;
      claim(o).then(function (r) {
        var label = r.won ? r.prize.label : (r.prize && r.prize.label) || "";
        var idx = pr.map(function (p) { return p.label; }).indexOf(label);
        if (idx < 0) idx = 0;
        wheel.style.transform = "rotate(" + (360 * 6 - ((idx + .5) * seg)) + "deg)";
        setTimeout(function () { finish(m, r); }, 4400);
      }).catch(function (err) { fail(m, err); });
    });
  }

  function openQuiz(o) {
    var chosen = -1;
    var m = modal(o, head(o, "Quiz") + "<p style='margin-top:12px;color:#fff;font-weight:700;font-size:16px'>" + esc(o.question) + "</p>" +
      '<div class="q-opts">' + (o.options || []).map(function (t, i) { return '<button class="q-opt" type="button" data-i="' + i + '">' + esc(t) + "</button>"; }).join("") +
      '</div><div class="of-result"></div><p class="of-msg"></p><button class="of-btn of-act" type="button" disabled>Submit answer</button>');
    var btn = $(".of-act", m);
    $(".q-opts", m).addEventListener("click", function (e) {
      var b = e.target.closest(".q-opt"); if (!b) return;
      chosen = Number(b.dataset.i);
      $$(".q-opt", m).forEach(function (x) { x.classList.toggle("on", x === b); });
      btn.disabled = false;
    });
    btn.addEventListener("click", function () {
      btn.disabled = true;
      claim(o, chosen).then(function (r) { $(".q-opts", m).remove(); finish(m, r); }).catch(function (err) { fail(m, err); });
    });
  }

  function openSimple(o) {
    var extra = "";
    if (o.min_order) extra = "<p style='margin-top:8px'>Works on orders of ৳" + Math.round(o.min_order) + " or more.</p>";
    if (o.prizes && o.prizes[0] && o.kind !== "lucky_draw") extra += "<p style='margin-top:8px;color:#00e5c2;font-weight:700'>" + esc(o.prizes[0].label) + "</p>";
    var m = modal(o, head(o) + (o.description ? "<p style='margin-top:10px'>" + esc(o.description) + "</p>" : "") + extra +
      (o.ends_at ? '<span class="of-cd" data-cd="' + esc(o.ends_at) + '"></span>' : "") +
      '<div class="of-result"></div><p class="of-msg"></p><button class="of-btn of-act" type="button">' +
      esc(o.cta_label || CTA[o.kind] || "Claim") + "</button>");
    var btn = $(".of-act", m);
    btn.addEventListener("click", function () {
      btn.disabled = true;
      claim(o).then(function (r) { finish(m, r); }).catch(function (err) { fail(m, err); });
    });
  }

  /* ---------------------------------------------------------
     MYSTERY BOX DROP: appears on the screen at a random moment
  --------------------------------------------------------- */
  var boxTimer = null, dropEl = null;
  function dismissedBoxes() { try { return JSON.parse(sessionStorage.getItem("zento_box_off") || "[]"); } catch (e) { return []; } }
  function dismissBox(id) { try { var l = dismissedBoxes(); l.push(id); sessionStorage.setItem("zento_box_off", JSON.stringify(l)); } catch (e) {} }

  function scheduleBox() {
    clearTimeout(boxTimer);
    if (dropEl) return;
    var off = dismissedBoxes();
    var list = S.offers.filter(function (o) { return o.kind === "mystery_box" && !o.done && off.indexOf(o.id) < 0; });
    if (!list.length) return;
    var o = list[Math.floor(Math.random() * list.length)];
    var min = o.delay_min || 8, max = Math.max(min, o.delay_max || 25);
    boxTimer = setTimeout(function () { dropBox(o); }, (min + Math.random() * (max - min)) * 1000);
  }

  function dropBox(o) {
    var busy = !token() || document.body.classList.contains("auth-active") || $(".of-modal, .drawer", layer()) ||
      $(".zento-page.active");
    if (busy) { boxTimer = setTimeout(function () { dropBox(o); }, 6000); return; }
    var d = document.createElement("div");
    d.className = "box-drop"; d.style.setProperty("--of", offerColor(o));
    d.innerHTML = '<span class="glow"></span><button class="x" type="button" aria-label="Dismiss">×</button>' + giftBoxHtml() +
      '<span class="tag">Tap to open!</span>';
    document.body.appendChild(d);
    dropEl = d;
    function leave(dismiss) {
      d.classList.add("leave");
      if (dismiss) dismissBox(o.id);
      setTimeout(function () { d.remove(); dropEl = null; if (!dismiss) scheduleBox(); }, 520);
    }
    d.addEventListener("click", function (e) {
      if (e.target.closest(".x")) { leave(true); return; }
      leave(true); setTimeout(function () { openOffer(o); }, 250);
    });
    setTimeout(function () { if (dropEl === d) leave(false); }, 45000);
  }

  /* ---------------------------------------------------------
     REWARDS DRAWER + CHECKOUT CHIPS
  --------------------------------------------------------- */
  function openRewards() {
    closeModals();
    var dr = document.createElement("div"); dr.className = "drawer";
    dr.innerHTML = '<div class="drawer-box"><button class="of-close" type="button" aria-label="Close" style="right:12px;top:12px">×</button>' +
      '<h3>🎁 My rewards</h3><p style="color:#8a94a3;font-size:13px">Coupons you won. Paste a code at checkout.</p><div id="rwList"><p class="drawer-empty">Loading...</p></div></div>';
    dr.addEventListener("click", function (e) { if (e.target === dr || e.target.closest(".of-close")) dr.remove(); });
    layer().appendChild(dr);
    if (!token()) { $("#rwList", dr).innerHTML = '<p class="drawer-empty">Log in to see your rewards.</p>'; return; }
    loadRewards().then(function () {
      var list = $("#rwList", dr); if (!list) return;
      if (!S.rewards.length) { list.innerHTML = '<p class="drawer-empty">No rewards yet.<br>Play a quiz or wait for a mystery box!</p>'; return; }
      list.innerHTML = S.rewards.map(function (r) {
        var exp = r.expires_at ? new Date(r.expires_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "No expiry";
        var what = r.free_shipping ? "Free delivery" : r.product_name ? "Free: " + r.product_name : r.discount_type === "percent" ? Number(r.value) + "% off" : "৳" + Number(r.value) + " off";
        return '<div class="reward' + (r.status !== "ready" ? " dead" : "") + '"><div class="row"><b>' + esc(r.label || what) + "</b><span>" +
          (r.status === "ready" ? "" : esc(r.status)) + "</span></div><small>" + esc(what) + (Number(r.min_order) ? " · min ৳" + Math.round(r.min_order) : "") +
          (r.store_name ? " · " + esc(r.store_name) : "") + " · until " + esc(exp) + '</small><div class="row"><code>' + esc(r.code) + "</code>" +
          (r.status === "ready" ? '<button type="button" data-copy="' + esc(r.code) + '">Copy</button>' : "") + "</div></div>";
      }).join("");
    });
  }

  function paintChips() {
    var box = $("#rewardChips"); if (!box) return;
    var list = readyRewards();
    box.hidden = list.length === 0;
    box.innerHTML = list.map(function (r) {
      return '<button type="button" class="reward-chip" data-chip="' + esc(r.code) + '">🎁 ' + esc(r.label || r.code) + "</button>";
    }).join("");
  }
  document.addEventListener("click", function (e) {
    var ch = e.target.closest && e.target.closest("[data-chip]");
    if (!ch) return;
    var input = $("#couponInput"), apply = $("#couponApply");
    if (input && apply) { input.value = ch.dataset.chip; apply.click(); }
  });
  var cp = $("#checkoutPage");
  if (cp && window.MutationObserver) {
    new MutationObserver(function () { if (cp.classList.contains("active")) loadRewards().then(paintChips); })
      .observe(cp, { attributes: true, attributeFilter: ["class"] });
  }
  var rb = $("#rewardsBtn");
  if (rb) rb.addEventListener("click", openRewards);

  /* ---------------------------------------------------------
     HERO CAROUSEL + small links of the neon layout
  --------------------------------------------------------- */
  (function hero() {
    var slides = $$(".hero-slide"), dots = $("#heroDots"), cur = 0, timer = null;
    if (!slides.length || !dots) return;
    dots.innerHTML = slides.map(function (s, i) { return '<button type="button" aria-label="Slide ' + (i + 1) + '"></button>'; }).join("");
    function show(i) {
      cur = (i + slides.length) % slides.length;
      slides.forEach(function (s, k) { s.classList.toggle("is-on", k === cur); });
      $$("button", dots).forEach(function (b, k) { b.classList.toggle("on", k === cur); });
    }
    function auto() { clearInterval(timer); timer = setInterval(function () { show(cur + 1); }, 6500); }
    $("#heroPrev").addEventListener("click", function () { show(cur - 1); auto(); });
    $("#heroNext").addEventListener("click", function () { show(cur + 1); auto(); });
    dots.addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      show($$("button", dots).indexOf(b)); auto();
    });
    var h = $("#hero"), sx = 0;
    h.addEventListener("touchstart", function (e) { sx = e.touches[0].clientX; }, { passive: true });
    h.addEventListener("touchend", function (e) {
      var dx = e.changedTouches[0].clientX - sx;
      if (Math.abs(dx) > 50) { show(cur + (dx < 0 ? 1 : -1)); auto(); }
    }, { passive: true });
    show(0); auto();
  })();

  document.addEventListener("zentoProductsLoaded", function (e) {
    var p = (e.detail || []).filter(function (x) { return x.image_url; })[0];
    var art = $("#heroProductArt img");
    if (p && art) { art.src = p.image_url; art.alt = p.name || ""; }
  });

  var heroBtn = $("#heroOfferBtn");
  if (heroBtn) heroBtn.addEventListener("click", function () {
    if (heroOffer) openOffer(heroOffer);
    else scrollToEl($("#offersSection").hidden ? $("#shop") : $("#offersSection"));
  });
  function click(id) { var n = document.getElementById(id); if (n) n.click(); }
  function link(id, fn) {
    var n = document.getElementById(id);
    if (n) n.addEventListener("click", function (e) { e.preventDefault(); fn(); });
  }
  link("topTrack", function () { click("profileNav"); });
  link("footTrack", function () { click("profileNav"); });
  link("topHelp", function () { click("supportNav"); });
  link("footFaq", function () { click("supportNav"); });
  link("footHome", function () { window.scrollTo({ top: 0, behavior: "smooth" }); });
  link("footShop", function () { scrollToEl($("#shop")); });
  link("footOffers", function () { var s = $("#offersSection"); scrollToEl(s && !s.hidden ? s : $("#shop")); });

  /* ---------------------------------------------------------
     START: load now, then again when the customer logs in
  --------------------------------------------------------- */
  load(); loadRewards();
  setInterval(function () {
    var t = token() || "";
    if (t !== S.tokenSeen) { S.tokenSeen = t; load(); loadRewards(); }
  }, 2500);
  setInterval(load, 120000);
})();
