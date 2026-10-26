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

// ---------- State ----------
let uid = null;
let isGuest = false;
let expenses = [];       // {id, amount, category, note, dateISO, createdAt, recurringId}
let recurring = [];      // {id, amount, category, note, dayOfMonth}
let monthlyBudget = 0;
let currencySymbol = safeGet("budgelist-currency-symbol") || "$";
let editingId = null;
let editingRecurringId = null;
let viewDate = startOfMonth(new Date());
let recurringApplied = false;
let isSyncing = false;

const CATEGORIES = ["Food", "Transport", "Bills", "Shopping", "Health", "Other"];
const CAT_VAR = { Food: "--cat-food", Transport: "--cat-transport", Bills: "--cat-bills",
  Shopping: "--cat-shopping", Health: "--cat-health", Other: "--cat-other" };

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
function syncCustomSelect(selectEl) {
  if (!selectEl) return;
  const parent = selectEl.parentNode;
  if (!parent) return;

  const wrapper = parent.querySelector(`.custom-select-wrapper[data-for="${selectEl.id || ''}"]`);
  if (!wrapper) return;

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

      optionsUl.appendChild(li);
    });

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

document.addEventListener("click", () => closeAllCustomSelects());
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeAllCustomSelects();
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

function loadLocalUserCache() {
  runDataSchemaMigrations();
  try {
    monthlyBudget = parseFloat(safeGet(cacheKey("budget"))) || 0;
    expenses = JSON.parse(safeGet(cacheKey("expenses"))) || [];
    recurring = JSON.parse(safeGet(cacheKey("recurring"))) || [];
  } catch (e) {
    monthlyBudget = 0; expenses = []; recurring = [];
  }
}

