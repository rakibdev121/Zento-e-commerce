/* =========================================
   ZENTO - LIVE CHAT (customer side)
   Messages go to the Messages inbox of the
   Zento Admin app. Polls while the chat is open.
========================================= */

(function () {

  const page = document.getElementById("chatPage");
  if (!page) return;

  const box = document.getElementById("chatMessages");
  const form = document.getElementById("chatForm");
  const input = document.getElementById("chatInput");
  const sendBtn = form ? form.querySelector("button[type=submit]") : null;

  const token = () => localStorage.getItem("zento_token");

  let last = 0;
  let timer = null;
  let unreadTimer = null;
  let busy = false;

  async function api(path, options = {}) {
    const headers = { "Content-Type": "application/json" };
    if (token()) headers.Authorization = "Bearer " + token();

    const res = await fetch(window.location.origin + path, { ...options, headers });
    let data = {};

    try { data = await res.json(); } catch (error) {}

    if (res.status === 401 && token()) {
      localStorage.removeItem("zento_token");
      localStorage.removeItem("zento_user");
      location.reload();
    }

    if (!res.ok) {
      const err = new Error(data.message || "Request failed");
      err.status = res.status;
      throw err;
    }

    return data;
  }

  function time(value) {
    const d = new Date(String(value || "").replace(" ", "T"));
    if (isNaN(d)) return "";
    return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }

  function note(text) {
    box.innerHTML = "";
    const p = document.createElement("p");
    p.className = "chat-note";
    p.textContent = text;
    box.appendChild(p);
  }

  function addMessages(list, forceScroll) {
    if (!list.length) return;

    const first = box.querySelector(".chat-note");
    if (first) box.innerHTML = "";

    const near = forceScroll || box.scrollHeight - box.scrollTop - box.clientHeight < 140;

    list.forEach(m => {
      last = Math.max(last, m.id);

      const row = document.createElement("div");
      row.className = "chat-msg " + (m.sender === "user" ? "me" : "them");

      const p = document.createElement("p");
      p.textContent = m.body;

      const small = document.createElement("small");
      small.textContent = time(m.created_at);

      row.appendChild(p);
      row.appendChild(small);
      box.appendChild(row);
    });

    if (near) box.scrollTop = box.scrollHeight;
  }

  async function load(first) {
    if (!token() || busy) return;
    busy = true;

    try {
      const data = await api("/api/chat/messages?after=" + last);
      const list = data.messages || [];

      if (first && !list.length) {
        note("Hi! Write your question here and our team will reply soon.");
      } else {
        addMessages(list, first);
      }

      setUnread(0);
    } catch (error) {
      if (first) note("Could not load the chat. Check your connection.");
    }

    busy = false;
  }

  function open() {
    page.classList.add("active");
    page.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";

    last = 0;
    box.innerHTML = "";

    if (!token()) {
      note("Please log in to chat with our team.");
      if (input) input.disabled = true;
      if (sendBtn) sendBtn.disabled = true;
      return;
    }

    if (input) input.disabled = false;
    if (sendBtn) sendBtn.disabled = false;

    note("Loading...");
    load(true);

    clearInterval(timer);
    timer = setInterval(() => {
      if (document.visibilityState !== "hidden") load(false);
    }, 4000);
  }

  function close() {
    page.classList.remove("active");
    page.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    clearInterval(timer);
    timer = null;
  }

  form?.addEventListener("submit", async event => {
    event.preventDefault();

    const body = input.value.trim();
    if (!body || !token()) return;

    input.value = "";
    input.style.height = "";
    sendBtn.disabled = true;

    try {
      const data = await api("/api/chat/messages", {
        method: "POST",
        body: JSON.stringify({ body })
      });

      if (data.message && data.message.id > last) addMessages([data.message], true);
    } catch (error) {
      input.value = body;
      alert(error.message);
    }

    sendBtn.disabled = false;
    input.focus();
  });

  input?.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  input?.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
  });

  document.getElementById("chatBack")?.addEventListener("click", close);

  /* ---------- unread dot on the Support tab ---------- */

  function setUnread(count) {
    const nav = document.getElementById("supportNav");
    if (!nav) return;

    let dot = nav.querySelector(".nav-dot");

    if (count > 0) {
      if (!dot) {
        dot = document.createElement("i");
        dot.className = "nav-dot";
        nav.appendChild(dot);
      }
      dot.textContent = count > 9 ? "9+" : String(count);
    } else if (dot) {
      dot.remove();
    }
  }

  async function checkUnread() {
    if (!token() || document.visibilityState === "hidden" || page.classList.contains("active")) return;

    try {
      const data = await api("/api/chat/unread");
      setUnread(Number(data.unread) || 0);
    } catch (error) {}
  }

  checkUnread();
  unreadTimer = setInterval(checkUnread, 30000);
  document.addEventListener("visibilitychange", checkUnread);

  window.zentoOpenChat = open;

})();
