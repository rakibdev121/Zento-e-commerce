/* =========================================
   ZENTO - DYNAMIC PRODUCTS
========================================= */

async function loadZentoProducts() {
  const container = document.getElementById("dynamicProducts");

  if (!container) return;

  try {
    const response = await fetch("https://zento-e-commerce-all.onrender.com/api/products");

    if (!response.ok) {
      throw new Error("Failed to load products");
    }

    const data = await response.json();
    const products = Array.isArray(data.products)
      ? data.products
      : [];

    if (!products.length) {
      container.innerHTML = `
        <div class="no-products-message">
          No products available yet.
        </div>
      `;
      return;
    }

    container.innerHTML = products.map(product => {
      const name = String(product.name || "");
      const description = String(product.description || "");
      const category = String(product.category || "General");
      const price = Number(product.price) || 0;
      const image = String(product.image_url || "");

      return `
        <article
          class="product-card"
          data-name="${escapeZentoHtml(name)}"
          data-category="${escapeZentoHtml(category.toLowerCase())}"
        >

          <div class="product-top">

            <span class="discount">
              NEW
            </span>

            <button
              class="wishlist-btn"
              type="button"
              aria-label="Add ${escapeZentoHtml(name)} to wishlist"
            >♡</button>

          </div>

          <div class="product-image">
            ${
              image
                ? `<img
                    src="${escapeZentoHtml(image)}"
                    alt="${escapeZentoHtml(name)}"
                    loading="lazy"
                  >`
                : `<span>🛍️</span>`
            }
          </div>

          <div class="product-info">

            <span class="product-category">
              ${escapeZentoHtml(category)}
            </span>

            <h3>
              ${escapeZentoHtml(name)}
            </h3>

            <div class="rating">
              <span>★</span>
              New Product
            </div>

            <div class="price-row">

              <strong>
                ৳${price.toFixed(2)}
              </strong>

              <button
                class="add-cart"
                type="button"
                data-product="${escapeZentoHtml(name)}"
                data-price="${price}"
              >+</button>

            </div>

          </div>

          <div
            class="dynamic-product-data"
            data-description="${escapeZentoHtml(description)}"
            hidden
          ></div>

        </article>
      `;
    }).join("");

    document.dispatchEvent(
      new CustomEvent("zentoProductsLoaded", {
        detail: products
      })
    );

  } catch (error) {

    console.error(
      "Zento products loading error:",
      error
    );

    container.innerHTML = `
      <div class="no-products-message">
        Unable to load products.
      </div>
    `;
  }
}

function escapeZentoHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

document.addEventListener(
  "DOMContentLoaded",
  loadZentoProducts
);