function saveLocalUserCache() {
  safeSet(cacheKey("expenses"), JSON.stringify(expenses));
  safeSet(cacheKey("recurring"), JSON.stringify(recurring));
  safeSet(cacheKey("budget"), String(monthlyBudget));
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
applyTheme(safeGet("budgelist-theme") ||
  (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));

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
          } else if (item.type === "UPDATE_PROFILE") {
            await setDoc(doc(db, "users", uid), item.data, { merge: true });
          } else if (item.type === "CONVERT_CURRENCY") {
            let batch = writeBatch(db);
            let opCount = 0;

            if (item.data.monthlyBudget !== undefined || item.data.currencySymbol) {
              const uData = {};
              if (item.data.monthlyBudget !== undefined) uData.monthlyBudget = item.data.monthlyBudget;
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

      // Restore currency symbol from Firestore
      if (uData.currencySymbol) {
        currencySymbol = uData.currencySymbol;
        safeSet("budgelist-currency-symbol", currencySymbol);
        const sel = $("currency-select");
        if (sel) {
          sel.value = currencySymbol;
          syncCustomSelect(sel);
        }
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
}

function openSettingsSheet() {
  updateProfileWidgetUI();
  const savedName = safeGet(cacheKey("name")) || "";
  const autoSyncVal = safeGet(cacheKey("auto-sync")) !== "false";

  $("settings-name").value = savedName;
  $("settings-email").value = isGuest ? "Guest account" : (auth.currentUser ? auth.currentUser.email : "");

  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  $("settings-dark-toggle").checked = isDark;
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
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("budgelist-pending-email-change-")) {
        keys.push(k);
      }
    }

    if (keys.length === 0) return false;

    for (const key of keys) {
      const raw = safeGet(key);
      if (!raw) continue;
      let data = null;
      try { data = JSON.parse(raw); } catch (e) {}
      if (!data || !data.password) {
        localStorage.removeItem(key);
        continue;
      }

      if (data.timestamp && Date.now() - data.timestamp > 86400000) {
        localStorage.removeItem(key);
        continue;
      }

      if (data.newEmail) {
        try {
          const cred = await signInWithEmailAndPassword(auth, data.newEmail.toLowerCase(), data.password);
          if (cred && cred.user) {
            localStorage.removeItem(key);
            await syncEmailAcrossFirestore(cred.user.uid, data.newEmail);
            return true;
          }
        } catch (e1) {
          console.log("Silent recovery with newEmail failed, trying oldEmail...", e1);
        }
      }

      if (data.oldEmail) {
        try {
          const cred = await signInWithEmailAndPassword(auth, data.oldEmail.toLowerCase(), data.password);
          if (cred && cred.user) {
            if (cred.user.email && cred.user.email.toLowerCase() === data.newEmail.toLowerCase()) {
              localStorage.removeItem(key);
              await syncEmailAcrossFirestore(cred.user.uid, data.newEmail);
            }
            return true;
          }
        } catch (e2) {
          console.log("Silent recovery with oldEmail failed:", e2);
        }
      }
    }
  } catch (err) {
    console.error("Error during silent session recovery:", err);
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

$("currency-btn").addEventListener("click", () => {
  currencyMenuView.classList.remove("hidden");
  currencyChangeView.classList.add("hidden");
  currencyConvertView.classList.add("hidden");
  $("currency-modal-title").textContent = "Currency Options";
  currencyModal.classList.remove("hidden");
});

$("close-currency-modal").addEventListener("click", () => currencyModal.classList.add("hidden"));
$("back-currency-menu").addEventListener("click", () => {
  currencyChangeView.classList.add("hidden");
  currencyMenuView.classList.remove("hidden");
  $("currency-modal-title").textContent = "Currency Options";
});
$("back-currency-menu-2").addEventListener("click", () => {
  currencyConvertView.classList.add("hidden");
  currencyMenuView.classList.remove("hidden");
  $("currency-modal-title").textContent = "Currency Options";
});

$("menu-change-currency").addEventListener("click", () => {
  currencyMenuView.classList.add("hidden");
  currencyChangeView.classList.remove("hidden");
  $("currency-modal-title").textContent = "Change Currency Symbol";
  const sel = $("currency-select");
  if (sel) {
    sel.value = currencySymbol;
    syncCustomSelect(sel);
  }
});

$("menu-convert-currency").addEventListener("click", () => {
  currencyMenuView.classList.add("hidden");
  currencyConvertView.classList.remove("hidden");
  $("currency-modal-title").textContent = "Convert Currency via API";

  const currentCode = getCurrentCurrencyCode();
  const convertStatus = $("convert-status");
  if (convertStatus) {
    convertStatus.innerHTML = `Current currency: <strong>${escapeHtml(currentCode)} (${escapeHtml(currencySymbol)})</strong>. Select target currency below:`;
  }
});

$("save-currency-btn").addEventListener("click", () => {
  currencySymbol = $("currency-select").value;
  safeSet("budgelist-currency-symbol", currencySymbol);
  enqueueSync({ type: "UPDATE_PROFILE", data: { currencySymbol } });
  currencyModal.classList.add("hidden");
  render();
  renderRecurring();
  showToast(`Currency symbol updated to ${currencySymbol}`);
});

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

    monthlyBudget = Math.round(monthlyBudget * rate * 100) / 100;
    expenses.forEach(e => {
      e.amount = Math.round(e.amount * rate * 100) / 100;
    });
    recurring.forEach(r => {
      r.amount = Math.round(r.amount * rate * 100) / 100;
    });

    const targetSymbol = CURRENCY_MAP[targetCurrency] || targetCurrency;
    currencySymbol = targetSymbol;
    safeSet("budgelist-currency-symbol", currencySymbol);

    const sel = $("currency-select");
    if (sel) {
      sel.value = currencySymbol;
      syncCustomSelect(sel);
    }

    saveLocalUserCache();

    // Enqueue sync mutation to save converted amounts & currencySymbol to Firestore
    enqueueSync({
      type: "CONVERT_CURRENCY",
      data: {
        currencySymbol: currencySymbol,
        monthlyBudget: monthlyBudget,
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

const APP_VERSION = "0.1.1-beta";
const GITHUB_REPO = "kuraku01/budgelist";
let updateDownloadUrl = `https://github.com/${GITHUB_REPO}/releases`;
let currentLatestTag = "";

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

const updateModal = $("update-modal");
const cancelUpdateBtn = $("cancel-update-btn");
const downloadUpdateBtn = $("download-update-btn");

if (cancelUpdateBtn) {
  cancelUpdateBtn.addEventListener("click", () => {
    if (updateModal) updateModal.classList.add("hidden");
    if (currentLatestTag) {
      safeSet("budgelist-skipped-update", currentLatestTag);
    }
  });
}

if (downloadUpdateBtn) {
  downloadUpdateBtn.addEventListener("click", () => {
    if (updateModal) updateModal.classList.add("hidden");
    window.open(updateDownloadUrl, "_blank");
  });
}

function showUpdateModal(latestTag, downloadUrl, isForced = false) {
  currentLatestTag = latestTag;
  const currentVerEl = $("update-current-version");
  const latestVerEl = $("update-latest-version");
  const modalTitle = $("update-modal-title");
  const modalMsg = $("update-modal-msg");

  if (currentVerEl) currentVerEl.textContent = `v${APP_VERSION.replace(/^v/i, "")}`;
  if (latestVerEl) latestVerEl.textContent = latestTag.startsWith("v") ? latestTag : `v${latestTag}`;
  if (downloadUrl) updateDownloadUrl = downloadUrl;

  if (isForced) {
    if (modalTitle) modalTitle.textContent = "Update Required";
    if (modalMsg) modalMsg.textContent = "A new version of Budgelist is required to continue. Please download and install the update to proceed.";
    if (cancelUpdateBtn) cancelUpdateBtn.classList.add("hidden");
  } else {
    if (modalTitle) modalTitle.textContent = "Update Available";
    if (modalMsg) modalMsg.textContent = "A new version of Budgelist is available for download!";
    if (cancelUpdateBtn) cancelUpdateBtn.classList.remove("hidden");
  }

  if (updateModal) updateModal.classList.remove("hidden");
}

async function checkForAppUpdates(isStartup = false, silent = false) {
  if (!silent) showToast("Checking for updates...");
  const online = await checkNetworkConnection();
  if (!online) {
    if (!silent) showToast(`Offline. You are on v${APP_VERSION}`);
    return false;
  }

  const originScreen = isGuest || uid ? "app" : "auth";

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=1`, {
      headers: { Accept: "application/vnd.github.v3+json" },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const releases = await res.json();
      if (Array.isArray(releases) && releases.length > 0) {
        const latest = releases[0];
        const latestTag = (latest.tag_name || "").trim();

        // 1. Check for automated Web ZIP OTA update bundle attached to release
        const otaApplied = await checkAndApplyOtaZipBundle(latest);
        if (otaApplied) return true;

        if (latestTag && isNewerVersion(latestTag, APP_VERSION)) {
          const isMandatory = isMandatoryUpdate(latestTag, APP_VERSION, latest.body);
          const skippedTag = safeGet("budgelist-skipped-update");

          // Skip prompt on startup for optional updates the user chose to skip earlier
          if (isStartup && !isMandatory && skippedTag === latestTag) {
            return false;
          }

          if (!silent) showToast(`Update available: ${latestTag}!`);
          showUpdateModal(latestTag, latest.html_url || `https://github.com/${GITHUB_REPO}/releases`, isMandatory);
          return true;
        }
      }
    }
    if (!silent) showToast(`You are on the latest version (v${APP_VERSION})`);
  } catch (e) {
    if (!silent) showToast(`You are on version v${APP_VERSION}`);
  } finally {
    if (!isStartup) {
      showScreen(originScreen);
    }
  }
  return false;
}

