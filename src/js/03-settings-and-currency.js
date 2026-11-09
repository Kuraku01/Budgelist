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
