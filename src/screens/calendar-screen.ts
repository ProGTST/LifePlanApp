import type { TransactionRow } from "../types";
import {
  transactionHistoryInitialTab,
  setTransactionHistoryInitialTab,
  setTransactionEntryEditId,
  setTransactionEntryViewOnly,
  pushNavigation,
} from "../state";
import { registerViewHandler, registerRefreshHandler, showMainView } from "../app/screen";
import { updateCurrentMenuItem } from "../app/sidebar";
import { createIconWrap } from "../utils/iconWrap";
import { ICON_DEFAULT_COLOR } from "../constants/colorPresets";
import { Chart, registerables } from "chart.js";
import ChartDataLabels from "chartjs-plugin-datalabels";
import {
  loadTransactionData,
  getFilteredTransactionListForCalendar,
  getCategoryById,
  getRowPermissionType,
  updateTransactionHistoryTabLayout,
  setFilterDateFromTo,
  renderList as renderTransactionList,
  registerFilterChangeCallback,
} from "./transaction-history-screen";

// ---------------------------------------------------------------------------
// 状態
// ---------------------------------------------------------------------------

/** 週別・カレンダータブで表示する年月（YYYY-MM） */
let selectedCalendarYM = "";

/** グラフ用に登録済みか */
let chartJsRegistered = false;
/** 作成した Chart インスタンス（破棄用） */
const chartInstances: Chart[] = [];

// ---------------------------------------------------------------------------
// ヘルパー
// ---------------------------------------------------------------------------

const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"];

