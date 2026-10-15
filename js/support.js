/* =========================================
   ZENTO - SUPPORT PAGE
========================================= */

(function () {

  const page = document.getElementById("supportPage");
  if (!page) return;

  const cfg = window.ZENTO_SUPPORT || {};

  function open() {
    page.classList.add("active");
    page.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }

  function close() {
    page.classList.remove("active");
    page.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  function clean(value) {
    return String(value || "").trim();
  }

  function digits(value) {
    return clean(value).replace(/\D/g, "");
  }

  function channel(href, icon, title, detail) {
    const a = document.createElement("a");
    a.className = "support-channel";
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener";
    a.innerHTML =
      '<span class="ch-icon"><svg class="i"><use href="#' + icon + '"/></svg></span>' +
      "<div><strong></strong><small></small></div>";
    a.querySelector("strong").textContent = title;
    a.querySelector("small").textContent = detail;
    return a;
  }

  function render() {
    const list = document.getElementById("supportChannels");
    const empty = document.getElementById("supportEmpty");
    const hours = document.getElementById("supportHours");
    if (!list) return;

    list.innerHTML = "";

    const whatsapp = digits(cfg.whatsapp);
    const phone = clean(cfg.phone);
    const email = clean(cfg.email);
    const facebook = clean(cfg.facebook);

    if (whatsapp) {
      list.appendChild(channel("https://wa.me/" + whatsapp, "i-chat", "WhatsApp", "Chat with us"));
    }

    if (phone) {
      list.appendChild(channel("tel:" + phone.replace(/[^\d+]/g, ""), "i-phone", "Call us", phone));
    }

    if (email) {
      list.appendChild(channel("mailto:" + email, "i-mail", "Email", email));
    }

    if (/^https:\/\//i.test(facebook)) {
      list.appendChild(channel(facebook, "i-chat", "Facebook", "Message our page"));
    }

    if (empty) empty.hidden = list.children.length > 0;
    if (hours) hours.textContent = clean(cfg.hours);
  }

  render();

  document.getElementById("supportNav")?.addEventListener("click", event => {
    event.preventDefault();
    open();
  });

  document.getElementById("footerSupport")?.addEventListener("click", event => {
    event.preventDefault();
    open();
  });

  document.getElementById("supportBack")?.addEventListener("click", close);

})();
