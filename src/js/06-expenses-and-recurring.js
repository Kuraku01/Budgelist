// ---------- Expenses ----------
function commitExpenseSave({ targetEditingId, amount, category, note, expDate }) {
  let prevYm = null;
  if (targetEditingId) {
    const existing = expenses.find((x) => x.id === targetEditingId);
    if (existing && existing.dateISO) prevYm = existing.dateISO.slice(0, 7);
  }
  const newYm = expDate.slice(0, 7);

  if (isGuest) {
    if (targetEditingId) {
      const exp = expenses.find((x) => x.id === targetEditingId);
      if (exp) { exp.amount = amount; exp.category = category; exp.note = note; exp.dateISO = expDate; }
      showToast("Expense updated");
    } else {
      expenses.unshift({
        id: "guest_" + Math.random().toString(36).slice(2, 10),
        amount, category, note, dateISO: expDate, createdAt: Date.now(),
      });
      showToast("Expense added");
    }
  } else {
    if (targetEditingId) {
      const exp = expenses.find((x) => x.id === targetEditingId);
      if (exp) { exp.amount = amount; exp.category = category; exp.note = note; exp.dateISO = expDate; }
      enqueueSync({ type: "UPDATE_EXPENSE", id: targetEditingId, data: { amount, category, note, dateISO: expDate } });
      showToast("Expense updated");
    } else {
      const newExp = {
        id: "cloud_exp_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
        amount, category, note, dateISO: expDate, createdAt: Date.now(),
      };
      expenses.unshift(newExp);
      enqueueSync({ type: "ADD_EXPENSE", data: newExp });
      showToast("Expense added");
    }
  }

  if (prevYm && prevYm !== newYm) {
    reconcileActiveMonthSpend(prevYm);
  }
  reconcileActiveMonthSpend(newYm);
  syncBudgetState();
  applyRecurringForThisMonth();
  render();
  closeExpenseSheet();
}

expenseForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const amount = round2(parseFloat($("amount").value));
  const category = $("category").value;
  const note = $("note").value.trim();
  const customDateInput = $("expense-date") ? $("expense-date").value : null;
  if (!amount || amount <= 0) return;

  const expDate = customDateInput || selectedDateISO || todayISO();
  const targetYm = expDate.slice(0, 7);

  // 1. If targeting a past month, check lock state
  if (isPastMonth(targetYm)) {
    if (!isPastMonthUnlocked(targetYm)) {
      openUnlockPastSheet(targetYm, () => {
        commitExpenseSave({ targetEditingId: editingId, amount, category, note, expDate });
      });
      return;
    }
    commitExpenseSave({ targetEditingId: editingId, amount, category, note, expDate });
    return;
  }

  // 2. Current or Future Month: check if expense exceeds Month Budget or Global Budget
  const rec = ensureMonthRecord(targetYm);
  const currentSpent = monthSpentTotal(targetYm);
  const oldExp = editingId ? expenses.find((x) => x.id === editingId) : null;
  const oldInSameYm = oldExp && oldExp.dateISO && oldExp.dateISO.startsWith(targetYm) ? round2(oldExp.amount) : 0;
  const projectedMonthSpent = round2(currentSpent - oldInSameYm + amount);
  const netDelta = round2(amount - oldInSameYm);

  if (netDelta > 0) {
    const allocated = round2(rec.allocated || 0);
    if (allocated > 0) {
      const coveredLimit = round2(allocated + (rec.directCovered || 0));
      if (projectedMonthSpent > coveredLimit) {
        const deficit = round2(projectedMonthSpent - coveredLimit);
        openOverbudgetSheet({
          mode: "restricted",
          targetYm,
          deficit,
          netDelta,
          pendingExpense: { targetEditingId: editingId, amount, category, note, expDate },
        });
        return;
      }
    } else {
      // Unrestricted month: check if netDelta exceeds available globalBudget
      if (netDelta > globalBudget) {
        const deficit = round2(netDelta - globalBudget);
        openOverbudgetSheet({
          mode: "unrestricted",
          targetYm,
          deficit,
          netDelta,
          pendingExpense: { targetEditingId: editingId, amount, category, note, expDate },
        });
        return;
      }
    }
  }

  commitExpenseSave({ targetEditingId: editingId, amount, category, note, expDate });
});

