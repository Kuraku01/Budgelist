import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, sendEmailVerification,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, collection, addDoc, updateDoc,
  deleteDoc, getDocs, query, orderBy,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);

function safeGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
function safeSet(key, value) { try { localStorage.setItem(key, value); return true; } catch (e) { return false; } }

const authScreen = $("auth-screen"), appScreen = $("app-screen");
const authForm = $("auth-form"), authError = $("auth-error");
const addBtn = $("add-btn"), addSheet = $("add-sheet"), expenseForm = $("expense-form");
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

const fmt = (n) => "$" + n.toFixed(2);
const todayISO = () => toLocalISO(new Date());
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function catColor(cat) { return getComputedStyle(document.documentElement).getPropertyValue(CAT_VAR[cat] || CAT_VAR.Other).trim(); }

// ---------- Local Cache & Sync Queue ----------
function cacheKey(key) { return `budgelist-user-${uid || "guest"}-${key}`; }

function loadLocalUserCache() {
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

async function checkNetworkConnection() {
  if (!navigator.onLine) return false;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);
    await fetch("https://www.gstatic.com/generate_204", {
      method: "HEAD",
      mode: "no-cors",
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return true;
  } catch (e) {
    return false;
  }
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
    lastKnownOnlineState = false;
  } else if (lastKnownOnlineState === false) {
    banner.classList.remove("hidden", "offline");
    banner.classList.add("online");
    iconOffline.classList.add("hidden");
    iconOnline.classList.remove("hidden");
    bannerText.textContent = "Connection restored — synced!";
    lastKnownOnlineState = true;

    const autoSyncEnabled = safeGet(cacheKey("auto-sync")) !== "false";
    if (autoSyncEnabled) syncCloudData(false);

    statusBannerTimer = setTimeout(() => {
      banner.classList.add("hidden");
    }, 3500);
  } else {
    banner.classList.add("hidden");
    lastKnownOnlineState = true;
  }
}

async function monitorBackgroundNetwork() {
  const online = await checkNetworkConnection();
  updateRealtimeNetworkBanner(online);
}

window.addEventListener("online", () => monitorBackgroundNetwork());
window.addEventListener("offline", () => updateRealtimeNetworkBanner(false));

setInterval(() => monitorBackgroundNetwork(), 6000);

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
async function syncCloudData(showToastFeedback = false) {
  if (isGuest || !uid || isSyncing) return;
  const online = await checkNetworkConnection();
  if (!online) {
    if (showToastFeedback) showToast("Offline — changes saved locally.");
    return;
  }

  isSyncing = true;
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
            await setDoc(doc(db, "users", uid, "expenses", item.data.id), item.data);
          } else if (item.type === "UPDATE_EXPENSE") {
            await updateDoc(doc(db, "users", uid, "expenses", item.id), item.data);
          } else if (item.type === "DELETE_EXPENSE") {
            await deleteDoc(doc(db, "users", uid, "expenses", item.id));
          } else if (item.type === "ADD_RECURRING") {
            await setDoc(doc(db, "users", uid, "recurring", item.data.id), item.data);
          } else if (item.type === "UPDATE_RECURRING") {
            await updateDoc(doc(db, "users", uid, "recurring", item.id), item.data);
          } else if (item.type === "DELETE_RECURRING") {
            await deleteDoc(doc(db, "users", uid, "recurring", item.id));
          } else if (item.type === "SET_BUDGET") {
            await setDoc(doc(db, "users", uid), { monthlyBudget: item.amount }, { merge: true });
          }
        } catch (e) {
          syncQueue.push(item);
          saveSyncQueue();
        }
      }
    }

    const userDocSnap = await getDoc(doc(db, "users", uid));
    if (userDocSnap.exists()) {
      monthlyBudget = userDocSnap.data().monthlyBudget || 0;
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

    if (showToastFeedback) showToast("Synced with cloud!");
  } catch (e) {
    if (showToastFeedback) showToast("Sync failed. Local data preserved.");
  } finally {
    isSyncing = false;
  }
}

$("sync-btn").addEventListener("click", () => syncCloudData(true));

