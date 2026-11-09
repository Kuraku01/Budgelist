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

// ---------- Local Cache & Sync Queue ----------
const CURRENT_SCHEMA_VERSION = 1;

function cacheKey(key) { return `budgelist-user-${uid || "guest"}-${key}`; }

function runDataSchemaMigrations() {
  const currentKey = cacheKey("schema-version");
  const storedVersion = parseInt(safeGet(currentKey) || "0", 10);

  if (storedVersion >= CURRENT_SCHEMA_VERSION) return;

  try {
    // Migration 0 -> 1: Ensure all expenses and recurring bills have required default properties
    const rawExpenses = safeGet(cacheKey("expenses"));
    if (rawExpenses) {
      let parsedExp = JSON.parse(rawExpenses);
      if (Array.isArray(parsedExp)) {
        let modified = false;
        parsedExp = parsedExp.map((exp) => {
          if (!exp || typeof exp !== "object") return exp;
          if (exp.category === undefined) { exp.category = "Other"; modified = true; }
          if (exp.note === undefined) { exp.note = ""; modified = true; }
          if (exp.amount === undefined || isNaN(exp.amount)) { exp.amount = 0; modified = true; }
          return exp;
        });
        if (modified) safeSet(cacheKey("expenses"), JSON.stringify(parsedExp));
      }
    }

    const rawRecurring = safeGet(cacheKey("recurring"));
    if (rawRecurring) {
      let parsedRec = JSON.parse(rawRecurring);
      if (Array.isArray(parsedRec)) {
        let modified = false;
        parsedRec = parsedRec.map((rec) => {
          if (!rec || typeof rec !== "object") return rec;
          if (rec.category === undefined) { rec.category = "Other"; modified = true; }
          if (rec.note === undefined) { rec.note = ""; modified = true; }
          if (rec.dayOfMonth === undefined) { rec.dayOfMonth = 1; modified = true; }
          return rec;
        });
        if (modified) safeSet(cacheKey("recurring"), JSON.stringify(parsedRec));
      }
    }

    safeSet(currentKey, String(CURRENT_SCHEMA_VERSION));
  } catch (e) {
    console.error("Schema migration error:", e);
  }
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function monthSpentTotal(ym) {
  return round2(
    expenses
      .filter((e) => e && e.dateISO && e.dateISO.startsWith(ym))
      .reduce((s, e) => s + (Number(e.amount) || 0), 0)
  );
}

function ensureMonthRecord(ym) {
  if (!monthBudgets || typeof monthBudgets !== "object") monthBudgets = {};
  if (!monthBudgets[ym] || typeof monthBudgets[ym] !== "object") {
    const curYm = toLocalMonthPrefix(new Date());
    monthBudgets[ym] = {
      allocated: 0,
      directCovered: 0,
      unrestrictedDeducted: 0,
      status: ym < curYm ? "settled" : "active",
      finalSpent: ym < curYm ? monthSpentTotal(ym) : null,
      finalAllocated: 0,
      returnedToGlobal: 0,
      settledAt: ym < curYm ? Date.now() : null,
      unlocked: false,
    };
  }
  return monthBudgets[ym];
}

function isPastMonth(ym) {
  return ym < toLocalMonthPrefix(new Date());
}

function isPastMonthUnlocked(ym) {
  if (!isPastMonth(ym)) return true;
  const rec = ensureMonthRecord(ym);
  return Boolean(rec.unlocked);
}

function formatMonthYearLabel(ym) {
  const [y, m] = ym.split("-").map((v) => parseInt(v, 10));
  if (!y || !m) return ym;
  return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(new Date(y, m - 1, 1));
}

function syncBudgetState() {
  saveLocalUserCache();
  if (!isGuest && uid) {
    enqueueSync({
      type: "SYNC_BUDGET_STATE",
      data: {
        globalBudget: round2(globalBudget),
        monthBudgets: monthBudgets,
        budgetHistory: budgetHistory,
        budgetMigratedV2: true,
      },
    });
  }
}

// Settle any elapsed past months ONCE, returning unspent monthly budget to globalBudget
function settleElapsedMonths(shouldSync = true) {
  const curYm = toLocalMonthPrefix(new Date());
  const candidateYms = new Set(Object.keys(monthBudgets || {}));
  for (const e of expenses) {
    if (e && e.dateISO && e.dateISO.length >= 7) {
      const ym = e.dateISO.slice(0, 7);
      if (ym < curYm) candidateYms.add(ym);
    }
  }

  const pastYms = Array.from(candidateYms).filter((ym) => ym < curYm).sort();
  let changed = false;

  for (const ym of pastYms) {
    const rec = monthBudgets[ym];
    const spent = monthSpentTotal(ym);

    if (rec && rec.status === "settled") {
      continue;
    }

    const allocated = rec ? round2(rec.allocated || 0) : 0;
    const unspent = allocated > 0 ? Math.max(0, round2(allocated - spent)) : 0;

    if (unspent > 0) {
      globalBudget = round2(globalBudget + unspent);
      const retId = "ret_" + ym;
      if (!budgetHistory.some((h) => h && h.id === retId)) {
        budgetHistory.unshift({
          id: retId,
          amount: unspent,
          description: `Unspent returned from ${formatMonthYearLabel(ym)}`,
          createdAt: Date.now(),
          type: "return",
          month: ym,
        });
      }
    }

    monthBudgets[ym] = {
      allocated: allocated,
      directCovered: rec ? round2(rec.directCovered || 0) : 0,
      unrestrictedDeducted: rec ? round2(rec.unrestrictedDeducted || 0) : 0,
      status: "settled",
      finalSpent: spent,
      finalAllocated: allocated,
      returnedToGlobal: unspent,
      settledAt: Date.now(),
      unlocked: rec && rec.unlocked ? true : false,
    };
    changed = true;
  }

  if (changed) {
    if (shouldSync) syncBudgetState();
    else saveLocalUserCache();
  }
}

// Reconcile an active month's spend against globalBudget (handles unrestricted deductions & refunds)
function reconcileActiveMonthSpend(ym) {
  if (!ym) return;
  if (isPastMonth(ym)) {
    const rec = ensureMonthRecord(ym);
    rec.finalSpent = monthSpentTotal(ym);
    return;
  }

  const rec = ensureMonthRecord(ym);
  const spent = monthSpentTotal(ym);

  if ((rec.allocated || 0) <= 0) {
    // Unrestricted active month: expenses deduct directly from globalBudget
    const alreadyDeducted = round2(rec.unrestrictedDeducted || 0);
    const delta = round2(spent - alreadyDeducted);
    if (delta > 0) {
      const deduct = Math.min(globalBudget, delta);
      globalBudget = Math.max(0, round2(globalBudget - deduct));
      rec.unrestrictedDeducted = round2(alreadyDeducted + deduct);
    } else if (delta < 0) {
      const refund = Math.min(alreadyDeducted, Math.abs(delta));
      globalBudget = round2(globalBudget + refund);
      rec.unrestrictedDeducted = round2(alreadyDeducted - refund);
    }
  } else {
    // Restricted active month: if spend dropped below allocated + directCovered, refund excess directCovered
    const directCov = round2(rec.directCovered || 0);
    if (directCov > 0) {
      const neededDirect = Math.max(0, round2(spent - rec.allocated));
      if (neededDirect < directCov) {
        const refund = round2(directCov - neededDirect);
        globalBudget = round2(globalBudget + refund);
        rec.directCovered = neededDirect;
      }
    }
  }
}

function loadLocalUserCache() {
  runDataSchemaMigrations();
  try {
    monthlyBudget = parseFloat(safeGet(cacheKey("budget"))) || 0;
    globalBudget = parseFloat(safeGet(cacheKey("global-budget"))) || 0;
    monthBudgets = JSON.parse(safeGet(cacheKey("month-budgets"))) || {};
    budgetHistory = JSON.parse(safeGet(cacheKey("budget-history"))) || [];
    expenses = JSON.parse(safeGet(cacheKey("expenses"))) || [];
    recurring = JSON.parse(safeGet(cacheKey("recurring"))) || [];

    if (!safeGet(cacheKey("budget-v2-migrated"))) {
      if (globalBudget === 0 && monthlyBudget > 0) {
        globalBudget = round2(monthlyBudget);
        budgetHistory.unshift({
          id: "mig_init_" + Date.now(),
          amount: globalBudget,
          description: "Initial migrated budget",
          createdAt: Date.now(),
          type: "deposit",
        });
      }
      safeSet(cacheKey("budget-v2-migrated"), "true");
      saveLocalUserCache();
    }
    settleElapsedMonths(false);
  } catch (e) {
    monthlyBudget = 0; globalBudget = 0; monthBudgets = {}; budgetHistory = []; expenses = []; recurring = [];
  }
}

function saveLocalUserCache() {
  safeSet(cacheKey("expenses"), JSON.stringify(expenses));
  safeSet(cacheKey("recurring"), JSON.stringify(recurring));
  safeSet(cacheKey("budget"), String(monthlyBudget));
  safeSet(cacheKey("global-budget"), String(round2(globalBudget)));
  safeSet(cacheKey("month-budgets"), JSON.stringify(monthBudgets || {}));
  safeSet(cacheKey("budget-history"), JSON.stringify(budgetHistory || []));
}

let syncQueue = [];
function loadSyncQueue() {
  try { syncQueue = JSON.parse(safeGet(cacheKey("sync-queue"))) || []; } catch (e) { syncQueue = []; }
}
function saveSyncQueue() {
  safeSet(cacheKey("sync-queue"), JSON.stringify(syncQueue));
}
function enqueueSync(mutation) {
  if (isGuest || !uid) return;
  syncQueue.push(mutation);
  saveSyncQueue();
  const autoSyncEnabled = safeGet(cacheKey("auto-sync")) !== "false";
  if (autoSyncEnabled) {
    syncCloudData(false);
  }
}

// ---------- Theme ----------
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  safeSet("budgelist-theme", theme);
  $("theme-icon-sun").classList.toggle("hidden", theme === "dark");
  $("theme-icon-moon").classList.toggle("hidden", theme !== "dark");
  if ($("settings-dark-toggle")) {
    $("settings-dark-toggle").checked = (theme === "dark");
  }
}

function applyColorTheme(colorTheme) {
  const validThemes = ["violet", "emerald", "ocean", "rose", "sunset", "slate"];
  const normalized = validThemes.includes(colorTheme) ? colorTheme : "violet";
  document.documentElement.setAttribute("data-color-theme", normalized);
  safeSet("budgelist-color-theme", normalized);
  document.querySelectorAll(".theme-swatch-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.colorTheme === normalized);
  });
}

applyTheme(safeGet("budgelist-theme") ||
  (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
applyColorTheme(safeGet("budgelist-color-theme") || "violet");

$("theme-toggle").addEventListener("click", () => {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  applyTheme(next);
  render();
});

// ---------- Network Detection & Realtime Status Banner ----------
let pendingNetworkAction = null;
let statusBannerTimer = null;
let lastKnownOnlineState = null;
let isCheckingNetwork = false;

async function checkNetworkConnection() {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return false;
  }

  const endpoints = [
    "https://www.gstatic.com/generate_204",
    "https://cloudflare.com/cdn-cgi/trace",
    "https://www.google.com/generate_204"
  ];

  for (const url of endpoints) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      await fetch(url, {
        method: "GET",
        mode: "no-cors",
        cache: "no-store",
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return true;
    } catch (e) {
      // ignore and try next fallback endpoint
    }
  }

  return typeof navigator !== "undefined" ? navigator.onLine : true;
}

function updateRealtimeNetworkBanner(online) {
  const banner = $("network-status-banner");
  const iconOffline = $("status-icon-offline");
  const iconOnline = $("status-icon-online");
  const bannerText = $("status-banner-text");
  if (!banner || !iconOffline || !iconOnline || !bannerText) return;

  if (statusBannerTimer) clearTimeout(statusBannerTimer);

  if (!online) {
    banner.classList.remove("hidden", "online");
    banner.classList.add("offline");
    iconOffline.classList.remove("hidden");
    iconOnline.classList.add("hidden");
    bannerText.textContent = "Offline — changes saved locally";
  } else {
    banner.classList.remove("hidden", "offline");
    banner.classList.add("online");
    iconOffline.classList.add("hidden");
    iconOnline.classList.remove("hidden");
    bannerText.textContent = "Connection restored — synced!";

    statusBannerTimer = setTimeout(() => {
      banner.classList.add("hidden");
    }, 3500);
  }
}

async function handleNetworkStateChange(online) {
  if (lastKnownOnlineState === online) return;

  const previousState = lastKnownOnlineState;
  lastKnownOnlineState = online;

  const authScreenEl = $("auth-screen");
  const isAuthScreenVisible = authScreenEl && !authScreenEl.classList.contains("hidden");

  if (!online) {
    if (isAuthScreenVisible) {
      showToast("No internet connection — connect to log in or continue as Guest");
      if ($("auth-error")) {
        $("auth-error").textContent = "Offline. Connect to the internet or continue as Guest.";
      }
    } else {
      updateRealtimeNetworkBanner(false);
    }
  } else {
    if (previousState === false) {
      if (isAuthScreenVisible) {
        showToast("Internet connection restored!");
        if ($("auth-error") && $("auth-error").textContent.includes("Offline")) {
          $("auth-error").textContent = "";
        }
      } else {
        updateRealtimeNetworkBanner(true);
        const autoSyncEnabled = safeGet(cacheKey("auto-sync")) !== "false";
        if (autoSyncEnabled) syncCloudData(false);
      }
    }
  }
}

async function monitorBackgroundNetwork() {
  if (isCheckingNetwork) return;
  isCheckingNetwork = true;
  try {
    const online = await checkNetworkConnection();
    await handleNetworkStateChange(online);
  } catch (e) {
    // ignore
  } finally {
    isCheckingNetwork = false;
  }
}

window.addEventListener("online", () => monitorBackgroundNetwork());
window.addEventListener("offline", () => handleNetworkStateChange(false));
window.addEventListener("focus", () => monitorBackgroundNetwork());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    monitorBackgroundNetwork();
  }
});

if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Network) {
  try {
    window.Capacitor.Plugins.Network.addListener("networkStatusChange", () => monitorBackgroundNetwork());
  } catch (e) {}
}

setInterval(() => monitorBackgroundNetwork(), 10000);

function showNetworkModal(message, onRetry, onCancel) {
  const modal = $("network-modal");
  const msg = $("network-modal-msg");
  if (msg && message) msg.textContent = message;
  pendingNetworkAction = { onRetry, onCancel };
  modal.classList.remove("hidden");
}

function hideNetworkModal() {
  $("network-modal").classList.add("hidden");
  pendingNetworkAction = null;
}

$("retry-network").addEventListener("click", async () => {
  showToast("Checking connection...");
  const online = await checkNetworkConnection();
  if (online) {
    const action = pendingNetworkAction;
    hideNetworkModal();
    showToast("Connected!");
    if (action && typeof action.onRetry === "function") {
      action.onRetry();
    }
  } else {
    showToast("Still offline. Please check your connection and try again.");
  }
});

$("cancel-network").addEventListener("click", () => {
  const action = pendingNetworkAction;
  hideNetworkModal();
  if (action && typeof action.onCancel === "function") {
    action.onCancel();
  }
});

// ---------- Sync Manager ----------
async function syncEmailAcrossFirestore(userUid, newEmail, usernameHint = null) {
  if (!userUid || !newEmail) return;
  const emailLower = newEmail.toLowerCase();

  try {
    await setDoc(doc(db, "users", userUid), { email: emailLower }, { merge: true });
  } catch (e) {
    console.error("Error updating email in users doc:", e);
  }

  let username = usernameHint || safeGet(`budgelist-user-${userUid}-username`);
  if (!username) {
    try {
      const userDoc = await getDoc(doc(db, "users", userUid));
      if (userDoc.exists() && userDoc.data().username) {
        username = userDoc.data().username;
        safeSet(`budgelist-user-${userUid}-username`, username);
      }
    } catch (e) {
      console.error("Error fetching user doc for username:", e);
    }
  }

  if (username) {
    const usernameLower = username.toLowerCase();
    try {
      await setDoc(doc(db, "usernames", usernameLower), {
        uid: userUid,
        email: emailLower,
        username: username,
      }, { merge: true });
    } catch (e) {
      console.error("Error updating usernames mapping doc:", e);
    }
  }
}

async function syncCloudData(showToastFeedback = false) {
  if (isGuest || !uid || isSyncing) return;
  const online = await checkNetworkConnection();
  if (!online) {
    if (showToastFeedback) showToast("Offline — changes saved locally.");
    return;
  }

  isSyncing = true;
  const syncBtn = $("sync-btn");
  if (syncBtn) syncBtn.classList.add("spinning");
  if (showToastFeedback) showToast("Syncing with cloud...");

  try {
    loadSyncQueue();
    if (syncQueue.length > 0) {
      const currentQueue = [...syncQueue];
      syncQueue = [];
      saveSyncQueue();

      for (const item of currentQueue) {
        try {
          if (item.type === "ADD_EXPENSE") {
            await setDoc(doc(db, "users", uid, "expenses", item.data.id), item.data, { merge: true });
          } else if (item.type === "UPDATE_EXPENSE") {
            await setDoc(doc(db, "users", uid, "expenses", item.id), item.data, { merge: true });
          } else if (item.type === "DELETE_EXPENSE") {
            await deleteDoc(doc(db, "users", uid, "expenses", item.id));
          } else if (item.type === "ADD_RECURRING") {
            await setDoc(doc(db, "users", uid, "recurring", item.data.id), item.data, { merge: true });
          } else if (item.type === "UPDATE_RECURRING") {
            await setDoc(doc(db, "users", uid, "recurring", item.id), item.data, { merge: true });
          } else if (item.type === "DELETE_RECURRING") {
            await deleteDoc(doc(db, "users", uid, "recurring", item.id));
          } else if (item.type === "SET_BUDGET") {
            const budgetData = { monthlyBudget: item.amount };
            if (item.currencySymbol) budgetData.currencySymbol = item.currencySymbol;
            await setDoc(doc(db, "users", uid), budgetData, { merge: true });
          } else if (item.type === "SYNC_BUDGET_STATE") {
            await setDoc(doc(db, "users", uid), item.data, { merge: true });
          } else if (item.type === "UPDATE_PROFILE") {
            await setDoc(doc(db, "users", uid), item.data, { merge: true });
          } else if (item.type === "CONVERT_CURRENCY") {
            let batch = writeBatch(db);
            let opCount = 0;

            if (
              item.data.monthlyBudget !== undefined ||
              item.data.globalBudget !== undefined ||
              item.data.currencySymbol
            ) {
              const uData = {};
              if (item.data.monthlyBudget !== undefined) uData.monthlyBudget = item.data.monthlyBudget;
              if (item.data.globalBudget !== undefined) uData.globalBudget = item.data.globalBudget;
              if (item.data.monthBudgets !== undefined) uData.monthBudgets = item.data.monthBudgets;
              if (item.data.budgetHistory !== undefined) uData.budgetHistory = item.data.budgetHistory;
              if (item.data.currencySymbol) uData.currencySymbol = item.data.currencySymbol;
              batch.set(doc(db, "users", uid), uData, { merge: true });
              opCount++;
            }

            if (item.data.expenses && Array.isArray(item.data.expenses)) {
              for (const e of item.data.expenses) {
                if (e.id) {
                  batch.update(doc(db, "users", uid, "expenses", e.id), { amount: e.amount });
                  opCount++;
                  if (opCount >= 400) {
                    await batch.commit();
                    batch = writeBatch(db);
                    opCount = 0;
                  }
                }
              }
            }

            if (item.data.recurring && Array.isArray(item.data.recurring)) {
              for (const r of item.data.recurring) {
                if (r.id) {
                  batch.update(doc(db, "users", uid, "recurring", r.id), { amount: r.amount });
                  opCount++;
                  if (opCount >= 400) {
                    await batch.commit();
                    batch = writeBatch(db);
                    opCount = 0;
                  }
                }
              }
            }

            if (opCount > 0) {
              await batch.commit();
            }
          }
        } catch (e) {
          syncQueue.push(item);
          saveSyncQueue();
        }
      }
    }

    const userDocSnap = await getDoc(doc(db, "users", uid));
    const authUser = auth.currentUser;
    const currentAuthEmail = authUser && authUser.email ? authUser.email.toLowerCase() : null;

    if (userDocSnap.exists()) {
      const uData = userDocSnap.data();
      monthlyBudget = uData.monthlyBudget || 0;

      if (uData.budgetMigratedV2) {
        globalBudget = round2(uData.globalBudget || 0);
        monthBudgets = uData.monthBudgets && typeof uData.monthBudgets === "object" ? uData.monthBudgets : {};
        budgetHistory = Array.isArray(uData.budgetHistory) ? uData.budgetHistory : [];
        safeSet(cacheKey("budget-v2-migrated"), "true");
      } else {
        if (monthlyBudget > 0 && globalBudget === 0) {
          globalBudget = round2(monthlyBudget);
          if (budgetHistory.length === 0) {
            budgetHistory.unshift({
              id: "mig_cloud_" + Date.now(),
              amount: globalBudget,
              description: "Initial migrated budget",
              createdAt: Date.now(),
              type: "deposit",
            });
          }
        }
        safeSet(cacheKey("budget-v2-migrated"), "true");
        await setDoc(
          doc(db, "users", uid),
          {
            globalBudget: round2(globalBudget),
            monthBudgets: monthBudgets || {},
            budgetHistory: budgetHistory || [],
            budgetMigratedV2: true,
          },
          { merge: true }
        );
      }

      // Restore currency symbol from Firestore
      if (uData.currencySymbol) {
        currencySymbol = uData.currencySymbol;
        safeSet("budgelist-currency-symbol", currencySymbol);
        updateCurrencyUI();
      }

      // Restore avatar
      const currentAvatar = uData.avatar || (authUser && authUser.photoURL) || safeGet(cacheKey("avatar")) || "🦊";
      safeSet(cacheKey("avatar"), currentAvatar);

      // Restore display name
      const currentName = uData.name || (authUser && authUser.displayName) || safeGet(cacheKey("name")) || uData.username || "";
      if (currentName) safeSet(cacheKey("name"), currentName);

      // Restore username locally
      const usernameVal = uData.username || safeGet(`budgelist-user-${uid}-username`);
      if (usernameVal) {
        safeSet(`budgelist-user-${uid}-username`, usernameVal);
      }

      // Check if missing profile data in Firestore and update
      const updates = {};
      if (!uData.avatar && currentAvatar) updates.avatar = currentAvatar;
      if (!uData.name && currentName) updates.name = currentName;
      if (!uData.username && usernameVal) updates.username = usernameVal;
      if (!uData.email && currentAuthEmail) updates.email = currentAuthEmail;

      if (Object.keys(updates).length > 0) {
        await setDoc(doc(db, "users", uid), updates, { merge: true });
      }

      // Sync Auth profile object
      if (authUser && (authUser.photoURL !== currentAvatar || authUser.displayName !== currentName)) {
        try {
          await updateProfile(authUser, { photoURL: currentAvatar, displayName: currentName });
        } catch (e) {}
      }

      // Sync Firestore user doc & username mapping if Auth email changed (e.g. after email verification)
      if (currentAuthEmail && uData.email && uData.email.toLowerCase() !== currentAuthEmail) {
        await syncEmailAcrossFirestore(uid, currentAuthEmail, usernameVal);
      }
    } else {
      // Create user doc if missing
      const cachedAvatar = safeGet(cacheKey("avatar")) || (authUser && authUser.photoURL) || "🦊";
      const cachedName = safeGet(cacheKey("name")) || (authUser && authUser.displayName) || "";
      const cachedUsername = safeGet(`budgelist-user-${uid}-username`);

      const initialDoc = {
        email: currentAuthEmail,
        avatar: cachedAvatar,
        name: cachedName,
      };
      if (cachedUsername) initialDoc.username = cachedUsername;

      await setDoc(doc(db, "users", uid), initialDoc, { merge: true });
      safeSet(cacheKey("avatar"), cachedAvatar);
      if (cachedName) safeSet(cacheKey("name"), cachedName);
    }

    const expQuery = query(collection(db, "users", uid, "expenses"), orderBy("dateISO", "desc"));
    const expSnap = await getDocs(expQuery);
    expenses = expSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    const recQuery = query(collection(db, "users", uid, "recurring"), orderBy("dayOfMonth", "asc"));
    const recSnap = await getDocs(recQuery);
    recurring = recSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    settleElapsedMonths(true);
    saveLocalUserCache();
    applyRecurringForThisMonth();
    renderRecurring();
    render();
    updateProfileWidgetUI();

    if (showToastFeedback) showToast("Synced with cloud!");
  } catch (e) {
    if (showToastFeedback) showToast("Sync failed. Local data preserved.");
  } finally {
    if (syncBtn) syncBtn.classList.remove("spinning");
    isSyncing = false;
  }
}

$("sync-btn").addEventListener("click", () => syncCloudData(true));

// ---------- Profile & Settings Sheet ----------
function updateProfileWidgetUI() {
  const av = safeGet(cacheKey("avatar")) || "🦊";
  const name = safeGet(cacheKey("name")) || (isGuest ? "Guest" : (auth.currentUser && auth.currentUser.email ? auth.currentUser.email.split("@")[0] : "My Budget"));
  if ($("profile-widget-avatar")) $("profile-widget-avatar").textContent = av;
  if ($("profile-widget-name")) $("profile-widget-name").textContent = name;
  if ($("settings-avatar-preview")) $("settings-avatar-preview").textContent = av;

  // Hide sync button and sync settings for Guest mode
  const syncBtn = $("sync-btn");
  if (syncBtn) {
    syncBtn.classList.toggle("hidden", isGuest);
  }
  const syncAccordion = $("settings-sync-accordion");
  if (syncAccordion) {
    syncAccordion.classList.toggle("hidden", isGuest);
  }
}

function openSettingsSheet() {
  updateProfileWidgetUI();
  updateAboutChannelBadge();
  updateCurrencyUI();
  const savedName = safeGet(cacheKey("name")) || "";
  const autoSyncVal = safeGet(cacheKey("auto-sync")) !== "false";

  $("settings-name").value = savedName;
  $("settings-email").value = isGuest ? "Guest account" : (auth.currentUser ? auth.currentUser.email : "");

  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  $("settings-dark-toggle").checked = isDark;
  const activeColorTheme = document.documentElement.getAttribute("data-color-theme") || safeGet("budgelist-color-theme") || "violet";
  document.querySelectorAll(".theme-swatch-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.colorTheme === activeColorTheme);
  });
  $("settings-auto-sync-toggle").checked = autoSyncVal;

  $("settings-sheet").classList.remove("hidden");
}

function closeSettingsSheet() {
  $("settings-sheet").classList.add("hidden");
}

$("settings-btn").addEventListener("click", openSettingsSheet);
$("close-settings-btn").addEventListener("click", closeSettingsSheet);

// Profile Widget opens Settings
$("profile-widget").addEventListener("click", () => {
  openSettingsSheet();
  const profileItem = document.querySelector(".accordion-item");
  if (profileItem) {
    document.querySelectorAll(".accordion-item").forEach(i => i.classList.remove("active"));
    profileItem.classList.add("active");
  }
});

// Avatar Picker Modal
const avatarModal = $("avatar-modal");
$("open-avatar-modal-btn").addEventListener("click", () => avatarModal.classList.remove("hidden"));
$("close-avatar-modal").addEventListener("click", () => avatarModal.classList.add("hidden"));

document.querySelectorAll(".avatar-cell").forEach(cell => {
  cell.addEventListener("click", async () => {
    document.querySelectorAll(".avatar-cell").forEach(c => c.classList.remove("active"));
    cell.classList.add("active");
    const av = cell.dataset.avatar;
    safeSet(cacheKey("avatar"), av);
    updateProfileWidgetUI();
    avatarModal.classList.add("hidden");
    showToast(`Avatar updated to ${av}`);

    if (!isGuest && uid) {
      if (auth.currentUser) {
        try { await updateProfile(auth.currentUser, { photoURL: av }); } catch (e) {}
      }
      try {
        await setDoc(doc(db, "users", uid), { avatar: av }, { merge: true });
      } catch (e) {
        syncQueue.push({ type: "UPDATE_PROFILE", data: { avatar: av } });
        saveSyncQueue();
      }
    }
  });
});

$("settings-name").addEventListener("change", async (e) => {
  const nameVal = e.target.value.trim();
  safeSet(cacheKey("name"), nameVal);
  updateProfileWidgetUI();
  showToast("Name saved");

  if (!isGuest && uid) {
    if (auth.currentUser) {
      try { await updateProfile(auth.currentUser, { displayName: nameVal }); } catch (e) {}
    }
    try {
      await setDoc(doc(db, "users", uid), { name: nameVal }, { merge: true });
    } catch (e) {
      syncQueue.push({ type: "UPDATE_PROFILE", data: { name: nameVal } });
      saveSyncQueue();
    }
  }
});

// Password Modal
const passwordModal = $("password-modal");
$("change-password-btn").addEventListener("click", () => {
  if (isGuest) {
    showToast("Password change unavailable in Guest mode.");
    return;
  }
  $("password-form").reset();
  $("password-error").textContent = "";
  passwordModal.classList.remove("hidden");
});
$("cancel-password").addEventListener("click", () => passwordModal.classList.add("hidden"));

$("password-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("password-error").textContent = "";
  const oldPass = $("old-password").value;
  const newPass = $("new-password").value;

  try {
    const user = auth.currentUser;
    if (!user || !user.email) return;
    const credential = EmailAuthProvider.credential(user.email, oldPass);
    await reauthenticateWithCredential(user, credential);
    await updatePassword(user, newPass);
    passwordModal.classList.add("hidden");
    showToast("Password updated successfully!");
  } catch (err) {
    $("password-error").textContent = humanAuthError(err.code) || "Incorrect current password.";
  }
});

$("forgot-password-link").addEventListener("click", async () => {
  const user = auth.currentUser;
  if (!user || !user.email) {
    showToast("No email associated with current session.");
    return;
  }
  try {
    await sendPasswordResetEmail(auth, user.email);
    showToast(`Password reset email sent to ${user.email}`);
    passwordModal.classList.add("hidden");
  } catch (e) {
    showToast("Could not send password reset email.");
  }
});

let isUpdatingEmail = false;
let isRecoveringSession = false;
let emailCheckInterval = null;

async function attemptSilentSessionRecovery() {
  if (isRecoveringSession) return false;
  isRecoveringSession = true;

  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith("budgelist-pending-email-change-")) {
        localStorage.removeItem(k);
      }
    }
  } catch (err) {
    console.error("Error cleaning up pending email state:", err);
  } finally {
    isRecoveringSession = false;
  }

  return false;
}

