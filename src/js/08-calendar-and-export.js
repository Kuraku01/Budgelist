// ---------- Month navigation & Calendar popover controls ----------
const monthLabelFmt = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
let closeCalendarTimer = null;

function openCalendar() {
  const popover = $("calendar-popover");
  if (!popover) return;
  if (closeCalendarTimer) {
    clearTimeout(closeCalendarTimer);
    closeCalendarTimer = null;
  }
  calendarOpen = true;
  popover.classList.remove("hidden", "closing");
  popover.classList.add("opening");

  const grid = $("calendar-grid-days");
  if (grid) grid.classList.add("animate-enter");

  renderCalendar();
}

function closeCalendar(animate = true) {
  const popover = $("calendar-popover");
  if (!popover) return;
  calendarOpen = false;

  if (animate && !popover.classList.contains("hidden")) {
    popover.classList.remove("opening");
    popover.classList.add("closing");
    if (closeCalendarTimer) clearTimeout(closeCalendarTimer);
    closeCalendarTimer = setTimeout(() => {
      popover.classList.add("hidden");
      popover.classList.remove("closing");
      closeCalendarTimer = null;
    }, 180);
  } else {
    popover.classList.add("hidden");
    popover.classList.remove("opening", "closing");
  }
}

function toggleCalendar() {
  if (calendarOpen) closeCalendar(true);
  else openCalendar();
}

// Navigable calendar range shared by arrows, swipe and the month/year selects.
const CAL_MIN_YEAR = 1970;
const CAL_FUTURE_YEARS = 50;
const YEAR_SELECT_SPAN = 10;
function calendarBounds() {
  const maxYear = new Date().getFullYear() + CAL_FUTURE_YEARS;
  return { min: new Date(CAL_MIN_YEAR, 0, 1), max: new Date(maxYear, 11, 1) };
}

function dayBounds() {
  const maxYear = new Date().getFullYear() + CAL_FUTURE_YEARS;
  return { min: new Date(CAL_MIN_YEAR, 0, 1), max: new Date(maxYear, 11, 31) };
}

function getTargetDayForDelta(delta) {
  const realNow = new Date();
  let baseDate;
  if (selectedDateISO) {
    const [y, m, d] = selectedDateISO.split("-").map((n) => parseInt(n, 10));
    baseDate = new Date(y, m - 1, d);
  } else {
    const isCurrentMonthView = toLocalMonthPrefix(viewDate) === toLocalMonthPrefix(realNow);
    if (isCurrentMonthView) {
      baseDate = new Date(realNow.getFullYear(), realNow.getMonth(), realNow.getDate());
    } else if (delta > 0) {
      baseDate = new Date(viewDate.getFullYear(), viewDate.getMonth(), 0);
    } else {
      baseDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1);
    }
  }
  return new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + delta);
}

function changeMonth(delta) {
  const next = new Date(viewDate.getFullYear(), viewDate.getMonth() + delta, 1);
  const { min, max } = calendarBounds();
  if (next < min || next > max) return;
  viewDate = next;
  selectedDateISO = null;
  const grid = $("calendar-grid-days");
  if (grid) grid.classList.add("animate-enter");
  render();
}

function changeDay(delta) {
  const nextDate = getTargetDayForDelta(delta);
  const { min, max } = dayBounds();
  if (nextDate < min || nextDate > max) return;
  viewDate = startOfMonth(nextDate);
  selectedDateISO = toLocalISO(nextDate);
  const grid = $("calendar-grid-days");
  if (grid) grid.classList.add("animate-enter");
  render();
}

$("prev-month").addEventListener("click", (e) => {
  e.stopPropagation();
  changeMonth(-1);
});
$("next-month").addEventListener("click", (e) => {
  e.stopPropagation();
  changeMonth(1);
});
if ($("prev-day")) {
  $("prev-day").addEventListener("click", (e) => {
    e.stopPropagation();
    changeDay(-1);
  });
}
if ($("next-day")) {
  $("next-day").addEventListener("click", (e) => {
    e.stopPropagation();
    changeDay(1);
  });
}

// Calendar controls
const calDropdownBtn = $("calendar-dropdown-btn");
if (calDropdownBtn) {
  calDropdownBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleCalendar();
  });
}

const calResetBtn = $("calendar-reset-btn");
if (calResetBtn) {
  calResetBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const realNow = new Date();
    const inCurrentMonth = toLocalMonthPrefix(viewDate) === toLocalMonthPrefix(realNow);
    if (selectedDateISO && inCurrentMonth) {
      selectedDateISO = null;
    } else {
      viewDate = startOfMonth(realNow);
      selectedDateISO = null;
    }
    const grid = $("calendar-grid-days");
    if (grid) grid.classList.add("animate-enter");
    render();
  });
}

const calMonthSelect = $("calendar-month-select");
if (calMonthSelect) {
  calMonthSelect.addEventListener("change", (e) => {
    const m = parseInt(e.target.value, 10);
    viewDate = new Date(viewDate.getFullYear(), m, 1);
    selectedDateISO = null;
    const grid = $("calendar-grid-days");
    if (grid) grid.classList.add("animate-enter");
    render();
  });
}

const calYearSelect = $("calendar-year-select");
if (calYearSelect) {
  calYearSelect.addEventListener("change", (e) => {
    const y = parseInt(e.target.value, 10);
    viewDate = new Date(y, viewDate.getMonth(), 1);
    selectedDateISO = null;
    const grid = $("calendar-grid-days");
    if (grid) grid.classList.add("animate-enter");
    render();
  });
}

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
function sanitizeCsvCell(val) {
  const str = String(val == null ? "" : val);
  // Neutralize CSV / spreadsheet formula injection (=, +, -, @, leading tab/CR)
  const safeStr = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
  return `"${safeStr.replace(/"/g, '""')}"`;
}

async function exportCsvData() {
  const { monthExpenses } = currentMonthData();
  if (monthExpenses.length === 0) {
    showToast("No expenses to export for this month.");
    return;
  }

  const rows = [['"Date","Category","Note","Amount"']];
  monthExpenses.forEach((e) => {
    const safeDate = `"${String(e.dateISO || "").replace(/"/g, '""')}"`;
    const safeCat = sanitizeCsvCell(e.category || "");
    const safeNote = sanitizeCsvCell(e.note || "");
    const safeAmt = `"${(Number(e.amount) || 0).toFixed(2)}"`;
    rows.push([safeDate, safeCat, safeNote, safeAmt].join(","));
  });
  const csv = rows.join("\n");
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