// ---------- Settings Sheet & Profile ----------
function openSettingsSheet() {
  const savedAvatar = safeGet(cacheKey("avatar")) || "🦊";
  const savedName = safeGet(cacheKey("name")) || "";
  const autoSyncVal = safeGet(cacheKey("auto-sync")) !== "false";

  document.querySelectorAll(".avatar-chip").forEach((chip) => {
    chip.classList.toggle("active", chip.dataset.avatar === savedAvatar);
  });

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

document.querySelectorAll(".avatar-chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    document.querySelectorAll(".avatar-chip").forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    safeSet(cacheKey("avatar"), chip.dataset.avatar);
    showToast(`Avatar updated ${chip.dataset.avatar}`);
  });
});

$("settings-name").addEventListener("change", (e) => {
  safeSet(cacheKey("name"), e.target.value.trim());
  showToast("Name saved");
});

$("change-password-btn").addEventListener("click", () => {
  if (isGuest) {
    showToast("Password change unavailable in Guest mode.");
  } else {
    showToast("Password change feature coming soon.");
  }
});

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

$("check-update-btn").addEventListener("click", () => {
  showToast("Checking for updates...");
  setTimeout(() => {
    showToast("You are on the latest version v1.0.0-beta!");
  }, 1200);
});

$("toggle-release-notes").addEventListener("click", () => {
  const notes = $("release-notes-content");
  const arrow = $("release-notes-arrow");
  if (!notes) return;
  const isHidden = notes.classList.contains("hidden");
  notes.classList.toggle("hidden", !isHidden);
  if (arrow) arrow.textContent = isHidden ? "▾" : "▸";
});

// ---------- Auth Mode & Guest Modal ----------
let authMode = "login"; // "login" or "signup"
const usernameFieldWrap = $("username-field-wrap");
const authIdLabel = $("auth-id-label");
const mainAuthBtn = $("main-auth-btn");
const toggleAuthModeBtn = $("toggle-auth-mode-btn");
const authTitle = $("auth-title");
const authSub = $("auth-sub");

