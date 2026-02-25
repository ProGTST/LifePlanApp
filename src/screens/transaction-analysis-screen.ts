/**
 * 収支分析ビュー：資金繰りグラフ/表、収支種別・カテゴリ・勘定のグラフと表を表示する。
 */
import type { TransactionRow } from "../types";
import { transactionList, currentUserId } from "../state";
import { registerViewHandler, registerRefreshHandler } from "../app/screen";
import { loadTransactionData, getAccountRows, getCategoryById, getAccountById, getActualTransactionsForPlan } from "../utils/transactionDataSync";
import { setDisplayedKeys } from "../utils/csvWatch";
import { getPlanOccurrenceDates } from "../utils/planOccurrence";
import { Chart, registerables } from "chart.js";
import type { ChartOptions } from "chart.js";
import ChartDataLabels from "chartjs-plugin-datalabels";
import { createIconWrap } from "../utils/iconWrap";
import { ICON_DEFAULT_COLOR } from "../constants/colorPresets";

/** ドーナツ中心の白円と合計金額ラベル描画用プラグイン（カレンダーと同様）。 */
const centerLabelAndHolePlugin = {
  id: "centerLabelAndHole",
  afterDraw(chart: Chart) {
    const centerOpts = (chart.options.plugins as Record<string, { label?: string; total?: number }> | undefined)
      ?.centerLabel;
    if (centerOpts?.total === undefined && !centerOpts?.label) return;
    const meta = chart.getDatasetMeta(0);
    if (!meta?.data?.length) return;
    const arc = meta.data[0] as unknown as { x: number; y: number; innerRadius: number };
    const ctx = chart.ctx;
    const x = arc.x;
    const y = arc.y;
    const r = arc.innerRadius;
    // 中心に白円を描画
    if (r > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.restore();
    }
    // ラベルと合計金額を中心に描画
    const label = centerOpts?.label ?? "";
    const total = centerOpts?.total ?? 0;
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
};

Chart.register(...registerables, ChartDataLabels, centerLabelAndHolePlugin);

/** 月ラベル（1月〜12月）。グラフ・表の軸・ヘッダで共通利用。 */
const MONTH_LABELS = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];

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

/** 予定完了日（COMPLETED_PLANDATE）のカンマ区切り日付を Set にパース。 */
function parseCompletedPlanDates(completedPlanDate: string | undefined): Set<string> {
  const set = new Set<string>();
  if (!completedPlanDate || typeof completedPlanDate !== "string") return set;
  for (const s of completedPlanDate.split(",")) {
    const d = s.trim().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) set.add(d);
  }
  return set;
}

