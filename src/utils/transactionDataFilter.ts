/**
 * 収支履歴・カレンダーで共通利用する検索条件型とフィルター適用ユーティリティ（transactionDataFilter）。
 */
import type { TransactionRow } from "../types";
import type { TransactionTagRow } from "../types";
import { getPlanOccurrenceDates } from "./planOccurrence";

/** 収支履歴・スケジュールで検索条件を個別に保持するための型 */
export interface FilterState {
  filterStatus: ("plan" | "actual")[];
  filterType: ("income" | "expense" | "transfer")[];
  filterCategoryIds: string[];
  filterTagIds: string[];
  filterAccountIds: string[];
  filterDateFrom: string;
  filterDateTo: string;
  filterAmountMin: string;
  filterAmountMax: string;
  filterFreeText: string;
}

/**
 * 指定した検索条件を適用し、ソート済みの配列を返す。
 * @param rows - 取引行の配列
 * @param state - 検索条件
 * @param transactionTagList - タグ紐付け一覧（タグフィルタ用）
 * @returns フィルター適用・ソート後の配列
 */
export function applyFilters(
  rows: TransactionRow[],
  state: FilterState,
  transactionTagList: TransactionTagRow[]
): TransactionRow[] {
  const filtered = rows.filter((row) => {
    if (state.filterStatus.length > 0 && !state.filterStatus.includes(row.PROJECT_TYPE as "plan" | "actual")) return false;
    if (state.filterType.length > 0 && !state.filterType.includes(row.TRANSACTION_TYPE as "income" | "expense" | "transfer")) return false;
    if (state.filterDateFrom || state.filterDateTo) {
      if ((row.PROJECT_TYPE || "").toLowerCase() === "actual") {
        const from = (row.TRANDATE_FROM || "").trim().slice(0, 10);
        if (state.filterDateFrom && from < state.filterDateFrom) return false;
        if (state.filterDateTo && from > state.filterDateTo) return false;
      } else {
        // 予定取引: 予定発生日（完了予定日は考慮しない）のいずれかが範囲内にあれば抽出
        const occurrenceDates = getPlanOccurrenceDates(row);
        const inRange = occurrenceDates.some((d) => {
          if (state.filterDateFrom && d < state.filterDateFrom) return false;
          if (state.filterDateTo && d > state.filterDateTo) return false;
          return true;
        });
        if (!inRange) return false;
      }
    }
    if (state.filterCategoryIds.length > 0 && !state.filterCategoryIds.includes(row.CATEGORY_ID)) return false;
    const amount = Number(row.AMOUNT) || 0;
    if (state.filterAmountMin !== "" && !isNaN(Number(state.filterAmountMin)) && amount < Number(state.filterAmountMin)) return false;
    if (state.filterAmountMax !== "" && !isNaN(Number(state.filterAmountMax)) && amount > Number(state.filterAmountMax)) return false;
    if (state.filterFreeText.trim()) {
      const q = state.filterFreeText.trim().toLowerCase();
      const name = (row.NAME || "").toLowerCase();
      const memo = (row.MEMO || "").toLowerCase();
      if (!name.includes(q) && !memo.includes(q)) return false;
    }
    if (state.filterTagIds.length > 0) {
      const tagIds = transactionTagList.filter((t) => t.TRANSACTION_ID === row.ID).map((t) => t.TAG_ID);
      if (!state.filterTagIds.some((id) => tagIds.includes(id))) return false;
    }
    if (state.filterAccountIds.length > 0) {
      const inMatch = row.ACCOUNT_ID_IN && state.filterAccountIds.includes(row.ACCOUNT_ID_IN);
      const outMatch = row.ACCOUNT_ID_OUT && state.filterAccountIds.includes(row.ACCOUNT_ID_OUT);
      if (!inMatch && !outMatch) return false;
    }
    return true;
  });
  return filtered.slice().sort((a, b) => {
    const af = a.TRANDATE_FROM || "";
    const bf = b.TRANDATE_FROM || "";
    const cmpFrom = bf.localeCompare(af);
    if (cmpFrom !== 0) return cmpFrom;
    const at = a.TRANDATE_TO || "";
    const bt = b.TRANDATE_TO || "";
    const cmpTo = bt.localeCompare(at);
    if (cmpTo !== 0) return cmpTo;
    const ar = a.REGIST_DATETIME || "";
    const br = b.REGIST_DATETIME || "";
    return br.localeCompare(ar);
  });
}

/**
 * カレンダー用の検索条件（日付欄を除く）でフィルター適用後の取引一覧を返す。
 * 週・月カレンダー画面で選択年月による絞り込みは行わない。年月フィルタは calendar-screen 側で行う。
 * @param transactionList - 取引一覧
 * @param calendarFilterState - カレンダー用検索条件
 * @param transactionTagList - タグ紐付け一覧
 * @returns カレンダー用検索条件を適用した取引一覧（年月での絞り込み前）
 */
export function getCalendarFilteredList(
  transactionList: TransactionRow[],
  calendarFilterState: FilterState,
  transactionTagList: TransactionTagRow[]
): TransactionRow[] {
  const stateNoDate = { ...calendarFilterState, filterDateFrom: "", filterDateTo: "" };
  return applyFilters(transactionList, stateNoDate, transactionTagList);
}

/**
 * スケジュール用の検索条件でフィルター適用後の取引一覧を返す。計画（予定/実績）は絞り込まない。
 * @param transactionList - 取引一覧
 * @param scheduleFilterState - スケジュール用検索条件
 * @param transactionTagList - タグ紐付け一覧
 * @returns フィルター適用・ソート後の取引配列
 */
export function getFilteredTransactionListForSchedule(
  transactionList: TransactionRow[],
  scheduleFilterState: FilterState,
  transactionTagList: TransactionTagRow[]
): TransactionRow[] {
  const state = { ...scheduleFilterState, filterStatus: ["plan", "actual"] as ("plan" | "actual")[] };
  return applyFilters(transactionList, state, transactionTagList);
}