function setAuthMode(mode) {
  authMode = mode;
  authError.textContent = "";
  if (mode === "login") {
    usernameFieldWrap.classList.add("hidden");
    authIdLabel.textContent = "Email or Username";
    $("auth-id").placeholder = "";
    mainAuthBtn.textContent = "Log in";
    toggleAuthModeBtn.textContent = "Create account";
    authTitle.textContent = "Budget, listed.";
    authSub.textContent = "Log spending, catch recurring bills, and see where the month is headed before it's over.";
  } else {
    usernameFieldWrap.classList.remove("hidden");
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
  authScreen.classList.add("hidden");
  appScreen.classList.remove("hidden");
  addBtn.classList.remove("hidden");
  verifyBanner.classList.add("hidden");
  recurringApplied = false;
  viewDate = startOfMonth(new Date());
  loadLocalUserCache();
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

onAuthStateChanged(auth, async (user) => {
  if (user && !isGuest) {
    uid = user.uid;
    authScreen.classList.add("hidden");
    appScreen.classList.remove("hidden");
    addBtn.classList.remove("hidden");
    verifyBanner.classList.toggle("hidden", user.emailVerified);
    recurringApplied = false;
    viewDate = startOfMonth(new Date());

    loadSyncQueue();
    loadLocalUserCache();
    applyRecurringForThisMonth();
    renderRecurring();
    render();

    monitorBackgroundNetwork();

    const autoSyncEnabled = safeGet(cacheKey("auto-sync")) !== "false";
    if (autoSyncEnabled) {
      syncCloudData(false);
    }
  } else if (!isGuest) {
    uid = null;
    authScreen.classList.remove("hidden");
    appScreen.classList.add("hidden");
    addBtn.classList.add("hidden");
    verifyBanner.classList.add("hidden");
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
      await setDoc(doc(db, "usernames", usernameLower), {
        uid: cred.user.uid,
        email: email.toLowerCase(),
        username: username,
      });
      await sendEmailVerification(cred.user);
      showToast("Account created! Please check your email for verification.");
    } catch (err) {
      authError.textContent = humanAuthError(err.code);
    }
  }
});

function handleLogout() {
  closeSettingsSheet();
  if (isGuest) {
    isGuest = false;
    uid = null;
    authScreen.classList.remove("hidden");
    appScreen.classList.add("hidden");
    addBtn.classList.add("hidden");
    verifyBanner.classList.add("hidden");
  } else {
    signOut(auth);
  }
}

$("logout-btn").addEventListener("click", handleLogout);

function humanAuthError(code) {
  const map = {
    "auth/invalid-email": "That email doesn't look right.",
    "auth/wrong-password": "Wrong password.",
    "auth/user-not-found": "No account with that email or username yet.",
    "auth/email-already-in-use": "An account already exists with that email.",
    "auth/weak-password": "Password should be at least 6 characters.",
    "auth/invalid-credential": "Invalid login credentials.",
  };
  return map[code] || "Something went wrong. Try again.";
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
    return `
    <div class="category-row">
      <span class="cat-dot" style="background:${catColor(cat)}"></span>
      <span class="cat-name">${cat}</span>
      <span class="cat-bar-track">
        <span class="cat-bar-fill" style="width:${(amount / max) * 100}%;background:${catColor(cat)}"></span>
      </span>
      <span class="cat-amount">${fmt(amount)}</span>
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
    const ring = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${catColor(e.cat)}"
      stroke-width="${strokeWidth}" stroke-dasharray="${len} ${circumference - len}"
      stroke-dashoffset="${-acc}" transform="rotate(-90 ${cx} ${cy})"></circle>`;
    acc += len;
    return ring;
  }).join("");
  return `<svg viewBox="0 0 ${size} ${size}" width="220" height="${size}" role="img" aria-label="Spending by category, donut chart">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${bg}" stroke-width="${strokeWidth}"></circle>
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
    return `
      <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${h.toFixed(1)}" rx="6" fill="${catColor(e.cat)}"></rect>
      <text x="${(x + barWidth / 2).toFixed(1)}" y="${height - 10}" font-size="9" fill="${inkSoft}" text-anchor="middle" font-family="Inter, sans-serif">${e.cat.slice(0, 4)}</text>`;
  }).join("");
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" aria-label="Spending by category, bar chart">${bars}</svg>`;
}

function renderExpenseList(monthExpenses) {
  const sorted = [...monthExpenses].sort((a, b) => b.dateISO.localeCompare(a.dateISO) || b.createdAt - a.createdAt);
  $("empty-state").classList.toggle("hidden", sorted.length > 0);
  $("expense-list").innerHTML = sorted.map((e) => `
    <li data-id="${e.id}">
      <div class="expense-main">
        <span class="cat-dot-sm" style="background:${catColor(e.category)}"></span>
        <div class="expense-text">
          <span class="expense-cat">${e.category}${e.recurringId ? " · recurring" : ""}</span>
          ${e.note ? `<span class="expense-note">${escapeHtml(e.note)}</span>` : ""}
        </div>
      </div>
      <div>
        <span class="expense-date">${e.dateISO.slice(5)}</span>
        <span class="expense-amount">${fmt(e.amount)}</span>
      </div>
    </li>`).join("");

  $("expense-list").querySelectorAll("li").forEach((li) => {
    li.addEventListener("click", () => {
      const exp = expenses.find((e) => e.id === li.dataset.id);
      if (exp) openExpenseSheet(exp);
    });
  });
}

function renderRecurring() {
  $("recurring-empty").classList.toggle("hidden", recurring.length > 0);
  $("recurring-list").innerHTML = recurring.map((r) => `
    <li data-id="${r.id}">
      <div class="recurring-main">
        <span class="cat-dot-sm" style="background:${catColor(r.category)}"></span>
        <div class="recurring-text">
          <span class="recurring-name">${escapeHtml(r.note)}</span>
          <span class="recurring-sub">${r.category} · day ${r.dayOfMonth}</span>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <span class="recurring-amount">${fmt(r.amount)}</span>
        <button class="recurring-delete" data-id="${r.id}" aria-label="Delete">&times;</button>
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
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
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