$("delete-expense-btn").addEventListener("click", async () => {
  if (!editingId) return;
  const exp = expenses.find((e) => e.id === editingId);
  const expYm = exp && exp.dateISO ? exp.dateISO.slice(0, 7) : null;

  if (expYm && isPastMonth(expYm) && !isPastMonthUnlocked(expYm)) {
    openUnlockPastSheet(expYm, () => $("delete-expense-btn").click());
    return;
  }

  expenses = expenses.filter((e) => e.id !== editingId);
  if (!isGuest) {
    enqueueSync({ type: "DELETE_EXPENSE", id: editingId });
  }
  if (expYm) reconcileActiveMonthSpend(expYm);
  syncBudgetState();
  render();
  closeExpenseSheet();
  showToast("Expense deleted");
});

// ---------- Custom Expense Date Picker Calendar ----------
let expCalViewDate = startOfMonth(new Date());
let expCalOpen = false;
let closeExpCalTimer = null;

function setExpenseDateValue(dateISO) {
  const safeISO = dateISO || todayISO();
  const expDateInput = $("expense-date");
  if (expDateInput) expDateInput.value = safeISO;

  const [y, m, d] = safeISO.split("-").map((n) => parseInt(n, 10));
  if (y && m && d) {
    const dObj = new Date(y, m - 1, d);
    expCalViewDate = new Date(y, m - 1, 1);
    const triggerText = $("expense-date-trigger-text");
    if (triggerText) {
      triggerText.textContent = safeISO === todayISO()
        ? `Today · ${dayLabelFmt.format(dObj)}`
        : dayFullLabelFmt.format(dObj);
    }
  }
  if (expCalOpen) renderExpenseCalendar();
}

function openExpenseCalendar() {
  const picker = $("expense-date-picker");
  const popover = $("expense-date-popover");
  const trigger = $("expense-date-trigger");
  if (!popover || !picker) return;
  if (closeExpCalTimer) {
    clearTimeout(closeExpCalTimer);
    closeExpCalTimer = null;
  }
  const curVal = $("expense-date") && $("expense-date").value ? $("expense-date").value : todayISO();
  const [y, m] = curVal.split("-").map((n) => parseInt(n, 10));
  if (y && m) expCalViewDate = new Date(y, m - 1, 1);

  expCalOpen = true;
  picker.classList.add("open");
  if (trigger) trigger.setAttribute("aria-expanded", "true");
  popover.classList.remove("hidden", "closing");
  popover.classList.add("opening");

  const grid = $("expense-calendar-grid-days");
  if (grid) grid.classList.add("animate-enter");
  renderExpenseCalendar();
}

function closeExpenseCalendar(animate = true) {
  const picker = $("expense-date-picker");
  const popover = $("expense-date-popover");
  const trigger = $("expense-date-trigger");
  if (!popover || !picker) return;
  expCalOpen = false;
  picker.classList.remove("open");
  if (trigger) trigger.setAttribute("aria-expanded", "false");

  if (animate && !popover.classList.contains("hidden")) {
    popover.classList.remove("opening");
    popover.classList.add("closing");
    if (closeExpCalTimer) clearTimeout(closeExpCalTimer);
    closeExpCalTimer = setTimeout(() => {
      popover.classList.add("hidden");
      popover.classList.remove("closing");
      closeExpCalTimer = null;
    }, 180);
  } else {
    popover.classList.add("hidden");
    popover.classList.remove("opening", "closing");
  }
}