// ---------- GitHub Release ZIP OTA Live Updates Engine ----------
let isOtaUpdating = false;
let otaCancelController = null;

async function checkAndApplyOtaZipBundle(release) {
  if (isOtaUpdating || !release || !Array.isArray(release.assets)) return false;

  // Find a zip asset attached to release (e.g. dist.zip, bundle.zip, web.zip)
  const zipAsset = release.assets.find(
    (a) => a.name && (a.name.endsWith(".zip") || a.name.includes("dist") || a.name.includes("bundle"))
  );
  if (!zipAsset || !zipAsset.browser_download_url) return false;

  const latestTag = (release.tag_name || "").trim();
  const bundleKey = `${latestTag}_${zipAsset.updated_at || zipAsset.id || zipAsset.size}`;
  const installedBundleKey = safeGet("budgelist-installed-bundle-key");

  // If this exact bundle is already installed, skip
  if (installedBundleKey === bundleKey) return false;

  // Ensure release is compatible (same or newer version than base app)
  if (!isSameOrNewerVersion(latestTag, APP_VERSION)) return false;

  if (typeof JSZip === "undefined") {
    console.warn("[OTA] JSZip is not loaded, skipping OTA bundle extraction.");
    return false;
  }

  isOtaUpdating = true;
  console.log(`[OTA] Starting web bundle download: ${bundleKey}`);

  const statusText = $("loading-status-text");
  const progressWrap = $("ota-progress-wrap");
  const progressBar = $("ota-progress-bar");
  const statusDetail = $("ota-status-detail");
  const skipBtn = $("ota-skip-btn");

  showScreen("loading");
  if (statusText) statusText.textContent = `Updating Budgelist (${latestTag})...`;
  if (progressWrap) progressWrap.classList.remove("hidden");
  if (progressBar) progressBar.style.width = "5%";
  if (statusDetail) {
    statusDetail.classList.remove("hidden");
    statusDetail.textContent = "Connecting to update server...";
  }

  let skipped = false;
  otaCancelController = new AbortController();

  let skipTimer = setTimeout(() => {
    if (skipBtn) skipBtn.classList.remove("hidden");
  }, 5000);

  if (skipBtn) {
    skipBtn.onclick = () => {
      console.log("[OTA] User cancelled update.");
      skipped = true;
      if (otaCancelController) otaCancelController.abort();
    };
  }

  try {
    if (statusDetail) statusDetail.textContent = "Fetching release assets...";
    const res = await fetch(zipAsset.browser_download_url, { signal: otaCancelController.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const contentLength = res.headers.get("content-length");
    const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;

    let blob;
    if (res.body && typeof ReadableStream !== "undefined" && totalBytes > 0) {
      const reader = res.body.getReader();
      let receivedBytes = 0;
      const chunks = [];

      while (true) {
        if (skipped) throw new Error("Update cancelled by user.");
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        receivedBytes += value.length;
        const pct = Math.min(90, Math.round((receivedBytes / totalBytes) * 90));
        if (statusText) statusText.textContent = `Downloading update (${latestTag}): ${pct}%`;
        if (progressBar) progressBar.style.width = `${pct}%`;
        if (statusDetail) statusDetail.textContent = `${Math.round(receivedBytes / 1024)} KB / ${Math.round(totalBytes / 1024)} KB`;
      }
      blob = new Blob(chunks);
    } else {
      blob = await res.blob();
      if (progressBar) progressBar.style.width = "70%";
    }

    if (skipped) throw new Error("Update cancelled by user.");

    if (statusText) statusText.textContent = "Extracting assets...";
    if (statusDetail) statusDetail.textContent = "Unpacking web bundle...";
    if (progressBar) progressBar.style.width = "90%";

    const zip = await JSZip.loadAsync(blob);
    const updates = {};

    // Extract updated web assets
    for (const [filename, fileEntry] of Object.entries(zip.files)) {
      if (fileEntry.dir) continue;
      const cleanName = filename.replace(/^.*?public\//, "").replace(/^.*?\//, "");
      if (cleanName === "app.js" || cleanName === "style.css" || cleanName === "index.html") {
        const content = await fileEntry.async("string");
        updates[cleanName] = content;
      }
    }

    if (updates["app.js"] || updates["style.css"]) {
      if (updates["app.js"]) safeSet("budgelist-bundle-app-js", updates["app.js"]);
      if (updates["style.css"]) safeSet("budgelist-bundle-style-css", updates["style.css"]);
      safeSet("budgelist-installed-bundle-key", bundleKey);
      safeSet("budgelist-installed-bundle-tag", latestTag);

      if (progressBar) progressBar.style.width = "100%";
      if (statusText) statusText.textContent = "Update complete!";
      if (statusDetail) statusDetail.textContent = "Reloading application...";
      console.log(`[OTA] Web bundle ${bundleKey} installed successfully.`);

      setTimeout(() => {
        window.location.reload();
      }, 400);
      return true;
    }
  } catch (err) {
    console.warn("[OTA] Live update process aborted or failed:", err.message || err);
  } finally {
    clearTimeout(skipTimer);
    if (progressWrap) progressWrap.classList.add("hidden");
    if (statusDetail) statusDetail.classList.add("hidden");
    if (skipBtn) skipBtn.classList.add("hidden");
    if (statusText) statusText.textContent = "Loading session...";
    isOtaUpdating = false;
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
    authSub.innerHTML = 'Log spending, catch recurring bills, and see where the month is headed before it\'s over.<br><span style="display:inline-block; margin-top:10px; padding:6px 12px; background:rgba(99,102,241,0.12); border:1px solid var(--primary); border-radius:var(--radius-sm); color:var(--primary); font-size:13px; font-weight:700;">✨ Live OTA Test: Update Received Successfully! ✨</span>';
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

onAuthStateChanged(auth, async (user) => {
  isAuthResolved = true;
  clearTimeout(authTimeout);

  if (!isInitialStartupUpdateChecked) {
    isInitialStartupUpdateChecked = true;
    const otaHandled = await checkForAppUpdates(true, true);
    if (otaHandled) return;
  }

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

function handleLogout() {
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

$("logout-btn").addEventListener("click", handleLogout);

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
expenseForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const amount = parseFloat($("amount").value);
  const category = $("category").value;
  const note = $("note").value.trim();
  if (!amount || amount <= 0) return;

  if (isGuest) {
    if (editingId) {
      const exp = expenses.find((x) => x.id === editingId);
      if (exp) { exp.amount = amount; exp.category = category; exp.note = note; }
      showToast("Expense updated");
    } else {
      const now = new Date();
      let expDate = todayISO();
      if (toLocalMonthPrefix(viewDate) !== toLocalMonthPrefix(now)) {
        const day = Math.min(now.getDate(), new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0).getDate());
        expDate = toLocalISO(new Date(viewDate.getFullYear(), viewDate.getMonth(), day));
      }
      expenses.unshift({
        id: "guest_" + Math.random().toString(36).slice(2, 10),
        amount, category, note, dateISO: expDate, createdAt: Date.now(),
      });
      showToast("Expense added");
    }
    saveLocalUserCache();
    applyRecurringForThisMonth();
    render();
    closeExpenseSheet();
    return;
  }

  if (editingId) {
    const exp = expenses.find((x) => x.id === editingId);
    if (exp) { exp.amount = amount; exp.category = category; exp.note = note; }
    enqueueSync({ type: "UPDATE_EXPENSE", id: editingId, data: { amount, category, note } });
    showToast("Expense updated");
  } else {
    const now = new Date();
    let expDate = todayISO();
    if (toLocalMonthPrefix(viewDate) !== toLocalMonthPrefix(now)) {
      const day = Math.min(now.getDate(), new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0).getDate());
      expDate = toLocalISO(new Date(viewDate.getFullYear(), viewDate.getMonth(), day));
    }
    const newExp = {
      id: "cloud_exp_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
      amount, category, note, dateISO: expDate, createdAt: Date.now(),
    };
    expenses.unshift(newExp);
    enqueueSync({ type: "ADD_EXPENSE", data: newExp });
    showToast("Expense added");
  }
  saveLocalUserCache();
  applyRecurringForThisMonth();
  render();
  closeExpenseSheet();
});

$("delete-expense-btn").addEventListener("click", async () => {
  if (!editingId) return;
  if (isGuest) {
    expenses = expenses.filter((e) => e.id !== editingId);
    saveLocalUserCache();
    render();
    closeExpenseSheet();
    showToast("Expense deleted");
    return;
  }
  expenses = expenses.filter((e) => e.id !== editingId);
  enqueueSync({ type: "DELETE_EXPENSE", id: editingId });
  saveLocalUserCache();
  render();
  closeExpenseSheet();
  showToast("Expense deleted");
});

function openExpenseSheet(expense) {
  editingId = expense ? expense.id : null;
  $("expense-sheet-title").textContent = expense ? "Edit expense" : "Add expense";
  $("delete-expense-btn").classList.toggle("hidden", !expense);
  $("amount").value = expense ? expense.amount : "";
  $("category").value = expense ? expense.category : "Food";
  $("note").value = expense ? expense.note || "" : "";
  addSheet.classList.remove("hidden");
}
function closeExpenseSheet() {
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

    safeSet(appliedKey, "true");
  } finally {
    isApplyingRecurring = false;
  }
}

// ---------- Budget ----------
budgetForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  monthlyBudget = parseFloat($("budget-input").value) || 0;
  if (isGuest) {
    saveLocalUserCache();
    budgetSheet.classList.add("hidden");
    render();
    showToast("Monthly budget saved");
    return;
  }
  saveLocalUserCache();
  enqueueSync({ type: "SET_BUDGET", amount: monthlyBudget });
  budgetSheet.classList.add("hidden");
  render();
  showToast("Monthly budget saved");
});

budgetBtn.addEventListener("click", () => {
  $("budget-input").value = monthlyBudget || "";
  budgetSheet.classList.remove("hidden");
});
$("cancel-budget").addEventListener("click", () => budgetSheet.classList.add("hidden"));

// ---------- Month navigation ----------
const monthLabelFmt = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });

