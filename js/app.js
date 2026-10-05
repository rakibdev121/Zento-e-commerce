/* =========================================
   ZENTO - MAIN JAVASCRIPT
========================================= */

document.addEventListener("DOMContentLoaded", () => {

  /* ---------- ELEMENTS ---------- */

  const searchInput = document.getElementById("searchInput");
  const clearSearch = document.getElementById("clearSearch");
  let products = [...document.querySelectorAll(".product-card")];
  const categories = [...document.querySelectorAll(".category")];
  const noResults = document.getElementById("noResults");

  const cartCount = document.getElementById("cartCount");
  const headerCartCount = document.getElementById("headerCartCount");
  const headerCart = document.getElementById("headerCart");
  const cartNav = document.getElementById("cartNav");

  const toast = document.getElementById("toast");
  const shopNow = document.getElementById("shopNow");
  const viewAll = document.querySelector(".text-btn");

  /* =========================================
     TOAST
  ========================================= */

  let toastTimer;

  function showToast(message) {
    if (!toast) return;

    toast.textContent = message;
    toast.classList.add("show");

    clearTimeout(toastTimer);

    toastTimer = setTimeout(() => {
      toast.classList.remove("show");
    }, 1800);
  }

  /* =========================================
     CART
  ========================================= */

  let cart = [];

  try {
    cart = JSON.parse(
      localStorage.getItem("novacart_cart")
    ) || [];
  } catch {
    cart = [];
  }

  function updateCartUI() {
    const totalItems = cart.reduce(
      (total, item) =>
        total + Number(item.quantity || 0),
      0
    );

    if (cartCount) {
      cartCount.textContent = totalItems;
    }

    if (headerCartCount) {
      headerCartCount.textContent = totalItems;
    }

    localStorage.setItem(
      "novacart_cart",
      JSON.stringify(cart)
    );
  }

  function addToCart(name, price, quantity = 1) {
    if (!name) return;

    const amount = Number(quantity) || 1;
    const numericPrice = Number(price) || 0;

    const existingProduct = cart.find(
      item => item.name === name
    );

    if (existingProduct) {
      existingProduct.quantity += amount;
    } else {
      cart.push({
        name,
        price: numericPrice,
        quantity: amount
      });
    }

    updateCartUI();
    showToast(`${name} added to cart 🛒`);
  }

  window.zentoAddToCart = addToCart;

  /* ---------- CARD ADD TO CART ---------- */

  document.addEventListener("click", event => {

    const button = event.target.closest(".add-cart");

    if (!button) return;

    event.preventDefault();
    event.stopPropagation();

    if (button.disabled) {
      showToast("Product is out of stock");
      return;
    }

    const name = button.dataset.product;
    const price = button.dataset.price;

    addToCart(name, price);

    const originalText = button.textContent;

    button.textContent = "✓";

    setTimeout(() => {
      button.textContent = originalText || "+";
    }, 800);
  });

  /* =========================================
     WISHLIST
  ========================================= */

  let wishlist = [];

  try {
    wishlist = JSON.parse(
      localStorage.getItem("zento_wishlist")
    ) || [];
  } catch {
    wishlist = [];
  }

  function syncWishlistButtons() {
    document.querySelectorAll(".wishlist-btn").forEach(button => {

      const card = button.closest(".product-card");
      const productName = card?.dataset.name;

      if (
        productName &&
        wishlist.includes(productName)
      ) {
        button.classList.add("liked");
        button.textContent = "♥";
      } else {
        button.classList.remove("liked");
        button.textContent = "♡";
      }
    });
  }

  document.addEventListener("click", event => {

    const button = event.target.closest(".wishlist-btn");

    if (!button) return;

    event.preventDefault();
    event.stopPropagation();

    const card = button.closest(".product-card");
    const productName = card?.dataset.name;

    if (!productName) return;

    if (wishlist.includes(productName)) {

      wishlist = wishlist.filter(
        item => item !== productName
      );

      button.classList.remove("liked");
      button.textContent = "♡";

      showToast("Removed from wishlist");

    } else {

      wishlist.push(productName);

      button.classList.add("liked");
      button.textContent = "♥";

      showToast("Added to wishlist ❤️");
    }

    localStorage.setItem(
      "zento_wishlist",
      JSON.stringify(wishlist)
    );
  });

  /* =========================================
     PRODUCT DETAILS
  ========================================= */

  const productModal =
    document.getElementById("productModal");

  const closeProductModal =
    document.getElementById("closeProductModal");

  const modalProductImage =
    document.getElementById("modalProductImage");

  const modalProductCategory =
    document.getElementById("modalProductCategory");

  const modalProductName =
    document.getElementById("modalProductName");

  const modalProductRating =
    document.getElementById("modalProductRating");

  const modalProductPrice =
    document.getElementById("modalProductPrice");

  const modalProductOldPrice =
    document.getElementById("modalProductOldPrice");

  const modalProductDescription =
    document.getElementById("modalProductDescription");

  const modalQty =
    document.getElementById("modalQty");

  const modalQtyMinus =
    document.getElementById("modalQtyMinus");

  const modalQtyPlus =
    document.getElementById("modalQtyPlus");

  const modalAddCart =
    document.getElementById("modalAddCart");

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

  function openProductModal(name, card = null) {

    let product = productDetails[name];

    if (!product && card) {
      product = {
        category: card.dataset.category || "General",
        price: Number(card.dataset.price) || 0,
        oldPrice: null,
        rating: "New",
        reviews: "0",
        icon: "🛍️",
        description:
          card.dataset.description ||
          "Product details are available from our store.",
        stock: Number(card.dataset.stock) || 0,
        image: card.dataset.image || ""
      };
    }

    if (!product || !productModal) {
      console.error("Product details not found:", name);
      return;
    }

    selectedProduct = {
      name,
      ...product
    };

    productQuantity = 1;

    if (modalProductImage) {
      if (product.image) {
        modalProductImage.innerHTML = `
          <img
            src="${product.image.replace(/"/g, "&quot;")}"
            alt="${name.replace(/"/g, "&quot;")}"
            style="width:100%;height:100%;object-fit:contain;border-radius:22px;"
            onerror="this.style.display='none';this.parentElement.textContent='🛍️';"
          >
        `;
      } else {
        modalProductImage.textContent = product.icon || "🛍️";
      }
    }

    if (modalProductCategory) {
      modalProductCategory.textContent =
        product.category;
    }

    if (modalProductName) {
      modalProductName.textContent = name;
    }

    if (modalProductRating) {
      modalProductRating.innerHTML =
        `<span>★</span> ${product.rating} <small>(${product.reviews} reviews)</small>`;
    }

    if (modalProductPrice) {
      modalProductPrice.textContent =
        `$${product.price.toFixed(2)}`;
    }

    if (modalProductOldPrice) {
      if (product.oldPrice !== null && product.oldPrice !== undefined) {
        modalProductOldPrice.textContent =
          `$${Number(product.oldPrice).toFixed(2)}`;
        modalProductOldPrice.style.display = "";
      } else {
        modalProductOldPrice.textContent = "";
        modalProductOldPrice.style.display = "none";
      }
    }

    if (modalProductDescription) {
      modalProductDescription.textContent =
        product.description ||
        "Product details are available from our store.";
    }

    const modalStock =
      document.querySelector(".modal-stock");

    if (modalStock) {
      const stock = Number(product.stock ?? 0);

      modalStock.innerHTML =
        stock > 0
          ? `<span>●</span> ${stock} in stock`
          : `<span>●</span> Out of stock`;

      modalStock.style.background =
        stock > 0 ? "#ecfdf5" : "#fff1f2";

      modalStock.style.color =
        stock > 0 ? "#087f5b" : "#d11a3a";
    }

    if (modalQty) {
      modalQty.textContent = productQuantity;
    }

    productModal.classList.add("active");
    productModal.setAttribute(
      "aria-hidden",
      "false"
    );

    document.body.style.overflow = "hidden";
  }

  function closeProductDetails() {

    if (!productModal) return;

    productModal.classList.remove("active");

    productModal.setAttribute(
      "aria-hidden",
      "true"
    );

    document.body.style.overflow = "";

    selectedProduct = null;
  }

  /* ---------- PRODUCT CARD CLICK ---------- */

  document.addEventListener("click", event => {

    const card = event.target.closest(".product-card");

    if (!card) return;

    if (
      event.target.closest(".add-cart") ||
      event.target.closest(".wishlist-btn")
    ) {
      return;
    }

    const name = card.dataset.name;

    if (name) {
      openProductModal(name, card);
    }
  });

  /* ---------- CLOSE MODAL ---------- */

  closeProductModal?.addEventListener(
    "click",
    closeProductDetails
  );

  document
    .querySelector("[data-close-product]")
    ?.addEventListener(
      "click",
      closeProductDetails
    );

  /* ---------- MODAL QUANTITY ---------- */

  modalQtyMinus?.addEventListener(
    "click",
    event => {

      event.preventDefault();
      event.stopPropagation();

      if (productQuantity > 1) {
        productQuantity--;

        if (modalQty) {
          modalQty.textContent =
            productQuantity;
        }
      }

    }
  );

  modalQtyPlus?.addEventListener(
    "click",
    event => {

      event.preventDefault();
      event.stopPropagation();

      if (productQuantity < 99) {
        productQuantity++;

        if (modalQty) {
          modalQty.textContent =
            productQuantity;
        }
      }

    }
  );

  /* ---------- MODAL ADD TO CART ---------- */

  modalAddCart?.addEventListener(
    "click",
    event => {

      event.preventDefault();
      event.stopPropagation();

      if (!selectedProduct) return;

      if (
        selectedProduct.stock !== undefined &&
        Number(selectedProduct.stock) <= 0
      ) {
        showToast("Product is out of stock");
        return;
      }

      addToCart(
        selectedProduct.name,
        selectedProduct.price,
        productQuantity
      );

      closeProductDetails();
    }
  );

  /* ---------- ESCAPE ---------- */

  document.addEventListener(
    "keydown",
    event => {

      if (
        event.key === "Escape" &&
        productModal?.classList.contains("active")
      ) {
        closeProductDetails();
      }

    }
  );

  /* =========================================
     DYNAMIC PRODUCT SYNC
  ========================================= */

  document.addEventListener(
    "zentoProductsLoaded",
    () => {
      products = [
        ...document.querySelectorAll(".product-card")
      ];

      syncWishlistButtons();
      filterProducts();
    }
  );

  /* =========================================
     SEARCH + FILTER
  ========================================= */

  let selectedCategory = "all";

  function filterProducts() {

    const searchValue =
      searchInput?.value
        .trim()
        .toLowerCase() || "";

    let visibleProducts = 0;

    products.forEach(product => {

      const productName =
        (product.dataset.name || "")
          .toLowerCase();

      const productCategory =
        (product.dataset.category || "")
          .toLowerCase();

      const matchesSearch =
        !searchValue ||
        productName.includes(searchValue) ||
        productCategory.includes(searchValue);

      const matchesCategory =
        selectedCategory === "all" ||
        productCategory === selectedCategory;

      const visible =
        matchesSearch &&
        matchesCategory;

      product.style.display =
        visible ? "" : "none";

      if (visible) {
        visibleProducts++;
      }

    });

    if (noResults) {
      noResults.hidden =
        visibleProducts !== 0;
    }

    if (clearSearch) {
      clearSearch.hidden =
        searchValue.length === 0;
    }
  }

  searchInput?.addEventListener(
    "input",
    filterProducts
  );

  clearSearch?.addEventListener(
    "click",
    () => {

      if (searchInput) {
        searchInput.value = "";
      }

      filterProducts();
      searchInput?.focus();

    }
  );

  /* ---------- CATEGORY FILTER ---------- */

  categories.forEach(category => {

    category.addEventListener(
      "click",
      () => {

        categories.forEach(item => {
          item.classList.remove("active");
        });

        category.classList.add("active");

        selectedCategory =
          category.dataset.category ||
          "all";

        filterProducts();
      }
    );

  });

  /* ---------- VIEW ALL ---------- */

  viewAll?.addEventListener(
    "click",
    () => {

      selectedCategory = "all";

      categories.forEach(item => {
        item.classList.toggle(
          "active",
          item.dataset.category === "all"
        );
      });

      if (searchInput) {
        searchInput.value = "";
      }

      filterProducts();

      document
        .getElementById("products")
        ?.scrollIntoView({
          behavior: "smooth",
          block: "start"
        });

    }
  );

  /* ---------- SHOP NOW ---------- */

  shopNow?.addEventListener(
    "click",
    () => {

      document
        .getElementById("products")
        ?.scrollIntoView({
          behavior: "smooth"
        });

    }
  );

  /* =========================================
     FLASH SALE TIMER
  ========================================= */

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
      Math.floor(
        (totalSeconds % 3600) / 60
      );

    const seconds =
      totalSeconds % 60;

    const hoursEl =
      document.getElementById("hours");

    const minutesEl =
      document.getElementById("minutes");

    const secondsEl =
      document.getElementById("seconds");

    if (hoursEl) {
      hoursEl.textContent =
        String(hours).padStart(2, "0");
    }

    if (minutesEl) {
      minutesEl.textContent =
        String(minutes).padStart(2, "0");
    }

    if (secondsEl) {
      secondsEl.textContent =
        String(seconds).padStart(2, "0");
    }

    totalSeconds--;
  }

  updateTimer();
  setInterval(updateTimer, 1000);

  /* =========================================
     CART PAGE
  ========================================= */

  const cartPage =
    document.getElementById("cartPage");

  const cartItemsContainer =
    document.getElementById("cartItems");

  const cartEmpty =
    document.getElementById("cartEmpty");

  const cartSummary =
    document.getElementById("cartSummary");

  const cartSubtotal =
    document.getElementById("cartSubtotal");

  const cartDelivery =
    document.getElementById("cartDelivery");

  const cartTotal =
    document.getElementById("cartTotal");

  const cartBack =
    document.getElementById("cartBack");

  const continueShopping =
    document.getElementById("continueShopping");

  const checkoutBtn =
    document.getElementById("checkoutBtn");

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

      if (cartSubtotal) {
        cartSubtotal.textContent = "$0.00";
      }

      if (cartDelivery) {
        cartDelivery.textContent = "$0.00";
      }

      if (cartTotal) {
        cartTotal.textContent = "$0.00";
      }

      return;
    }

    cartEmpty?.classList.remove("active");
    cartSummary?.classList.remove("hidden");

    let subtotal = 0;

    cart.forEach((item, index) => {

      const quantity =
        Number(item.quantity) || 0;

      const price =
        Number(item.price) || 0;

      subtotal +=
        price * quantity;

      const itemElement =
        document.createElement("article");

      itemElement.className =
        "cart-item";

      itemElement.innerHTML = `
        <div class="cart-item-image">
          ${cartProductIcons[item.name] || "🛍️"}
        </div>

        <div class="cart-item-info">

          <h3>${item.name}</h3>

          <strong>
            $${price.toFixed(2)}
          </strong>

          <small>
            $${(price * quantity).toFixed(2)} total
          </small>

          <div class="cart-item-actions">

            <button
              class="cart-qty-btn"
              data-cart-action="minus"
              data-index="${index}"
              type="button"
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
              type="button"
            >
              +
            </button>

            <button
              class="cart-remove"
              data-cart-action="remove"
              data-index="${index}"
              aria-label="Remove ${item.name}"
              type="button"
            >
              🗑
            </button>

          </div>

        </div>
      `;

      cartItemsContainer.appendChild(
        itemElement
      );
    });

    const delivery =
      subtotal >= 100 ? 0 : 5;

    const total =
      subtotal + delivery;

    if (cartSubtotal) {
      cartSubtotal.textContent =
        `$${subtotal.toFixed(2)}`;
    }

    if (cartDelivery) {
      cartDelivery.textContent =
        delivery === 0
          ? "FREE"
          : `$${delivery.toFixed(2)}`;
    }

    if (cartTotal) {
      cartTotal.textContent =
        `$${total.toFixed(2)}`;
    }
  }

  function openCartPage() {

    renderCartPage();

    cartPage?.classList.add("active");

    cartPage?.setAttribute(
      "aria-hidden",
      "false"
    );

    document.body.style.overflow =
      "hidden";
  }

  function closeCartPage() {

    cartPage?.classList.remove("active");

    cartPage?.setAttribute(
      "aria-hidden",
      "true"
    );

    document.body.style.overflow =
      "";
  }

  /* ---------- CART ACTIONS ---------- */

  document.addEventListener(
    "click",
    event => {

      const actionButton =
        event.target.closest(
          "[data-cart-action]"
        );

      if (!actionButton) return;

      const index =
        Number(actionButton.dataset.index);

      const action =
        actionButton.dataset.cartAction;

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
    }
  );

  /* ---------- CART OPEN ---------- */

  cartNav?.addEventListener(
    "click",
    event => {

      event.preventDefault();
      openCartPage();
    }
  );

  headerCart?.addEventListener(
    "click",
    event => {

      event.preventDefault();
      openCartPage();
    }
  );

  cartBack?.addEventListener(
    "click",
    closeCartPage
  );

  continueShopping?.addEventListener(
    "click",
    closeCartPage
  );

  checkoutBtn?.addEventListener(
    "click",
    () => {

      if (cart.length === 0) {
        showToast(
          "Your cart is empty 🛒"
        );
        return;
      }

      showToast(
        "Checkout is coming next 🚀"
      );
    }
  );

  /* =========================================
     INITIALIZE
  ========================================= */

  updateCartUI();
  filterProducts();
  renderCartPage();

});