function getTodayYMD(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDateMdWeek(dateStr: string): string {
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "—";
  const [, y, m, d] = match;
  const month = parseInt(m, 10);
  const day = parseInt(d, 10);
  const date = new Date(parseInt(y, 10), month - 1, day);
  const week = WEEKDAY_JA[date.getDay()];
  return `${month}月${day}日(${week})`;
}

function isCurrentWeek(from: string, to: string): boolean {
  const today = getTodayYMD();
  return today >= from && today <= to;
}

function addDays(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d + delta);
  const yy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function getWeeksInMonth(
  year: number,
  month: number
): { from: string; to: string; weekNumber: number; dateRange: string }[] {
  const first = new Date(year, month - 1, 1);
  const last = new Date(year, month, 0);
  const lastDate = last.getDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  const weeks: { from: string; to: string; weekNumber: number; dateRange: string }[] = [];
  let weekIndex = 0;
  let sun = 1 - first.getDay();
  while (sun <= lastDate) {
    const sat = sun + 6;
    const weekFrom = Math.max(1, sun);
    const weekTo = Math.min(lastDate, sat);
    if (weekFrom <= lastDate && weekTo >= 1) {
      weekIndex += 1;
      const fromStr = `${year}-${pad(month)}-${pad(weekFrom)}`;
      const toStr = `${year}-${pad(month)}-${pad(weekTo)}`;
      const dateRange = `${month}月${weekFrom}日～${month}月${weekTo}日`;
      weeks.push({ from: fromStr, to: toStr, weekNumber: weekIndex, dateRange });
    }
    sun += 7;
  }
  return weeks;
}

function getMonthCalendarInfo(year: number, month: number): { firstDay: number; lastDate: number } {
  const first = new Date(year, month - 1, 1);
  const last = new Date(year, month, 0);
  return { firstDay: first.getDay(), lastDate: last.getDate() };
}

// ---------------------------------------------------------------------------
// カレンダー集計
// ---------------------------------------------------------------------------

function getCalendarDaySummary(
  dateStr: string
): { planCount: number; actualCount: number; incomeAmount: number; expenseAmount: number; transferAmount: number } {
  const filtered = getFilteredTransactionListForCalendar();
  let planCount = 0;
  let actualCount = 0;
  let incomeAmount = 0;
  let expenseAmount = 0;
  let transferAmount = 0;
  for (const row of filtered) {
    const from = row.TRANDATE_FROM || "";
    const to = row.TRANDATE_TO || "";
    if (row.PROJECT_TYPE === "actual") {
      if (from === dateStr) {
        actualCount += 1;
        const type = (row.TRANSACTION_TYPE || "expense").toLowerCase();
        if (type === "income") incomeAmount += Number(row.AMOUNT) || 0;
        else if (type === "expense") expenseAmount += Number(row.AMOUNT) || 0;
        else if (type === "transfer") transferAmount += Number(row.AMOUNT) || 0;
      }
      continue;
    }
    if (!from || !to) continue;
    const inPlanRange = from <= dateStr && dateStr <= to;
    if (inPlanRange) planCount += 1;
    if (dateStr === to) {
      const type = (row.TRANSACTION_TYPE || "").toLowerCase();
      if (type === "income") incomeAmount += Number(row.AMOUNT) || 0;
      else if (type === "expense") expenseAmount += Number(row.AMOUNT) || 0;
      else if (type === "transfer") transferAmount += Number(row.AMOUNT) || 0;
    }
  }
  return { planCount, actualCount, incomeAmount, expenseAmount, transferAmount };
}

function getCalendarMonthTotals(
  year: number,
  month: number
): { planIncome: number; planExpense: number; actualIncome: number; actualExpense: number } {
  const monthStr = `${year}-${String(month).padStart(2, "0")}`;
  const firstDay = monthStr + "-01";
  const lastDate = new Date(year, month, 0).getDate();
  const lastDay = monthStr + "-" + String(lastDate).padStart(2, "0");
  const filtered = getFilteredTransactionListForCalendar();
  let planIncome = 0;
  let planExpense = 0;
  let actualIncome = 0;
  let actualExpense = 0;
  for (const row of filtered) {
    const from = row.TRANDATE_FROM || "";
    const to = row.TRANDATE_TO || "";
    if (row.PROJECT_TYPE === "actual") {
      if (from < firstDay || from > lastDay) continue;
      const type = (row.TRANSACTION_TYPE || "expense").toLowerCase();
      const amount = Number(row.AMOUNT) || 0;
      if (type === "income") actualIncome += amount;
      else if (type === "expense") actualExpense += amount;
      continue;
    }
    if (!to || to < firstDay || to > lastDay) continue;
    const type = (row.TRANSACTION_TYPE || "").toLowerCase();
    const amount = Number(row.AMOUNT) || 0;
    if (type === "income") planIncome += amount;
    else if (type === "expense") planExpense += amount;
  }
  return { planIncome, planExpense, actualIncome, actualExpense };
}

function getTransactionsInRange(from: string, to: string): TransactionRow[] {
  const filtered = getFilteredTransactionListForCalendar();
  return filtered.filter((row) => {
    const trFrom = row.TRANDATE_FROM || "";
    const trTo = row.TRANDATE_TO || "";
    if (row.PROJECT_TYPE === "actual") {
      return trFrom >= from && trFrom <= to;
    }
    if (!trFrom || !trTo) return false;
    return trFrom <= to && trTo >= from;
  });
}

function getChartDataForMonth(ym: string): {
  labels: string[];
  planIncomeByDay: number[];
  actualIncomeByDay: number[];
  planExpenseByDay: number[];
  actualExpenseByDay: number[];
  planIncomeByCategory: Array<{ id: string; name: string; amount: number; color: string }>;
  planExpenseByCategory: Array<{ id: string; name: string; amount: number; color: string }>;
  actualIncomeByCategory: Array<{ id: string; name: string; amount: number; color: string }>;
  actualExpenseByCategory: Array<{ id: string; name: string; amount: number; color: string }>;
} {
  const m = ym.match(/^(\d{4})-(\d{2})$/);
  if (!m) {
    return {
      labels: [],
      planIncomeByDay: [],
      actualIncomeByDay: [],
      planExpenseByDay: [],
      actualExpenseByDay: [],
      planIncomeByCategory: [],
      planExpenseByCategory: [],
      actualIncomeByCategory: [],
      actualExpenseByCategory: [],
    };
  }
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const firstDay = ym + "-01";
  const lastDate = new Date(year, month, 0).getDate();
  const lastDay = ym + "-" + String(lastDate).padStart(2, "0");
  const pad = (n: number) => String(n).padStart(2, "0");
  const labels: string[] = [];
  const planIncomeByDay: number[] = [];
  const actualIncomeByDay: number[] = [];
  const planExpenseByDay: number[] = [];
  const actualExpenseByDay: number[] = [];
  for (let d = 1; d <= lastDate; d++) {
    labels.push(pad(d) + "日");
    planIncomeByDay.push(0);
    actualIncomeByDay.push(0);
    planExpenseByDay.push(0);
    actualExpenseByDay.push(0);
  }
  const planIncomeCat: Record<string, number> = {};
  const planExpenseCat: Record<string, number> = {};
  const actualIncomeCat: Record<string, number> = {};
  const actualExpenseCat: Record<string, number> = {};
  const filtered = getFilteredTransactionListForCalendar();
  for (const row of filtered) {
    const type = (row.TRANSACTION_TYPE || "expense").toLowerCase();
    const amount = Number(row.AMOUNT) || 0;
    const catId = row.CATEGORY_ID || "";
    const from = row.TRANDATE_FROM || "";
    const to = row.TRANDATE_TO || "";
    if (row.PROJECT_TYPE === "actual") {
      if (from < firstDay || from > lastDay) continue;
      const dayIdx = parseInt(from.slice(8, 10), 10) - 1;
      if (dayIdx < 0 || dayIdx >= labels.length) continue;
      if (type === "income") {
        actualIncomeByDay[dayIdx] += amount;
        actualIncomeCat[catId] = (actualIncomeCat[catId] || 0) + amount;
      } else if (type === "expense") {
        actualExpenseByDay[dayIdx] += amount;
        actualExpenseCat[catId] = (actualExpenseCat[catId] || 0) + amount;
      }
      continue;
    }
    if (!to || to < firstDay || to > lastDay) continue;
    const dayIdx = parseInt(to.slice(8, 10), 10) - 1;
    if (dayIdx < 0 || dayIdx >= labels.length) continue;
    if (type === "income") {
      planIncomeByDay[dayIdx] += amount;
      planIncomeCat[catId] = (planIncomeCat[catId] || 0) + amount;
    } else if (type === "expense") {
      planExpenseByDay[dayIdx] += amount;
      planExpenseCat[catId] = (planExpenseCat[catId] || 0) + amount;
    }
  }
  const toCategoryArray = (
    rec: Record<string, number>
  ): Array<{ id: string; name: string; amount: number; color: string }> =>
    Object.entries(rec).map(([id, amount]) => ({
      id,
      name: getCategoryById(id)?.CATEGORY_NAME?.trim() || "未分類",
      amount,
      color: getCategoryById(id)?.COLOR || "#888888",
    }));
  return {
    labels,
    planIncomeByDay,
    actualIncomeByDay,
    planExpenseByDay,
    actualExpenseByDay,
    planIncomeByCategory: toCategoryArray(planIncomeCat),
    planExpenseByCategory: toCategoryArray(planExpenseCat),
    actualIncomeByCategory: toCategoryArray(actualIncomeCat),
    actualExpenseByCategory: toCategoryArray(actualExpenseCat),
  };
}

// ---------------------------------------------------------------------------
// グラフ描画
// ---------------------------------------------------------------------------

function renderCharts(ym: string): void {
  chartInstances.forEach((ch) => ch.destroy());
  chartInstances.length = 0;
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return;
  if (!chartJsRegistered) {
    Chart.register(...registerables, ChartDataLabels, {
      id: "centerLabelAndHole",
      afterDraw(chart: Chart) {
        const centerOpts = (chart.options.plugins as Record<string, { label?: string; total?: number }> | undefined)
          ?.centerLabel;
        if (!centerOpts?.label && centerOpts?.total === undefined) return;
        const meta = chart.getDatasetMeta(0);
        if (!meta?.data?.length) return;
        const arc = meta.data[0] as { x: number; y: number; innerRadius: number };
        const ctx = chart.ctx;
        const x = arc.x;
        const y = arc.y;
        const r = arc.innerRadius;
        if (r > 0) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fillStyle = "#ffffff";
          ctx.fill();
          ctx.restore();
        }
        const label = centerOpts.label ?? "";
        const total = centerOpts.total ?? 0;
        const totalStr = total.toLocaleString();
        ctx.save();
        ctx.fillStyle = "#333333";
        ctx.font = "bold 12px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        if (label) ctx.fillText(label, x, y - 10);
        ctx.font = "11px sans-serif";
        ctx.fillText(totalStr, x, y + (label ? 8 : 0));
        ctx.restore();
      },
    });
    chartJsRegistered = true;
  }
  const data = getChartDataForMonth(ym);
  const chartOptions = { responsive: true, maintainAspectRatio: true, aspectRatio: 2 };
  const incomeDiffByDay = data.labels.map((_, i) => data.actualIncomeByDay[i] - data.planIncomeByDay[i]);
  const expenseDiffByDay = data.labels.map((_, i) => data.planExpenseByDay[i] - data.actualExpenseByDay[i]);
  const mixedOptions = {
    ...chartOptions,
    scales: {
      x: { title: { display: true, text: "日付" } },
      y: { title: { display: true, text: "金額" }, beginAtZero: false },
    },
  };
  const incomeDiffCanvas = document.getElementById("transaction-history-chart-income-diff") as HTMLCanvasElement | null;
  if (incomeDiffCanvas) {
    const ch = new Chart(incomeDiffCanvas, {
      type: "bar",
      data: {
        labels: data.labels,
        datasets: [
          {
            type: "bar",
            label: "差分(実績−予定)",
            data: incomeDiffByDay,
            backgroundColor: "rgba(100, 100, 100, 0.6)",
            order: 2,
          },
          {
            type: "line",
            label: "実績収入",
            data: data.actualIncomeByDay,
            borderColor: "rgb(46, 125, 50)",
            backgroundColor: "rgba(46, 125, 50, 0.1)",
            fill: false,
            tension: 0.2,
            order: 1,
          },
          {
            type: "line",
            label: "予定収入",
            data: data.planIncomeByDay,
            borderColor: "rgba(46, 125, 50, 0.7)",
            borderDash: [4, 2],
            backgroundColor: "transparent",
            fill: false,
            tension: 0.2,
            order: 1,
          },
        ],
      },
      options: mixedOptions,
    });
    chartInstances.push(ch);
  }
  const expenseDiffCanvas = document.getElementById("transaction-history-chart-expense-diff") as HTMLCanvasElement | null;
  if (expenseDiffCanvas) {
    const ch = new Chart(expenseDiffCanvas, {
      type: "bar",
      data: {
        labels: data.labels,
        datasets: [
          {
            type: "bar",
            label: "差分(予定−実績)",
            data: expenseDiffByDay,
            backgroundColor: "rgba(100, 100, 100, 0.6)",
            order: 2,
          },
          {
            type: "line",
            label: "実績支出",
            data: data.actualExpenseByDay,
            borderColor: "rgb(198, 40, 40)",
            backgroundColor: "rgba(198, 40, 40, 0.1)",
            fill: false,
            tension: 0.2,
            order: 1,
          },
          {
            type: "line",
            label: "予定支出",
            data: data.planExpenseByDay,
            borderColor: "rgba(198, 40, 40, 0.7)",
            borderDash: [4, 2],
            backgroundColor: "transparent",
            fill: false,
            tension: 0.2,
            order: 1,
          },
        ],
      },
      options: mixedOptions,
    });
    chartInstances.push(ch);
  }
  const pieOptionsBase = {
    ...chartOptions,
    cutout: "55%",
    plugins: {
      legend: { position: "bottom" as const },
      datalabels: {
        formatter: (value: number, ctx: { chart: Chart; dataIndex: number }) => {
          const ds = ctx.chart.data.datasets[0];
          const total = (ds.data as number[]).reduce((a, b) => a + b, 0);
          const pct = total ? Math.round((value / total) * 100) : 0;
          return `${pct}%`;
        },
        color: "#fff",
        font: { size: 11, weight: "bold" as const },
      },
    },
  };
  const makePie = (
    canvasId: string,
    items: Array<{ name: string; amount: number; color: string }>,
    centerLabel: string
  ): void => {
    const el = document.getElementById(canvasId) as HTMLCanvasElement | null;
    if (!el) return;
    const safeItems = items.length > 0 ? items : [{ name: "データなし", amount: 1, color: "#e0e0e0" }];
    const total = safeItems.reduce((s, i) => s + i.amount, 0);
    const ch = new Chart(el, {
      type: "doughnut",
      data: {
        labels: safeItems.map((i) => i.name),
        datasets: [{ data: safeItems.map((i) => i.amount), backgroundColor: safeItems.map((i) => i.color) }],
      },
      options: {
        ...pieOptionsBase,
        plugins: {
          ...pieOptionsBase.plugins,
          centerLabel: { label: centerLabel, total },
        },
      },
    });
    chartInstances.push(ch);
  };
  makePie("transaction-history-chart-plan-income-pie", data.planIncomeByCategory, "予定収入");
  makePie("transaction-history-chart-plan-expense-pie", data.planExpenseByCategory, "予定支出");
  makePie("transaction-history-chart-actual-income-pie", data.actualIncomeByCategory, "実績収入");
  makePie("transaction-history-chart-actual-expense-pie", data.actualExpenseByCategory, "実績支出");
}