function changeMonth(delta) {
  const next = new Date(viewDate.getFullYear(), viewDate.getMonth() + delta, 1);
  if (next > startOfMonth(new Date())) return; // no future months
  viewDate = next;
  render();
}
$("prev-month").addEventListener("click", () => changeMonth(-1));
$("next-month").addEventListener("click", () => changeMonth(1));

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
async function exportCsvData() {
  const { monthExpenses } = currentMonthData();
  if (monthExpenses.length === 0) {
    showToast("No expenses to export for this month.");
    return;
  }

  const rows = [["Date", "Category", "Note", "Amount"]];
  monthExpenses.forEach((e) => rows.push([e.dateISO, e.category, e.note || "", e.amount.toFixed(2)]));
  const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
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
  const monthExpenses = expenses.filter((e) => e.dateISO && e.dateISO.startsWith(monthPrefix));
  const realNow = new Date();
  const isCurrentMonth = monthPrefix === toLocalMonthPrefix(realNow);
  const daysInMonth = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0).getDate();
  const today = isCurrentMonth ? realNow.getDate() : daysInMonth;
  return { monthPrefix, monthExpenses, isCurrentMonth, daysInMonth, today };
}

// ---------- Rendering ----------
function render() {
  const { monthExpenses, isCurrentMonth, daysInMonth, today } = currentMonthData();
  const monthTotal = monthExpenses.reduce((s, e) => s + e.amount, 0);

  $("month-label").textContent = monthLabelFmt.format(viewDate);
  $("month-total").textContent = fmt(monthTotal);
  $("next-month").disabled = viewDate >= startOfMonth(new Date());

  renderBudgetBar(monthTotal);
  renderCategories(monthExpenses);
  renderExpenseList(monthExpenses);
  renderForecast(monthExpenses, isCurrentMonth, daysInMonth, today);
}