function startCheckingEmailVerification(targetEmail) {
  if (emailCheckInterval) clearInterval(emailCheckInterval);
  let checks = 0;
  emailCheckInterval = setInterval(async () => {
    checks++;
    if (checks > 30 || !auth.currentUser) {
      clearInterval(emailCheckInterval);
      emailCheckInterval = null;
      return;
    }
    try {
      await auth.currentUser.reload();
      if (auth.currentUser.email && auth.currentUser.email.toLowerCase() === targetEmail.toLowerCase()) {
        clearInterval(emailCheckInterval);
        emailCheckInterval = null;

        await syncEmailAcrossFirestore(auth.currentUser.uid, targetEmail);
        if ($("settings-email")) $("settings-email").value = auth.currentUser.email;
        updateProfileWidgetUI();
        showToast("Email update verified and updated!");
      }
    } catch (e) {}
  }, 5000);
}

window.addEventListener("focus", async () => {
  if (auth.currentUser) {
    try {
      await auth.currentUser.reload();
      const currentAuthEmail = auth.currentUser.email;
      if (currentAuthEmail && $("settings-email") && $("settings-email").value && $("settings-email").value.toLowerCase() !== currentAuthEmail.toLowerCase()) {
        await syncEmailAcrossFirestore(auth.currentUser.uid, currentAuthEmail);
        $("settings-email").value = currentAuthEmail;
        updateProfileWidgetUI();
        showToast("Email updated successfully!");
      }
    } catch (e) {}
  } else {
    await attemptSilentSessionRecovery();
  }
});

// Email Modal
const emailModal = $("email-modal");
$("change-email-btn").addEventListener("click", () => {
  if (isGuest) {
    showToast("Email change unavailable in Guest mode.");
    return;
  }
  $("email-form").reset();
  $("email-error").textContent = "";
  $("new-email").value = auth.currentUser ? auth.currentUser.email : "";
  emailModal.classList.remove("hidden");
});
$("cancel-email").addEventListener("click", () => emailModal.classList.add("hidden"));

$("email-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("email-error").textContent = "";
  const newEmail = $("new-email").value.trim();
  const password = $("email-password").value;

  if (!newEmail || !newEmail.includes("@")) {
    $("email-error").textContent = "Please enter a valid email address.";
    return;
  }

  const user = auth.currentUser;
  if (!user || !user.email) return;

  if (user.email.toLowerCase() === newEmail.toLowerCase()) {
    showToast("New email is the same as current email.");
    emailModal.classList.add("hidden");
    return;
  }

  isUpdatingEmail = true;

  const pendingKey = `budgelist-pending-email-change-${user.uid}`;
  safeSet(pendingKey, JSON.stringify({
    oldEmail: user.email.toLowerCase(),
    newEmail: newEmail.toLowerCase(),
    uid: user.uid,
    timestamp: Date.now()
  }));

  try {
    const credential = EmailAuthProvider.credential(user.email, password);
    await reauthenticateWithCredential(user, credential);

    const oldUid = user.uid;
    let updatedDirectly = false;

    try {
      await updateEmail(user, newEmail);
      updatedDirectly = true;
    } catch (err) {
      if (err.code === "auth/operation-not-allowed" || err.code === "auth/email-change-needs-verification") {
        await verifyBeforeUpdateEmail(user, newEmail);
        await syncEmailAcrossFirestore(oldUid, newEmail);
        emailModal.classList.add("hidden");
        showToast(`Verification link sent to ${newEmail}. Click it to finalize email change.`);
        startCheckingEmailVerification(newEmail);
        return;
      } else {
        throw err;
      }
    }

    if (updatedDirectly) {
      try {
        await signInWithEmailAndPassword(auth, newEmail.toLowerCase(), password);
        localStorage.removeItem(pendingKey);
      } catch (signInErr) {
        console.warn("Re-login failed after updateEmail, trying recovery:", signInErr);
        await attemptSilentSessionRecovery();
      }

      const activeUser = auth.currentUser || user;
      const activeUid = activeUser ? activeUser.uid : oldUid;

      await syncEmailAcrossFirestore(activeUid, newEmail);

      if ($("settings-email")) $("settings-email").value = newEmail;
      updateProfileWidgetUI();
      emailModal.classList.add("hidden");
      showToast("Email updated successfully!");
    }
  } catch (err) {
    console.error("Email update error:", err);
    $("email-error").textContent = humanAuthError(err.code) || err.message || "Could not update email.";
  } finally {
    isUpdatingEmail = false;
  }
});

// Currency Modal
const currencyModal = $("currency-modal");
const currencyMenuView = $("currency-menu-view");
const currencyChangeView = $("currency-change-view");
const currencyConvertView = $("currency-convert-view");

const CURRENCY_MAP = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  PHP: "₱",
  AUD: "A$",
  CAD: "C$",
  INR: "₹",
  BRL: "R$",
  CHF: "Fr"
};

const SYMBOL_TO_CODE = {
  "$": "USD",
  "€": "EUR",
  "£": "GBP",
  "¥": "JPY",
  "₱": "PHP",
  "A$": "AUD",
  "C$": "CAD",
  "₹": "INR",
  "R$": "BRL",
  "Fr": "CHF"
};

function getCurrentCurrencyCode() {
  if (SYMBOL_TO_CODE[currencySymbol]) {
    return SYMBOL_TO_CODE[currencySymbol];
  }
  if (CURRENCY_MAP[currencySymbol]) {
    return currencySymbol;
  }
  return "USD";
}

function getCurrencyDisplayLabel() {
  const code = getCurrentCurrencyCode();
  return currencySymbol === code ? code : `${code} (${currencySymbol})`;
}

function updateCurrencyUI() {
  const label = getCurrencyDisplayLabel();
  const settingsBadge = $("settings-active-currency-badge");
  if (settingsBadge) settingsBadge.textContent = label;
  const globalBtnLabel = $("global-currency-btn-label");
  if (globalBtnLabel) globalBtnLabel.textContent = label;
  const sel = $("currency-select");
  if (sel) {
    sel.value = currencySymbol;
    syncCustomSelect(sel);
  }
}

let currencyOpenedDirectly = false;

function openCurrencyMenuModal() {
  currencyOpenedDirectly = false;
  currencyMenuView.classList.remove("hidden");
  currencyChangeView.classList.add("hidden");
  currencyConvertView.classList.add("hidden");
  $("currency-modal-title").textContent = "Currency Options";
  currencyModal.classList.remove("hidden");
}

function openCurrencyChangeModal(direct = false) {
  currencyOpenedDirectly = Boolean(direct);
  currencyMenuView.classList.add("hidden");
  currencyConvertView.classList.add("hidden");
  currencyChangeView.classList.remove("hidden");
  $("currency-modal-title").textContent = "Change Currency Symbol";
  const backBtn = $("back-currency-menu");
  if (backBtn) backBtn.textContent = currencyOpenedDirectly ? "Cancel" : "Back";
  const sel = $("currency-select");
  if (sel) {
    sel.value = currencySymbol;
    syncCustomSelect(sel);
  }
  currencyModal.classList.remove("hidden");
}

function openCurrencyConvertModal(direct = false) {
  currencyOpenedDirectly = Boolean(direct);
  currencyMenuView.classList.add("hidden");
  currencyChangeView.classList.add("hidden");
  currencyConvertView.classList.remove("hidden");
  $("currency-modal-title").textContent = "Convert Currency";
  const backBtn2 = $("back-currency-menu-2");
  if (backBtn2) backBtn2.textContent = currencyOpenedDirectly ? "Cancel" : "Back";

  const currentCode = getCurrentCurrencyCode();
  const convertStatus = $("convert-status");
  if (convertStatus) {
    convertStatus.innerHTML = `Active currency: <strong>${escapeHtml(currentCode)} (${escapeHtml(currencySymbol)})</strong>. Select target currency to recalculate all budgets, bills, and expenses using live exchange rates:`;
  }
  currencyModal.classList.remove("hidden");
}

function handleCurrencySubViewBack() {
  if (currencyOpenedDirectly) {
    currencyModal.classList.add("hidden");
    currencyOpenedDirectly = false;
    return;
  }
  currencyChangeView.classList.add("hidden");
  currencyConvertView.classList.add("hidden");
  currencyMenuView.classList.remove("hidden");
  $("currency-modal-title").textContent = "Currency Options";
}

if ($("currency-btn")) {
  $("currency-btn").addEventListener("click", openCurrencyMenuModal);
}
if ($("settings-change-currency-btn")) {
  $("settings-change-currency-btn").addEventListener("click", () => openCurrencyChangeModal(true));
}
if ($("settings-convert-currency-btn")) {
  $("settings-convert-currency-btn").addEventListener("click", () => openCurrencyConvertModal(true));
}

$("close-currency-modal").addEventListener("click", () => currencyModal.classList.add("hidden"));
$("back-currency-menu").addEventListener("click", handleCurrencySubViewBack);
$("back-currency-menu-2").addEventListener("click", handleCurrencySubViewBack);

$("menu-change-currency").addEventListener("click", () => openCurrencyChangeModal(false));
$("menu-convert-currency").addEventListener("click", () => openCurrencyConvertModal(false));

$("save-currency-btn").addEventListener("click", () => {
  currencySymbol = $("currency-select").value;
  safeSet("budgelist-currency-symbol", currencySymbol);
  updateCurrencyUI();
  enqueueSync({ type: "UPDATE_PROFILE", data: { currencySymbol } });
  currencyModal.classList.add("hidden");
  render();
  renderRecurring();
  showToast(`Currency symbol updated to ${currencySymbol}`);
});

updateCurrencyUI();

$("execute-convert-btn").addEventListener("click", () => {
  const target = $("convert-target-select").value;
  convertCurrencyTo(target);
});

async function convertCurrencyTo(targetCurrency) {
  const fromCode = getCurrentCurrencyCode();
  const fromSymbol = currencySymbol;

  if (fromCode === targetCurrency) {
    showToast(`Currency is already set to ${targetCurrency} (${currencySymbol})`);
    return;
  }

  showToast(`Fetching exchange rates for ${fromCode} → ${targetCurrency}...`);
  const online = await checkNetworkConnection();
  if (!online) {
    showToast("Offline. Cannot fetch live exchange rates.");
    return;
  }

  try {
    let rate = null;

    // 1. Try direct base rate API
    try {
      const res = await fetch(`https://api.exchangerate-api.com/v4/latest/${fromCode}`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.rates && data.rates[targetCurrency]) {
          rate = data.rates[targetCurrency];
        }
      }
    } catch (e) {
      // ignore, fallback
    }

    // 2. Fallback to USD base rate
    if (!rate) {
      const resFallback = await fetch("https://api.exchangerate-api.com/v4/latest/USD");
      if (!resFallback.ok) throw new Error("API error");
      const dataFallback = await resFallback.json();
      const rates = dataFallback.rates;

      const fromRate = fromCode === "USD" ? 1.0 : rates[fromCode];
      const targetRate = targetCurrency === "USD" ? 1.0 : rates[targetCurrency];

      if (!fromRate || !targetRate) throw new Error("Currency rate not found");
      rate = targetRate / fromRate;
    }

    monthlyBudget = round2(monthlyBudget * rate);
    globalBudget = round2(globalBudget * rate);
    if (monthBudgets && typeof monthBudgets === "object") {
      Object.keys(monthBudgets).forEach((ym) => {
        const mb = monthBudgets[ym];
        if (!mb || typeof mb !== "object") return;
        if (mb.allocated != null) mb.allocated = round2(mb.allocated * rate);
        if (mb.directCovered != null) mb.directCovered = round2(mb.directCovered * rate);
        if (mb.unrestrictedDeducted != null) mb.unrestrictedDeducted = round2(mb.unrestrictedDeducted * rate);
        if (mb.finalSpent != null) mb.finalSpent = round2(mb.finalSpent * rate);
        if (mb.finalAllocated != null) mb.finalAllocated = round2(mb.finalAllocated * rate);
        if (mb.returnedToGlobal != null) mb.returnedToGlobal = round2(mb.returnedToGlobal * rate);
      });
    }
    if (Array.isArray(budgetHistory)) {
      budgetHistory.forEach((h) => {
        if (h && h.amount != null) h.amount = round2(h.amount * rate);
      });
    }
    expenses.forEach(e => {
      e.amount = round2(e.amount * rate);
    });
    recurring.forEach(r => {
      r.amount = round2(r.amount * rate);
    });

    const targetSymbol = CURRENCY_MAP[targetCurrency] || targetCurrency;
    currencySymbol = targetSymbol;
    safeSet("budgelist-currency-symbol", currencySymbol);
    updateCurrencyUI();

    saveLocalUserCache();

    // Enqueue sync mutation to save converted amounts & currencySymbol to Firestore
    enqueueSync({
      type: "CONVERT_CURRENCY",
      data: {
        currencySymbol: currencySymbol,
        monthlyBudget: monthlyBudget,
        globalBudget: globalBudget,
        monthBudgets: monthBudgets,
        budgetHistory: budgetHistory,
        expenses: expenses.map(e => ({ id: e.id, amount: e.amount })),
        recurring: recurring.map(r => ({ id: r.id, amount: r.amount }))
      }
    });

    render();
    renderRecurring();
    currencyModal.classList.add("hidden");
    showToast(`Converted ${fromCode} (${fromSymbol}) → ${targetCurrency} (${currencySymbol})!`);
  } catch (e) {
    showToast("Exchange rate service unavailable. Try again later.");
  }
}

$("settings-dark-toggle").addEventListener("change", (e) => {
  const nextTheme = e.target.checked ? "dark" : "light";
  applyTheme(nextTheme);
  render();
});

document.querySelectorAll(".theme-swatch-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const selected = btn.dataset.colorTheme || "violet";
    applyColorTheme(selected);
    render();
  });
});

$("settings-auto-sync-toggle").addEventListener("change", (e) => {
  safeSet(cacheKey("auto-sync"), String(e.target.checked));
  showToast(e.target.checked ? "Auto sync enabled" : "Manual sync enabled");
});

$("export-csv-btn").addEventListener("click", () => {
  exportCsvData();
});

// Accordion collapse/expand logic
document.querySelectorAll(".accordion-header").forEach((header) => {
  header.addEventListener("click", () => {
    const item = header.closest(".accordion-item");
    if (!item) return;
    const isActive = item.classList.contains("active");
    document.querySelectorAll(".accordion-item").forEach((i) => i.classList.remove("active"));
    if (!isActive) item.classList.add("active");
  });
});

const APP_VERSION = "0.2.1-beta";

function detectNativeApkVersion() {
  try {
    if (
      window.AndroidBridge &&
      typeof window.AndroidBridge.getNativeBuildSignature === "function"
    ) {
      const sig = window.AndroidBridge.getNativeBuildSignature();
      if (sig && typeof sig === "string") {
        // Signature format in v0.2.1+: "v<versionName>_<lastUpdateTime>"
        return sig.split("_")[0].replace(/^v/i, "").trim() || APP_VERSION;
      }
    }
  } catch (e) {}

  // Legacy native APKs (v0.1.0-beta through v0.2.0-beta) stored their static NATIVE_BUILD_KEY
  // in localStorage["budgelist-native-build-key"] inside their built-in <head> script.
  const storedBuildKey = safeGet("budgelist-native-build-key");
  if (storedBuildKey && typeof storedBuildKey === "string") {
    const parsed = storedBuildKey.split("_")[0].replace(/^v/i, "").trim();
    if (parsed) return parsed;
  }

  return APP_VERSION;
}

const NATIVE_APP_VERSION = detectNativeApkVersion();
const GITHUB_REPO = "kuraku01/budgelist";
let updateDownloadUrl = `https://github.com/${GITHUB_REPO}/releases`;
let currentLatestTag = "";
let pendingStartupUpdate = null;

function sanitizeGitHubReleaseUrl(rawUrl, requireAssetDownload = false) {
  if (!rawUrl || typeof rawUrl !== "string") return "";
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== "https:") return "";
    if (parsed.hostname.toLowerCase() !== "github.com") return "";
    const lowerPath = parsed.pathname.toLowerCase();
    const repoPrefix = `/${GITHUB_REPO.toLowerCase()}/releases`;
    if (requireAssetDownload) {
      if (!lowerPath.startsWith(`${repoPrefix}/download/`)) return "";
    } else if (lowerPath !== repoPrefix && !lowerPath.startsWith(`${repoPrefix}/`)) {
      return "";
    }
    return parsed.href;
  } catch (e) {
    return "";
  }
}

function openExternalReleaseUrl(rawUrl) {
  const fallbackUrl = `https://github.com/${GITHUB_REPO}/releases`;
  const safeUrl = sanitizeGitHubReleaseUrl(rawUrl, false) || fallbackUrl;
  const win = window.open(safeUrl, "_blank", "noopener,noreferrer");
  if (win) {
    try {
      win.opener = null;
    } catch (e) {}
  }
}

function formatVersionTag(tag) {
  if (!tag) return `v${APP_VERSION.replace(/^v/i, "")}`;
  return tag.startsWith("v") ? tag : `v${tag}`;
}

function formatAssetSize(bytes) {
  const num = Number(bytes) || 0;
  if (num <= 0) return "";
  if (num >= 1024 * 1024) return `${(num / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(num / 1024))} KB`;
}

