import { supabase } from "../js/supabase.js";

/* =========================================================
   ZENTO ADMIN DASHBOARD
========================================================= */

const API_BASE = window.location.origin;

let products = [];
let orders = [];
let currentEditingProductId = null;

/* =========================================================
   HELPERS
========================================================= */

function $(id) {
  return document.getElementById(id);
}

function escapeHtml(value) {
  if (value === null || value === undefined) return "";

  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatPrice(value) {
  const number = Number(value || 0);

  return `৳${number.toLocaleString("en-BD", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function formatDate(value) {
  if (!value) return "-";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function formatDateTime(value) {
  if (!value) return "-";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function getAdminToken() {
  return localStorage.getItem("zento_admin_token") || "";
}

function getAdminUser() {
  try {
    return JSON.parse(
      localStorage.getItem("zento_admin_user") || "null"
    );
  } catch {
    return null;
  }
}

function showToast(message, type = "success") {
  let toast = $("adminToast");

  if (!toast) {
    toast = document.createElement("div");
    toast.id = "adminToast";
    toast.className = "toast";
    document.body.appendChild(toast);
  }

  toast.textContent = message;
  toast.className = `toast show ${type}`;

  clearTimeout(window.__zentoToastTimer);

  window.__zentoToastTimer = setTimeout(() => {
    toast.classList.remove("show");
  }, 2800);
}

function setMessage(elementId, message, type = "success") {
  const element = $(elementId);

  if (!element) return;

  element.textContent = message;
  element.className = `message show ${type}`;

  if (message) {
    setTimeout(() => {
      element.classList.remove("show");
    }, 4000);
  }
}

/* =========================================================
   API
========================================================= */

async function apiRequest(path, options = {}) {
  const headers = {
    ...(options.headers || {})
  };

  if (!headers["Content-Type"] && options.body) {
    headers["Content-Type"] = "application/json";
  }

  const token = getAdminToken();

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers
  });

  let data = null;

  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    const message =
      data?.message ||
      data?.error ||
      `Request failed (${response.status})`;

    throw new Error(message);
  }

  return data;
}

/* =========================================================
   LOGIN
========================================================= */

async function adminLogin(email, password) {
  const errorBox = $("loginError");

  try {
    if (errorBox) {
      errorBox.textContent = "";
      errorBox.classList.remove("show");
    }

    const response = await fetch(`${API_BASE}/api/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email,
        password
      })
    });

    const data = await response.json();

    if (!response.ok || data.status !== "success") {
      throw new Error(
        data?.message ||
        data?.error ||
        "Invalid email or password."
      );
    }

    if (data.user?.role !== "admin") {
      throw new Error("This account does not have admin access.");
    }

    const token =
      data.token ||
      data.access_token ||
      data.jwt ||
      "";

    if (!token) {
      throw new Error("Login succeeded but no authentication token was returned.");
    }

    localStorage.setItem("zento_admin_token", token);
    localStorage.setItem(
      "zento_admin_user",
      JSON.stringify(data.user)
    );

    showAdminApp();

    await loadDashboard();

    showToast("Admin login successful.");

  } catch (error) {
    console.error("Admin login error:", error);

    if (errorBox) {
      errorBox.textContent = error.message;
      errorBox.classList.add("show");
    }
  }
}

async function checkAdminSession() {
  const token = getAdminToken();

  if (!token) {
    showLoginScreen();
    return false;
  }

  try {
    const data = await apiRequest("/api/profile");

    const user = data.user || data;

    if (user?.role !== "admin") {
      throw new Error("Not an admin.");
    }

    localStorage.setItem(
      "zento_admin_user",
      JSON.stringify(user)
    );

    showAdminApp();

    return true;

  } catch (error) {
    console.warn("Admin session invalid:", error);

    localStorage.removeItem("zento_admin_token");
    localStorage.removeItem("zento_admin_user");

    showLoginScreen();

    return false;
  }
}

function showLoginScreen() {
  const login = $("loginScreen");
  const app = $("adminApp");

  if (login) {
    login.style.display = "flex";
  }

  if (app) {
    app.classList.remove("active");
    app.style.display = "none";
  }
}

function showAdminApp() {
  const login = $("loginScreen");
  const app = $("adminApp");

  if (login) {
    login.style.display = "none";
  }

  if (app) {
    app.style.display = "flex";
    app.classList.add("active");
  }

  updateAdminProfile();
}

