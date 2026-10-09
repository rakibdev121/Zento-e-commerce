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


/* =========================================
   LIGHT / DARK THEME
   Saved in localStorage, defaults to the device setting.
========================================= */

(function () {

  const root = document.documentElement;
  const meta = document.querySelector('meta[name="theme-color"]');
  const media = window.matchMedia("(prefers-color-scheme: dark)");

  function isDark() {
    const set = root.getAttribute("data-theme");
    return set ? set === "dark" : media.matches;
  }

  function syncMeta() {
    if (meta) meta.setAttribute("content", isDark() ? "#080e1f" : "#0b1736");
  }

  document.addEventListener("click", event => {
    if (!event.target.closest("[data-theme-toggle]")) return;

    const next = isDark() ? "light" : "dark";

    root.setAttribute("data-theme", next);

    try {
      localStorage.setItem("zento_theme", next);
    } catch (error) {}

    syncMeta();
  });

  media.addEventListener?.("change", syncMeta);
  syncMeta();

})();