// ---------------------------------------------------------------------------
// 週表示・月表示
// ---------------------------------------------------------------------------

function renderWeeklyPanel(): void {
  const container = document.getElementById("transaction-history-weekly-blocks");
  if (!container) return;
  container.innerHTML = "";
  const m = selectedCalendarYM.match(/^(\d{4})-(\d{2})$/);
  if (!m) return;
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const weeks = getWeeksInMonth(year, month);
  for (const week of weeks) {
    const block = document.createElement("div");
    block.className = "transaction-history-week-block";
    const title = document.createElement("div");
    title.className = "transaction-history-week-block-title";
    if (isCurrentWeek(week.from, week.to)) {
      title.classList.add("transaction-history-week-block-title--current");
    }
    const line1 = document.createElement("div");
    line1.className = "transaction-history-week-block-title-line";
    line1.textContent = `${week.weekNumber}週目`;
    const line2 = document.createElement("div");
    line2.className = "transaction-history-week-block-title-line";
    line2.textContent = week.dateRange;
    title.appendChild(line1);
    title.appendChild(line2);
    block.appendChild(title);
    const list = document.createElement("div");
    list.className = "transaction-history-week-block-list";
    const rows = getTransactionsInRange(week.from, week.to);
    const byDate = new Map<string, { row: TransactionRow; showAmount: boolean }[]>();
    const push = (dateStr: string, row: TransactionRow, showAmount: boolean): void => {
      if (!byDate.has(dateStr)) byDate.set(dateStr, []);
      byDate.get(dateStr)!.push({ row, showAmount });
    };
    const inWeek = (d: string): boolean => d >= week.from && d <= week.to;
    for (const row of rows) {
      const planFrom = row.TRANDATE_FROM || "";
      const planTo = row.TRANDATE_TO || "";
      if (row.PROJECT_TYPE === "actual") {
        if (!planFrom) continue;
        push(planFrom, row, true);
      } else {
        if (!planFrom || !planTo) continue;
        const fromInWeek = inWeek(planFrom);
        const toInWeek = inWeek(planTo);
        if (planFrom === planTo) {
          if (fromInWeek) push(planFrom, row, true);
        } else {
          if (fromInWeek) push(planFrom, row, false);
          if (toInWeek) push(planTo, row, true);
          const firstMid = addDays(planFrom, 1);
          const lastMid = addDays(planTo, -1);
          const hasMiddleInWeek = firstMid <= lastMid && week.from <= lastMid && firstMid <= week.to;
          if (hasMiddleInWeek && !fromInWeek && !toInWeek) push(week.from, row, false);
        }
      }
    }
    let planIncome = 0;
    let planExpense = 0;
    let actualIncome = 0;
    let actualExpense = 0;
    for (const items of byDate.values()) {
      for (const { row, showAmount } of items) {
        if (!showAmount) continue;
        const amount = Number(row.AMOUNT) || 0;
        const type = (row.TRANSACTION_TYPE || "expense") as "income" | "expense" | "transfer";
        const isPlan = row.PROJECT_TYPE === "plan";
        if (type === "income") {
          if (isPlan) planIncome += amount;
          else actualIncome += amount;
        } else if (type === "expense") {
          if (isPlan) planExpense += amount;
          else actualExpense += amount;
        }
      }
    }
    const planBalance = planIncome - planExpense;
    const actualBalance = actualIncome - actualExpense;

    const sortedDates = Array.from(byDate.keys()).sort();
    for (const dateStr of sortedDates) {
      const dayGroup = document.createElement("div");
      dayGroup.className = "transaction-history-week-day-group";
      const dayTitle = document.createElement("div");
      dayTitle.className = "transaction-history-week-day-title";
      dayTitle.textContent = formatDateMdWeek(dateStr);
      dayGroup.appendChild(dayTitle);
      const dayItems = document.createElement("div");
      dayItems.className = "transaction-history-week-day-items";
      for (const { row, showAmount } of byDate.get(dateStr)!) {
        const item = document.createElement("div");
        item.className = "transaction-history-week-block-item";
        const permType = getRowPermissionType(row);
        if (permType === "view") item.classList.add("transaction-history-week-block-item--permission-view");
        else if (permType === "edit") item.classList.add("transaction-history-week-block-item--permission-edit");
        item.dataset.transactionId = row.ID;
        item.setAttribute("role", "button");
        item.setAttribute("tabindex", "0");
        item.setAttribute("aria-label", `${row.NAME || "取引"}を編集`);
        const typeIcon = document.createElement("span");
        typeIcon.className = "transaction-history-type-icon";
        const txType = (row.TRANSACTION_TYPE || "expense") as "income" | "expense" | "transfer";
        typeIcon.classList.add(`transaction-history-type-icon--${txType}`);
        typeIcon.textContent = txType === "income" ? "収" : txType === "expense" ? "支" : "振";
        typeIcon.setAttribute("aria-label", txType === "income" ? "収入" : txType === "expense" ? "支出" : "振替");
        item.appendChild(typeIcon);
        const cat = getCategoryById(row.CATEGORY_ID);
        const catIcon = createIconWrap(cat?.COLOR || ICON_DEFAULT_COLOR, cat?.ICON_PATH, {
          className: "transaction-history-week-category-icon",
        });
        item.appendChild(catIcon);
        const nameSpan = document.createElement("span");
        nameSpan.className = "transaction-history-week-block-name";
        nameSpan.textContent = row.NAME || "—";
        item.appendChild(nameSpan);
        const amountSpan = document.createElement("span");
        amountSpan.className = "transaction-history-week-block-amount";
        amountSpan.textContent = showAmount && row.AMOUNT ? Number(row.AMOUNT).toLocaleString() : "0";
        item.appendChild(amountSpan);
        const openEntry = (): void => {
          const permType = getRowPermissionType(row);
          setTransactionEntryViewOnly(permType === "view");
          setTransactionEntryEditId(row.ID);
          pushNavigation("transaction-entry");
          showMainView("transaction-entry");
          updateCurrentMenuItem();
        };
        item.addEventListener("click", openEntry);
        item.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openEntry();
          }
        });
        dayItems.appendChild(item);
      }
      dayGroup.appendChild(dayItems);
      list.appendChild(dayGroup);
    }
    block.appendChild(list);

    const footer = document.createElement("div");
    footer.className = "transaction-history-week-block-footer";
    footer.setAttribute("role", "group");
    footer.setAttribute("aria-label", "週合計");
    const addFooterSection = (
      sectionLabel: string,
      income: number,
      expense: number,
      balance: number
    ): void => {
      const sectionTitle = document.createElement("div");
      sectionTitle.className = "transaction-history-week-block-footer-section-title";
      sectionTitle.textContent = sectionLabel;
      footer.appendChild(sectionTitle);
      const footerRow = document.createElement("div");
      footerRow.className = "transaction-history-week-block-footer-row";
      const incomeCell = document.createElement("div");
      incomeCell.className = "transaction-history-week-block-footer-cell";
      incomeCell.innerHTML = `<span class="transaction-history-week-block-footer-label">収入</span><span class="transaction-history-week-block-footer-amount">${income.toLocaleString()}</span>`;
      const expenseCell = document.createElement("div");
      expenseCell.className = "transaction-history-week-block-footer-cell";
      expenseCell.innerHTML = `<span class="transaction-history-week-block-footer-label">支出</span><span class="transaction-history-week-block-footer-amount">${expense.toLocaleString()}</span>`;
      const balanceCell = document.createElement("div");
      balanceCell.className = "transaction-history-week-block-footer-cell transaction-history-week-block-footer-cell--balance";
      const balanceAmountClass =
        balance < 0
          ? "transaction-history-week-block-footer-amount transaction-history-week-block-footer-amount--negative"
          : "transaction-history-week-block-footer-amount";
      balanceCell.innerHTML = `<span class="transaction-history-week-block-footer-label">総合計</span><span class="${balanceAmountClass}">${balance.toLocaleString()}</span>`;
      footerRow.appendChild(incomeCell);
      footerRow.appendChild(expenseCell);
      footerRow.appendChild(balanceCell);
      footer.appendChild(footerRow);
    };
    addFooterSection("予定", planIncome, planExpense, planBalance);
    addFooterSection("実績", actualIncome, actualExpense, actualBalance);
    block.appendChild(footer);
    container.appendChild(block);
  }
}