function updateAdminProfile() {
  const user = getAdminUser();

  if (!user) return;

  const name =
    user.name ||
    user.full_name ||
    user.email ||
    "Zento Admin";

  const email =
    user.email ||
    "";

  const nameElements = document.querySelectorAll(
    ".admin-mini-name, .admin-name"
  );

  nameElements.forEach((element) => {
    element.textContent = name;
  });

  const emailElements = document.querySelectorAll(
    ".admin-email"
  );

  emailElements.forEach((element) => {
    element.textContent = email;
  });

  const avatarElements = document.querySelectorAll(
    ".admin-avatar"
  );

  avatarElements.forEach((element) => {
    element.textContent =
      name.trim().charAt(0).toUpperCase() || "A";
  });
}

function logoutAdmin() {
  localStorage.removeItem("zento_admin_token");
  localStorage.removeItem("zento_admin_user");

  showLoginScreen();

  showToast("Logged out.", "success");
}

/* =========================================================
   NAVIGATION
========================================================= */

function setupNavigation() {
  const navItems = document.querySelectorAll(
    ".nav-item[data-page]"
  );

  navItems.forEach((item) => {
    item.addEventListener("click", () => {
      const page = item.dataset.page;

      if (!page) return;

      navigateTo(page);
    });
  });

  document.querySelectorAll(
    "[data-page-link]"
  ).forEach((element) => {
    element.addEventListener("click", () => {
      const page = element.dataset.pageLink;

      if (page) {
        navigateTo(page);
      }
    });
  });
}

async function navigateTo(pageName) {
  document.querySelectorAll(".page").forEach((page) => {
    page.classList.remove("active");
  });

  const targetPage = $(`page-${pageName}`);

  if (targetPage) {
    targetPage.classList.add("active");
  }

  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.toggle(
      "active",
      item.dataset.page === pageName
    );
  });

  const breadcrumb = $("breadcrumbText");

  if (breadcrumb) {
    const names = {
      dashboard: "Dashboard",
      products: "Products",
      orders: "Orders",
      customers: "Customers",
      categories: "Categories",
      settings: "Settings"
    };

    breadcrumb.textContent =
      names[pageName] || "Dashboard";
  }

  closeMobileSidebar();

  try {
    if (pageName === "dashboard") {
      await loadDashboard();
    }

    if (pageName === "products") {
      await loadProducts();
    }

    if (pageName === "orders") {
      await loadOrders();
    }

    if (pageName === "customers") {
      await loadCustomers();
    }

    if (pageName === "categories") {
      await loadCategories();
    }
  } catch (error) {
    console.error(`Failed loading ${pageName}:`, error);
    showToast(error.message, "error");
  }
}

/* =========================================================
   MOBILE SIDEBAR
========================================================= */

function setupMobileMenu() {
  const button = $("mobileMenuBtn");
  const sidebar = document.querySelector(".sidebar");

  if (!button || !sidebar) return;

  button.addEventListener("click", () => {
    sidebar.classList.toggle("mobile-open");
    createSidebarOverlay();
  });
}

function createSidebarOverlay() {
  let overlay = document.querySelector(".sidebar-overlay");

  if (!overlay) {
    overlay = document.createElement("div");
    overlay.className = "sidebar-overlay";

    document.body.appendChild(overlay);

    overlay.addEventListener("click", closeMobileSidebar);
  }

  overlay.classList.add("show");
}

function closeMobileSidebar() {
  const sidebar = document.querySelector(".sidebar");
  const overlay = document.querySelector(".sidebar-overlay");

  if (sidebar) {
    sidebar.classList.remove("mobile-open");
  }

  if (overlay) {
    overlay.classList.remove("show");
  }
}

/* =========================================================
   PRODUCTS
========================================================= */

async function loadProducts() {
  const container =
    $("productsTableBody") ||
    $("productsList");

  try {
    const data = await apiRequest("/api/products", {
      method: "GET"
    });

    products =
      Array.isArray(data)
        ? data
        : data.products || data.data || [];

    renderProducts();

  } catch (error) {
    console.error("Products error:", error);

    if (container) {
      container.innerHTML = `
        <tr>
          <td colspan="7">
            <div class="empty-state">
              <div class="empty-icon">⚠️</div>
              <div class="empty-title">Failed to load products</div>
              <div>${escapeHtml(error.message)}</div>
            </div>
          </td>
        </tr>
      `;
    }

    throw error;
  }
}