/* =========================================
   ZENTO - AUTHENTICATION
========================================= */

document.addEventListener(
  "DOMContentLoaded",
  () => {

    const API_URL =
      "https://zento-e-commerce-all.onrender.com";

    const authScreen =
      document.getElementById("authScreen");

    const loginForm =
      document.getElementById("loginForm");

    const signupForm =
      document.getElementById("signupForm");

    const loginFormElement =
      document.getElementById(
        "loginFormElement"
      );

    const signupFormElement =
      document.getElementById(
        "signupFormElement"
      );

    const showSignup =
      document.getElementById("showSignup");

    const showLogin =
      document.getElementById("showLogin");

    const loginMessage =
      document.getElementById("loginMessage");

    const signupMessage =
      document.getElementById("signupMessage");

    function showLoginScreen() {

      if (loginForm) {
        loginForm.hidden = false;
      }

      if (signupForm) {
        signupForm.hidden = true;
      }

      if (loginMessage) {
        loginMessage.textContent = "";
      }

      if (signupMessage) {
        signupMessage.textContent = "";
      }
    }

    function showSignupScreen() {

      if (loginForm) {
        loginForm.hidden = true;
      }

      if (signupForm) {
        signupForm.hidden = false;
      }

      if (loginMessage) {
        loginMessage.textContent = "";
      }

      if (signupMessage) {
        signupMessage.textContent = "";
      }
    }

    function showHome() {

      if (authScreen) {
        authScreen.style.display = "none";
      }

      document.body.classList.remove(
        "auth-active"
      );
    }

    function showAuth() {

      if (authScreen) {
        authScreen.style.display = "flex";
      }

      document.body.classList.add(
        "auth-active"
      );
    }

    showSignup?.addEventListener(
      "click",
      showSignupScreen
    );

    showLogin?.addEventListener(
      "click",
      showLoginScreen
    );

    const token =
      localStorage.getItem("zento_token");

    if (token) {
      showHome();
    } else {
      showAuth();
      showLoginScreen();
    }

    /* ---------- SIGNUP ---------- */

    signupFormElement?.addEventListener(
      "submit",
      async event => {

        event.preventDefault();

        const name =
          document
            .getElementById("signupName")
            ?.value
            .trim() || "";

        const email =
          document
            .getElementById("signupEmail")
            ?.value
            .trim() || "";

        const password =
          document
            .getElementById("signupPassword")
            ?.value || "";

        if (signupMessage) {
          signupMessage.textContent =
            "Creating account...";
        }

        try {

          const response =
            await fetch(
              `${API_URL}/api/signup`,
              {
                method: "POST",
                headers: {
                  "Content-Type":
                    "application/json"
                },
                body: JSON.stringify({
                  name,
                  email,
                  password
                })
              }
            );

          const data =
            await response.json();

          if (!response.ok) {

            if (signupMessage) {
              signupMessage.textContent =
                data.message ||
                "Signup failed";
            }

            return;
          }

          if (signupMessage) {
            signupMessage.textContent =
              "Account created successfully. Please login.";
          }

          signupFormElement.reset();

          setTimeout(
            () => {

              showLoginScreen();

              const loginEmail =
                document.getElementById(
                  "loginEmail"
                );

              if (loginEmail) {
                loginEmail.value =
                  email;
              }

            },
            800
          );

        } catch {

          if (signupMessage) {
            signupMessage.textContent =
              "Unable to connect to server.";
          }
        }
      }
    );

    /* ---------- LOGIN ---------- */

    loginFormElement?.addEventListener(
      "submit",
      async event => {

        event.preventDefault();

        const email =
          document
            .getElementById("loginEmail")
            ?.value
            .trim() || "";

        const password =
          document
            .getElementById("loginPassword")
            ?.value || "";

        if (loginMessage) {
          loginMessage.textContent =
            "Logging in...";
        }

        try {

          const response =
            await fetch(
              `${API_URL}/api/login`,
              {
                method: "POST",
                headers: {
                  "Content-Type":
                    "application/json"
                },
                body: JSON.stringify({
                  email,
                  password
                })
              }
            );

          const data =
            await response.json();

          if (!response.ok) {

            if (loginMessage) {
              loginMessage.textContent =
                data.message ||
                "Login failed";
            }

            return;
          }

          localStorage.setItem(
            "zento_token",
            data.token
          );

          localStorage.setItem(
            "zento_user",
            JSON.stringify(data.user)
          );

          if (loginMessage) {
            loginMessage.textContent =
              "Login successful!";
          }

          setTimeout(
            showHome,
            500
          );

        } catch {

          if (loginMessage) {
            loginMessage.textContent =
              "Unable to connect to server.";
          }
        }
      }
    );

  }
);
