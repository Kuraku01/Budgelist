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
  clearButtonBusy(mainAuthBtn);
  ["username", "auth-id", "password"].forEach((id) => {
    const el = $(id);
    if (el) el.classList.remove("input-error");
  });
  if (mode === "login") {
    usernameFieldWrap.classList.add("hidden");
    if (loginForgotPasswordBtn) loginForgotPasswordBtn.classList.remove("hidden");
    if ($("login-forgot-row")) $("login-forgot-row").classList.remove("hidden");
    authIdLabel.textContent = "Email or Username";
    $("auth-id").placeholder = "";
    mainAuthBtn.textContent = "Log in";
    delete mainAuthBtn.dataset.origHtml;
    toggleAuthModeBtn.textContent = "Create account";
    authTitle.textContent = "Budget, listed.";
    authSub.textContent = "Log spending, catch recurring bills, and see where the month is headed before it's over.";
  } else {
    usernameFieldWrap.classList.remove("hidden");
    if (loginForgotPasswordBtn) loginForgotPasswordBtn.classList.add("hidden");
    if ($("login-forgot-row")) $("login-forgot-row").classList.add("hidden");
    authIdLabel.textContent = "Email";
    $("auth-id").placeholder = "you@example.com";
    mainAuthBtn.textContent = "Create account";
    delete mainAuthBtn.dataset.origHtml;
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
    setButtonBusy(resendVerifyBtn, "Sending...");
    try {
      await sendEmailVerification(auth.currentUser);
      showToast("Verification email sent! Check your inbox.");
    } catch (e) {
      showToast("Could not send verification email. Try again later.");
    } finally {
      clearButtonBusy(resendVerifyBtn);
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
  if (mainAuthBtn && mainAuthBtn.disabled) return;
  authError.textContent = "";

  const authIdInput = $("auth-id");
  const passwordInput = $("password");
  const usernameInput = $("username");
  const password = passwordInput.value;
  const identifier = authIdInput.value.trim();

  if (authMode === "signup") {
    const username = usernameInput.value.trim();
    if (!username || username.length < 3 || username.length > 20 || !/^[a-zA-Z0-9_]+$/.test(username)) {
      triggerErrorFeedback(
        authError,
        "Username must be 3-20 characters (letters, numbers, underscores).",
        null,
        [usernameInput]
      );
      return;
    }
    if (!identifier || !identifier.includes("@") || password.length < 6) {
      triggerErrorFeedback(
        authError,
        "Enter a valid email and password (6+ characters).",
        null,
        [!identifier.includes("@") ? authIdInput : passwordInput]
      );
      return;
    }
  }

  setButtonBusy(mainAuthBtn, authMode === "login" ? "Signing in..." : "Creating account...");
  if (toggleAuthModeBtn) toggleAuthModeBtn.disabled = true;
  if (guestBtn) guestBtn.disabled = true;

  try {
    const online = await checkNetworkConnection();
    if (!online) {
      showNetworkModal(
        "You need an active internet connection to log in or create an account. You can also use Guest mode offline.",
        () => authForm.dispatchEvent(new Event("submit")),
        () => {
          triggerErrorFeedback(authError, "Offline. Connect to the internet or continue as Guest.");
        }
      );
      return;
    }

    if (authMode === "login") {
      try {
        let email = identifier;
        if (!identifier.includes("@")) {
          const usernameLower = identifier.toLowerCase();
          const uSnap = await getDoc(doc(db, "usernames", usernameLower));
          if (!uSnap.exists()) {
            triggerErrorFeedback(
              authError,
              "No account found with that username or email.",
              null,
              [authIdInput]
            );
            return;
          }
          email = uSnap.data().email;
          if (uSnap.data().username) {
            safeSet(`budgelist-user-${uSnap.data().uid || "login"}-username`, uSnap.data().username);
          }
        }
        await signInWithEmailAndPassword(auth, email, password);
      } catch (err) {
        const highlightInputs =
          err.code === "auth/wrong-password" || err.code === "auth/invalid-credential"
            ? [passwordInput]
            : [authIdInput, passwordInput];
        triggerErrorFeedback(authError, humanAuthError(err.code), null, highlightInputs);
      }
    } else {
      const username = usernameInput.value.trim();
      const email = identifier;
      try {
        const usernameLower = username.toLowerCase();
        const uSnap = await getDoc(doc(db, "usernames", usernameLower));
        if (uSnap.exists()) {
          triggerErrorFeedback(
            authError,
            "That username is already taken. Choose another.",
            null,
            [usernameInput]
          );
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
        const highlightInputs =
          err.code === "auth/email-already-in-use" || err.code === "auth/invalid-email"
            ? [authIdInput]
            : [authIdInput, passwordInput];
        triggerErrorFeedback(authError, humanAuthError(err.code), null, highlightInputs);
      }
    }
  } finally {
    clearButtonBusy(mainAuthBtn);
    if (toggleAuthModeBtn) toggleAuthModeBtn.disabled = false;
    if (guestBtn) guestBtn.disabled = false;
  }
});

if (loginForgotPasswordBtn) {
  loginForgotPasswordBtn.addEventListener("click", async () => {
    if (loginForgotPasswordBtn.disabled) return;
    authError.textContent = "";

    const authIdInput = $("auth-id");
    const identifier = authIdInput.value.trim();
    if (!identifier) {
      triggerErrorFeedback(authError, "Enter your email or username above first.", null, [authIdInput]);
      return;
    }

    setButtonBusy(loginForgotPasswordBtn, "Sending...");
    try {
      const online = await checkNetworkConnection();
      if (!online) {
        showNetworkModal(
          "You need an active internet connection to reset your password.",
          () => loginForgotPasswordBtn.click(),
          () => {
            triggerErrorFeedback(authError, "Offline. Connect to the internet to reset password.");
          }
        );
        return;
      }

      let email = identifier;
      if (!identifier.includes("@")) {
        const usernameLower = identifier.toLowerCase();
        const uSnap = await getDoc(doc(db, "usernames", usernameLower));
        if (!uSnap.exists()) {
          triggerErrorFeedback(authError, "No account found with that username.", null, [authIdInput]);
          return;
        }
        email = uSnap.data().email;
      }
      if (!email) {
        triggerErrorFeedback(authError, "No email found for this account.", null, [authIdInput]);
        return;
      }
      await sendPasswordResetEmail(auth, email);
      showToast(`Password reset email sent to ${email}`);
      authError.textContent = "";
    } catch (err) {
      triggerErrorFeedback(
        authError,
        humanAuthError(err.code) || "Could not send password reset email.",
        null,
        [authIdInput]
      );
    } finally {
      clearButtonBusy(loginForgotPasswordBtn);
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
