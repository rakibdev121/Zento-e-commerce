/* =========================================
   ZENTO - DYNAMIC PRODUCTS
========================================= */

async function loadZentoProducts() {
  const container = document.getElementById("dynamicProducts");
  const noResults = document.getElementById("noResults");

  if (!container) return;

  try {
    const response = await fetch(
      "https://zento-e-commerce-all.onrender.com/api/products",
      { cache: "no-store" }
    );

    if (!response.ok) {
      throw new Error("Failed to load products");
    }

    const data = await response.json();

    const products = Array.isArray(data.products)
      ? data.products
      : [];

    if (!products.length) {
      container.innerHTML = "";
      if (noResults) noResults.hidden = false;
      return;
    }

    if (noResults) noResults.hidden = true;

    container.innerHTML = products.map(product => {
      const id = String(product.id ?? "");
      const name = String(product.name ?? "");
      const description = String(product.description ?? "");
      const category = String(product.category ?? "General");
      const price = Number(product.price) || 0;
      const stock = Number(product.stock) || 0;
      const image = String(product.image_url ?? "");

      const safeName = escapeZentoHtml(name);
      const safeDescription = escapeZentoHtml(description);
      const safeCategory = escapeZentoHtml(category);
      const safeImage = escapeZentoHtml(image);

      const stockText =
        stock > 0
          ? `${stock} in stock`
          : "Out of stock";

      return `
        <article
          class="product-card"
          data-id="${escapeZentoHtml(id)}"
          data-name="${safeName}"
          data-category="${escapeZentoHtml(category.toLowerCase())}"
          data-price="${price}"
          data-description="${safeDescription}"
          data-image="${safeImage}"
          data-stock="${stock}"
        >

          <div class="product-top">

            <span class="discount">
              NEW
            </span>

            <button
              class="wishlist-btn"
              type="button"
              aria-label="Add ${safeName} to wishlist"
            >♡</button>

          </div>

          <div class="product-image">
            ${
              image
                ? `<img
                    src="${safeImage}"
                    alt="${safeName}"
                    loading="lazy"
                    onerror="this.style.display='none';this.parentElement.querySelector('.image-fallback').style.display='block';"
                  >
                  <span class="image-fallback" style="display:none;font-size:48px;">🛍️</span>`
                : `<span>🛍️</span>`
            }
          </div>

          <div class="product-info">

            <span class="product-category">
              ${safeCategory}
            </span>

            <h3>
              ${safeName}
            </h3>

            <div class="rating">
              <span>★</span>
              <span>${escapeZentoHtml(stockText)}</span>
            </div>

            <div class="price-row">

              <div class="price">
                <strong>
                  ৳${price.toFixed(2)}
                </strong>
              </div>

              <button
                class="add-cart"
                type="button"
                data-product="${safeName}"
                data-price="${price}"
                data-id="${escapeZentoHtml(id)}"
                ${stock <= 0 ? "disabled" : ""}
                aria-label="Add ${safeName} to cart"
              >${stock > 0 ? "+" : "×"}</button>

            </div>

          </div>

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

    if (noResults) {
      noResults.hidden = true;
    }
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
