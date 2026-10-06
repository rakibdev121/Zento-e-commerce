import { supabase } from "../js/supabase.js";

const loginScreen = document.getElementById("loginScreen");
const adminApp = document.getElementById("adminApp");
const loginForm = document.getElementById("adminLoginForm");
const loginError = document.getElementById("loginError");

const navItems = document.querySelectorAll(".nav-item");
const pages = document.querySelectorAll(".page");
const pageTitle = document.getElementById("pageTitle");

const titles = {
  dashboard: "Dashboard",
  products: "Products",
  orders: "Orders",
  customers: "Customers",
  categories: "Categories",
  settings: "Settings"
};

function showAdmin() {
  loginScreen.style.display = "none";
  adminApp.classList.add("authenticated");
}

function showLogin() {
  loginScreen.style.display = "flex";
  adminApp.classList.remove("authenticated");
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  loginError.textContent = "";

  const email = document.getElementById("adminEmail").value.trim();
  const password = document.getElementById("adminPassword").value;

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    loginError.textContent = error.message;
    return;
  }

  showAdmin();
});

navItems.forEach((item) => {
  item.addEventListener("click", () => {
    const page = item.dataset.page;

    navItems.forEach((nav) => nav.classList.remove("active"));
    item.classList.add("active");

    pages.forEach((section) => {
      section.classList.remove("active");
    });

    const target = document.getElementById(`${page}Page`);

    if (target) {
      target.classList.add("active");
    }

    pageTitle.textContent = titles[page] || "Dashboard";
  });
});

document.getElementById("logoutBtn").addEventListener("click", async () => {
  await supabase.auth.signOut();
  showLogin();
});

async function checkSession() {
  const { data, error } = await supabase.auth.getSession();

  if (error || !data.session) {
    showLogin();
    return;
  }

  showAdmin();
}

supabase.auth.onAuthStateChange((event, session) => {
  if (session) {
    showAdmin();
  } else {
    showLogin();
  }
});

checkSession();

console.log("Zento Admin Panel loaded");


// =========================
// Products Management
// =========================

const productsList = document.getElementById("productsList");
const addProductBtn = document.getElementById("addProductBtn");
const productFormWrap = document.getElementById("productFormWrap");
const productForm = document.getElementById("productForm");
const cancelProductBtn = document.getElementById("cancelProductBtn");
const productFormMessage = document.getElementById("productFormMessage");

const productId = document.getElementById("productId");
const productName = document.getElementById("productName");
const productDescription = document.getElementById("productDescription");
const productPrice = document.getElementById("productPrice");
const productImage = document.getElementById("productImage");
const productCategory = document.getElementById("productCategory");
const productStock = document.getElementById("productStock");