/** 予定の「未完了」発生日のみ返す（予定完了日・紐づく実績の取引日に含まれない日付）。 */
function getOpenOccurrenceDates(row: TransactionRow): string[] {
  const all = getPlanOccurrenceDates(row);
  const completedSet = parseCompletedPlanDates(row.COMPLETED_PLANDATE);
  const actualRows = getActualTransactionsForPlan(row.ID);
  const actualDates = new Set(actualRows.map((r) => getActualTargetDate(r)));
  // 完了日でも実績日でもない発生日のみ
  return all.filter((d) => !completedSet.has(d) && !actualDates.has(d));
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

/** 運転資金超過表用：取引中(planning)のみ、かつ予定完了日・紐づく実績の取引日に含まれない発生日が1件以上ある予定取引。 */
function getPlanRowsForFundsOverflow(list: TransactionRow[], ownAccountIds: Set<string>): TransactionRow[] {
  return list.filter((row) => {
    if ((row.PROJECT_TYPE || "").toLowerCase() !== "plan") return false;
    if ((row.DLT_FLG || "0") === "1") return false;
    if (!isRowOnlyOwnAccounts(row, ownAccountIds)) return false;
    const status = (row.PLAN_STATUS || "planning").toLowerCase();
    if (status !== "planning") return false;
    const type = (row.TRANSACTION_TYPE || "").toLowerCase();
    if (type === "transfer") return false;
    return getOpenOccurrenceDates(row).length > 0;
  });
}

/** 完了の予定取引から運転資金を計算する対象：未削除・個人勘定・計画中または完了（中止以外）・振替以外。 */
function getPlanRowsForCompletedFunds(list: TransactionRow[], ownAccountIds: Set<string>): TransactionRow[] {
  return list.filter((row) => {
    if ((row.PROJECT_TYPE || "").toLowerCase() !== "plan") return false;
    if ((row.DLT_FLG || "0") === "1") return false;
    if (!isRowOnlyOwnAccounts(row, ownAccountIds)) return false;
    const status = (row.PLAN_STATUS || "planning").toLowerCase();
    if (status === "canceled") return false;
    const type = (row.TRANSACTION_TYPE || "").toLowerCase();
    if (type === "transfer") return false;
    return true;
  });
}

type PlanFundsEvent = { date: string; type: "income" | "expense"; amount: number };

/**
 * 完了として扱う予定取引のイベントを構築する。
 * 発生日ごとの金額は「その発生日に紐づく実績取引」がある場合のみ実績金額で集計する（予定完了日のみの日は含めない）。
 */
function getCompletedPlanEvents(planRows: TransactionRow[]): PlanFundsEvent[] {
  const events: PlanFundsEvent[] = [];
  for (const row of planRows) {
    // 予定に紐づく実績を取引日キーでマップ化
    const actualRows = getActualTransactionsForPlan(row.ID);
    const actualByDate = new Map<string, TransactionRow>();
    for (const r of actualRows) {
      const d = getActualTargetDate(r).slice(0, 10);
      actualByDate.set(d, r);
    }
    const allDates = getPlanOccurrenceDates(row);

    // 発生日ごとに紐づく実績がある場合のみイベント追加
    for (const d of allDates) {
      const dateKey = d.slice(0, 10);
      const actualOnDate = actualByDate.get(dateKey);
      if (!actualOnDate) continue;

      const amount = parseFloat(String(actualOnDate.AMOUNT ?? "0")) || 0;
      const t = (actualOnDate.TRANSACTION_TYPE || "").toLowerCase();
      const type: "income" | "expense" = t === "income" ? "income" : "expense";
      events.push({ date: dateKey, type, amount });
    }
  }
  return events;
}

/** 完了の予定取引イベントを日付順（同一日は収入を先）で処理し、最終時点の運転資金を返す。 */
function getCompletedFunds(planRows: TransactionRow[]): number {
  const events = getCompletedPlanEvents(planRows);
  events.sort((a, b) => {
    const d = a.date.localeCompare(b.date);
    if (d !== 0) return d;
    return a.type === "income" ? -1 : 1;
  });
  let funds = 0;
  for (const e of events) {
    if (e.type === "income") funds += e.amount;
    else funds -= e.amount;
  }
  return funds;
}

/** 日付ごとの予定収入・予定支出を集計（同一日は収入を先に計算）。未完了の発生日のみ使用。返却は Map<YYYY-MM-DD, { income, expense }> */
function aggregatePlanByDate(rows: TransactionRow[]): Map<string, { income: number; expense: number }> {
  const byDate = new Map<string, { income: number; expense: number }>();
  const events: { date: string; type: "income" | "expense"; amount: number }[] = [];
  // 全予定の未完了発生日をイベント列に展開
  for (const row of rows) {
    const amount = parseFloat(String(row.AMOUNT ?? "0")) || 0;
    const type = (row.TRANSACTION_TYPE || "").toLowerCase() as "income" | "expense";
    const dates = getOpenOccurrenceDates(row);
    for (const d of dates) {
      events.push({ date: d.slice(0, 10), type: type === "income" ? "income" : "expense", amount });
    }
  }
  // 日付昇順・同一日は収入を先にソート
  events.sort((a, b) => {
    const d = a.date.localeCompare(b.date);
    if (d !== 0) return d;
    return a.type === "income" ? -1 : 1;
  });
  for (const e of events) {
    if (!byDate.has(e.date)) byDate.set(e.date, { income: 0, expense: 0 });
    const cur = byDate.get(e.date)!;
    if (e.type === "income") {
      cur.income += e.amount;
    } else {
      cur.expense += e.amount;
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
    // 当該月の日付のみ集計
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

/** 指定年の実績取引（未削除・個人勘定）。 */
function getActualsForYear(list: TransactionRow[], ownAccountIds: Set<string>, year: number): TransactionRow[] {
  const yStr = String(year);
  return list.filter((row) => {
    if ((row.PROJECT_TYPE || "").toLowerCase() !== "actual") return false;
    if ((row.DLT_FLG || "0") === "1") return false;
    if (!isRowOnlyOwnAccounts(row, ownAccountIds)) return false;
    const d = getActualTargetDate(row);
    return d.slice(0, 4) === yStr && d.length >= 7;
  });
}
/** 参照可能な勘定の指定年の実績（未削除）。 */
function getActualsVisibleForYear(list: TransactionRow[], year: number): TransactionRow[] {
  const yStr = String(year);
  return list.filter((row) => {
    if ((row.PROJECT_TYPE || "").toLowerCase() !== "actual") return false;
    if ((row.DLT_FLG || "0") === "1") return false;
    const d = getActualTargetDate(row);
    return d.slice(0, 4) === yStr && d.length >= 7;
  });
}

/** YYYY-MM を「yyyy年M月」に変換（資金繰りグラフ・表の表示用）。 */
function formatMonthLabel(ym: string): string {
  const [y, m] = ym.split("-");
  if (!y || !m) return ym;
  return `${y}年${parseInt(m, 10)}月`;
}

/** 指定年の実績から収支種別ごとの月別金額（1〜12月）を集計する。 */
function buildByMonthFromActuals(rows: TransactionRow[]): { income: number[]; expense: number[]; transfer: number[] } {
  const byMonth = { income: new Array(12).fill(0), expense: new Array(12).fill(0), transfer: new Array(12).fill(0) };
  for (const row of rows) {
    const d = getActualTargetDate(row);
    const m = parseInt(d.slice(5, 7), 10) - 1;
    if (m < 0 || m > 11) continue;
    const type = (row.TRANSACTION_TYPE || "").toLowerCase();
    const amount = parseFloat(String(row.AMOUNT ?? "0")) || 0;
    if (type === "income") byMonth.income[m] += amount;
    else if (type === "expense") byMonth.expense[m] += amount;
    else if (type === "transfer") byMonth.transfer[m] += amount;
  }
  return byMonth;
}

/** 指定年の実績からカテゴリ別月別金額と種別別合計を集計する。 */
function buildByCategoryMonthAndTotals(rows: TransactionRow[]): {
  byCategoryMonth: { expense: Map<string, number[]>; income: Map<string, number[]>; transfer: Map<string, number[]> };
  categoryTotals: { expense: Map<string, number>; income: Map<string, number>; transfer: Map<string, number> };
} {
  const byCategoryMonth = {
    expense: new Map<string, number[]>(),
    income: new Map<string, number[]>(),
    transfer: new Map<string, number[]>(),
  };
  const categoryTotals = {
    expense: new Map<string, number>(),
    income: new Map<string, number>(),
    transfer: new Map<string, number>(),
  };
  const typeKeys = ["expense", "income", "transfer"] as const;
  // 収支種別ごとにカテゴリ別月別と合計を集計
  for (const typeKey of typeKeys) {
    const typeVal = typeKey;
    for (const row of rows.filter((r) => (r.TRANSACTION_TYPE || "").toLowerCase() === typeVal)) {
      const catId = (row.CATEGORY_ID || "").trim() || "—";
      const d = getActualTargetDate(row);
      const m = parseInt(d.slice(5, 7), 10) - 1;
      if (m < 0 || m > 11) continue;
      const amount = parseFloat(String(row.AMOUNT ?? "0")) || 0;
      if (!byCategoryMonth[typeKey].has(catId)) byCategoryMonth[typeKey].set(catId, new Array(12).fill(0));
      byCategoryMonth[typeKey].get(catId)![m] += amount;
      categoryTotals[typeKey].set(catId, (categoryTotals[typeKey].get(catId) ?? 0) + amount);
    }
  }
  return { byCategoryMonth, categoryTotals };
}

/** 参照可能な実績から勘定別月別残高変動（入金・出金）を集計する。 */
function buildByAccountMonthFromActuals(rows: TransactionRow[]): Map<string, number[]> {
  const byAccountMonth = new Map<string, number[]>();
  for (const row of rows) {
    const inId = (row.ACCOUNT_ID_IN || "").trim();
    const outId = (row.ACCOUNT_ID_OUT || "").trim();
    const amount = parseFloat(String(row.AMOUNT ?? "0")) || 0;
    const d = getActualTargetDate(row);
    const m = parseInt(d.slice(5, 7), 10) - 1;
    if (m < 0 || m > 11) continue;
    const type = (row.TRANSACTION_TYPE || "").toLowerCase();
    // 入金勘定: 収入・振替入
    if (inId) {
      if (!byAccountMonth.has(inId)) byAccountMonth.set(inId, new Array(12).fill(0));
      if (type === "income" || type === "transfer") byAccountMonth.get(inId)![m] += amount;
      if (type === "transfer" && outId) {
        if (!byAccountMonth.has(outId)) byAccountMonth.set(outId, new Array(12).fill(0));
        byAccountMonth.get(outId)![m] -= amount;
      }
    }
    // 出金勘定: 支出
    if (outId && type === "expense") {
      if (!byAccountMonth.has(outId)) byAccountMonth.set(outId, new Array(12).fill(0));
      byAccountMonth.get(outId)![m] -= amount;
    }
  }
  return byAccountMonth;
}

/** 収支分析で表示する年（グラフ・表の抽出条件）。 */
let analysisYear = new Date().getFullYear();

let chartInstances: unknown[] = [];

/** カテゴリタブ切替時に再描画するためのキャッシュ（loadAndRender で設定）。 */
let cachedByCategoryMonth: { expense: Map<string, number[]>; income: Map<string, number[]>; transfer: Map<string, number[]> } | null = null;
let cachedGetCategoryName: ((id: string) => string) | null = null;
let cachedGetCategoryIcon: ((id: string) => HTMLElement) | null = null;

function destroyCharts(): void {
  chartInstances.forEach((c) => (c as { destroy(): void }).destroy());
  chartInstances = [];
}

function renderCashFlowChart(cashFlow: { month: string; income: number; expense: number; balance: number; funds: number; rate: number | null }[]): void {
  const canvas = document.getElementById("transaction-analysis-cashflow-chart") as HTMLCanvasElement | null;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const labels = cashFlow.map((r) => formatMonthLabel(r.month));
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
        y: { beginAtZero: true, title: { display: false } },
        x: { title: { display: false } },
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
  // 月ごとの列ヘッダを追加
  cashFlow.forEach((r) => {
    const th = document.createElement("th");
    th.textContent = formatMonthLabel(r.month);
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  // 行ラベルと月別の値を1行ずつ追加
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

/** 運転資金超過となる支出予定の一覧を取得。同一日は収入を先に計算し、支出時点で 金額 > 運転資金 となる支出を列挙。未完了の発生日のみ使用。計算開始金額は完了の予定取引から求めた運転資金。 */
function getFundsOverflowExpenses(
  planRows: TransactionRow[],
  initialFunds: number
): { date: string; row: TransactionRow; amount: number; fundsAtDate: number; fundsAfterExpense: number; monthsFromNow: number }[] {
  const events: { date: string; type: "income" | "expense"; amount: number; row?: TransactionRow }[] = [];
  // 未完了発生日ごとに収支イベントを列挙（支出のみ row を保持）
  for (const row of planRows) {
    const amount = parseFloat(String(row.AMOUNT ?? "0")) || 0;
    const type = (row.TRANSACTION_TYPE || "").toLowerCase() as "income" | "expense";
    const dates = getOpenOccurrenceDates(row);
    for (const d of dates) {
      events.push({
        date: d.slice(0, 10),
        type: type === "income" ? "income" : "expense",
        amount,
        row: type === "expense" ? row : undefined,
      });
    }
  }
  events.sort((a, b) => {
    const d = a.date.localeCompare(b.date);
    if (d !== 0) return d;
    return a.type === "income" ? -1 : 1;
  });
  const now = new Date();
  const currY = now.getFullYear();
  const currM = now.getMonth() + 1;
  let funds = initialFunds;
  const overflow: { date: string; row: TransactionRow; amount: number; fundsAtDate: number; fundsAfterExpense: number; monthsFromNow: number }[] = [];
  for (const e of events) {
    if (e.type === "income") {
      funds += e.amount;
    } else {
      // 支出時点で運転資金を超過する場合のみ overflow に追加
      if (e.row && e.amount > funds) {
        const [y, m] = e.date.slice(0, 7).split("-").map(Number);
        const monthsFromNow = Math.max(1, (y - currY) * 12 + (m - currM));
        const fundsAfter = funds - e.amount;
        overflow.push({ date: e.date, row: e.row, amount: e.amount, fundsAtDate: funds, fundsAfterExpense: fundsAfter, monthsFromNow });
      }
      funds -= e.amount;
    }
  }
  return overflow;
}

/** 運転資金超過となる支出予定表と合計・毎月の積立額を描画。 */
function renderFundsOverflowTable(
  overflow: { date: string; row: TransactionRow; amount: number; fundsAtDate: number; fundsAfterExpense: number; monthsFromNow: number }[],
  initialFunds: number,
  getCategoryName: (id: string) => string,
  getCategoryIcon: (id: string) => HTMLElement
): void {
  const tbody = document.getElementById("transaction-analysis-funds-overflow-tbody");
  const summaryEl = document.getElementById("transaction-analysis-funds-overflow-summary");
  if (!tbody) return;
  tbody.innerHTML = "";
  // 超過行ごとに表の行を追加
  overflow.forEach(({ date, row, amount, fundsAtDate, fundsAfterExpense, monthsFromNow }) => {
    const shortfall = Math.max(0, amount - fundsAtDate);
    const monthlyRequired = monthsFromNow > 0 ? Math.round(shortfall / monthsFromNow) : shortfall;
    const tr = document.createElement("tr");
    const dateTd = document.createElement("td");
    dateTd.textContent = date;
    const catTd = document.createElement("td");
    catTd.style.display = "flex";
    catTd.style.alignItems = "center";
    catTd.style.gap = "0.5rem";
    const catId = (row.CATEGORY_ID || "").trim() || "—";
    catTd.appendChild(getCategoryIcon(catId));
    catTd.appendChild(document.createTextNode(getCategoryName(catId) || catId));
    const nameTd = document.createElement("td");
    nameTd.textContent = (row.NAME || "").trim() || "—";
    const amountTd = document.createElement("td");
    amountTd.textContent = amount.toLocaleString();
    amountTd.style.textAlign = "right";
    const fundsTd = document.createElement("td");
    fundsTd.textContent = fundsAfterExpense.toLocaleString();
    fundsTd.style.textAlign = "right";
    const monthsLeftTd = document.createElement("td");
    monthsLeftTd.textContent = String(monthsFromNow);
    monthsLeftTd.style.textAlign = "right";
    const monthlyTd = document.createElement("td");
    monthlyTd.textContent = monthlyRequired.toLocaleString();
    monthlyTd.style.textAlign = "right";
    tr.appendChild(dateTd);
    tr.appendChild(catTd);
    tr.appendChild(nameTd);
    tr.appendChild(amountTd);
    tr.appendChild(fundsTd);
    tr.appendChild(monthsLeftTd);
    tr.appendChild(monthlyTd);
    tbody.appendChild(tr);
  });
  const total = overflow.reduce((s, { amount }) => s + amount, 0);
  const lastItem = overflow[overflow.length - 1];
  let months = 1;
  if (lastItem) {
    months = lastItem.monthsFromNow;
  }
  const monthly = months > 0 ? Math.round(total / months) : 0;
  if (summaryEl) {
    const fundsText = `予定完了分の運転資金: ${initialFunds.toLocaleString()}円`;
    if (overflow.length === 0) {
      // 超過なし
      summaryEl.textContent = `${fundsText} 運転資金を超過する予定支出はありません。`;
    } else {
      // 超過あり：合計と毎月積立額を表示
      summaryEl.textContent = `${fundsText} 合計金額: ${total.toLocaleString()}円 毎月の積立額: ${monthly.toLocaleString()}円（現在から最終取引発生日まで${months}ヶ月）`;
    }
  }
}

/** 収支記録・収支履歴の収支種別と同じ色（支出・収入・振替） */
const TYPE_CHART_COLORS = {
  expense: "rgba(198, 40, 40, 0.7)",
  income: "rgba(46, 125, 50, 0.7)",
  transfer: "rgba(69, 90, 100, 0.7)",
} as const;

function renderTypeCharts(
  byMonth: { income: number[]; expense: number[]; transfer: number[] }
): void {
  const opts = { responsive: true, scales: { y: { beginAtZero: true }, x: {} } };
  const ids = ["transaction-analysis-type-expense-chart", "transaction-analysis-type-income-chart", "transaction-analysis-type-transfer-chart"] as const;
  const keys = ["expense", "income", "transfer"] as const;
  const labels = ["支出", "収入", "振替"] as const;
  const data = [byMonth.expense, byMonth.income, byMonth.transfer] as const;
  ids.forEach((id, i) => {
    const canvas = document.getElementById(id) as HTMLCanvasElement | null;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const chart = new Chart(ctx, {
      type: "bar",
      data: {
        labels: MONTH_LABELS,
        datasets: [{ label: labels[i], data: data[i], backgroundColor: TYPE_CHART_COLORS[keys[i]] }],
      },
      options: opts,
    });
    chartInstances.push(chart);
  });
}

/** 収支種別集計表の運転資金（折れ線）と残高（棒）を実績取引の資金繰りグラフに表示。 */
function renderActualCashFlowChart(byMonth: { income: number[]; expense: number[] }): void {
  const canvas = document.getElementById("transaction-analysis-actual-cashflow-chart") as HTMLCanvasElement | null;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  let funds = 0;
  const fundsData = MONTH_LABELS.map((_, i) => {
    const inc = byMonth.income[i] ?? 0;
    const exp = byMonth.expense[i] ?? 0;
    funds += inc - exp;
    return funds;
  });
  const balanceData = MONTH_LABELS.map((_, i) => (byMonth.income[i] ?? 0) - (byMonth.expense[i] ?? 0));
  const chart = new Chart(ctx, {
    type: "line",
    data: {
      labels: MONTH_LABELS,
      datasets: [
        { label: "運転資金", data: fundsData, type: "line", borderColor: "#1d4ed8", backgroundColor: "rgba(29, 78, 216, 0.1)", fill: true, tension: 0.2, order: 1 },
        { label: "残高", data: balanceData, type: "bar", backgroundColor: "rgba(34, 197, 94, 0.6)", order: 2 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      scales: {
        y: { beginAtZero: true, title: { display: false } },
        x: { title: { display: false } },
      },
    },
  });
  chartInstances.push(chart);
}

function renderTypeTable(byMonth: { income: number[]; expense: number[]; transfer: number[] }): void {
  const thead = document.getElementById("transaction-analysis-type-thead");
  const tbody = document.getElementById("transaction-analysis-type-tbody");
  if (!thead || !tbody) return;
  thead.innerHTML = "";
  tbody.innerHTML = "";
  const headerRow = document.createElement("tr");
  headerRow.innerHTML = "<th>項目</th>";
  MONTH_LABELS.forEach((m) => {
    const th = document.createElement("th");
    th.textContent = m;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  let funds = 0;
  const balanceByMonth = MONTH_LABELS.map((_, i) => {
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
      data: { labels: MONTH_LABELS, datasets },
      options: { responsive: true, scales: { y: { beginAtZero: true }, x: {} } },
    });
    chartInstances.push(chart);
  });
}

function renderCategoryTable(
  byCategoryMonth: { expense: Map<string, number[]>; income: Map<string, number[]>; transfer: Map<string, number[]> },
  activeTab: "expense" | "income" | "transfer",
  getCategoryName: (id: string) => string,
  getCategoryIcon: (id: string) => HTMLElement
): void {
  const thead = document.getElementById("transaction-analysis-category-thead");
  const tbody = document.getElementById("transaction-analysis-category-tbody");
  if (!thead || !tbody) return;
  thead.innerHTML = "";
  tbody.innerHTML = "";
  const headerRow = document.createElement("tr");
  headerRow.innerHTML = "<th>カテゴリー</th>";
  MONTH_LABELS.forEach((m) => {
    const th = document.createElement("th");
    th.textContent = m;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  const map = byCategoryMonth[activeTab];
  map.forEach((values, catId) => {
    const tr = document.createElement("tr");
    const categoryTd = document.createElement("td");
    categoryTd.style.display = "flex";
    categoryTd.style.alignItems = "center";
    categoryTd.style.gap = "0.5rem";
    categoryTd.appendChild(getCategoryIcon(catId));
    categoryTd.appendChild(document.createTextNode(getCategoryName(catId) || catId));
    tr.appendChild(categoryTd);
    values.forEach((v) => {
      const td = document.createElement("td");
      td.textContent = v.toLocaleString();
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}

/** カテゴリーごとの割合を円グラフで表示（支出・収入・振替の3つ）。スライド色はカテゴリーのCOLOR、円内に%を表示。中心は白円＋合計金額。 */
function renderCategoryRatioCharts(
  totals: { expense: Map<string, number>; income: Map<string, number>; transfer: Map<string, number> },
  getCategoryName: (id: string) => string
): void {
  const ids = ["transaction-analysis-ratio-expense-chart", "transaction-analysis-ratio-income-chart", "transaction-analysis-ratio-transfer-chart"] as const;
  const keys = ["expense", "income", "transfer"] as const;
  keys.forEach((key, idx) => {
    const canvas = document.getElementById(ids[idx]) as HTMLCanvasElement | null;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const map = totals[key];
    const entries = Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
    const labels = entries.length > 0 ? entries.map(([catId]) => getCategoryName(catId) || catId) : ["データなし"];
    const data = entries.length > 0 ? entries.map(([, amount]) => amount) : [1];
    const total = entries.length > 0 ? entries.reduce((s, [, amount]) => s + amount, 0) : 0;
    const backgroundColor =
      entries.length > 0
        ? entries.map(([catId]) => (getCategoryById(catId)?.COLOR || ICON_DEFAULT_COLOR).trim() || ICON_DEFAULT_COLOR)
        : ["#e0e0e0"];
    const chart = new Chart(ctx, {
      type: "doughnut",
      data: { labels, datasets: [{ data, backgroundColor }] },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        cutout: "55%",
        plugins: {
          legend: { position: "bottom" },
          centerLabel: { label: "合計", total },
          datalabels: {
            formatter: (value: number) => {
              const sum = data.reduce((a, b) => a + b, 0);
              const pct = sum ? Math.round((value / sum) * 100) : 0;
              return `${pct}%`;
            },
            color: "#fff",
            font: { size: 12, weight: "bold" },
          },
        },
      } as ChartOptions<"doughnut">,
    });
    chartInstances.push(chart);
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
  const datasets = Array.from(byAccountMonth.entries()).map(([accId, values]) => {
    const color = (getAccountById(accId)?.COLOR || ICON_DEFAULT_COLOR).trim() || ICON_DEFAULT_COLOR;
    const bgColor = /^#[0-9A-Fa-f]{6}$/.test(color) ? `${color}99` : color;
    return {
      label: getAccountName(accId) || accId,
      data: values,
      backgroundColor: bgColor,
    };
  });
  const chart = new Chart(ctx, {
    type: "bar",
    data: { labels: MONTH_LABELS, datasets },
    options: { responsive: true, scales: { y: { beginAtZero: true }, x: {} } },
  });
  chartInstances.push(chart);
}

function renderAccountTable(
  byAccountMonth: Map<string, number[]>,
  getAccountName: (id: string) => string,
  getAccountIcon: (id: string) => HTMLElement
): void {
  const thead = document.getElementById("transaction-analysis-account-thead");
  const tbody = document.getElementById("transaction-analysis-account-tbody");
  if (!thead || !tbody) return;
  thead.innerHTML = "";
  tbody.innerHTML = "";
  const headerRow = document.createElement("tr");
  headerRow.innerHTML = "<th>勘定項目</th>";
  MONTH_LABELS.forEach((m) => {
    const th = document.createElement("th");
    th.textContent = m;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  byAccountMonth.forEach((values, accId) => {
    const tr = document.createElement("tr");
    const accountTd = document.createElement("td");
    accountTd.style.display = "flex";
    accountTd.style.alignItems = "center";
    accountTd.style.gap = "0.5rem";
    accountTd.appendChild(getAccountIcon(accId));
    accountTd.appendChild(document.createTextNode(getAccountName(accId) || accId));
    tr.appendChild(accountTd);
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

  // 資金繰り: 予定の未完了発生日で月別集計しグラフ・表を描画
  const planRowsForCashFlow = getPlanRowsForCashFlow(transactionList, ownAccountIds).filter(
    (row) => getOpenOccurrenceDates(row).length > 0
  );
  const byDate = aggregatePlanByDate(planRowsForCashFlow);
  const cashFlow = buildCashFlowByMonth(byDate);
  renderCashFlowChart(cashFlow);
  renderCashFlowTable(cashFlow);

  const yearActualsOwn = getActualsForYear(transactionList, ownAccountIds, analysisYear);
  const yearActualsVisible = getActualsVisibleForYear(transactionList, analysisYear);

  // 収支種別（収入・支出・振替）の月別集計と描画
  const byMonth = buildByMonthFromActuals(yearActualsOwn);
  renderTypeCharts(byMonth);
  renderActualCashFlowChart(byMonth);
  renderTypeTable(byMonth);

  // カテゴリ別月別集計と種別別合計（共通関数で一括算出）
  const { byCategoryMonth, categoryTotals } = buildByCategoryMonthAndTotals(yearActualsOwn);
  const getCategoryName = (id: string) => (id === "—" ? "—" : getCategoryById(id)?.CATEGORY_NAME ?? id);
  const getCategoryIcon = (id: string) => {
    const cat = id === "—" ? null : getCategoryById(id);
    return createIconWrap(cat?.COLOR || ICON_DEFAULT_COLOR, cat?.ICON_PATH, { tag: "span" });
  };
  cachedByCategoryMonth = byCategoryMonth;
  cachedGetCategoryName = getCategoryName;
  cachedGetCategoryIcon = getCategoryIcon;

  // 運転資金超過: 完了分の運転資金を初期値に未完了予定を時系列でシミュレート
  const fundsOverflowPlanRows = getPlanRowsForFundsOverflow(transactionList, ownAccountIds);
  const completedFundsPlanRows = getPlanRowsForCompletedFunds(transactionList, ownAccountIds);
  const initialFunds = getCompletedFunds(completedFundsPlanRows);
  const fundsOverflow = getFundsOverflowExpenses(fundsOverflowPlanRows, initialFunds);
  renderFundsOverflowTable(fundsOverflow, initialFunds, getCategoryName, getCategoryIcon);
  renderCategoryCharts(byCategoryMonth, getCategoryName);
  const categoryTab = document.querySelector(".transaction-analysis-tab[data-analysis-category-tab].is-active") as HTMLButtonElement | undefined;
  renderCategoryTable(byCategoryMonth, (categoryTab?.dataset.analysisCategoryTab as "expense" | "income" | "transfer") || "expense", getCategoryName, getCategoryIcon);
  renderCategoryRatioCharts(categoryTotals, getCategoryName);
  renderCategoryRatioTables(categoryTotals, getCategoryName, getCategoryIcon);

  // 勘定別: 参照可能な実績で勘定別月別を集計しグラフ・表を描画
  const byAccountMonth = buildByAccountMonthFromActuals(yearActualsVisible);
  const getAccountName = (id: string) => getAccountById(id)?.ACCOUNT_NAME ?? id;
  const getAccountIcon = (id: string) => {
    const acc = getAccountById(id);
    return createIconWrap(acc?.COLOR || ICON_DEFAULT_COLOR, acc?.ICON_PATH, { tag: "span" });
  };
  renderAccountChart(byAccountMonth, getAccountName);
  renderAccountTable(byAccountMonth, getAccountName, getAccountIcon);

  const yearLabel = document.getElementById("analysis-year-label");
  if (yearLabel) yearLabel.textContent = `${analysisYear}年`;
}

function loadAndShowAnalysis(forceReloadFromCsv = false): void {
  loadTransactionData(forceReloadFromCsv).then(() => {
    loadAndRender();
  });
}

export function initTransactionAnalysisView(): void {
  registerViewHandler("transaction-analysis", () => loadAndShowAnalysis());
  registerRefreshHandler("transaction-analysis", () => loadAndShowAnalysis(true));

  // 表示年の前年・翌年ボタン
  const prevBtn = document.getElementById("analysis-year-prev");
  const nextBtn = document.getElementById("analysis-year-next");
  if (prevBtn) {
    prevBtn.addEventListener("click", () => {
      analysisYear -= 1;
      loadAndRender();
    });
  }
  if (nextBtn) {
    nextBtn.addEventListener("click", () => {
      analysisYear += 1;
      loadAndRender();
    });
  }

  // カテゴリタブ切替: キャッシュを使って表のみ再描画
  document.querySelectorAll(".transaction-analysis-tab[data-analysis-category-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".transaction-analysis-tab[data-analysis-category-tab]").forEach((b) => {
        b.classList.remove("is-active");
        b.setAttribute("aria-selected", "false");
      });
      btn.classList.add("is-active");
      btn.setAttribute("aria-selected", "true");
      const tab = (btn as HTMLButtonElement).dataset.analysisCategoryTab as "expense" | "income" | "transfer";
      // キャッシュ済みのカテゴリ集計と表示用関数で再描画のみ行う
      if (cachedByCategoryMonth && cachedGetCategoryName && cachedGetCategoryIcon) {
        renderCategoryTable(cachedByCategoryMonth, tab, cachedGetCategoryName, cachedGetCategoryIcon);
      }
    });
  });

  setDisplayedKeys("transaction-analysis", ["TRANSACTION", "ACCOUNT", "ACCOUNT_PERMISSION", "CATEGORY", "TAG", "TRANSACTION_TAG", "TRANSACTION_MANAGEMENT"]);
}