function formatAssetTimestamp(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    " " +
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function formatAssetMeta(asset) {
  if (!asset) return "Unavailable";
  const parts = [];
  const sizeStr = formatAssetSize(asset.size);
  const timeStr = formatAssetTimestamp(asset.updated_at || asset.created_at);
  if (sizeStr) parts.push(sizeStr);
  if (timeStr) parts.push(`Updated ${timeStr}`);
  return parts.join(" • ") || asset.name || "Available";
}

function updateAboutChannelBadge() {
  const badge = $("about-package-channel-badge");
  const verBadge = $("about-version-badge") || document.querySelector(".about-brand-row .version-badge");
  const verNote = $("about-version-note");
  if (!badge) return;
  const installedKey = safeGet("budgelist-installed-bundle-key");
  const hasBundleJs = Boolean(safeGet("budgelist-bundle-app-js"));
  const channel = safeGet("budgelist-installed-bundle-channel") || "stable";
  const hasNativeBridgeSig = Boolean(
    window.AndroidBridge && typeof window.AndroidBridge.getNativeBuildSignature === "function"
  );
  // Also detect if an older APK (which didn't have getNativeBuildSignature or channel keys) installed an OTA bundle
  const isOtaActive = Boolean((installedKey && hasBundleJs) || (hasBundleJs && !hasNativeBridgeSig));

  if (isOtaActive) {
    if (channel === "unstable") {
      badge.textContent = "Testing Build";
      badge.className = "channel-badge unstable";
    } else {
      badge.textContent = "Live Update";
      badge.className = "channel-badge stable";
    }
    if (verBadge) {
      verBadge.textContent = formatVersionTag(APP_VERSION);
    }
    if (verNote) {
      if (NATIVE_APP_VERSION !== APP_VERSION) {
        verNote.textContent = `Base Android app is on ${formatVersionTag(NATIVE_APP_VERSION)} — tap Check for updates to install the ${formatVersionTag(APP_VERSION)} app upgrade.`;
        verNote.classList.remove("hidden");
      } else {
        verNote.classList.add("hidden");
      }
    }
  } else {
    badge.textContent = "Built-in";
    badge.className = "channel-badge native";
    if (verBadge) {
      verBadge.textContent = formatVersionTag(NATIVE_APP_VERSION);
    }
    if (verNote) {
      verNote.classList.add("hidden");
    }
  }
}

updateAboutChannelBadge();

function parseSemver(v) {
  if (!v) return { numbers: [0, 0, 0], prerelease: "" };
  const cleaned = v.replace(/^v/i, "").trim();
  const parts = cleaned.split("-");
  const numbers = (parts[0] || "").split(".").map((n) => parseInt(n, 10) || 0);
  const prerelease = parts.slice(1).join("-");
  return { numbers, prerelease };
}

function isNewerVersion(latestTag, currentTag) {
  const l = parseSemver(latestTag);
  const c = parseSemver(currentTag);

  for (let i = 0; i < Math.max(l.numbers.length, c.numbers.length); i++) {
    const numL = l.numbers[i] || 0;
    const numC = c.numbers[i] || 0;
    if (numL > numC) return true;
    if (numL < numC) return false;
  }

  // Version numbers are identical (e.g., 0.1.0 vs 0.1.0-beta)
  // A version without a prerelease is newer than a version with a prerelease (0.1.0 > 0.1.0-beta)
  if (c.prerelease && !l.prerelease) return true;
  if (l.prerelease && !c.prerelease) return false;

  // Both have prerelease tags (e.g. beta2 vs beta)
  if (l.prerelease && c.prerelease) {
    return l.prerelease.localeCompare(c.prerelease, undefined, { numeric: true, sensitivity: "base" }) > 0;
  }

  return false;
}

function isSameOrNewerVersion(latestTag, currentTag) {
  if (isNewerVersion(latestTag, currentTag)) return true;
  const l = parseSemver(latestTag);
  const c = parseSemver(currentTag);
  const sameNumbers = l.numbers.join(".") === c.numbers.join(".");
  const samePrerelease = (l.prerelease || "") === (c.prerelease || "");
  return sameNumbers && samePrerelease;
}

function isMandatoryUpdate(latestTag, currentVersion, releaseBody = "") {
  const l = parseSemver(latestTag);
  const c = parseSemver(currentVersion);

  const latestMajor = l.numbers[0] || 0;
  const currentMajor = c.numbers[0] || 0;
  const latestMinor = l.numbers[1] || 0;
  const currentMinor = c.numbers[1] || 0;

  // Major version bump (e.g. v1.0.0 vs v0.1.0)
  if (latestMajor > currentMajor) return true;

  // Minor version bump in 0.x series (e.g. v0.1.0 vs v0.0.9)
  if (currentMajor === 0 && latestMinor > currentMinor) return true;

  // Explicit mandatory or breaking tag/body markers
  const lowerTag = (latestTag || "").toLowerCase();
  const lowerBody = (releaseBody || "").toLowerCase();
  if (lowerTag.includes("breaking") || lowerTag.includes("mandatory")) return true;
  if (lowerBody.includes("[mandatory]") || lowerBody.includes("[breaking]") || lowerBody.includes("breaking change")) return true;

  return false;
}

function inspectReleaseAssets(release) {
  const latestTag = (release?.tag_name || "").trim();
  const assets = Array.isArray(release?.assets) ? release.assets : [];

  const apkAsset =
    assets.find((a) => a.name && a.name.toLowerCase().endsWith(".apk")) || null;
  const unstableAsset =
    assets.find(
      (a) =>
        a.name &&
        a.name.toLowerCase().endsWith(".zip") &&
        a.name.toLowerCase().includes("unstable")
    ) || null;
  const stableAsset =
    assets.find(
      (a) =>
        a.name &&
        a.name.toLowerCase().endsWith(".zip") &&
        !a.name.toLowerCase().includes("unstable") &&
        (a.name === "dist.zip" ||
          a.name.includes("dist") ||
          a.name.includes("bundle") ||
          a.name.includes("web"))
    ) || null;

  const stableKey = stableAsset
    ? `${latestTag}_stable_${stableAsset.updated_at || stableAsset.id || stableAsset.size}`
    : "";
  const unstableKey = unstableAsset
    ? `${latestTag}_unstable_${unstableAsset.updated_at || unstableAsset.id || unstableAsset.size}`
    : "";

  const installedBundleKey = safeGet("budgelist-installed-bundle-key") || "";
  const installedBodyHtml = safeGet("budgelist-bundle-body-html") || "";
  const hasBundleJs = Boolean(safeGet("budgelist-bundle-app-js"));
  const hasNativeBridgeSig = Boolean(
    window.AndroidBridge && typeof window.AndroidBridge.getNativeBuildSignature === "function"
  );
  const hasInstalledBundle = Boolean(
    (installedBundleKey && hasBundleJs) || (hasBundleJs && !hasNativeBridgeSig)
  );
  const installedChannel = hasInstalledBundle
    ? safeGet("budgelist-installed-bundle-channel") || "stable"
    : "native";
  const installedBundleTime = safeGet("budgelist-installed-bundle-time") || "";

  // Compare against NATIVE_APP_VERSION so older APKs running a newer OTA bundle still see the Native APK update!
  const hasNativeUpdate = Boolean(latestTag && isNewerVersion(latestTag, NATIVE_APP_VERSION));
  const isCompatibleForOta = Boolean(latestTag && isSameOrNewerVersion(latestTag, NATIVE_APP_VERSION));

  const legacyStableKey = stableAsset
    ? `${latestTag}_${stableAsset.updated_at || stableAsset.id || stableAsset.size}`
    : "";

  const isStableInstalled = Boolean(
    hasInstalledBundle &&
      installedChannel === "stable" &&
      (installedBundleKey === stableKey ||
        installedBundleKey === legacyStableKey ||
        (!hasNativeBridgeSig && NATIVE_APP_VERSION !== APP_VERSION)) &&
      installedBodyHtml
  );

  const isUnstableInstalled = Boolean(
    hasInstalledBundle &&
      installedChannel === "unstable" &&
      installedBundleKey === unstableKey &&
      installedBodyHtml
  );

  let hasStableOtaUpdate = false;
  if (stableAsset && isCompatibleForOta && !isStableInstalled) {
    if (hasInstalledBundle) {
      if (installedChannel === "unstable") {
        // Only prompt an Unstable tester for Stable OTA if a newer Stable package was published after their Unstable bundle
        const stableTime = Date.parse(stableAsset.updated_at || "") || 0;
        const currentInstalledTime = Date.parse(installedBundleTime || "") || 0;
        hasStableOtaUpdate = stableTime > currentInstalledTime;
      } else {
        hasStableOtaUpdate = true;
      }
    } else {
      // Running built-in Native package: check if dist.zip was published after the initial release APK build
      const sameVersionAsNative =
        latestTag.replace(/^v/i, "") === NATIVE_APP_VERSION.replace(/^v/i, "");
      if (sameVersionAsNative && apkAsset && apkAsset.updated_at && stableAsset.updated_at) {
        const stableTime = Date.parse(stableAsset.updated_at) || 0;
        const apkTime = Date.parse(apkAsset.updated_at) || 0;
        hasStableOtaUpdate = stableTime > apkTime + 120000;
      } else {
        hasStableOtaUpdate = true;
      }
    }
  }

  return {
    release,
    latestTag,
    releaseUrl: release?.html_url || `https://github.com/${GITHUB_REPO}/releases`,
    apkAsset,
    stableAsset,
    unstableAsset,
    stableKey,
    unstableKey,
    hasInstalledBundle,
    installedChannel,
    hasNativeUpdate,
    isCompatibleForOta,
    isStableInstalled,
    isUnstableInstalled,
    hasStableOtaUpdate,
  };
}

const updateModal = $("update-modal");
const closeUpdateModalBtn = $("close-update-modal-btn");
const refreshUpdateModalBtn = $("refresh-update-modal-btn");
const manualCloseBtn = $("manual-close-btn");
const cancelUpdateBtn = $("cancel-update-btn");
const downloadUpdateBtn = $("download-update-btn");

let manualUpdateCheckController = null;
let manualUpdateCheckSeq = 0;

function closeUpdateModal() {
  if (manualUpdateCheckController) {
    manualUpdateCheckSeq++;
    try {
      manualUpdateCheckController.abort();
    } catch (e) {}
    manualUpdateCheckController = null;
  }
  if (refreshUpdateModalBtn) refreshUpdateModalBtn.classList.remove("spinning");
  const checkingBanner = $("update-checking-banner");
  if (checkingBanner) checkingBanner.classList.add("hidden");
  if (manualCloseBtn) manualCloseBtn.textContent = "Close";
  if (updateModal) updateModal.classList.add("hidden");
}

if (closeUpdateModalBtn) {
  closeUpdateModalBtn.addEventListener("click", closeUpdateModal);
}
if (manualCloseBtn) {
  manualCloseBtn.addEventListener("click", closeUpdateModal);
}
if (refreshUpdateModalBtn) {
  refreshUpdateModalBtn.addEventListener("click", () => {
    checkForAppUpdates(false, false);
  });
}

if (cancelUpdateBtn) {
  cancelUpdateBtn.addEventListener("click", () => {
    closeUpdateModal();
    if (!pendingStartupUpdate) return;
    if (pendingStartupUpdate.type === "native" && pendingStartupUpdate.latestTag) {
      safeSet("budgelist-skipped-update", pendingStartupUpdate.latestTag);
    } else if (pendingStartupUpdate.type === "stable-ota" && pendingStartupUpdate.bundleKey) {
      safeSet("budgelist-skipped-ota-key", pendingStartupUpdate.bundleKey);
    }
  });
}

if (downloadUpdateBtn) {
  downloadUpdateBtn.addEventListener("click", async () => {
    closeUpdateModal();
    if (!pendingStartupUpdate) {
      openExternalReleaseUrl(updateDownloadUrl);
      return;
    }
    if (pendingStartupUpdate.type === "stable-ota" && pendingStartupUpdate.asset) {
      await downloadAndApplyOtaAsset(
        pendingStartupUpdate.asset,
        pendingStartupUpdate.latestTag,
        "stable",
        pendingStartupUpdate.bundleKey
      );
    } else {
      openExternalReleaseUrl(pendingStartupUpdate.downloadUrl || updateDownloadUrl);
    }
  });
}

function showStartupUpdateModal(options) {
  pendingStartupUpdate = options;
  currentLatestTag = options.latestTag || "";

  const startupView = $("update-startup-view");
  const manualView = $("update-manual-view");
  const currentLabelEl = $("update-current-label");
  const latestLabelEl = $("update-latest-label");
  const currentVerEl = $("update-current-version");
  const latestVerEl = $("update-latest-version");
  const startupMetaEl = $("update-startup-meta");
  const modalTitle = $("update-modal-title");
  const modalMsg = $("update-modal-msg");
  const btnTextEl = $("download-update-btn-text");
  const extIconEl = $("download-update-ext-icon");

  if (startupView) startupView.classList.remove("hidden");
  if (manualView) manualView.classList.add("hidden");
  if (closeUpdateModalBtn) closeUpdateModalBtn.classList.add("hidden");
  if (refreshUpdateModalBtn) refreshUpdateModalBtn.classList.add("hidden");
  if ($("update-checking-banner")) $("update-checking-banner").classList.add("hidden");

  if (options.type === "stable-ota") {
    const installedChannel = safeGet("budgelist-installed-bundle-channel");
    const hasBundle = Boolean(safeGet("budgelist-installed-bundle-key") && safeGet("budgelist-bundle-app-js"));
    if (modalTitle) modalTitle.textContent = "In-App Update Available";
    if (modalMsg) {
      modalMsg.textContent =
        "A new stable in-app update is ready to install. Confirm to download and apply it now.";
    }
    if (currentLabelEl) currentLabelEl.textContent = "Current";
    if (latestLabelEl) latestLabelEl.textContent = "Update";
    if (currentVerEl) {
      currentVerEl.textContent = hasBundle
        ? installedChannel === "unstable"
          ? "Testing Build"
          : "Live Update"
        : formatVersionTag(NATIVE_APP_VERSION);
    }
    if (latestVerEl) latestVerEl.textContent = formatVersionTag(options.latestTag);
    if (startupMetaEl) {
      startupMetaEl.textContent = `Stable Update • ${formatAssetMeta(options.asset)}`;
      startupMetaEl.classList.remove("hidden");
    }
    if (btnTextEl) btnTextEl.textContent = "Confirm Update";
    if (extIconEl) extIconEl.classList.add("hidden");
    if (cancelUpdateBtn) cancelUpdateBtn.classList.remove("hidden");
  } else {
    if (currentLabelEl) currentLabelEl.textContent = "Installed App";
    if (latestLabelEl) latestLabelEl.textContent = "New App";
    if (currentVerEl) currentVerEl.textContent = formatVersionTag(NATIVE_APP_VERSION);
    if (latestVerEl) latestVerEl.textContent = formatVersionTag(options.latestTag);
    if (options.downloadUrl) updateDownloadUrl = options.downloadUrl;
    if (startupMetaEl) {
      if (options.asset) {
        startupMetaEl.textContent = `Android Installer • ${formatAssetMeta(options.asset)}`;
        startupMetaEl.classList.remove("hidden");
      } else {
        startupMetaEl.classList.add("hidden");
      }
    }
    if (btnTextEl) btnTextEl.textContent = "Download App";
    if (extIconEl) extIconEl.classList.remove("hidden");

    if (options.isForced) {
      if (modalTitle) modalTitle.textContent = "App Upgrade Required";
      if (modalMsg) {
        modalMsg.textContent =
          "A new version of the Android app is required to continue. Please download and install the update.";
      }
      if (cancelUpdateBtn) cancelUpdateBtn.classList.add("hidden");
    } else {
      if (modalTitle) modalTitle.textContent = "Android App Upgrade Available";
      if (modalMsg) {
        modalMsg.textContent =
          NATIVE_APP_VERSION !== APP_VERSION
            ? `You have the ${formatVersionTag(APP_VERSION)} live features, but your installed Android app is still on ${formatVersionTag(NATIVE_APP_VERSION)}. Download the latest app installer for system improvements like back-button navigation.`
            : "A newer version of the Budgelist Android app is available for download!";
      }
      if (cancelUpdateBtn) cancelUpdateBtn.classList.remove("hidden");
    }
  }

  if (updateModal) updateModal.classList.remove("hidden");
}

function showManualUpdateModal(info) {
  const startupView = $("update-startup-view");
  const manualView = $("update-manual-view");
  const modalTitle = $("update-modal-title");
  const modalMsg = $("update-modal-msg");

  if (startupView) startupView.classList.add("hidden");
  if (manualView) manualView.classList.remove("hidden");
  if ($("update-checking-banner")) $("update-checking-banner").classList.add("hidden");
  if (closeUpdateModalBtn) closeUpdateModalBtn.classList.remove("hidden");
  if (refreshUpdateModalBtn) {
    refreshUpdateModalBtn.classList.remove("hidden", "spinning");
  }
  if (manualCloseBtn) manualCloseBtn.textContent = "Close";

  const activeChannelLabel = info.hasInstalledBundle
    ? info.installedChannel === "unstable"
      ? "Testing Build"
      : "Live Update"
    : "Built-in";

  if (modalTitle) modalTitle.textContent = "Update Center";
  if (modalMsg) {
    modalMsg.textContent =
      NATIVE_APP_VERSION !== APP_VERSION
        ? `Current version: ${formatVersionTag(APP_VERSION)} (${activeChannelLabel}) • Base Android app: ${formatVersionTag(NATIVE_APP_VERSION)}`
        : `Current version: ${formatVersionTag(APP_VERSION)} (${activeChannelLabel})`;
  }

  // 1. Android App (Full Install) Row
  const nativeBadge = $("manual-native-badge");
  const nativeMeta = $("manual-native-meta");
  const nativeBtn = $("manual-native-btn");

  if (info.hasNativeUpdate) {
    if (nativeBadge) {
      nativeBadge.textContent = "Update Available";
      nativeBadge.className = "channel-badge stable";
    }
    if (nativeMeta) {
      nativeMeta.textContent = `${formatVersionTag(NATIVE_APP_VERSION)} → ${formatVersionTag(info.latestTag)}${
        info.apkAsset ? " • " + formatAssetMeta(info.apkAsset) : ""
      }`;
    }
    if (nativeBtn) {
      nativeBtn.classList.remove("hidden");
      nativeBtn.textContent = "Download";
      nativeBtn.onclick = () => {
        closeUpdateModal();
        openExternalReleaseUrl(info.apkAsset?.browser_download_url || info.releaseUrl);
      };
    }
  } else {
    if (nativeBadge) {
      nativeBadge.textContent = "Up to date";
      nativeBadge.className = "channel-badge installed";
    }
    if (nativeMeta) {
      nativeMeta.textContent = `Installed: ${formatVersionTag(NATIVE_APP_VERSION)} (Latest release)`;
    }
    if (nativeBtn) {
      nativeBtn.classList.add("hidden");
    }
  }

  // 2. Stable Update (In-App Package) Row
  const stableBadge = $("manual-stable-badge");
  const stableMeta = $("manual-stable-meta");
  const stableBtn = $("manual-stable-btn");

  if (!info.stableAsset) {
    if (stableBadge) {
      stableBadge.textContent = "Unavailable";
      stableBadge.className = "channel-badge native";
    }
    if (stableMeta) stableMeta.textContent = "No stable update package available";
    if (stableBtn) {
      stableBtn.disabled = true;
      stableBtn.className = "btn-ghost update-channel-btn";
      stableBtn.textContent = "None";
    }
  } else if (!info.isCompatibleForOta) {
    if (stableBadge) {
      stableBadge.textContent = "Requires App Update";
      stableBadge.className = "channel-badge native";
    }
    if (stableMeta) stableMeta.textContent = `Requires Android App ${formatVersionTag(info.latestTag)}`;
    if (stableBtn) {
      stableBtn.disabled = true;
      stableBtn.className = "btn-ghost update-channel-btn";
      stableBtn.textContent = "Incompatible";
    }
  } else if (info.isStableInstalled || (!info.hasInstalledBundle && !info.hasStableOtaUpdate)) {
    if (stableBadge) {
      stableBadge.textContent = info.isStableInstalled ? "Installed" : "Up to date";
      stableBadge.className = "channel-badge installed";
    }
    if (stableMeta) stableMeta.textContent = formatAssetMeta(info.stableAsset);
    if (stableBtn) {
      stableBtn.disabled = false;
      stableBtn.className = "btn-ghost update-channel-btn";
      stableBtn.textContent = "Reinstall";
      stableBtn.onclick = async () => {
        closeUpdateModal();
        await downloadAndApplyOtaAsset(info.stableAsset, info.latestTag, "stable", info.stableKey);
      };
    }
  } else {
    if (stableBadge) {
      stableBadge.textContent = info.hasStableOtaUpdate ? "Update Ready" : "Available";
      stableBadge.className = "channel-badge stable";
    }
    if (stableMeta) stableMeta.textContent = formatAssetMeta(info.stableAsset);
    if (stableBtn) {
      stableBtn.disabled = false;
      stableBtn.className = "btn-primary update-channel-btn";
      stableBtn.textContent = info.installedChannel === "unstable" ? "Switch" : "Update";
      stableBtn.onclick = async () => {
        closeUpdateModal();
        await downloadAndApplyOtaAsset(info.stableAsset, info.latestTag, "stable", info.stableKey);
      };
    }
  }

  // 3. Testing Build (In-App Preview Package) Row
  const unstableBadge = $("manual-unstable-badge");
  const unstableMeta = $("manual-unstable-meta");
  const unstableBtn = $("manual-unstable-btn");

  if (!info.unstableAsset) {
    if (unstableBadge) {
      unstableBadge.textContent = "No Build";
      unstableBadge.className = "channel-badge native";
    }
    if (unstableMeta) unstableMeta.textContent = "No testing build available for this release";
    if (unstableBtn) {
      unstableBtn.disabled = true;
      unstableBtn.className = "btn-ghost update-channel-btn unstable-btn";
      unstableBtn.textContent = "None";
    }
  } else if (!info.isCompatibleForOta) {
    if (unstableBadge) {
      unstableBadge.textContent = "Requires App Update";
      unstableBadge.className = "channel-badge native";
    }
    if (unstableMeta) unstableMeta.textContent = `Requires Android App ${formatVersionTag(info.latestTag)}`;
    if (unstableBtn) {
      unstableBtn.disabled = true;
      unstableBtn.className = "btn-ghost update-channel-btn unstable-btn";
      unstableBtn.textContent = "Incompatible";
    }
  } else if (info.isUnstableInstalled) {
    if (unstableBadge) {
      unstableBadge.textContent = "Active";
      unstableBadge.className = "channel-badge unstable";
    }
    if (unstableMeta) unstableMeta.textContent = formatAssetMeta(info.unstableAsset);
    if (unstableBtn) {
      unstableBtn.disabled = false;
      unstableBtn.className = "btn-ghost update-channel-btn unstable-btn";
      unstableBtn.textContent = "Reinstall";
      unstableBtn.onclick = async () => {
        closeUpdateModal();
        await downloadAndApplyOtaAsset(info.unstableAsset, info.latestTag, "unstable", info.unstableKey);
      };
    }
  } else {
    if (unstableBadge) {
      unstableBadge.textContent = "Preview";
      unstableBadge.className = "channel-badge unstable";
    }
    if (unstableMeta) unstableMeta.textContent = formatAssetMeta(info.unstableAsset);
    if (unstableBtn) {
      unstableBtn.disabled = false;
      unstableBtn.className = "btn-ghost update-channel-btn unstable-btn";
      unstableBtn.textContent = info.installedChannel === "unstable" ? "Update" : "Install";
      unstableBtn.onclick = async () => {
        closeUpdateModal();
        await downloadAndApplyOtaAsset(info.unstableAsset, info.latestTag, "unstable", info.unstableKey);
      };
    }
  }

  // 4. Reset to Original App Version Button
  bindRevertNativeButton(info.hasInstalledBundle);

  if (updateModal) updateModal.classList.remove("hidden");
}

function getLocalBundleSummary() {
  const installedBundleKey = safeGet("budgelist-installed-bundle-key") || "";
  const hasBundleJs = Boolean(safeGet("budgelist-bundle-app-js"));
  const hasNativeBridgeSig = Boolean(
    window.AndroidBridge && typeof window.AndroidBridge.getNativeBuildSignature === "function"
  );
  const hasInstalledBundle = Boolean(
    (installedBundleKey && hasBundleJs) || (hasBundleJs && !hasNativeBridgeSig)
  );
  const installedChannel = hasInstalledBundle
    ? safeGet("budgelist-installed-bundle-channel") || "stable"
    : "native";
  const activeChannelLabel = hasInstalledBundle
    ? installedChannel === "unstable"
      ? "Testing Build"
      : "Live Update"
    : "Built-in";
  return { hasInstalledBundle, installedChannel, activeChannelLabel };
}

function bindRevertNativeButton(hasInstalledBundle) {
  const revertBtn = $("manual-revert-native-btn");
  if (!revertBtn) return;
  revertBtn.classList.toggle("hidden", !hasInstalledBundle);
  revertBtn.textContent = `Reset to Original App Version (${formatVersionTag(NATIVE_APP_VERSION)})`;
  revertBtn.onclick = () => {
    try {
      localStorage.removeItem("budgelist-bundle-app-js");
      localStorage.removeItem("budgelist-bundle-style-css");
      localStorage.removeItem("budgelist-bundle-body-html");
      localStorage.removeItem("budgelist-installed-bundle-key");
      localStorage.removeItem("budgelist-installed-bundle-tag");
      localStorage.removeItem("budgelist-installed-bundle-channel");
      localStorage.removeItem("budgelist-installed-bundle-time");
    } catch (e) {}
    closeUpdateModal();
    showToast("Resetting to original app version...");
    setTimeout(() => {
      window.location.reload();
    }, 350);
  };
}

function showManualUpdateCheckingState(isOffline = false) {
  const startupView = $("update-startup-view");
  const manualView = $("update-manual-view");
  const modalTitle = $("update-modal-title");
  const modalMsg = $("update-modal-msg");
  const checkingBanner = $("update-checking-banner");
  const checkingText = $("update-checking-text");

  if (startupView) startupView.classList.add("hidden");
  if (manualView) manualView.classList.remove("hidden");
  if (closeUpdateModalBtn) closeUpdateModalBtn.classList.remove("hidden");
  if (refreshUpdateModalBtn) {
    refreshUpdateModalBtn.classList.remove("hidden");
    refreshUpdateModalBtn.classList.toggle("spinning", !isOffline);
  }
  if (manualCloseBtn) {
    manualCloseBtn.textContent = isOffline ? "Close" : "Cancel Check";
  }

  const { hasInstalledBundle, activeChannelLabel } = getLocalBundleSummary();
  if (modalTitle) modalTitle.textContent = "Update Center";
  if (modalMsg) {
    modalMsg.textContent =
      NATIVE_APP_VERSION !== APP_VERSION
        ? `Current version: ${formatVersionTag(APP_VERSION)} (${activeChannelLabel}) • Base Android app: ${formatVersionTag(NATIVE_APP_VERSION)}`
        : `Current version: ${formatVersionTag(APP_VERSION)} (${activeChannelLabel})`;
  }

  if (checkingBanner && checkingText) {
    checkingBanner.classList.remove("hidden");
    checkingBanner.classList.toggle("error", isOffline);
    checkingText.textContent = isOffline
      ? "No internet connection — connect and tap ↻ to check for updates."
      : "Checking update server...";
  }

  const nativeBadge = $("manual-native-badge");
  const nativeMeta = $("manual-native-meta");
  const nativeBtn = $("manual-native-btn");
  if (nativeBadge) {
    nativeBadge.textContent = isOffline ? "Offline" : "Checking...";
    nativeBadge.className = isOffline ? "channel-badge native" : "channel-badge checking";
  }
  if (nativeMeta) {
    nativeMeta.textContent = `Installed: ${formatVersionTag(NATIVE_APP_VERSION)}`;
  }
  if (nativeBtn) nativeBtn.classList.add("hidden");

  const stableBadge = $("manual-stable-badge");
  const stableMeta = $("manual-stable-meta");
  const stableBtn = $("manual-stable-btn");
  if (stableBadge) {
    stableBadge.textContent = isOffline ? "Offline" : "Checking...";
    stableBadge.className = isOffline ? "channel-badge native" : "channel-badge checking";
  }
  if (stableMeta) {
    stableMeta.textContent = isOffline
      ? "Connect to the internet to check stable updates"
      : "Fetching latest stable update info...";
  }
  if (stableBtn) {
    stableBtn.disabled = true;
    stableBtn.className = "btn-ghost update-channel-btn";
    stableBtn.textContent = isOffline ? "Offline" : "Wait...";
  }

  const unstableBadge = $("manual-unstable-badge");
  const unstableMeta = $("manual-unstable-meta");
  const unstableBtn = $("manual-unstable-btn");
  if (unstableBadge) {
    unstableBadge.textContent = isOffline ? "Offline" : "Checking...";
    unstableBadge.className = isOffline ? "channel-badge native" : "channel-badge checking";
  }
  if (unstableMeta) {
    unstableMeta.textContent = isOffline
      ? "Connect to the internet to check preview builds"
      : "Fetching latest preview build info...";
  }
  if (unstableBtn) {
    unstableBtn.disabled = true;
    unstableBtn.className = "btn-ghost update-channel-btn unstable-btn";
    unstableBtn.textContent = isOffline ? "Offline" : "Wait...";
  }

  bindRevertNativeButton(hasInstalledBundle);
  if (updateModal) updateModal.classList.remove("hidden");
}

function raceWithSignalAndTimeout(promise, signal, timeoutMs = 0) {
  if (!signal && (!timeoutMs || timeoutMs <= 0)) return promise;

  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
    };

    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      const err = new Error("Request aborted");
      err.name = "AbortError";
      reject(err);
    };

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }

    if (timeoutMs && timeoutMs > 0) {
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        const err = new Error("Request timed out");
        err.name = "TimeoutError";
        reject(err);
      }, timeoutMs);
    }

    promise.then(
      (val) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(val);
      },
      (err) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err);
      }
    );
  });
}

async function nativeFetch(url, options = {}) {
  const signal = options.signal || null;
  const timeoutMs = options.timeoutMs || 0;

  if (signal && signal.aborted) {
    const abortErr = new Error("Request aborted");
    abortErr.name = "AbortError";
    throw abortErr;
  }

  const capPlugins = window.Capacitor && window.Capacitor.Plugins;
  const capHttp = (capPlugins && capPlugins.CapacitorHttp) || (window.Capacitor && window.Capacitor.Http) || window.CapacitorHttp;

  if (capHttp && (typeof capHttp.get === "function" || typeof capHttp.request === "function")) {
    try {
      const isArrayBuffer = options.responseType === "arraybuffer" || options.isBlob;
      const fn = typeof capHttp.get === "function" ? capHttp.get.bind(capHttp) : capHttp.request.bind(capHttp);
      const reqPromise = fn({
        method: options.method || "GET",
        url: url,
        headers: options.headers || {},
        responseType: isArrayBuffer ? "arraybuffer" : "text",
        connectTimeout: timeoutMs > 0 ? timeoutMs : 12000,
        readTimeout: timeoutMs > 0 ? timeoutMs : 25000,
      });

      const res = await raceWithSignalAndTimeout(reqPromise, signal, timeoutMs);

      if (res && typeof res.status === "number") {
        const isOk = res.status >= 200 && res.status < 300;
        let rawData = res.data;
        if (isOk && isArrayBuffer && typeof rawData === "string") {
          const binaryString = atob(rawData);
          const len = binaryString.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          return {
            ok: true,
            status: res.status,
            headers: new Headers(res.headers || {}),
            arrayBuffer: async () => bytes.buffer,
            blob: async () => new Blob([bytes.buffer])
          };
        }
        return {
          ok: isOk,
          status: res.status,
          headers: new Headers(res.headers || {}),
          json: async () => (typeof rawData === "string" ? JSON.parse(rawData) : rawData),
          text: async () => (typeof rawData === "string" ? rawData : JSON.stringify(rawData)),
          blob: async () => new Blob([typeof rawData === "string" ? rawData : JSON.stringify(rawData)])
        };
      }
    } catch (e) {
      if (e && (e.name === "AbortError" || (signal && signal.aborted))) {
        throw e;
      }
      console.warn("[OTA] CapacitorHttp request failed, falling back to fetch:", e);
    }
  }

  return raceWithSignalAndTimeout(fetch(url, options), signal, timeoutMs);
}

const STARTUP_UPDATE_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

function parseSizeTextToBytes(text) {
  if (!text) return 0;
  const match = text.match(/(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)\b/i);
  if (!match) return 0;
  const val = parseFloat(match[1]) || 0;
  const unit = match[2].toUpperCase();
  if (unit === "GB") return Math.round(val * 1024 * 1024 * 1024);
  if (unit === "MB") return Math.round(val * 1024 * 1024);
  if (unit === "KB") return Math.round(val * 1024);
  return Math.round(val);
}

async function fetchManifestForTag(tag, signal) {
  const manifestUrl = `https://github.com/${GITHUB_REPO}/releases/download/${encodeURIComponent(tag)}/ota-manifest.json?_t=${Date.now()}`;
  const manifestRes = await nativeFetch(manifestUrl, { signal, timeoutMs: 8000 });
  if (manifestRes && manifestRes.ok) {
    const manifest = await manifestRes.json();
    if (manifest && manifest.tag_name && Array.isArray(manifest.assets)) {
      return manifest;
    }
  }
  return null;
}

async function fetchReleaseViaCdnAndWeb(signal = null) {
  let guessedTag = `v${APP_VERSION.replace(/^v/i, "")}`;
  try {
    const cachedRaw = safeGet("budgelist-cached-release-json");
    if (cachedRaw) {
      const parsed = JSON.parse(cachedRaw);
      if (parsed && parsed.tag_name) guessedTag = parsed.tag_name.trim();
    }
  } catch (e) {}

  // Speculatively start ota-manifest.json fetch in parallel with releases.atom to halve mobile RTT latency
  const speculativeManifestPromise = fetchManifestForTag(guessedTag, signal).catch(() => null);

  let latestTag = guessedTag;
  try {
    const atomRes = await nativeFetch(`https://github.com/${GITHUB_REPO}/releases.atom?_t=${Date.now()}`, {
      signal,
      timeoutMs: 6500,
    });
    if (atomRes && atomRes.ok) {
      const atomXml = await atomRes.text();
      const tagMatch = atomXml.match(/\/releases\/tag\/([^"'<>?\s]+)/i);
      if (tagMatch && tagMatch[1]) {
        latestTag = decodeURIComponent(tagMatch[1].trim());
      }
    }
  } catch (e) {
    if (e && (e.name === "AbortError" || (signal && signal.aborted))) throw e;
    console.warn("[OTA] Atom feed fetch failed:", e);
  }

  if (signal && signal.aborted) {
    const abortErr = new Error("Request aborted");
    abortErr.name = "AbortError";
    throw abortErr;
  }

  // 1. Primary: Use speculative manifest if tag matches, otherwise fetch manifest for new latestTag
  try {
    const manifest =
      latestTag === guessedTag
        ? await speculativeManifestPromise
        : await fetchManifestForTag(latestTag, signal);
    if (manifest) {
      safeSet("budgelist-cached-release-json", JSON.stringify(manifest));
      return manifest;
    }
  } catch (e) {
    if (e && (e.name === "AbortError" || (signal && signal.aborted))) throw e;
    console.warn("[OTA] CDN ota-manifest.json not available, trying expanded_assets:", e);
  }

  // 2. Secondary: Parse GitHub expanded_assets HTML fragment (also zero API rate limit)
  const assetsUrl = `https://github.com/${GITHUB_REPO}/releases/expanded_assets/${encodeURIComponent(latestTag)}?_t=${Date.now()}`;
  const assetsRes = await nativeFetch(assetsUrl, { signal, timeoutMs: 8000 });
  if (!assetsRes || !assetsRes.ok) return null;

  const html = await assetsRes.text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  const assets = [];

  doc.querySelectorAll("li").forEach((li) => {
    const link = li.querySelector('a[href*="/releases/download/"]');
    if (!link) return;
    const href = link.getAttribute("href") || "";
    const downloadUrl = href.startsWith("http") ? href : `https://github.com${href}`;
    const name = decodeURIComponent(href.split("/").pop() || link.textContent.trim());
    if (name === "ota-manifest.json") return;
    const timeEl = li.querySelector("relative-time[datetime]");
    const updatedAt = timeEl ? timeEl.getAttribute("datetime") || "" : "";
    const sizeBytes = parseSizeTextToBytes(li.textContent || "");

    assets.push({
      name,
      browser_download_url: downloadUrl,
      size: sizeBytes,
      updated_at: updatedAt,
    });
  });

  if (assets.length === 0) return null;

  const fallbackRelease = {
    tag_name: latestTag,
    html_url: `https://github.com/${GITHUB_REPO}/releases/tag/${latestTag}`,
    body: "",
    assets,
  };
  safeSet("budgelist-cached-release-json", JSON.stringify(fallbackRelease));
  return fallbackRelease;
}

async function fetchLatestRelease(isStartup = false, options = {}) {
  const signal = options.signal || null;
  const allowStaleFallback = options.allowStaleFallback !== false;

  // Use 10-minute cooldown cache for automatic startup checks to avoid redundant network traffic
  if (isStartup) {
    const lastCheckTs = Number(safeGet("budgelist-last-startup-check-ts") || 0);
    const cachedRaw = safeGet("budgelist-cached-release-json");
    if (cachedRaw && Date.now() - lastCheckTs < STARTUP_UPDATE_COOLDOWN_MS) {
      try {
        return JSON.parse(cachedRaw);
      } catch (e) {}
    }
  }

  // 1. Primary: Rate-limit-free GitHub CDN (ota-manifest.json / expanded_assets)
  try {
    const cdnRelease = await fetchReleaseViaCdnAndWeb(signal);
    if (cdnRelease) {
      if (isStartup) safeSet("budgelist-last-startup-check-ts", String(Date.now()));
      return cdnRelease;
    }
  } catch (e) {
    if (e && (e.name === "AbortError" || (signal && signal.aborted))) throw e;
    console.warn("[OTA] Primary CDN release check failed:", e);
  }

  // 2. Fallback: GitHub REST API (60 req/hr per IP)
  try {
    const res = await nativeFetch(`https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=1&_t=${Date.now()}`, {
      headers: { Accept: "application/vnd.github.v3+json" },
      signal,
      timeoutMs: 6000,
    });

    if (res && res.ok) {
      const releases = await res.json();
      if (Array.isArray(releases) && releases.length > 0) {
        safeSet("budgelist-cached-release-json", JSON.stringify(releases[0]));
        if (isStartup) safeSet("budgelist-last-startup-check-ts", String(Date.now()));
        return releases[0];
      }
    }
  } catch (e) {
    if (e && (e.name === "AbortError" || (signal && signal.aborted))) throw e;
    console.warn("[OTA] GitHub REST API fallback failed:", e);
  }

  // 3. Final offline/rate-limit fallback: last known cached release metadata
  if (allowStaleFallback) {
    try {
      const cached = safeGet("budgelist-cached-release-json");
      if (cached) return JSON.parse(cached);
    } catch (e) {}
  }

  return null;
}

async function checkForAppUpdates(isStartup = false, silent = false) {
  if (!isStartup) {
    // Manual Update Center: Open popup immediately (0ms) with live checking state & cancel support
    if (manualUpdateCheckController) {
      try {
        manualUpdateCheckController.abort();
      } catch (e) {}
    }
    const controller = new AbortController();
    manualUpdateCheckController = controller;
    const reqSeq = ++manualUpdateCheckSeq;

    const strictlyOffline = typeof navigator !== "undefined" && navigator.onLine === false;
    if (strictlyOffline) {
      showManualUpdateCheckingState(true);
      return false;
    }

    showManualUpdateCheckingState(false);

    const checkingBanner = $("update-checking-banner");
    const checkingText = $("update-checking-text");
    const slowTimer = setTimeout(() => {
      if (reqSeq === manualUpdateCheckSeq && !controller.signal.aborted && checkingText) {
        checkingText.textContent = "Slow network detected — still reaching update server...";
      }
    }, 3200);

    try {
      const latest = await fetchLatestRelease(false, {
        signal: controller.signal,
        allowStaleFallback: false,
      });

      clearTimeout(slowTimer);
      if (reqSeq !== manualUpdateCheckSeq || controller.signal.aborted) return false;
      manualUpdateCheckController = null;

      if (latest) {
        if (checkingBanner) checkingBanner.classList.add("hidden");
        const info = inspectReleaseAssets(latest);
        showManualUpdateModal(info);
        return true;
      }

      // Live fetch failed on weak network — show cached info if available with a clear warning banner
      if (refreshUpdateModalBtn) refreshUpdateModalBtn.classList.remove("spinning");
      if (manualCloseBtn) manualCloseBtn.textContent = "Close";

      let cachedRelease = null;
      try {
        const raw = safeGet("budgelist-cached-release-json");
        if (raw) cachedRelease = JSON.parse(raw);
      } catch (e) {}

      if (cachedRelease) {
        showManualUpdateModal(inspectReleaseAssets(cachedRelease));
        if (checkingBanner && checkingText) {
          checkingBanner.classList.remove("hidden");
          checkingBanner.classList.add("error");
          checkingText.textContent = "Slow or unstable connection — showing last cached info. Tap ↻ to retry.";
        }
      } else {
        showManualUpdateCheckingState(true);
        if (checkingBanner && checkingText) {
          checkingBanner.classList.remove("hidden");
          checkingBanner.classList.add("error");
          checkingText.textContent = "Could not reach update server on current network. Tap ↻ to retry.";
        }
      }
      return false;
    } catch (e) {
      clearTimeout(slowTimer);
      if (reqSeq !== manualUpdateCheckSeq || controller.signal.aborted) return false;
      manualUpdateCheckController = null;
      if (refreshUpdateModalBtn) refreshUpdateModalBtn.classList.remove("spinning");
      if (manualCloseBtn) manualCloseBtn.textContent = "Close";
      if (checkingBanner && checkingText) {
        checkingBanner.classList.remove("hidden");
        checkingBanner.classList.add("error");
        checkingText.textContent = "Connection timed out. Check your mobile signal and tap ↻ to retry.";
      }
      return false;
    }
  }

  // Startup Background Check
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return false;
  }

  try {
    const latest = await fetchLatestRelease(true);
    if (latest) {
      const info = inspectReleaseAssets(latest);

      // Startup Mode: Never auto-download. Check Native APK first, then Stable OTA (ignore Unstable OTA).
      if (info.hasNativeUpdate) {
        const isMandatory = isMandatoryUpdate(info.latestTag, NATIVE_APP_VERSION, latest.body);
        const skippedTag = safeGet("budgelist-skipped-update");
        if (!isMandatory && skippedTag === info.latestTag) {
          return false;
        }
        showStartupUpdateModal({
          type: "native",
          latestTag: info.latestTag,
          downloadUrl: info.apkAsset?.browser_download_url || info.releaseUrl,
          isForced: isMandatory,
          asset: info.apkAsset,
        });
        return true;
      }

      if (info.hasStableOtaUpdate && info.stableAsset) {
        const skippedOtaKey = safeGet("budgelist-skipped-ota-key");
        if (skippedOtaKey === info.stableKey) {
          return false;
        }
        showStartupUpdateModal({
          type: "stable-ota",
          latestTag: info.latestTag,
          asset: info.stableAsset,
          bundleKey: info.stableKey,
        });
        return true;
      }

      return false;
    }
  } catch (e) {
    if (!silent) showToast(`Could not check updates (v${APP_VERSION})`);
  }
  return false;
}

// ---------- GitHub Release ZIP OTA Live Updates Engine ----------
let isOtaUpdating = false;
let isOtaExtracting = false;
let otaCancelController = null;
let otaUpdateRunSeq = 0;
let activeOtaCancelFn = null;

async function downloadAndApplyOtaAsset(zipAsset, latestTag, channel = "stable", bundleKey = "") {
  if (isOtaUpdating || !zipAsset || !zipAsset.browser_download_url) return false;

  const safeAssetUrl = sanitizeGitHubReleaseUrl(zipAsset.browser_download_url, true);
  if (!safeAssetUrl) {
    console.warn("[OTA] Blocked untrusted OTA download URL:", zipAsset.browser_download_url);
    showToast("Blocked untrusted update URL");
    return false;
  }

  if (!isSameOrNewerVersion(latestTag, NATIVE_APP_VERSION)) {
    showToast(`Update requires Android App ${formatVersionTag(latestTag)}`);
    return false;
  }

  if (typeof JSZip === "undefined") {
    console.warn("[OTA] JSZip is not loaded, skipping OTA bundle extraction.");
    showToast("Update error: ZIP engine unavailable");
    return false;
  }

  const resolvedKey =
    bundleKey ||
    `${latestTag}_${channel}_${zipAsset.updated_at || zipAsset.id || zipAsset.size}`;
  const originScreen = isGuest || uid ? "app" : "auth";
  const channelLabel = channel === "unstable" ? "Testing Build" : "Stable Update";
  const runId = ++otaUpdateRunSeq;

  isOtaUpdating = true;
  isOtaExtracting = false;
  console.log(`[OTA] Starting ${channelLabel} bundle download: ${resolvedKey}`);

  const statusText = $("loading-status-text");
  const progressWrap = $("ota-progress-wrap");
  const progressBar = $("ota-progress-bar");
  const statusDetail = $("ota-status-detail");
  const skipBtn = $("ota-skip-btn");

  closeSettingsSheet();
  closeUpdateModal();
  showScreen("loading");
  if (statusText) statusText.textContent = `Installing ${channelLabel} (${formatVersionTag(latestTag)})...`;
  if (progressWrap) progressWrap.classList.remove("hidden");
  if (progressBar) progressBar.style.width = "8%";
  if (statusDetail) {
    statusDetail.classList.remove("hidden");
    statusDetail.textContent = "Connecting to update server...";
  }
  if (skipBtn) {
    skipBtn.textContent = "Cancel Update";
    skipBtn.classList.remove("hidden");
  }

  let skipped = false;
  let progressTicker = null;
  otaCancelController = new AbortController();

  const cleanupUiState = () => {
    if (progressTicker) {
      clearInterval(progressTicker);
      progressTicker = null;
    }
    if (progressWrap) progressWrap.classList.add("hidden");
    if (statusDetail) statusDetail.classList.add("hidden");
    if (skipBtn) skipBtn.classList.add("hidden");
    if (statusText) statusText.textContent = "Loading session...";
  };

  const cancelDownloadImmediately = () => {
    if (skipped || isOtaExtracting) return;
    console.log("[OTA] User cancelled update immediately.");
    skipped = true;
    otaUpdateRunSeq++;
    activeOtaCancelFn = null;
    if (otaCancelController) {
      try {
        otaCancelController.abort();
      } catch (e) {}
    }
    cleanupUiState();
    isOtaUpdating = false;
    isOtaExtracting = false;
    showScreen(originScreen);
    showToast("Update cancelled");
  };

  activeOtaCancelFn = cancelDownloadImmediately;
  if (skipBtn) {
    skipBtn.onclick = cancelDownloadImmediately;
  }

  try {
    const sizeHint = formatAssetSize(zipAsset.size);
    if (statusDetail) {
      statusDetail.textContent = `Downloading ${channelLabel.toLowerCase()}${sizeHint ? ` (${sizeHint})` : ""}...`;
    }

    // Smooth visual progress feedback during buffered native downloads (e.g. mobile network via CapacitorHttp)
    let simulatedPct = 8;
    const downloadStartTs = Date.now();
    progressTicker = setInterval(() => {
      if (skipped || runId !== otaUpdateRunSeq) return;
      simulatedPct = Math.min(76, simulatedPct + Math.max(1, (78 - simulatedPct) * 0.14));
      if (progressBar) progressBar.style.width = `${Math.round(simulatedPct)}%`;
      const elapsedSec = Math.floor((Date.now() - downloadStartTs) / 1000);
      if (elapsedSec >= 4 && statusDetail) {
        statusDetail.textContent = `Still downloading${sizeHint ? ` (${sizeHint})` : ""} — slow network (${elapsedSec}s)...`;
      }
    }, 400);

    const res = await nativeFetch(safeAssetUrl, {
      signal: otaCancelController.signal,
      isBlob: true,
      timeoutMs: 45000,
    });
    if (progressTicker) {
      clearInterval(progressTicker);
      progressTicker = null;
    }
    if (skipped || runId !== otaUpdateRunSeq) return false;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const contentLength = res.headers.get("content-length");
    const totalBytes = contentLength ? parseInt(contentLength, 10) : zipAsset.size || 0;

    let blob;
    if (res.body && typeof ReadableStream !== "undefined" && totalBytes > 0) {
      const reader = res.body.getReader();
      let receivedBytes = 0;
      const chunks = [];

      while (true) {
        if (skipped || runId !== otaUpdateRunSeq) throw new Error("Update cancelled by user.");
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        receivedBytes += value.length;
        const pct = Math.min(90, Math.round((receivedBytes / totalBytes) * 90));
        if (statusText) statusText.textContent = `Downloading ${channelLabel}: ${pct}%`;
        if (progressBar) progressBar.style.width = `${pct}%`;
        if (statusDetail) {
          statusDetail.textContent = `${Math.round(receivedBytes / 1024)} KB / ${Math.round(totalBytes / 1024)} KB`;
        }
      }
      blob = new Blob(chunks);
    } else {
      blob = await res.blob();
      if (progressBar) progressBar.style.width = "82%";
    }

    if (skipped || runId !== otaUpdateRunSeq) return false;

    isOtaExtracting = true;
    activeOtaCancelFn = null;
    if (skipBtn) skipBtn.classList.add("hidden");
    if (statusText) statusText.textContent = "Applying update...";
    if (statusDetail) statusDetail.textContent = "Unpacking update files...";
    if (progressBar) progressBar.style.width = "92%";

    const MAX_OTA_ENTRY_CHARS = 4 * 1024 * 1024;
    const zip = await JSZip.loadAsync(blob);
    const updates = {};

    for (const [filename, fileEntry] of Object.entries(zip.files)) {
      if (fileEntry.dir) continue;
      const cleanName = filename.replace(/^.*?public\//, "").replace(/^.*?\//, "");
      if (cleanName === "app.js" || cleanName === "style.css" || cleanName === "index.html") {
        const content = await fileEntry.async("string");
        if (content.length > MAX_OTA_ENTRY_CHARS) {
          throw new Error(`Oversized OTA file (${cleanName})`);
        }
        updates[cleanName] = content;
      }
    }

    if (skipped || runId !== otaUpdateRunSeq) return false;

    if (updates["app.js"]) {
      // Pre-validate bundle syntax before mutating localStorage
      new Function(updates["app.js"]);
    }

    if (updates["app.js"] || updates["style.css"] || updates["index.html"]) {
      const bundleKeys = [
        "budgelist-bundle-body-html",
        "budgelist-bundle-app-js",
        "budgelist-bundle-style-css",
        "budgelist-installed-bundle-key",
        "budgelist-installed-bundle-tag",
        "budgelist-installed-bundle-channel",
        "budgelist-installed-bundle-time",
      ];
      const prevSnapshot = {};
      bundleKeys.forEach((k) => {
        prevSnapshot[k] = safeGet(k);
      });

      const writeChecks = [];
      if (updates["index.html"]) {
        const match = updates["index.html"].match(/<body[^>]*>([\s\S]*)<\/body>/i);
        if (match && match[1]) {
          writeChecks.push(safeSet("budgelist-bundle-body-html", match[1].trim()));
        }
      }
      if (updates["app.js"]) writeChecks.push(safeSet("budgelist-bundle-app-js", updates["app.js"]));
      if (updates["style.css"]) writeChecks.push(safeSet("budgelist-bundle-style-css", updates["style.css"]));
      writeChecks.push(safeSet("budgelist-installed-bundle-key", resolvedKey));
      writeChecks.push(safeSet("budgelist-installed-bundle-tag", latestTag));
      writeChecks.push(safeSet("budgelist-installed-bundle-channel", channel));
      writeChecks.push(safeSet("budgelist-installed-bundle-time", zipAsset.updated_at || new Date().toISOString()));

      if (writeChecks.some((ok) => !ok)) {
        bundleKeys.forEach((k) => {
          try {
            if (prevSnapshot[k] == null) localStorage.removeItem(k);
            else localStorage.setItem(k, prevSnapshot[k]);
          } catch (e) {}
        });
        throw new Error("Local storage quota exceeded while saving update");
      }

      if (progressBar) progressBar.style.width = "100%";
      if (statusText) statusText.textContent = `${channelLabel} installed!`;
      if (statusDetail) statusDetail.textContent = "Reloading application...";
      console.log(`[OTA] Web bundle ${resolvedKey} (${channel}) installed successfully.`);

      setTimeout(() => {
        window.location.reload();
      }, 400);
      return true;
    }
  } catch (err) {
    if (skipped || runId !== otaUpdateRunSeq) return false;
    console.warn("[OTA] Live update process aborted or failed:", err.message || err);
    cleanupUiState();
    isOtaUpdating = false;
    isOtaExtracting = false;
    activeOtaCancelFn = null;
    showScreen(originScreen);
    showToast("Update failed — keeping current version");
    return false;
  } finally {
    if (runId === otaUpdateRunSeq && !isOtaExtracting) {
      cleanupUiState();
      isOtaUpdating = false;
      activeOtaCancelFn = null;
    }
  }
  return false;
}

$("check-update-btn").addEventListener("click", () => {
  checkForAppUpdates(false, false);
});

$("toggle-release-notes").addEventListener("click", () => {
  const notes = $("release-notes-content");
  const arrow = $("release-notes-arrow");
  if (!notes) return;
  const isHidden = notes.classList.contains("hidden");
  notes.classList.toggle("hidden", !isHidden);
  if (arrow) arrow.textContent = isHidden ? "▾" : "▸";
});

// ---------- Password Visibility Toggle ----------
document.querySelectorAll(".password-toggle-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const targetId = btn.getAttribute("data-target");
    const input = targetId ? $(targetId) : btn.previousElementSibling;
    if (!input) return;

    const isPassword = input.type === "password";
    input.type = isPassword ? "text" : "password";

    const eyeIcon = btn.querySelector(".eye-icon");
    const eyeOffIcon = btn.querySelector(".eye-off-icon");

    if (eyeIcon && eyeOffIcon) {
      eyeIcon.classList.toggle("hidden", isPassword);
      eyeOffIcon.classList.toggle("hidden", !isPassword);
    }
  });
});