async function loadProducts() {
  if (!productsList) return;

  productsList.textContent = "Loading products...";

  try {
    const response = await fetch("/api/products");
    const data = await response.json();

    if (!response.ok || data.status !== "success") {
      throw new Error(data.message || "Failed to load products");
    }

    if (!data.products.length) {
      productsList.innerHTML = "No products yet.";
      updateProductCount(0);
      return;
    }

    productsList.className = "products-table-wrap";

    productsList.innerHTML = `
      <div class="products-table">
        <div class="product-row product-header">
          <div>Product</div>
          <div>Price</div>
          <div>Category</div>
          <div>Stock</div>
          <div>Actions</div>
        </div>

        ${data.products.map(product => `
          <div class="product-row">
            <div>
              <strong>${escapeHtml(product.name)}</strong>
              <small>${escapeHtml(product.description || "")}</small>
            </div>
            <div>৳${Number(product.price).toFixed(2)}</div>
            <div>${escapeHtml(product.category || "-")}</div>
            <div>${product.stock}</div>
            <div class="product-actions">
              <button class="edit-product-btn" data-id="${product.id}">Edit</button>
              <button class="delete-product-btn" data-id="${product.id}">Delete</button>
            </div>
          </div>
        `).join("")}
      </div>
    `;

    updateProductCount(data.products.length);

    document.querySelectorAll(".edit-product-btn").forEach(button => {
      button.addEventListener("click", () => {
        const product = data.products.find(
          item => item.id === Number(button.dataset.id)
        );

        if (product) {
          openProductForm(product);
        }
      });
    });

    document.querySelectorAll(".delete-product-btn").forEach(button => {
      button.addEventListener("click", () => {
        deleteProduct(Number(button.dataset.id));
      });
    });

  } catch (error) {
    productsList.textContent = error.message;
    updateProductCount(0);
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function updateProductCount(count) {
  const totalProducts = document.getElementById("totalProducts");

  if (totalProducts) {
    totalProducts.textContent = count;
  }
}

function openProductForm(product = null) {
  productFormWrap.style.display = "block";
  productFormMessage.textContent = "";

  if (product) {
    productId.value = product.id;
    productName.value = product.name || "";
    productDescription.value = product.description || "";
    productPrice.value = product.price ?? "";
    productImage.value = product.image_url || "";
    productCategory.value = product.category || "";
    productStock.value = product.stock ?? 0;
  } else {
    productForm.reset();
    productId.value = "";
    productStock.value = 0;
  }

  productFormWrap.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

function closeProductForm() {
  productFormWrap.style.display = "none";
  productForm.reset();
  productId.value = "";
  productFormMessage.textContent = "";
}

async function saveProduct(event) {
  event.preventDefault();

  productFormMessage.textContent = "Saving...";

  const id = productId.value.trim();

  try {
    let imageUrl = productImage.value.trim();

    const file = productImageFile?.files?.[0];

    if (file) {
      productFormMessage.textContent = "Uploading image...";
      imageUrl = await uploadProductImage(file);
    }

    const product = {
      name: productName.value.trim(),
      description: productDescription.value.trim(),
      price: Number(productPrice.value),
      image_url: imageUrl,
      category: productCategory.value.trim(),
      stock: Number(productStock.value || 0)
    };

    productFormMessage.textContent = "Saving product...";

    const url = id
      ? `/api/products/${id}`
      : "/api/products";

    const method = id ? "PUT" : "POST";

    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(product)
    });

    const data = await response.json();

    if (!response.ok || data.status !== "success") {
      throw new Error(data.message || "Failed to save product");
    }

    closeProductForm();
    await loadProducts();

  } catch (error) {
    console.error("Save product error:", error);
    productFormMessage.textContent = error.message;
  }
}

async function deleteProduct(id) {
  if (!confirm("Are you sure you want to delete this product?")) {
    return;
  }

  try {
    const response = await fetch(`/api/products/${id}`, {
      method: "DELETE"
    });

    const data = await response.json();

    if (!response.ok || data.status !== "success") {
      throw new Error(data.message || "Failed to delete product");
    }

    await loadProducts();

  } catch (error) {
    alert(error.message);
  }
}

if (addProductBtn) {
  addProductBtn.addEventListener("click", () => {
    openProductForm();
  });
}

if (cancelProductBtn) {
  cancelProductBtn.addEventListener("click", closeProductForm);
}

if (productForm) {
  productForm.addEventListener("submit", saveProduct);
}

navItems.forEach((item) => {
  item.addEventListener("click", () => {
    if (item.dataset.page === "products") {
      loadProducts();
    }
  });
});


async function uploadProductImage(file) {
  if (!file) return null;

  const fileExt = file.name.split(".").pop().toLowerCase();
  const fileName = `${Date.now()}-${crypto.randomUUID()}.${fileExt}`;
  const filePath = `products/${fileName}`;

  const { error } = await supabase.storage
    .from("product-images")
    .upload(filePath, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type
    });

  if (error) {
    throw new Error(error.message);
  }

  const { data } = supabase.storage
    .from("product-images")
    .getPublicUrl(filePath);

  return data.publicUrl;
}

const productImageFile = document.getElementById("productImageFile");

if (productImageFile) {
  productImageFile.addEventListener("change", () => {
    const file = productImageFile.files[0];
    const preview = document.getElementById("productImagePreview");

    if (!file) {
      preview.style.display = "none";
      preview.removeAttribute("src");
      return;
    }

    preview.src = URL.createObjectURL(file);
    preview.style.display = "block";
  });
}


// =========================================================
// ZENTO ADMIN ORDER MANAGEMENT V1
// =========================================================

const ordersList = document.getElementById("ordersList");
const refreshOrdersBtn = document.getElementById("refreshOrdersBtn");
const ordersMessage = document.getElementById("ordersMessage");

const ORDER_STATUS_LABELS = {
  pending: "Pending",
  approved: "Approved",
  processing: "Processing",
  shipped: "Shipped",
  out_for_delivery: "Out for Delivery",
  delivered: "Delivered"
};

const ORDER_STATUS_FLOW = [
  "pending",
  "approved",
  "processing",
  "shipped",
  "out_for_delivery",
  "delivered"
];

function adminMoney(value) {
  return `৳${Number(value || 0).toFixed(2)}`;
}

function adminEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function getAdminAccessToken() {
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token || "";
}

async function adminApi(url, options = {}) {
  const accessToken = await getAdminAccessToken();

  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(accessToken
        ? { "Authorization": `Bearer ${accessToken}` }
        : {}),
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || "Request failed");
  }

  return data;
}

