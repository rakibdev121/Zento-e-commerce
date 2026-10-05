/* =========================================
   ZENTO - MAIN JAVASCRIPT
========================================= */

document.addEventListener("DOMContentLoaded", () => {

  /* ---------- ELEMENTS ---------- */

  const searchInput = document.getElementById("searchInput");
  const clearSearch = document.getElementById("clearSearch");
  const products = [...document.querySelectorAll(".product-card")];
  const categories = [...document.querySelectorAll(".category")];
  const noResults = document.getElementById("noResults");

  const cartCount = document.getElementById("cartCount");
  const headerCartCount = document.getElementById("headerCartCount");
  const headerCart = document.getElementById("headerCart");
  const cartNav = document.getElementById("cartNav");

  const toast = document.getElementById("toast");
  const shopNow = document.getElementById("shopNow");
  const viewAll = document.querySelector(".text-btn");

  /* ---------- CART ---------- */

  let cart = [];

  try {
    cart = JSON.parse(localStorage.getItem("novacart_cart")) || [];
  } catch {
    cart = [];
  }

  function updateCartUI() {
    const totalItems = cart.reduce(
      (total, item) => total + Number(item.quantity || 0),
      0
    );

    cartCount.textContent = totalItems;
    headerCartCount.textContent = totalItems;

    localStorage.setItem(
      "novacart_cart",
      JSON.stringify(cart)
    );
  }

  function addToCart(name, price, quantity = 1) {
    const existingProduct = cart.find(
      item => item.name === name
    );

    if (existingProduct) {
      existingProduct.quantity += Number(quantity);
    } else {
      cart.push({
        name,
        price: Number(price),
        quantity: Number(quantity)
      });
    }

    updateCartUI();
    showToast(`${name} added to cart 🛒`);
  }

  window.zentoAddToCart = addToCart;

  function showCart() {
    if (cart.length === 0) {
      showToast("Your cart is empty 🛒");
      return;
    }

    const total = cart.reduce(
      (sum, item) =>
        sum + Number(item.price) * Number(item.quantity),
      0
    );

    const items = cart.reduce(
      (sum, item) => sum + Number(item.quantity),
      0
    );

    showToast(
      `${items} item(s) • $${total.toFixed(2)}`
    );
  }

  /* ---------- ADD TO CART ---------- */

  document.querySelectorAll(".add-cart").forEach(button => {
    button.addEventListener("click", () => {
      const name = button.dataset.product;
      const price = button.dataset.price;

      addToCart(name, price);

      button.textContent = "✓";

      setTimeout(() => {
        button.textContent = "+";
      }, 800);
    });
  });

  /* ---------- CART BUTTONS ---------- */

  headerCart?.addEventListener("click", showCart);
  cartNav?.addEventListener("click", event => {
    event.preventDefault();
    showCart();
  });

  /* ---------- WISHLIST ---------- */

  let wishlist = [];

  try {
    wishlist = JSON.parse(
      localStorage.getItem("zento_wishlist")
    ) || [];
  } catch {
    wishlist = [];
  }

  document.querySelectorAll(".wishlist-btn").forEach(button => {
    const product = button
      .closest(".product-card")
      ?.dataset.name;

    if (product && wishlist.includes(product)) {
      button.classList.add("liked");
      button.textContent = "♥";
    }

    button.addEventListener("click", () => {
      if (!product) return;

      button.classList.toggle("liked");

      if (button.classList.contains("liked")) {
        button.textContent = "♥";

        if (!wishlist.includes(product)) {
          wishlist.push(product);
        }

        showToast("Added to wishlist ❤️");
      } else {
        button.textContent = "♡";
        wishlist = wishlist.filter(item => item !== product);
        showToast("Removed from wishlist");
      }

      localStorage.setItem(
        "zento_wishlist",
        JSON.stringify(wishlist)
      );
    });
  });

  /* ---------- FILTER ---------- */

  let selectedCategory = "all";

  function filterProducts() {
    const searchValue =
      searchInput.value.trim().toLowerCase();

    let visibleProducts = 0;

    products.forEach(product => {
      const productName =
        (product.dataset.name || "").toLowerCase();

      const productCategory =
        (product.dataset.category || "").toLowerCase();

      const matchesSearch =
        !searchValue ||
        productName.includes(searchValue) ||
        productCategory.includes(searchValue);

      const matchesCategory =
        selectedCategory === "all" ||
        productCategory === selectedCategory;

      const visible =
        matchesSearch && matchesCategory;

      product.style.display = visible ? "" : "none";

      if (visible) {
        visibleProducts++;
      }
    });

    noResults.hidden = visibleProducts !== 0;
    clearSearch.hidden = searchValue.length === 0;
  }

  searchInput.addEventListener("input", filterProducts);

  /* ---------- CLEAR SEARCH ---------- */

  clearSearch.addEventListener("click", () => {
    searchInput.value = "";
    filterProducts();
    searchInput.focus();
  });

  /* ---------- CATEGORY FILTER ---------- */

  categories.forEach(category => {
    category.addEventListener("click", () => {
      categories.forEach(item => {
        item.classList.remove("active");
      });

      category.classList.add("active");

      selectedCategory =
        category.dataset.category || "all";

      filterProducts();
    });
  });

  /* ---------- VIEW ALL ---------- */

  viewAll?.addEventListener("click", () => {
    selectedCategory = "all";

    categories.forEach(item => {
      item.classList.toggle(
        "active",
        item.dataset.category === "all"
      );
    });

    searchInput.value = "";

    filterProducts();

    document
      .getElementById("products")
      ?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
  });

  /* ---------- SHOP NOW ---------- */

  shopNow?.addEventListener("click", () => {
    document
      .getElementById("products")
      ?.scrollIntoView({
        behavior: "smooth"
      });
  });

  /* ---------- TOAST ---------- */

  let toastTimer;

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("show");

    clearTimeout(toastTimer);

    toastTimer = setTimeout(() => {
      toast.classList.remove("show");
    }, 1800);
  }

  /* ---------- FLASH SALE TIMER ---------- */

  let totalSeconds =
    (2 * 60 * 60) +
    (45 * 60) +
    18;

  function updateTimer() {
    if (totalSeconds <= 0) {
      totalSeconds = 3 * 60 * 60;
    }

    const hours =
      Math.floor(totalSeconds / 3600);

    const minutes =
      Math.floor((totalSeconds % 3600) / 60);

    const seconds =
      totalSeconds % 60;

    document.getElementById("hours").textContent =
      String(hours).padStart(2, "0");

    document.getElementById("minutes").textContent =
      String(minutes).padStart(2, "0");

    document.getElementById("seconds").textContent =
      String(seconds).padStart(2, "0");

    totalSeconds--;
  }

  updateTimer();
  setInterval(updateTimer, 1000);

  /* ---------- INITIALIZE ---------- */

  updateCartUI();
  filterProducts();

});

