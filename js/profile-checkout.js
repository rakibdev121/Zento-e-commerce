
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
        approved: "Approved",
        processing: "Processing",
        shipped: "Shipped",
        out_for_delivery: "Out for Delivery",
        delivered: "Delivered"
      };

      const steps = [
        ["pending", "Order Placed"],
        ["approved", "Approved"],
        ["processing", "Processing"],
        ["shipped", "Shipped"],
        ["out_for_delivery", "Out for Delivery"],
        ["delivered", "Delivered"]
      ];

      list.innerHTML = data.orders.map(order => {
        const currentIndex = Math.max(
          0,
          steps.findIndex(step => step[0] === order.status)
        );

        const tracking = steps.map((step, index) => `
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
                ${order.discount_amount > 0 ? `<small class="discount-green">Coupon ${escapeHtml(order.coupon_code)} saved ${money(order.discount_amount)}</small>` : ""}
              </div>

              <div>
                <small>Updated</small>
                <strong>${order.updated_at ? new Date(order.updated_at).toLocaleString() : "-"}</strong>
              </div>
            </div>
          </article>
        `;
      }).join("");

    } catch (error) {
      list.innerHTML = `
        <div class="orders-error">${escapeHtml(error.message)}</div>
      `;
    }
  }


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

    const delivery = subtotal >= 100 ? 0 : 5;
    const discount = Math.min(couponDiscount, subtotal);
    const total = subtotal + delivery - discount;

    if (itemCount) itemCount.textContent = `${count} item${count === 1 ? "" : "s"}`;
    if (subtotalEl) subtotalEl.textContent = money(subtotal);
    if (deliveryEl) deliveryEl.textContent = delivery === 0 ? "FREE" : money(delivery);

    const discountRow = document.getElementById("checkoutDiscountRow");
    const discountEl = document.getElementById("checkoutDiscount");
    const discountLabel = document.getElementById("checkoutDiscountLabel");
    if (discountRow) discountRow.hidden = !(couponCode && discount > 0);
    if (discountEl) discountEl.textContent = "-" + money(discount);
    if (discountLabel) discountLabel.textContent = couponCode ? `Coupon (${couponCode})` : "Coupon discount";

    if (totalEl) totalEl.textContent = money(total);
  }

  /* ---------- coupon ---------- */

  let couponCode = "";
  let couponDiscount = 0;

  function couponMessage(text, kind) {
    const el = document.getElementById("couponMsg");
    if (!el) return;
    el.textContent = text || "";
    el.className = "coupon-msg" + (kind ? " " + kind : "");
  }

  function clearCoupon(keepMessage) {
    couponCode = "";
    couponDiscount = 0;
    const input = document.getElementById("couponInput");
    if (input) input.value = "";
    if (!keepMessage) couponMessage("");
  }

  async function applyCoupon(code, silent) {
    const cart = getCart();
    const button = document.getElementById("couponApply");

    if (!code) {
      couponMessage("Enter a coupon code", "bad");
      return;
    }

    if (button) button.disabled = true;
    if (!silent) couponMessage("Checking coupon...");

    try {
      const data = await api("/api/coupons/validate", {
        method: "POST",
        body: JSON.stringify({ code, items: cart })
      });

      couponCode = data.code;
      couponDiscount = Number(data.discount) || 0;
      const input = document.getElementById("couponInput");
      if (input) input.value = data.code;
      couponMessage(data.message, "ok");
    } catch (error) {
      clearCoupon(true);
      couponMessage(error.message, "bad");
    } finally {
      if (button) button.disabled = false;
      renderCheckout();
      updateMobilePay(document.querySelector('input[name="paymentMethod"]:checked')?.value || "cod");
    }
  }

  document.getElementById("couponApply")?.addEventListener("click", () => {
    const code = document.getElementById("couponInput")?.value.trim() || "";
    applyCoupon(code, false);
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
    return subtotal + (subtotal >= 100 ? 0 : 5) - Math.min(couponDiscount, subtotal);
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
    if (couponCode) applyCoupon(couponCode, true);
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
          coupon_code: couponCode,
          items: cart
        })
      });

      clearCoupon();

      const currentUser = getUser();

      if (currentUser && currentUser.id) {
        localStorage.removeItem(`zento_cart_user_${currentUser.id}`);
      }

      localStorage.removeItem("novacart_cart");

      if (typeof window.updateCartUI === "function") {
        window.updateCartUI();
      }

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