function renderExpenseCalendar() {
  populateYearSelectElement($("exp-cal-year-select"), expCalViewDate.getFullYear());
  const monthSel = $("exp-cal-month-select");
  if (monthSel) monthSel.value = expCalViewDate.getMonth();

  const { min: calMin, max: calMax } = calendarBounds();
  if ($("exp-cal-prev")) $("exp-cal-prev").disabled = expCalViewDate <= calMin;
  if ($("exp-cal-next")) $("exp-cal-next").disabled = expCalViewDate >= calMax;

  const daysGrid = $("expense-calendar-grid-days");
  if (!daysGrid) return;
  daysGrid.innerHTML = "";

  const year = expCalViewDate.getFullYear();
  const month = expCalViewDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevMonthDays = new Date(year, month, 0).getDate();

  const curTodayISO = todayISO();
  const currentPickedISO = $("expense-date") ? $("expense-date").value : curTodayISO;
  const monthPrefix = toLocalMonthPrefix(expCalViewDate);
  const expenseDatesSet = new Set(
    expenses.filter((e) => e.dateISO && e.dateISO.startsWith(monthPrefix)).map((e) => e.dateISO)
  );

  let cellIdx = 0;
  for (let i = firstDay - 1; i >= 0; i--) {
    const btn = document.createElement("button");
    btn.className = "calendar-day-cell other-month";
    btn.textContent = prevMonthDays - i;
    btn.type = "button";
    btn.style.animationDelay = `${cellIdx * 0.005}s`;
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
    btn.style.animationDelay = `${cellIdx * 0.005}s`;
    cellIdx++;

    if (dateISO === curTodayISO) btn.classList.add("today");
    if (dateISO === currentPickedISO) btn.classList.add("selected");
    if (expenseDatesSet.has(dateISO)) btn.classList.add("has-expenses");

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      setExpenseDateValue(dateISO);
      closeExpenseCalendar(true);
    });

    daysGrid.appendChild(btn);
  }
}

if ($("expense-date-trigger")) {
  $("expense-date-trigger").addEventListener("click", (e) => {
    e.stopPropagation();
    if (expCalOpen) closeExpenseCalendar(true);
    else openExpenseCalendar();
  });
}
if ($("exp-cal-prev")) {
  $("exp-cal-prev").addEventListener("click", (e) => {
    e.stopPropagation();
    const next = new Date(expCalViewDate.getFullYear(), expCalViewDate.getMonth() - 1, 1);
    const { min } = calendarBounds();
    if (next < min) return;
    expCalViewDate = next;
    renderExpenseCalendar();
  });
}
if ($("exp-cal-next")) {
  $("exp-cal-next").addEventListener("click", (e) => {
    e.stopPropagation();
    const next = new Date(expCalViewDate.getFullYear(), expCalViewDate.getMonth() + 1, 1);
    const { max } = calendarBounds();
    if (next > max) return;
    expCalViewDate = next;
    renderExpenseCalendar();
  });
}
if ($("exp-cal-today-btn")) {
  $("exp-cal-today-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    setExpenseDateValue(todayISO());
    closeExpenseCalendar(true);
  });
}
if ($("exp-cal-month-select")) {
  $("exp-cal-month-select").addEventListener("change", (e) => {
    const m = parseInt(e.target.value, 10);
    expCalViewDate = new Date(expCalViewDate.getFullYear(), m, 1);
    renderExpenseCalendar();
  });
}
if ($("exp-cal-year-select")) {
  $("exp-cal-year-select").addEventListener("change", (e) => {
    const y = parseInt(e.target.value, 10);
    expCalViewDate = new Date(y, expCalViewDate.getMonth(), 1);
    renderExpenseCalendar();
  });
}

function openExpenseSheet(expense) {
  const viewYm = toLocalMonthPrefix(viewDate);
  const targetYm = expense && expense.dateISO
    ? expense.dateISO.slice(0, 7)
    : (selectedDateISO ? selectedDateISO.slice(0, 7) : viewYm);

  if (isPastMonth(targetYm) && !isPastMonthUnlocked(targetYm)) {
    openUnlockPastSheet(targetYm, () => openExpenseSheet(expense));
    return;
  }

  editingId = expense ? expense.id : null;
  $("expense-sheet-title").textContent = expense ? "Edit expense" : "Add expense";
  $("delete-expense-btn").classList.toggle("hidden", !expense);
  $("amount").value = expense ? expense.amount : "";
  $("category").value = expense ? expense.category : "Food";
  $("note").value = expense ? expense.note || "" : "";

  let initialDateISO = toLocalISO(new Date());
  if (expense && expense.dateISO) {
    initialDateISO = expense.dateISO;
  } else if (selectedDateISO) {
    initialDateISO = selectedDateISO;
  } else if (viewYm !== toLocalMonthPrefix(new Date())) {
    initialDateISO = toLocalISO(viewDate);
  }
  closeExpenseCalendar(false);
  setExpenseDateValue(initialDateISO);
  addSheet.classList.remove("hidden");
}
function closeExpenseSheet() {
  closeExpenseCalendar(false);
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

    reconcileActiveMonthSpend(monthPrefix);
    syncBudgetState();
    safeSet(appliedKey, "true");
  } finally {
    isApplyingRecurring = false;
  }
}