function renderCalendarPanel(): void {
  const grid = document.getElementById("transaction-history-calendar-grid");
  if (!grid) return;
  grid.innerHTML = "";
  const m = selectedCalendarYM.match(/^(\d{4})-(\d{2})$/);
  if (!m) return;
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const { firstDay, lastDate } = getMonthCalendarInfo(year, month);
  const pad = (n: number) => String(n).padStart(2, "0");
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  weekdays.forEach((w) => {
    const th = document.createElement("div");
    th.className = "transaction-history-calendar-weekday";
    th.textContent = w;
    grid.appendChild(th);
  });
  let day = 1;
  const totalCells = firstDay + lastDate;
  const rows = Math.ceil(totalCells / 7) * 7;
  for (let i = 0; i < rows; i++) {
    const cell = document.createElement("div");
    cell.className = "transaction-history-calendar-day";
    if (i < firstDay || day > lastDate) {
      cell.classList.add("transaction-history-calendar-day--empty");
    } else {
      const dateStr = `${year}-${pad(month)}-${pad(day)}`;
      cell.classList.add("transaction-history-calendar-day--clickable");
      cell.setAttribute("role", "button");
      cell.setAttribute("tabindex", "0");
      cell.setAttribute("aria-label", `${dateStr}の取引を一覧で表示`);
      if (dateStr === getTodayYMD()) {
        cell.classList.add("transaction-history-calendar-day--today");
      }
      const num = document.createElement("div");
      num.className = "transaction-history-calendar-day-num";
      num.textContent = String(day);
      cell.appendChild(num);
      const summary = getCalendarDaySummary(dateStr);
      const addSummaryLine = (
        iconModifierClass: string,
        iconText: string,
        label: string,
        text: string
      ): void => {
        const line = document.createElement("div");
        line.className = "transaction-history-calendar-day-summary";
        const typeIcon = document.createElement("span");
        typeIcon.className = `transaction-history-type-icon ${iconModifierClass}`;
        typeIcon.textContent = iconText;
        typeIcon.setAttribute("aria-label", label);
        const textSpan = document.createElement("span");
        textSpan.className = "transaction-history-calendar-day-summary-amount";
        textSpan.textContent = text;
        line.appendChild(typeIcon);
        line.appendChild(textSpan);
        cell.appendChild(line);
      };
      if (summary.planCount > 0) {
        const iconEl = document.createElement("span");
        iconEl.className = "transaction-history-plan-icon";
        iconEl.textContent = "予";
        iconEl.setAttribute("aria-label", "予定");
        const line = document.createElement("div");
        line.className = "transaction-history-calendar-day-summary";
        line.appendChild(iconEl);
        const textSpan = document.createElement("span");
        textSpan.className = "transaction-history-calendar-day-summary-amount";
        textSpan.textContent = `${summary.planCount}件`;
        line.appendChild(textSpan);
        cell.appendChild(line);
      }
      if (summary.actualCount > 0) {
        const iconEl = document.createElement("span");
        iconEl.className = "transaction-history-plan-icon";
        iconEl.textContent = "実";
        iconEl.setAttribute("aria-label", "実績");
        const line = document.createElement("div");
        line.className = "transaction-history-calendar-day-summary";
        line.appendChild(iconEl);
        const textSpan = document.createElement("span");
        textSpan.className = "transaction-history-calendar-day-summary-amount";
        textSpan.textContent = `${summary.actualCount}件`;
        line.appendChild(textSpan);
        cell.appendChild(line);
      }
      if (summary.incomeAmount > 0) {
        addSummaryLine(
          "transaction-history-type-icon--income",
          "収",
          "収入",
          summary.incomeAmount.toLocaleString()
        );
      }
      if (summary.expenseAmount > 0) {
        addSummaryLine(
          "transaction-history-type-icon--expense",
          "支",
          "支出",
          summary.expenseAmount.toLocaleString()
        );
      }
      if (summary.transferAmount > 0) {
        addSummaryLine(
          "transaction-history-type-icon--transfer",
          "振",
          "振替",
          summary.transferAmount.toLocaleString()
        );
      }
      const showListForDate = (): void => {
        setFilterDateFromTo(dateStr, dateStr);
        switchTab("list");
        renderTransactionList();
      };
      cell.addEventListener("click", showListForDate);
      cell.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          showListForDate();
        }
      });
      day++;
    }
    grid.appendChild(cell);
  }

  const panel = grid.parentElement;
  const existingFooter = document.getElementById("transaction-history-calendar-footer");
  if (existingFooter) existingFooter.remove();
  const { planIncome, planExpense, actualIncome, actualExpense } = getCalendarMonthTotals(year, month);
  const planBalance = planIncome - planExpense;
  const actualBalance = actualIncome - actualExpense;
  const footer = document.createElement("div");
  footer.id = "transaction-history-calendar-footer";
  footer.className = "transaction-history-calendar-footer";
  footer.setAttribute("role", "group");
  footer.setAttribute("aria-label", "月合計");
  const addFooterSection = (
    sectionLabel: string,
    income: number,
    expense: number,
    balance: number
  ): void => {
    const sectionTitle = document.createElement("div");
    sectionTitle.className = "transaction-history-calendar-footer-section-title";
    sectionTitle.textContent = sectionLabel;
    footer.appendChild(sectionTitle);
    const footerRow = document.createElement("div");
    footerRow.className = "transaction-history-calendar-footer-row";
    const addFooterLine = (label: string, value: number, negativeRed = false): void => {
      const line = document.createElement("div");
      line.className = "transaction-history-calendar-footer-line";
      const labelSpan = document.createElement("span");
      labelSpan.className = "transaction-history-calendar-footer-label";
      labelSpan.textContent = label;
      const valueSpan = document.createElement("span");
      valueSpan.className = "transaction-history-calendar-footer-amount";
      if (negativeRed && value < 0) valueSpan.classList.add("transaction-history-calendar-footer-amount--negative");
      valueSpan.textContent = value.toLocaleString();
      line.appendChild(labelSpan);
      line.appendChild(valueSpan);
      footerRow.appendChild(line);
    };
    addFooterLine("収入", income);
    addFooterLine("支出", expense);
    addFooterLine("総合計", balance, true);
    footer.appendChild(footerRow);
  };
  addFooterSection("予定", planIncome, planExpense, planBalance);
  addFooterSection("実績", actualIncome, actualExpense, actualBalance);
  panel?.appendChild(footer);
}