// ---------- Auth Mode & Guest Modal ----------
let authMode = "login"; // "login" or "signup"
const usernameFieldWrap = $("username-field-wrap");
const authIdLabel = $("auth-id-label");
const mainAuthBtn = $("main-auth-btn");
const toggleAuthModeBtn = $("toggle-auth-mode-btn");
const authTitle = $("auth-title");
const authSub = $("auth-sub");
const loginForgotPasswordBtn = $("login-forgot-password-btn");

function setAuthMode(mode) {
  authMode = mode;
  authError.textContent = "";
  if (mode === "login") {
    usernameFieldWrap.classList.add("hidden");
    if (loginForgotPasswordBtn) loginForgotPasswordBtn.classList.remove("hidden");
    authIdLabel.textContent = "Email or Username";
    $("auth-id").placeholder = "";
    mainAuthBtn.textContent = "Log in";
    toggleAuthModeBtn.textContent = "Create account";
    authTitle.textContent = "Budget, listed.";
    authSub.textContent = "Log spending, catch recurring bills, and see where the month is headed before it's over.";
  } else {
    usernameFieldWrap.classList.remove("hidden");
    if (loginForgotPasswordBtn) loginForgotPasswordBtn.classList.add("hidden");
    authIdLabel.textContent = "Email";
    $("auth-id").placeholder = "you@example.com";
    mainAuthBtn.textContent = "Create account";
    toggleAuthModeBtn.textContent = "Already have an account? Log in";
    authTitle.textContent = "Join Budgelist.";
    authSub.textContent = "Create an account with a unique username to securely save your budget.";
  }
}

toggleAuthModeBtn.addEventListener("click", () => {
  setAuthMode(authMode === "login" ? "signup" : "login");
});

const guestBtn = $("guest-btn");
const guestModal = $("guest-modal");
const cancelGuest = $("cancel-guest");
const confirmGuest = $("confirm-guest");
const verifyBanner = $("verify-banner");
const resendVerifyBtn = $("resend-verify-btn");

guestBtn.addEventListener("click", () => guestModal.classList.remove("hidden"));
cancelGuest.addEventListener("click", () => guestModal.classList.add("hidden"));
confirmGuest.addEventListener("click", () => {
  guestModal.classList.add("hidden");
  isGuest = true;
  uid = "guest";
  safeSet("budgelist-last-session", "guest");
  safeSet("budgelist-last-uid", "guest");
  showScreen("app");
  verifyBanner.classList.add("hidden");
  recurringApplied = false;
  viewDate = startOfMonth(new Date());
  loadLocalUserCache();
  updateProfileWidgetUI();
  applyRecurringForThisMonth();
  renderRecurring();
  render();
});

resendVerifyBtn.addEventListener("click", async () => {
  if (auth.currentUser) {
    try {
      await sendEmailVerification(auth.currentUser);
      showToast("Verification email sent! Check your inbox.");
    } catch (e) {
      showToast("Could not send verification email. Try again later.");
    }
  }
});

let isAuthResolved = false;

const authTimeout = setTimeout(() => {
  if (isAuthResolved) return;
  isAuthResolved = true;

  const lastSession = safeGet("budgelist-last-session");
  const lastUid = safeGet("budgelist-last-uid");

  if (lastSession === "guest" || isGuest) {
    isGuest = true;
    uid = "guest";
    safeSet("budgelist-last-session", "guest");
    safeSet("budgelist-last-uid", "guest");
    loadLocalUserCache();
    updateProfileWidgetUI();
    applyRecurringForThisMonth();
    renderRecurring();
    render();
    showScreen("app");
  } else if (lastSession === "user" && lastUid) {
    uid = lastUid;
    loadSyncQueue();
    loadLocalUserCache();
    updateProfileWidgetUI();
    applyRecurringForThisMonth();
    renderRecurring();
    render();
    showScreen("app");
    showToast("Offline — showing cached budget");
  } else {
    showScreen("auth");
  }
}, 2200);

let isInitialStartupUpdateChecked = false;
function triggerStartupUpdateCheckOnce() {
  if (isInitialStartupUpdateChecked) return;
  isInitialStartupUpdateChecked = true;
  checkForAppUpdates(true, true);
}

onAuthStateChanged(auth, async (user) => {
  isAuthResolved = true;
  clearTimeout(authTimeout);
  triggerStartupUpdateCheckOnce();

  if (user && !isGuest) {
    uid = user.uid;
    safeSet("budgelist-last-session", "user");
    safeSet("budgelist-last-uid", uid);

    verifyBanner.classList.toggle("hidden", user.emailVerified);
    recurringApplied = false;
    viewDate = startOfMonth(new Date());

    loadSyncQueue();
    loadLocalUserCache();

    if (!safeGet(cacheKey("avatar")) && user.photoURL) {
      safeSet(cacheKey("avatar"), user.photoURL);
    }
    if (!safeGet(cacheKey("name")) && user.displayName) {
      safeSet(cacheKey("name"), user.displayName);
    }

    updateProfileWidgetUI();
    applyRecurringForThisMonth();
    renderRecurring();
    render();

    showScreen("app");
    monitorBackgroundNetwork();

    const autoSyncEnabled = safeGet(cacheKey("auto-sync")) !== "false";
    if (autoSyncEnabled) {
      syncCloudData(false);
    }
  } else if (!isGuest) {
    if (isUpdatingEmail) {
      return;
    }

    const lastSession = safeGet("budgelist-last-session");
    const lastUid = safeGet("budgelist-last-uid");

    if (lastSession === "guest") {
      isGuest = true;
      uid = "guest";
      loadLocalUserCache();
      updateProfileWidgetUI();
      applyRecurringForThisMonth();
      renderRecurring();
      render();
      showScreen("app");
      return;
    }

    if (lastSession === "user" && lastUid && !navigator.onLine) {
      uid = lastUid;
      loadSyncQueue();
      loadLocalUserCache();
      updateProfileWidgetUI();
      applyRecurringForThisMonth();
      renderRecurring();
      render();
      showScreen("app");
      showToast("Offline — showing cached budget");
      return;
    }

    uid = null;
    safeSet("budgelist-last-session", "");
    safeSet("budgelist-last-uid", "");
    showScreen("auth");
  }
});

authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  authError.textContent = "";

  const online = await checkNetworkConnection();
  if (!online) {
    showNetworkModal(
      "You need an active internet connection to log in or create an account. You can also use Guest mode offline.",
      () => authForm.dispatchEvent(new Event("submit")),
      () => { authError.textContent = "Offline. Connect to the internet or continue as Guest."; }
    );
    return;
  }

  const password = $("password").value;
  const identifier = $("auth-id").value.trim();

  if (authMode === "login") {
    try {
      let email = identifier;
      if (!identifier.includes("@")) {
        const usernameLower = identifier.toLowerCase();
        const uSnap = await getDoc(doc(db, "usernames", usernameLower));
        if (!uSnap.exists()) {
          authError.textContent = "No account found with that username or email.";
          return;
        }
        email = uSnap.data().email;
        if (uSnap.data().username) {
          safeSet(`budgelist-user-${uSnap.data().uid || "login"}-username`, uSnap.data().username);
        }
      }
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      authError.textContent = humanAuthError(err.code);
    }
  } else {
    const username = $("username").value.trim();
    const email = identifier;
    if (!username || username.length < 3 || username.length > 20 || !/^[a-zA-Z0-9_]+$/.test(username)) {
      authError.textContent = "Username must be 3-20 characters (letters, numbers, underscores).";
      return;
    }
    if (!email || password.length < 6) {
      authError.textContent = "Enter a valid email and password (6+ characters).";
      return;
    }
    try {
      const usernameLower = username.toLowerCase();
      const uSnap = await getDoc(doc(db, "usernames", usernameLower));
      if (uSnap.exists()) {
        authError.textContent = "That username is already taken. Choose another.";
        return;
      }
      const cred = await createUserWithEmailAndPassword(auth, email, password);

      // Update Auth profile
      try {
        await updateProfile(cred.user, { displayName: username, photoURL: "🦊" });
      } catch (e) {}

      // Store username mapping in Firestore
      await setDoc(doc(db, "usernames", usernameLower), {
        uid: cred.user.uid,
        email: email.toLowerCase(),
        username: username,
      });

      // Store user document in Firestore
      await setDoc(doc(db, "users", cred.user.uid), {
        email: email.toLowerCase(),
        username: username,
        avatar: "🦊",
        name: username,
        createdAt: new Date().toISOString()
      }, { merge: true });

      // Local storage cache
      safeSet(`budgelist-user-${cred.user.uid}-username`, username);

      await sendEmailVerification(cred.user);
      showToast("Account created! Please check your email for verification.");
    } catch (err) {
      authError.textContent = humanAuthError(err.code);
    }
  }
});

if (loginForgotPasswordBtn) {
  loginForgotPasswordBtn.addEventListener("click", async () => {
    authError.textContent = "";

    const online = await checkNetworkConnection();
    if (!online) {
      showNetworkModal(
        "You need an active internet connection to reset your password.",
        () => loginForgotPasswordBtn.click(),
        () => { authError.textContent = "Offline. Connect to the internet to reset password."; }
      );
      return;
    }

    const identifier = $("auth-id").value.trim();
    if (!identifier) {
      authError.textContent = "Enter your email or username above first.";
      return;
    }

    try {
      let email = identifier;
      if (!identifier.includes("@")) {
        const usernameLower = identifier.toLowerCase();
        const uSnap = await getDoc(doc(db, "usernames", usernameLower));
        if (!uSnap.exists()) {
          authError.textContent = "No account found with that username.";
          return;
        }
        email = uSnap.data().email;
      }
      if (!email) {
        authError.textContent = "No email found for this account.";
        return;
      }
      await sendPasswordResetEmail(auth, email);
      showToast(`Password reset email sent to ${email}`);
      authError.textContent = "";
    } catch (err) {
      authError.textContent = humanAuthError(err.code) || "Could not send password reset email.";
    }
  });
}

function performLogout() {
  const logoutModal = $("logout-modal");
  if (logoutModal) logoutModal.classList.add("hidden");
  closeSettingsSheet();
  safeSet("budgelist-last-session", "");
  safeSet("budgelist-last-uid", "");
  if (isGuest) {
    isGuest = false;
    uid = null;
    showScreen("auth");
  } else {
    signOut(auth);
  }
}

function openLogoutModal() {
  const logoutModal = $("logout-modal");
  if (!logoutModal) {
    performLogout();
    return;
  }
  const titleEl = $("logout-modal-title");
  const msgEl = $("logout-modal-msg");
  const confirmBtn = $("confirm-logout-btn");

  if (isGuest) {
    if (titleEl) titleEl.textContent = "Exit Guest Mode?";
    if (msgEl) {
      msgEl.textContent =
        "Return to the login screen? Your guest expenses and budgets will remain saved on this device.";
    }
    if (confirmBtn) confirmBtn.textContent = "Exit Guest";
  } else {
    if (titleEl) titleEl.textContent = "Log out?";
    const hasPendingSync = Array.isArray(syncQueue) && syncQueue.length > 0;
    if (msgEl) {
      msgEl.textContent = hasPendingSync
        ? "You have unsynced changes saved locally. Are you sure you want to log out right now?"
        : "Are you sure you want to log out of your account on this device?";
    }
    if (confirmBtn) confirmBtn.textContent = "Log out";
  }
  logoutModal.classList.remove("hidden");
}

$("logout-btn").addEventListener("click", openLogoutModal);
if ($("cancel-logout-btn")) {
  $("cancel-logout-btn").addEventListener("click", () => {
    $("logout-modal").classList.add("hidden");
  });
}
if ($("confirm-logout-btn")) {
  $("confirm-logout-btn").addEventListener("click", performLogout);
}

function humanAuthError(code) {
  const map = {
    "auth/invalid-email": "That email address is invalid.",
    "auth/wrong-password": "Incorrect password.",
    "auth/user-not-found": "No account found with that email.",
    "auth/email-already-in-use": "An account already exists with that email address.",
    "auth/weak-password": "Password should be at least 6 characters long.",
    "auth/invalid-credential": "Incorrect password or credentials.",
    "auth/requires-recent-login": "Please re-enter your password to proceed.",
    "auth/credential-too-old": "Please log out and log back in before updating.",
    "auth/operation-not-allowed": "This operation is not allowed. Please verify your current password.",
  };
  return map[code] || "Something went wrong. Please check your details and try again.";
}

// ---------- Expenses ----------
function commitExpenseSave({ targetEditingId, amount, category, note, expDate }) {
  let prevYm = null;
  if (targetEditingId) {
    const existing = expenses.find((x) => x.id === targetEditingId);
    if (existing && existing.dateISO) prevYm = existing.dateISO.slice(0, 7);
  }
  const newYm = expDate.slice(0, 7);

  if (isGuest) {
    if (targetEditingId) {
      const exp = expenses.find((x) => x.id === targetEditingId);
      if (exp) { exp.amount = amount; exp.category = category; exp.note = note; exp.dateISO = expDate; }
      showToast("Expense updated");
    } else {
      expenses.unshift({
        id: "guest_" + Math.random().toString(36).slice(2, 10),
        amount, category, note, dateISO: expDate, createdAt: Date.now(),
      });
      showToast("Expense added");
    }
  } else {
    if (targetEditingId) {
      const exp = expenses.find((x) => x.id === targetEditingId);
      if (exp) { exp.amount = amount; exp.category = category; exp.note = note; exp.dateISO = expDate; }
      enqueueSync({ type: "UPDATE_EXPENSE", id: targetEditingId, data: { amount, category, note, dateISO: expDate } });
      showToast("Expense updated");
    } else {
      const newExp = {
        id: "cloud_exp_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
        amount, category, note, dateISO: expDate, createdAt: Date.now(),
      };
      expenses.unshift(newExp);
      enqueueSync({ type: "ADD_EXPENSE", data: newExp });
      showToast("Expense added");
    }
  }

  if (prevYm && prevYm !== newYm) {
    reconcileActiveMonthSpend(prevYm);
  }
  reconcileActiveMonthSpend(newYm);
  syncBudgetState();
  applyRecurringForThisMonth();
  render();
  closeExpenseSheet();
}

expenseForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const amount = round2(parseFloat($("amount").value));
  const category = $("category").value;
  const note = $("note").value.trim();
  const customDateInput = $("expense-date") ? $("expense-date").value : null;
  if (!amount || amount <= 0) return;

  const expDate = customDateInput || selectedDateISO || todayISO();
  const targetYm = expDate.slice(0, 7);

  // 1. If targeting a past month, check lock state
  if (isPastMonth(targetYm)) {
    if (!isPastMonthUnlocked(targetYm)) {
      openUnlockPastSheet(targetYm, () => {
        commitExpenseSave({ targetEditingId: editingId, amount, category, note, expDate });
      });
      return;
    }
    commitExpenseSave({ targetEditingId: editingId, amount, category, note, expDate });
    return;
  }

  // 2. Current or Future Month: check if expense exceeds Month Budget or Global Budget
  const rec = ensureMonthRecord(targetYm);
  const currentSpent = monthSpentTotal(targetYm);
  const oldExp = editingId ? expenses.find((x) => x.id === editingId) : null;
  const oldInSameYm = oldExp && oldExp.dateISO && oldExp.dateISO.startsWith(targetYm) ? round2(oldExp.amount) : 0;
  const projectedMonthSpent = round2(currentSpent - oldInSameYm + amount);
  const netDelta = round2(amount - oldInSameYm);

  if (netDelta > 0) {
    const allocated = round2(rec.allocated || 0);
    if (allocated > 0) {
      const coveredLimit = round2(allocated + (rec.directCovered || 0));
      if (projectedMonthSpent > coveredLimit) {
        const deficit = round2(projectedMonthSpent - coveredLimit);
        openOverbudgetSheet({
          mode: "restricted",
          targetYm,
          deficit,
          netDelta,
          pendingExpense: { targetEditingId: editingId, amount, category, note, expDate },
        });
        return;
      }
    } else {
      // Unrestricted month: check if netDelta exceeds available globalBudget
      if (netDelta > globalBudget) {
        const deficit = round2(netDelta - globalBudget);
        openOverbudgetSheet({
          mode: "unrestricted",
          targetYm,
          deficit,
          netDelta,
          pendingExpense: { targetEditingId: editingId, amount, category, note, expDate },
        });
        return;
      }
    }
  }

  commitExpenseSave({ targetEditingId: editingId, amount, category, note, expDate });
});

$("delete-expense-btn").addEventListener("click", async () => {
  if (!editingId) return;
  const exp = expenses.find((e) => e.id === editingId);
  const expYm = exp && exp.dateISO ? exp.dateISO.slice(0, 7) : null;

  if (expYm && isPastMonth(expYm) && !isPastMonthUnlocked(expYm)) {
    openUnlockPastSheet(expYm, () => $("delete-expense-btn").click());
    return;
  }

  expenses = expenses.filter((e) => e.id !== editingId);
  if (!isGuest) {
    enqueueSync({ type: "DELETE_EXPENSE", id: editingId });
  }
  if (expYm) reconcileActiveMonthSpend(expYm);
  syncBudgetState();
  render();
  closeExpenseSheet();
  showToast("Expense deleted");
});

// ---------- Custom Expense Date Picker Calendar ----------
let expCalViewDate = startOfMonth(new Date());
let expCalOpen = false;
let closeExpCalTimer = null;

function setExpenseDateValue(dateISO) {
  const safeISO = dateISO || todayISO();
  const expDateInput = $("expense-date");
  if (expDateInput) expDateInput.value = safeISO;

  const [y, m, d] = safeISO.split("-").map((n) => parseInt(n, 10));
  if (y && m && d) {
    const dObj = new Date(y, m - 1, d);
    expCalViewDate = new Date(y, m - 1, 1);
    const triggerText = $("expense-date-trigger-text");
    if (triggerText) {
      triggerText.textContent = safeISO === todayISO()
        ? `Today · ${dayLabelFmt.format(dObj)}`
        : dayFullLabelFmt.format(dObj);
    }
  }
  if (expCalOpen) renderExpenseCalendar();
}

function openExpenseCalendar() {
  const picker = $("expense-date-picker");
  const popover = $("expense-date-popover");
  const trigger = $("expense-date-trigger");
  if (!popover || !picker) return;
  if (closeExpCalTimer) {
    clearTimeout(closeExpCalTimer);
    closeExpCalTimer = null;
  }
  const curVal = $("expense-date") && $("expense-date").value ? $("expense-date").value : todayISO();
  const [y, m] = curVal.split("-").map((n) => parseInt(n, 10));
  if (y && m) expCalViewDate = new Date(y, m - 1, 1);

  expCalOpen = true;
  picker.classList.add("open");
  if (trigger) trigger.setAttribute("aria-expanded", "true");
  popover.classList.remove("hidden", "closing");
  popover.classList.add("opening");

  const grid = $("expense-calendar-grid-days");
  if (grid) grid.classList.add("animate-enter");
  renderExpenseCalendar();
}

function closeExpenseCalendar(animate = true) {
  const picker = $("expense-date-picker");
  const popover = $("expense-date-popover");
  const trigger = $("expense-date-trigger");
  if (!popover || !picker) return;
  expCalOpen = false;
  picker.classList.remove("open");
  if (trigger) trigger.setAttribute("aria-expanded", "false");

  if (animate && !popover.classList.contains("hidden")) {
    popover.classList.remove("opening");
    popover.classList.add("closing");
    if (closeExpCalTimer) clearTimeout(closeExpCalTimer);
    closeExpCalTimer = setTimeout(() => {
      popover.classList.add("hidden");
      popover.classList.remove("closing");
      closeExpCalTimer = null;
    }, 180);
  } else {
    popover.classList.add("hidden");
    popover.classList.remove("opening", "closing");
  }
}

