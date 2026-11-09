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