function renderBudgetBar(spent) {
  const barWrap = $("budget-bar-wrap");
  if (!barWrap) return;

  if (monthlyBudget > 0) {
    barWrap.classList.remove("hidden");
    const percent = Math.min(100, Math.max(0, (spent / monthlyBudget) * 100));
    const remaining = monthlyBudget - spent;
    const remainingText = $("budget-remaining-text");
    const fill = $("budget-progress-fill");

    $("budget-status-text").textContent = `Spent ${fmt(spent)} of ${fmt(monthlyBudget)} budget`;

    if (remaining >= 0) {
      remainingText.textContent = `${fmt(remaining)} left`;
      remainingText.classList.remove("over");
      fill.classList.remove("over");
    } else {
      remainingText.textContent = `${fmt(Math.abs(remaining))} over budget`;
      remainingText.classList.add("over");
      fill.classList.add("over");
    }

    fill.style.width = `${percent}%`;
  } else {
    barWrap.classList.add("hidden");
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
  const max = Math.max(1, ...Object.values(sums));
  const entries = sortedCategoryEntries(sums);

  $("category-list").innerHTML = entries.map(({ cat, amount }) => {
    const pct = total > 0 ? Math.round((amount / total) * 100) : 0;
    const safeCat = escapeHtml(cat);
    const safeAmount = escapeHtml(fmt(amount));
    const safeColor = escapeHtml(catColor(cat));
    return `
    <div class="category-row">
      <span class="cat-dot" style="background:${safeColor}"></span>
      <span class="cat-name">${safeCat}</span>
      <span class="cat-bar-track">
        <span class="cat-bar-fill" style="width:${(amount / max) * 100}%;background:${safeColor}"></span>
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

function renderExpenseList(monthExpenses) {
  const sorted = [...monthExpenses].sort((a, b) => b.dateISO.localeCompare(a.dateISO) || b.createdAt - a.createdAt);
  const container = $("expense-list");
  $("empty-state").classList.toggle("hidden", sorted.length > 0);
  container.innerHTML = "";

  const fragment = document.createDocumentFragment();

  sorted.forEach((e) => {
    const li = document.createElement("li");
    li.dataset.id = e.id;

    const mainDiv = document.createElement("div");
    mainDiv.className = "expense-main";

    const dot = document.createElement("span");
    dot.className = "cat-dot-sm";
    dot.style.background = catColor(e.category);

    const textDiv = document.createElement("div");
    textDiv.className = "expense-text";

    const catSpan = document.createElement("span");
    catSpan.className = "expense-cat";
    catSpan.textContent = e.category + (e.recurringId ? " · recurring" : "");

    textDiv.appendChild(catSpan);

    if (e.note) {
      const noteSpan = document.createElement("span");
      noteSpan.className = "expense-note";
      noteSpan.textContent = e.note;
      textDiv.appendChild(noteSpan);
    }

    mainDiv.appendChild(dot);
    mainDiv.appendChild(textDiv);

    const sideDiv = document.createElement("div");

    const dateSpan = document.createElement("span");
    dateSpan.className = "expense-date";
    dateSpan.textContent = e.dateISO ? e.dateISO.slice(5) : "";

    const amountSpan = document.createElement("span");
    amountSpan.className = "expense-amount";
    amountSpan.textContent = fmt(e.amount);

    sideDiv.appendChild(dateSpan);
    sideDiv.appendChild(amountSpan);

    li.appendChild(mainDiv);
    li.appendChild(sideDiv);

    li.addEventListener("click", () => {
      const exp = expenses.find((x) => x.id === e.id);
      if (exp) openExpenseSheet(exp);
    });

    fragment.appendChild(li);
  });

  container.appendChild(fragment);
}

function renderRecurring() {
  $("recurring-empty").classList.toggle("hidden", recurring.length > 0);
  $("recurring-list").innerHTML = recurring.map((r) => `
    <li data-id="${escapeHtml(r.id)}">
      <div class="recurring-main">
        <span class="cat-dot-sm" style="background:${escapeHtml(catColor(r.category))}"></span>
        <div class="recurring-text">
          <span class="recurring-name">${escapeHtml(r.note)}</span>
          <span class="recurring-sub">${escapeHtml(r.category)} · day ${escapeHtml(r.dayOfMonth)}</span>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <span class="recurring-amount">${escapeHtml(fmt(r.amount))}</span>
        <button class="recurring-delete" data-id="${escapeHtml(r.id)}" aria-label="Delete">&times;</button>
      </div>
    </li>`).join("");

  $("recurring-list").querySelectorAll("li").forEach((li) => {
    li.addEventListener("click", () => {
      const r = recurring.find((x) => x.id === li.dataset.id);
      if (r) openRecurringSheet(r);
    });
  });
  $("recurring-list").querySelectorAll(".recurring-delete").forEach((btn) => {
    btn.addEventListener("click", (e) => { e.stopPropagation(); deleteRecurring(btn.dataset.id); });
  });
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

function renderForecast(monthExpenses, isCurrentMonth, daysInMonth, today) {
  const container = $("forecast-chart");
  const legend = $("forecast-legend");
  const empty = $("forecast-empty");
  const note = $("forecast-note");

  if (monthExpenses.length === 0) {
    container.classList.add("hidden");
    container.innerHTML = "";
    legend.classList.add("hidden");
    empty.classList.remove("hidden");
    note.classList.add("hidden");
    $("budget-warning").classList.add("hidden");
    return;
  }
  container.classList.remove("hidden");
  legend.classList.remove("hidden");
  empty.classList.add("hidden");
  note.classList.remove("hidden");

  const dailyTotals = Array(today).fill(0);
  monthExpenses.forEach((e) => {
    const day = parseInt(e.dateISO.slice(8, 10), 10);
    if (day >= 1 && day <= today) dailyTotals[day - 1] += e.amount;
  });
  const cumulative = [];
  dailyTotals.reduce((acc, v, i) => (cumulative[i] = acc + v, acc + v), 0);

  const { slope, intercept } = leastSquares(cumulative.map((_, i) => i + 1), cumulative);
  const projectedTotal = isCurrentMonth
    ? Math.max(cumulative[cumulative.length - 1] || 0, slope * daysInMonth + intercept)
    : (cumulative[cumulative.length - 1] || 0);

  const labels = [], actual = [], projected = [];
  for (let d = 1; d <= daysInMonth; d++) {
    labels.push(d);
    actual.push(d <= today ? cumulative[d - 1] : null);
    projected.push(isCurrentMonth && d >= today ? slope * d + intercept : null);
  }
  drawChart(labels, actual, projected);

  note.textContent = isCurrentMonth
    ? `Trending toward ${fmt(Math.max(0, projectedTotal))} by day ${daysInMonth}` +
      (monthlyBudget > 0 ? ` (budget: ${fmt(monthlyBudget)}).` : ".")
    : `${fmt(projectedTotal)} spent this month.`;

  const warning = $("budget-warning");
  if (monthlyBudget > 0 && projectedTotal > monthlyBudget) {
    warning.classList.remove("hidden");
    $("budget-warning-text").textContent = isCurrentMonth
      ? `At this pace you'll be ${fmt(projectedTotal - monthlyBudget)} over budget this month.`
      : `This month ended ${fmt(projectedTotal - monthlyBudget)} over budget.`;
  } else {
    warning.classList.add("hidden");
  }
}

function leastSquares(xs, ys) {
  const n = xs.length;
  if (n < 2) return { slope: ys[0] || 0, intercept: 0 };
  const sumX = xs.reduce((a, b) => a + b, 0);
  const sumY = ys.reduce((a, b) => a + b, 0);
  const sumXY = xs.reduce((s, x, i) => s + x * ys[i], 0);
  const sumXX = xs.reduce((s, x) => s + x * x, 0);
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n };
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

function drawChart(labels, actual, projected) {
  const styles = getComputedStyle(document.documentElement);
  const primary = styles.getPropertyValue("--primary").trim();
  const warn = styles.getPropertyValue("--warn").trim();
  const inkSoft = styles.getPropertyValue("--ink-soft").trim();
  const lineColor = styles.getPropertyValue("--line").trim();

  $("legend-dot-spent").style.background = primary;
  $("legend-dot-projected").style.background = warn;

  const width = 320, height = 160, pad = { top: 10, right: 10, bottom: 22, left: 34 };
  const innerW = width - pad.left - pad.right, innerH = height - pad.top - pad.bottom;
  const allVals = [...actual, ...projected].filter((v) => v != null);
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
    return segs.map((seg) => `<polyline points="${seg.join(" ")}" fill="none" stroke="${color}"
      stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round" ${dash ? `stroke-dasharray="${dash}"` : ""}></polyline>`).join("");
  }

  const gridY = [0, 0.5, 1].map((f) => {
    const y = pad.top + innerH * (1 - f);
    return `<line x1="${pad.left}" y1="${y.toFixed(1)}" x2="${width - pad.right}" y2="${y.toFixed(1)}" stroke="${lineColor}" stroke-width="1"></line>`;
  }).join("");

  const yLabels = [0, 0.5, 1].map((f) => {
    const y = pad.top + innerH * (1 - f);
    return `<text x="${pad.left - 6}" y="${(y + 3).toFixed(1)}" font-size="9" fill="${inkSoft}" text-anchor="end" font-family="Inter, sans-serif">$${Math.round(maxY * f)}</text>`;
  }).join("");

  const xTickDays = [1, Math.max(1, Math.round(n / 2)), n].filter((v, i, a) => a.indexOf(v) === i);
  const xLabels = xTickDays.map((d) => {
    const i = d - 1;
    return `<text x="${xAt(i).toFixed(1)}" y="${height - 10}" font-size="9" fill="${inkSoft}" text-anchor="middle" font-family="Inter, sans-serif">${d}</text>`;
  }).join("");

  $("forecast-chart").innerHTML = `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" aria-label="Spending forecast over the month">
    ${gridY}
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

// ---------- Background Scroll Lock for Modals & Sheets ----------
function updateBodyScrollLock() {
  const hasOpenModal = document.querySelectorAll(".sheet:not(.hidden), .modal:not(.hidden)").length > 0;
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
  document.querySelectorAll(".sheet, .modal").forEach((el) => {
    modalObserver.observe(el, { attributes: true, attributeFilter: ["class"] });
  });
  updateBodyScrollLock();
}, 200);