function renderProducts(list = products) {
  const tbody =
    $("productsTableBody") ||
    $("productsList");

  if (!tbody) return;

  if (!list.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7">
          <div class="empty-state">
            <div class="empty-icon">📦</div>
            <div class="empty-title">No products found</div>
            <div>Add your first product using the form.</div>
          </div>
        </td>
      </tr>
    `;

    return;
  }

  tbody.innerHTML = list.map((product) => {

    const image =
      product.image_url ||
      product.image ||
      "";

    const stock =
      Number(product.stock || 0);

    return `
      <tr>
        <td>
          <div class="product-cell">
            ${
              image
                ? `
                  <img
                    class="product-thumb"
                    src="${escapeHtml(image)}"
                    alt="${escapeHtml(product.name)}"
                    onerror="this.style.display='none'"
                  >
                `
                : `
                  <div class="product-thumb"
                       style="display:flex;align-items:center;justify-content:center;">
                    📦
                  </div>
                `
            }

            <div>
              <div class="product-name">
                ${escapeHtml(product.name)}
              </div>

              <div class="product-category">
                ${escapeHtml(product.category || "Uncategorized")}
              </div>
            </div>
          </div>
        </td>

        <td class="price">
          ${formatPrice(product.price)}
        </td>

        <td>
          <span class="${
            stock <= 5
              ? "stock-low"
              : "stock-ok"
          }">
            ${stock}
          </span>
        </td>

        <td>
          ${escapeHtml(product.category || "-")}
        </td>

        <td>
          ${formatDate(product.created_at)}
        </td>

        <td>
          <div style="display:flex;gap:6px;">
            <button
              class="btn btn-secondary btn-sm"
              data-edit-product="${product.id}"
            >
              Edit
            </button>

            <button
              class="btn btn-danger btn-sm"
              data-delete-product="${product.id}"
            >
              Delete
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll(
    "[data-edit-product]"
  ).forEach((button) => {
    button.addEventListener("click", () => {
      editProduct(button.dataset.editProduct);
    });
  });

  tbody.querySelectorAll(
    "[data-delete-product]"
  ).forEach((button) => {
    button.addEventListener("click", () => {
      deleteProduct(button.dataset.deleteProduct);
    });
  });
}

function setupProductSearch() {
  const search =
    $("productSearch") ||
    $("searchProducts");

  if (!search) return;

  search.addEventListener("input", () => {
    const query =
      search.value.trim().toLowerCase();

    if (!query) {
      renderProducts(products);
      return;
    }

    const filtered = products.filter((product) => {
      return [
        product.name,
        product.description,
        product.category
      ]
        .filter(Boolean)
        .some((value) =>
          String(value)
            .toLowerCase()
            .includes(query)
        );
    });

    renderProducts(filtered);
  });
}

/* =========================================================
   PRODUCT FORM
========================================================= */

function setupProductForm() {
  const form = $("productForm");

  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    await saveProduct();
  });

  const cancelButtons = [
    $("cancelProductBtn"),
    $("cancelProductBtn2")
  ];

  cancelButtons.forEach((button) => {
    if (!button) return;

    button.addEventListener("click", resetProductForm);
  });

  const fileInput = $("productImageFile");

  if (fileInput) {
    fileInput.addEventListener("change", previewProductImage);
  }
}

function previewProductImage(event) {
  const file =
    event.target.files?.[0];

  const preview =
    $("productImagePreview");

  if (!preview || !file) return;

  const reader = new FileReader();

  reader.onload = () => {
    preview.innerHTML = `
      <img
        src="${reader.result}"
        alt="Product preview"
      >
    `;
  };

  reader.readAsDataURL(file);
}

function fillProductForm(product) {
  currentEditingProductId = product.id;

  if ($("productId")) {
    $("productId").value = product.id || "";
  }

  if ($("productName")) {
    $("productName").value = product.name || "";
  }

  if ($("productDescription")) {
    $("productDescription").value =
      product.description || "";
  }

  if ($("productPrice")) {
    $("productPrice").value =
      product.price ?? "";
  }

  if ($("productImage")) {
    $("productImage").value =
      product.image_url || "";
  }

  if ($("productCategory")) {
    $("productCategory").value =
      product.category || "";
  }

  if ($("productStock")) {
    $("productStock").value =
      product.stock ?? 0;
  }

  const preview =
    $("productImagePreview");

  if (preview) {
    if (product.image_url) {
      preview.innerHTML = `
        <img
          src="${escapeHtml(product.image_url)}"
          alt="${escapeHtml(product.name)}"
        >
      `;
    } else {
      preview.textContent =
        "Product image preview";
    }
  }

  const title =
    $("productFormTitle");

  if (title) {
    title.textContent = "Edit Product";
  }

  const submit =
    $("productSubmitBtn");

  if (submit) {
    submit.textContent = "Update Product";
  }

  const form =
    $("productForm");

  if (form) {
    form.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }
}

function editProduct(productId) {
  const product = products.find(
    (item) =>
      String(item.id) === String(productId)
  );

  if (!product) {
    showToast("Product not found.", "error");
    return;
  }

  fillProductForm(product);
}