function renderExpenseCalendar() {
  populateYearSelectElement($("exp-cal-year-select"), expCalViewDate.getFullYear());
  const monthSel = $("exp-cal-month-select");
  if (monthSel) monthSel.value = expCalViewDate.getMonth();

  const { min: calMin, max: calMax } = calendarBounds();
  if ($("exp-cal-prev")) $("exp-cal-prev").disabled = expCalViewDate <= calMin;
  if ($("exp-cal-next")) $("exp-cal-next").disabled = expCalViewDate >= calMax;

  const daysGrid = $("expense-calendar-grid-days");
  if (!daysGrid) return;
  daysGrid.innerHTML = "";

  const year = expCalViewDate.getFullYear();
  const month = expCalViewDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevMonthDays = new Date(year, month, 0).getDate();

  const curTodayISO = todayISO();
  const currentPickedISO = $("expense-date") ? $("expense-date").value : curTodayISO;
  const monthPrefix = toLocalMonthPrefix(expCalViewDate);
  const expenseDatesSet = new Set(
    expenses.filter((e) => e.dateISO && e.dateISO.startsWith(monthPrefix)).map((e) => e.dateISO)
  );

  let cellIdx = 0;
  for (let i = firstDay - 1; i >= 0; i--) {
    const btn = document.createElement("button");
    btn.className = "calendar-day-cell other-month";
    btn.textContent = prevMonthDays - i;
    btn.type = "button";
    btn.style.animationDelay = `${cellIdx * 0.005}s`;
    cellIdx++;
    daysGrid.appendChild(btn);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateObj = new Date(year, month, d);
    const dateISO = toLocalISO(dateObj);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "calendar-day-cell";
    btn.textContent = d;
    btn.style.animationDelay = `${cellIdx * 0.005}s`;
    cellIdx++;

    if (dateISO === curTodayISO) btn.classList.add("today");
    if (dateISO === currentPickedISO) btn.classList.add("selected");
    if (expenseDatesSet.has(dateISO)) btn.classList.add("has-expenses");

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      setExpenseDateValue(dateISO);
      closeExpenseCalendar(true);
    });

    daysGrid.appendChild(btn);
  }
}

if ($("expense-date-trigger")) {
  $("expense-date-trigger").addEventListener("click", (e) => {
    e.stopPropagation();
    if (expCalOpen) closeExpenseCalendar(true);
    else openExpenseCalendar();
  });
}
if ($("exp-cal-prev")) {
  $("exp-cal-prev").addEventListener("click", (e) => {
    e.stopPropagation();
    const next = new Date(expCalViewDate.getFullYear(), expCalViewDate.getMonth() - 1, 1);
    const { min } = calendarBounds();
    if (next < min) return;
    expCalViewDate = next;
    renderExpenseCalendar();
  });
}
if ($("exp-cal-next")) {
  $("exp-cal-next").addEventListener("click", (e) => {
    e.stopPropagation();
    const next = new Date(expCalViewDate.getFullYear(), expCalViewDate.getMonth() + 1, 1);
    const { max } = calendarBounds();
    if (next > max) return;
    expCalViewDate = next;
    renderExpenseCalendar();
  });
}
if ($("exp-cal-today-btn")) {
  $("exp-cal-today-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    setExpenseDateValue(todayISO());
    closeExpenseCalendar(true);
  });
}
if ($("exp-cal-month-select")) {
  $("exp-cal-month-select").addEventListener("change", (e) => {
    const m = parseInt(e.target.value, 10);
    expCalViewDate = new Date(expCalViewDate.getFullYear(), m, 1);
    renderExpenseCalendar();
  });
}
if ($("exp-cal-year-select")) {
  $("exp-cal-year-select").addEventListener("change", (e) => {
    const y = parseInt(e.target.value, 10);
    expCalViewDate = new Date(y, expCalViewDate.getMonth(), 1);
    renderExpenseCalendar();
  });
}

function openExpenseSheet(expense) {
  const viewYm = toLocalMonthPrefix(viewDate);
  const targetYm = expense && expense.dateISO
    ? expense.dateISO.slice(0, 7)
    : (selectedDateISO ? selectedDateISO.slice(0, 7) : viewYm);

  if (isPastMonth(targetYm) && !isPastMonthUnlocked(targetYm)) {
    openUnlockPastSheet(targetYm, () => openExpenseSheet(expense));
    return;
  }

  editingId = expense ? expense.id : null;
  $("expense-sheet-title").textContent = expense ? "Edit expense" : "Add expense";
  $("delete-expense-btn").classList.toggle("hidden", !expense);
  $("amount").value = expense ? expense.amount : "";
  $("category").value = expense ? expense.category : "Food";
  $("note").value = expense ? expense.note || "" : "";

  let initialDateISO = toLocalISO(new Date());
  if (expense && expense.dateISO) {
    initialDateISO = expense.dateISO;
  } else if (selectedDateISO) {
    initialDateISO = selectedDateISO;
  } else if (viewYm !== toLocalMonthPrefix(new Date())) {
    initialDateISO = toLocalISO(viewDate);
  }
  closeExpenseCalendar(false);
  setExpenseDateValue(initialDateISO);
  addSheet.classList.remove("hidden");
}
function closeExpenseSheet() {
  closeExpenseCalendar(false);
  expenseForm.reset();
  editingId = null;
  addSheet.classList.add("hidden");
}

addBtn.addEventListener("click", () => openExpenseSheet(null));
$("cancel-add").addEventListener("click", closeExpenseSheet);

// ---------- Recurring bills ----------
function openRecurringSheet(r) {
  editingRecurringId = r ? r.id : null;
  $("recurring-sheet-title").textContent = r ? "Edit recurring bill" : "Add recurring bill";
  $("delete-recurring-btn").classList.toggle("hidden", !r);
  $("r-amount").value = r ? r.amount : "";
  $("r-category").value = r ? r.category : "Bills";
  $("r-note").value = r ? r.note : "";
  $("r-day").value = r ? r.dayOfMonth : 1;
  recurringSheet.classList.remove("hidden");
}
function closeRecurringSheet() {
  recurringForm.reset();
  editingRecurringId = null;
  recurringSheet.classList.add("hidden");
}

recurringForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const amount = parseFloat($("r-amount").value);
  const category = $("r-category").value;
  const note = $("r-note").value.trim();
  const dayOfMonth = Math.min(28, Math.max(1, parseInt($("r-day").value, 10)));
  if (!amount || amount <= 0 || !note) return;

  if (isGuest) {
    if (editingRecurringId) {
      const r = recurring.find((x) => x.id === editingRecurringId);
      if (r) { r.amount = amount; r.category = category; r.note = note; r.dayOfMonth = dayOfMonth; }
      showToast("Recurring bill updated");
    } else {
      recurring.push({
        id: "guest_r_" + Math.random().toString(36).slice(2, 10),
        amount, category, note, dayOfMonth,
      });
      showToast("Recurring bill added");
    }
    saveLocalUserCache();
    recurringApplied = false;
    applyRecurringForThisMonth();
    renderRecurring();
    render();
    closeRecurringSheet();
    return;
  }

  if (editingRecurringId) {
    const r = recurring.find((x) => x.id === editingRecurringId);
    if (r) { r.amount = amount; r.category = category; r.note = note; r.dayOfMonth = dayOfMonth; }
    enqueueSync({ type: "UPDATE_RECURRING", id: editingRecurringId, data: { amount, category, note, dayOfMonth } });
    showToast("Recurring bill updated");
  } else {
    const newRec = {
      id: "cloud_rec_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
      amount, category, note, dayOfMonth,
    };
    recurring.push(newRec);
    enqueueSync({ type: "ADD_RECURRING", data: newRec });
    showToast("Recurring bill added");
  }
  saveLocalUserCache();
  recurringApplied = false;
  applyRecurringForThisMonth();
  renderRecurring();
  render();
  closeRecurringSheet();
});

$("delete-recurring-btn").addEventListener("click", async () => {
  if (!editingRecurringId) return;
  await deleteRecurring(editingRecurringId);
  closeRecurringSheet();
});

$("add-recurring-btn").addEventListener("click", () => openRecurringSheet(null));
$("cancel-recurring").addEventListener("click", closeRecurringSheet);

async function deleteRecurring(id) {
  if (isGuest) {
    recurring = recurring.filter((x) => x.id !== id);
    saveLocalUserCache();
    renderRecurring();
    render();
    showToast("Recurring bill deleted");
    return;
  }
  recurring = recurring.filter((x) => x.id !== id);
  enqueueSync({ type: "DELETE_RECURRING", id });
  saveLocalUserCache();
  renderRecurring();
  render();
  showToast("Recurring bill deleted");
}

// Auto-create this month's expense for any recurring bill whose day has passed
let isApplyingRecurring = false;

async function applyRecurringForThisMonth() {
  if (recurringApplied || (!uid && !isGuest) || recurring.length === 0) return;

  const now = new Date();
  const monthPrefix = toLocalMonthPrefix(now);
  const appliedKey = `budgelist-applied-${uid || "guest"}-${monthPrefix}`;

  if (safeGet(appliedKey) === "true") {
    recurringApplied = true;
    return;
  }

  if (isApplyingRecurring) return;
  isApplyingRecurring = true;

  try {
    const today = now.getDate();

    const alreadyApplied = new Set(
      expenses.filter((e) => e.dateISO && e.dateISO.startsWith(monthPrefix) && e.recurringId).map((e) => e.recurringId)
    );

    const due = recurring.filter((r) => r.dayOfMonth <= today && !alreadyApplied.has(r.id));
    if (due.length === 0) {
      safeSet(appliedKey, "true");
      recurringApplied = true;
      return;
    }

    recurringApplied = true;

    for (const r of due) {
      const day = String(r.dayOfMonth).padStart(2, "0");
      const targetDateISO = `${monthPrefix}-${day}`;

      const exists = expenses.some((e) =>
        (e.recurringId && e.recurringId === r.id && e.dateISO === targetDateISO) ||
        (e.note === r.note && e.amount === r.amount && e.dateISO === targetDateISO)
      );

      if (exists) continue;

      const expData = {
        amount: r.amount, category: r.category, note: r.note,
        dateISO: targetDateISO, createdAt: Date.now(), recurringId: r.id,
      };

      if (isGuest) {
        expenses.unshift({ id: "guest_rec_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6), ...expData });
        saveLocalUserCache();
      } else {
        const newExp = { id: "cloud_rec_exp_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6), ...expData };
        expenses.unshift(newExp);
        enqueueSync({ type: "ADD_EXPENSE", data: newExp });
        saveLocalUserCache();
      }
    }

    reconcileActiveMonthSpend(monthPrefix);
    syncBudgetState();
    safeSet(appliedKey, "true");
  } finally {
    isApplyingRecurring = false;
  }
}

// ---------- Two-Tier Budget System (Global Pool + Month Envelope + Past Lock + Overbudget) ----------
function getMonthBudgetPoolMetrics(ym) {
  const rec = ensureMonthRecord(ym);
  const spentSoFar = monthSpentTotal(ym);
  const allocated = round2(rec.allocated || 0);
  const directCovered = round2(rec.directCovered || 0);
  const unrestrictedDeducted = round2(rec.unrestrictedDeducted || 0);

  // Funds currently drawn from the global pool by this active month
  const currentlyFromPool = allocated > 0
    ? round2(allocated + directCovered)
    : unrestrictedDeducted;

  const maxAllocatable = round2(globalBudget + currentlyFromPool);
  const minAllocatable = round2(Math.min(maxAllocatable, spentSoFar));

  return {
    rec,
    spentSoFar,
    allocated,
    directCovered,
    unrestrictedDeducted,
    currentlyFromPool,
    maxAllocatable,
    minAllocatable,
  };
}

let lastMinFloorToastTime = 0;

function triggerMinFloorFeedback(minAllocatable, spentSoFar, showToastAlert = true) {
  const noticeEl = $("month-budget-sheet-notice");

  if (noticeEl) {
    noticeEl.textContent = `Minimum budget for this month is ${fmt(minAllocatable)} because ${fmt(spentSoFar)} has already been spent. (Tap 'Unrestrict' below to remove the monthly limit.)`;
    noticeEl.classList.remove("hidden");
  }

  const now = Date.now();
  if (showToastAlert && now - lastMinFloorToastTime > 1200) {
    lastMinFloorToastTime = now;
    showToast(`Minimum is ${fmt(minAllocatable)} (${fmt(spentSoFar)} already spent)`);
  }
}

function updateMonthBudgetSheetVisuals(amountVal, animateThumb = false, forceMinNotice = false) {
  const ym = toLocalMonthPrefix(viewDate);
  const { maxAllocatable, minAllocatable, spentSoFar } = getMonthBudgetPoolMetrics(ym);
  const slider = $("month-budget-slider");
  const fill = $("month-budget-slider-fill");
  const minFill = $("month-budget-slider-min-fill");
  const minTick = $("month-budget-slider-min-tick");
  const minWrap = $("month-sheet-min-wrap");
  const minAllocEl = $("month-sheet-min-alloc");
  const pctLabel = $("month-budget-slider-pct");
  const noticeEl = $("month-budget-sheet-notice");

  const minPct = maxAllocatable > 0
    ? Math.min(100, Math.max(0, Math.round((minAllocatable / maxAllocatable) * 100)))
    : 0;

  if (minFill) minFill.style.width = `${minPct}%`;
  if (minTick) {
    if (minPct > 0 && minPct < 100) {
      minTick.style.left = `${minPct}%`;
      minTick.classList.remove("hidden");
    } else {
      minTick.classList.add("hidden");
    }
  }
  if (minWrap && minAllocEl) {
    if (minAllocatable > 0) {
      minAllocEl.textContent = fmt(minAllocatable);
      minWrap.classList.remove("hidden");
    } else {
      minWrap.classList.add("hidden");
    }
  }

  const clampedVal = maxAllocatable > 0
    ? Math.min(maxAllocatable, Math.max(0, round2(amountVal)))
    : 0;
  const targetPct = maxAllocatable > 0
    ? Math.min(100, Math.max(0, Math.round((clampedVal / maxAllocatable) * 100)))
    : 0;

  if (fill) fill.style.width = `${targetPct}%`;
  if (pctLabel) pctLabel.textContent = `${targetPct}%`;

  if (slider) {
    if (sliderAnimFrame) {
      cancelAnimationFrame(sliderAnimFrame);
      sliderAnimFrame = null;
    }
    if (animateThumb) {
      const startVal = parseFloat(slider.value) || 0;
      const diff = targetPct - startVal;
      if (Math.abs(diff) > 0.5) {
        const duration = 240;
        const startTime = performance.now();
        const stepAnim = (now) => {
          const t = Math.min(1, (now - startTime) / duration);
          const eased = 1 - Math.pow(1 - t, 3); // cubic ease-out
          slider.value = String(Math.round(startVal + diff * eased));
          if (t < 1) {
            sliderAnimFrame = requestAnimationFrame(stepAnim);
          } else {
            slider.value = String(targetPct);
            sliderAnimFrame = null;
          }
        };
        sliderAnimFrame = requestAnimationFrame(stepAnim);
      } else {
        slider.value = String(targetPct);
      }
    } else {
      slider.value = String(targetPct);
    }
  }

  document.querySelectorAll(".budget-pct-btn").forEach((btn) => {
    const btnPct = parseInt(btn.dataset.pct, 10);
    const btnVal = btnPct === 100 ? maxAllocatable : Math.round((btnPct / 100) * maxAllocatable);
    const isBelowMin = maxAllocatable > 0 && btnVal < minAllocatable;
    btn.classList.toggle("below-min", isBelowMin);
    btn.classList.toggle("active", maxAllocatable > 0 && !isBelowMin && targetPct === btnPct);
  });

  if (noticeEl) {
    noticeEl.dataset.openGlobal = "0";
    noticeEl.style.cursor = "";
    if (maxAllocatable <= 0) {
      noticeEl.textContent = `Your Budget Pool is currently ${fmt(0)}. Tap here to add funds to your Budget Pool first →`;
      noticeEl.dataset.openGlobal = "1";
      noticeEl.style.cursor = "pointer";
      noticeEl.classList.remove("hidden");
    } else if (forceMinNotice || (spentSoFar > 0 && clampedVal <= minAllocatable && minAllocatable > 0)) {
      noticeEl.textContent = `Minimum budget for this month is ${fmt(minAllocatable)} because ${fmt(spentSoFar)} has already been spent. (Tap 'Unrestrict' below to remove the monthly limit.)`;
      noticeEl.classList.remove("hidden");
    } else if (clampedVal >= maxAllocatable && maxAllocatable > 0) {
      noticeEl.textContent = `Notice: You are allocating 100% of your available Budget Pool (${fmt(maxAllocatable)}) to this month.`;
      noticeEl.classList.remove("hidden");
    } else {
      noticeEl.classList.add("hidden");
    }
  }
}

function openMonthBudgetSheet() {
  const ym = toLocalMonthPrefix(viewDate);
  if (isPastMonth(ym)) {
    showToast("Past months cannot have a new budget assigned.");
    return;
  }

  const { allocated, maxAllocatable, minAllocatable, spentSoFar } = getMonthBudgetPoolMetrics(ym);
  const titleEl = $("month-budget-sheet-title");
  if (titleEl) titleEl.textContent = `Budget for ${formatMonthYearLabel(ym)}`;

  if ($("month-sheet-global-avail")) $("month-sheet-global-avail").textContent = fmt(globalBudget);
  if ($("month-sheet-max-alloc")) $("month-sheet-max-alloc").textContent = fmt(maxAllocatable);

  const inputEl = $("budget-input");
  const initialVal = allocated > 0
    ? Math.max(minAllocatable, allocated)
    : (minAllocatable > 0 ? minAllocatable : 0);
  if (inputEl) {
    inputEl.min = String(minAllocatable);
    inputEl.max = String(maxAllocatable);
    inputEl.value = initialVal > 0 ? initialVal : "";
  }

  const unrestrictBtn = $("unrestrict-month-budget-btn");
  if (unrestrictBtn) {
    unrestrictBtn.classList.toggle("hidden", allocated <= 0 && spentSoFar <= 0);
  }

  const slider = $("month-budget-slider");
  if (slider) slider.disabled = maxAllocatable <= 0;

  updateMonthBudgetSheetVisuals(initialVal, false, minAllocatable > 0 && initialVal <= minAllocatable);
  budgetSheet.classList.remove("hidden");
}

const monthBudgetSlider = $("month-budget-slider");
const monthBudgetInput = $("budget-input");
const sliderWrap = document.querySelector(".budget-slider-wrap");

if (monthBudgetSlider) {
  monthBudgetSlider.addEventListener("pointerdown", () => {
    if (sliderWrap) sliderWrap.classList.add("dragging");
  });
  monthBudgetSlider.addEventListener("pointerup", () => {
    if (sliderWrap) sliderWrap.classList.remove("dragging");
  });
  monthBudgetSlider.addEventListener("input", (e) => {
    const ym = toLocalMonthPrefix(viewDate);
    const { maxAllocatable, minAllocatable, spentSoFar } = getMonthBudgetPoolMetrics(ym);
    if (maxAllocatable <= 0) return;
    const pct = parseInt(e.target.value, 10) || 0;
    const rawVal = pct === 100 ? maxAllocatable : Math.round((pct / 100) * maxAllocatable);

    if (minAllocatable > 0 && rawVal < minAllocatable) {
      if (monthBudgetInput) monthBudgetInput.value = minAllocatable;
      updateMonthBudgetSheetVisuals(minAllocatable, false, true);
      triggerMinFloorFeedback(minAllocatable, spentSoFar, true);
      return;
    }

    if (monthBudgetInput) monthBudgetInput.value = rawVal;
    updateMonthBudgetSheetVisuals(rawVal, false, false);
  });
}

if (monthBudgetInput) {
  monthBudgetInput.addEventListener("input", (e) => {
    if (sliderWrap) sliderWrap.classList.remove("dragging");
    const ym = toLocalMonthPrefix(viewDate);
    const { minAllocatable, spentSoFar } = getMonthBudgetPoolMetrics(ym);
    const val = parseFloat(e.target.value) || 0;
    const belowFloor = minAllocatable > 0 && val > 0 && val < minAllocatable;
    updateMonthBudgetSheetVisuals(val, true, belowFloor);
    if (belowFloor) {
      triggerMinFloorFeedback(minAllocatable, spentSoFar, false);
    }
  });
}

document.querySelectorAll(".budget-pct-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const ym = toLocalMonthPrefix(viewDate);
    const { maxAllocatable, minAllocatable, spentSoFar } = getMonthBudgetPoolMetrics(ym);
    if (maxAllocatable <= 0) {
      showToast("Add funds to your Budget first");
      return;
    }
    if (sliderWrap) sliderWrap.classList.remove("dragging");
    const pct = parseInt(btn.dataset.pct, 10) || 0;
    const rawTarget = pct === 100 ? maxAllocatable : Math.round((pct / 100) * maxAllocatable);
    if (minAllocatable > 0 && rawTarget < minAllocatable) {
      if (monthBudgetInput) monthBudgetInput.value = minAllocatable;
      updateMonthBudgetSheetVisuals(minAllocatable, true, true);
      triggerMinFloorFeedback(minAllocatable, spentSoFar, true);
      return;
    }
    if (monthBudgetInput) monthBudgetInput.value = rawTarget;
    updateMonthBudgetSheetVisuals(rawTarget, true, false);
  });
});

budgetForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const ym = toLocalMonthPrefix(viewDate);
  if (isPastMonth(ym)) return;

  const { rec, maxAllocatable, minAllocatable, spentSoFar } = getMonthBudgetPoolMetrics(ym);
  const rawVal = round2(parseFloat($("budget-input").value) || 0);

  if (rawVal <= 0) {
    // Unrestrict the month and return unspent to globalBudget
    rec.allocated = 0;
    rec.directCovered = 0;
    const deductForSpent = Math.min(maxAllocatable, spentSoFar);
    rec.unrestrictedDeducted = deductForSpent;
    globalBudget = Math.max(0, round2(maxAllocatable - deductForSpent));
    syncBudgetState();
    budgetSheet.classList.add("hidden");
    render();
    showToast("Month set to unrestricted budget");
    return;
  }

  if (rawVal > maxAllocatable) {
    showToast(`Cannot exceed available Budget (${fmt(maxAllocatable)})`);
    $("budget-input").value = maxAllocatable;
    updateMonthBudgetSheetVisuals(maxAllocatable, true);
    return;
  }

  if (rawVal < minAllocatable) {
    showToast(`Minimum budget for this month is ${fmt(minAllocatable)} (already spent)`);
    $("budget-input").value = minAllocatable;
    updateMonthBudgetSheetVisuals(minAllocatable, true);
    return;
  }

  rec.allocated = rawVal;
  rec.directCovered = 0;
  rec.unrestrictedDeducted = 0;
  rec.status = "active";
  globalBudget = Math.max(0, round2(maxAllocatable - rawVal));

  syncBudgetState();
  budgetSheet.classList.add("hidden");
  render();
  showToast(`Month budget set to ${fmt(rawVal)}`);
});

const unrestrictMonthBtn = $("unrestrict-month-budget-btn");
if (unrestrictMonthBtn) {
  unrestrictMonthBtn.addEventListener("click", () => {
    const ym = toLocalMonthPrefix(viewDate);
    if (isPastMonth(ym)) return;
    const { rec, maxAllocatable, spentSoFar } = getMonthBudgetPoolMetrics(ym);
    rec.allocated = 0;
    rec.directCovered = 0;
    const deductForSpent = Math.min(maxAllocatable, spentSoFar);
    rec.unrestrictedDeducted = deductForSpent;
    globalBudget = Math.max(0, round2(maxAllocatable - deductForSpent));
    syncBudgetState();
    budgetSheet.classList.add("hidden");
    render();
    showToast("Month budget removed — unused funds returned to Budget");
  });
}

budgetBtn.addEventListener("click", openMonthBudgetSheet);
const summaryStatBudgetCard = $("summary-stat-budget");
if (summaryStatBudgetCard) {
  summaryStatBudgetCard.addEventListener("click", (e) => {
    if (e.target && e.target.closest(".help-tip-btn")) return;
    const ym = toLocalMonthPrefix(viewDate);
    if (!isPastMonth(ym)) {
      openMonthBudgetSheet();
    }
  });
}
const monthSheetNoticeEl = $("month-budget-sheet-notice");
if (monthSheetNoticeEl) {
  monthSheetNoticeEl.addEventListener("click", () => {
    if (monthSheetNoticeEl.dataset.openGlobal === "1") {
      budgetSheet.classList.add("hidden");
      openGlobalBudgetSheet();
    }
  });
}
$("cancel-budget").addEventListener("click", () => budgetSheet.classList.add("hidden"));

// ---------- Global Budget & History Sheet ----------
const globalBudgetSheet = $("global-budget-sheet");
const globalBudgetForm = $("global-budget-form");

function renderBudgetHistoryList() {
  const balanceEl = $("global-sheet-balance");
  if (balanceEl) balanceEl.textContent = fmt(globalBudget);

  const listEl = $("budget-history-list");
  const emptyEl = $("budget-history-empty");
  const clearBtn = $("clear-budget-history-btn");
  const confirmBox = $("clear-budget-confirm-box");
  if (!listEl || !emptyEl) return;

  const items = Array.isArray(budgetHistory) ? budgetHistory : [];
  emptyEl.classList.toggle("hidden", items.length > 0);
  if (clearBtn) clearBtn.classList.toggle("hidden", items.length === 0);
  if (items.length === 0 && confirmBox) confirmBox.classList.add("hidden");

  listEl.innerHTML = "";
  const frag = document.createDocumentFragment();
  const dateFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });

  items.forEach((item) => {
    if (!item) return;
    const li = document.createElement("li");

    const mainDiv = document.createElement("div");
    mainDiv.className = "budget-history-main";

    const descSpan = document.createElement("span");
    descSpan.className = "budget-history-desc";
    descSpan.textContent = item.description || (item.type === "return" ? "Returned from past month" : "Budget added");

    const dateSpan = document.createElement("span");
    dateSpan.className = "budget-history-date";
    dateSpan.textContent = item.createdAt ? dateFmt.format(new Date(item.createdAt)) : "";

    mainDiv.appendChild(descSpan);
    mainDiv.appendChild(dateSpan);

    const rightDiv = document.createElement("div");
    rightDiv.className = "budget-history-right";

    const amtSpan = document.createElement("span");
    amtSpan.className = "budget-history-amount";
    amtSpan.textContent = `+${fmt(round2(item.amount || 0))}`;

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "recurring-delete";
    delBtn.setAttribute("aria-label", "Delete history entry");
    delBtn.textContent = "\u00d7";
    delBtn.addEventListener("click", () => {
      const amt = round2(item.amount || 0);
      budgetHistory = budgetHistory.filter((h) => h && h.id !== item.id);
      if (item.type !== "return") {
        globalBudget = Math.max(0, round2(globalBudget - amt));
      }
      syncBudgetState();
      renderBudgetHistoryList();
      render();
      showToast("Budget history entry deleted");
    });

    rightDiv.appendChild(amtSpan);
    rightDiv.appendChild(delBtn);

    li.appendChild(mainDiv);
    li.appendChild(rightDiv);
    frag.appendChild(li);
  });

  listEl.appendChild(frag);
}

function openGlobalBudgetSheet() {
  if ($("clear-budget-confirm-box")) $("clear-budget-confirm-box").classList.add("hidden");
  renderBudgetHistoryList();
  if (globalBudgetSheet) globalBudgetSheet.classList.remove("hidden");
}

function closeGlobalBudgetSheet() {
  if (globalBudgetForm) globalBudgetForm.reset();
  if ($("clear-budget-confirm-box")) $("clear-budget-confirm-box").classList.add("hidden");
  if (globalBudgetSheet) globalBudgetSheet.classList.add("hidden");
}

if ($("open-global-budget-btn")) {
  $("open-global-budget-btn").addEventListener("click", openGlobalBudgetSheet);
}
if ($("close-global-budget-btn")) {
  $("close-global-budget-btn").addEventListener("click", closeGlobalBudgetSheet);
}

if (globalBudgetForm) {
  globalBudgetForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const amtInput = $("global-budget-amount-input");
    const descInput = $("global-budget-desc-input");
    const amount = round2(parseFloat(amtInput ? amtInput.value : "0"));
    if (!amount || amount <= 0) return;

    const desc = descInput && descInput.value.trim() ? descInput.value.trim() : "Budget deposit";
    globalBudget = round2(globalBudget + amount);
    budgetHistory.unshift({
      id: "dep_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
      amount,
      description: desc,
      createdAt: Date.now(),
      type: "deposit",
    });

    globalBudgetForm.reset();
    syncBudgetState();
    renderBudgetHistoryList();
    render();
    showToast(`Added ${fmt(amount)} to Budget`);
  });
}

if ($("clear-budget-history-btn")) {
  $("clear-budget-history-btn").addEventListener("click", () => {
    const box = $("clear-budget-confirm-box");
    if (box) box.classList.toggle("hidden");
  });
}
if ($("cancel-clear-history-btn")) {
  $("cancel-clear-history-btn").addEventListener("click", () => {
    if ($("clear-budget-confirm-box")) $("clear-budget-confirm-box").classList.add("hidden");
  });
}
if ($("clear-history-log-only-btn")) {
  $("clear-history-log-only-btn").addEventListener("click", () => {
    budgetHistory = [];
    if ($("clear-budget-confirm-box")) $("clear-budget-confirm-box").classList.add("hidden");
    syncBudgetState();
    renderBudgetHistoryList();
    render();
    showToast("Budget history log cleared");
  });
}
if ($("clear-history-reset-all-btn")) {
  $("clear-history-reset-all-btn").addEventListener("click", () => {
    budgetHistory = [];
    globalBudget = 0;
    if ($("clear-budget-confirm-box")) $("clear-budget-confirm-box").classList.add("hidden");
    syncBudgetState();
    renderBudgetHistoryList();
    render();
    showToast("Budget reset to $0.00 & history cleared");
  });
}

