// OTA Bundle Build Key: v0.2.1-beta
const {
  firebaseConfig, initializeApp, getAuth, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signOut, onAuthStateChanged, sendEmailVerification,
  sendPasswordResetEmail, EmailAuthProvider, reauthenticateWithCredential,
  updatePassword, verifyBeforeUpdateEmail, updateProfile, updateEmail,
  setPersistence, browserLocalPersistence, getFirestore, doc, getDoc, setDoc,
  collection, addDoc, updateDoc, deleteDoc, getDocs, query, orderBy, writeBatch
} = window.__FIREBASE__ || window;

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

try {
  setPersistence(auth, browserLocalPersistence);
} catch (e) {}

// Clear legacy plaintext passwords on startup
try {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k && k.startsWith("budgelist-pending-email-change-")) {
      localStorage.removeItem(k);
    }
  }
} catch (e) {}

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);

function safeGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
function safeSet(key, value) { try { localStorage.setItem(key, value); return true; } catch (e) { return false; } }

// Apply Live OTA HTML Body Override if present
try {
  const otaBodyHtml = safeGet("budgelist-bundle-body-html");
  if (otaBodyHtml && !window.__otaBodyInjected) {
    window.__otaBodyInjected = true;
    document.body.innerHTML = otaBodyHtml;
  }
} catch (e) {
  console.warn("[OTA] Body HTML injection failed:", e);
}

const authScreen = $("auth-screen"), appScreen = $("app-screen");
const authForm = $("auth-form"), authError = $("auth-error");
const addBtn = $("add-btn"), addSheet = $("add-sheet"), expenseForm = $("expense-form");

async function checkAuthScreenNetwork() {
  const authScreenEl = $("auth-screen");
  if (!authScreenEl || authScreenEl.classList.contains("hidden")) return;

  const online = await checkNetworkConnection();
  if (!online) {
    showToast("No internet connection — connect to log in or continue as Guest");
    if ($("auth-error")) {
      $("auth-error").textContent = "Offline. Connect to the internet or continue as Guest.";
    }
  }
}

function showScreen(screenId) {
  const loadingScreen = $("loading-screen");
  const authScreenEl = $("auth-screen");
  const appScreenEl = $("app-screen");
  const addBtnEl = $("add-btn");

  if (screenId === "app") {
    if (authScreenEl) authScreenEl.classList.add("hidden");
    if (appScreenEl) appScreenEl.classList.remove("hidden");
    if (addBtnEl) addBtnEl.classList.remove("hidden");
    if (loadingScreen) loadingScreen.classList.add("hidden");
  } else if (screenId === "auth") {
    if (appScreenEl) appScreenEl.classList.add("hidden");
    if (addBtnEl) addBtnEl.classList.add("hidden");
    if (authScreenEl) authScreenEl.classList.remove("hidden");
    if (loadingScreen) loadingScreen.classList.add("hidden");
    if (typeof setAuthMode === "function") setAuthMode(authMode);
    checkAuthScreenNetwork();
  } else {
    if (authScreenEl) authScreenEl.classList.add("hidden");
    if (appScreenEl) appScreenEl.classList.add("hidden");
    if (addBtnEl) addBtnEl.classList.add("hidden");
    if (loadingScreen) loadingScreen.classList.remove("hidden");
  }
}
window.showScreen = showScreen;
const budgetBtn = $("set-budget-btn"), budgetSheet = $("budget-sheet"), budgetForm = $("budget-form");
const recurringSheet = $("recurring-sheet"), recurringForm = $("recurring-form");
let categorySort = safeGet("budgelist-cat-sort") || "default";
let categoryChartType = safeGet("budgelist-cat-chart") || "pie";
let expenseViewMode = safeGet("budgelist-expense-view") || "grouped";
let recurringViewMode = safeGet("budgelist-recurring-view") || "list";
let expenseCategoryFilter = "ALL";
const collapsedExpenseDays = new Set();