/* =========================================
   ZENTO - AUTHENTICATION
========================================= */

document.addEventListener("DOMContentLoaded", () => {
  const API_URL = "https://zento-e-commerce-40xm.onrender.com";

  const authScreen = document.getElementById("authScreen");
  const loginForm = document.getElementById("loginForm");
  const signupForm = document.getElementById("signupForm");

  const loginFormElement = document.getElementById("loginFormElement");
  const signupFormElement = document.getElementById("signupFormElement");

  const showSignup = document.getElementById("showSignup");
  const showLogin = document.getElementById("showLogin");

  const loginMessage = document.getElementById("loginMessage");
  const signupMessage = document.getElementById("signupMessage");

  function showLoginScreen() {
    loginForm.hidden = false;
    signupForm.hidden = true;
    loginMessage.textContent = "";
    signupMessage.textContent = "";
  }

  function showSignupScreen() {
    loginForm.hidden = true;
    signupForm.hidden = false;
    loginMessage.textContent = "";
    signupMessage.textContent = "";
  }

  function showHome() {
    authScreen.style.display = "none";
    document.body.classList.remove("auth-active");
  }

  function showAuth() {
    authScreen.style.display = "flex";
    document.body.classList.add("auth-active");
  }

  showSignup?.addEventListener("click", showSignupScreen);
  showLogin?.addEventListener("click", showLoginScreen);

  /* ---------- CHECK LOGIN ---------- */

  const token = localStorage.getItem("zento_token");

  if (token) {
    showHome();
  } else {
    showAuth();
    showLoginScreen();
  }

  /* ---------- SIGNUP ---------- */

  signupFormElement?.addEventListener("submit", async event => {
    event.preventDefault();

    const name = document.getElementById("signupName").value.trim();
    const email = document.getElementById("signupEmail").value.trim();
    const password = document.getElementById("signupPassword").value;

    signupMessage.textContent = "Creating account...";

    try {
      const response = await fetch(`${API_URL}/api/signup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          name,
          email,
          password
        })
      });

      const data = await response.json();

      if (!response.ok) {
        signupMessage.textContent =
          data.message || "Signup failed";
        return;
      }

      signupMessage.textContent =
        "Account created successfully. Please login.";

      signupFormElement.reset();

      setTimeout(() => {
        showLoginScreen();
        document.getElementById("loginEmail").value = email;
      }, 800);

    } catch (error) {
      signupMessage.textContent =
        "Unable to connect to server.";
    }
  });

  /* ---------- LOGIN ---------- */

  loginFormElement?.addEventListener("submit", async event => {
    event.preventDefault();

    const email = document.getElementById("loginEmail").value.trim();
    const password = document.getElementById("loginPassword").value;

    loginMessage.textContent = "Logging in...";

    try {
      const response = await fetch(`${API_URL}/api/login`, {
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

      if (!response.ok) {
        loginMessage.textContent =
          data.message || "Login failed";
        return;
      }

      localStorage.setItem("zento_token", data.token);
      localStorage.setItem(
        "zento_user",
        JSON.stringify(data.user)
      );

      loginMessage.textContent = "Login successful!";

      setTimeout(() => {
        showHome();
      }, 500);

    } catch (error) {
      loginMessage.textContent =
        "Unable to connect to server.";
    }
  });
});



/* =========================================
   ZENTO PRODUCT DETAILS
========================================= */

const productModal = document.getElementById("productModal");
const closeProductModal = document.getElementById("closeProductModal");
const modalProductImage = document.getElementById("modalProductImage");
const modalProductCategory = document.getElementById("modalProductCategory");
const modalProductName = document.getElementById("modalProductName");
const modalProductRating = document.getElementById("modalProductRating");
const modalProductPrice = document.getElementById("modalProductPrice");
const modalProductOldPrice = document.getElementById("modalProductOldPrice");
const modalProductDescription = document.getElementById("modalProductDescription");
const modalQty = document.getElementById("modalQty");
const modalQtyMinus = document.getElementById("modalQtyMinus");
const modalQtyPlus = document.getElementById("modalQtyPlus");
const modalAddCart = document.getElementById("modalAddCart");

let selectedProduct = null;
let productQuantity = 1;

const productDetails = {
  "Wireless Headphones": {
    category: "Electronics",
    price: 49.99,
    oldPrice: 69.99,
    rating: "4.8",
    reviews: "124",
    icon: "🎧",
    description:
      "Enjoy clear sound, deep bass and comfortable wireless listening with a modern everyday design."
  },

  "Smart Watch Pro": {
    category: "Electronics",
    price: 59.99,
    oldPrice: 79.99,
    rating: "4.7",
    reviews: "89",
    icon: "⌚",
    description:
      "A stylish smart watch with a modern display, fitness features and an everyday premium look."
  },

  "Urban Backpack": {
    category: "Fashion",
    price: 39.99,
    oldPrice: 49.99,
    rating: "4.6",
    reviews: "76",
    icon: "🎒",
    description:
      "A lightweight urban backpack designed for daily travel, work and comfortable everyday carry."
  },

  "Glow Skin Set": {
    category: "Beauty",
    price: 29.99,
    oldPrice: 45.99,
    rating: "4.9",
    reviews: "203",
    icon: "🧴",
    description:
      "A refreshing skincare set made for a simple daily routine and a clean, healthy-looking glow."
  }
};

function openProductModal(name) {
  const product = productDetails[name];

  if (!product) return;

  selectedProduct = {
    name,
    ...product
  };

  productQuantity = 1;

  modalProductImage.textContent = product.icon;
  modalProductCategory.textContent = product.category;
  modalProductName.textContent = name;

  modalProductRating.innerHTML =
    `<span>★</span> ${product.rating} <small>(${product.reviews} reviews)</small>`;

  modalProductPrice.textContent = `$${product.price.toFixed(2)}`;
  modalProductOldPrice.textContent = `$${product.oldPrice.toFixed(2)}`;
  modalProductDescription.textContent = product.description;
  modalQty.textContent = productQuantity;

  productModal.classList.add("active");
  productModal.setAttribute("aria-hidden", "false");

  document.body.style.overflow = "hidden";
}

function closeProductDetails() {
  productModal.classList.remove("active");
  productModal.setAttribute("aria-hidden", "true");

  document.body.style.overflow = "";
}

document.querySelectorAll(".product-card").forEach((card) => {

  card.addEventListener("click", (event) => {

    if (
      event.target.closest(".add-cart") ||
      event.target.closest(".wishlist-btn")
    ) {
      return;
    }

    const productName = card.dataset.name;

    openProductModal(productName);
  });

});

if (closeProductModal) {
  closeProductModal.addEventListener("click", closeProductDetails);
}

document.querySelector("[data-close-product]")?.addEventListener(
  "click",
  closeProductDetails
);

modalQtyMinus?.addEventListener("click", () => {

  if (productQuantity > 1) {
    productQuantity--;
    modalQty.textContent = productQuantity;
  }

});

modalQtyPlus?.addEventListener("click", () => {

  if (productQuantity < 99) {
    productQuantity++;
    modalQty.textContent = productQuantity;
  }

});

modalAddCart?.addEventListener("click", () => {

  if (!selectedProduct) return;

  window.zentoAddToCart(
    selectedProduct.name,
    selectedProduct.price,
    productQuantity
  );

  showToast(
    `${selectedProduct.name} × ${productQuantity} added to cart`
  );

  closeProductDetails();

});

document.addEventListener("keydown", (event) => {

  if (event.key === "Escape" && productModal?.classList.contains("active")) {
    closeProductDetails();
  }

});


/* =========================================
   ZENTO CART PAGE
========================================= */

const cartPage = document.getElementById("cartPage");
const cartItemsContainer = document.getElementById("cartItems");
const cartEmpty = document.getElementById("cartEmpty");
const cartSummary = document.getElementById("cartSummary");
const cartSubtotal = document.getElementById("cartSubtotal");
const cartDelivery = document.getElementById("cartDelivery");
const cartTotal = document.getElementById("cartTotal");
const cartBack = document.getElementById("cartBack");
const continueShopping = document.getElementById("continueShopping");
const checkoutBtn = document.getElementById("checkoutBtn");

const cartProductIcons = {
  "Wireless Headphones": "🎧",
  "Smart Watch Pro": "⌚",
  "Urban Backpack": "🎒",
  "Glow Skin Set": "🧴"
};

function renderCartPage() {

  if (!cartItemsContainer) return;

  cartItemsContainer.innerHTML = "";

  if (cart.length === 0) {

    cartEmpty?.classList.add("active");
    cartSummary?.classList.add("hidden");

    cartSubtotal.textContent = "$0.00";
    cartDelivery.textContent = "$0.00";
    cartTotal.textContent = "$0.00";

    return;
  }

  cartEmpty?.classList.remove("active");
  cartSummary?.classList.remove("hidden");

  let subtotal = 0;

  cart.forEach((item, index) => {

    const quantity = Number(item.quantity) || 0;
    const price = Number(item.price) || 0;

    subtotal += price * quantity;

    const itemElement = document.createElement("article");

    itemElement.className = "cart-item";

    itemElement.innerHTML = `
      <div class="cart-item-image">
        ${cartProductIcons[item.name] || "🛍️"}
      </div>

      <div class="cart-item-info">

        <h3>${item.name}</h3>

        <strong>$${price.toFixed(2)}</strong>

        <small>
          $${(price * quantity).toFixed(2)} total
        </small>

        <div class="cart-item-actions">

          <button
            class="cart-qty-btn"
            data-cart-action="minus"
            data-index="${index}"
          >
            −
          </button>

          <span class="cart-qty">
            ${quantity}
          </span>

          <button
            class="cart-qty-btn"
            data-cart-action="plus"
            data-index="${index}"
          >
            +
          </button>

          <button
            class="cart-remove"
            data-cart-action="remove"
            data-index="${index}"
            aria-label="Remove ${item.name}"
          >
            🗑
          </button>

        </div>

      </div>
    `;

    cartItemsContainer.appendChild(itemElement);

  });

  const delivery = subtotal >= 100 ? 0 : 5;

  const total = subtotal + delivery;

  cartSubtotal.textContent = `$${subtotal.toFixed(2)}`;
  cartDelivery.textContent =
    delivery === 0 ? "FREE" : `$${delivery.toFixed(2)}`;

  cartTotal.textContent = `$${total.toFixed(2)}`;

}

function openCartPage() {

  renderCartPage();

  cartPage?.classList.add("active");
  cartPage?.setAttribute("aria-hidden", "false");

  document.body.style.overflow = "hidden";

}

function closeCartPage() {

  cartPage?.classList.remove("active");
  cartPage?.setAttribute("aria-hidden", "true");

  document.body.style.overflow = "";

}

document.addEventListener("click", event => {

  const actionButton = event.target.closest("[data-cart-action]");

  if (!actionButton) return;

  const index = Number(actionButton.dataset.index);
  const action = actionButton.dataset.cartAction;

  if (!cart[index]) return;

  if (action === "plus") {
    cart[index].quantity += 1;
  }

  if (action === "minus") {

    cart[index].quantity -= 1;

    if (cart[index].quantity <= 0) {
      cart.splice(index, 1);
    }

  }

  if (action === "remove") {
    cart.splice(index, 1);
  }

  updateCartUI();
  renderCartPage();

});

cartNav?.addEventListener("click", event => {

  event.preventDefault();

  openCartPage();

});

headerCart?.addEventListener("click", event => {

  event.preventDefault();

  openCartPage();

});

cartBack?.addEventListener("click", closeCartPage);

continueShopping?.addEventListener("click", closeCartPage);

checkoutBtn?.addEventListener("click", () => {

  if (cart.length === 0) {
    showToast("Your cart is empty 🛒");
    return;
  }

  showToast("Checkout is coming next 🚀");

});

renderCartPage();
