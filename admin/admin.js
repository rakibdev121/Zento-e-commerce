import { supabase } from "../js/supabase.js";

const loginScreen = document.getElementById("loginScreen");
const adminApp = document.getElementById("adminApp");
const loginForm = document.getElementById("adminLoginForm");
const loginError = document.getElementById("loginError");

const navItems = document.querySelectorAll(".nav-item");
const pages = document.querySelectorAll(".page");
const pageTitle = document.getElementById("pageTitle");

const titles = {
  dashboard: "Dashboard",
  products: "Products",
  orders: "Orders",
  customers: "Customers",
  categories: "Categories",
  settings: "Settings"
};

function showAdmin() {
  loginScreen.style.display = "none";
  adminApp.classList.add("authenticated");
}

function showLogin() {
  loginScreen.style.display = "flex";
  adminApp.classList.remove("authenticated");
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  loginError.textContent = "";

  const email = document.getElementById("adminEmail").value.trim();
  const password = document.getElementById("adminPassword").value;

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    loginError.textContent = error.message;
    return;
  }

  showAdmin();
});

navItems.forEach((item) => {
  item.addEventListener("click", () => {
    const page = item.dataset.page;

    navItems.forEach((nav) => nav.classList.remove("active"));
    item.classList.add("active");

    pages.forEach((section) => {
      section.classList.remove("active");
    });

    const target = document.getElementById(`${page}Page`);

    if (target) {
      target.classList.add("active");
    }

    pageTitle.textContent = titles[page] || "Dashboard";
  });
});

document.getElementById("logoutBtn").addEventListener("click", async () => {
  await supabase.auth.signOut();
  showLogin();
});

async function checkSession() {
  const { data, error } = await supabase.auth.getSession();

  if (error || !data.session) {
    showLogin();
    return;
  }

  showAdmin();
}

supabase.auth.onAuthStateChange((event, session) => {
  if (session) {
    showAdmin();
  } else {
    showLogin();
  }
});

checkSession();

console.log("Zento Admin Panel loaded");