function resetProductForm() {
  const form = $("productForm");

  if (form) {
    form.reset();
  }

  currentEditingProductId = null;

  if ($("productId")) {
    $("productId").value = "";
  }

  if ($("productFormTitle")) {
    $("productFormTitle").textContent =
      "Add New Product";
  }

  if ($("productSubmitBtn")) {
    $("productSubmitBtn").textContent =
      "Save Product";
  }

  if ($("productImagePreview")) {
    $("productImagePreview").innerHTML =
      "Product image preview";
  }

  if ($("productFormMessage")) {
    $("productFormMessage").className =
      "message";
  }
}

async function uploadProductImage(file) {
  if (!file) return "";

  if (!supabase) {
    throw new Error(
      "Supabase client is not available."
    );
  }

  const extension =
    file.name.split(".").pop()?.toLowerCase() ||
    "jpg";

  const fileName =
    `product-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}.${extension}`;

  const { error } =
    await supabase.storage
      .from("product-images")
      .upload(fileName, file, {
        upsert: false,
        contentType: file.type
      });

  if (error) {
    throw error;
  }

  const { data } =
    supabase.storage
      .from("product-images")
      .getPublicUrl(fileName);

  return data?.publicUrl || "";
}

async function saveProduct() {
  const form =
    $("productForm");

  if (!form) return;

  const name =
    $("productName")?.value.trim();

  const description =
    $("productDescription")?.value.trim();

  const price =
    Number($("productPrice")?.value || 0);

  const category =
    $("productCategory")?.value.trim();

  const stock =
    Number($("productStock")?.value || 0);

  let imageUrl =
    $("productImage")?.value.trim() || "";

  const file =
    $("productImageFile")?.files?.[0];

  if (!name) {
    setMessage(
      "productFormMessage",
      "Product name is required.",
      "error"
    );
    return;
  }

  if (price < 0) {
    setMessage(
      "productFormMessage",
      "Price cannot be negative.",
      "error"
    );
    return;
  }

  if (stock < 0) {
    setMessage(
      "productFormMessage",
      "Stock cannot be negative.",
      "error"
    );
    return;
  }

  try {
    setMessage(
      "productFormMessage",
      currentEditingProductId
        ? "Updating product..."
        : "Creating product...",
      "success"
    );

    if (file) {
      imageUrl =
        await uploadProductImage(file);
    }

    const payload = {
      name,
      description,
      price,
      image_url: imageUrl,
      category,
      stock
    };

    if (currentEditingProductId) {

      await apiRequest(
        `/api/products/${currentEditingProductId}`,
        {
          method: "PUT",
          body: JSON.stringify(payload)
        }
      );

      showToast("Product updated successfully.");

    } else {

      await apiRequest(
        "/api/products",
        {
          method: "POST",
          body: JSON.stringify(payload)
        }
      );

      showToast("Product created successfully.");
    }

    resetProductForm();

    await loadProducts();
    await loadDashboard();

  } catch (error) {
    console.error("Save product error:", error);

    setMessage(
      "productFormMessage",
      error.message ||
        "Failed to save product.",
      "error"
    );
  }
}

async function deleteProduct(productId) {
  const product =
    products.find(
      (item) =>
        String(item.id) ===
        String(productId)
    );

  const name =
    product?.name ||
    "this product";

  const confirmed =
    window.confirm(
      `Delete "${name}"?\n\nThis action cannot be undone.`
    );

  if (!confirmed) return;

  try {
    await apiRequest(
      `/api/products/${productId}`,
      {
        method: "DELETE"
      }
    );

    showToast("Product deleted successfully.");

    await loadProducts();
    await loadDashboard();

  } catch (error) {
    console.error("Delete product error:", error);

    showToast(
      error.message ||
        "Failed to delete product.",
      "error"
    );
  }
}

/* =========================================================
   ORDERS
========================================================= */

