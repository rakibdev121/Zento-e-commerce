/* =========================================
   ZENTO - STOREFRONT UI HELPERS
   Visual-only behaviour: footer year and the
   active state of the Home / Shop menu.
========================================= */

document.addEventListener("DOMContentLoaded", () => {

  const year = document.getElementById("footerYear");
  if (year) year.textContent = new Date().getFullYear();

  const home = document.getElementById("homeNav");
  const shop = document.getElementById("shopNav");
  const products = document.getElementById("products");

  function setActive(target) {
    [home, shop].forEach(item => {
      if (item) item.classList.toggle("active", item === target);
    });
  }

  home?.addEventListener("click", event => {
    event.preventDefault();
    window.scrollTo({ top: 0, behavior: "smooth" });
    setActive(home);
  });

  shop?.addEventListener("click", () => setActive(shop));

  if (products && "IntersectionObserver" in window) {
    new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) setActive(shop);
        else if (window.scrollY < 200) setActive(home);
      });
    }, { rootMargin: "-35% 0px -45% 0px" }).observe(products);
  }

});
