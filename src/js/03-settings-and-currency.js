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
  if (typeof applyUiZoom === "function") applyUiZoom(uiZoomPercent);
  if (typeof applyExpensePageSize === "function") applyExpensePageSize(expensePageSize, false);
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

document.querySelectorAll(".ui-zoom-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const zoomVal = parseInt(btn.dataset.uiZoom || "100", 10);
    applyUiZoom(zoomVal);
    showToast(`UI Zoom set to ${zoomVal}%`);
  });
});

document.querySelectorAll(".exp-page-size-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const sizeVal = parseInt(btn.dataset.expPageSize || "10", 10);
    applyExpensePageSize(sizeVal, true);
    showToast(sizeVal === 0 ? "Showing all expenses on one page" : `Showing ${sizeVal} expenses per page`);
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

// Developer Profile Modal (Settings -> About -> Kuraku01)
const DEV_PROFILE_FALLBACK_DATA_URI =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAcFBQYFBAcGBgYIBwcICxILCwoKCxYPEA0SGhYbGhkWGRgcICgiHB4mHhgZIzAkJiorLS4tGyIyNTEsNSgsLSz/2wBDAQcICAsJCxULCxUsHRkdLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCz/wAARCADwAPADASIAAhEBAxEB/8QAHAAAAQUBAQEAAAAAAAAAAAAABQACAwQGAQcI/8QAQRAAAQQBAgMFBgMGBQIHAQAAAQACAxEEITEFEkEGEyJRYRRxgZGhsSMywQcVM0LR8BZScoLhJKIlQ0VTYpLxk//EABoBAAIDAQEAAAAAAAAAAAAAAAECAAMEBQb/xAAgEQACAgMBAAMBAQAAAAAAAAAAAQIRAxIhMQQiQVET/9oADAMBAAIRAxEAPwDzJhoCuqsNNUL96qxuuIEnrQpSB1aq8oLrH6/8qeJ3MaCosd56BWGyabV0CahbLhk6j+ypY3VoT8lVjeDrYtSMfZ10JRoW2EYXmtyFOH0Ah7JKViOUDRwFHT1RSFsvRy2aA1U8T9r8PVUWAO/K4/JWm2RfX10JUoHQhDKQ2hoLBKvwzs6j4oREaPLrqinD2d5J0AZq5xGyIOhrFcS3+evmikbxyjU0N9UJGTygsiaTZ6p7ZJHCiNugSBug0zJA2cPmiXDuM5GC62ODmHcHYrLsmrf7KeOflIINUo42FTo9Q4dxWLOi5gWg1rR2+CIWvMsPMfE9skTixw1BGi0vC+PNcO7yJnt8qCplCjRHIn6addCpxZbCB+JqdKcKVsGwkLLOpJJKBEkkkoQSSSShBJJJKEEkkkoQ+HbBaCCF1jiDuU3JgfiyuiJBoAj1B2TY9XAXorrKS4wUzmTw7azuN1Wa6y6txqFNEQ4kHobuvumQrLcBc+RrWb3XvV0uha4gW6vI1/foqUBfGx0la14QE+FjnOHJsd0RaLsYjdtbfOypGAk18LCjjxn8rXcta+atRwjmssHMfN1/ZGwUTYz46IcwF42vqr0DcjXlDWA/5dCfmq8QcKLAB8LKvwY9eNxYNdSdlLAWWtnNAsadPEKBRCBwjjDaFXdDa1VilMcZAdYcmxTXITzco+6BEFGvL+pAHkFKySvyuJ96GNygAKA1OgUjcl/5QQ01tsihWw5FM3ltwGmhHmnl0ZHMAK20QNsxs28V79VchJc2gLI1NnZEULwvBAp1Eeasse4O0dR80JhlPPThp6nRTMmaTzOppG3i0QoidGgx+IPjBbM+VwOgBkIH0RjA40MOIOM7pYS7l5H6uZ5G/JY05ZcwN52uq70/VWMeblxuTmcGvN0TvrskcS2OQ9Kg4jj5M5ijeHOAvRW1hcN2PJmQuaXR81tNHVp6Fa3h+S6WKPnIJcDseoNGlU40aIysupJBJKOJJJJQgkkklCCSSSUIfD2fke0Zr5eU0aaNegFBRNNHTQjfyTpWOime2UEa2FEK1F7+atKSzG0uNgUfNXCOUDu93b6aIdHzdL0VtjnFoabonqUQFuGbxOa4aEaEfqrkPPbq0sfyjr1VdjGlgs63VjdWMZvIabfrrqmAyQOaBZD3uvXUqzEJH3YofFRiFjrDi6t9FYB7uDljHK2/PVSxaZZilbGGjXTpdfNWIpnPk5L8LetII6Uvc4srTSwd1dxZRCyzq7bT7IihZ84urBDRVrokshrRv6oXHMOpJs7K0xw5rvpVlQiLnenVodQPW1wSEGgOVvobKqgOeSLTw0hu2nmimhXFsusyAPCCGq7DkcsRrzQppbdC2lTxuc2wdURaYTEr2tYb0JHxVls4Ivr5IX3nNGwkqRs4bvsiLQXjloC7A2VqKS9Lo9EGimDhTqKuwzaDWyFCILRZDi466h2i0nBuOdxkx+0u5omgtBrUWVjmzAk8uh+6kjyC11nolcUx1NxPYYZo54xJG4Oa7YhPXnXAe0c2DIIdHxk6tPX3LeYOfBnw95C+60I6hZ5Ro1wmpIspJJJSwSSSShBJJJKEPiWcMmi5HAhzRbD7uiH1Rsmx6K3kvPfNeBXgAAHT+9VUHW9hurGVFiJ7GgAg+ilaY2uADtCdL6KoKOvpSeHNI1BKJAhFKQ83LVildZkl8ZHM+yNm6WgzJQDyvDb89yrUOVEzw+JxHpt/REAUgc424h1N6EJ/fSv2YQCoG5fK1zGir9b1T2yPexoc7Q61/VMhS2WsaxvPJ02rdMhHe3yhxaP9rR8SomzsF2WiqGyTcwA0xpcR/MdUUKXyBCGaBzgOhv6q9jBz4+Zw9EExXPyMoW7mHUrQY0TpXAAaN2rRVylRZCNkrIw1hJ/M7cDdTxRNkIIHhOlXqmgPc4xRNDiNzur2Jw543LgT5FUuf6aFCytNihtlpBO4vdQxyADX3EdQjD8F5bQN+8KlkYLhZdE4OGgcHJ4ZCueIhDhsDd6rvNXh+NqBrZIjR26J5ZKRzctjqrlJGZwZLHIWbmx5q9HMaBu0M1DfRSRykEDb0TplbVBdk55ruydN09sxDhZQ3vKG+6dDOXPF9EwjDeLJ4idRqjmJxTKwpGSMkOnW9QPI+YWdxQ6QbgeQKuY8hoscfCbq0rSYU2j1LgvE3cTxu9LWt5Tykg3en0RNeddm+LzYkj8dr6a8+/VaQcWyr/i/9oWWf1ZthK0aFJZ88Uyi6u8+TQuHieVf8Y/IJLLDQpWs6eI5RNd876KXHzp3OcHTONUmXRW6PkXJdC/GBaHChQ8x/UoUdDVUN9VK6ewQ2QuAGirgl53OvmnsUeNF17nBltrRcaCeieQBp8dlAEDHOdICdCFcjceYHyVdrgx/MPEVYhAvm5vfYTIjL3MJSeU1XQ9U0zEEh2p6Uq7XsvY6bVouPyQAdB7+qli0W2zNoDmAvQ1upIpXOvlFDYBDISXuJJuzsi2OwFtuNCySVLCol7h80UUhsEnyC02DFk5Pia1zIjuWnUjy9EA4dhzyua+OOh51utGwZkTKLzVaHl2VE5rw0Qg0H8DFbE0NEPdtHSkVZjNAtuqy2FmZQJDybCP4XES4N5zZ29yyyNUaLvsvStFBPiiwK5giUcneNvzS5QbBA0SKVD6gn91NkHMQPNRDCZG+VhLRRvXyP9lXs/JMIIZqaWemx83Me6TxnoroSsomq8R3Nx4Wglj235boVREt3Y9yNY3A5nU6V3KPIaqy7gjHMGmo9FpjljHhmlicugB89g3sNE+CUMF7og/gTg5zdacNEJljdiPdHINvNaI5FLwyzxNdYXg4hG2hy38URgla9tDQXazLXx1bXn1BRDDymlhZu7zTlaXTQ8LkPtzDzUOYala5szOk0f8A9lj+DkDMibZs3VLTNL7/ADuWXJJWaccXRbM7NzKz4OXBO1+0jG+8lVuVxebLrHmUmxkuoWVXsizVloStu3Txj3KWHLijJqVjrrZUDH4tbT8OJpkcD0cnixWqPkaMAR/msHZPBUUf8MDY1SlYPHXQJiErXCtRsfomukoEk6pF1kj4lcLARrqoQYJGk3fxpTtyabob6bKnKDGmNkN0apENFx+WSeX7KMuN1VquD067qZr6JA8tECJBDBiL3X0HktVwnh3tJaXD8NunvQfheMW47WnRz91suHsZBEB1rVZcmRrhtxYl+hvh+IxkYaBQARdmM0MALbFIC3iLIBZeGt6kmgut7UYBJYx02Q4afhMJF+VrL9pGp6xDL8OEO0YAuNibG8UgEfafGmkpkksQ5uX8VtC/K0VdO4xBx0tCpIC1a4HcWbm0FaK0dW2CgGFknnpGQSWXetIgoY8R3bgCVC6ZjfIAKOaRziQECnyZpct8Mb2M5DRe86X6BGKbBKkaSCdrjpdK/E5jtNivO5eI8Rx8l0PtEth1c0TRRHmieBxfi8MYf3ntNuoRyMrTzvoVb/myndPhuhjMlaRQtY/tXw/upGz8tNd4XH1Wg4RxaTJI77GdCT0uwE/tZi+0dnppWCyynfVPibTK8quJ5rzU4b2iHDG95kEWSGjmKpxsGjnHxeXoiuCI4oJHNFuIOp8l0XI5qj0K8LyyOMxa0A8N99re4Qj7x3NXMK5fX0Xl3DpnMz2PP8r2m/ivSQRz3VrPkLsfVRfzzCTGGHmkAPMb+Sdwt+M2SRs5DS4UC7ZDw7xJcx5twqbLki7xAwnJ/BPM1oq1BgCpJD60o+pOmnmpsZvcvdzOBLzzAA6p4yViT8Pj1uymYQ1pvXzvqomADXcBdJ2VoCVg5nE/O04Odqa3UbTsDt1T+bppShCGd9kjruVC70Kne3lDiADarPdY1GqhEIE+e6tYAD8lvMNAbpVGtLjQBJKsYltymtIIKVvg8UbTCAJZy6dUVc+c+CL8x6oPgu5i2tKWx4Thski5jusE/enSh4A8XgOXNOJsjJ70tNhrtR8ld/wyTK6R+Q6IOeXlsbgAD6LTt4aygQCL8lI3hzB/LfvS7sOiYExuDYrMU4vNI6EkktB3J31V4xNY1sMQIY3QWbRH2ZkbT9gqzqYSpswqKXh3CYWyrSQxh7AfRA8GEvdZ0atHiMHdgeilCsH5OJ+JzN81SnwTINGN+S0zsXvGWNaVJ0RYT/dIJtA9M6zCmY7+G0j5IjjQPYbMLB67oiADu2/cpWQt0rRNbBw5jNeXC0TyIBPwjIiIvmicPooYYeVX4mg472nq0hWQfSmSviPFcuF0s8LBYIBJ6UrUTu4hkIcaazqVoMngcEUrRq57iKv3rL8WPc5L4mOAAJ0O+5C3Y8ilwxZcTh0s4kx5y/etRa9Lgm7yOJ9DxNB+YXlmG78EHe1rY+KsHCIGPZISWBtxuN6fBTIrK4S1NKc2FszQZGAuNCyp2P5pQ1tWViZJMRgY+QTB4GjTJr8qWi7O8RdlZzYIY2Pe9jh+NzHYE3oPRUuNDrJbCOZkRQQOaJPxHigW0aCpuyJMnIjfBIa0su08Nf8AGyL8V4bM90ImxsEc7LHI1wPz81n8jIZw+d+N3DeWtm8xB9BaVRFk7PmNpporQj7rrXBx1081EHkafdSMIJNjbU0tBYSbDU76rrCLo7eij5qcTdlPbyu309VADncwZpuQouRryQ7foVMCbsqJ5AcdLB+ihEaHhvDYoeHsyALc5gPN6lQcRww4idn52nxe5W+C5An4KYbt0TuU+4mwfuEVysVhjbHyjayVicmpHRUYuBV4R4pWDcWt/wAJHK3RYDg57vIqqLdFvOGSAMCpyelmPw0sLOZo2UjoavRQ4sjaU00zWNOuqS0MkypPyRglyHMeJ8hriBy3oPRSzuM3NrohByXYT7c1zmjYtF6KJ34Oomk71kRbVBE8XKbWhCwPtufk5BeyXkhGzOQa/FGeH57/AOfRw0Rtg1RtoMod2bOnmkRFPG6qDt7CzeblZkmNyYkwivdwbZPutWOFSZjcepSS6tXOUtiaFpk5Dq+CvQ6kFCZmmI2rWJlBTYDXA1HVeSsx6Dm2Q6GW9LRFn8B3U0aTqRVRnc5rO9gmJprCXuPkG62vIsvLOTnSvdfieSOvVejdus48L7Kuja6pcgjGGu1+J/2AXlMLw6QkanbdbfjQ9Zl+VO6iaHHJETbNACt1qOGSsPCnSdwC6GgCHlt6+Sx7JbYPgtRwqYR8OySQbcWEUa3KuyeGOHQrHnh+U2NsUpBh7y+9O/Lfki3Z5gzMzGE0UkYkLwQZ3c2jbFALPNf/AOJi3+I4u4Ff+WUV7HDlz8CUuc/lfLZN7lqobLIx6aTjeDDA2ARd6Lha/WVxs2R1PosnJPJ++Hxh55BCXgk3ry3ut7xLhc3E8OB0TmM5WchLj5E38EChl4Rw6Vpdw8Zma2PxSyO8Gjeg8qHVBPpZVnya13hA9E8GnAjdRN/Ld9E7f1VyASk0SE4ENbvXmmc4EfMddNVDzl7jRRIWO86N+K0fCezLX4wz+KP9lxQA6iac8foD8z0CFcFysbh2d32Vje08rfA3yd0Oun9N0/inGMvi0/eZD6aDbWNPhb/z6nVZ8m8nqvCyGq6wll8awRlNj4fhRY+OPA54bTnD9PvpqiHeyzMPI4EhvVZAaWaJW14ZgskwmTmcBpaLdeiV49EXY8jfGDoHmPL5q3Oy2fDcq2N1WU4izFiex0E7JDfipwJCM8Lk5oWkHUKjIr6acbNpjZOg1TZssvLheiHY0/Nj312UObkOi7trQfEsnrNHisKe1Ma2rBVV7jI6gPCqUb2xjnmkA+KnZxSCP8gDvVXRVITsvC7FDyD8u6mj5A7VgJvyVOHjQcQOYAHpylEos8kDwtvofNFsmrL+Oxzho3T3IlG1wGrShBzJmAOL+UHYAbrrOOSMJsmm78zCohZQkX8pzQDYVKJ5bLodCmSdpeFzc0T5Giatmm1HhOdIeetObT3INUBNmhwXczhaNt/gm+gQXBYRJaf2lzZOH9keJ5cLiyWKBxY4bg7Ap4K3RVN0Zn9qfCBN2eg4k2YM9jk5TGdn85qx62PkvK8Y27Q/Rdz+PcU4sxkefxCfJaw2GveSL86UEL+W/VdXHHVUzl5JbOwvFJytbr6e5afCyWx8OkbyNcZGNOovZ231WRgPMW+/5rTYfM/uoqsgFvKNCT/YRmuCRDMORfEsWMRQ26AfybeA6LWcBkHtGMzumRuJcPyBp0AWWhx+TPxHOjlY8QAWOnhKK9n5DG7Fl8ZDZ6cXdLAWSSbfDQqR6VAeXEYPK0IzsDDmyXSPx43SEcpdWpCtx5cZxxbwKJVCfOgGRymZt1e6f8AfGlgivJK6FqPmAYPcrOLiOmYZpZBBjA0ZCLs+QHUp0F8GwQSZeQIYxZouOtAAbknoPVOEfI5waQRdWOvutTS5AeDHAzuoSACP5n1sXHqR5bD13TOa7IOvVMAQ2Th16Jl6Wuir1KCIPvX3qVhdYFnlHS9FCD6bJ/MaRohMH908OG7d6Wz4DO18AAPTRYcbEI32Yze7c6B+7Dp6hZ80bXDTgn2megYr6DmHrsr8mO3LxAdngUgkU1crwi2Fk1bb0Oq5rVM6Ppks7hObDO5zCZ6NAF9Ea711Wt7NYOO7kbKQXSR3XVrrTM6LvWFzDTvNQ4kjeZvOC2RmzwdQtCpoCi34bHC4Pi+wtNNLxJqR11RzK4dimKNwjZbXAbeZWUwIpmEOa8vadfzWD7/VFvbMp8Ia91+IE6VaOtFUoZP6H58bFEEZIa3lcNTQQ7ijcJsOSwBtyVoNSqUrsnKY6OV5MTt2nZPjjx4hpTn/AGU1IoSStsxmN2Tc/jE+XOSAX8zIxsBel+q1mHjNZTaoWrzIAASRq7VdYzlftokk7IXMVlOWd/alnDC7CSw34suVkYHmAeY/ZaiBoGq8p/a7xYZfGIOGROtmEzmkA/zu/oK+auwRuRmyyqJ56x46Kyx3K7zPqqMZp4NK3HZauqjmsK4TmjmJPi2C1HBZQ3iONPMBpK2mAXQvU+/ytZThp121RvAf+O53MTWvxSS8Ij3D91Ym5g4saFCsZm3pokzhWK1tNw+LBt3Xs8Y1+SDYnB+0GZhQZEea8smYHM/6g7EdVY/wz2j0Htrtdz7QdPqsm8S6n/At+7YntLfZuMEHzjjCidwWNx/DxuKM03McRVObs/xtkAa2fneNz3zr+6b/AId421oIzj//AHdoh/pELUv4fJTMOPDYJM1vNIQCzHBo+heeg9N0yaeTJk55CNNGtaKa0eQHRRBxNuOpdqSdST5pAk7q8ND9+qdzUbG46qMbpA9UAUSl3NvofokPkmBOaaO9hMmQeLKe3UbKNrxqAF0P1rTZQhKDW5uwpsad0Ewe3ofmqwLdLv4JwPQWg1aInTs3fDs5s+OKdaLYORTxrssJwbKdHYvbotViZALw7zXPyQpnUxytWasHvIlC6Bl6ij5hcw5A+IC7V6ODn2VN0WpjIMp8Apr7CtN4rI5tOdSQwQ7Skx3DSCSAUdhtixHnSvsc5IRPBkANnU9LQzHxHNqx8UUxo9apS2BsJscXi7U0TLNqvECNFehAa2z0UXTO2SstrSG6u6A+a+bMvLnzeMZc2Uf+omlcZL87P9/BfSPei9CvAe2/D/3X264jE1tMll79n+l4v7krb8ZqzHmurM/y8ryPIq1Gf+VG8akgJ0Y3XQRiCmCC54a3ceJG4iIuWyNfJA+HvLZbvWj8UTbIXlnL0dqlfQrh9AdhZvbux2FLoC1pjIGwo/0WiEOhrTRYf9luY08IysRzgDHIHtafJw/qFuQaHmKsWVyZqpGyLbQgzUDc11XRGBrf6pd7p+Q/dMGXE0kEFv8AtSh6fBbSdD5Jw6/qmNJ0rRONWDfvXRKhwI8z8Eg4a0E2wP8A9XdDtqoA7Y6lPAJNhppMDiOgC6Hm9SSoQeAfMfdPDNR4voog4gaLodQBI2RTASgAHe06xW3yUQdrvSmjYZB4TTx9USFvhsjRkhoFE7haKGR0Lj/lP0WXhY6PJjedC00a1sLUw06OiPRZM3Gbvju40aPhOYHCidlpcaYULK8+xJXY8tg7FanA4gJGN11WaUf1GhP+mqY4GqKtNkaGm+qBQ5fhuyFP7UXN/MqyVYYbIzYqzC5lmlnBkua/dX8XINamvVRWyNB2NwrVcmywPA06oU/iAYOUGyoW5Bc6zvadcE1sNMybdV6Lzb9rfDJRxDA4qyJxiki7h7+gc0kgehIP0K3WPL40VdwrH7ScHy+DZNcmXGWtcf5HjVrvgf1V/wAd/cozx+p86X4Qa1SaeU9UU452ez+znFpeG8Qi5J46OmrXA7OaeoKGUL2XX4cqy1jupw6EHQ+SK4suo2tB4bBRLGqx01StDJnqnYGSI8S7jImbFHLCSHEhottECz7yt+3FwthxOIe+Uf1XkfZRkeZxTEgncWskeI3kbgHSwvWI+wGA1pBnmd5bBYZ405WXxlKuEox42fwuLRbf+6N/muF+QzlDeIwkbV3rVz/AXD7P481HpYTD2Bwu8sZUwHlQv5pf8kNvM+Jm6tHwTwLGpApRguDaII+Cc0i9TuryD9BuDr1SFt9x2pMB8inNfuHC2lQh1d2/5XQ2+tpvMGur7qEHDW9k5unUj6qI7nVOa7pugAkBHl+q60lrrB22TAaKe34IoAQxshspDHtZzjY7WtDw9xdHXksnDB7RkRwssmRwYPiVus3DZw/i78eMU0NaQPhX6KvNG42aPjyqVDJWAC1PjSuZVGiuPAMSbALdXmsadG9qw1j58gbROiux55rzQ3HhJCvw4hNAj3JHJAUS1HllzvPorTMiUtoaBdxsBrR4t1bELG6DRLugpEUTTVm1ajOt2oyQB4V1lk/FCxlwvQEh2q0XZ6Tm4u1oBpreY/NZpji0G9aWj7HgzT5GTuC8MH+0f1JWr40bkZPlOoh3tXwPhfF8WJ3EsCHJZ+Quc2nNvanDUa/deS9pf2SZEDXZXAHvzIh+bGfXet/0nZw+q9uzA2TCcx2oOiC4kxYKvVh5Sfd/wuxBXE4jl0+fc/slxzg+KMnP4Zk48JNd45vhHvI2+KqY7uV3KdL01X1RG2DiGHJj5EbZIpGlr2uFhw9V4zxnsVg+3zxYzjiTxPLa3jJB8unwVbf4y1dAnB534kjHtJa5hDw4ehX0fhzjKw4chu0rGvHxFr51fwrO4eR7RCSwGhIzxNK9x7D5Zy+yOE535o2mM/A19qVEvS+JoFwuaDROq6UkBz4Ojl4V3Za7FzQSNC3IaaPxam1wxx/iZrD6xsd+qHhnh309ycGtrco2LReOJgOBLc0/74CPtaZ7BA/8vEMf4kj9FVv/ACl3xK63X8xJRITu4eWOAjy8SQUPH3wbR+KhnHJKWCSN9blpDh8wnFutNqh0TDvsFCCDXHYMI9UWx+zXE8rGjyIcMPZILaRK0fQoSHAD8oOqsRZ00TQ1ksjWjShI4V8iq5qTX1HhX6ED2W4yz/0+X4Oaf1Tf8O8Va3xcNyfgy/smwcVztm5mSOgqZxXofZ7hGfHE2XOzciWQi+7c+2s9PUpcePNJ0CeTHFAPsp2Sf38OfnNkj5Hgxwu0N3uf6Iv2ridj9p2k/lmiFe8LSho75jRoAR90L/aTj9zhYmcALjlaCR5E0t2bHWOjLgy3ksDsb4bTo4ix4NLmFKJYQ69SFd5LYPRcSqZ3k7RPiuAI1RzFIsGtEAh99UiGLmd23lcDp1CSUbGiw3JMGihVqMPcb1VJs3ObrQqzCd91V4MTsU0YAceqrc41GoAUoma1u6MQHOIZjcbFe+9QFuux2GcTgmM1+jywOd7zqV5qGu4txzFwm6tdIC//AEjUr2Dh8YZCBsut8WFKzl/KnbouzOuBwQBpeOKTRH+GWB9+t1SOS6RuQh7azQ7/ADMr6rpR4jlv0vYEjo5fDevqvN+KcVOZxnKyW6NkkJHu2/Rej4RAnbe1heU8UYcXi+ZCR/DmeP8AuKqmi6IRizT3EmunKbWh4P2jk4YHRRBrY3u53N83GrKxLJagk9Qrrcr8V/oAFnotTo9Pxu1kc2ha0H/5aK/B2ggkcGujc33GwvLosk0NVZ/ek0URAeeU9LSqPRtz5aa4jbTT5qQcpu9DV7WCoxoNV3Q7HXyKlDndfekDQK51OqXM0gBEB0lOABGuoTAObbZSNZsoQ4I2lt2ntYPJdrWhpSeAoQN9jsL27tPjxhgd3YMh0002+q9mjwxFj0Bbl59+yjB7zM4hlkWWBkTfjqfsF6oyAka0AtuGlEw57bozbWFmQQ7ca/VX+1fDf3t2My4mt5nNiLm+9uo+yWXDDLK4tBD2VuatHOHRibh5YRzaUR5p8rUkJiTizxTgOVzQttamGnsGoWXyOHu4L2gzME6CGUhvq3dv0IRvDyNha4OWNM9DilasvMHK+uqtMY3y16qCg9vMCnxuc3qFS0y9NF6GgNlN3tXZVASHqQk54rf6qvSw7Iu+0CjagyMum0Cq3e3rY+aqZEhc4gf/AKroQ6VymqNf+z3BdkZuVxB7dBUTD9XfovUsdvLHssz2Q4d+7+DY0JbTw3md/qOpWpZo1dnGtY0cXK9pWck1BQ6UDmY4eZH0RNw8BPoh7gDFf+VwKuTRQ0xQGpAV512zj9n7W5nQScsnzaP1XobDR3WH/aLFy8bxptu9xx8wSEkiyKM0H+Aj1A+qsxyAukNbEBD2v2/1DqpIZKDjYPiVDLUgoybSwU90xc2rQ4TC904y6bhSJKP/2Q==";

const devProfileImg = $("dev-profile-img");
if (devProfileImg) {
  devProfileImg.addEventListener("error", () => {
    if (devProfileImg.src !== DEV_PROFILE_FALLBACK_DATA_URI) {
      devProfileImg.src = DEV_PROFILE_FALLBACK_DATA_URI;
    }
  });
}

const openDevProfileLink = $("open-dev-profile-link");
if (openDevProfileLink) {
  openDevProfileLink.addEventListener("click", (e) => {
    e.preventDefault();
    const modal = $("dev-profile-modal");
    if (modal) modal.classList.remove("hidden");
  });
}

const closeDevProfileBtn = $("close-dev-profile-modal");
if (closeDevProfileBtn) {
  closeDevProfileBtn.addEventListener("click", () => {
    const modal = $("dev-profile-modal");
    if (modal) modal.classList.add("hidden");
  });
}

const devGithubLink = $("dev-github-link");
if (devGithubLink) {
  devGithubLink.addEventListener("click", (e) => {
    e.preventDefault();
    const win = window.open("https://github.com/Kuraku01", "_blank", "noopener,noreferrer");
    if (win) {
      try {
        win.opener = null;
      } catch (err) {}
    }
  });
}

