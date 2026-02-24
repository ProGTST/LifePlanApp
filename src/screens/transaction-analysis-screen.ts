/**
 * 収支分析ビュー：今月の実績サマリ表示とカレンダー・グラフへの導線
 */
import type { TransactionRow } from "../types";
import { transactionList, currentUserId, pushNavigation } from "../state";
import { registerViewHandler, registerRefreshHandler, showMainView } from "../app/screen";
import { updateCurrentMenuItem } from "../app/sidebar";
import { loadTransactionData, getAccountRows } from "../utils/transactionDataSync";
import { setDisplayedKeys } from "../utils/csvWatch";

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

/** 取引が自分の勘定のみに紐づくか。集計対象判定に使用。 */
function isRowOnlyOwnAccounts(row: TransactionRow, ownAccountIds: Set<string>): boolean {
  const inId = (row.ACCOUNT_ID_IN || "").trim();
  const outId = (row.ACCOUNT_ID_OUT || "").trim();
  if (inId && !ownAccountIds.has(inId)) return false;
  if (outId && !ownAccountIds.has(outId)) return false;
  return true;
}

/** 実績取引の対象日（YYYY-MM-DD）。TRANDATE_TO を優先し、未設定時は TRANDATE_FROM。 */
function getActualTargetDate(row: TransactionRow): string {
  const from = (row.TRANDATE_FROM || "").trim().slice(0, 10);
  const to = (row.TRANDATE_TO || "").trim().slice(0, 10);
  return to || from || "";
}

/**
 * 今月（YYYY-MM）の実績取引のみを返す。transactionList は権限付与済みで渡されている前提。
 */
function getActualRowsInCurrentMonth(list: TransactionRow[]): TransactionRow[] {
  const now = new Date();
  const ym =
    String(now.getFullYear()) + "-" + String(now.getMonth() + 1).padStart(2, "0");
  return list.filter((row) => {
    if ((row.PROJECT_TYPE || "").toLowerCase() !== "actual") return false;
    const dateStr = getActualTargetDate(row);
    return dateStr.length >= 7 && dateStr.slice(0, 7) === ym;
  });
}

/**
 * 今月の実績収入・支出・残高を集計して DOM に反映する。自分の勘定の取引のみ集計する。
 */
function renderAnalysisSummary(): void {
  const ownAccountIds = getOwnAccountIds();
  const monthRows = getActualRowsInCurrentMonth(transactionList).filter((row) =>
    isRowOnlyOwnAccounts(row, ownAccountIds)
  );
  let income = 0;
  let expense = 0;
  for (const row of monthRows) {
    const type = (row.TRANSACTION_TYPE || "").toLowerCase();
    const amount = parseFloat(String(row.AMOUNT ?? "0")) || 0;
    if (type === "income") income += amount;
    else if (type === "expense") expense += amount;
  }
  const balance = income - expense;

  const setText = (id: string, value: string): void => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };
  setText("transaction-analysis-month-income", income.toLocaleString());
  setText("transaction-analysis-month-expense", expense.toLocaleString());
  setText("transaction-analysis-month-balance", balance.toLocaleString());

  const balanceEl = document.getElementById("transaction-analysis-month-balance");
  if (balanceEl) {
    balanceEl.classList.remove("transaction-analysis-summary-value--negative", "transaction-analysis-summary-value--positive");
    if (balance < 0) balanceEl.classList.add("transaction-analysis-summary-value--negative");
    else if (balance > 0) balanceEl.classList.add("transaction-analysis-summary-value--positive");
  }
}

function loadAndShowAnalysis(forceReloadFromCsv = false): void {
  loadTransactionData(forceReloadFromCsv).then(() => {
    renderAnalysisSummary();
  });
}

/**
 * 収支分析ビューの初期化。表示・更新ハンドラの登録と「カレンダー・グラフを開く」ボタンのイベント登録を行う。
 */
export function initTransactionAnalysisView(): void {
  registerViewHandler("transaction-analysis", () => loadAndShowAnalysis());
  registerRefreshHandler("transaction-analysis", () => loadAndShowAnalysis(true));

  document.getElementById("transaction-analysis-to-calendar-btn")?.addEventListener("click", () => {
    pushNavigation("transaction-history-calendar");
    showMainView("transaction-history-calendar");
    updateCurrentMenuItem();
  });

  setDisplayedKeys(["TRANSACTION", "ACCOUNT", "ACCOUNT_PERMISSION", "CATEGORY", "TAG", "TRANSACTION_TAG", "TRANSACTION_MANAGEMENT"]);
}
