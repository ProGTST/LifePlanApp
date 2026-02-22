import { DEFAULT_VIEW } from "./constants/index";
import type { AccountRow, AccountPermissionRow, CategoryRow, TagRow, TransactionRow, TagManagementRow } from "./types.ts";
import type { FilterState } from "./utils/transactionDataFilter";

/** ログイン中のユーザーID */
export let currentUserId = "";

/**
 * ログイン中のユーザー ID を設定する。
 * @param id - ユーザー ID
 * @returns なし
 */
export function setCurrentUserId(id: string): void {
  currentUserId = id;
}

/** 現在表示中のメインビューID */
export let currentView: string = DEFAULT_VIEW;

/**
 * メニュー遷移のスタック（ホームから現在までの経路）。
 * ホームに遷移 or 戻るでホームに着いたら ["home"] にリセット。
 * 戻る押下時は遷移先をスタックに積まない（pop のみ）。
 */
export let viewStack: string[] = [DEFAULT_VIEW];

/**
 * 現在表示中のメインビュー ID を設定する。
 * @param view - ビュー ID
 * @returns なし
 */
export function setCurrentView(view: string): void {
  if (view !== currentView) currentView = view;
}

/**
 * メニューから画面遷移したときに呼ぶ。ホームならスタックをリセット、それ以外は push する。
 * @param view - 遷移先ビュー ID
 * @returns なし
 */
export function pushNavigation(view: string): void {
  if (view === DEFAULT_VIEW) {
    viewStack = [DEFAULT_VIEW];
  } else {
    viewStack = [...viewStack, view];
  }
  currentView = view;
}

/**
 * 戻る押下時に呼ぶ。スタックを pop し、戻り先のビュー ID を返す。
 * @returns 戻り先のビュー ID。戻れない（スタックが1以下）場合は null
 */
export function popNavigation(): string | null {
  if (viewStack.length <= 1) return null;
  const target = viewStack[viewStack.length - 2];
  viewStack = viewStack.slice(0, -1);
  return target;
}

/** サイドバーで開いているパネル（menu | settings） */
export let sidebarOpenPanel: string | null = null;

/**
 * サイドバーで開いているパネル（menu / settings）を設定する。
 * @param panel - パネル ID または null
 * @returns なし
 */
export function setSidebarOpenPanel(panel: string | null): void {
  sidebarOpenPanel = panel;
}

/** 収支履歴表示時に開くタブ（メニューから週カレンダー/月カレンダーで開いたとき用） */
export let transactionHistoryInitialTab: "list" | "weekly" | "calendar" | null = null;

/**
 * 収支履歴表示時の初期タブを設定する。
 * @param tab - "list" | "weekly" | "calendar" または null
 * @returns なし
 */
export function setTransactionHistoryInitialTab(tab: "list" | "weekly" | "calendar" | null): void {
  transactionHistoryInitialTab = tab;
}

/** 勘定項目：全件キャッシュ */
export let accountListFull: AccountRow[] = [];

/**
 * 勘定項目の全件キャッシュを設定する。
 * @param list - 勘定行の配列
 * @returns なし
 */
export function setAccountListFull(list: AccountRow[]): void {
  accountListFull = list;
}

/** 勘定項目：表示用（現在ユーザーでフィルタ済み） */
export let accountList: AccountRow[] = [];

/**
 * 勘定項目の表示用リスト（ユーザーでフィルタ済み）を設定する。
 * @param list - 勘定行の配列
 * @returns なし
 */
export function setAccountList(list: AccountRow[]): void {
  accountList = list;
}

/** 勘定項目をCSVから読み込み済みか */
export let accountListLoaded = false;

/**
 * 勘定項目を CSV から読み込み済みかどうかを設定する。
 * @param loaded - true で読み込み済み
 * @returns なし
 */
export function setAccountListLoaded(loaded: boolean): void {
  accountListLoaded = loaded;
}