async function loadOrders() {
  const list =
    $("ordersList");

  if (list) {
    list.innerHTML = `
      <div class="loading">
        <span class="spinner"></span>
        Loading orders...
      </div>
    `;
  }

  try {
    const data =
      await apiRequest("/api/admin/orders", {
        method: "GET"
      });

    orders =
      Array.isArray(data)
        ? data
        : data.orders ||
          data.data ||
          [];

    renderOrders();

  } catch (error) {
    console.error("Orders error:", error);

    if (list) {
      list.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">⚠️</div>
          <div class="empty-title">
            Failed to load orders
          </div>
          <div>
            ${escapeHtml(error.message)}
          </div>
        </div>
      `;
    }

    throw error;
  }
}

function getOrderItems(order) {
  return (
    order.items ||
    order.order_items ||
    []
  );
}

function renderOrders(list = orders) {
  const container =
    $("ordersList");

  if (!container) return;

  if (!list.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🛍️</div>
        <div class="empty-title">
          No orders yet
        </div>
        <div>
          Customer orders will appear here.
        </div>
      </div>
    `;

    return;
  }

  container.innerHTML =
    list.map((order) => {

      const items =
        getOrderItems(order);

      const status =
        order.status ||
        "pending";

      const total =
        Number(
          order.total ??
          order.grand_total ??
          0
        );

      const customer =
        order.customer_name ||
        order.name ||
        "Customer";

      const phone =
        order.phone ||
        order.customer_phone ||
        "";

      const address =
        order.address ||
        "";

      return `
        <div class="order-card">

          <div class="order-top">

            <div>
              <div class="order-number">
                Order #${escapeHtml(order.id)}
              </div>

              <div class="order-date">
                ${formatDateTime(
                  order.created_at
                )}
              </div>
            </div>

            <span class="status ${escapeHtml(status)}">
              ${escapeHtml(
                status.replaceAll("_", " ")
              )}
            </span>

          </div>

          <div class="order-customer">

            <span>
              👤 ${escapeHtml(customer)}
            </span>

            ${
              phone
                ? `
                  <span>
                    📞 ${escapeHtml(phone)}
                  </span>
                `
                : ""
            }

            ${
              address
                ? `
                  <span>
                    📍 ${escapeHtml(address)}
                  </span>
                `
                : ""
            }

          </div>

          <div class="order-items">

            ${
              items.length
                ? items.map((item) => `
                    <div class="order-item">

                      <span class="order-item-name">
                        ${escapeHtml(
                          item.product_name ||
                          item.name ||
                          "Product"
                        )}
                        ×
                        ${Number(
                          item.quantity || 1
                        )}
                      </span>

                      <span>
                        ${formatPrice(
                          item.subtotal ??
                          (
                            Number(item.price || 0) *
                            Number(item.quantity || 1)
                          )
                        )}
                      </span>

                    </div>
                  `).join("")
                : `
                  <div class="order-item">
                    <span>
                      Order items unavailable
                    </span>
                  </div>
                `
            }

          </div>

          <div class="order-bottom">

            <div class="order-total">
              ${formatPrice(total)}
            </div>

            <div class="order-actions">

              ${
                status === "pending"
                  ? `
                    <button
                      class="btn btn-success btn-sm"
                      data-approve-order="${order.id}"
                    >
                      ✓ Approve
                    </button>
                  `
                  : ""
              }

              <button
                class="btn btn-secondary btn-sm"
                data-print-order="${order.id}"
              >
                🖨 Print
              </button>

              <select
                class="btn btn-secondary btn-sm"
                data-status-order="${order.id}"
              >
                ${orderStatusOptions(status)}
              </select>

            </div>

          </div>

        </div>
      `;
    }).join("");

  container.querySelectorAll(
    "[data-approve-order]"
  ).forEach((button) => {
    button.addEventListener("click", () => {
      approveOrder(
        button.dataset.approveOrder
      );
    });
  });

  container.querySelectorAll(
    "[data-print-order]"
  ).forEach((button) => {
    button.addEventListener("click", () => {
      printOrder(
        button.dataset.printOrder
      );
    });
  });

  container.querySelectorAll(
    "[data-status-order]"
  ).forEach((select) => {
    select.addEventListener("change", () => {
      updateOrderStatus(
        select.dataset.statusOrder,
        select.value
      );
    });
  });
}

function orderStatusOptions(current) {
  const statuses = [
    "pending",
    "approved",
    "processing",
    "shipped",
    "out_for_delivery",
    "delivered"
  ];

  return statuses.map((status) => `
    <option
      value="${status}"
      ${status === current ? "selected" : ""}
    >
      ${status.replaceAll("_", " ")}
    </option>
  `).join("");
}

async function approveOrder(orderId) {
  const confirmed =
    window.confirm(
      `Approve order #${orderId}?`
    );

  if (!confirmed) return;

  try {
    await apiRequest(
      `/api/admin/orders/${orderId}/approve`,
      {
        method: "POST"
      }
    );

    showToast(
      `Order #${orderId} approved.`
    );

    await loadOrders();
    await loadDashboard();

  } catch (error) {
    console.error("Approve order error:", error);

    showToast(
      error.message ||
        "Failed to approve order.",
      "error"
    );
  }
}

async function updateOrderStatus(
  orderId,
  status
) {
  try {
    await apiRequest(
      `/api/admin/orders/${orderId}/status`,
      {
        method: "PUT",
        body: JSON.stringify({
          status
        })
      }
    );

    showToast(
      `Order #${orderId} updated.`
    );

    await loadOrders();
    await loadDashboard();

  } catch (error) {
    console.error(
      "Order status error:",
      error
    );

    showToast(
      error.message ||
        "Failed to update order.",
      "error"
    );

    await loadOrders();
  }
}

function printOrder(orderId) {
  const order =
    orders.find(
      (item) =>
        String(item.id) ===
        String(orderId)
    );

  if (!order) {
    showToast(
      "Order not found.",
      "error"
    );
    return;
  }

  const items =
    getOrderItems(order);

  const customer =
    order.customer_name ||
    order.name ||
    "Customer";

  const phone =
    order.phone ||
    "";

  const address =
    order.address ||
    "";

  const total =
    Number(order.total || 0);

  const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Zento Order #${escapeHtml(order.id)}</title>

<style>
body{
  font-family:Arial,sans-serif;
  padding:30px;
  color:#222;
}

.receipt{
  max-width:700px;
  margin:auto;
}

h1{
  margin-bottom:5px;
}

.muted{
  color:#666;
  font-size:13px;
}

.customer{
  margin:25px 0;
  padding:15px;
  border:1px solid #ddd;
}

table{
  width:100%;
  border-collapse:collapse;
}

th,td{
  padding:10px;
  border-bottom:1px solid #ddd;
  text-align:left;
}

.total{
  text-align:right;
  font-size:20px;
  font-weight:bold;
  margin-top:20px;
}

@media print{
  button{
    display:none;
  }
}
</style>

</head>

<body>

<div class="receipt">

<h1>ZENTO</h1>

<div class="muted">
Order #${escapeHtml(order.id)}
</div>

<div class="muted">
${formatDateTime(order.created_at)}
</div>

<div class="customer">

<strong>Customer</strong><br>

${escapeHtml(customer)}
<br>

${escapeHtml(phone)}
<br>

${escapeHtml(address)}

</div>

<table>

<thead>
<tr>
<th>Product</th>
<th>Qty</th>
<th>Price</th>
<th>Subtotal</th>
</tr>
</thead>

<tbody>

${
  items.map((item) => {

    const quantity =
      Number(item.quantity || 1);

    const price =
      Number(item.price || 0);

    const subtotal =
      Number(
        item.subtotal ??
        price * quantity
      );

    return `
      <tr>
        <td>
          ${escapeHtml(
            item.product_name ||
            item.name ||
            "Product"
          )}
        </td>

        <td>${quantity}</td>

        <td>${formatPrice(price)}</td>

        <td>${formatPrice(subtotal)}</td>
      </tr>
    `;

  }).join("")
}

</tbody>

</table>

<div class="total">
Total: ${formatPrice(total)}
</div>

</div>

<script>
window.onload = function(){
  window.print();
};
</script>

</body>
</html>
`;

  const popup =
    window.open(
      "",
      "_blank",
      "width=800,height=900"
    );

  if (!popup) {
    showToast(
      "Please allow popups to print the receipt.",
      "error"
    );
    return;
  }

  popup.document.open();
  popup.document.write(html);
  popup.document.close();
}

/* =========================================================
   DASHBOARD
========================================================= */

async function loadDashboard() {
  try {
    const [
      productResult,
      orderResult
    ] = await Promise.allSettled([
      apiRequest("/api/products"),
      apiRequest("/api/admin/orders")
    ]);

    if (
      productResult.status === "fulfilled"
    ) {
      const data =
        productResult.value;

      products =
        Array.isArray(data)
          ? data
          : data.products ||
            data.data ||
            [];
    }

    if (
      orderResult.status === "fulfilled"
    ) {
      const data =
        orderResult.value;

      orders =
        Array.isArray(data)
          ? data
          : data.orders ||
            data.data ||
            [];
    }

    updateDashboardStats();

    renderRecentOrders();

  } catch (error) {
    console.error(
      "Dashboard error:",
      error
    );
  }
}

function updateDashboardStats() {
  const totalProducts =
    products.length;

  const totalOrders =
    orders.length;

  const customerSet =
    new Set();

  orders.forEach((order) => {

    const key =
      order.phone ||
      order.email ||
      order.customer_email ||
      order.customer_name ||
      order.user_id;

    if (key) {
      customerSet.add(String(key));
    }
  });

  const totalCustomers =
    customerSet.size;

  const totalSales =
    orders
      .filter((order) => {
        const status =
          order.status || "";

        return status !== "cancelled";
      })
      .reduce(
        (sum, order) =>
          sum +
          Number(
            order.total ||
            order.grand_total ||
            0
          ),
        0
      );

  setText(
    "totalProducts",
    totalProducts
  );

  setText(
    "totalOrders",
    totalOrders
  );

  setText(
    "totalCustomers",
    totalCustomers
  );

  setText(
    "totalSales",
    formatPrice(totalSales)
  );
}

function setText(id, value) {
  const element = $(id);

  if (element) {
    element.textContent = value;
  }
}

function renderRecentOrders() {
  const container =
    $("recentOrders");

  if (!container) return;

  const recent =
    [...orders]
      .sort(
        (a, b) =>
          new Date(
            b.created_at || 0
          ) -
          new Date(
            a.created_at || 0
          )
      )
      .slice(0, 5);

  if (!recent.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🛒</div>
        <div class="empty-title">
          No recent orders
        </div>
        <div>
          New customer orders will appear here.
        </div>
      </div>
    `;

    return;
  }

  container.innerHTML = `
    <div class="table-wrap">

      <table class="data-table">

        <thead>
          <tr>
            <th>Order</th>
            <th>Customer</th>
            <th>Total</th>
            <th>Status</th>
            <th>Date</th>
          </tr>
        </thead>

        <tbody>

          ${recent.map((order) => {

            const status =
              order.status ||
              "pending";

            return `
              <tr>

                <td>
                  <strong>
                    #${escapeHtml(order.id)}
                  </strong>
                </td>

                <td>
                  ${escapeHtml(
                    order.customer_name ||
                    order.name ||
                    "Customer"
                  )}
                </td>

                <td class="price">
                  ${formatPrice(
                    order.total || 0
                  )}
                </td>

                <td>
                  <span class="status ${escapeHtml(status)}">
                    ${escapeHtml(
                      status.replaceAll("_", " ")
                    )}
                  </span>
                </td>

                <td>
                  ${formatDate(
                    order.created_at
                  )}
                </td>

              </tr>
            `;

          }).join("")}

        </tbody>

      </table>

    </div>
  `;
}

