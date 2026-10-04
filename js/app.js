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

  function addToCart(name, price) {
    const existingProduct = cart.find(
      item => item.name === name
    );

    if (existingProduct) {
      existingProduct.quantity += 1;
    } else {
      cart.push({
        name,
        price: Number(price),
        quantity: 1
      });
    }

    updateCartUI();
    showToast(`${name} added to cart 🛒`);
  }

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