/** 勘定参照権限一覧（ACCOUNT_PERMISSION） */
export let accountPermissionListFull: AccountPermissionRow[] = [];
/**
 * 勘定参照権限一覧を設定する。
 * @param list - 権限行の配列
 * @returns なし
 */
export function setAccountPermissionListFull(list: AccountPermissionRow[]): void {
  accountPermissionListFull = list;
}

/** 勘定項目：削除モードON/OFF */
export let accountDeleteMode = false;

/**
 * 勘定項目の削除モード ON/OFF を設定する。
 * @param on - true で削除モード
 * @returns なし
 */
export function setAccountDeleteMode(on: boolean): void {
  accountDeleteMode = on;
}

/**
 * 勘定項目の削除モードをトグルし、新しい状態を返す。
 * @returns トグル後の accountDeleteMode
 */
export function toggleAccountDeleteMode(): boolean {
  accountDeleteMode = !accountDeleteMode;
  return accountDeleteMode;
}

/** カテゴリー：全件キャッシュ */
export let categoryListFull: CategoryRow[] = [];
/**
 * カテゴリーの全件キャッシュを設定する。
 * @param list - カテゴリー行の配列
 * @returns なし
 */
export function setCategoryListFull(list: CategoryRow[]): void {
  categoryListFull = list;
}
export let categoryList: CategoryRow[] = [];
/**
 * カテゴリーの表示用リストを設定する。
 * @param list - カテゴリー行の配列
 * @returns なし
 */
export function setCategoryList(list: CategoryRow[]): void {
  categoryList = list;
}
export let categoryListLoaded = false;
/**
 * カテゴリーを CSV から読み込み済みかどうかを設定する。
 * @param loaded - true で読み込み済み
 * @returns なし
 */
export function setCategoryListLoaded(loaded: boolean): void {
  categoryListLoaded = loaded;
}
export let categoryDeleteMode = false;
/**
 * カテゴリーの削除モード ON/OFF を設定する。
 * @param on - true で削除モード
 * @returns なし
 */
export function setCategoryDeleteMode(on: boolean): void {
  categoryDeleteMode = on;
}
/**
 * カテゴリーの削除モードをトグルし、新しい状態を返す。
 * @returns トグル後の categoryDeleteMode
 */
export function toggleCategoryDeleteMode(): boolean {
  categoryDeleteMode = !categoryDeleteMode;
  return categoryDeleteMode;
}

/** タグ：全件キャッシュ */
export let tagListFull: TagRow[] = [];
/**
 * タグの全件キャッシュを設定する。
 * @param list - タグ行の配列
 * @returns なし
 */
export function setTagListFull(list: TagRow[]): void {
  tagListFull = list;
}
export let tagList: TagRow[] = [];
/**
 * タグの表示用リストを設定する。
 * @param list - タグ行の配列
 * @returns なし
 */
export function setTagList(list: TagRow[]): void {
  tagList = list;
}
export let tagListLoaded = false;
/**
 * タグを CSV から読み込み済みかどうかを設定する。
 * @param loaded - true で読み込み済み
 * @returns なし
 */
export function setTagListLoaded(loaded: boolean): void {
  tagListLoaded = loaded;
}
export let tagDeleteMode = false;
/**
 * タグの削除モード ON/OFF を設定する。
 * @param on - true で削除モード
 * @returns なし
 */
export function setTagDeleteMode(on: boolean): void {
  tagDeleteMode = on;
}
/**
 * タグの削除モードをトグルし、新しい状態を返す。
 * @returns トグル後の tagDeleteMode
 */
export function toggleTagDeleteMode(): boolean {
  tagDeleteMode = !tagDeleteMode;
  return tagDeleteMode;
}

/** 収支：一覧用（検索・表示で使用） */
export let transactionList: TransactionRow[] = [];
/**
 * 収支一覧（検索・表示用）を設定する。
 * @param list - 取引行の配列
 * @returns なし
 */