/* =========================================================
   CUSTOMERS
========================================================= */

async function loadCustomers() {
  const container =
    $("customersList") ||
    $("customersGrid");

  if (!container) return;

  if (!orders.length) {
    try {
      await loadOrders();
    } catch {
      return;
    }
  }

  const customers =
    buildCustomersFromOrders();

  renderCustomers(customers);
}

function buildCustomersFromOrders() {
  const map = new Map();

  orders.forEach((order) => {

    const key =
      order.phone ||
      order.email ||
      order.customer_email ||
      order.customer_name ||
      order.user_id;

    if (!key) return;

    const existing =
      map.get(String(key));

    if (existing) {

      existing.orders += 1;

      existing.total +=
        Number(order.total || 0);

      return;
    }

    map.set(
      String(key),
      {
        name:
          order.customer_name ||
          order.name ||
          "Customer",

        phone:
          order.phone ||
          "",

        email:
          order.email ||
          order.customer_email ||
          "",

        orders:1,

        total:
          Number(order.total || 0)
      }
    );
  });

  return Array.from(map.values());
}

function renderCustomers(customers) {
  const container =
    $("customersList") ||
    $("customersGrid");

  if (!container) return;

  if (!customers.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">👥</div>
        <div class="empty-title">
          No customers yet
        </div>
      </div>
    `;

    return;
  }

  container.innerHTML = `
    <div class="customer-grid">

      ${customers.map((customer) => `
        <div class="customer-card">

          <div class="customer-avatar">
            ${escapeHtml(
              customer.name
                .charAt(0)
                .toUpperCase()
            )}
          </div>

          <div class="customer-name">
            ${escapeHtml(
              customer.name
            )}
          </div>

          ${
            customer.phone
              ? `
                <div class="customer-info">
                  📞 ${escapeHtml(
                    customer.phone
                  )}
                </div>
              `
              : ""
          }

          ${
            customer.email
              ? `
                <div class="customer-info">
                  ✉️ ${escapeHtml(
                    customer.email
                  )}
                </div>
              `
              : ""
          }

          <div class="customer-info">
            🛍 ${customer.orders} order(s)
          </div>

          <div
            class="price"
            style="margin-top:10px;"
          >
            ${formatPrice(
              customer.total
            )}
          </div>

        </div>
      `).join("")}

    </div>
  `;
}

/* =========================================================
   CATEGORIES
========================================================= */

async function loadCategories() {
  if (!products.length) {
    try {
      await loadProducts();
    } catch {
      return;
    }
  }

  const map = new Map();

  products.forEach((product) => {

    const category =
      product.category ||
      "Uncategorized";

    map.set(
      category,
      (map.get(category) || 0) + 1
    );
  });

  const categories =
    Array.from(map.entries())
      .map(([name, count]) => ({
        name,
        count
      }));

  renderCategories(categories);
}

function renderCategories(categories) {
  const container =
    $("categoriesList") ||
    $("categoriesGrid");

  if (!container) return;

  if (!categories.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🏷️</div>
        <div class="empty-title">
          No categories yet
        </div>
      </div>
    `;

    return;
  }

  const icons = [
    "📦",
    "💻",
    "👕",
    "⚽",
    "🏠",
    "📱",
    "🎧",
    "⌚"
  ];

  container.innerHTML = `
    <div class="category-grid">

      ${categories.map(
        (category, index) => `
          <div class="category-card">

            <div class="category-icon">
              ${icons[index % icons.length]}
            </div>

            <div class="category-name">
              ${escapeHtml(
                category.name
              )}
            </div>

            <div class="category-count">
              ${category.count} product(s)
            </div>

          </div>
        `
      ).join("")}

    </div>
  `;
}

