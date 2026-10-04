/* =========================================
   NOVACART - MAIN JAVASCRIPT
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

  const toast = document.getElementById("toast");

  const shopNow = document.getElementById("shopNow");


  /* ---------- CART ---------- */

  let cart = JSON.parse(localStorage.getItem("novacart_cart")) || [];

  function updateCartUI() {

    const totalItems = cart.reduce(
      (total, item) => total + item.quantity,
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
        name: name,
        price: Number(price),
        quantity: 1
      });

    }

    updateCartUI();

    showToast(`${name} added to cart 🛒`);
  }


  /* ---------- ADD TO CART BUTTONS ---------- */

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


  /* ---------- WISHLIST ---------- */

  document.querySelectorAll(".wishlist-btn").forEach(button => {

    button.addEventListener("click", () => {

      button.classList.toggle("liked");

      if (button.classList.contains("liked")) {

        button.textContent = "♥";

        showToast("Added to wishlist ❤️");

      } else {

        button.textContent = "♡";

        showToast("Removed from wishlist");

      }

    });

  });


  /* ---------- SEARCH ---------- */

  function filterProducts() {

    const searchValue =
      searchInput.value.trim().toLowerCase();

    let visibleProducts = 0;

    products.forEach(product => {

      const productName =
        product.dataset.name.toLowerCase();

      const productCategory =
        product.dataset.category.toLowerCase();

      const matchesSearch =
        productName.includes(searchValue) ||
        productCategory.includes(searchValue);

      if (matchesSearch) {

        product.style.display = "";

        visibleProducts++;

      } else {

        product.style.display = "none";

      }

    });

    noResults.hidden = visibleProducts !== 0;

    clearSearch.hidden = searchValue.length === 0;
  }


  searchInput.addEventListener(
    "input",
    filterProducts
  );


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

      const selectedCategory =
        category.dataset.category;

      let visibleProducts = 0;

      products.forEach(product => {

        const productCategory =
          product.dataset.category;

        const matches =
          selectedCategory === "all" ||
          productCategory === selectedCategory;

        if (matches) {

          product.style.display = "";

          visibleProducts++;

        } else {

          product.style.display = "none";

        }

      });

      noResults.hidden = visibleProducts !== 0;

    });

  });


  /* ---------- SHOP NOW ---------- */

  shopNow.addEventListener("click", () => {

    document
      .getElementById("products")
      .scrollIntoView({
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


  /* ---------- CART BUTTON ---------- */

  document
    .getElementById("headerCart")
    .addEventListener("click", () => {

      if (cart.length === 0) {

        showToast("Your cart is empty 🛒");

      } else {

        const total = cart.reduce(
          (sum, item) =>
            sum + item.price * item.quantity,
          0
        );

        showToast(
          `${cart.length} product(s) • $${total.toFixed(2)}`
        );

      }

    });


  /* ---------- INITIALIZE ---------- */

  updateCartUI();

});