export function setTransactionList(list: TransactionRow[]): void {
  transactionList = list;
}

/** タグ管理：収支とタグの対応（収支履歴のタグ検索で使用） */
export let tagManagementList: TagManagementRow[] = [];
/**
 * タグ管理一覧（収支とタグの対応）を設定する。
 * @param list - タグ管理行の配列
 * @returns なし
 */
export function setTagManagementList(list: TagManagementRow[]): void {
  tagManagementList = list;
}

/** 収支記録画面で編集する取引ID（null のときは新規登録） */
export let transactionEntryEditId: string | null = null;
/**
 * 収支記録画面で編集する取引 ID を設定する。null は新規登録。
 * @param id - 取引 ID または null
 * @returns なし
 */
export function setTransactionEntryEditId(id: string | null): void {
  transactionEntryEditId = id;
}

/** 収支記録画面で参照のみで開いた場合 true（保存・削除ボタンを非表示） */
export let transactionEntryViewOnly = false;
/**
 * 収支記録画面を参照のみで開くかどうかを設定する。
 * @param viewOnly - true で参照のみ（保存・削除非表示）
 * @returns なし
 */
export function setTransactionEntryViewOnly(viewOnly: boolean): void {
  transactionEntryViewOnly = viewOnly;
}

/** 収支記録画面から戻る先のビューID（更新・参照登録・削除後に遷移）。null のときは "transaction-history" に戻る。 */
export let transactionEntryReturnView: string | null = null;
/**
 * 収支記録画面から戻る先のビュー ID を設定する。
 * @param view - ビュー ID（"transaction-history" | "transaction-history-weekly" | "transaction-history-calendar" | "schedule"）または null
 * @returns なし
 */
export function setTransactionEntryReturnView(view: string | null): void {
  transactionEntryReturnView = view;
}

/** 検索条件の初期値。収支履歴・カレンダー・スケジュールの3画面で共通利用。 */
const defaultFilterState = (): FilterState => ({
  filterStatus: ["plan", "actual"],
  filterType: ["income", "expense", "transfer"],
  filterCategoryIds: [],
  filterTagIds: [],
  filterAccountIds: [],
  filterDateFrom: "",
  filterDateTo: "",
  filterAmountMin: "",
  filterAmountMax: "",
  filterFreeText: "",
});

/** 収支履歴用の検索条件（一覧で使用）。transaction-history-screen が参照する。 */
export let historyFilterState: FilterState = defaultFilterState();
export function setHistoryFilterState(partial: Partial<FilterState> | FilterState): void {
  Object.assign(historyFilterState, partial);
}

/** カレンダー用の検索条件（週・月カレンダーで使用）。calendar-screen が参照する。 */
export let calendarFilterState: FilterState = defaultFilterState();
export function setCalendarFilterState(partial: Partial<FilterState> | FilterState): void {
  Object.assign(calendarFilterState, partial);
}

/** スケジュール用の検索条件。schedule-screen が参照する。 */
export let scheduleFilterState: FilterState = defaultFilterState();
export function setScheduleFilterState(partial: Partial<FilterState> | FilterState): void {
  Object.assign(scheduleFilterState, partial);
}

/** スケジュール・カレンダー画面で使用する予定ステータス（計画中/完了/中止）。複数選択。 */
export type SchedulePlanStatus = "planning" | "complete" | "canceled";
/** スケジュール画面用。初期表示は計画中のみON。 */
export let schedulePlanStatuses: SchedulePlanStatus[] = ["planning"];
export function setSchedulePlanStatuses(value: SchedulePlanStatus[]): void {
  schedulePlanStatuses = value;
}
/** カレンダー画面用。初期表示は計画中・完了がON。 */
export let calendarPlanStatuses: SchedulePlanStatus[] = ["planning", "complete"];
export function setCalendarPlanStatuses(value: SchedulePlanStatus[]): void {
  calendarPlanStatuses = value;
}
