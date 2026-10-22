
/* ZENTO PROFILE + CHECKOUT V1 */

document.addEventListener("DOMContentLoaded", () => {

  const API_URL = "https://zento-e-commerce-all.onrender.com";

  const token = () => localStorage.getItem("zento_token");

  const authHeaders = () => ({
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token()}`
  });

  const profilePage = document.getElementById("profilePage");
  const profileNav = document.getElementById("profileNav");
  const profileBack = document.getElementById("profileBack");

  const checkoutPage = document.getElementById("checkoutPage");
  const checkoutBtn = document.getElementById("checkoutBtn");
  const checkoutBack = document.getElementById("checkoutBack");

  const profileForm = document.getElementById("profileForm");
  const logoutBtn = document.getElementById("logoutBtn");

  const checkoutForm = document.getElementById("checkoutForm");

  function openPage(page) {
    page?.classList.add("active");
    page?.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }

  function closePage(page) {
    page?.classList.remove("active");
    page?.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  function getUser() {
    try {
      return JSON.parse(localStorage.getItem("zento_user") || "{}");
    } catch {
      return {};
    }
  }

  function saveUser(user) {
    localStorage.setItem("zento_user", JSON.stringify(user));
  }

  async function api(url, options = {}) {
    const response = await fetch(`${API_URL}${url}`, {
      ...options,
      headers: {
        ...authHeaders(),
        ...(options.headers || {})
      }
    });

    const data = await response.json().catch(() => ({}));

    if (response.status === 401 && token()) {
      /* The saved login expired. Ask the customer to log in again. */
      localStorage.removeItem("zento_token");
      localStorage.removeItem("zento_user");
      alert("Your session expired. Please log in again.");
      location.reload();
      throw new Error("Session expired. Please log in again.");
    }

    if (!response.ok) {
      throw new Error(data.message || "Request failed");
    }

    return data;
  }

  function money(value) {
    return `৳${Number(value || 0).toFixed(2)}`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }


  async function loadProfile() {
    if (!token()) return;

    try {
      const data = await api("/api/profile");
      const user = data.user;

      saveUser(user);

      const avatar = document.getElementById("profileAvatar");
      const displayName = document.getElementById("profileDisplayName");
      const displayEmail = document.getElementById("profileDisplayEmail");

      const nameInput = document.getElementById("profileName");
      const emailInput = document.getElementById("profileEmail");
      const phoneInput = document.getElementById("profilePhone");
      const cityInput = document.getElementById("profileCity");
      const addressInput = document.getElementById("profileAddress");

      if (avatar) {
        avatar.textContent = (user.name || "Z").charAt(0).toUpperCase();
      }

      if (displayName) displayName.textContent = user.name || "Zento User";
      if (displayEmail) displayEmail.textContent = user.email || "";

      if (nameInput) nameInput.value = user.name || "";
      if (emailInput) emailInput.value = user.email || "";
      if (phoneInput) phoneInput.value = user.phone || "";
      if (cityInput) cityInput.value = user.city || "";
      if (addressInput) addressInput.value = user.address || "";

      document.getElementById("checkoutName")?.setAttribute("value", user.name || "");
      document.getElementById("checkoutPhone")?.setAttribute("value", user.phone || "");
      document.getElementById("checkoutCity")?.setAttribute("value", user.city || "");

      const checkoutName = document.getElementById("checkoutName");
      const checkoutPhone = document.getElementById("checkoutPhone");
      const checkoutCity = document.getElementById("checkoutCity");
      const checkoutAddress = document.getElementById("checkoutAddress");

      if (checkoutName) checkoutName.value = user.name || "";
      if (checkoutPhone) checkoutPhone.value = user.phone || "";
      if (checkoutCity) checkoutCity.value = user.city || "";
      if (checkoutAddress) checkoutAddress.value = user.address || "";

    } catch (error) {
      const message = document.getElementById("profileMessage");
      if (message) message.textContent = error.message;
    }
  }


  /* ---------- rate, return, complain ---------- */
  function orderActions(order) {
    const sellers = [];
    order.items.forEach(i => { if (i.seller_id && !sellers.some(x => x.id === i.seller_id)) sellers.push({ id: i.seller_id, name: i.seller_name }); });
    const parts = [];

    if (order.status === "delivered") {
      const rate = order.items.map(i => i.reviewed
        ? `<span class="oa-done">★ Rated: ${escapeHtml(i.name)}</span>`
        : `<button type="button" class="oa-btn" data-rate="${i.product_id}" data-pname="${escapeHtml(i.name)}">★ Rate ${escapeHtml(i.name)}</button>`).join("");
      parts.push(`<div class="oa-row">${rate}</div>`);

      if (order.return_request) {
        const r = order.return_request;
        const label = r.status === "requested" ? "Return request sent. We are reviewing it."
          : r.status === "approved" ? "Your return was accepted." : "Your return request was rejected.";
        parts.push(`<div class="oa-note ${r.status === "rejected" ? "bad" : ""}">${label}${r.admin_note ? " " + escapeHtml(r.admin_note) : ""}</div>`);
      } else if (order.can_return) {
        parts.push(`<div class="oa-row"><button type="button" class="oa-btn warn" data-return="${order.id}">↩ Return this order</button><small>You can return within ${order.return_days} days of delivery.</small></div>`);
      } else {
        parts.push(`<div class="oa-note">The ${order.return_days}-day return period for this order is over.</div>`);
      }
    }

    if (sellers.length) {
      const done = order.complaints || [];
      parts.push(`<div class="oa-row">${sellers.map(sl => {
        const open = done.some(c => c.seller_id === sl.id && c.status === "open");
        return open ? `<span class="oa-done">Complaint sent about ${escapeHtml(sl.name)}</span>`
          : `<button type="button" class="oa-btn ghost" data-complain="${order.id}" data-seller="${sl.id}" data-sname="${escapeHtml(sl.name)}">⚑ Complain about ${escapeHtml(sl.name)}</button>`;
      }).join("")}</div>`);
    }
    return parts.length ? `<div class="order-actions">${parts.join("")}</div>` : "";
  }

  function openSheet(html) {
    const bg = document.createElement("div");
    bg.className = "zsheet-bg";
    bg.innerHTML = `<div class="zsheet" role="dialog" aria-modal="true">${html}</div>`;
    bg.addEventListener("click", e => { if (e.target === bg) bg.remove(); });
    document.body.appendChild(bg);
    return bg;
  }

  function sheetForm(title, intro, fieldsHtml, okText, onSubmit) {
    const bg = openSheet(`<h3>${title}</h3>${intro ? `<p class="zs-intro">${intro}</p>` : ""}
      <form>${fieldsHtml}<div class="zs-err"></div>
      <div class="zs-btns"><button type="button" class="zs-cancel">Cancel</button><button type="submit" class="zs-ok">${okText}</button></div></form>`);
    const form = bg.querySelector("form"), err = bg.querySelector(".zs-err"), ok = bg.querySelector(".zs-ok");
    bg.querySelector(".zs-cancel").addEventListener("click", () => bg.remove());
    form.addEventListener("submit", async e => {
      e.preventDefault();
      ok.disabled = true; err.textContent = "";
      try { await onSubmit(form); bg.remove(); await loadOrders(); }
      catch (error) { err.textContent = error.message; ok.disabled = false; }
    });
    return bg;
  }

  document.addEventListener("click", event => {
    const rate = event.target.closest("[data-rate]");
    if (rate) {
      let stars = 0;
      const bg = sheetForm("Rate this product", escapeHtml(rate.dataset.pname),
        `<div class="zs-stars">${[1, 2, 3, 4, 5].map(i => `<button type="button" data-s="${i}" aria-label="${i} star">★</button>`).join("")}</div>
         <textarea name="comment" maxlength="1500" placeholder="Tell others what you think (optional)"></textarea>`,
        "Submit rating",
        async form => {
          if (!stars) throw new Error("Please tap 1 to 5 stars");
          await api(`/api/products/${rate.dataset.rate}/reviews`, { method: "POST", body: JSON.stringify({ rating: stars, title: "", comment: form.comment.value }) });
        });
      bg.querySelector(".zs-stars").addEventListener("click", e => {
        const b = e.target.closest("button"); if (!b) return;
        stars = Number(b.dataset.s);
        bg.querySelectorAll(".zs-stars button").forEach(x => x.classList.toggle("on", Number(x.dataset.s) <= stars));
      });
      return;
    }

    const ret = event.target.closest("[data-return]");
    if (ret) {
      sheetForm("Return this order", "Tell us what is wrong. If we accept the return, you get your money back.",
        `<textarea name="reason" maxlength="500" placeholder="Why do you want to return it? (wrong item, damaged, not as described...)" required></textarea>`,
        "Send return request",
        async form => { await api(`/api/orders/${ret.dataset.return}/return-request`, { method: "POST", body: JSON.stringify({ reason: form.reason.value }) }); });
      return;
    }

    const cmp = event.target.closest("[data-complain]");
    if (cmp) {
      sheetForm(`Complain about ${cmp.dataset.sname}`, "Tell us what the seller did wrong. Zento will check and reply.",
        `<input name="subject" maxlength="100" placeholder="Short title (for example: fake product)">
         <textarea name="message" maxlength="1500" placeholder="Describe the problem" required></textarea>`,
        "Send complaint",
        async form => { await api(`/api/orders/${cmp.dataset.complain}/complaints`, { method: "POST", body: JSON.stringify({ seller_id: Number(cmp.dataset.seller), subject: form.subject.value, message: form.message.value }) }); });
    }
  });

  async function loadOrders() {
    const list = document.getElementById("ordersList");
    if (!list) return;

    list.innerHTML = '<div class="orders-loading">Loading orders...</div>';

    try {
      const data = await api("/api/orders");

      if (!data.orders?.length) {
        list.innerHTML = `
          <div class="orders-empty">
            <strong>No orders yet</strong>
            <span>Your orders will appear here.</span>
          </div>
        `;
        return;
      }

      const statusLabels = {
        pending: "Pending",
        approved: "Seller approved",
        processing: "At Zento warehouse",
        shipped: "Shipped",
        out_for_delivery: "Out for Delivery",
        delivered: "Delivered",
        cancelled: "Cancelled",
        returned: "Returned"
      };

      const steps = [
        ["pending", "Order Placed"],
        ["approved", "Seller Approved"],
        ["processing", "At Zento Warehouse"],
        ["shipped", "With Courier"],
        ["out_for_delivery", "Out for Delivery"],
        ["delivered", "Delivered"]
      ];

      list.innerHTML = data.orders.map(order => {
        const currentIndex = Math.max(
          0,
          steps.findIndex(step => step[0] === order.status)
        );

        const ended = order.status === "cancelled" || order.status === "returned";

        const tracking = ended
          ? `<div class="order-ended">${order.status === "cancelled" ? "This order was cancelled." : "This order was returned."}${order.cancel_reason ? " " + escapeHtml(order.cancel_reason) : ""}
              ${order.refund_status === "due" ? `<br><strong>Refund of ${money(order.refund_amount)} is being processed.</strong>` : ""}
              ${order.refund_status === "refunded" ? `<br><strong>Refund of ${money(order.refund_amount)} was sent.</strong>` : ""}</div>`
          : steps.map((step, index) => `
          <div class="tracking-step ${index <= currentIndex ? "done" : ""} ${index === currentIndex ? "current" : ""}">
            <div class="tracking-dot">${index <= currentIndex ? "✓" : ""}</div>
            <span>${step[1]}</span>
          </div>
        `).join("");

        return `
          <article class="order-card">
            <div class="order-top">
              <div>
                <small>Order #${order.id}</small>
                <strong>${new Date(order.created_at).toLocaleDateString()}</strong>
              </div>

              <span class="order-status status-${order.status}">
                ${statusLabels[order.status] || order.status}
              </span>
            </div>

            <div class="order-items">
              ${order.items.map(item => `
                <div class="order-item">
                  <div>
                    <strong>${escapeHtml(item.name)}</strong>
                    <small>${item.quantity} × ${money(item.price)}</small>
                    ${item.seller_name ? `<small class="item-seller">Sold by <b>${escapeHtml(item.seller_name)}</b></small>` : ""}
                    ${item.tracking_no ? `<small class="item-tracking">${escapeHtml(item.courier)} tracking: <b>${escapeHtml(item.tracking_no)}</b></small>` : ""}
                  </div>
                  <strong>${money(item.subtotal)}</strong>
                </div>
              `).join("")}
            </div>

            <div class="order-tracking">
              <div class="tracking-title">Order Tracking</div>
              <div class="tracking-line">
                ${tracking}
              </div>
            </div>

            <div class="order-info-grid">
              <div>
                <small>Delivery Address</small>
                <strong>${escapeHtml(order.address)}, ${escapeHtml(order.city)}</strong>
              </div>

              <div>
                <small>Phone</small>
                <strong>${escapeHtml(order.phone)}</strong>
              </div>

              <div>
                <small>Payment</small>
                <strong>${paymentLabel(order)}</strong>
              </div>
            </div>

            <div class="order-bottom">
              <div>
                <small>Total</small>
                <strong>${money(order.total)}</strong>
              </div>

              <div>
                <small>Updated</small>
                <strong>${order.updated_at ? new Date(order.updated_at).toLocaleString() : "-"}</strong>
              </div>
            </div>

            ${order.status === "pending" || order.status === "approved"
              ? `<button type="button" class="cancel-order-btn" data-cancel-order="${order.id}">Cancel order</button>`
              : ""}
            ${orderActions(order)}
          </article>
        `;
      }).join("");

    } catch (error) {
      list.innerHTML = `
        <div class="orders-error">${escapeHtml(error.message)}</div>
      `;
    }
  }


  document.addEventListener("click", async event => {
    const btn = event.target.closest("[data-cancel-order]");
    if (!btn) return;

    if (!confirm("Cancel this order?")) return;

    btn.disabled = true;

    try {
      await api(`/api/orders/${btn.dataset.cancelOrder}/cancel`, {
        method: "POST",
        body: JSON.stringify({})
      });
      await loadOrders();
    } catch (error) {
      alert(error.message);
      btn.disabled = false;
    }
  });

  async function openProfile() {
    if (!token()) {
      document.getElementById("authScreen")?.scrollIntoView();
      return;
    }

    openPage(profilePage);
    await loadProfile();
    await loadOrders();
  }

  function getCart() {
    try {
      const user = getUser();

      if (user && user.id) {
        const userKey = `zento_cart_user_${user.id}`;
        const userCart = localStorage.getItem(userKey);

        if (userCart) {
          return JSON.parse(userCart);
        }
      }

      return JSON.parse(
        localStorage.getItem("novacart_cart") || "[]"
      );
    } catch {
      return [];
    }
  }

  function renderCheckout() {
    const cart = getCart();

    const container = document.getElementById("checkoutItems");
    const itemCount = document.getElementById("checkoutItemCount");
    const subtotalEl = document.getElementById("checkoutSubtotal");
    const deliveryEl = document.getElementById("checkoutDelivery");
    const totalEl = document.getElementById("checkoutTotal");

    let subtotal = 0;
    let count = 0;

    if (container) container.innerHTML = "";

    cart.forEach(item => {
      const quantity = Number(item.quantity) || 0;
      const price = Number(item.price) || 0;
      const line = quantity * price;

      subtotal += line;
      count += quantity;

      if (container) {
        container.insertAdjacentHTML("beforeend", `
          <div class="checkout-item">
            <div>
              <strong>${item.name}</strong>
              <span>${quantity} × ${money(price)}</span>
            </div>
            <strong>${money(line)}</strong>
          </div>
        `);
      }
    });

    const cityNow = document.getElementById("checkoutCity")?.value || "";
    const delivery = cityNow && window.ZentoDelivery && !coupon.freeShip ? window.ZentoDelivery.fee(cityNow) : 0;
    const discount = Math.min(coupon.discount, subtotal);
    const total = subtotal - discount + delivery;

    if (itemCount) itemCount.textContent = `${count} item${count === 1 ? "" : "s"}`;
    if (subtotalEl) subtotalEl.textContent = money(subtotal);
    if (deliveryEl) deliveryEl.textContent = !cityNow ? "Select district" : money(delivery);
    if (totalEl) totalEl.textContent = money(total);

    const discRow = document.getElementById("couponDiscountRow");
    const discEl = document.getElementById("checkoutDiscount");
    const discLabel = document.getElementById("couponDiscountLabel");
    if (discRow) discRow.hidden = !(coupon.code && (discount > 0 || coupon.freeShip));
    if (discEl) discEl.textContent = discount > 0 ? "-" + money(discount) : "Free delivery";
    if (discLabel) discLabel.textContent = coupon.code ? `Coupon (${coupon.code})` : "Coupon discount";
  }

  document.getElementById("checkoutCity")?.addEventListener("change", () => {
    renderCheckout();
    updateMobilePay(document.querySelector('input[name="paymentMethod"]:checked')?.value || "cod");
  });

  /* ---------- coupon code ---------- */

  const coupon = { code: "", discount: 0, freeShip: false };
  let couponTimer = null;

  function setCouponMsg(text, ok) {
    const el = document.getElementById("couponMsg");
    if (!el) return;
    el.textContent = text || "";
    el.className = "coupon-msg" + (text ? (ok ? " ok" : " bad") : "");
  }

  async function checkCoupon(code, quiet) {
    const cart = getCart();
    if (!code || !cart.length) {
      coupon.code = ""; coupon.discount = 0; coupon.freeShip = false;
      renderCheckout();
      return;
    }
    try {
      const data = await api("/api/coupons/validate", {
        method: "POST",
        body: JSON.stringify({ code, items: cart })
      });
      coupon.code = data.code;
      coupon.discount = Number(data.discount) || 0;
      coupon.freeShip = !!data.free_shipping;
      setCouponMsg(coupon.freeShip && !coupon.discount ? `${data.code} applied. Delivery is free!` : `${data.code} applied. You save ${money(coupon.discount)}.`, true);
    } catch (error) {
      coupon.code = ""; coupon.discount = 0; coupon.freeShip = false;
      setCouponMsg(error.message, false);
    }
    renderCheckout();
    updateMobilePay(document.querySelector('input[name="paymentMethod"]:checked')?.value || "cod");
  }

  document.getElementById("couponApply")?.addEventListener("click", () => {
    const input = document.getElementById("couponInput");
    const code = (input?.value || "").trim().toUpperCase();
    if (input) input.value = code;
    if (!code) { setCouponMsg("Enter a coupon code first.", false); return; }
    setCouponMsg("Checking...", true);
    checkCoupon(code);
  });

  document.getElementById("couponInput")?.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      document.getElementById("couponApply")?.click();
    }
  });

  /* ---------- bKash / Nagad manual payment ---------- */

  const paymentInfo = { bkash: "", nagad: "" };
  let paymentInfoLoaded = false;

  function currentTotal() {
    const cart = getCart();
    const subtotal = cart.reduce((sum, item) => sum + (Number(item.price) || 0) * (Number(item.quantity) || 0), 0);
    const cityNow = document.getElementById("checkoutCity")?.value || "";
    const deliveryNow = cityNow && window.ZentoDelivery && !coupon.freeShip ? window.ZentoDelivery.fee(cityNow) : 0;
    return subtotal - Math.min(coupon.discount, subtotal) + deliveryNow;
  }

  function updateMobilePay(method) {
    const box = document.getElementById("mobilePayBox");
    if (!box) return;

    const isMobile = method === "bkash" || method === "nagad";
    box.hidden = !isMobile;
    if (!isMobile) return;

    document.getElementById("mpName").textContent = method === "bkash" ? "bKash" : "Nagad";
    document.getElementById("mpNumber").textContent = paymentInfo[method] || "-";
    document.getElementById("mpAmount").textContent = money(currentTotal());
  }

  async function loadPaymentInfo() {
    if (paymentInfoLoaded) return;

    try {
      const res = await fetch(`${window.location.origin}/api/payment-info`);
      const data = await res.json();

      paymentInfo.bkash = data.bkash || "";
      paymentInfo.nagad = data.nagad || "";
      paymentInfoLoaded = true;
    } catch (error) {
      return;
    }

    const bk = document.getElementById("bkashOption");
    const ng = document.getElementById("nagadOption");

    if (bk) bk.hidden = !paymentInfo.bkash;
    if (ng) ng.hidden = !paymentInfo.nagad;
  }

  document.getElementById("mpCopy")?.addEventListener("click", event => {
    const number = document.getElementById("mpNumber")?.textContent || "";
    const button = event.currentTarget;

    const done = () => {
      button.textContent = "Copied";
      setTimeout(() => { button.textContent = "Copy"; }, 1500);
    };

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(number).then(done).catch(() => {});
    }
  });

  function paymentLabel(order) {
    const method = order.payment_method;

    if (method === "cod") return "Cash on Delivery";
    if (method === "bkash" || method === "nagad") {
      const name = method === "bkash" ? "bKash" : "Nagad";
      return order.payment_trx_id ? `${name} · ${escapeHtml(order.payment_trx_id)}` : name;
    }

    return "Card Payment";
  }

  function setupPaymentOptions() {
    const options = document.querySelectorAll('input[name="paymentMethod"]');
    const cardBox = document.getElementById("cardPaymentBox");

    if (!options.length) return;

    function updatePaymentUI() {
      const selected = document.querySelector('input[name="paymentMethod"]:checked');
      const method = selected?.value || "cod";

      document.querySelectorAll(".payment-option").forEach(option => {
        const radio = option.querySelector('input[name="paymentMethod"]');
        option.classList.toggle("active", radio?.checked === true);
      });

      if (cardBox) {
        cardBox.hidden = method !== "card";
      }

      updateMobilePay(method);
    }

    options.forEach(input => {
      input.addEventListener("change", updatePaymentUI);
    });

    updatePaymentUI();
  }

  async function openCheckout() {
    if (!token()) {
      alert("Please login before checkout.");
      return;
    }

    const cart = getCart();

    if (!cart.length) {
      return;
    }

    openPage(checkoutPage);
    renderCheckout();
    if (coupon.code) checkCoupon(coupon.code, true);   // cart may have changed since the coupon was applied
    loadPaymentInfo();
    await loadProfile();
  }

  profileNav?.addEventListener("click", event => {
    event.preventDefault();
    openProfile();
  });

  profileBack?.addEventListener("click", () => closePage(profilePage));

  checkoutBtn?.addEventListener("click", event => {
    event.preventDefault();
    openCheckout();
  });

  checkoutBack?.addEventListener("click", () => closePage(checkoutPage));

  profileForm?.addEventListener("submit", async event => {
    event.preventDefault();

    const message = document.getElementById("profileMessage");
    const button = profileForm.querySelector("button[type=submit]");

    if (message) message.textContent = "Saving...";
    if (button) button.disabled = true;

    try {
      const data = await api("/api/profile", {
        method: "PUT",
        body: JSON.stringify({
          name: document.getElementById("profileName")?.value.trim(),
          phone: document.getElementById("profilePhone")?.value.trim(),
          city: document.getElementById("profileCity")?.value.trim(),
          address: document.getElementById("profileAddress")?.value.trim()
        })
      });

      saveUser(data.user);

      if (message) {
        message.textContent = "✓ Profile updated successfully";
      }

      await loadProfile();

    } catch (error) {
      if (message) message.textContent = error.message;
    } finally {
      if (button) button.disabled = false;
    }
  });

  checkoutForm?.addEventListener("submit", async event => {
    event.preventDefault();

    const cart = getCart();

    if (!cart.length) return;

    const selectedPayment =
      document.querySelector('input[name="paymentMethod"]:checked')?.value || "cod";

    const message = document.getElementById("checkoutMessage");

    if (selectedPayment === "card") {
      if (message) {
        message.textContent =
          "Card payment is not active yet. Please select Cash on Delivery.";
      }
      return;
    }
    const isMobilePay = selectedPayment === "bkash" || selectedPayment === "nagad";
    const payTrx = document.getElementById("mpTrx")?.value.trim() || "";
    const paySender = document.getElementById("mpSender")?.value.trim() || "";

    if (isMobilePay && (!payTrx || !paySender)) {
      if (message) {
        message.textContent = "Enter the number you paid from and the Transaction ID.";
      }
      return;
    }

    if (!document.getElementById("checkoutCity")?.value) {
      if (message) message.textContent = "Please select your district so we can calculate delivery.";
      return;
    }

    const button = checkoutForm.querySelector("button[type=submit]");

    if (message) message.textContent = "Placing your order...";
    if (button) button.disabled = true;

    try {
      const data = await api("/api/orders", {
        method: "POST",
        body: JSON.stringify({
          customer_name: document.getElementById("checkoutName")?.value.trim(),
          phone: document.getElementById("checkoutPhone")?.value.trim(),
          city: document.getElementById("checkoutCity")?.value.trim(),
          address: document.getElementById("checkoutAddress")?.value.trim(),
          payment_method: selectedPayment,
          payment_trx_id: isMobilePay ? payTrx : "",
          payment_sender: isMobilePay ? paySender : "",
          coupon_code: coupon.code,
          items: cart
        })
      });

      const currentUser = getUser();

      if (currentUser && currentUser.id) {
        localStorage.removeItem(`zento_cart_user_${currentUser.id}`);
      }

      localStorage.removeItem("novacart_cart");

      if (typeof window.updateCartUI === "function") {
        window.updateCartUI();
      }

      coupon.code = ""; coupon.discount = 0; coupon.freeShip = false;
      const couponInput = document.getElementById("couponInput");
      if (couponInput) couponInput.value = "";
      setCouponMsg("", true);

      if (message) {
        message.textContent = `✓ Order #${data.order.id} placed successfully`;
      }

      setTimeout(() => {
        closePage(checkoutPage);
        openProfile();
      }, 900);

    } catch (error) {
      if (message) message.textContent = error.message;
    } finally {
      if (button) button.disabled = false;
    }
  });

  setupPaymentOptions();

  logoutBtn?.addEventListener("click", () => {
    localStorage.removeItem("zento_token");
    localStorage.removeItem("zento_user");
    localStorage.removeItem("novacart_cart");

    if (typeof window.zentoReloadUserCart === "function") {
      window.zentoReloadUserCart();
    }

    location.reload();
  });

});
