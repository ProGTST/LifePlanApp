/**
 * 収支分析ビュー：資金繰りグラフ/表、収支種別・カテゴリ・勘定のグラフと表を表示する。
 */
import type { TransactionRow } from "../types";
import { transactionList, currentUserId } from "../state";
import { registerViewHandler, registerRefreshHandler } from "../app/screen";
import { loadTransactionData, getAccountRows, getCategoryById, getAccountById } from "../utils/transactionDataSync";
import { setDisplayedKeys } from "../utils/csvWatch";
import { getPlanOccurrenceDates } from "../utils/planOccurrence";
import { Chart, registerables } from "chart.js";
import { createIconWrap } from "../utils/iconWrap";
import { ICON_DEFAULT_COLOR } from "../constants/colorPresets";

Chart.register(...registerables);

/** 自分の勘定 ID の Set（権限付与勘定は含めず、集計は自分の勘定のみ）。 */
function getOwnAccountIds(): Set<string> {
  const ids = new Set<string>();
  const me = (currentUserId || "").trim();
  if (!me) return ids;
  getAccountRows()
    .filter((a) => (a.USER_ID || "").trim() === me)
    .forEach((a) => ids.add(a.ID));
  return ids;
}

/** 取引が自分の勘定のみに紐づくか。 */
function isRowOnlyOwnAccounts(row: TransactionRow, ownAccountIds: Set<string>): boolean {
  const inId = (row.ACCOUNT_ID_IN || "").trim();
  const outId = (row.ACCOUNT_ID_OUT || "").trim();
  if (inId && !ownAccountIds.has(inId)) return false;
  if (outId && !ownAccountIds.has(outId)) return false;
  return true;
}

/** 実績取引の対象日（YYYY-MM-DD）。TRANDATE_TO を優先。 */
function getActualTargetDate(row: TransactionRow): string {
  const from = (row.TRANDATE_FROM || "").trim().slice(0, 10);
  const to = (row.TRANDATE_TO || "").trim().slice(0, 10);
  return to || from || "";
}

/** 未削除かつ個人の勘定の予定取引のうち、計画中(完了・中止でない)かつ振替以外。 */
function getPlanRowsForCashFlow(list: TransactionRow[], ownAccountIds: Set<string>): TransactionRow[] {
  return list.filter((row) => {
    if ((row.PROJECT_TYPE || "").toLowerCase() !== "plan") return false;
    if ((row.DLT_FLG || "0") === "1") return false;
    if (!isRowOnlyOwnAccounts(row, ownAccountIds)) return false;
    const status = (row.PLAN_STATUS || "planning").toLowerCase();
    if (status === "complete" || status === "canceled") return false;
    const type = (row.TRANSACTION_TYPE || "").toLowerCase();
    if (type === "transfer") return false;
    return true;
  });
}

/** 日付ごとの予定収入・予定支出を集計（同一日は収入を先に計算）。返却は Map<YYYY-MM-DD, { income, expense }> */
function aggregatePlanByDate(rows: TransactionRow[]): Map<string, { income: number; expense: number }> {
  const byDate = new Map<string, { income: number; expense: number }>();
  const events: { date: string; type: "income" | "expense"; amount: number }[] = [];
  for (const row of rows) {
    const amount = parseFloat(String(row.AMOUNT ?? "0")) || 0;
    const type = (row.TRANSACTION_TYPE || "").toLowerCase() as "income" | "expense";
    const dates = getPlanOccurrenceDates(row);
    for (const d of dates) {
      events.push({ date: d.slice(0, 10), type: type === "income" ? "income" : "expense", amount });
    }
  }
  events.sort((a, b) => {
    const d = a.date.localeCompare(b.date);
    if (d !== 0) return d;
    return a.type === "income" ? -1 : 1;
  });
  let running = 0;
  for (const e of events) {
    if (!byDate.has(e.date)) byDate.set(e.date, { income: 0, expense: 0 });
    const cur = byDate.get(e.date)!;
    if (e.type === "income") {
      cur.income += e.amount;
      running += e.amount;
    } else {
      cur.expense += e.amount;
      running -= e.amount;
    }
  }
  return byDate;
}

