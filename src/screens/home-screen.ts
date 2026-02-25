import { invoke } from "@tauri-apps/api/core";
import type { UserRow, TransactionRow, AccountRow } from "../types.ts";
import { currentUserId, transactionList, setTransactionEntryEditId, setTransactionEntryViewOnly, setTransactionEntryReturnView, pushNavigation } from "../state";
import { fetchCsv, rowToObject } from "../utils/csv";
import { registerViewHandler, registerRefreshHandler, showMainView } from "../app/screen";
import { updateCurrentMenuItem } from "../app/sidebar";
import { PROFILE_ICON_DEFAULT_COLOR } from "../constants/colorPresets.ts";
import { loadTransactionData, getAccountRows, getActualTransactionsForPlan, getCategoryById, getPermissionRows, getActualIdsForPlanId, getRowPermissionType } from "../utils/transactionDataSync";
import { createIconWrap } from "../utils/iconWrap";
import { getPlanOccurrenceDates, hasDelayedPlanDates } from "../utils/planOccurrence";
import { Chart, registerables } from "chart.js";
import type { ChartOptions } from "chart.js";
import ChartDataLabels from "chartjs-plugin-datalabels";
import { ICON_DEFAULT_COLOR } from "../constants/colorPresets";

const PROFILE_NAME_LENGTH = 4;

/** 参照可能な勘定を個人・権限付与・全体に分けて返す */
function getVisibleAccountsForBalance(): {
  personal: AccountRow[];
  permissionGranted: AccountRow[];
  all: AccountRow[];
} {
  const me = (currentUserId || "").trim();
  const accountRows = getAccountRows();
  const permissionRows = getPermissionRows();
  const personal = accountRows.filter((a) => (a.USER_ID || "").trim() === me);
  const permittedIds = new Set(
    permissionRows.filter((p) => (p.USER_ID || "").trim() === me).map((p) => (p.ACCOUNT_ID || "").trim())
  );
  const permissionGranted = accountRows.filter(
    (a) => permittedIds.has(a.ID) && (a.USER_ID || "").trim() !== me
  );
  const allIds = new Set([...personal.map((a) => a.ID), ...permissionGranted.map((a) => a.ID)]);
  const all = accountRows.filter((a) => allIds.has(a.ID));
  return { personal, permissionGranted, all };
}

function parseBalance(row: AccountRow): number {
  const s = (row.BALANCE ?? "0").trim();
  const n = parseFloat(s);
  return Number.isNaN(n) ? 0 : n;
}

