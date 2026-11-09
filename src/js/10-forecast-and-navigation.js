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