/** 月ごとの予定収入・予定支出・予定残高・運転資金・充足率を計算。月は YYYY-MM の昇順。 */
function buildCashFlowByMonth(byDate: Map<string, { income: number; expense: number }>): { month: string; income: number; expense: number; balance: number; funds: number; rate: number | null }[] {
  const months = new Set<string>();
  byDate.forEach((_, d) => months.add(d.slice(0, 7)));
  const sortedMonths = Array.from(months).sort();
  const result: { month: string; income: number; expense: number; balance: number; funds: number; rate: number | null }[] = [];
  let funds = 0;
  for (const ym of sortedMonths) {
    let income = 0;
    let expense = 0;
    byDate.forEach((v, d) => {
      if (d.slice(0, 7) !== ym) return;
      income += v.income;
      expense += v.expense;
    });
    const balance = income - expense;
    const fundsBefore = funds;
    funds += balance;
    const rate = expense !== 0 ? (fundsBefore + income) / expense : null;
    result.push({ month: ym, income, expense, balance, funds, rate: rate !== null ? Math.round(rate * 100) : null });
  }
  return result;
}

/** 今年の実績取引（未削除・個人勘定）。 */
function getThisYearActuals(list: TransactionRow[], ownAccountIds: Set<string>): TransactionRow[] {
  const y = new Date().getFullYear();
  const prefix = String(y) + "-";
  return list.filter((row) => {
    if ((row.PROJECT_TYPE || "").toLowerCase() !== "actual") return false;
    if ((row.DLT_FLG || "0") === "1") return false;
    if (!isRowOnlyOwnAccounts(row, ownAccountIds)) return false;
    const d = getActualTargetDate(row);
    return d.slice(0, 4) === String(y) && d.length >= 7;
  });
}
/** 参照可能な勘定の今年の実績（未削除・transactionList は既に参照可能のみなのでそのまま年月で絞る）。 */
function getThisYearActualsVisible(list: TransactionRow[]): TransactionRow[] {
  const y = new Date().getFullYear();
  return list.filter((row) => {
    if ((row.PROJECT_TYPE || "").toLowerCase() !== "actual") return false;
    if ((row.DLT_FLG || "0") === "1") return false;
    const d = getActualTargetDate(row);
    return d.slice(0, 4) === String(y) && d.length >= 7;
  });
}

let chartInstances: Chart[] = [];

function destroyCharts(): void {
  chartInstances.forEach((c) => c.destroy());
  chartInstances = [];
}

function renderCashFlowChart(cashFlow: { month: string; income: number; expense: number; balance: number; funds: number; rate: number | null }[]): void {
  const canvas = document.getElementById("transaction-analysis-cashflow-chart") as HTMLCanvasElement | null;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const labels = cashFlow.map((r) => r.month);
  const fundsData = cashFlow.map((r) => r.funds);
  const expenseData = cashFlow.map((r) => r.expense);
  const chart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "運転資金", data: fundsData, type: "line", borderColor: "#1d4ed8", backgroundColor: "rgba(29, 78, 216, 0.1)", fill: true, tension: 0.2, order: 1 },
        { label: "予定支出", data: expenseData, type: "bar", backgroundColor: "rgba(185, 28, 28, 0.6)", order: 2 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      scales: {
        y: { beginAtZero: true, title: { display: true, text: "金額" } },
        x: { title: { display: true, text: "月" } },
      },
    },
  });
  chartInstances.push(chart);
}