// ---------- Over-Budget Interception Sheet ----------
function openOverbudgetSheet(ctx) {
  pendingOverbudgetContext = ctx;
  const sheet = $("overbudget-sheet");
  const titleEl = $("overbudget-sheet-title");
  const descEl = $("overbudget-sheet-desc");
  const incMonthBtn = $("overbudget-increase-month-btn");
  const deductGlobalBtn = $("overbudget-deduct-global-btn");
  const forceSaveBtn = $("overbudget-force-save-btn");

  if (!sheet || !descEl) return;
  const monthLabel = formatMonthYearLabel(ctx.targetYm);

  if (ctx.mode === "restricted") {
    if (globalBudget >= ctx.deficit) {
      if (titleEl) titleEl.textContent = "Month Budget Exceeded";
      descEl.className = "warning caution";
      descEl.textContent = `This expense exceeds your remaining monthly budget for ${monthLabel} by ${fmt(ctx.deficit)}. You have ${fmt(globalBudget)} available in your Budget to cover it.`;

      if (incMonthBtn) {
        incMonthBtn.textContent = `Add +${fmt(ctx.deficit)} to Month Budget`;
        incMonthBtn.classList.remove("hidden");
      }
      if (deductGlobalBtn) {
        deductGlobalBtn.textContent = `Instant Deduction (-${fmt(ctx.deficit)} from Budget)`;
        deductGlobalBtn.classList.remove("hidden");
      }
      if (forceSaveBtn) forceSaveBtn.classList.add("hidden");
    } else {
      if (titleEl) titleEl.textContent = "Month & Global Budget Exceeded";
      descEl.className = "warning critical";
      const shortBy = round2(ctx.deficit - globalBudget);
      descEl.textContent = globalBudget > 0
        ? `Over-Budget Warning: This expense exceeds your monthly budget by ${fmt(ctx.deficit)}, and your available Budget (${fmt(globalBudget)}) is short by ${fmt(shortBy)}.`
        : `Over-Budget Warning: This expense exceeds your monthly budget by ${fmt(ctx.deficit)}, and your Budget has ${fmt(0)} remaining.`;

      if (incMonthBtn) incMonthBtn.classList.add("hidden");
      if (deductGlobalBtn) deductGlobalBtn.classList.add("hidden");
      if (forceSaveBtn) {
        forceSaveBtn.textContent = globalBudget > 0
          ? `Use Available (${fmt(globalBudget)}) & Log Over-Budget`
          : "Log Expense as Over-Budget";
        forceSaveBtn.classList.remove("hidden");
      }
    }
  } else {
    // Unrestricted month over globalBudget
    if (titleEl) titleEl.textContent = "Global Budget Exceeded";
    descEl.className = "warning critical";
    descEl.textContent = globalBudget > 0
      ? `Global Over-Budget Warning: This expense (${fmt(ctx.netDelta)}) exceeds your available Budget (${fmt(globalBudget)}) by ${fmt(ctx.deficit)}.`
      : `Global Over-Budget Warning: Your available Budget is ${fmt(0)}. Logging this expense will exceed your Budget by ${fmt(ctx.deficit)}.`;

    if (incMonthBtn) incMonthBtn.classList.add("hidden");
    if (deductGlobalBtn) deductGlobalBtn.classList.add("hidden");
    if (forceSaveBtn) {
      forceSaveBtn.textContent = globalBudget > 0
        ? `Deduct Available (${fmt(globalBudget)}) & Log Over-Budget`
        : "Log Expense as Over-Budget";
      forceSaveBtn.classList.remove("hidden");
    }
  }

  sheet.classList.remove("hidden");
}

function closeOverbudgetSheet() {
  pendingOverbudgetContext = null;
  if ($("overbudget-sheet")) $("overbudget-sheet").classList.add("hidden");
}

if ($("overbudget-increase-month-btn")) {
  $("overbudget-increase-month-btn").addEventListener("click", () => {
    if (!pendingOverbudgetContext) return;
    const ctx = pendingOverbudgetContext;
    const rec = ensureMonthRecord(ctx.targetYm);
    rec.allocated = round2((rec.allocated || 0) + ctx.deficit);
    globalBudget = Math.max(0, round2(globalBudget - ctx.deficit));
    closeOverbudgetSheet();
    commitExpenseSave(ctx.pendingExpense);
    showToast(`Added ${fmt(ctx.deficit)} to month budget`);
  });
}

if ($("overbudget-deduct-global-btn")) {
  $("overbudget-deduct-global-btn").addEventListener("click", () => {
    if (!pendingOverbudgetContext) return;
    const ctx = pendingOverbudgetContext;
    const rec = ensureMonthRecord(ctx.targetYm);
    rec.directCovered = round2((rec.directCovered || 0) + ctx.deficit);
    globalBudget = Math.max(0, round2(globalBudget - ctx.deficit));
    closeOverbudgetSheet();
    commitExpenseSave(ctx.pendingExpense);
    showToast(`Deducted ${fmt(ctx.deficit)} directly from Budget`);
  });
}

if ($("overbudget-force-save-btn")) {
  $("overbudget-force-save-btn").addEventListener("click", () => {
    if (!pendingOverbudgetContext) return;
    const ctx = pendingOverbudgetContext;
    if (ctx.mode === "restricted" && globalBudget > 0) {
      const rec = ensureMonthRecord(ctx.targetYm);
      rec.directCovered = round2((rec.directCovered || 0) + globalBudget);
      globalBudget = 0;
    }
    closeOverbudgetSheet();
    commitExpenseSave(ctx.pendingExpense);
  });
}

if ($("overbudget-open-global-btn")) {
  $("overbudget-open-global-btn").addEventListener("click", () => {
    closeOverbudgetSheet();
    openGlobalBudgetSheet();
  });
}

if ($("overbudget-cancel-btn")) {
  $("overbudget-cancel-btn").addEventListener("click", closeOverbudgetSheet);
}

// ---------- Past Month Lock / Unlock Sheet ----------
function openUnlockPastSheet(ym, onUnlockedCallback) {
  pendingUnlockYm = ym;
  pendingUnlockCallback = onUnlockedCallback || null;
  const titleEl = $("unlock-past-sheet-title");
  if (titleEl) titleEl.textContent = `Unlock ${formatMonthYearLabel(ym)}?`;
  if ($("unlock-past-sheet")) $("unlock-past-sheet").classList.remove("hidden");
}

function closeUnlockPastSheet() {
  pendingUnlockYm = null;
  pendingUnlockCallback = null;
  if ($("unlock-past-sheet")) $("unlock-past-sheet").classList.add("hidden");
}

function togglePastMonthLock(ym) {
  if (!isPastMonth(ym)) return;
  const rec = ensureMonthRecord(ym);
  if (rec.unlocked) {
    rec.unlocked = false;
    syncBudgetState();
    render();
    showToast(`${formatMonthYearLabel(ym)} locked`);
  } else {
    openUnlockPastSheet(ym, null);
  }
}

if ($("cancel-unlock-past-btn")) {
  $("cancel-unlock-past-btn").addEventListener("click", closeUnlockPastSheet);
}
if ($("confirm-unlock-past-btn")) {
  $("confirm-unlock-past-btn").addEventListener("click", () => {
    if (!pendingUnlockYm) return;
    const ym = pendingUnlockYm;
    const cb = pendingUnlockCallback;
    const rec = ensureMonthRecord(ym);
    rec.unlocked = true;
    closeUnlockPastSheet();
    syncBudgetState();
    render();
    showToast(`${formatMonthYearLabel(ym)} unlocked for historical editing`);
    if (typeof cb === "function") cb();
  });
}
if ($("past-month-lock-btn")) {
  $("past-month-lock-btn").addEventListener("click", () => {
    togglePastMonthLock(toLocalMonthPrefix(viewDate));
  });
}
if ($("past-month-notice-btn")) {
  $("past-month-notice-btn").addEventListener("click", () => {
    togglePastMonthLock(toLocalMonthPrefix(viewDate));
  });
}

// ---------- Month navigation & Calendar popover controls ----------
const monthLabelFmt = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
let closeCalendarTimer = null;

function openCalendar() {
  const popover = $("calendar-popover");
  if (!popover) return;
  if (closeCalendarTimer) {
    clearTimeout(closeCalendarTimer);
    closeCalendarTimer = null;
  }
  calendarOpen = true;
  popover.classList.remove("hidden", "closing");
  popover.classList.add("opening");

  const grid = $("calendar-grid-days");
  if (grid) grid.classList.add("animate-enter");

  renderCalendar();
}

function closeCalendar(animate = true) {
  const popover = $("calendar-popover");
  if (!popover) return;
  calendarOpen = false;

  if (animate && !popover.classList.contains("hidden")) {
    popover.classList.remove("opening");
    popover.classList.add("closing");
    if (closeCalendarTimer) clearTimeout(closeCalendarTimer);
    closeCalendarTimer = setTimeout(() => {
      popover.classList.add("hidden");
      popover.classList.remove("closing");
      closeCalendarTimer = null;
    }, 180);
  } else {
    popover.classList.add("hidden");
    popover.classList.remove("opening", "closing");
  }
}

function toggleCalendar() {
  if (calendarOpen) closeCalendar(true);
  else openCalendar();
}

// Navigable calendar range shared by arrows, swipe and the month/year selects.
const CAL_MIN_YEAR = 1970;
const CAL_FUTURE_YEARS = 50;
const YEAR_SELECT_SPAN = 10;
function calendarBounds() {
  const maxYear = new Date().getFullYear() + CAL_FUTURE_YEARS;
  return { min: new Date(CAL_MIN_YEAR, 0, 1), max: new Date(maxYear, 11, 1) };
}

function dayBounds() {
  const maxYear = new Date().getFullYear() + CAL_FUTURE_YEARS;
  return { min: new Date(CAL_MIN_YEAR, 0, 1), max: new Date(maxYear, 11, 31) };
}

function getTargetDayForDelta(delta) {
  const realNow = new Date();
  let baseDate;
  if (selectedDateISO) {
    const [y, m, d] = selectedDateISO.split("-").map((n) => parseInt(n, 10));
    baseDate = new Date(y, m - 1, d);
  } else {
    const isCurrentMonthView = toLocalMonthPrefix(viewDate) === toLocalMonthPrefix(realNow);
    if (isCurrentMonthView) {
      baseDate = new Date(realNow.getFullYear(), realNow.getMonth(), realNow.getDate());
    } else if (delta > 0) {
      baseDate = new Date(viewDate.getFullYear(), viewDate.getMonth(), 0);
    } else {
      baseDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1);
    }
  }
  return new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + delta);
}

function changeMonth(delta) {
  const next = new Date(viewDate.getFullYear(), viewDate.getMonth() + delta, 1);
  const { min, max } = calendarBounds();
  if (next < min || next > max) return;
  viewDate = next;
  selectedDateISO = null;
  const grid = $("calendar-grid-days");
  if (grid) grid.classList.add("animate-enter");
  render();
}

function changeDay(delta) {
  const nextDate = getTargetDayForDelta(delta);
  const { min, max } = dayBounds();
  if (nextDate < min || nextDate > max) return;
  viewDate = startOfMonth(nextDate);
  selectedDateISO = toLocalISO(nextDate);
  const grid = $("calendar-grid-days");
  if (grid) grid.classList.add("animate-enter");
  render();
}

$("prev-month").addEventListener("click", (e) => {
  e.stopPropagation();
  changeMonth(-1);
});
$("next-month").addEventListener("click", (e) => {
  e.stopPropagation();
  changeMonth(1);
});
if ($("prev-day")) {
  $("prev-day").addEventListener("click", (e) => {
    e.stopPropagation();
    changeDay(-1);
  });
}
if ($("next-day")) {
  $("next-day").addEventListener("click", (e) => {
    e.stopPropagation();
    changeDay(1);
  });
}

// Calendar controls
const calDropdownBtn = $("calendar-dropdown-btn");
if (calDropdownBtn) {
  calDropdownBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleCalendar();
  });
}

const calResetBtn = $("calendar-reset-btn");
if (calResetBtn) {
  calResetBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const realNow = new Date();
    const inCurrentMonth = toLocalMonthPrefix(viewDate) === toLocalMonthPrefix(realNow);
    if (selectedDateISO && inCurrentMonth) {
      selectedDateISO = null;
    } else {
      viewDate = startOfMonth(realNow);
      selectedDateISO = null;
    }
    const grid = $("calendar-grid-days");
    if (grid) grid.classList.add("animate-enter");
    render();
  });
}

const calMonthSelect = $("calendar-month-select");
if (calMonthSelect) {
  calMonthSelect.addEventListener("change", (e) => {
    const m = parseInt(e.target.value, 10);
    viewDate = new Date(viewDate.getFullYear(), m, 1);
    selectedDateISO = null;
    const grid = $("calendar-grid-days");
    if (grid) grid.classList.add("animate-enter");
    render();
  });
}

const calYearSelect = $("calendar-year-select");
if (calYearSelect) {
  calYearSelect.addEventListener("change", (e) => {
    const y = parseInt(e.target.value, 10);
    viewDate = new Date(y, viewDate.getMonth(), 1);
    selectedDateISO = null;
    const grid = $("calendar-grid-days");
    if (grid) grid.classList.add("animate-enter");
    render();
  });
}

// ---------- Category sort + chart type controls ----------
$("category-sort").value = categorySort;
$("category-sort").addEventListener("change", (e) => {
  categorySort = e.target.value;
  safeSet("budgelist-cat-sort", categorySort);
  render();
});

document.querySelectorAll(".chip-btn[data-chart]").forEach((btn) => {
  if (btn.dataset.chart === categoryChartType) btn.classList.add("active");
  btn.addEventListener("click", () => {
    categoryChartType = btn.dataset.chart;
    safeSet("budgelist-cat-chart", categoryChartType);
    document.querySelectorAll(".chip-btn[data-chart]").forEach((b) => b.classList.toggle("active", b === btn));
    render();
  });
});

let touchStartX = null;
$("month-nav").addEventListener("touchstart", (e) => (touchStartX = e.touches[0].clientX), { passive: true });
$("month-nav").addEventListener("touchend", (e) => {
  if (touchStartX === null) return;
  const dx = e.changedTouches[0].clientX - touchStartX;
  if (Math.abs(dx) > 50) changeMonth(dx > 0 ? -1 : 1);
  touchStartX = null;
});

// ---------- Toast notification ----------
let toastTimer = null;
function showToast(message) {
  const toast = $("toast");
  const toastMsg = $("toast-message");
  if (!toast || !toastMsg) return;

  toastMsg.textContent = message;
  toast.classList.remove("hidden");

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.add("hidden");
  }, 3000);
}

// ---------- Export / share ----------
function sanitizeCsvCell(val) {
  const str = String(val == null ? "" : val);
  // Neutralize CSV / spreadsheet formula injection (=, +, -, @, leading tab/CR)
  const safeStr = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
  return `"${safeStr.replace(/"/g, '""')}"`;
}

async function exportCsvData() {
  const { monthExpenses } = currentMonthData();
  if (monthExpenses.length === 0) {
    showToast("No expenses to export for this month.");
    return;
  }

  const rows = [['"Date","Category","Note","Amount"']];
  monthExpenses.forEach((e) => {
    const safeDate = `"${String(e.dateISO || "").replace(/"/g, '""')}"`;
    const safeCat = sanitizeCsvCell(e.category || "");
    const safeNote = sanitizeCsvCell(e.note || "");
    const safeAmt = `"${(Number(e.amount) || 0).toFixed(2)}"`;
    rows.push([safeDate, safeCat, safeNote, safeAmt].join(","));
  });
  const csv = rows.join("\n");
  const filename = `budgelist-${toLocalMonthPrefix(viewDate)}.csv`;

  // If running in Capacitor native Android app, use native Android bridge to save directly to Downloads
  if (window.Capacitor && window.AndroidBridge && typeof window.AndroidBridge.saveCsv === "function") {
    try {
      const success = window.AndroidBridge.saveCsv(filename, csv);
      if (success) {
        showToast(`Saved ${filename} to Downloads successfully!`);
        return;
      }
    } catch (err) {
      // Fall through on error
    }
  }

  // 1. Try File System Access API (Prompts native 'Save As' file picker dialog in supported browsers)
  if ("showSaveFilePicker" in window) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{
          description: "CSV File",
          accept: { "text/csv": [".csv"] },
        }],
      });
      const writable = await handle.createWritable();
      await writable.write(csv);
      await writable.close();
      showToast(`Saved ${filename} successfully!`);
      return;
    } catch (err) {
      if (err.name === "AbortError") {
        return; // User cancelled file picker dialog
      }
    }
  }

  // 2. Try Web Share API (Mobile / supported platforms)
  const file = new File([csv], filename, { type: "text/csv" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      showToast(`Exported ${filename}`);
      return;
    } catch (err) {
      if (err.name === "AbortError") {
        return;
      }
    }
  }

  // 3. Fallback: Data URI download
  try {
    const dataUri = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
    const a = document.createElement("a");
    a.href = dataUri;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast(`Exported ${filename}`);
  } catch (err) {
    showToast("Failed to export expenses.");
  }
}

// ---------- Derived data ----------
function currentMonthData() {
  const monthPrefix = toLocalMonthPrefix(viewDate);
  let monthExpenses = expenses.filter((e) => e.dateISO && e.dateISO.startsWith(monthPrefix));
  if (selectedDateISO) {
    monthExpenses = monthExpenses.filter((e) => e.dateISO === selectedDateISO);
  }
  const realNow = new Date();
  const isCurrentMonth = monthPrefix === toLocalMonthPrefix(realNow);
  const daysInMonth = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0).getDate();
  const today = isCurrentMonth ? realNow.getDate() : daysInMonth;
  return { monthPrefix, monthExpenses, isCurrentMonth, daysInMonth, today };
}

// ---------- Rendering ----------
function render() {
  settleElapsedMonths(true);
  const { monthExpenses, isCurrentMonth, daysInMonth, today } = currentMonthData();
  const monthPrefix = toLocalMonthPrefix(viewDate);
  const allMonthExpenses = expenses.filter((e) => e.dateISO && e.dateISO.startsWith(monthPrefix));
  const monthTotal = round2(allMonthExpenses.reduce((s, e) => s + e.amount, 0));

  const realNow = new Date();
  const todayISO = toLocalISO(realNow);

  const monthLabelEl = $("month-label");
  const monthLabelBtn = $("calendar-dropdown-btn");
  const resetBtn = $("calendar-reset-btn");
  const resetTextEl = $("calendar-reset-text");
  const inCurrentMonth = toLocalMonthPrefix(viewDate) === toLocalMonthPrefix(realNow);

  if (selectedDateISO) {
    const [y, m, d] = selectedDateISO.split("-").map((n) => parseInt(n, 10));
    const selDate = new Date(y, m - 1, d);
    if (monthLabelEl) monthLabelEl.textContent = dayLabelFmt.format(selDate);
    if (monthLabelBtn) monthLabelBtn.classList.add("filtered");
    if (resetBtn) {
      resetBtn.classList.remove("hidden");
      resetBtn.title = inCurrentMonth ? "Show full month" : "Reset to current month";
    }
    if (resetTextEl) {
      resetTextEl.textContent = inCurrentMonth ? "✕ Month" : "✕ Today";
    }
  } else {
    if (monthLabelEl) monthLabelEl.textContent = monthLabelFmt.format(viewDate);
    if (monthLabelBtn) monthLabelBtn.classList.remove("filtered");
    if (resetBtn) {
      resetBtn.classList.toggle("hidden", inCurrentMonth);
      resetBtn.title = "Reset to current month";
    }
    if (resetTextEl) {
      resetTextEl.textContent = "✕ Today";
    }
  }

  const { min: calMin, max: calMax } = calendarBounds();
  $("prev-month").disabled = viewDate <= calMin;
  $("next-month").disabled = viewDate >= calMax;

  const { min: dMin, max: dMax } = dayBounds();
  if ($("prev-day")) $("prev-day").disabled = getTargetDayForDelta(-1) < dMin;
  if ($("next-day")) $("next-day").disabled = getTargetDayForDelta(1) > dMax;

  renderSummaryCard(monthTotal);
  renderCategories(monthExpenses);
  renderRecurring();
  renderExpenseList(monthExpenses);
  renderForecast(allMonthExpenses, isCurrentMonth, daysInMonth, today);
  renderDayFilterBanner();
  if (calendarOpen) renderCalendar();
}

const dayFullLabelFmt = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric", year: "numeric" });

function renderDayFilterBanner() {
  const banner = $("day-filter-banner");
  const textEl = $("day-filter-text");
  if (!banner) return;

  if (selectedDateISO) {
    const [y, m, d] = selectedDateISO.split("-").map((n) => parseInt(n, 10));
    const selDate = new Date(y, m - 1, d);
    if (textEl) textEl.textContent = dayFullLabelFmt.format(selDate);
    banner.classList.remove("hidden");
  } else {
    banner.classList.add("hidden");
  }
}

const clearDayFilterBtn = $("clear-day-filter-btn");
if (clearDayFilterBtn) {
  clearDayFilterBtn.addEventListener("click", () => {
    selectedDateISO = null;
    render();
  });
}

function updateSpentProgressBar(spent, limitAmount, modeLabel, stateOverride) {
  const progressFill = $("budget-progress-fill");
  const markerEl = $("budget-progress-marker");
  const spentTagEl = $("budget-progress-spent-tag");
  const startLabelEl = $("budget-progress-start-label");
  const endLabelEl = $("budget-progress-end-label");

  let pct = 0;
  let visualState = stateOverride || "";
  let tagText = `Spent: ${fmt(spent)}`;

  if (limitAmount > 0) {
    if (spent > limitAmount) {
      pct = 100;
      visualState = "over";
      tagText = `Spent: ${fmt(spent)} (+${fmt(round2(spent - limitAmount))} over)`;
    } else {
      pct = Math.min(100, Math.max(0, (spent / limitAmount) * 100));
      if (!visualState) {
        visualState = pct >= 85 && spent > 0 ? "caution" : "";
      }
      tagText = `Spent: ${fmt(spent)} (${Math.round(pct)}%)`;
    }
  } else if (spent > 0) {
    pct = 100;
    visualState = "over";
    tagText = `Spent: ${fmt(spent)} (Over)`;
  } else {
    pct = 0;
    visualState = "neutral";
    tagText = `Spent: ${fmt(0)}`;
  }

  const pctFixed = pct.toFixed(2);

  if (progressFill) {
    progressFill.style.width = `${pctFixed}%`;
    progressFill.className = `budget-progress-fill${visualState && visualState !== "neutral" ? ` ${visualState}` : ""}`;
  }
  if (markerEl) {
    markerEl.style.setProperty("--spent-pct", `${pctFixed}%`);
    markerEl.className = `budget-progress-marker${visualState ? ` ${visualState}` : ""}`;
  }
  if (spentTagEl) {
    spentTagEl.style.left = `${pctFixed}%`;
    spentTagEl.style.transform = `translateX(-${pctFixed}%)`;
    spentTagEl.textContent = tagText;
    spentTagEl.className = `budget-progress-spent-tag${visualState ? ` ${visualState}` : ""}`;
  }
  if (startLabelEl) {
    startLabelEl.textContent = fmt(0);
  }
  if (endLabelEl) {
    endLabelEl.textContent = limitAmount > 0
      ? `${fmt(limitAmount)} ${modeLabel}`
      : "No budget set";
  }
}

function renderSummaryCard(spent) {
  const ym = toLocalMonthPrefix(viewDate);
  const realNowYm = toLocalMonthPrefix(new Date());
  const past = isPastMonth(ym);
  const rec = ensureMonthRecord(ym);

  // Tier 1: Global Budget Pool (always visible & accessible anywhere)
  const globalValEl = $("global-budget-value");
  const globalSubEl = $("global-budget-sub");
  const tipGlobalEl = $("tip-global-budget");
  if (globalValEl) {
    globalValEl.textContent = fmt(globalBudget);
    globalValEl.className = "global-budget-value";
  }
  if (globalSubEl) {
    globalSubEl.textContent = globalBudget > 0 ? "Available reserve" : "Tap + Add to fund";
  }
  if (tipGlobalEl) {
    tipGlobalEl.dataset.tip = globalBudget > 0
      ? `Your Budget Pool holds ${fmt(globalBudget)} in unallocated reserve funds. Allocate part of it to a monthly cap below, or leave months on 'Uses Pool' to deduct expenses directly. Unspent monthly budget automatically returns here once a month ends.`
      : `Your Budget Pool is currently ${fmt(0)}. Tap '+ Add / History' to deposit your income, allowance, or savings—then set a monthly cap or spend directly from this pool.`;
  }

  const monthlyTitleEl = $("monthly-overview-title");
  const monthlyModePill = $("monthly-mode-pill");
  const summaryGrid = $("summary-grid");
  const summarySpentLabel = $("summary-spent-label");
  const summarySpent = $("summary-spent");
  const summarySpentSub = $("summary-spent-sub");
  const summaryStatBudget = $("summary-stat-budget");
  const summaryBudgetLabel = $("summary-budget-label");
  const summaryBudget = $("summary-budget");
  const summaryBudgetSub = $("summary-budget-sub");
  const summaryStatRemaining = $("summary-stat-remaining");
  const summaryRemaining = $("summary-remaining");
  const summaryRemainingLabel = $("summary-remaining-label");
  const summaryRemainingSub = $("summary-remaining-sub");
  const progressWrap = $("budget-progress-wrap");
  const setBudgetBtnEl = $("set-budget-btn");
  const pastLockBtnEl = $("past-month-lock-btn");
  const tipPastLockEl = $("tip-past-lock");
  const tipSpentEl = $("tip-summary-spent");
  const tipBudgetEl = $("tip-summary-budget");
  const tipRemainingEl = $("tip-summary-remaining");
  const pastNotice = $("past-month-notice");
  const pastNoticeText = $("past-month-notice-text");
  const pastNoticeBtn = $("past-month-notice-btn");

  if (summarySpent) summarySpent.textContent = fmt(spent);
  if (summaryStatBudget) summaryStatBudget.classList.toggle("interactive", !past);

  if (past) {
    // Past Month History View: hide forward-looking details (Remaining, Progress Bar, Set Budget)
    if (monthlyTitleEl) monthlyTitleEl.textContent = monthLabelFmt.format(viewDate);
    if (monthlyModePill) monthlyModePill.classList.add("hidden");
    if (setBudgetBtnEl) setBudgetBtnEl.classList.add("hidden");
    if (pastLockBtnEl) {
      pastLockBtnEl.classList.remove("hidden");
      pastLockBtnEl.classList.toggle("unlocked", Boolean(rec.unlocked));
      pastLockBtnEl.textContent = rec.unlocked ? "Unlocked" : "Locked";
    }
    if (tipPastLockEl) tipPastLockEl.classList.remove("hidden");
    if (summaryGrid) summaryGrid.classList.add("two-col");
    if (summaryStatRemaining) summaryStatRemaining.classList.add("hidden");
    if (progressWrap) progressWrap.classList.add("hidden");

    if (summarySpentLabel) summarySpentLabel.textContent = "Total Spent";
    if (summarySpentSub) summarySpentSub.textContent = "Final month total";
    if (tipSpentEl) {
      tipSpentEl.dataset.tip = `Final recorded spending for ${formatMonthYearLabel(ym)} (${fmt(spent)}).`;
    }

    if (summaryBudgetLabel) summaryBudgetLabel.textContent = "Recorded Budget";
    const histAllocated = round2(rec.finalAllocated != null ? rec.finalAllocated : (rec.allocated || 0));
    const retAmt = round2(rec.returnedToGlobal || 0);
    if (summaryBudget) {
      summaryBudget.textContent = histAllocated > 0 ? fmt(histAllocated) : "No Cap";
    }
    if (summaryBudgetSub) {
      summaryBudgetSub.textContent = histAllocated > 0 ? "Historical cap" : "Used Budget Pool";
    }
    if (tipBudgetEl) {
      tipBudgetEl.dataset.tip = histAllocated > 0
        ? `${formatMonthYearLabel(ym)} had a ${fmt(histAllocated)} monthly budget cap.${retAmt > 0 ? ` ${fmt(retAmt)} unspent was returned to your Budget Pool.` : ""}`
        : `No separate monthly cap was set for ${formatMonthYearLabel(ym)}—expenses drew directly from your Budget Pool.`;
    }

    if (pastNotice && pastNoticeText && pastNoticeBtn) {
      pastNotice.classList.remove("hidden");
      pastNotice.classList.toggle("unlocked", Boolean(rec.unlocked));
      if (rec.unlocked) {
        pastNoticeText.textContent = "Past month unlocked — Editing expenses updates this month's history only and will not affect your current Budget Pool.";
        pastNoticeBtn.textContent = "Lock month";
      } else {
        pastNoticeText.textContent = histAllocated > 0
          ? `Past Month History (Locked) · ${retAmt > 0 ? `Returned ${fmt(retAmt)} to Budget Pool.` : "Settled."}`
          : "Past Month History (Locked) · Used Budget Pool.";
        pastNoticeBtn.textContent = "Unlock";
      }
    }
    return;
  }

  // Current or Future Month View
  const allocated = round2(rec.allocated || 0);
  const isCurrent = ym === realNowYm;

  if (monthlyTitleEl) {
    monthlyTitleEl.textContent = isCurrent ? "This Month" : monthLabelFmt.format(viewDate);
  }
  if (monthlyModePill) {
    monthlyModePill.classList.remove("hidden");
    monthlyModePill.classList.toggle("capped", allocated > 0);
    monthlyModePill.textContent = allocated > 0 ? "Monthly Cap" : "Uses Pool";
  }
  if (setBudgetBtnEl) {
    setBudgetBtnEl.classList.remove("hidden");
    setBudgetBtnEl.textContent = allocated > 0 ? "Edit month budget" : "Set month budget";
  }
  if (pastLockBtnEl) pastLockBtnEl.classList.add("hidden");
  if (tipPastLockEl) tipPastLockEl.classList.add("hidden");
  if (pastNotice) pastNotice.classList.add("hidden");
  if (summaryGrid) summaryGrid.classList.remove("two-col");
  if (summaryStatRemaining) summaryStatRemaining.classList.remove("hidden");
  if (progressWrap) progressWrap.classList.remove("hidden");

  if (summarySpentLabel) summarySpentLabel.textContent = "Spent";
  if (summarySpentSub) summarySpentSub.textContent = isCurrent ? "So far this month" : "Scheduled total";
  if (tipSpentEl) {
    tipSpentEl.dataset.tip = isCurrent
      ? `Total expenses logged across ${formatMonthYearLabel(ym)} so far (${fmt(spent)}).`
      : `Total scheduled expenses logged for ${formatMonthYearLabel(ym)} (${fmt(spent)}).`;
  }

  if (allocated > 0) {
    // Restricted Month Mode (Fixed Monthly Cap)
    if (summaryBudgetLabel) summaryBudgetLabel.textContent = "Month Budget";
    if (summaryBudget) summaryBudget.textContent = fmt(allocated);
    if (summaryBudgetSub) summaryBudgetSub.textContent = "Monthly cap";
    const directCov = round2(rec.directCovered || 0);
    if (tipBudgetEl) {
      tipBudgetEl.dataset.tip =
        `Fixed spending cap of ${fmt(allocated)} borrowed from your Budget Pool for ${formatMonthYearLabel(ym)}.` +
        (directCov > 0 ? ` (An extra ${fmt(directCov)} overage was covered directly from your Budget Pool.)` : "") +
        " Any unspent amount automatically returns to your Budget Pool when the month ends. Tap to edit.";
    }

    const remaining = round2(allocated - spent);
    if (remaining < 0) {
      if (summaryRemainingLabel) summaryRemainingLabel.textContent = "Over";
      if (summaryRemaining) {
        summaryRemaining.textContent = fmt(Math.abs(remaining));
        summaryRemaining.className = "summary-stat-value warn";
      }
      if (summaryRemainingSub) summaryRemainingSub.textContent = "Above cap";
      if (tipRemainingEl) {
        tipRemainingEl.dataset.tip = `You have exceeded your ${fmt(allocated)} monthly cap by ${fmt(Math.abs(remaining))} (${fmt(spent)} spent).`;
      }
      updateSpentProgressBar(spent, allocated, "cap", "over");
    } else {
      if (summaryRemainingLabel) summaryRemainingLabel.textContent = "Remaining";
      const isTight = spent > 0 && remaining <= allocated * 0.15;
      if (summaryRemaining) {
        summaryRemaining.textContent = fmt(remaining);
        summaryRemaining.className = `summary-stat-value ${isTight ? "caution" : "safe"}`;
      }
      if (summaryRemainingSub) summaryRemainingSub.textContent = "Left in cap";
      if (tipRemainingEl) {
        tipRemainingEl.dataset.tip = `${fmt(remaining)} remaining out of your ${fmt(allocated)} monthly cap (${fmt(spent)} spent so far).`;
      }
      updateSpentProgressBar(spent, allocated, "cap", "");
    }
  } else {
    // Unrestricted Month Mode (Draws directly from Budget Pool)
    const unrestrictedDeducted = round2(rec.unrestrictedDeducted || 0);
    const effectivePool = round2(globalBudget + unrestrictedDeducted);

    if (effectivePool > 0 || spent > 0) {
      if (summaryBudgetLabel) summaryBudgetLabel.textContent = "Pool Limit";
      if (summaryBudget) summaryBudget.textContent = fmt(effectivePool);
      if (summaryBudgetSub) {
        summaryBudgetSub.textContent = unrestrictedDeducted > 0 ? "Spent + pool" : "From Budget Pool";
      }
      if (tipBudgetEl) {
        tipBudgetEl.dataset.tip = unrestrictedDeducted > 0
          ? `No separate monthly cap is set, so expenses deduct directly from your Budget Pool. Pool Limit (${fmt(effectivePool)}) = ${fmt(unrestrictedDeducted)} already deducted for this month's expenses + ${fmt(globalBudget)} remaining in your Budget Pool. Tap 'Set month budget' to set a fixed monthly cap.`
          : `No separate monthly cap is set, so this month can use up to ${fmt(effectivePool)} from your Budget Pool. Tap 'Set month budget' if you want a smaller monthly spending cap.`;
      }

      const remaining = round2(effectivePool - spent);
      if (remaining < 0) {
        if (summaryRemainingLabel) summaryRemainingLabel.textContent = "Over";
        if (summaryRemaining) {
          summaryRemaining.textContent = fmt(Math.abs(remaining));
          summaryRemaining.className = "summary-stat-value warn";
        }
        if (summaryRemainingSub) summaryRemainingSub.textContent = "Above pool";
        if (tipRemainingEl) {
          tipRemainingEl.dataset.tip = `This month's spending (${fmt(spent)}) exceeds your Budget Pool capacity (${fmt(effectivePool)}) by ${fmt(Math.abs(remaining))}.`;
        }
        updateSpentProgressBar(spent, effectivePool, "pool", "over");
      } else {
        if (summaryRemainingLabel) summaryRemainingLabel.textContent = "Remaining";
        const isTight = effectivePool > 0 && spent > 0 && globalBudget <= effectivePool * 0.15;
        if (summaryRemaining) {
          summaryRemaining.textContent = fmt(globalBudget);
          summaryRemaining.className = `summary-stat-value ${isTight ? "caution" : "safe"}`;
        }
        if (summaryRemainingSub) summaryRemainingSub.textContent = "Left in pool";
        if (tipRemainingEl) {
          tipRemainingEl.dataset.tip = `${fmt(globalBudget)} remaining in your Budget Pool after ${fmt(spent)} spent this month.`;
        }
        updateSpentProgressBar(spent, effectivePool, "pool", "");
      }
    } else {
      if (summaryBudgetLabel) summaryBudgetLabel.textContent = "Month Budget";
      if (summaryBudget) summaryBudget.textContent = fmt(0);
      if (summaryBudgetSub) summaryBudgetSub.textContent = "Add pool first";
      if (tipBudgetEl) {
        tipBudgetEl.dataset.tip = "No budget set yet. Tap '+ Add / History' on Budget Pool above to add funds first, then optionally set a monthly cap here.";
      }
      if (summaryRemainingLabel) summaryRemainingLabel.textContent = "Remaining";
      if (summaryRemaining) {
        summaryRemaining.textContent = fmt(0);
        summaryRemaining.className = "summary-stat-value";
      }
      if (summaryRemainingSub) summaryRemainingSub.textContent = "No funds yet";
      if (tipRemainingEl) {
        tipRemainingEl.dataset.tip = "Add funds to your Budget Pool above to start tracking your remaining balance.";
      }
      updateSpentProgressBar(0, 0, "pool", "neutral");
    }
  }
}