// ---------------------------------------------------------------------------
// タブ切替
// ---------------------------------------------------------------------------

function switchTab(tabId: string): void {
  document.querySelectorAll(".transaction-history-tab").forEach((btn) => {
    const b = btn as HTMLButtonElement;
    b.classList.toggle("is-active", b.dataset.tab === tabId);
    b.setAttribute("aria-selected", b.dataset.tab === tabId ? "true" : "false");
  });
  document.querySelectorAll(".transaction-history-panel").forEach((panel) => {
    const isList = panel.id === "transaction-history-list-panel" && tabId === "list";
    const isWeekly = panel.id === "transaction-history-weekly-panel" && tabId === "weekly";
    const isCalendar = panel.id === "transaction-history-calendar-panel" && tabId === "calendar";
    (panel as HTMLElement).classList.toggle("transaction-history-panel--hidden", !isList && !isWeekly && !isCalendar);
  });

  const chartsBody = document.getElementById("transaction-history-charts-body");
  const isChartsVisible = tabId === "weekly" || tabId === "calendar";
  if (chartsBody) chartsBody.classList.toggle("transaction-history-panel--hidden", !isChartsVisible);

  const tabsRow = document.querySelector(".transaction-history-tabs-row");
  const centerWrap = document.querySelector(".transaction-history-tabs-row-center");
  const ymInput = document.getElementById("transaction-history-calendar-ym") as HTMLInputElement;
  const isNavVisible = tabId === "weekly" || tabId === "calendar";
  tabsRow?.classList.toggle("is-nav-visible", isNavVisible);
  if (centerWrap) centerWrap.setAttribute("aria-hidden", isNavVisible ? "false" : "true");
  if (isNavVisible && ymInput) {
    if (!selectedCalendarYM) {
      const now = new Date();
      selectedCalendarYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    }
    ymInput.value = selectedCalendarYM;
    if (tabId === "weekly") renderWeeklyPanel();
    else if (tabId === "calendar") renderCalendarPanel();
    renderCharts(selectedCalendarYM);
  }
}