async function loadAdminOrders() {
  if (!ordersList) return;

  ordersList.innerHTML = `
    <div class="empty-state">Loading orders...</div>
  `;

  try {
    const data = await adminApi("/api/admin/orders");

    if (!data.orders?.length) {
      ordersList.innerHTML = `
        <div class="empty-state">
          <strong>No orders yet.</strong>
        </div>
      `;

      updateAdminOrderStats([]);
      return;
    }

    updateAdminOrderStats(data.orders);

    ordersList.innerHTML = data.orders.map(order => {
      const status = order.status || "pending";

      const statusButtons = ORDER_STATUS_FLOW.map(item => `
        <button
          class="order-status-btn ${item === status ? "active" : ""}"
          data-order-id="${order.id}"
          data-status="${item}"
        >
          ${ORDER_STATUS_LABELS[item]}
        </button>
      `).join("");

      const itemRows = (order.items || []).map(item => `
        <div class="admin-order-item">
          <div>
            <strong>${adminEscape(item.name)}</strong>
            <small>${item.quantity} × ${adminMoney(item.price)}</small>
          </div>
          <strong>${adminMoney(item.subtotal)}</strong>
        </div>
      `).join("");

      return `
        <article class="admin-order-card">
          <div class="admin-order-header">
            <div>
              <span class="admin-order-id">Order #${order.id}</span>
              <h3>${adminEscape(order.customer_name)}</h3>
              <small>${new Date(order.created_at).toLocaleString()}</small>
            </div>

            <span class="admin-order-status status-${status}">
              ${ORDER_STATUS_LABELS[status] || status}
            </span>
          </div>

          <div class="admin-order-customer">
            <div>
              <span>📞 Phone</span>
              <strong>${adminEscape(order.phone)}</strong>
            </div>

            <div>
              <span>📍 Address</span>
              <strong>${adminEscape(order.address)}, ${adminEscape(order.city)}</strong>
            </div>

            <div>
              <span>💳 Payment</span>
              <strong>${order.payment_method === "cod" ? "Cash on Delivery" : "Card Payment"}</strong>
            </div>
          </div>

          <div class="admin-order-items">
            ${itemRows}
          </div>

          <div class="admin-order-total">
            <div>
              <span>Subtotal</span>
              <strong>${adminMoney(order.subtotal)}</strong>
            </div>

            <div>
              <span>Delivery</span>
              <strong>${adminMoney(order.delivery_fee)}</strong>
            </div>

            <div>
              <span>Total</span>
              <strong>${adminMoney(order.total)}</strong>
            </div>
          </div>

          <div class="admin-order-actions">
            ${status === "pending"
              ? `<button class="approve-order-btn primary-btn" data-order-id="${order.id}">
                   ✓ Approve Order
                 </button>`
              : ""
            }

            <button
              class="print-receipt-btn primary-btn"
              data-order-id="${order.id}"
            >
              🧾 ${status === "pending" ? "Receipt Preview" : "Print Receipt"}
            </button>
          </div>

          <div class="admin-order-status-control">
            <strong>Update Tracking Status</strong>
            <div class="order-status-buttons">
              ${statusButtons}
            </div>
          </div>
        </article>
      `;
    }).join("");

    document.querySelectorAll(".approve-order-btn").forEach(button => {
      button.addEventListener("click", async () => {
        await approveAdminOrder(Number(button.dataset.orderId));
      });
    });

    document.querySelectorAll(".order-status-btn").forEach(button => {
      button.addEventListener("click", async () => {
        await updateAdminOrderStatus(
          Number(button.dataset.orderId),
          button.dataset.status
        );
      });
    });

    document.querySelectorAll(".print-receipt-btn").forEach(button => {
      button.addEventListener("click", async () => {
        const order = data.orders.find(
          item => Number(item.id) === Number(button.dataset.orderId)
        );

        if (order) {
          printOrderReceipt(order);
        }
      });
    });

  } catch (error) {
    ordersList.innerHTML = `
      <div class="empty-state">
        ${adminEscape(error.message)}
      </div>
    `;
  }
}

function updateAdminOrderStats(orders) {
  const totalOrders = document.getElementById("totalOrders");
  const totalSales = document.getElementById("totalSales");

  if (totalOrders) {
    totalOrders.textContent = orders.length;
  }

  if (totalSales) {
    const sales = orders
      .filter(order => order.status !== "pending")
      .reduce((sum, order) => sum + Number(order.total || 0), 0);

    totalSales.textContent = adminMoney(sales);
  }
}

async function approveAdminOrder(orderId) {
  try {
    if (!confirm(`Approve Order #${orderId}?`)) {
      return;
    }

    if (ordersMessage) {
      ordersMessage.textContent = `Approving Order #${orderId}...`;
    }

    await adminApi(`/api/admin/orders/${orderId}/approve`, {
      method: "POST"
    });

    if (ordersMessage) {
      ordersMessage.textContent = `✓ Order #${orderId} approved successfully.`;
    }

    await loadAdminOrders();

  } catch (error) {
    if (ordersMessage) {
      ordersMessage.textContent = error.message;
    } else {
      alert(error.message);
    }
  }
}