function populateYearSelectElement(yearSelect, selectedYear) {
  if (!yearSelect) return;
  const curYear = new Date().getFullYear();

  // Always cover the earliest recorded expense so history is reachable.
  let earliestYear = curYear;
  for (const e of expenses) {
    if (!e.dateISO) continue;
    const y = parseInt(e.dateISO.slice(0, 4), 10);
    if (y < earliestYear) earliestYear = y;
  }

  // Window spans ±YEAR_SELECT_SPAN around both today and the viewed year, so picking
  // an edge year automatically loads further years on the next render.
  const minYear = Math.max(CAL_MIN_YEAR, Math.min(curYear - YEAR_SELECT_SPAN, selectedYear - YEAR_SELECT_SPAN, earliestYear));
  const maxYear = Math.min(curYear + CAL_FUTURE_YEARS, Math.max(curYear + YEAR_SELECT_SPAN, selectedYear + YEAR_SELECT_SPAN));
  const rangeKey = `${minYear}-${maxYear}`;

  if (yearSelect.dataset.range !== rangeKey) {
    const frag = document.createDocumentFragment();
    for (let y = minYear; y <= maxYear; y++) {
      const opt = document.createElement("option");
      opt.value = y;
      opt.textContent = y;
      frag.appendChild(opt);
    }
    yearSelect.innerHTML = "";
    yearSelect.appendChild(frag);
    yearSelect.dataset.range = rangeKey;
  }
  yearSelect.value = selectedYear;
}

function populateYearSelect() {
  populateYearSelectElement($("calendar-year-select"), viewDate.getFullYear());
}

function renderCalendar() {
  populateYearSelect();
  const monthSelect = $("calendar-month-select");
  if (monthSelect) monthSelect.value = viewDate.getMonth();

  const popover = $("calendar-popover");
  if (!popover || popover.classList.contains("hidden")) return;

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const monthTitle = $("calendar-month-title");
  if (monthTitle) monthTitle.textContent = monthLabelFmt.format(viewDate);

  const daysGrid = $("calendar-grid-days");
  if (!daysGrid) return;
  daysGrid.innerHTML = "";

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevMonthDays = new Date(year, month, 0).getDate();

  const realNow = new Date();
  const todayISO = toLocalISO(realNow);

  const monthPrefix = toLocalMonthPrefix(viewDate);
  const expenseDatesSet = new Set(
    expenses.filter((e) => e.dateISO && e.dateISO.startsWith(monthPrefix)).map((e) => e.dateISO)
  );

  let cellIdx = 0;
  for (let i = firstDay - 1; i >= 0; i--) {
    const btn = document.createElement("button");
    btn.className = "calendar-day-cell other-month";
    btn.textContent = prevMonthDays - i;
    btn.type = "button";
    btn.style.animationDelay = `${cellIdx * 0.006}s`;
    cellIdx++;
    daysGrid.appendChild(btn);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateObj = new Date(year, month, d);
    const dateISO = toLocalISO(dateObj);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "calendar-day-cell";
    btn.textContent = d;
    btn.style.animationDelay = `${cellIdx * 0.006}s`;
    cellIdx++;

    if (dateISO === todayISO) btn.classList.add("today");
    if (dateISO === selectedDateISO) btn.classList.add("selected");
    if (expenseDatesSet.has(dateISO)) btn.classList.add("has-expenses");

    btn.addEventListener("click", () => {
      if (selectedDateISO === dateISO) {
        selectedDateISO = null;
      } else {
        selectedDateISO = dateISO;
      }
      render();
    });

    daysGrid.appendChild(btn);
  }
}

function sortedCategoryEntries(sums) {
  const entries = CATEGORIES.map((c) => ({ cat: c, amount: sums[c] }));
  if (categorySort === "alpha") entries.sort((a, b) => a.cat.localeCompare(b.cat));
  else if (categorySort === "amount") entries.sort((a, b) => b.amount - a.amount);
  return entries;
}

function renderCategories(monthExpenses) {
  const sums = {};
  CATEGORIES.forEach((c) => (sums[c] = 0));
  monthExpenses.forEach((e) => (sums[e.category] = (sums[e.category] || 0) + e.amount));
  const total = Object.values(sums).reduce((a, b) => a + b, 0);
  const entries = sortedCategoryEntries(sums);

  $("category-list").innerHTML = entries.map(({ cat, amount }) => {
    const pct = total > 0 ? Math.round((amount / total) * 100) : 0;
    const barWidth = pct > 0 ? Math.max(3, pct) : 0;
    const safeCat = escapeHtml(cat);
    const safeAmount = escapeHtml(fmt(amount));
    const safeColor = escapeHtml(catColor(cat));
    return `
    <div class="category-row">
      <span class="cat-dot" style="background:${safeColor}"></span>
      <span class="cat-name">${safeCat}</span>
      <span class="cat-bar-track" title="${pct}% of month spend">
        <span class="cat-bar-fill" style="width:${barWidth}%;background:${safeColor}"></span>
      </span>
      <span class="cat-amount">${safeAmount}</span>
      <span class="cat-percent">${pct}%</span>
    </div>`;
  }).join("");

  drawCategoryChart(entries, total);
}

function drawCategoryChart(entries, total) {
  const container = $("category-chart");
  const empty = $("category-chart-empty");
  const chartEntries = entries.filter((e) => e.amount > 0);

  if (chartEntries.length === 0 || total <= 0) {
    container.classList.add("hidden");
    container.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }
  container.classList.remove("hidden");
  empty.classList.add("hidden");

  container.innerHTML = categoryChartType === "pie"
    ? svgDonutChart(chartEntries, total)
    : svgBarChart(chartEntries);
}

function svgDonutChart(entries, total) {
  const size = 200, r = 72, cx = size / 2, cy = size / 2, strokeWidth = 28;
  const circumference = 2 * Math.PI * r;
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  let acc = 0;
  const rings = entries.map((e) => {
    const len = (e.amount / total) * circumference;
    const safeColor = escapeHtml(catColor(e.cat));
    const ring = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${safeColor}"
      stroke-width="${strokeWidth}" stroke-dasharray="${len} ${circumference - len}"
      stroke-dashoffset="${-acc}" transform="rotate(-90 ${cx} ${cy})"></circle>`;
    acc += len;
    return ring;
  }).join("");
  return `<svg viewBox="0 0 ${size} ${size}" width="220" height="${size}" role="img" aria-label="Spending by category, donut chart">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${escapeHtml(bg)}" stroke-width="${strokeWidth}"></circle>
    ${rings}
  </svg>`;
}

function svgBarChart(entries) {
  const width = 320, height = 190, pad = { top: 14, bottom: 28, left: 8, right: 8 };
  const innerW = width - pad.left - pad.right, innerH = height - pad.top - pad.bottom;
  const inkSoft = getComputedStyle(document.documentElement).getPropertyValue("--ink-soft").trim();
  const maxVal = Math.max(...entries.map((e) => e.amount));
  const n = entries.length, gap = 14;
  const barWidth = Math.max(18, (innerW - gap * (n - 1)) / n);
  const bars = entries.map((e, i) => {
    const h = maxVal > 0 ? (e.amount / maxVal) * innerH : 0;
    const x = pad.left + i * (barWidth + gap);
    const y = pad.top + innerH - h;
    const safeCatText = escapeHtml(e.cat.slice(0, 4));
    const safeColor = escapeHtml(catColor(e.cat));
    return `
      <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${h.toFixed(1)}" rx="6" fill="${safeColor}"></rect>
      <text x="${(x + barWidth / 2).toFixed(1)}" y="${height - 10}" font-size="10" fill="${escapeHtml(inkSoft)}" text-anchor="middle" font-family="Inter, sans-serif">${safeCatText}</text>`;
  }).join("");
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" aria-label="Spending by category, bar chart">${bars}</svg>`;
}

function syncViewModeToggles() {
  document.querySelectorAll("[data-exp-view]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.expView === expenseViewMode);
  });
  document.querySelectorAll("[data-rec-view]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.recView === recurringViewMode);
  });
}

document.querySelectorAll("[data-exp-view]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const mode = btn.dataset.expView || "grouped";
    expenseViewMode = mode;
    safeSet("budgelist-expense-view", mode);
    syncViewModeToggles();
    const { monthExpenses } = currentMonthData();
    renderExpenseList(monthExpenses);
  });
});

document.querySelectorAll("[data-rec-view]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const mode = btn.dataset.recView || "list";
    recurringViewMode = mode;
    safeSet("budgelist-recurring-view", mode);
    syncViewModeToggles();
    renderRecurring();
  });
});

syncViewModeToggles();

function formatShortExpenseDate(dateISO) {
  if (!dateISO) return "";
  const [y, m, d] = dateISO.split("-").map((n) => parseInt(n, 10));
  if (!y || !m || !d) return dateISO.slice(5);
  return shortDateFmt.format(new Date(y, m - 1, d));
}

function formatExpenseDayGroupLabel(dateISO) {
  if (!dateISO) return "Unknown date";
  const [y, m, d] = dateISO.split("-").map((n) => parseInt(n, 10));
  if (!y || !m || !d) return dateISO;
  const target = new Date(y, m - 1, d);
  const now = new Date();
  const todayStr = toLocalISO(now);
  const yestDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const yestStr = toLocalISO(yestDate);

  if (dateISO === todayStr) return `Today · ${shortDateFmt.format(target)}`;
  if (dateISO === yestStr) return `Yesterday · ${shortDateFmt.format(target)}`;
  return groupDayFmt.format(target);
}

function renderExpenseCategoryFilterChips(monthExpenses) {
  const filterWrap = $("expense-category-filter");
  if (!filterWrap) return;

  const counts = {};
  monthExpenses.forEach((e) => {
    const c = e.category || "Other";
    counts[c] = (counts[c] || 0) + 1;
  });

  const activeCats = CATEGORIES.filter((c) => counts[c] > 0);
  if (expenseCategoryFilter !== "ALL" && !counts[expenseCategoryFilter]) {
    expenseCategoryFilter = "ALL";
  }

  if (monthExpenses.length === 0 || activeCats.length < 2) {
    filterWrap.classList.add("hidden");
    filterWrap.innerHTML = "";
    return;
  }

  filterWrap.classList.remove("hidden");
  filterWrap.innerHTML = "";
  const frag = document.createDocumentFragment();

  const allChip = document.createElement("button");
  allChip.type = "button";
  allChip.className = `cat-filter-chip${expenseCategoryFilter === "ALL" ? " active" : ""}`;
  allChip.textContent = `All (${monthExpenses.length})`;
  allChip.addEventListener("click", () => {
    expenseCategoryFilter = "ALL";
    renderExpenseList(monthExpenses);
  });
  frag.appendChild(allChip);

  activeCats.forEach((cat) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = `cat-filter-chip${expenseCategoryFilter === cat ? " active" : ""}`;
    const dot = document.createElement("span");
    dot.className = "cat-chip-dot";
    dot.style.background = catColor(cat);
    const label = document.createElement("span");
    label.textContent = `${cat} (${counts[cat]})`;
    chip.appendChild(dot);
    chip.appendChild(label);
    chip.addEventListener("click", () => {
      expenseCategoryFilter = expenseCategoryFilter === cat ? "ALL" : cat;
      renderExpenseList(monthExpenses);
    });
    frag.appendChild(chip);
  });

  filterWrap.appendChild(frag);
}

function renderExpenseList(monthExpenses) {
  renderExpenseCategoryFilterChips(monthExpenses);

  const countBadge = $("expense-count-badge");
  if (countBadge) {
    countBadge.textContent = String(monthExpenses.length);
    countBadge.classList.toggle("hidden", monthExpenses.length === 0);
  }

  const filtered =
    expenseCategoryFilter === "ALL"
      ? monthExpenses
      : monthExpenses.filter((e) => (e.category || "Other") === expenseCategoryFilter);

  const sorted = [...filtered].sort(
    (a, b) => (b.dateISO || "").localeCompare(a.dateISO || "") || (b.createdAt || 0) - (a.createdAt || 0)
  );

  const container = $("expense-list");
  const emptyEl = $("empty-state");
  if (emptyEl) {
    emptyEl.textContent =
      selectedDateISO
        ? "No expenses logged for this day."
        : "Nothing logged for this month yet.";
    emptyEl.classList.toggle("hidden", sorted.length > 0);
  }

  const effectiveMode =
    expenseViewMode === "compact" || expenseViewMode === "grid" ? expenseViewMode : "grouped";
  container.className = `expense-list view-${effectiveMode}`;
  container.innerHTML = "";

  if (sorted.length === 0) return;

  const fragment = document.createDocumentFragment();

  if (effectiveMode === "grouped") {
    const groups = [];
    const groupMap = new Map();
    sorted.forEach((e) => {
      const key = e.dateISO || "unknown";
      if (!groupMap.has(key)) {
        const g = { dateISO: key, items: [], total: 0 };
        groupMap.set(key, g);
        groups.push(g);
      }
      const g = groupMap.get(key);
      g.items.push(e);
      g.total = round2(g.total + (Number(e.amount) || 0));
    });

    groups.forEach((g) => {
      const groupLi = document.createElement("li");
      const isCollapsed = collapsedExpenseDays.has(g.dateISO);
      groupLi.className = `expense-day-group${isCollapsed ? " collapsed" : ""}`;

      const headerBtn = document.createElement("button");
      headerBtn.type = "button";
      headerBtn.className = "expense-day-header";

      const titleWrap = document.createElement("div");
      titleWrap.className = "expense-day-title-wrap";

      const titleSpan = document.createElement("span");
      titleSpan.className = "expense-day-title";
      titleSpan.textContent = formatExpenseDayGroupLabel(g.dateISO);

      const countSpan = document.createElement("span");
      countSpan.className = "expense-day-count";
      countSpan.textContent = `· ${g.items.length}`;

      titleWrap.appendChild(titleSpan);
      titleWrap.appendChild(countSpan);

      const rightWrap = document.createElement("div");
      rightWrap.className = "expense-day-right";

      const totalSpan = document.createElement("span");
      totalSpan.className = "expense-day-total";
      totalSpan.textContent = fmt(g.total);

      const chevSpan = document.createElement("span");
      chevSpan.className = "day-group-chevron";
      chevSpan.textContent = "▾";

      rightWrap.appendChild(totalSpan);
      rightWrap.appendChild(chevSpan);

      headerBtn.appendChild(titleWrap);
      headerBtn.appendChild(rightWrap);

      headerBtn.addEventListener("click", () => {
        if (collapsedExpenseDays.has(g.dateISO)) {
          collapsedExpenseDays.delete(g.dateISO);
          groupLi.classList.remove("collapsed");
        } else {
          collapsedExpenseDays.add(g.dateISO);
          groupLi.classList.add("collapsed");
        }
      });

      const itemsWrap = document.createElement("div");
      itemsWrap.className = "expense-day-items";

      g.items.forEach((e) => {
        const row = document.createElement("div");
        row.className = "expense-card-row";
        const color = catColor(e.category);

        const left = document.createElement("div");
        left.className = "item-row-left";

        const iconBox = document.createElement("span");
        iconBox.className = "item-cat-icon";
        iconBox.style.background = `color-mix(in srgb, ${color} 15%, transparent)`;
        iconBox.style.color = color;
        iconBox.innerHTML = catIconSvg(e.category, 16);

        const textWrap = document.createElement("div");
        textWrap.className = "item-row-text";

        const primaryTitle = document.createElement("span");
        primaryTitle.className = "item-primary-title";
        primaryTitle.textContent = e.note ? e.note : e.category;

        const secondaryMeta = document.createElement("div");
        secondaryMeta.className = "item-secondary-meta";
        const catText = document.createElement("span");
        catText.textContent = e.note ? e.category : "Logged expense";
        secondaryMeta.appendChild(catText);

        if (e.recurringId) {
          const recBadge = document.createElement("span");
          recBadge.className = "item-badge-mini";
          recBadge.textContent = "Recurring";
          secondaryMeta.appendChild(recBadge);
        }

        textWrap.appendChild(primaryTitle);
        textWrap.appendChild(secondaryMeta);

        left.appendChild(iconBox);
        left.appendChild(textWrap);

        const right = document.createElement("div");
        right.className = "item-row-right";
        const amountSpan = document.createElement("span");
        amountSpan.className = "expense-amount";
        amountSpan.textContent = fmt(e.amount);
        right.appendChild(amountSpan);

        row.appendChild(left);
        row.appendChild(right);
        row.addEventListener("click", () => {
          const exp = expenses.find((x) => x.id === e.id);
          if (exp) openExpenseSheet(exp);
        });
        itemsWrap.appendChild(row);
      });

      groupLi.appendChild(headerBtn);
      groupLi.appendChild(itemsWrap);
      fragment.appendChild(groupLi);
    });
  } else if (effectiveMode === "compact") {
    sorted.forEach((e) => {
      const li = document.createElement("li");
      li.dataset.id = e.id;

      const left = document.createElement("div");
      left.className = "compact-row-left";

      const dot = document.createElement("span");
      dot.className = "cat-dot-sm";
      dot.style.background = catColor(e.category);

      const dateSpan = document.createElement("span");
      dateSpan.className = "compact-date";
      dateSpan.textContent = e.dateISO ? e.dateISO.slice(5).replace("-", "/") : "";

      const titleSpan = document.createElement("span");
      titleSpan.className = "compact-title";
      titleSpan.textContent = e.note ? e.note : e.category;

      left.appendChild(dot);
      left.appendChild(dateSpan);
      left.appendChild(titleSpan);

      if (e.note) {
        const hint = document.createElement("span");
        hint.className = "compact-cat-hint";
        hint.textContent = `· ${e.category}`;
        left.appendChild(hint);
      }

      if (e.recurringId) {
        const recTag = document.createElement("span");
        recTag.className = "item-badge-mini";
        recTag.textContent = "↻";
        recTag.title = "Recurring bill";
        left.appendChild(recTag);
      }

      const amountSpan = document.createElement("span");
      amountSpan.className = "expense-amount";
      amountSpan.textContent = fmt(e.amount);

      li.appendChild(left);
      li.appendChild(amountSpan);
      li.addEventListener("click", () => {
        const exp = expenses.find((x) => x.id === e.id);
        if (exp) openExpenseSheet(exp);
      });
      fragment.appendChild(li);
    });
  } else {
    // Grid Cards Mode
    sorted.forEach((e) => {
      const li = document.createElement("li");
      li.dataset.id = e.id;
      const color = catColor(e.category);

      const top = document.createElement("div");
      top.className = "grid-card-top";

      const iconBox = document.createElement("span");
      iconBox.className = "grid-card-icon";
      iconBox.style.background = `color-mix(in srgb, ${color} 15%, transparent)`;
      iconBox.style.color = color;
      iconBox.innerHTML = catIconSvg(e.category, 14);

      const dateSpan = document.createElement("span");
      dateSpan.className = "grid-card-date";
      dateSpan.textContent = formatShortExpenseDate(e.dateISO);

      top.appendChild(iconBox);
      top.appendChild(dateSpan);

      const amt = document.createElement("div");
      amt.className = "grid-card-amount";
      amt.textContent = fmt(e.amount);

      const bottom = document.createElement("div");
      bottom.className = "grid-card-bottom";

      const title = document.createElement("span");
      title.className = "grid-card-title";
      title.textContent = e.note ? e.note : e.category;

      const sub = document.createElement("div");
      sub.className = "grid-card-sub";
      const catLabel = document.createElement("span");
      catLabel.textContent = e.category;
      sub.appendChild(catLabel);

      if (e.recurringId) {
        const recBadge = document.createElement("span");
        recBadge.className = "item-badge-mini";
        recBadge.textContent = "↻ Bill";
        sub.appendChild(recBadge);
      }

      bottom.appendChild(title);
      bottom.appendChild(sub);

      li.appendChild(top);
      li.appendChild(amt);
      li.appendChild(bottom);
      li.addEventListener("click", () => {
        const exp = expenses.find((x) => x.id === e.id);
        if (exp) openExpenseSheet(exp);
      });
      fragment.appendChild(li);
    });
  }

  container.appendChild(fragment);
}

function formatOrdinalDay(day) {
  const n = Number(day) || 1;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

function renderRecurring() {
  const sortedRec = [...recurring].sort((a, b) => (a.dayOfMonth || 1) - (b.dayOfMonth || 1));
  const countBadge = $("recurring-count-badge");
  const summaryBar = $("recurring-summary-bar");
  const listEl = $("recurring-list");
  const emptyEl = $("recurring-empty");

  if (countBadge) {
    countBadge.textContent = String(sortedRec.length);
    countBadge.classList.toggle("hidden", sortedRec.length === 0);
  }

  if (emptyEl) emptyEl.classList.toggle("hidden", sortedRec.length > 0);
  if (!listEl) return;

  const effectiveMode =
    recurringViewMode === "compact" || recurringViewMode === "grid" ? recurringViewMode : "list";
  listEl.className = `recurring-list view-${effectiveMode}`;
  listEl.innerHTML = "";

  if (sortedRec.length === 0) {
    if (summaryBar) summaryBar.classList.add("hidden");
    return;
  }

  const now = new Date();
  const viewPrefix = toLocalMonthPrefix(viewDate);
  const isViewingCurrentMonth = viewPrefix === toLocalMonthPrefix(now);
  const viewedMonthExpenses = expenses.filter((e) => e.dateISO && e.dateISO.startsWith(viewPrefix));
  const loggedIds = new Set(viewedMonthExpenses.filter((e) => e.recurringId).map((e) => e.recurringId));

  const recTotal = round2(sortedRec.reduce((s, r) => s + (Number(r.amount) || 0), 0));
  let paidCount = 0;

  const getBillStatus = (r) => {
    const isLogged =
      loggedIds.has(r.id) ||
      viewedMonthExpenses.some((e) => e.note === r.note && Number(e.amount) === Number(r.amount));
    if (isLogged) {
      paidCount++;
      return { label: "Logged", cls: "paid" };
    }
    if (isViewingCurrentMonth) {
      const diff = (r.dayOfMonth || 1) - now.getDate();
      if (diff === 0) return { label: "Due today", cls: "upcoming" };
      if (diff > 0 && diff <= 5) return { label: `In ${diff}d`, cls: "upcoming" };
      return { label: `Due ${formatOrdinalDay(r.dayOfMonth)}`, cls: "" };
    }
    return { label: `Day ${r.dayOfMonth}`, cls: "" };
  };

  const itemsWithStatus = sortedRec.map((r) => ({ r, status: getBillStatus(r) }));

  if (summaryBar) {
    summaryBar.classList.remove("hidden");
    const upcomingCount = sortedRec.length - paidCount;
    const rightSummary = isViewingCurrentMonth
      ? `${paidCount} logged · ${upcomingCount} upcoming`
      : `${sortedRec.length} monthly bill${sortedRec.length === 1 ? "" : "s"}`;
    summaryBar.innerHTML = `<span>Monthly fixed: <strong>${escapeHtml(fmt(recTotal))}</strong></span><span>${escapeHtml(rightSummary)}</span>`;
  }

  const frag = document.createDocumentFragment();

  if (effectiveMode === "list") {
    itemsWithStatus.forEach(({ r, status }) => {
      const li = document.createElement("li");
      li.dataset.id = r.id;
      const color = catColor(r.category);

      const left = document.createElement("div");
      left.className = "item-row-left";

      const iconBox = document.createElement("span");
      iconBox.className = "item-cat-icon";
      iconBox.style.background = `color-mix(in srgb, ${color} 15%, transparent)`;
      iconBox.style.color = color;
      iconBox.innerHTML = catIconSvg(r.category, 16);

      const textWrap = document.createElement("div");
      textWrap.className = "item-row-text";

      const nameSpan = document.createElement("span");
      nameSpan.className = "item-primary-title";
      nameSpan.textContent = r.note;

      const metaDiv = document.createElement("div");
      metaDiv.className = "item-secondary-meta";
      const subText = document.createElement("span");
      subText.textContent = `${r.category} · ${formatOrdinalDay(r.dayOfMonth)} of month`;
      metaDiv.appendChild(subText);

      const statusPill = document.createElement("span");
      statusPill.className = `item-badge-mini${status.cls ? ` ${status.cls}` : ""}`;
      statusPill.textContent = status.label;
      metaDiv.appendChild(statusPill);

      textWrap.appendChild(nameSpan);
      textWrap.appendChild(metaDiv);

      left.appendChild(iconBox);
      left.appendChild(textWrap);

      const right = document.createElement("div");
      right.className = "item-row-right";

      const amtSpan = document.createElement("span");
      amtSpan.className = "recurring-amount";
      amtSpan.textContent = fmt(r.amount);

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "recurring-delete";
      delBtn.setAttribute("aria-label", "Delete recurring bill");
      delBtn.textContent = "\u00d7";
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        deleteRecurring(r.id);
      });

      right.appendChild(amtSpan);
      right.appendChild(delBtn);

      li.appendChild(left);
      li.appendChild(right);
      li.addEventListener("click", () => {
        const target = recurring.find((x) => x.id === r.id);
        if (target) openRecurringSheet(target);
      });
      frag.appendChild(li);
    });
  } else if (effectiveMode === "compact") {
    itemsWithStatus.forEach(({ r, status }) => {
      const li = document.createElement("li");
      li.dataset.id = r.id;

      const left = document.createElement("div");
      left.className = "compact-row-left";

      const dot = document.createElement("span");
      dot.className = "cat-dot-sm";
      dot.style.background = catColor(r.category);

      const daySpan = document.createElement("span");
      daySpan.className = "compact-date";
      daySpan.textContent = formatOrdinalDay(r.dayOfMonth);

      const titleSpan = document.createElement("span");
      titleSpan.className = "compact-title";
      titleSpan.textContent = r.note;

      const statusPill = document.createElement("span");
      statusPill.className = `item-badge-mini${status.cls ? ` ${status.cls}` : ""}`;
      statusPill.textContent = status.label;

      left.appendChild(dot);
      left.appendChild(daySpan);
      left.appendChild(titleSpan);
      left.appendChild(statusPill);

      const right = document.createElement("div");
      right.className = "item-row-right";

      const amtSpan = document.createElement("span");
      amtSpan.className = "recurring-amount";
      amtSpan.textContent = fmt(r.amount);

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "recurring-delete";
      delBtn.setAttribute("aria-label", "Delete recurring bill");
      delBtn.textContent = "\u00d7";
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        deleteRecurring(r.id);
      });

      right.appendChild(amtSpan);
      right.appendChild(delBtn);

      li.appendChild(left);
      li.appendChild(right);
      li.addEventListener("click", () => {
        const target = recurring.find((x) => x.id === r.id);
        if (target) openRecurringSheet(target);
      });
      frag.appendChild(li);
    });
  } else {
    // Grid Cards Mode
    itemsWithStatus.forEach(({ r, status }) => {
      const li = document.createElement("li");
      li.dataset.id = r.id;
      const color = catColor(r.category);

      const top = document.createElement("div");
      top.className = "grid-card-top";

      const iconBox = document.createElement("span");
      iconBox.className = "grid-card-icon";
      iconBox.style.background = `color-mix(in srgb, ${color} 15%, transparent)`;
      iconBox.style.color = color;
      iconBox.innerHTML = catIconSvg(r.category, 14);

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "recurring-delete-grid";
      delBtn.setAttribute("aria-label", "Delete recurring bill");
      delBtn.textContent = "\u00d7";
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        deleteRecurring(r.id);
      });

      top.appendChild(iconBox);
      top.appendChild(delBtn);

      const amt = document.createElement("div");
      amt.className = "grid-card-amount";
      amt.textContent = fmt(r.amount);

      const bottom = document.createElement("div");
      bottom.className = "grid-card-bottom";

      const title = document.createElement("span");
      title.className = "grid-card-title";
      title.textContent = r.note;

      const sub = document.createElement("div");
      sub.className = "grid-card-sub";
      const dayLabel = document.createElement("span");
      dayLabel.textContent = formatOrdinalDay(r.dayOfMonth);
      const statusPill = document.createElement("span");
      statusPill.className = `item-badge-mini${status.cls ? ` ${status.cls}` : ""}`;
      statusPill.textContent = status.label;
      sub.appendChild(dayLabel);
      sub.appendChild(statusPill);

      bottom.appendChild(title);
      bottom.appendChild(sub);

      li.appendChild(top);
      li.appendChild(amt);
      li.appendChild(bottom);
      li.addEventListener("click", () => {
        const target = recurring.find((x) => x.id === r.id);
        if (target) openRecurringSheet(target);
      });
      frag.appendChild(li);
    });
  }

  listEl.appendChild(frag);
}