function renderCashFlowTable(cashFlow: { month: string; income: number; expense: number; balance: number; funds: number; rate: number | null }[]): void {
  const thead = document.getElementById("transaction-analysis-cashflow-thead");
  const tbody = document.getElementById("transaction-analysis-cashflow-tbody");
  if (!thead || !tbody) return;
  thead.innerHTML = "";
  tbody.innerHTML = "";
  if (cashFlow.length === 0) return;
  const headerRow = document.createElement("tr");
  headerRow.innerHTML = "<th>項目</th>";
  cashFlow.forEach((r) => {
    const th = document.createElement("th");
    th.textContent = r.month;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  const row = (label: string, values: (number | null)[]) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${label}</td>`;
    values.forEach((v) => {
      const td = document.createElement("td");
      td.textContent = v !== null ? (typeof v === "number" && (v > 1000 || v < -1000) ? v.toLocaleString() : String(v)) : "—";
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  };
  row("予定収入", cashFlow.map((r) => r.income));
  row("予定支出", cashFlow.map((r) => r.expense));
  row("予定残高", cashFlow.map((r) => r.balance));
  row("運転資金", cashFlow.map((r) => r.funds));
  row("充足率(%)", cashFlow.map((r) => r.rate));
}

function renderTypeCharts(
  byMonth: { income: number[]; expense: number[]; transfer: number[] }
): void {
  const months = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];
  const opts = { responsive: true, scales: { y: { beginAtZero: true }, x: {} } };
  const ids = ["transaction-analysis-type-expense-chart", "transaction-analysis-type-income-chart", "transaction-analysis-type-transfer-chart"] as const;
  const data = [byMonth.expense, byMonth.income, byMonth.transfer] as const;
  ids.forEach((id, i) => {
    const canvas = document.getElementById(id) as HTMLCanvasElement | null;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const chart = new Chart(ctx, {
      type: "bar",
      data: { labels: months, datasets: [{ label: id.includes("expense") ? "支出" : id.includes("income") ? "収入" : "振替", data: data[i], backgroundColor: "rgba(100, 108, 255, 0.6)" }] },
      options: opts,
    });
    chartInstances.push(chart);
  });
}

function renderTypeTable(byMonth: { income: number[]; expense: number[]; transfer: number[] }): void {
  const thead = document.getElementById("transaction-analysis-type-thead");
  const tbody = document.getElementById("transaction-analysis-type-tbody");
  if (!thead || !tbody) return;
  thead.innerHTML = "";
  tbody.innerHTML = "";
  const months = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];
  const headerRow = document.createElement("tr");
  headerRow.innerHTML = "<th>項目</th>";
  months.forEach((m) => {
    const th = document.createElement("th");
    th.textContent = m;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  let funds = 0;
  const balanceByMonth = months.map((_, i) => {
    const inc = byMonth.income[i] ?? 0;
    const exp = byMonth.expense[i] ?? 0;
    funds += inc - exp;
    return funds;
  });
  const row = (label: string, values: number[]) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${label}</td>`;
    values.forEach((v) => {
      const td = document.createElement("td");
      td.textContent = v.toLocaleString();
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  };
  row("収入", byMonth.income);
  row("支出", byMonth.expense);
  row("振替", byMonth.transfer);
  row("残高", byMonth.income.map((_, i) => (byMonth.income[i] ?? 0) - (byMonth.expense[i] ?? 0)));
  row("運転資金", balanceByMonth);
}

function renderCategoryCharts(
  byCategoryMonth: { expense: Map<string, number[]>; income: Map<string, number[]>; transfer: Map<string, number[]> },
  getCategoryName: (id: string) => string
): void {
  const months = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];
  const ids = ["transaction-analysis-category-expense-chart", "transaction-analysis-category-income-chart", "transaction-analysis-category-transfer-chart"] as const;
  const keys = ["expense", "income", "transfer"] as const;
  keys.forEach((key, idx) => {
    const canvas = document.getElementById(ids[idx]) as HTMLCanvasElement | null;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const map = byCategoryMonth[key];
    const datasets = Array.from(map.entries()).map(([catId, values]) => ({
      label: getCategoryName(catId) || catId,
      data: values,
      tension: 0.2,
      fill: false,
    }));
    const chart = new Chart(ctx, {
      type: "line",
      data: { labels: months, datasets },
      options: { responsive: true, scales: { y: { beginAtZero: true }, x: {} } },
    });
    chartInstances.push(chart);
  });
}

function renderCategoryTable(
  byCategoryMonth: { expense: Map<string, number[]>; income: Map<string, number[]>; transfer: Map<string, number[]> },
  activeTab: "expense" | "income" | "transfer",
  getCategoryName: (id: string) => string
): void {
  const thead = document.getElementById("transaction-analysis-category-thead");
  const tbody = document.getElementById("transaction-analysis-category-tbody");
  if (!thead || !tbody) return;
  thead.innerHTML = "";
  tbody.innerHTML = "";
  const months = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];
  const headerRow = document.createElement("tr");
  headerRow.innerHTML = "<th>カテゴリー</th>";
  months.forEach((m) => {
    const th = document.createElement("th");
    th.textContent = m;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  const map = byCategoryMonth[activeTab];
  map.forEach((values, catId) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${getCategoryName(catId) || catId}</td>`;
    values.forEach((v) => {
      const td = document.createElement("td");
      td.textContent = v.toLocaleString();
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}

function renderCategoryRatioTables(
  totals: { expense: Map<string, number>; income: Map<string, number>; transfer: Map<string, number> },
  getCategoryName: (id: string) => string,
  getCategoryIcon: (id: string) => HTMLElement
): void {
  const tbodyIds = ["transaction-analysis-ratio-expense-tbody", "transaction-analysis-ratio-income-tbody", "transaction-analysis-ratio-transfer-tbody"] as const;
  const keys = ["expense", "income", "transfer"] as const;
  keys.forEach((key, idx) => {
    const tbody = document.getElementById(tbodyIds[idx]);
    if (!tbody) return;
    tbody.innerHTML = "";
    const map = totals[key];
    const sum = Array.from(map.values()).reduce((a, b) => a + b, 0);
    const entries = Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
    entries.forEach(([catId, amount]) => {
      const tr = document.createElement("tr");
      const pct = sum !== 0 ? Math.round((amount / sum) * 1000) / 10 : 0;
      const categoryTd = document.createElement("td");
      categoryTd.style.display = "flex";
      categoryTd.style.alignItems = "center";
      categoryTd.style.gap = "0.5rem";
      categoryTd.appendChild(getCategoryIcon(catId));
      categoryTd.appendChild(document.createTextNode(getCategoryName(catId) || catId));
      const amountTd = document.createElement("td");
      amountTd.textContent = amount.toLocaleString();
      const rateTd = document.createElement("td");
      rateTd.textContent = `${pct}%`;
      tr.appendChild(categoryTd);
      tr.appendChild(amountTd);
      tr.appendChild(rateTd);
      tbody.appendChild(tr);
    });
  });
}

function renderAccountChart(byAccountMonth: Map<string, number[]>, getAccountName: (id: string) => string): void {
  const canvas = document.getElementById("transaction-analysis-account-chart") as HTMLCanvasElement | null;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const months = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];
  const datasets = Array.from(byAccountMonth.entries()).map(([accId, values]) => ({
    label: getAccountName(accId) || accId,
    data: values,
    backgroundColor: "rgba(100, 108, 255, 0.6)",
  }));
  const chart = new Chart(ctx, {
    type: "bar",
    data: { labels: months, datasets },
    options: { responsive: true, scales: { y: { beginAtZero: true }, x: {} } },
  });
  chartInstances.push(chart);
}

function renderAccountTable(byAccountMonth: Map<string, number[]>, getAccountName: (id: string) => string): void {
  const thead = document.getElementById("transaction-analysis-account-thead");
  const tbody = document.getElementById("transaction-analysis-account-tbody");
  if (!thead || !tbody) return;
  thead.innerHTML = "";
  tbody.innerHTML = "";
  const months = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];
  const headerRow = document.createElement("tr");
  headerRow.innerHTML = "<th>勘定項目</th>";
  months.forEach((m) => {
    const th = document.createElement("th");
    th.textContent = m;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  byAccountMonth.forEach((values, accId) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${getAccountName(accId) || accId}</td>`;
    values.forEach((v) => {
      const td = document.createElement("td");
      td.textContent = v.toLocaleString();
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}

function loadAndRender(): void {
  destroyCharts();
  const ownAccountIds = getOwnAccountIds();

  const planRows = getPlanRowsForCashFlow(transactionList, ownAccountIds);
  const byDate = aggregatePlanByDate(planRows);
  const cashFlow = buildCashFlowByMonth(byDate);
  renderCashFlowChart(cashFlow);
  renderCashFlowTable(cashFlow);

  const thisYearOwn = getThisYearActuals(transactionList, ownAccountIds);
  const thisYearVisible = getThisYearActualsVisible(transactionList);
  const byMonth = { income: new Array(12).fill(0), expense: new Array(12).fill(0), transfer: new Array(12).fill(0) };
  thisYearOwn.forEach((row) => {
    const d = getActualTargetDate(row);
    const m = parseInt(d.slice(5, 7), 10) - 1;
    if (m < 0 || m > 11) return;
    const type = (row.TRANSACTION_TYPE || "").toLowerCase();
    const amount = parseFloat(String(row.AMOUNT ?? "0")) || 0;
    if (type === "income") byMonth.income[m] += amount;
    else if (type === "expense") byMonth.expense[m] += amount;
    else if (type === "transfer") byMonth.transfer[m] += amount;
  });
  renderTypeCharts(byMonth);
  renderTypeTable(byMonth);

  const byCategoryMonth = {
    expense: new Map<string, number[]>(),
    income: new Map<string, number[]>(),
    transfer: new Map<string, number[]>(),
  };
  const categoryTotals = { expense: new Map<string, number>(), income: new Map<string, number>(), transfer: new Map<string, number>() };
  ([["expense", "expense"], ["income", "income"], ["transfer", "transfer"]] as const).forEach(([typeKey, typeVal]) => {
    thisYearOwn.filter((r) => (r.TRANSACTION_TYPE || "").toLowerCase() === typeVal).forEach((row) => {
      const catId = (row.CATEGORY_ID || "").trim() || "—";
      const d = getActualTargetDate(row);
      const m = parseInt(d.slice(5, 7), 10) - 1;
      if (m < 0 || m > 11) return;
      const amount = parseFloat(String(row.AMOUNT ?? "0")) || 0;
      if (!byCategoryMonth[typeKey].has(catId)) byCategoryMonth[typeKey].set(catId, new Array(12).fill(0));
      byCategoryMonth[typeKey].get(catId)![m] += amount;
      categoryTotals[typeKey].set(catId, (categoryTotals[typeKey].get(catId) ?? 0) + amount);
    });
  });
  const getCategoryName = (id: string) => (id === "—" ? "—" : getCategoryById(id)?.CATEGORY_NAME ?? id);
  const getCategoryIcon = (id: string) => {
    const cat = id === "—" ? null : getCategoryById(id);
    return createIconWrap(cat?.COLOR || ICON_DEFAULT_COLOR, cat?.ICON_PATH, { tag: "span" });
  };
  renderCategoryCharts(byCategoryMonth, getCategoryName);
  const categoryTab = document.querySelector(".transaction-analysis-tab[data-analysis-category-tab].is-active") as HTMLButtonElement | undefined;
  renderCategoryTable(byCategoryMonth, (categoryTab?.dataset.analysisCategoryTab as "expense" | "income" | "transfer") || "expense", getCategoryName);
  renderCategoryRatioTables(categoryTotals, getCategoryName, getCategoryIcon);

  const byAccountMonth = new Map<string, number[]>();
  thisYearVisible.forEach((row) => {
    const inId = (row.ACCOUNT_ID_IN || "").trim();
    const outId = (row.ACCOUNT_ID_OUT || "").trim();
    const amount = parseFloat(String(row.AMOUNT ?? "0")) || 0;
    const d = getActualTargetDate(row);
    const m = parseInt(d.slice(5, 7), 10) - 1;
    if (m < 0 || m > 11) return;
    const type = (row.TRANSACTION_TYPE || "").toLowerCase();
    if (inId) {
      if (!byAccountMonth.has(inId)) byAccountMonth.set(inId, new Array(12).fill(0));
      if (type === "income" || type === "transfer") byAccountMonth.get(inId)![m] += amount;
      if (type === "transfer" && outId) {
        if (!byAccountMonth.has(outId)) byAccountMonth.set(outId, new Array(12).fill(0));
        byAccountMonth.get(outId)![m] -= amount;
      }
    }
    if (outId && type === "expense") {
      if (!byAccountMonth.has(outId)) byAccountMonth.set(outId, new Array(12).fill(0));
      byAccountMonth.get(outId)![m] -= amount;
    }
  });
  const getAccountName = (id: string) => getAccountById(id)?.ACCOUNT_NAME ?? id;
  renderAccountChart(byAccountMonth, getAccountName);
  renderAccountTable(byAccountMonth, getAccountName);
}

function loadAndShowAnalysis(forceReloadFromCsv = false): void {
  loadTransactionData(forceReloadFromCsv).then(() => {
    loadAndRender();
  });
}

export function initTransactionAnalysisView(): void {
  registerViewHandler("transaction-analysis", () => loadAndShowAnalysis());
  registerRefreshHandler("transaction-analysis", () => loadAndShowAnalysis(true));

  document.querySelectorAll(".transaction-analysis-tab[data-analysis-category-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".transaction-analysis-tab[data-analysis-category-tab]").forEach((b) => {
        b.classList.remove("is-active");
        b.setAttribute("aria-selected", "false");
      });
      btn.classList.add("is-active");
      btn.setAttribute("aria-selected", "true");
      const tab = (btn as HTMLButtonElement).dataset.analysisCategoryTab as "expense" | "income" | "transfer";
      const thead = document.getElementById("transaction-analysis-category-thead");
      const tbody = document.getElementById("transaction-analysis-category-tbody");
      if (thead && tbody) {
        const ownAccountIds = getOwnAccountIds();
        const thisYearOwn = getThisYearActuals(transactionList, ownAccountIds);
        const byCategoryMonth = {
          expense: new Map<string, number[]>(),
          income: new Map<string, number[]>(),
          transfer: new Map<string, number[]>(),
        };
        (["expense", "income", "transfer"] as const).forEach((typeKey) => {
          thisYearOwn.filter((r) => (r.TRANSACTION_TYPE || "").toLowerCase() === typeKey).forEach((row) => {
            const catId = (row.CATEGORY_ID || "").trim() || "—";
            const d = getActualTargetDate(row);
            const m = parseInt(d.slice(5, 7), 10) - 1;
            if (m < 0 || m > 11) return;
            const amount = parseFloat(String(row.AMOUNT ?? "0")) || 0;
            if (!byCategoryMonth[typeKey].has(catId)) byCategoryMonth[typeKey].set(catId, new Array(12).fill(0));
            byCategoryMonth[typeKey].get(catId)![m] += amount;
          });
        });
        const getCategoryName = (id: string) => (id === "—" ? "—" : getCategoryById(id)?.CATEGORY_NAME ?? id);
        renderCategoryTable(byCategoryMonth, tab, getCategoryName);
      }
    });
  });

  setDisplayedKeys(["TRANSACTION", "ACCOUNT", "ACCOUNT_PERMISSION", "CATEGORY", "TAG", "TRANSACTION_TAG", "TRANSACTION_MANAGEMENT"]);
}