/* =========================================================
   REFRESH BUTTONS
========================================================= */

function setupRefreshButtons() {

  const dashboardRefresh =
    $("refreshDashboard");

  if (dashboardRefresh) {
    dashboardRefresh.addEventListener(
      "click",
      async () => {
        dashboardRefresh.disabled = true;

        try {
          await loadDashboard();
          showToast(
            "Dashboard refreshed."
          );
        } finally {
          dashboardRefresh.disabled = false;
        }
      }
    );
  }

  const ordersRefresh =
    $("refreshOrdersBtn");

  if (ordersRefresh) {
    ordersRefresh.addEventListener(
      "click",
      async () => {
        ordersRefresh.disabled = true;

        try {
          await loadOrders();
          showToast(
            "Orders refreshed."
          );
        } finally {
          ordersRefresh.disabled = false;
        }
      }
    );
  }
}

/* =========================================================
   SETTINGS
========================================================= */

function setupSettings() {

  const storeName =
    $("storeName");

  if (storeName) {
    storeName.value =
      localStorage.getItem(
        "zento_store_name"
      ) ||
      "Zento";
  }

  const deliveryCharge =
    $("deliveryCharge");

  if (deliveryCharge) {
    deliveryCharge.value =
      localStorage.getItem(
        "zento_delivery_charge"
      ) ||
      "";
  }

  const settingsForm =
    $("settingsForm");

  if (settingsForm) {
    settingsForm.addEventListener(
      "submit",
      (event) => {
        event.preventDefault();

        if (storeName) {
          localStorage.setItem(
            "zento_store_name",
            storeName.value.trim()
          );
        }

        if (deliveryCharge) {
          localStorage.setItem(
            "zento_delivery_charge",
            deliveryCharge.value
          );
        }

        showToast(
          "Settings saved."
        );
      }
    );
  }
}

