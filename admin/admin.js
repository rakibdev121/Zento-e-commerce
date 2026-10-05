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

  const product = {
    name: productName.value.trim(),
    description: productDescription.value.trim(),
    price: Number(productPrice.value),
    image_url: productImage.value.trim(),
    category: productCategory.value.trim(),
    stock: Number(productStock.value || 0)
  };

  try {
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

    productFormMessage.textContent = "Product saved successfully.";
    closeProductForm();
    await loadProducts();

  } catch (error) {
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

