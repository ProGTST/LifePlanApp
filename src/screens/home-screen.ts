import { invoke } from "@tauri-apps/api/core";
import type { UserRow, TransactionRow } from "../types.ts";
import { currentUserId, transactionList } from "../state";
import { fetchCsv, rowToObject } from "../utils/csv";
import { registerViewHandler, registerRefreshHandler } from "../app/screen";
import { PROFILE_ICON_DEFAULT_COLOR } from "../constants/colorPresets.ts";
import { loadTransactionData, getAccountRows, getActualTransactionsForPlan } from "../utils/transactionDataSync";
import { getPlanOccurrenceDates } from "../utils/planOccurrence";

const PROFILE_NAME_LENGTH = 4;

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

function parseCompletedPlanDates(completedPlanDate: string | undefined): Set<string> {
  const set = new Set<string>();
  if (!completedPlanDate || typeof completedPlanDate !== "string") return set;
  for (const s of completedPlanDate.split(",")) {
    const d = s.trim().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) set.add(d);
  }
  return set;
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

  const planRows = list.filter((row) => {
    if ((row.PROJECT_TYPE || "").toLowerCase() !== "plan") return false;
    if ((row.DLT_FLG || "0") === "1") return false;
    if (!isRowOnlyOwnAccounts(row, ownAccountIds)) return false;
    const type = (row.TRANSACTION_TYPE || "").toLowerCase();
    if (type === "transfer") return false;
    return true;
  });

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
    const completedSet = parseCompletedPlanDates(row.COMPLETED_PLANDATE);
    const status = (row.PLAN_STATUS || "planning").toLowerCase();

    for (const dateKey of datesInRange) {
      if (planType === "income") {
        summary.plannedIncome += planAmount;
      } else {
        summary.plannedExpense += planAmount;
      }

      const actualOnDate = actualByDate.get(dateKey);
      if (actualOnDate) {
        const amt = parseFloat(String(actualOnDate.AMOUNT ?? "0")) || 0;
        const t = (actualOnDate.TRANSACTION_TYPE || "").toLowerCase();
        if (t === "income") summary.actualIncomeFromPlan += amt;
        else summary.actualExpenseFromPlan += amt;
      } else if (completedSet.has(dateKey)) {
        if (planType === "income") summary.actualIncomeFromPlan += planAmount;
        else summary.actualExpenseFromPlan += planAmount;
      }
    }
  }

  const actualRows = list.filter((row) => {
    if ((row.PROJECT_TYPE || "").toLowerCase() !== "actual") return false;
    if ((row.DLT_FLG || "0") === "1") return false;
    if (!isRowOnlyOwnAccounts(row, ownAccountIds)) return false;
    const d = getActualTargetDate(row).slice(0, 10);
    return d >= rangeStart && d <= rangeEnd;
  });

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

function renderSummaryTable(summary: RangeSummary): HTMLTableElement {
  const table = document.createElement("table");
  table.className = "home-summary-table";
  table.setAttribute("role", "presentation");
  const thead = document.createElement("thead");
  const trHead = document.createElement("tr");
  ["", "予定金額", "実績金額", "進捗率"].forEach((text) => {
    const th = document.createElement("th");
    th.textContent = text;
    trHead.appendChild(th);
  });
  thead.appendChild(trHead);
  table.appendChild(thead);
  const tbody = document.createElement("tbody");

  const plannedIncomeRate = formatProgress(summary.actualIncomeFromPlan, summary.plannedIncome);
  const plannedExpenseRate = formatProgress(summary.actualExpenseFromPlan, summary.plannedExpense);

  [
    ["予定収入", summary.plannedIncome, summary.actualIncomeFromPlan, plannedIncomeRate],
    ["予定支出", summary.plannedExpense, summary.actualExpenseFromPlan, plannedExpenseRate],
    ["実績収入", "—", summary.actualIncomeOnly, "—"],
    ["実績支出", "—", summary.actualExpenseOnly, "—"],
  ].forEach(([label, col2, col3, col4]) => {
    const tr = document.createElement("tr");
    const td1 = document.createElement("td");
    td1.textContent = String(label);
    const td2 = document.createElement("td");
    td2.textContent = typeof col2 === "number" ? col2.toLocaleString() : String(col2);
    td2.style.textAlign = "right";
    const td3 = document.createElement("td");
    td3.textContent = typeof col3 === "number" ? col3.toLocaleString() : String(col3);
    td3.style.textAlign = "right";
    const td4 = document.createElement("td");
    td4.textContent = String(col4);
    td4.style.textAlign = "right";
    tr.appendChild(td1);
    tr.appendChild(td2);
    tr.appendChild(td3);
    tr.appendChild(td4);
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  return table;
}

function renderHomeSummary(): void {
  const monthContent = document.getElementById("home-month-content");
  const weekContent = document.getElementById("home-week-content");
  if (!monthContent || !weekContent) return;

  const ownAccountIds = getOwnAccountIds();
  const monthRange = getMonthRange();
  const weekRange = getWeekRange();

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

  monthContent.innerHTML = "";
  monthContent.appendChild(renderSummaryTable(monthSummary));
  weekContent.innerHTML = "";
  weekContent.appendChild(renderSummaryTable(weekSummary));
}

export function initHomeScreen(): void {
  registerViewHandler("home", () => {
    loadTransactionData().then(() => {
      renderHeaderProfile();
      renderHomeSummary();
    });
  });
  registerRefreshHandler("home", () => {
    loadTransactionData(true).then(() => {
      renderHeaderProfile(true);
      renderHomeSummary();
    });
  });
}