// ---------- State ----------
let uid = null;
let isGuest = false;
let expenses = [];       // {id, amount, category, note, dateISO, createdAt, recurringId}
let recurring = [];      // {id, amount, category, note, dayOfMonth}
let monthlyBudget = 0;   // legacy / active month effective budget reference
let globalBudget = 0;    // available unallocated global budget pool
let monthBudgets = {};   // { "YYYY-MM": { allocated, directCovered, unrestrictedDeducted, status: "active"|"settled", finalSpent, finalAllocated, returnedToGlobal, settledAt, unlocked } }
let budgetHistory = [];  // [{ id, amount, description, createdAt, type: "deposit"|"return", month? }]
let currencySymbol = safeGet("budgelist-currency-symbol") || "$";
let editingId = null;
let editingRecurringId = null;
let viewDate = startOfMonth(new Date());
let selectedDateISO = null; // null = full month view, or "YYYY-MM-DD" for day filter
let calendarOpen = false;
let recurringApplied = false;
let isSyncing = false;
let pendingOverbudgetContext = null;
let pendingUnlockCallback = null;
let pendingUnlockYm = null;
let sliderAnimFrame = null;

const dayLabelFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const shortDateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const groupDayFmt = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" });

const CATEGORIES = ["Food", "Transport", "Bills", "Shopping", "Health", "Other"];
const CAT_VAR = { Food: "--cat-food", Transport: "--cat-transport", Bills: "--cat-bills",
  Shopping: "--cat-shopping", Health: "--cat-health", Other: "--cat-other" };

function catIconSvg(cat, size = 16) {
  const attrs = `width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"`;
  switch (cat) {
    case "Food":
      return `<svg ${attrs}><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/></svg>`;
    case "Transport":
      return `<svg ${attrs}><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9L18 10l-2-4H8L6 10l-2.5 1.1C2.7 11.3 2 12.1 2 13v3c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/></svg>`;
    case "Bills":
      return `<svg ${attrs}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`;
    case "Shopping":
      return `<svg ${attrs}><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>`;
    case "Health":
      return `<svg ${attrs}><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>`;
    default:
      return `<svg ${attrs}><path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z"/><path d="M7 7h.01"/></svg>`;
  }
}

function toLocalISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function toLocalMonthPrefix(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

const fmt = (n) => currencySymbol + n.toFixed(2);
const todayISO = () => toLocalISO(new Date());
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function catColor(cat) { return getComputedStyle(document.documentElement).getPropertyValue(CAT_VAR[cat] || CAT_VAR.Other).trim(); }

// ---------- Modern Custom Select Component ----------
function buildCustomSelectOptions(selectEl, optionsUl) {
  if (!selectEl || !optionsUl) return;
  optionsUl.innerHTML = "";
  const frag = document.createDocumentFragment();
  Array.from(selectEl.options).forEach((optEl) => {
    const li = document.createElement("li");
    li.className = "custom-select-option";
    const optVal = optEl.value || optEl.text;
    li.dataset.value = optVal;

    const optLeft = document.createElement("div");
    optLeft.className = "option-left";

    if (CAT_VAR[optVal]) {
      const optDot = document.createElement("span");
      optDot.className = "custom-select-dot";
      optDot.style.background = catColor(optVal);
      optLeft.appendChild(optDot);
    }

    const optText = document.createElement("span");
    optText.textContent = optEl.text;
    optLeft.appendChild(optText);

    const optCheck = document.createElement("span");
    optCheck.className = "option-check";
    optCheck.textContent = "✓";

    li.appendChild(optLeft);
    li.appendChild(optCheck);

    li.addEventListener("click", (e) => {
      e.stopPropagation();
      selectEl.value = optVal;
      selectEl.dispatchEvent(new Event("change", { bubbles: true }));
      syncCustomSelect(selectEl);
      closeAllCustomSelects();
    });

    frag.appendChild(li);
  });
  optionsUl.appendChild(frag);
}

function syncCustomSelect(selectEl) {
  if (!selectEl) return;
  const parent = selectEl.parentNode;
  if (!parent) return;

  const wrapper = parent.querySelector(`.custom-select-wrapper[data-for="${selectEl.id || ''}"]`);
  if (!wrapper) return;

  const optionsUl = wrapper.querySelector(".custom-select-options");
  if (optionsUl) {
    const currentItems = optionsUl.querySelectorAll(".custom-select-option");
    let needsRebuild = currentItems.length !== selectEl.options.length;
    if (!needsRebuild && currentItems.length > 0) {
      const firstOpt = selectEl.options[0];
      const lastOpt = selectEl.options[selectEl.options.length - 1];
      if (
        currentItems[0].dataset.value !== String(firstOpt.value || firstOpt.text) ||
        currentItems[currentItems.length - 1].dataset.value !== String(lastOpt.value || lastOpt.text)
      ) {
        needsRebuild = true;
      }
    }
    if (needsRebuild) {
      buildCustomSelectOptions(selectEl, optionsUl);
    }
  }

  const selectedOpt = selectEl.options[selectEl.selectedIndex] || selectEl.options[0];
  if (!selectedOpt) return;

  const val = selectedOpt.value || selectedOpt.text;
  const textSpan = wrapper.querySelector(".custom-select-text");
  const dotSpan = wrapper.querySelector(".custom-select-dot");

  if (textSpan) textSpan.textContent = selectedOpt.text;

  if (dotSpan) {
    if (CAT_VAR[val]) {
      dotSpan.style.background = catColor(val);
      dotSpan.classList.remove("hidden");
    } else {
      dotSpan.classList.add("hidden");
    }
  }

  wrapper.querySelectorAll(".custom-select-option").forEach((opt) => {
    const isSel = opt.dataset.value === val || opt.dataset.value === selectedOpt.value;
    opt.classList.toggle("selected", isSel);
    const check = opt.querySelector(".option-check");
    if (check) check.style.opacity = isSel ? "1" : "0";
  });
}

function initCustomSelects() {
  const selects = document.querySelectorAll("select");
  selects.forEach((selectEl) => {
    if (selectEl.dataset.customized === "true") {
      syncCustomSelect(selectEl);
      return;
    }
    selectEl.dataset.customized = "true";

    const isMini = selectEl.classList.contains("mini-select");
    const wrapper = document.createElement("div");
    wrapper.className = `custom-select-wrapper ${isMini ? "mini-select-wrap" : ""}`;
    wrapper.dataset.for = selectEl.id || Math.random().toString(36).slice(2, 8);

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "custom-select-trigger";
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");

    const valueSpan = document.createElement("span");
    valueSpan.className = "custom-select-value";

    const dotSpan = document.createElement("span");
    dotSpan.className = "custom-select-dot hidden";

    const textSpan = document.createElement("span");
    textSpan.className = "custom-select-text";

    valueSpan.appendChild(dotSpan);
    valueSpan.appendChild(textSpan);

    const arrowSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    arrowSvg.setAttribute("class", "custom-select-arrow");
    arrowSvg.setAttribute("viewBox", "0 0 24 24");
    arrowSvg.innerHTML = `<polyline points="6 9 12 15 18 9"></polyline>`;

    trigger.appendChild(valueSpan);
    trigger.appendChild(arrowSvg);

    const dropdown = document.createElement("div");
    dropdown.className = "custom-select-dropdown";

    const optionsUl = document.createElement("ul");
    optionsUl.className = "custom-select-options";
    optionsUl.setAttribute("role", "listbox");

    buildCustomSelectOptions(selectEl, optionsUl);

    dropdown.appendChild(optionsUl);
    wrapper.appendChild(trigger);
    wrapper.appendChild(dropdown);

    selectEl.parentNode.insertBefore(wrapper, selectEl.nextSibling);

    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      const isOpen = wrapper.classList.contains("open");
      closeAllCustomSelects();
      if (!isOpen) {
        positionCustomSelect(wrapper, trigger, dropdown);
        wrapper.classList.add("open");
        trigger.setAttribute("aria-expanded", "true");
        const selLi = optionsUl.querySelector(".custom-select-option.selected");
        if (selLi && typeof selLi.scrollIntoView === "function") {
          selLi.scrollIntoView({ block: "nearest" });
        }
      }
    });

    syncCustomSelect(selectEl);
  });
}