/**
 * カレンダー／週表示を再描画する。フィルター変更時などに呼ぶ。
 */
export function refreshCalendarView(): void {
  const activeTab = document.querySelector(".transaction-history-tab.is-active") as HTMLButtonElement | undefined;
  const tab = activeTab?.dataset.tab;
  if (tab === "weekly") {
    renderWeeklyPanel();
    if (selectedCalendarYM) renderCharts(selectedCalendarYM);
  } else if (tab === "calendar") {
    renderCalendarPanel();
    if (selectedCalendarYM) renderCharts(selectedCalendarYM);
  }
}

// ---------------------------------------------------------------------------
// 表示ハンドラ・初期化
// ---------------------------------------------------------------------------

function loadAndShowCalendar(forceReloadFromCsv = false): void {
  updateTransactionHistoryTabLayout();
  loadTransactionData(forceReloadFromCsv).then(() => {
    const initialTab = transactionHistoryInitialTab;
    if (initialTab === "weekly" || initialTab === "calendar") {
      setTransactionHistoryInitialTab(null);
      switchTab(initialTab);
    } else {
      const activeTab = document.querySelector(".transaction-history-tab.is-active") as HTMLButtonElement | undefined;
      if (activeTab?.dataset.tab === "weekly") {
        renderWeeklyPanel();
        if (selectedCalendarYM) renderCharts(selectedCalendarYM);
      } else if (activeTab?.dataset.tab === "calendar") {
        renderCalendarPanel();
        if (selectedCalendarYM) renderCharts(selectedCalendarYM);
      }
    }
  });
}