/** ドーナツ中心の白円と合計金額ラベル描画用プラグイン */
const centerLabelAndHolePlugin = {
  id: "centerLabelAndHole",
  afterDraw(chart: Chart) {
    const centerOpts = (chart.options.plugins as Record<string, { label?: string; total?: number }> | undefined)
      ?.centerLabel;
    if (centerOpts?.total === undefined && centerOpts?.label === undefined) return;
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

let homeChartJsRegistered = false;

/** 今月/今週の集計結果 */
type RangeSummary = {
  plannedIncome: number;
  plannedExpense: number;
  actualIncomeFromPlan: number;
  actualExpenseFromPlan: number;
  actualIncomeOnly: number;
  actualExpenseOnly: number;
};

function getDisplayNameAbbr(name: string): string {
  const t = (name ?? "").trim();
  if (!t) return "";
  return t.slice(0, PROFILE_NAME_LENGTH);
}

async function fetchUserList(noCache = false): Promise<UserRow[]> {
  const init = noCache ? { cache: "reload" as RequestCache } : undefined;
  const { header, rows } = await fetchCsv("/data/USER.csv", init);
  if (header.length === 0) return [];
  const list: UserRow[] = [];
  for (const cells of rows) {
    const row = rowToObject(header, cells) as unknown as UserRow;
    list.push(row);
  }
  return list;
}

async function renderHeaderProfile(forceReloadFromCsv = false): Promise<void> {
  const iconEl = document.getElementById("header-profile-icon");
  const nameEl = document.getElementById("header-profile-name");
  if (!iconEl || !nameEl) return;

  const userList = await fetchUserList(forceReloadFromCsv);
  const user = userList.find((r) => r.ID === currentUserId);
  const name = (user?.NAME ?? "").trim();
  const iconPath = (user?.ICON_PATH ?? "").trim();
  const bgColor = (user?.COLOR ?? "").trim() || PROFILE_ICON_DEFAULT_COLOR;

  nameEl.textContent = name || "ユーザー";
  iconEl.innerHTML = "";
  iconEl.removeAttribute("data-mode");
  iconEl.setAttribute("aria-hidden", "false");

  if (iconPath) {
    iconEl.setAttribute("data-mode", "image");
    const img = document.createElement("img");
    img.alt = "";
    img.className = "app-header-profile-icon-img";
    // Tauri 環境ではアイコンを base64 で取得、それ以外はパスをそのまま使用
    const isTauri = typeof (window as unknown as { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__?.invoke === "function";
    if (isTauri) {
      try {
        const dataUrl = await invoke<string>("get_profile_icon_base64", { iconPath });
        img.src = dataUrl && !dataUrl.startsWith("/") ? dataUrl : iconPath;
      } catch {
        img.src = iconPath;
      }
    } else {
      img.src = iconPath;
    }
    iconEl.appendChild(img);
  } else {
    iconEl.setAttribute("data-mode", "default");
    iconEl.style.backgroundColor = bgColor;
    iconEl.textContent = getDisplayNameAbbr(name);
  }
}

function getOwnAccountIds(): Set<string> {
  const ids = new Set<string>();
  const me = (currentUserId || "").trim();
  if (!me) return ids;
  getAccountRows()
    .filter((a) => (a.USER_ID || "").trim() === me)
    .forEach((a) => ids.add(a.ID));
  return ids;
}

function isRowOnlyOwnAccounts(row: TransactionRow, ownAccountIds: Set<string>): boolean {
  const inId = (row.ACCOUNT_ID_IN || "").trim();
  const outId = (row.ACCOUNT_ID_OUT || "").trim();
  if (inId && !ownAccountIds.has(inId)) return false;
  if (outId && !ownAccountIds.has(outId)) return false;
  return true;
}

function getActualTargetDate(row: TransactionRow): string {
  const from = (row.TRANDATE_FROM || "").trim().slice(0, 10);
  const to = (row.TRANDATE_TO || "").trim().slice(0, 10);
  return to || from || "";
}

/** 未削除・個人勘定の予定取引（振替は呼び出し側で除外可）。 */
function getPlanRowsForHome(list: TransactionRow[], ownAccountIds: Set<string>): TransactionRow[] {
  return list.filter((row) => {
    if ((row.PROJECT_TYPE || "").toLowerCase() !== "plan") return false;
    if ((row.DLT_FLG || "0") === "1") return false;
    if (!isRowOnlyOwnAccounts(row, ownAccountIds)) return false;
    return true;
  });
}

/** 指定範囲の未削除・個人勘定の実績取引。 */
function getActualRowsInRange(
  list: TransactionRow[],
  ownAccountIds: Set<string>,
  rangeStart: string,
  rangeEnd: string
): TransactionRow[] {
  return list.filter((row) => {
    if ((row.PROJECT_TYPE || "").toLowerCase() !== "actual") return false;
    if ((row.DLT_FLG || "0") === "1") return false;
    if (!isRowOnlyOwnAccounts(row, ownAccountIds)) return false;
    const d = getActualTargetDate(row).slice(0, 10);
    return d >= rangeStart && d <= rangeEnd;
  });
}

/** 今月の開始日・終了日（YYYY-MM-DD） */
function getMonthRange(): { start: string; end: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const lastDay = new Date(y, m, 0).getDate();
  const mm = String(m).padStart(2, "0");
  return {
    start: `${y}-${mm}-01`,
    end: `${y}-${mm}-${String(lastDay).padStart(2, "0")}`,
  };
}

/**
 * 今月の日ごとの累計収入・累計支出を計算する。
 * 対象: 未削除、個人の勘定、今月の取引日の実績取引、支出と収入のみ。
 */
function getMonthDailyCumulative(): {
  labels: string[];
  cumulativeIncome: number[];
  cumulativeExpense: number[];
} {
  const ownAccountIds = getOwnAccountIds();
  const { start: monthStart, end: monthEnd } = getMonthRange();
  const lastDay = parseInt(monthEnd.slice(8, 10), 10);
  const dailyIncome = new Array<number>(lastDay).fill(0);
  const dailyExpense = new Array<number>(lastDay).fill(0);

  const actualRows = getActualRowsInRange(transactionList, ownAccountIds, monthStart, monthEnd);

  // 日ごとの収入・支出を加算（収入・支出のみ対象）
  for (const row of actualRows) {
    const type = (row.TRANSACTION_TYPE || "").toLowerCase();
    if (type !== "income" && type !== "expense") continue;
    const d = getActualTargetDate(row).slice(0, 10);
    const dayIndex = parseInt(d.slice(8, 10), 10) - 1;
    if (dayIndex < 0 || dayIndex >= lastDay) continue;
    const amount = parseFloat(String(row.AMOUNT ?? "0")) || 0;
    if (type === "income") dailyIncome[dayIndex] += amount;
    else dailyExpense[dayIndex] += amount;
  }

  const labels = Array.from({ length: lastDay }, (_, i) => String(i + 1));
  const cumulativeIncome: number[] = [];
  const cumulativeExpense: number[] = [];
  let sumI = 0;
  let sumE = 0;
  // 1日から月末まで累計を算出
  for (let i = 0; i < lastDay; i++) {
    sumI += dailyIncome[i];
    sumE += dailyExpense[i];
    cumulativeIncome.push(sumI);
    cumulativeExpense.push(sumE);
  }
  return { labels, cumulativeIncome, cumulativeExpense };
}

/**
 * 今月の予定発生日の予定取引一覧（未削除・個人勘定のみ）。予定発生日の昇順。
 */
function getMonthPlanOccurrences(): { date: string; row: TransactionRow }[] {
  const ownAccountIds = getOwnAccountIds();
  const { start: monthStart, end: monthEnd } = getMonthRange();
  const planRows = getPlanRowsForHome(transactionList, ownAccountIds);
  const result: { date: string; row: TransactionRow }[] = [];
  for (const row of planRows) {
    const allDates = getPlanOccurrenceDates(row);
    const datesInMonth = allDates.filter((d) => d >= monthStart && d <= monthEnd);
    for (const d of datesInMonth) {
      result.push({ date: d, row });
    }
  }
  result.sort((a, b) => a.date.localeCompare(b.date));
  return result;
}

/** 今週の日曜・土曜（YYYY-MM-DD） */
function getWeekRange(): { start: string; end: string } {
  const now = new Date();
  const day = now.getDay();
  const sundayOffset = -day;
  const saturdayOffset = 6 - day;
  const pad = (n: number) => String(n).padStart(2, "0");
  const toYmd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const sunday = new Date(now);
  sunday.setDate(now.getDate() + sundayOffset);
  const saturday = new Date(now);
  saturday.setDate(now.getDate() + saturdayOffset);
  return { start: toYmd(sunday), end: toYmd(saturday) };
}

/** 実績の種別ごとカテゴリー別集計 */
type ActualByCategory = {
  expense: Map<string, number>;
  income: Map<string, number>;
  transfer: Map<string, number>;
};

/**
 * 指定範囲の実績取引を種別・カテゴリー別に集計する。
 */
function aggregateActualByCategoryForRange(
  list: TransactionRow[],
  ownAccountIds: Set<string>,
  rangeStart: string,
  rangeEnd: string
): ActualByCategory {
  const result: ActualByCategory = {
    expense: new Map(),
    income: new Map(),
    transfer: new Map(),
  };
  const actualRows = getActualRowsInRange(list, ownAccountIds, rangeStart, rangeEnd);
  for (const row of actualRows) {
    const type = (row.TRANSACTION_TYPE || "").toLowerCase() as "income" | "expense" | "transfer";
    if (type !== "income" && type !== "expense" && type !== "transfer") continue;
    const catId = (row.CATEGORY_ID || "").trim() || "—";
    const amount = parseFloat(String(row.AMOUNT ?? "0")) || 0;
    const map = result[type];
    map.set(catId, (map.get(catId) ?? 0) + amount);
  }
  return result;
}

/**
 * 指定範囲（今月または今週）の予定・実績を集計する。
 * 対象: 未削除、個人の勘定の取引。
 */
function aggregateForRange(
  list: TransactionRow[],
  ownAccountIds: Set<string>,
  rangeStart: string,
  rangeEnd: string
): RangeSummary {
  const summary: RangeSummary = {
    plannedIncome: 0,
    plannedExpense: 0,
    actualIncomeFromPlan: 0,
    actualExpenseFromPlan: 0,
    actualIncomeOnly: 0,
    actualExpenseOnly: 0,
  };

  const planRows = getPlanRowsForHome(list, ownAccountIds).filter((row) => {
    const type = (row.TRANSACTION_TYPE || "").toLowerCase();
    return type !== "transfer";
  });

  // 予定ごとに範囲内の発生日を列挙し、予定金額と紐づく実績金額を集計
  for (const row of planRows) {
    const planAmount = parseFloat(String(row.AMOUNT ?? "0")) || 0;
    const planType = (row.TRANSACTION_TYPE || "").toLowerCase() as "income" | "expense";
    const allDates = getPlanOccurrenceDates(row);
    const datesInRange = allDates.filter((d) => d >= rangeStart && d <= rangeEnd);

    const actualRows = getActualTransactionsForPlan(row.ID);
    const actualByDate = new Map<string, TransactionRow>();
    for (const r of actualRows) {
      const d = getActualTargetDate(r).slice(0, 10);
      actualByDate.set(d, r);
    }

    for (const dateKey of datesInRange) {
      if (planType === "income") {
        summary.plannedIncome += planAmount;
      } else {
        summary.plannedExpense += planAmount;
      }

      const actualOnDate = actualByDate.get(dateKey);
      if (actualOnDate) {
        // 発生日に紐づく実績がある場合のみ実績金額を加算
        const amt = parseFloat(String(actualOnDate.AMOUNT ?? "0")) || 0;
        const t = (actualOnDate.TRANSACTION_TYPE || "").toLowerCase();
        if (t === "income") summary.actualIncomeFromPlan += amt;
        else summary.actualExpenseFromPlan += amt;
      }
    }
  }

  // 範囲内の実績取引で予定に紐づかない収入・支出を集計
  const actualRows = getActualRowsInRange(list, ownAccountIds, rangeStart, rangeEnd);
  for (const row of actualRows) {
    const amount = parseFloat(String(row.AMOUNT ?? "0")) || 0;
    const type = (row.TRANSACTION_TYPE || "").toLowerCase();
    if (type === "income") summary.actualIncomeOnly += amount;
    else if (type === "expense") summary.actualExpenseOnly += amount;
  }

  return summary;
}

function formatProgress(actual: number, planned: number): string {
  if (planned <= 0) return "—";
  const pct = Math.round((actual / planned) * 100);
  return `${pct}%`;
}

function renderSummaryGauges(summary: RangeSummary): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "home-summary-gauges";

  const incomeRate = formatProgress(summary.actualIncomeFromPlan, summary.plannedIncome);
  const expenseRate = formatProgress(summary.actualExpenseFromPlan, summary.plannedExpense);
  const incomePct = summary.plannedIncome > 0
    ? Math.min(100, Math.round((summary.actualIncomeFromPlan / summary.plannedIncome) * 100))
    : 0;
  const expensePct = summary.plannedExpense > 0
    ? Math.min(100, Math.round((summary.actualExpenseFromPlan / summary.plannedExpense) * 100))
    : 0;

  // 予定収入・予定支出のゲージを1行ずつ生成
  [
    {
      label: "予定収入",
      pct: incomePct,
      rateText: incomeRate,
      actual: summary.actualIncomeFromPlan,
      planned: summary.plannedIncome,
    },
    {
      label: "予定支出",
      pct: expensePct,
      rateText: expenseRate,
      actual: summary.actualExpenseFromPlan,
      planned: summary.plannedExpense,
    },
  ].forEach(({ label, pct, rateText, actual, planned }) => {
    const row = document.createElement("div");
    row.className = "home-summary-gauge-row";
    const labelEl = document.createElement("span");
    labelEl.className = "home-summary-gauge-label";
    labelEl.textContent = label;
    const track = document.createElement("div");
    track.className = "home-summary-gauge-track";
    track.setAttribute("role", "progressbar");
    track.setAttribute("aria-valuenow", String(pct));
    track.setAttribute("aria-valuemin", "0");
    track.setAttribute("aria-valuemax", "100");
    const fill = document.createElement("div");
    fill.className = "home-summary-gauge-fill";
    fill.style.width = `${pct}%`;
    track.appendChild(fill);
    const rateInGauge = document.createElement("span");
    rateInGauge.className = "home-summary-gauge-rate-inner";
    rateInGauge.textContent = rateText;
    track.appendChild(rateInGauge);
    const amountEl = document.createElement("span");
    amountEl.className = "home-summary-gauge-amount";
    amountEl.textContent =
      planned > 0
        ? `${actual.toLocaleString()}/${planned.toLocaleString()}`
        : "—";
    row.appendChild(labelEl);
    row.appendChild(track);
    row.appendChild(amountEl);
    wrap.appendChild(row);
  });

  return wrap;
}

/** 破棄可能な Chart インスタンスの配列（型の互換のため unknown[]）。 */
const homeMonthChartInstances: unknown[] = [];
const homeWeekChartInstances: unknown[] = [];
let homeTrendChartInstance: { destroy(): void } | null = null;

function getCategoryName(id: string): string {
  return id === "—" ? "—" : (getCategoryById(id)?.CATEGORY_NAME ?? id);
}

function renderSummaryPieCharts(
  parent: HTMLElement,
  categoryTotals: ActualByCategory,
  idPrefix: string,
  chartInstances: unknown[]
): void {
  if (!homeChartJsRegistered) {
    Chart.register(...registerables, ChartDataLabels, centerLabelAndHolePlugin);
    homeChartJsRegistered = true;
  }

  const wrap = document.createElement("div");
  wrap.className = "home-summary-pie-charts";
  const labels = ["実績支出", "実績収入", "実績振替"] as const;
  const keys: ("expense" | "income" | "transfer")[] = ["expense", "income", "transfer"];
  // 種別ごとに figure + canvas + figcaption を追加
  keys.forEach((key, idx) => {
    const fig = document.createElement("figure");
    fig.className = "home-summary-pie-figure";
    const canvas = document.createElement("canvas");
    canvas.id = `${idPrefix}-actual-${key}-chart`;
    canvas.setAttribute("aria-label", labels[idx]);
    fig.appendChild(canvas);
    const cap = document.createElement("figcaption");
    cap.className = "home-summary-pie-caption";
    cap.textContent = labels[idx];
    fig.appendChild(cap);
    wrap.appendChild(fig);
  });
  parent.appendChild(wrap);

  // 種別ごとにドーナツチャートを描画
  keys.forEach((key) => {
    const canvas = document.getElementById(`${idPrefix}-actual-${key}-chart`) as HTMLCanvasElement | null;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const map = categoryTotals[key];
    const entries = Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
    const chartLabels = entries.length > 0 ? entries.map(([catId]) => getCategoryName(catId)) : ["データなし"];
    const data = entries.length > 0 ? entries.map(([, amount]) => amount) : [1];
    const total = entries.length > 0 ? entries.reduce((s, [, amount]) => s + amount, 0) : 0;
    const backgroundColor =
      entries.length > 0
        ? entries.map(([catId]) => (getCategoryById(catId)?.COLOR || ICON_DEFAULT_COLOR).trim() || ICON_DEFAULT_COLOR)
        : ["#e0e0e0"];
    const chart = new Chart(ctx, {
      type: "doughnut",
      data: { labels: chartLabels, datasets: [{ data, backgroundColor }] },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        cutout: "55%",
        plugins: {
          legend: { display: false },
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

function renderBalanceSection(): void {
  const content = document.getElementById("home-balance-content");
  if (!content) return;

  content.innerHTML = "";
  const { personal, permissionGranted, all } = getVisibleAccountsForBalance();

  const totalPersonal = personal.reduce((s, a) => s + parseBalance(a), 0);
  const totalPermission = permissionGranted.reduce((s, a) => s + parseBalance(a), 0);
  const totalAll = all.reduce((s, a) => s + parseBalance(a), 0);

  // 個人を先に、同種内は SORT_ORDER でソート
  const sortedAll = all.slice().sort((a, b) => {
    const aPersonal = personal.some((p) => p.ID === a.ID) ? 0 : 1;
    const bPersonal = personal.some((p) => p.ID === b.ID) ? 0 : 1;
    if (aPersonal !== bPersonal) return aPersonal - bPersonal;
    const orderA = parseInt(String(a.SORT_ORDER ?? "0"), 10) || 0;
    const orderB = parseInt(String(b.SORT_ORDER ?? "0"), 10) || 0;
    return orderA - orderB;
  });

  const totalsWrap = document.createElement("div");
  totalsWrap.className = "home-balance-totals";

  const leftBlock = document.createElement("div");
  leftBlock.className = "home-balance-totals-left";
  const line1 = document.createElement("p");
  line1.className = "home-balance-total-line home-balance-total-line--personal";
  line1.textContent = `個人の総残高: ${totalPersonal.toLocaleString()}`;
  leftBlock.appendChild(line1);
  const line2 = document.createElement("p");
  line2.className = "home-balance-total-line home-balance-total-line--shared";
  line2.textContent = `共有の総残高: ${totalPermission.toLocaleString()} 総残高: ${totalAll.toLocaleString()}`;
  leftBlock.appendChild(line2);
  totalsWrap.appendChild(leftBlock);

  const rightBlock = document.createElement("div");
  rightBlock.className = "home-balance-totals-right";
  sortedAll.forEach((row) => {
    // 勘定ごとにアイコン・名前・残高のブロックを追加
    const block = document.createElement("div");
    block.className = "home-balance-account-block";
    const iconWrap = createIconWrap(
      row.COLOR || ICON_DEFAULT_COLOR,
      row.ICON_PATH,
      { tag: "span" }
    );
    block.appendChild(iconWrap);
    const nameSpan = document.createElement("span");
    nameSpan.className = "home-balance-account-name";
    nameSpan.textContent = row.ACCOUNT_NAME || "—";
    block.appendChild(nameSpan);
    const balanceSpan = document.createElement("span");
    balanceSpan.className = "home-balance-account-balance";
    balanceSpan.textContent = parseBalance(row).toLocaleString();
    block.appendChild(balanceSpan);
    rightBlock.appendChild(block);
  });
  totalsWrap.appendChild(rightBlock);

  content.appendChild(totalsWrap);
}

/** 今月の予定の行を収支記録画面で開く */
function openTransactionEntryForPlan(row: TransactionRow): void {
  const permType = getRowPermissionType(row);
  setTransactionEntryViewOnly(permType === "view");
  setTransactionEntryEditId(row.ID);
  setTransactionEntryReturnView("home");
  pushNavigation("transaction-entry");
  showMainView("transaction-entry");
  updateCurrentMenuItem();
}

function renderMonthPlanSection(container: HTMLElement): void {
  const planSection = document.createElement("section");
  planSection.className = "home-plan-section";
  planSection.setAttribute("aria-labelledby", "home-plan-heading");
  const planHeading = document.createElement("h3");
  planHeading.id = "home-plan-heading";
  planHeading.className = "home-plan-heading";
  planHeading.textContent = "今月の予定";
  planSection.appendChild(planHeading);

  const blockWrap = document.createElement("div");
  blockWrap.className = "home-plan-block";
  const tableWrap = document.createElement("div");
  tableWrap.className = "home-plan-table-wrap";
  const table = document.createElement("table");
  table.className = "home-plan-table";
  table.setAttribute("role", "presentation");
  const thead = document.createElement("thead");
  const trHead = document.createElement("tr");
  ["予定日", "", "取引名", "金額"].forEach((text) => {
    const th = document.createElement("th");
    th.textContent = text;
    trHead.appendChild(th);
  });
  thead.appendChild(trHead);
  table.appendChild(thead);
  const tbody = document.createElement("tbody");

  const todayYMD = new Date().toISOString().slice(0, 10);
  const occurrences = getMonthPlanOccurrences();
  for (const { date, row } of occurrences) {
    // 1行: 予定日・ステータス・取引名・金額
    const tr = document.createElement("tr");
    tr.className = "home-plan-row-clickable";
    tr.tabIndex = 0;
    tr.setAttribute("role", "button");
    tr.setAttribute("aria-label", `予定を編集: ${row.NAME || "—"} ${date}`);
    tr.addEventListener("click", () => openTransactionEntryForPlan(row));
    tr.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openTransactionEntryForPlan(row);
      }
    });
    const tdDate = document.createElement("td");
    tdDate.className = "home-plan-cell-date";
    tdDate.textContent = date;
    tr.appendChild(tdDate);

    const tdPlan = document.createElement("td");
    tdPlan.className = "home-plan-cell-plan";
    const planInner = document.createElement("div");
    planInner.className = "transaction-history-plan-cell-inner";
    const planStatus = (row.PLAN_STATUS || "planning").toLowerCase();
    const actualTargetDates = new Set(
      getActualTransactionsForPlan(row.ID).map((a) => getActualTargetDate(a).slice(0, 10)).filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s))
    );
    const isDelayed = hasDelayedPlanDates(row, todayYMD, actualTargetDates);
    // 遅れでなければ計画中/実績あり/完了/中止のアイコン、遅れなら炎アイコン
    if (!isDelayed) {
      let statusClass =
        planStatus === "complete" ? "complete" : planStatus === "canceled" ? "canceled" : "planning";
      const hasActual = getActualIdsForPlanId(row.ID).length > 0;
      const hasCompletedPlanDate = (row.COMPLETED_PLANDATE ?? "").trim() !== "";
      if (statusClass === "planning" && (hasActual || hasCompletedPlanDate)) statusClass = "planning-with-actual";
      const statusWrap = document.createElement("span");
      statusWrap.className = `transaction-history-plan-status-icon transaction-history-plan-status-icon--${statusClass}`;
      const statusLabel =
        statusClass === "planning" ? "計画中" : statusClass === "planning-with-actual" ? "計画中(実績あり)" : statusClass === "complete" ? "完了" : "中止";
      statusWrap.setAttribute("aria-label", statusLabel);
      const statusInner = document.createElement("span");
      statusInner.className = "transaction-history-plan-status-icon-inner";
      statusWrap.appendChild(statusInner);
      planInner.appendChild(statusWrap);
    } else {
      // 遅れアイコン
      const delayedIcon = document.createElement("span");
      delayedIcon.className = "transaction-history-plan-status-icon transaction-history-plan-status-icon--delayed";
      delayedIcon.setAttribute("aria-label", "遅れ");
      const delayedImg = document.createElement("img");
      delayedImg.src = "/icon/fire-solid-full.svg";
      delayedImg.alt = "";
      delayedImg.className = "transaction-history-plan-status-icon-delayed-img";
      delayedIcon.appendChild(delayedImg);
      planInner.appendChild(delayedIcon);
    }
    tdPlan.appendChild(planInner);
    tr.appendChild(tdPlan);

    const tdName = document.createElement("td");
    tdName.className = "home-plan-cell-name";
    const nameInner = document.createElement("div");
    nameInner.className = "transaction-history-name-cell-inner";
    const typeIcon = document.createElement("span");
    typeIcon.className = "transaction-history-type-icon";
    const txType = (row.TRANSACTION_TYPE || "expense") as "income" | "expense" | "transfer";
    typeIcon.classList.add(`transaction-history-type-icon--${txType}`);
    typeIcon.setAttribute("aria-label", txType === "income" ? "収入" : txType === "expense" ? "支出" : "振替");
    typeIcon.textContent = txType === "income" ? "収" : txType === "expense" ? "支" : "振";
    nameInner.appendChild(typeIcon);
    const nameText = document.createElement("span");
    nameText.className = "transaction-history-name-text";
    nameText.textContent = row.NAME || "—";
    nameInner.appendChild(nameText);
    tdName.appendChild(nameInner);
    tr.appendChild(tdName);

    const tdAmount = document.createElement("td");
    tdAmount.className = "home-plan-cell-amount";
    const amount = parseFloat(String(row.AMOUNT ?? "0")) || 0;
    tdAmount.textContent = amount.toLocaleString();
    tr.appendChild(tdAmount);

    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  tableWrap.appendChild(table);
  blockWrap.appendChild(tableWrap);
  planSection.appendChild(blockWrap);
  container.appendChild(planSection);
}

function renderMonthTrendChart(): void {
  const container = document.getElementById("home-below-balance-right");
  if (!container) return;

  if (homeTrendChartInstance) {
    homeTrendChartInstance.destroy();
    homeTrendChartInstance = null;
  }

  if (!homeChartJsRegistered) {
    Chart.register(...registerables, ChartDataLabels, centerLabelAndHolePlugin);
    homeChartJsRegistered = true;
  }

  container.innerHTML = "";
  const section = document.createElement("section");
  section.className = "home-trend-section";
  section.setAttribute("aria-labelledby", "home-trend-heading");
  const heading = document.createElement("h3");
  heading.id = "home-trend-heading";
  heading.className = "home-trend-chart-heading";
  heading.textContent = "今月の収支推移";
  section.appendChild(heading);
  const wrap = document.createElement("div");
  wrap.className = "home-trend-chart-wrap";
  const canvas = document.createElement("canvas");
  wrap.appendChild(canvas);
  section.appendChild(wrap);
  container.appendChild(section);

  renderMonthPlanSection(container);

  // 今月の日別累計で折れ線グラフを描画
  const { labels, cumulativeIncome, cumulativeExpense } = getMonthDailyCumulative();
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  homeTrendChartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "収入",
          data: cumulativeIncome,
          borderColor: "rgba(46, 125, 50, 0.9)",
          backgroundColor: "rgba(46, 125, 50, 0.1)",
          fill: true,
          tension: 0.2,
        },
        {
          label: "支出",
          data: cumulativeExpense,
          borderColor: "rgba(198, 40, 40, 0.9)",
          backgroundColor: "rgba(198, 40, 40, 0.1)",
          fill: true,
          tension: 0.2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      aspectRatio: 2.9,
      layout: {
        padding: { top: 24, right: 24, left: 8, bottom: 8 },
      },
      scales: {
        x: {
          title: { display: false },
        },
        y: {
          beginAtZero: true,
          title: { display: false },
        },
      },
      plugins: {
        legend: { position: "top" },
        datalabels: {
          display: (context) => {
            const i = context.dataIndex;
            const data = context.dataset.data as number[];
            const prev = i > 0 ? data[i - 1] : null;
            return prev === null || prev !== data[i];
          },
          formatter: (value: number) => value.toLocaleString(),
          align: "top",
          anchor: "end",
        },
      },
    } as ChartOptions<"line">,
  });
}

function renderHomeSummary(): void {
  const monthContent = document.getElementById("home-month-content");
  const weekContent = document.getElementById("home-week-content");
  if (!monthContent || !weekContent) return;

  homeMonthChartInstances.forEach((ch) => (ch as { destroy(): void }).destroy());
  homeMonthChartInstances.length = 0;
  homeWeekChartInstances.forEach((ch) => (ch as { destroy(): void }).destroy());
  homeWeekChartInstances.length = 0;

  const ownAccountIds = getOwnAccountIds();
  const monthRange = getMonthRange();
  const weekRange = getWeekRange();

  // 今月・今週の予定/実績集計
  const monthSummary = aggregateForRange(
    transactionList,
    ownAccountIds,
    monthRange.start,
    monthRange.end
  );
  const weekSummary = aggregateForRange(
    transactionList,
    ownAccountIds,
    weekRange.start,
    weekRange.end
  );
  const monthActualByCategory = aggregateActualByCategoryForRange(
    transactionList,
    ownAccountIds,
    monthRange.start,
    monthRange.end
  );
  const weekActualByCategory = aggregateActualByCategoryForRange(
    transactionList,
    ownAccountIds,
    weekRange.start,
    weekRange.end
  );

  monthContent.innerHTML = "";
  monthContent.appendChild(renderSummaryGauges(monthSummary));
  renderSummaryPieCharts(monthContent, monthActualByCategory, "home-month", homeMonthChartInstances);

  weekContent.innerHTML = "";
  weekContent.appendChild(renderSummaryGauges(weekSummary));
  renderSummaryPieCharts(weekContent, weekActualByCategory, "home-week", homeWeekChartInstances);
  // 今月・今週それぞれにゲージと円グラフを描画
}

export function initHomeScreen(): void {
  registerViewHandler("home", () => {
    loadTransactionData().then(() => {
      renderHeaderProfile();
      renderBalanceSection();
      renderHomeSummary();
      renderMonthTrendChart();
    });
  });
  registerRefreshHandler("home", () => {
    loadTransactionData(true).then(() => {
      renderHeaderProfile(true);
      renderBalanceSection();
      renderHomeSummary();
      renderMonthTrendChart();
    });
  });
}
