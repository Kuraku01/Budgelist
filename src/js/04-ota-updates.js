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