async function updateAdminOrderStatus(orderId, status) {
  try {
    await adminApi(`/api/admin/orders/${orderId}/status`, {
      method: "PUT",
      body: JSON.stringify({ status })
    });

    await loadAdminOrders();

  } catch (error) {
    alert(error.message);
  }
}

function printOrderReceipt(order) {
  const statusLabel =
    ORDER_STATUS_LABELS[order.status] || order.status;

  const itemRows = (order.items || []).map(item => `
    <tr>
      <td>${adminEscape(item.name)}</td>
      <td>${item.quantity}</td>
      <td>${adminMoney(item.price)}</td>
      <td>${adminMoney(item.subtotal)}</td>
    </tr>
  `).join("");

  const receiptWindow = window.open(
    "",
    "_blank",
    "width=850,height=900"
  );

  if (!receiptWindow) {
    alert("Please allow popups to print the receipt.");
    return;
  }

  receiptWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Zento Receipt #${order.id}</title>

      <style>
        body {
          font-family: Arial, sans-serif;
          margin: 0;
          padding: 30px;
          color: #111827;
          background: #fff;
        }

        .receipt {
          max-width: 760px;
          margin: auto;
        }

        .brand {
          text-align: center;
          margin-bottom: 25px;
        }

        .brand h1 {
          margin: 0;
          font-size: 34px;
          letter-spacing: 3px;
        }

        .brand p {
          margin: 7px 0 0;
          color: #64748b;
        }

        .meta {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
          padding: 15px;
          border: 1px solid #ddd;
          border-radius: 10px;
          margin-bottom: 20px;
        }

        .meta strong {
          display: block;
          margin-top: 4px;
        }

        table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 15px;
        }

        th, td {
          padding: 11px 8px;
          border-bottom: 1px solid #e5e7eb;
          text-align: left;
        }

        th:last-child,
        td:last-child {
          text-align: right;
        }

        .summary {
          margin-top: 20px;
          margin-left: auto;
          width: 300px;
        }

        .summary div {
          display: flex;
          justify-content: space-between;
          padding: 7px 0;
        }

        .summary .total {
          font-size: 20px;
          font-weight: bold;
          border-top: 2px solid #111827;
          margin-top: 8px;
          padding-top: 12px;
        }

        .status {
          margin-top: 25px;
          padding: 14px;
          background: #f1f5f9;
          border-radius: 10px;
          text-align: center;
          font-weight: bold;
        }

        .footer {
          text-align: center;
          margin-top: 35px;
          color: #64748b;
          font-size: 13px;
        }

        @media print {
          body {
            padding: 0;
          }
        }
      </style>
    </head>

    <body>
      <div class="receipt">

        <div class="brand">
          <h1>ZENTO</h1>
          <p>Official Order Receipt</p>
        </div>

        <div class="meta">
          <div>
            <span>Order ID</span>
            <strong>#${order.id}</strong>
          </div>

          <div>
            <span>Order Date</span>
            <strong>${new Date(order.created_at).toLocaleString()}</strong>
          </div>

          <div>
            <span>Customer</span>
            <strong>${adminEscape(order.customer_name)}</strong>
          </div>

          <div>
            <span>Phone</span>
            <strong>${adminEscape(order.phone)}</strong>
          </div>

          <div>
            <span>Delivery Address</span>
            <strong>${adminEscape(order.address)}, ${adminEscape(order.city)}</strong>
          </div>

          <div>
            <span>Payment</span>
            <strong>${order.payment_method === "cod" ? "Cash on Delivery" : "Card Payment"}</strong>
          </div>
        </div>

        <h2>Order Items</h2>

        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>Qty</th>
              <th>Price</th>
              <th>Total</th>
            </tr>
          </thead>

          <tbody>
            ${itemRows}
          </tbody>
        </table>

        <div class="summary">
          <div>
            <span>Subtotal</span>
            <strong>${adminMoney(order.subtotal)}</strong>
          </div>

          <div>
            <span>Delivery Fee</span>
            <strong>${adminMoney(order.delivery_fee)}</strong>
          </div>

          <div class="total">
            <span>Total</span>
            <strong>${adminMoney(order.total)}</strong>
          </div>
        </div>

        <div class="status">
          Order Status: ${statusLabel}
        </div>

        <div class="footer">
          Thank you for shopping with Zento.
        </div>

      </div>

      <script>
        window.onload = function() {
          setTimeout(function() {
            window.print();
          }, 300);
        };
      <\/script>
    </body>
    </html>
  `);

  receiptWindow.document.close();
}

if (refreshOrdersBtn) {
  refreshOrdersBtn.addEventListener("click", loadAdminOrders);
}

navItems.forEach((item) => {
  item.addEventListener("click", () => {
    if (item.dataset.page === "orders") {
      loadAdminOrders();
    }
  });
});
