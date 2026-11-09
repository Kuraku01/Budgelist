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
