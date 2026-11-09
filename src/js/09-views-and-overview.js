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