/**
 * カレンダー画面の初期化。週・月ビューのハンドラ登録と年月ナビのイベント登録を行う。
 */
export function initCalendarView(): void {
  registerFilterChangeCallback(refreshCalendarView);
  registerViewHandler("transaction-history-weekly", loadAndShowCalendar);
  registerViewHandler("transaction-history-calendar", loadAndShowCalendar);
  registerRefreshHandler("transaction-history-weekly", () => loadAndShowCalendar(true));
  registerRefreshHandler("transaction-history-calendar", () => loadAndShowCalendar(true));

  document.querySelectorAll(".transaction-history-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = (btn as HTMLButtonElement).dataset.tab;
      if (tab) switchTab(tab);
    });
  });

  const ymInput = document.getElementById("transaction-history-calendar-ym") as HTMLInputElement;
  const calendarPrev = document.getElementById("transaction-history-calendar-prev");
  const calendarNext = document.getElementById("transaction-history-calendar-next");
  function applyCalendarYM(ym: string): void {
    selectedCalendarYM = ym;
    if (ymInput) ymInput.value = ym;
    const tabList = document.querySelector(".transaction-history-tab.is-active") as HTMLButtonElement | null;
    const tab = tabList?.dataset.tab;
    if (tab === "weekly") renderWeeklyPanel();
    else if (tab === "calendar") renderCalendarPanel();
    if (tab === "weekly" || tab === "calendar") renderCharts(ym);
  }
  calendarPrev?.addEventListener("click", () => {
    if (!selectedCalendarYM) return;
    const [y, m] = selectedCalendarYM.split("-").map(Number);
    const d = new Date(y, m - 2, 1);
    applyCalendarYM(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  });
  calendarNext?.addEventListener("click", () => {
    if (!selectedCalendarYM) return;
    const [y, m] = selectedCalendarYM.split("-").map(Number);
    const d = new Date(y, m, 1);
    applyCalendarYM(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  });
  ymInput?.addEventListener("change", () => {
    const v = ymInput.value;
    if (v) applyCalendarYM(v);
  });
}