function escapeHtml(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getHistoricalDailyVelocity(targetDate) {
  const pastVelocities = [];
  for (let i = 1; i <= 3; i++) {
    const pastDate = new Date(targetDate.getFullYear(), targetDate.getMonth() - i, 1);
    const prefix = toLocalMonthPrefix(pastDate);
    const pastExpenses = expenses.filter((e) => e.dateISO && e.dateISO.startsWith(prefix) && !e.recurringId);
    if (pastExpenses.length > 0) {
      const daysInPastMonth = new Date(pastDate.getFullYear(), pastDate.getMonth() + 1, 0).getDate();
      const pastTotalVar = pastExpenses.reduce((s, e) => s + e.amount, 0);
      const vel = pastTotalVar / daysInPastMonth;
      if (vel > 0) pastVelocities.push(vel);
    }
  }
  if (pastVelocities.length === 0) return null;
  return pastVelocities.reduce((a, b) => a + b, 0) / pastVelocities.length;
}

function renderForecast(monthExpenses, isCurrentMonth, daysInMonth, today) {
  const container = $("forecast-chart");
  const legend = $("forecast-legend");
  const empty = $("forecast-empty");
  const note = $("forecast-note");
  const metricsEl = $("forecast-metrics");
  const warning = $("budget-warning");

  const isFutureMonth = !isCurrentMonth && viewDate > startOfMonth(new Date());

  if (monthExpenses.length === 0) {
    container.classList.add("hidden");
    container.innerHTML = "";
    legend.classList.add("hidden");
    if (metricsEl) metricsEl.classList.add("hidden");
    empty.classList.remove("hidden");
    note.classList.add("hidden");
    warning.classList.add("hidden");
    return;
  }

  container.classList.remove("hidden");
  legend.classList.remove("hidden");
  empty.classList.add("hidden");
  note.classList.remove("hidden");
  if (metricsEl) metricsEl.classList.remove("hidden");

  // 1. Actual daily totals and cumulative array up to `today`
  const dailyTotals = Array(today).fill(0);
  const dailyVarTotals = Array(today).fill(0);

  monthExpenses.forEach((e) => {
    const day = parseInt(e.dateISO.slice(8, 10), 10);
    if (day >= 1 && day <= today) {
      dailyTotals[day - 1] += e.amount;
      if (!e.recurringId) dailyVarTotals[day - 1] += e.amount;
    }
  });

  const cumulativeActual = [];
  dailyTotals.reduce((acc, v, i) => (cumulativeActual[i] = acc + v, acc + v), 0);
  const currentTotalSpent = cumulativeActual[today - 1] || 0;
  const currentVarSpent = dailyVarTotals.reduce((a, b) => a + b, 0);

  // 2. Velocity calculations
  const rawCurrentVel = today > 0 ? currentVarSpent / today : 0;
  const histVel = getHistoricalDailyVelocity(viewDate);
  const blendWeight = Math.min(1.0, today / daysInMonth);
  const vBlend = (histVel != null)
    ? (1 - blendWeight) * histVel + blendWeight * rawCurrentVel
    : rawCurrentVel;

  // 3. Upcoming unpaid recurring bills for remaining days in current month
  let upcomingRecurringTotal = 0;
  const upcomingRecurringMap = {};
  if (isCurrentMonth && recurring && recurring.length > 0) {
    const appliedRecurringIds = new Set(
      monthExpenses.filter((e) => e.recurringId).map((e) => e.recurringId)
    );
    recurring.forEach((r) => {
      if (r.dayOfMonth > today && !appliedRecurringIds.has(r.id)) {
        upcomingRecurringTotal += r.amount;
        const d = Math.min(daysInMonth, Math.max(1, r.dayOfMonth));
        upcomingRecurringMap[d] = (upcomingRecurringMap[d] || 0) + r.amount;
      }
    });
  }

  // 4. Construct actual and projected series for days 1..daysInMonth
  const labels = [], actual = [], projected = [];
  for (let d = 1; d <= daysInMonth; d++) labels.push(d);

  for (let d = 1; d <= daysInMonth; d++) {
    actual.push(d <= today ? cumulativeActual[d - 1] : null);
  }

  if (isCurrentMonth) {
    let runningProj = currentTotalSpent;
    projected.push(...Array(today - 1).fill(null));
    projected.push(runningProj);

    for (let d = today + 1; d <= daysInMonth; d++) {
      const scheduledRec = upcomingRecurringMap[d] || 0;
      runningProj += vBlend + scheduledRec;
      projected.push(Math.round(runningProj * 100) / 100);
    }
  } else {
    projected.push(...Array(daysInMonth).fill(null));
  }

  const projectedTotal = isCurrentMonth
    ? (projected[daysInMonth - 1] != null ? projected[daysInMonth - 1] : currentTotalSpent)
    : currentTotalSpent;

  const ym = toLocalMonthPrefix(viewDate);
  const past = isPastMonth(ym);
  const rec = ensureMonthRecord(ym);
  const allocated = round2(rec.allocated || 0);
  const isUnrestricted = !past && allocated <= 0;
  const activeBudgetForCalc = past
    ? round2(rec.finalAllocated != null ? rec.finalAllocated : allocated)
    : (allocated > 0 ? allocated : round2(globalBudget + (rec.unrestrictedDeducted || 0)));
  const budgetTypeLabel = isUnrestricted ? "Budget Pool" : "monthly budget";

  // 5. Calculate Safe Daily Spend Allowance
  const remainingDays = Math.max(1, daysInMonth - today);
  let safeDailyAllowance = 0;
  if (activeBudgetForCalc > 0 && isCurrentMonth) {
    const remainingBudgetPool = activeBudgetForCalc - currentTotalSpent - upcomingRecurringTotal;
    safeDailyAllowance = Math.max(0, remainingBudgetPool / remainingDays);
  }

  // 6. Update Metric Cards (hide Projected & Safe Daily for past months)
  const projCardEl = $("metric-card-projected");
  const allowCardEl = $("metric-card-allowance");
  const paceLabelEl = $("metric-pace-label");
  const tipPaceEl = $("tip-metric-pace");
  const projValEl = $("metric-projected");
  const paceValEl = $("metric-pace");
  const allowValEl = $("metric-allowance");

  if (past) {
    if (projCardEl) projCardEl.classList.add("hidden");
    if (allowCardEl) allowCardEl.classList.add("hidden");
    if (metricsEl) metricsEl.classList.add("one-col");
    if (paceLabelEl) paceLabelEl.textContent = "Daily Average";
    if (tipPaceEl) {
      tipPaceEl.dataset.tip = `Average daily variable spending (excluding recurring bills) recorded across ${formatMonthYearLabel(ym)}.`;
    }
  } else {
    if (projCardEl) projCardEl.classList.remove("hidden");
    if (allowCardEl) allowCardEl.classList.remove("hidden");
    if (metricsEl) metricsEl.classList.remove("one-col");
    if (paceLabelEl) paceLabelEl.textContent = "Daily Pace";
    if (tipPaceEl) {
      tipPaceEl.dataset.tip = "Your blended daily spending rate on day-to-day items (excludes fixed recurring bills), weighted between prior months and this month.";
    }
  }

  if (projValEl) projValEl.textContent = fmt(projectedTotal);
  if (paceValEl) paceValEl.textContent = `${fmt(vBlend)}/day`;
  if (allowValEl) {
    allowValEl.textContent = activeBudgetForCalc > 0 ? `${fmt(safeDailyAllowance)}/day` : "N/A";
  }

  if (activeBudgetForCalc > 0 && isCurrentMonth) {
    if (projectedTotal > activeBudgetForCalc) {
      if (projValEl) projValEl.className = "metric-value warn";
      if (allowValEl) allowValEl.className = "metric-value warn";
    } else if (projectedTotal >= 0.85 * activeBudgetForCalc) {
      if (projValEl) projValEl.className = "metric-value caution";
      if (allowValEl) allowValEl.className = "metric-value caution";
    } else {
      if (projValEl) projValEl.className = "metric-value safe";
      if (allowValEl) allowValEl.className = "metric-value safe";
    }
  } else {
    if (projValEl) projValEl.className = "metric-value";
    if (allowValEl) allowValEl.className = "metric-value";
  }

  // 7. Render Chart
  drawChart(labels, actual, projected, activeBudgetForCalc > 0 ? activeBudgetForCalc : null);

  // 8. Note & Multi-tier Warning Messages
  note.textContent = isCurrentMonth
    ? `Trending toward ${fmt(Math.max(0, projectedTotal))} by day ${daysInMonth}` +
      (upcomingRecurringTotal > 0 ? ` (includes ${fmt(upcomingRecurringTotal)} upcoming bills)` : "") +
      (activeBudgetForCalc > 0 ? ` against ${fmt(activeBudgetForCalc)} ${budgetTypeLabel}.` : ".")
    : isFutureMonth
      ? `${fmt(projectedTotal)} scheduled this month.`
      : `${fmt(projectedTotal)} spent in ${formatMonthYearLabel(ym)}.`;

  const warningText = $("budget-warning-text");
  warning.className = "warning hidden";

  if (activeBudgetForCalc > 0 || (!past && currentTotalSpent > 0)) {
    warning.classList.remove("hidden");
    if (currentTotalSpent > activeBudgetForCalc) {
      warning.classList.add("critical");
      const overAmt = round2(currentTotalSpent - activeBudgetForCalc);
      const directCov = round2(rec.directCovered || 0);
      const covSuffix = (!past && !isUnrestricted && directCov > 0)
        ? ` (${fmt(Math.min(overAmt, directCov))} compensated directly from Budget).`
        : ".";
      warningText.textContent = isCurrentMonth
        ? isUnrestricted
          ? `Global Over-Budget: You've spent ${fmt(currentTotalSpent)}, exceeding your available Budget (${fmt(activeBudgetForCalc)}) by ${fmt(overAmt)}. Safe daily allowance is ${fmt(0)}.`
          : `Month Over-Budget: You've spent ${fmt(currentTotalSpent)} of your ${fmt(activeBudgetForCalc)} monthly budget (${fmt(overAmt)} over limit)${covSuffix} Safe daily allowance is ${fmt(0)}.`
        : isFutureMonth
          ? isUnrestricted
            ? `Global Over-Budget: Scheduled expenses of ${fmt(currentTotalSpent)} exceed your available Budget (${fmt(activeBudgetForCalc)}) by ${fmt(overAmt)}.`
            : `Month Over-Budget: Scheduled expenses of ${fmt(currentTotalSpent)} exceed your ${fmt(activeBudgetForCalc)} monthly budget by ${fmt(overAmt)}${covSuffix}`
          : `Historical Over-Budget: Month ended ${fmt(overAmt)} over its ${fmt(activeBudgetForCalc)} recorded budget (${fmt(currentTotalSpent)} spent).`;
    } else if (isCurrentMonth && projectedTotal > activeBudgetForCalc) {
      const overage = round2(projectedTotal - activeBudgetForCalc);
      warning.classList.add("critical");
      warningText.textContent = `Budget Warning: At your current pace (${fmt(vBlend)}/day + upcoming bills), projected spending is ${fmt(projectedTotal)}, which is ${fmt(overage)} over your ${fmt(activeBudgetForCalc)} ${budgetTypeLabel}. Limit daily variable spending to ${fmt(safeDailyAllowance)}/day.`;
    } else if (isCurrentMonth && projectedTotal >= 0.85 * activeBudgetForCalc) {
      const pct = Math.round((projectedTotal / activeBudgetForCalc) * 100);
      warning.classList.add("caution");
      warningText.textContent = `Budget Caution: On track to spend ${fmt(projectedTotal)} (${pct}% of your ${fmt(activeBudgetForCalc)} ${budgetTypeLabel}). To stay within budget, aim to keep daily spend around ${fmt(safeDailyAllowance)}/day.`;
    } else if (isCurrentMonth) {
      const pct = Math.round((projectedTotal / activeBudgetForCalc) * 100);
      warning.classList.add("safe");
      warningText.textContent = `On Track: Projected total is ${fmt(projectedTotal)} (${pct}% of your ${fmt(activeBudgetForCalc)} ${budgetTypeLabel}). Safe daily target: ${fmt(safeDailyAllowance)}/day.`;
    } else {
      warning.classList.add("safe");
      const retAmt = round2(rec.returnedToGlobal || 0);
      warningText.textContent = isFutureMonth
        ? `Within budget so far: ${fmt(currentTotalSpent)} scheduled of ${fmt(activeBudgetForCalc)} ${budgetTypeLabel}.`
        : `Ended within budget: ${fmt(currentTotalSpent)} spent of ${fmt(activeBudgetForCalc)} recorded budget${retAmt > 0 ? ` (${fmt(retAmt)} returned to Budget)` : ""}.`;
    }
  }
}

function drawChart(labels, actual, projected, budget) {
  const styles = getComputedStyle(document.documentElement);
  const primary = styles.getPropertyValue("--primary").trim();
  const warn = styles.getPropertyValue("--warn").trim();
  const inkSoft = styles.getPropertyValue("--ink-soft").trim();
  const lineColor = styles.getPropertyValue("--line").trim();

  $("legend-dot-spent").style.background = primary;
  $("legend-dot-projected").style.background = warn;

  const budgetLegendItem = $("legend-item-budget");
  const budgetDot = $("legend-dot-budget");
  if (budgetLegendItem && budgetDot) {
    if (budget && budget > 0) {
      budgetLegendItem.classList.remove("hidden");
      budgetDot.style.background = inkSoft;
    } else {
      budgetLegendItem.classList.add("hidden");
    }
  }

  const width = 320, height = 160, pad = { top: 10, right: 10, bottom: 22, left: 38 };
  const innerW = width - pad.left - pad.right, innerH = height - pad.top - pad.bottom;
  const allVals = [...actual, ...projected, budget].filter((v) => v != null && v > 0);
  const maxY = Math.max(10, ...allVals) * 1.15;
  const n = labels.length;
  const xAt = (i) => pad.left + (n <= 1 ? 0 : (i / (n - 1)) * innerW);
  const yAt = (v) => pad.top + innerH - (v / maxY) * innerH;

  function polylines(data, color, dash) {
    const segs = []; let cur = [];
    data.forEach((v, i) => {
      if (v == null) { if (cur.length > 1) segs.push(cur); cur = []; }
      else cur.push(`${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`);
    });
    if (cur.length > 1) segs.push(cur);
    const safeColor = escapeHtml(color);
    const safeDash = dash ? escapeHtml(dash) : "";
    return segs.map((seg) => `<polyline points="${seg.join(" ")}" fill="none" stroke="${safeColor}"
      stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round" ${safeDash ? `stroke-dasharray="${safeDash}"` : ""}></polyline>`).join("");
  }

  const safeLineColor = escapeHtml(lineColor);
  const safeInkSoft = escapeHtml(inkSoft);

  const gridY = [0, 0.5, 1].map((f) => {
    const y = pad.top + innerH * (1 - f);
    return `<line x1="${pad.left}" y1="${y.toFixed(1)}" x2="${width - pad.right}" y2="${y.toFixed(1)}" stroke="${safeLineColor}" stroke-width="1"></line>`;
  }).join("");

  let budgetLineSvg = "";
  if (budget && budget > 0 && budget <= maxY) {
    const bY = yAt(budget);
    budgetLineSvg = `<line x1="${pad.left}" y1="${bY.toFixed(1)}" x2="${width - pad.right}" y2="${bY.toFixed(1)}" stroke="${safeLineColor}" stroke-width="1.5" stroke-dasharray="3 3" opacity="0.75"></line>`;
  }

  const yLabels = [0, 0.5, 1].map((f) => {
    const y = pad.top + innerH * (1 - f);
    return `<text x="${pad.left - 6}" y="${(y + 3).toFixed(1)}" font-size="9" fill="${safeInkSoft}" text-anchor="end" font-family="Inter, sans-serif">${escapeHtml(currencySymbol)}${Math.round(maxY * f)}</text>`;
  }).join("");

  const xTickDays = [1, Math.max(1, Math.round(n / 2)), n].filter((v, i, a) => a.indexOf(v) === i);
  const xLabels = xTickDays.map((d) => {
    const i = d - 1;
    return `<text x="${xAt(i).toFixed(1)}" y="${height - 10}" font-size="9" fill="${safeInkSoft}" text-anchor="middle" font-family="Inter, sans-serif">${d}</text>`;
  }).join("");

  $("forecast-chart").innerHTML = `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" aria-label="Spending forecast over the month">
    ${gridY}
    ${budgetLineSvg}
    ${polylines(actual, primary)}
    ${polylines(projected, warn, "5 4")}
    ${yLabels}
    ${xLabels}
  </svg>`;
}

// ---------- Pull-to-Refresh Logic ----------
let pullStartY = 0;
let pullMoveY = 0;
let isPulling = false;
let isRefreshing = false;
const PULL_THRESHOLD = 65;

const appScreenEl = $("app-screen");
const pullIndicator = $("pull-refresh-indicator");
const pullSpinner = $("pull-refresh-spinner");
const pullText = $("pull-refresh-text");

if (appScreenEl && pullIndicator) {
  appScreenEl.addEventListener("touchstart", (e) => {
    if (window.scrollY === 0 && !isRefreshing) {
      pullStartY = e.touches[0].clientY;
      isPulling = true;
    } else {
      isPulling = false;
    }
  }, { passive: true });

  appScreenEl.addEventListener("touchmove", (e) => {
    if (!isPulling || isRefreshing) return;
    pullMoveY = e.touches[0].clientY - pullStartY;

    if (pullMoveY > 0 && window.scrollY === 0) {
      const height = Math.min(pullMoveY * 0.45, PULL_THRESHOLD);
      pullIndicator.style.height = `${height}px`;
      pullIndicator.style.opacity = `${height / PULL_THRESHOLD}`;

      if (height >= PULL_THRESHOLD) {
        if (pullText) pullText.textContent = "Release to refresh";
        if (pullSpinner) pullSpinner.style.transform = "rotate(180deg)";
      } else {
        if (pullText) pullText.textContent = "Pull to refresh";
        if (pullSpinner) pullSpinner.style.transform = `rotate(${(height / PULL_THRESHOLD) * 180}deg)`;
      }
    }
  }, { passive: true });

  appScreenEl.addEventListener("touchend", async () => {
    if (!isPulling || isRefreshing) return;
    isPulling = false;

    if (pullMoveY * 0.45 >= PULL_THRESHOLD) {
      isRefreshing = true;
      pullIndicator.style.height = "44px";
      pullIndicator.style.opacity = "1";
      pullIndicator.classList.add("refreshing");
      if (pullText) pullText.textContent = "Syncing latest data...";
      if (pullSpinner) pullSpinner.style.transform = "none";

      try {
        await syncCloudData(true);
      } finally {
        setTimeout(() => {
          pullIndicator.style.height = "0px";
          pullIndicator.style.opacity = "0";
          pullIndicator.classList.remove("refreshing");
          if (pullText) pullText.textContent = "Pull to refresh";
          isRefreshing = false;
        }, 500);
      }
    } else {
      pullIndicator.style.height = "0px";
      pullIndicator.style.opacity = "0";
    }
    pullMoveY = 0;
  });
}

// ---------- Background Scroll Lock & Layered Back Navigation ----------
function updateBodyScrollLock() {
  const hasOpenModal =
    document.querySelectorAll(".sheet:not(.hidden), .modal:not(.hidden), .modal-overlay:not(.hidden)").length > 0;
  if (hasOpenModal) {
    document.body.style.overflow = "hidden";
  } else {
    document.body.style.overflow = "";
  }
}

const modalObserver = new MutationObserver(() => {
  updateBodyScrollLock();
});

setTimeout(() => {
  document.querySelectorAll(".sheet, .modal, .modal-overlay").forEach((el) => {
    modalObserver.observe(el, { attributes: true, attributeFilter: ["class"] });
  });
  updateBodyScrollLock();
}, 200);

// ---------- Universal Interactive Help Tooltips ----------
let activeTooltipBtn = null;
let tooltipPinnedByClick = false;

function hideAppTooltip() {
  const tipEl = $("app-tooltip");
  if (tipEl) {
    tipEl.classList.add("hidden");
    tipEl.classList.remove("placed-above", "placed-below");
  }
  if (activeTooltipBtn) {
    activeTooltipBtn.classList.remove("active");
    activeTooltipBtn.setAttribute("aria-expanded", "false");
  }
  activeTooltipBtn = null;
  tooltipPinnedByClick = false;
}

function positionAppTooltip(anchorEl) {
  const tipEl = $("app-tooltip");
  if (!tipEl || !anchorEl) return;

  const rect = anchorEl.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    hideAppTooltip();
    return;
  }

  tipEl.style.left = "12px";
  tipEl.style.top = "0px";
  const tipW = tipEl.offsetWidth || 240;
  const tipH = tipEl.offsetHeight || 64;
  const vw = window.innerWidth || document.documentElement.clientWidth || 360;
  const vh = window.innerHeight || document.documentElement.clientHeight || 640;
  const margin = 12;

  const anchorCenterX = rect.left + rect.width / 2;
  let left = Math.round(anchorCenterX - tipW / 2);
  left = Math.max(margin, Math.min(left, vw - tipW - margin));

  let top = Math.round(rect.top - tipH - 10);
  let placedAbove = true;
  if (top < margin && rect.bottom + tipH + 10 <= vh - margin) {
    top = Math.round(rect.bottom + 10);
    placedAbove = false;
  } else if (top < margin) {
    top = Math.max(margin, Math.round(rect.bottom + 10));
    placedAbove = false;
  }

  const arrowX = Math.max(16, Math.min(tipW - 16, Math.round(anchorCenterX - left)));
  tipEl.style.left = `${left}px`;
  tipEl.style.top = `${top}px`;
  tipEl.style.setProperty("--tip-arrow-x", `${arrowX}px`);
  tipEl.classList.toggle("placed-above", placedAbove);
  tipEl.classList.toggle("placed-below", !placedAbove);
}

function showAppTooltip(btn, pinned = false) {
  const tipEl = $("app-tooltip");
  const textEl = $("app-tooltip-text");
  if (!tipEl || !textEl || !btn) return;
  const msg = btn.dataset.tip || "";
  if (!msg) return;

  if (activeTooltipBtn && activeTooltipBtn !== btn) {
    activeTooltipBtn.classList.remove("active");
    activeTooltipBtn.setAttribute("aria-expanded", "false");
  }

  activeTooltipBtn = btn;
  tooltipPinnedByClick = Boolean(pinned);
  btn.classList.add("active");
  btn.setAttribute("aria-expanded", "true");
  textEl.textContent = msg;
  tipEl.classList.remove("hidden");
  positionAppTooltip(btn);
}

document.addEventListener("click", (e) => {
  const tipBtn = e.target && e.target.closest ? e.target.closest(".help-tip-btn") : null;
  if (tipBtn) {
    e.preventDefault();
    e.stopPropagation();
    if (activeTooltipBtn === tipBtn && isOverlayVisible("app-tooltip") && tooltipPinnedByClick) {
      hideAppTooltip();
    } else {
      showAppTooltip(tipBtn, true);
    }
    return;
  }
  const insideTip = e.target && e.target.closest ? e.target.closest("#app-tooltip") : null;
  if (!insideTip && isOverlayVisible("app-tooltip")) {
    hideAppTooltip();
  }
}, true);

document.addEventListener("pointerover", (e) => {
  if (e.pointerType !== "mouse") return;
  const tipBtn = e.target && e.target.closest ? e.target.closest(".help-tip-btn") : null;
  if (tipBtn && (!tooltipPinnedByClick || activeTooltipBtn !== tipBtn)) {
    showAppTooltip(tipBtn, false);
  }
});

document.addEventListener("pointerout", (e) => {
  if (e.pointerType !== "mouse" || tooltipPinnedByClick) return;
  const tipBtn = e.target && e.target.closest ? e.target.closest(".help-tip-btn") : null;
  if (tipBtn && activeTooltipBtn === tipBtn) {
    const rel = e.relatedTarget;
    if (rel && (tipBtn.contains(rel) || (rel.closest && rel.closest("#app-tooltip")))) return;
    hideAppTooltip();
  }
});

window.addEventListener("scroll", () => {
  if (isOverlayVisible("app-tooltip")) hideAppTooltip();
}, true);

window.addEventListener("resize", () => {
  if (isOverlayVisible("app-tooltip") && activeTooltipBtn) {
    positionAppTooltip(activeTooltipBtn);
  }
});

function isOverlayVisible(id) {
  const el = $(id);
  return Boolean(el && !el.classList.contains("hidden"));
}

function closeTopmostOverlayLayer() {
  // 0. Interactive help tooltip popover
  if (isOverlayVisible("app-tooltip")) {
    hideAppTooltip();
    return true;
  }

  // 1. Open custom select dropdowns
  const openSelects = document.querySelectorAll(".custom-select-wrapper.open");
  if (openSelects.length > 0) {
    closeAllCustomSelects();
    return true;
  }

  // 2. Date & Calendar popovers
  if (isOverlayVisible("expense-date-popover")) {
    closeExpenseCalendar();
    return true;
  }
  if (isOverlayVisible("calendar-popover")) {
    closeCalendar();
    return true;
  }

  // 3. Modal Overlays (stacked on top of sheets or main screen)
  if (isOverlayVisible("network-modal")) {
    if ($("cancel-network")) $("cancel-network").click();
    else $("network-modal").classList.add("hidden");
    return true;
  }

  if (isOverlayVisible("update-modal")) {
    const isStartupView = isOverlayVisible("update-startup-view");
    if (isStartupView && pendingStartupUpdate && pendingStartupUpdate.isForced) {
      // Mandatory update cannot be dismissed into the app
      return false;
    }
    if (isStartupView && $("cancel-update-btn")) {
      $("cancel-update-btn").click();
    } else {
      closeUpdateModal();
    }
    return true;
  }

  if (isOverlayVisible("avatar-modal")) {
    $("avatar-modal").classList.add("hidden");
    return true;
  }

  if (isOverlayVisible("password-modal")) {
    if ($("cancel-password")) $("cancel-password").click();
    else $("password-modal").classList.add("hidden");
    return true;
  }

  if (isOverlayVisible("email-modal")) {
    if ($("cancel-email")) $("cancel-email").click();
    else $("email-modal").classList.add("hidden");
    return true;
  }

  if (isOverlayVisible("currency-modal")) {
    if (isOverlayVisible("currency-change-view") || isOverlayVisible("currency-convert-view")) {
      if ($("back-currency-menu")) $("back-currency-menu").click();
      return true;
    }
    $("currency-modal").classList.add("hidden");
    return true;
  }

  if (isOverlayVisible("logout-modal")) {
    $("logout-modal").classList.add("hidden");
    return true;
  }

  if (isOverlayVisible("guest-modal")) {
    $("guest-modal").classList.add("hidden");
    return true;
  }

  // 4. Bottom Sheets (ordered from nested/secondary sheets down to base sheets)
  if (isOverlayVisible("overbudget-sheet")) {
    closeOverbudgetSheet();
    return true;
  }

  if (isOverlayVisible("unlock-past-sheet")) {
    closeUnlockPastSheet();
    return true;
  }

  if (isOverlayVisible("global-budget-sheet")) {
    if (isOverlayVisible("clear-budget-confirm-box")) {
      $("clear-budget-confirm-box").classList.add("hidden");
      return true;
    }
    closeGlobalBudgetSheet();
    return true;
  }

  if (isOverlayVisible("budget-sheet")) {
    if ($("cancel-budget")) $("cancel-budget").click();
    else $("budget-sheet").classList.add("hidden");
    return true;
  }

  if (isOverlayVisible("recurring-sheet")) {
    closeRecurringSheet();
    return true;
  }

  if (isOverlayVisible("add-sheet")) {
    closeExpenseSheet();
    return true;
  }

  if (isOverlayVisible("settings-sheet")) {
    closeSettingsSheet();
    return true;
  }

  // 5. Auth screen sub-mode (Create account -> Log in)
  if (isOverlayVisible("auth-screen") && authMode === "signup") {
    setAuthMode("login");
    return true;
  }

  return false;
}

let lastBackExitAttempt = 0;

window.__handleAndroidBack = function __handleAndroidBack() {
  if (closeTopmostOverlayLayer()) {
    lastBackExitAttempt = 0;
    return "HANDLED";
  }

  if (isOtaUpdating) {
    if (!isOtaExtracting && typeof activeOtaCancelFn === "function") {
      activeOtaCancelFn();
      return "HANDLED";
    }
    showToast("Finishing update installation...");
    return "HANDLED";
  }

  const now = Date.now();
  if (now - lastBackExitAttempt < 2000) {
    return "EXIT";
  }

  lastBackExitAttempt = now;
  showToast("Press back again to exit");
  return "HANDLED";
};

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (closeTopmostOverlayLayer()) {
      e.preventDefault();
    }
  }
});
