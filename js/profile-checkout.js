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

    if (!response.ok) {
      throw new Error(data.message || "Request failed");
    }

    return data;
  }

  function money(value) {
    return `$${Number(value || 0).toFixed(2)}`;
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
    if (!list || !token()) return;

    list.innerHTML = '<div class="orders-loading">Loading orders...</div>';

    try {
      const data = await api("/api/orders");

      if (!data.orders?.length) {
        list.innerHTML = `
          <div class="orders-empty">
            <div>📦</div>
            <strong>No orders yet</strong>
            <span>Your completed orders will appear here.</span>
          </div>
        `;
        return;
      }

      list.innerHTML = data.orders.map(order => `
        <article class="order-card">
          <div class="order-top">
            <div>
              <small>Order #${order.id}</small>
              <strong>${new Date(order.created_at).toLocaleDateString()}</strong>
            </div>
            <span class="order-status status-${order.status}">
              ${order.status}
            </span>
          </div>

          <div class="order-items">
            ${order.items.map(item => `
              <div class="order-item">
                <span>${item.name} × ${item.quantity}</span>
                <strong>${money(item.subtotal)}</strong>
              </div>
            `).join("")}
          </div>

          <div class="order-bottom">
            <span>Total</span>
            <strong>${money(order.total)}</strong>
          </div>
        </article>
      `).join("");

    } catch (error) {
      list.innerHTML = `
        <div class="orders-error">${error.message}</div>
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
    const total = subtotal + delivery;

    if (itemCount) itemCount.textContent = `${count} item${count === 1 ? "" : "s"}`;
    if (subtotalEl) subtotalEl.textContent = money(subtotal);
    if (deliveryEl) deliveryEl.textContent = delivery === 0 ? "FREE" : money(delivery);
    if (totalEl) totalEl.textContent = money(total);
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

    const message = document.getElementById("checkoutMessage");
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
          items: cart
        })
      });

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

  logoutBtn?.addEventListener("click", () => {
    localStorage.removeItem("zento_token");
    localStorage.removeItem("zento_user");

    location.reload();
  });

});