/* =========================================================
   LOGIN FORM SETUP
========================================================= */

function setupLoginForm() {

  const form =
    $("adminLoginForm");

  if (!form) return;

  form.addEventListener(
    "submit",
    async (event) => {

      event.preventDefault();

      const email =
        $("adminEmail")?.value.trim();

      const password =
        $("adminPassword")?.value || "";

      if (!email || !password) {

        const error =
          $("loginError");

        if (error) {
          error.textContent =
            "Email and password are required.";

          error.classList.add("show");
        }

        return;
      }

      const button =
        form.querySelector(
          'button[type="submit"]'
        );

      const originalText =
        button?.textContent ||
        "Login";

      if (button) {
        button.disabled = true;
        button.textContent =
          "Signing in...";
      }

      try {
        await adminLogin(
          email,
          password
        );
      } finally {
        if (button) {
          button.disabled = false;
          button.textContent =
            originalText;
        }
      }
    }
  );
}

/* =========================================================
   LOGOUT SETUP
========================================================= */

function setupLogout() {

  document.querySelectorAll(
    "#logoutBtn, .logout-btn"
  ).forEach((button) => {

    button.addEventListener(
      "click",
      logoutAdmin
    );

  });
}

/* =========================================================
   IMAGE URL SYNC
========================================================= */

function setupImageUrlPreview() {

  const input =
    $("productImage");

  if (!input) return;

  input.addEventListener(
    "input",
    () => {

      const url =
        input.value.trim();

      const preview =
        $("productImagePreview");

      if (!preview) return;

      if (!url) {
        preview.textContent =
          "Product image preview";

        return;
      }

      preview.innerHTML = `
        <img
          src="${escapeHtml(url)}"
          alt="Product preview"
          onerror="this.parentElement.textContent='Unable to load image'"
        >
      `;
    }
  );
}

/* =========================================================
   INIT
========================================================= */

async function init() {

  setupLoginForm();
  setupNavigation();
  setupMobileMenu();
  setupLogout();

  setupProductForm();
  setupProductSearch();

  setupRefreshButtons();
  setupSettings();

  setupImageUrlPreview();

  const loggedIn =
    await checkAdminSession();

  if (!loggedIn) {
    return;
  }

  await navigateTo("dashboard");
}

/* =========================================================
   START
========================================================= */

if (
  document.readyState === "loading"
) {

  document.addEventListener(
    "DOMContentLoaded",
    init
  );

} else {

  init();

}
