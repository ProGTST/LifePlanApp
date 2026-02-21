/**
 * 収支履歴・カレンダーで共通利用するレイアウト更新とフィルター変更コールバックのユーティリティ（transactionDataLayout）。
 */
import { currentView } from "../state";

/** フィルター変更時にカレンダー・スケジュール等で再描画するためのコールバック配列 */
const onFilterChangeCallbacks: (() => void)[] = [];

/**
 * フィルター変更時のコールバックを登録する。カレンダー・スケジュール表示の再描画用。
 */
export function registerFilterChangeCallback(fn: () => void): void {
  onFilterChangeCallbacks.push(fn);
}

/**
 * 登録済みのフィルター変更コールバックをすべて実行する。収支履歴画面側の notifyFilterChange から呼ぶ。
 */
export function runFilterChangeCallbacks(): void {
  onFilterChangeCallbacks.forEach((cb) => cb());
}

/**
 * 収支履歴用の検索条件に日付を設定するためのセッター。transaction-history-screen で初期化時に登録する。
 */
let historyFilterDateSetter: ((from: string, to: string) => void) | null = null;

/**
 * 収支履歴用の日付セッターを登録する。画面初期化時に一度だけ呼ぶ。
 */
export function registerHistoryFilterDateSetter(fn: (from: string, to: string) => void): void {
  historyFilterDateSetter = fn;
}

/**
 * 収支履歴用の検索条件に日付（開始日・終了日）を設定し、画面上の日付入力欄を同期する。
 * カレンダーで日付セルクリック時に、収支履歴画面へ遷移したうえでその日で絞り込むために使用する。
 */
export function setHistoryFilterDateFromTo(from: string, to: string): void {
  if (historyFilterDateSetter) historyFilterDateSetter(from, to);
  const dateFromEl = document.getElementById("transaction-history-date-from") as HTMLInputElement | null;
  const dateToEl = document.getElementById("transaction-history-date-to") as HTMLInputElement | null;
  if (dateFromEl) {
    dateFromEl.value = from;
    dateFromEl.classList.toggle("is-empty", !from);
  }
  if (dateToEl) {
    dateToEl.value = to;
    dateToEl.classList.toggle("is-empty", !to);
  }
}

/**
 * 収支履歴・カレンダー共通の検索条件で、カレンダー画面のときは日付行を非表示にする。
 * 収支履歴画面（一覧表示）のときは一覧パネルの hidden を外す。
 * ※一覧は別ビュー（view-transaction-history）で表示。週/月のタブはカレンダー画面（view-transaction-calendar）のみ。
 */
export function updateTransactionHistoryTabLayout(): void {
  const fromCalendarMenu =
    currentView === "transaction-history-weekly" || currentView === "transaction-history-calendar";
  const dateRow = document.getElementById("transaction-history-date-row");
  if (dateRow) {
    dateRow.classList.toggle("transaction-history-search-row--hidden", fromCalendarMenu);
    dateRow.setAttribute("aria-hidden", fromCalendarMenu ? "true" : "false");
  }
  if (currentView === "transaction-history") {
    const listPanel = document.getElementById("transaction-history-list-panel");
    listPanel?.classList.remove("transaction-history-panel--hidden");
  }
}