function positionCustomSelect(wrapper, trigger, dropdown) {
  if (!wrapper || !trigger || !dropdown) return;

  wrapper.classList.remove("drop-up");
  dropdown.style.maxHeight = "";

  const triggerRect = trigger.getBoundingClientRect();
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth;

  const margin = 12;
  const spaceBelow = viewportHeight - triggerRect.bottom - margin;
  const spaceAbove = triggerRect.top - margin;

  const wasOpen = wrapper.classList.contains("open");
  if (!wasOpen) {
    dropdown.style.visibility = "hidden";
    dropdown.style.display = "block";
  }
  const optionsUl = dropdown.querySelector(".custom-select-options");
  const contentHeight = (optionsUl ? optionsUl.scrollHeight : dropdown.scrollHeight) || 200;
  const desiredHeight = Math.min(240, contentHeight + 14);

  if (!wasOpen) {
    dropdown.style.visibility = "";
    dropdown.style.display = "";
  }

  const shouldDropUp = (spaceBelow < desiredHeight && spaceAbove > spaceBelow);

  if (shouldDropUp) {
    wrapper.classList.add("drop-up");
    const maxHeight = Math.max(120, Math.min(240, spaceAbove));
    dropdown.style.maxHeight = `${maxHeight}px`;
  } else {
    wrapper.classList.remove("drop-up");
    const maxHeight = Math.max(120, Math.min(240, spaceBelow));
    dropdown.style.maxHeight = `${maxHeight}px`;
  }

  const dropdownRect = dropdown.getBoundingClientRect();
  if (dropdownRect.right > viewportWidth - margin) {
    dropdown.style.right = "0";
    dropdown.style.left = "auto";
  } else if (dropdownRect.left < margin) {
    dropdown.style.left = "0";
    dropdown.style.right = "auto";
  }
}

function closeAllCustomSelects() {
  document.querySelectorAll(".custom-select-wrapper").forEach((w) => {
    w.classList.remove("open");
    const trig = w.querySelector(".custom-select-trigger");
    if (trig) trig.setAttribute("aria-expanded", "false");
  });
}

window.addEventListener("resize", () => {
  document.querySelectorAll(".custom-select-wrapper.open").forEach((w) => {
    const trig = w.querySelector(".custom-select-trigger");
    const dd = w.querySelector(".custom-select-dropdown");
    if (trig && dd) positionCustomSelect(w, trig, dd);
  });
});

document.addEventListener("scroll", (e) => {
  document.querySelectorAll(".custom-select-wrapper.open").forEach((w) => {
    const trig = w.querySelector(".custom-select-trigger");
    const dd = w.querySelector(".custom-select-dropdown");
    if (trig && dd) positionCustomSelect(w, trig, dd);
  });
}, true);

document.addEventListener("click", (e) => {
  closeAllCustomSelects();
  if (calendarOpen && e) {
    const popover = $("calendar-popover");
    const monthNav = $("month-nav");
    if (popover && !popover.contains(e.target) && monthNav && !monthNav.contains(e.target)) {
      closeCalendar(true);
    }
  }
  if (typeof expCalOpen !== "undefined" && expCalOpen && e) {
    const expPicker = $("expense-date-picker");
    if (expPicker && !expPicker.contains(e.target)) {
      closeExpenseCalendar(true);
    }
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeAllCustomSelects();
    if (calendarOpen) closeCalendar(true);
    if (typeof expCalOpen !== "undefined" && expCalOpen) closeExpenseCalendar(true);
  }
});

try {
  const origDescriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  if (origDescriptor && origDescriptor.set) {
    Object.defineProperty(HTMLSelectElement.prototype, 'value', {
      get: function() {
        return origDescriptor.get.call(this);
      },
      set: function(val) {
        origDescriptor.set.call(this, val);
        syncCustomSelect(this);
      }
    });
  }
} catch (e) {}

setTimeout(() => { initCustomSelects(); }, 100);
