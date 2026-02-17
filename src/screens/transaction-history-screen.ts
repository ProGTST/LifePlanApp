import type {
  TransactionRow,
  CategoryRow,
  AccountRow,
  AccountPermissionRow,
  TagRow,
  TagManagementRow,
  TransactionManagementRow,
} from "../types";
import {
  currentUserId,
  currentView,
  transactionList,
  setTransactionList,
  tagManagementList,
  setTagManagementList,
  setTransactionEntryEditId,
  setTransactionEntryViewOnly,
  pushNavigation,
} from "../state";
import { setDisplayedKeys } from "../utils/csvWatch.ts";
import { fetchCsv, rowToObject } from "../utils/csv";
import { registerViewHandler, registerRefreshHandler, showMainView } from "../app/screen";
import { updateCurrentMenuItem } from "../app/sidebar";
import { createIconWrap } from "../utils/iconWrap";
import { openOverlay, closeOverlay } from "../utils/overlay.ts";
import { ICON_DEFAULT_COLOR } from "../constants/colorPresets";

// ---------------------------------------------------------------------------
// 定数・状態
// ---------------------------------------------------------------------------

const CSV_NO_CACHE: RequestInit = { cache: "reload" };

let categoryRows: CategoryRow[] = [];
let tagRows: TagRow[] = [];
let accountRows: AccountRow[] = [];
let permissionRows: AccountPermissionRow[] = [];

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

/** 収支履歴用の検索条件（一覧・カレンダーで使用） */
let filterStateHistory: FilterState = defaultFilterState();

/** スケジュール用の検索条件（スケジュール画面で使用、他画面と同期しない） */
let filterStateSchedule: FilterState = defaultFilterState();

/** カレンダー用の検索条件（週・月カレンダーで使用、他画面と同期しない） */
let filterStateCalendar: FilterState = defaultFilterState();

/** 現在表示中のビューに応じた検索条件を返す */
function getActiveFilterState(): FilterState {
  if (currentView === "schedule") return { ...filterStateSchedule };
  if (
    currentView === "transaction-history-weekly" ||
    currentView === "transaction-history-calendar"
  ) {
    return { ...filterStateCalendar };
  }
  return { ...filterStateHistory };
}

/** 現在表示中のビューに応じた検索条件を部分更新する */
function setActiveFilterState(partial: Partial<FilterState>): void {
  let target: FilterState;
  if (currentView === "schedule") target = filterStateSchedule;
  else if (
    currentView === "transaction-history-weekly" ||
    currentView === "transaction-history-calendar"
  ) {
    target = filterStateCalendar;
  } else {
    target = filterStateHistory;
  }
  Object.assign(target, partial);
}

/** 収支履歴用の検索条件を返す */
function getHistoryFilterState(): FilterState {
  return { ...filterStateHistory };
}

/** スケジュール用の検索条件を返す */
function getScheduleFilterState(): FilterState {
  return { ...filterStateSchedule };
}

/** カレンダー用の検索条件を返す */
function getCalendarFilterState(): FilterState {
  return { ...filterStateCalendar };
}

/** フィルター変更時にカレンダー・スケジュール等で再描画するためのコールバック配列 */
const onFilterChangeCallbacks: (() => void)[] = [];

/**
 * フィルター変更時のコールバックを登録する。カレンダー・スケジュール表示の再描画用。
 * @param fn - コールバック関数
 */
export function registerFilterChangeCallback(fn: () => void): void {
  onFilterChangeCallbacks.push(fn);
}

/**
 * フィルター適用後の取引一覧を返す。収支履歴一覧タブでのみ利用する。
 */
export function getFilteredTransactionList(): TransactionRow[] {
  return applyFilters(transactionList, getHistoryFilterState());
}

/**
 * スケジュール用の検索条件でフィルター適用後の取引一覧を返す。他画面の条件とは同期しない。
 * スケジュールでは計画（予定/実績）による抽出は行わない。表示は getPlanRows で予定のみに絞る。
 */
export function getFilteredTransactionListForSchedule(): TransactionRow[] {
  const state = getScheduleFilterState();
  return applyFilters(transactionList, { ...state, filterStatus: ["plan", "actual"] });
}

/**
 * カレンダー用の検索条件でフィルター適用後の取引一覧を返す。他画面の条件とは同期しない。
 */
export function getFilteredTransactionListForCalendar(): TransactionRow[] {
  return applyFilters(transactionList, getCalendarFilterState());
}

/**
 * 日付フィルターを指定し、画面上の日付入力欄を同期する。カレンダーで日付セルクリック時に使用。
 * 表示中ビューがカレンダーのときはカレンダー用条件、それ以外は収支履歴用条件を更新する。
 * @param from - 開始日（YYYY-MM-DD）
 * @param to - 終了日（YYYY-MM-DD）
 */
export function setFilterDateFromTo(from: string, to: string): void {
  const isCalendar =
    currentView === "transaction-history-weekly" ||
    currentView === "transaction-history-calendar";
  const target = isCalendar ? filterStateCalendar : filterStateHistory;
  target.filterDateFrom = from;
  target.filterDateTo = to;
  const dateFromEl = document.getElementById("transaction-history-date-from") as HTMLInputElement | null;
  const dateToEl = document.getElementById("transaction-history-date-to") as HTMLInputElement | null;
  if (dateFromEl) {
    dateFromEl.value = from;
    dateFromEl.classList.remove("is-empty");
  }
  if (dateToEl) {
    dateToEl.value = to;
    dateToEl.classList.remove("is-empty");
  }
}

/**
 * 指定ビュー用の検索条件をフォームに反映する。ビュー切替時に呼ぶ（収支履歴・スケジュール・カレンダーで別々の条件を表示）。
 * @param viewId - "schedule" ならスケジュール用、"transaction-history-calendar" または "transaction-history-weekly" ならカレンダー用、それ以外は収支履歴用
 */
export function loadFormFromFilterState(viewId: string): void {
  const isCalendar =
    viewId === "transaction-history-calendar" || viewId === "transaction-history-weekly";
  const state = viewId === "schedule"
    ? { ...filterStateSchedule }
    : isCalendar
      ? { ...filterStateCalendar }
      : { ...filterStateHistory };
  const dateFromEl = document.getElementById("transaction-history-date-from") as HTMLInputElement | null;
  const dateToEl = document.getElementById("transaction-history-date-to") as HTMLInputElement | null;
  if (dateFromEl) {
    dateFromEl.value = state.filterDateFrom;
    dateFromEl.classList.toggle("is-empty", !state.filterDateFrom);
  }
  if (dateToEl) {
    dateToEl.value = state.filterDateTo;
    dateToEl.classList.toggle("is-empty", !state.filterDateTo);
  }
  const amountMinEl = document.getElementById("transaction-history-amount-min") as HTMLInputElement | null;
  const amountMaxEl = document.getElementById("transaction-history-amount-max") as HTMLInputElement | null;
  if (amountMinEl) amountMinEl.value = state.filterAmountMin;
  if (amountMaxEl) amountMaxEl.value = state.filterAmountMax;
  const freeTextEl = document.getElementById("transaction-history-free-text") as HTMLInputElement | null;
  if (freeTextEl) freeTextEl.value = state.filterFreeText;
  syncFilterButtons();
  updateChosenDisplays();
}

/**
 * 取引・マスタデータを CSV から取得し state に反映する。一覧・カレンダー両方で利用。
 * @param noCache - true のときキャッシュを使わない
 * @returns 完了する Promise
 */
export function loadTransactionData(noCache = false): Promise<void> {
  return Promise.all([
    fetchTransactionList(noCache),
    fetchCategoryList(noCache),
    fetchTagList(noCache),
    fetchAccountList(noCache),
    fetchAccountPermissionList(noCache),
    fetchTagManagementList(noCache),
    fetchTransactionManagementList(noCache),
  ]).then(([txList, catList, tagList, accList, permList, tagMgmt, txMgmt]) => {
    const visibleIds = getVisibleAccountIds(accList, permList);
    const notDeleted = txList.filter((r) => (r.DLT_FLG || "0") !== "1");
    const filteredTx = filterTransactionsByVisibleAccounts(notDeleted, visibleIds);
    setTransactionList(filteredTx);
    categoryRows = catList;
    tagRows = tagList;
    accountRows = accList;
    permissionRows = permList;
    setTagManagementList(tagMgmt);
    transactionManagementRows = txMgmt;
  });
}

// ---------------------------------------------------------------------------
// データ取得
// ---------------------------------------------------------------------------

/**
 * TRANSACTION.csv を取得し、取引行の配列に変換して返す。
 * @param noCache - true のときキャッシュを使わない
 * @returns Promise。取引行の配列
 */
async function fetchTransactionList(noCache = false): Promise<TransactionRow[]> {
  const init = noCache ? CSV_NO_CACHE : undefined;
  const { header, rows } = await fetchCsv("/data/TRANSACTION.csv", init);
  if (header.length === 0) return [];
  const list: TransactionRow[] = [];
  for (const cells of rows) {
    const row = rowToObject(header, cells) as unknown as TransactionRow;
    list.push(row);
  }
  return list;
}

/**
 * ACCOUNT_PERMISSION.csv を取得し、権限行の配列に変換して返す。
 * @param noCache - true のときキャッシュを使わない
 * @returns Promise。権限行の配列
 */
async function fetchAccountPermissionList(noCache = false): Promise<AccountPermissionRow[]> {
  const init = noCache ? CSV_NO_CACHE : undefined;
  const { header, rows } = await fetchCsv("/data/ACCOUNT_PERMISSION.csv", init);
  if (header.length === 0) return [];
  const list: AccountPermissionRow[] = [];
  for (const cells of rows) {
    if (cells.length === 0 || cells.every((c) => !c.trim())) continue;
    list.push(rowToObject(header, cells) as unknown as AccountPermissionRow);
  }
  return list;
}

/**
 * ログインユーザーが参照できる勘定 ID の Set を返す（自分の勘定 + 権限付与された勘定）。
 * @param accountRows - 勘定行の配列
 * @param permissionRows - 権限行の配列
 * @returns 勘定 ID の Set
 */
function getVisibleAccountIds(
  accountRows: AccountRow[],
  permissionRows: AccountPermissionRow[]
): Set<string> {
  const ids = new Set<string>();
  const me = currentUserId;
  if (!me) return ids;
  accountRows.filter((a) => a.USER_ID === me).forEach((a) => ids.add(a.ID));
  permissionRows.filter((p) => p.USER_ID === me).forEach((p) => ids.add(p.ACCOUNT_ID));
  return ids;
}

/**
 * 表示対象の取引のみに絞る（参照可能な勘定に紐づくもの）。
 * @param txList - 取引行の配列
 * @param visibleAccountIds - 参照可能な勘定 ID の Set
 * @returns 絞り込み後の取引行の配列
 */
function filterTransactionsByVisibleAccounts(
  txList: TransactionRow[],
  visibleAccountIds: Set<string>
): TransactionRow[] {
  return txList.filter((row) => {
    const inId = (row.ACCOUNT_ID_IN || "").trim();
    const outId = (row.ACCOUNT_ID_OUT || "").trim();
    return (inId && visibleAccountIds.has(inId)) || (outId && visibleAccountIds.has(outId));
  });
}

/**
 * CATEGORY.csv を取得し、カテゴリー行の配列に変換して返す。
 * @param noCache - true のときキャッシュを使わない
 * @returns Promise。カテゴリー行の配列
 */
async function fetchCategoryList(noCache = false): Promise<CategoryRow[]> {
  const init = noCache ? CSV_NO_CACHE : undefined;
  const { header, rows } = await fetchCsv("/data/CATEGORY.csv", init);
  if (header.length === 0) return [];
  const list: CategoryRow[] = [];
  for (const cells of rows) {
    list.push(rowToObject(header, cells) as unknown as CategoryRow);
  }
  return list;
}

/**
 * ACCOUNT.csv を取得し、勘定行の配列に変換して返す。
 * @param noCache - true のときキャッシュを使わない
 * @returns Promise。勘定行の配列
 */
async function fetchAccountList(noCache = false): Promise<AccountRow[]> {
  const init = noCache ? CSV_NO_CACHE : undefined;
  const { header, rows } = await fetchCsv("/data/ACCOUNT.csv", init);
  if (header.length === 0) return [];
  const list: AccountRow[] = [];
  for (const cells of rows) {
    list.push(rowToObject(header, cells) as unknown as AccountRow);
  }
  return list;
}

/**
 * TAG.csv を取得し、タグ行の配列に変換して返す。
 * @param noCache - true のときキャッシュを使わない
 * @returns Promise。タグ行の配列
 */
async function fetchTagList(noCache = false): Promise<TagRow[]> {
  const init = noCache ? CSV_NO_CACHE : undefined;
  const { header, rows } = await fetchCsv("/data/TAG.csv", init);
  if (header.length === 0) return [];
  const list: TagRow[] = [];
  for (const cells of rows) {
    const row = rowToObject(header, cells) as unknown as TagRow;
    if (row.SORT_ORDER === undefined || row.SORT_ORDER === "") row.SORT_ORDER = String(list.length);
    list.push(row);
  }
  return list;
}

/**
 * TAG_MANAGEMENT.csv を取得し、タグ管理行の配列に変換して返す。
 * @param noCache - true のときキャッシュを使わない
 * @returns Promise。タグ管理行の配列
 */
async function fetchTagManagementList(noCache = false): Promise<TagManagementRow[]> {
  const init = noCache ? CSV_NO_CACHE : undefined;
  const { header, rows } = await fetchCsv("/data/TAG_MANAGEMENT.csv", init);
  if (header.length === 0) return [];
  const list: TagManagementRow[] = [];
  for (const cells of rows) {
    list.push(rowToObject(header, cells) as unknown as TagManagementRow);
  }
  return list;
}

let transactionManagementRows: TransactionManagementRow[] = [];

/**
 * TRANSACTION_MANAGEMENT.csv を取得し、紐付け行の配列に変換して返す。
 * @param noCache - true のときキャッシュを使わない
 */
async function fetchTransactionManagementList(noCache = false): Promise<TransactionManagementRow[]> {
  const init = noCache ? CSV_NO_CACHE : undefined;
  const { header, rows } = await fetchCsv("/data/TRANSACTION_MANAGEMENT.csv", init);
  if (header.length === 0) return [];
  const list: TransactionManagementRow[] = [];
  for (const cells of rows) {
    if (cells.length === 0 || cells.every((c) => !c.trim())) continue;
    list.push(rowToObject(header, cells) as unknown as TransactionManagementRow);
  }
  return list;
}

/**
 * ID でカテゴリー行を検索する。
 * @param id - カテゴリー ID
 * @returns 該当行または undefined
 */
export function getCategoryById(id: string): CategoryRow | undefined {
  return categoryRows.find((c) => c.ID === id);
}

/**
 * ID で勘定行を検索する。
 * @param id - 勘定 ID
 * @returns 該当行または undefined
 */
export function getAccountById(id: string): AccountRow | undefined {
  return accountRows.find((a) => a.ID === id);
}

/**
 * 取引予定に紐づく取引実績の ID 一覧を返す（TRANSACTION_MANAGEMENT から取得）。
 * @param planId - 取引予定の ID
 * @returns 取引実績 ID の配列
 */
export function getActualIdsForPlanId(planId: string): string[] {
  return transactionManagementRows
    .filter((r) => (r.TRAN_PLAN_ID || "").trim() === String(planId).trim())
    .map((r) => (r.TRAN_ACTUAL_ID || "").trim())
    .filter((id) => id !== "");
}

/**
 * 取引予定に紐づく取引実績の取引行一覧を返す。
 * @param planId - 取引予定の ID
 * @returns 取引実績の TransactionRow 配列
 */
export function getActualTransactionsForPlan(planId: string): TransactionRow[] {
  const actualIds = getActualIdsForPlanId(planId);
  if (actualIds.length === 0) return [];
  const idSet = new Set(actualIds);
  return transactionList.filter((r) => (r.PROJECT_TYPE || "").toLowerCase() === "actual" && idSet.has(r.ID));
}

/**
 * 取引に紐づくタグの一覧を返す（TAG_MANAGEMENT と TAG から取得）。
 * @param transactionId - 取引 ID
 * @returns タグ行の配列
 */
function getTagsForTransaction(transactionId: string): TagRow[] {
  const tagIds = tagManagementList
    .filter((t) => t.TRANSACTION_ID === transactionId)
    .map((t) => t.TAG_ID);
  return tagIds
    .map((id) => tagRows.find((r) => r.ID === id))
    .filter((r): r is TagRow => !!r);
}

// ---------------------------------------------------------------------------
// DOM ヘルパー・フィルタ・一覧描画
// ---------------------------------------------------------------------------

/**
 * 勘定のアイコンと名前を指定要素に追加する（一覧の勘定セル用）。
 * @param parent - 追加先の親要素
 * @param acc - 勘定行
 * @param tag - ラッパーに使うタグ名（div または span）
 * @returns なし
 */
function appendAccountWrap(
  parent: HTMLElement,
  acc: AccountRow,
  tag: "div" | "span" = "div"
): void {
  const wrap = document.createElement(tag);
  wrap.className = "transaction-history-account-wrap";
  wrap.appendChild(createIconWrap(acc.COLOR || ICON_DEFAULT_COLOR, acc.ICON_PATH));
  const nameSpan = document.createElement("span");
  nameSpan.className = "transaction-history-account-name";
  nameSpan.textContent = acc.ACCOUNT_NAME || "—";
  wrap.appendChild(nameSpan);
  parent.appendChild(wrap);
}

/**
 * 指定した検索条件を適用し、ソート済みの配列を返す。
 * @param rows - 取引行の配列
 * @param state - 検索条件（収支履歴用 or スケジュール用）
 * @returns フィルター適用・ソート後の配列
 */
function applyFilters(rows: TransactionRow[], state: FilterState): TransactionRow[] {
  const filtered = rows.filter((row) => {
    if (state.filterStatus.length > 0 && !state.filterStatus.includes(row.PROJECT_TYPE as "plan" | "actual")) return false;
    if (state.filterType.length > 0 && !state.filterType.includes(row.TRANSACTION_TYPE as "income" | "expense" | "transfer")) return false;
    if (state.filterDateFrom || state.filterDateTo) {
      const from = row.TRANDATE_FROM || "";
      const to = row.TRANDATE_TO || "";
      if (row.PROJECT_TYPE === "actual") {
        if (state.filterDateFrom && from < state.filterDateFrom) return false;
        if (state.filterDateTo && from > state.filterDateTo) return false;
      } else {
        if (!from || !to) return false;
        if (state.filterDateFrom && to < state.filterDateFrom) return false;
        if (state.filterDateTo && from > state.filterDateTo) return false;
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
      const tagIds = tagManagementList.filter((t) => t.TRANSACTION_ID === row.ID).map((t) => t.TAG_ID);
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
 * 取引が権限付与された勘定に紐づく場合、その権限種別を返す（参照→薄黄、編集→薄緑の行背景に利用）。
 * @param row - 取引行
 * @returns "view" | "edit" | null
 */
export function getRowPermissionType(row: TransactionRow): "view" | "edit" | null {
  const me = currentUserId;
  if (!me) return null;
  const inId = (row.ACCOUNT_ID_IN || "").trim();
  const outId = (row.ACCOUNT_ID_OUT || "").trim();
  let hasEdit = false;
  let hasView = false;
  for (const accountId of [inId, outId]) {
    if (!accountId) continue;
    const isOwn = accountRows.some((a) => a.ID === accountId && a.USER_ID === me);
    if (isOwn) continue;
    const perm = permissionRows.find((p) => p.ACCOUNT_ID === accountId && p.USER_ID === me);
    if (perm?.PERMISSION_TYPE === "edit") hasEdit = true;
    else if (perm?.PERMISSION_TYPE === "view") hasView = true;
  }
  if (hasEdit) return "edit";
  if (hasView) return "view";
  return null;
}

/**
 * 予定データで取引終了日が今日より過去かどうかを返す（日付のみで比較、タイムゾーンに左右されない）。
 * @param row - 取引行
 * @returns 過去の予定なら true
 */
function isPlanDateToPast(row: TransactionRow): boolean {
  if (row.PROJECT_TYPE !== "plan" || !row.TRANDATE_TO?.trim()) return false;
  const s = row.TRANDATE_TO.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return false;
  const planY = parseInt(m[1], 10);
  const planM = parseInt(m[2], 10);
  const planD = parseInt(m[3], 10);
  const now = new Date();
  const todayY = now.getFullYear();
  const todayM = now.getMonth() + 1;
  const todayD = now.getDate();
  if (planY !== todayY) return planY < todayY;
  if (planM !== todayM) return planM < todayM;
  return planD < todayD;
}

/**
 * 収支履歴の一覧タブのテーブルを描画する。フィルター適用済みの取引を行で表示する。
 * @returns なし
 */
export function renderList(): void {
  const tbody = document.getElementById("transaction-history-tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  const filtered = applyFilters(transactionList, getHistoryFilterState());
  setDisplayedKeys("transaction-history", filtered.map((row) => row.ID));
  filtered.forEach((row) => {
    const tr = document.createElement("tr");
    if (isPlanDateToPast(row)) tr.classList.add("transaction-history-row--past-plan");
    const permType = getRowPermissionType(row);
    if (permType === "view") tr.classList.add("transaction-history-row--permission-view");
    else if (permType === "edit") tr.classList.add("transaction-history-row--permission-edit");
    const tdDate = document.createElement("td");
    tdDate.textContent = row.TRANDATE_FROM || "—";
    const cat = getCategoryById(row.CATEGORY_ID);
    const tdCat = document.createElement("td");
    const catWrap = document.createElement("div");
    catWrap.className = "transaction-history-category-cell";
    if (cat) {
      const iconWrap = createIconWrap(cat.COLOR || ICON_DEFAULT_COLOR, cat.ICON_PATH);
      catWrap.appendChild(iconWrap);
      const nameSpan = document.createElement("span");
      nameSpan.className = "transaction-history-category-name";
      nameSpan.textContent = cat.CATEGORY_NAME || "—";
      catWrap.appendChild(nameSpan);
    } else {
      catWrap.textContent = "—";
    }
    tdCat.appendChild(catWrap);
    const tdPlan = document.createElement("td");
    tdPlan.className = "transaction-history-plan-cell";
    const planIcon = document.createElement("span");
    planIcon.className = "transaction-history-plan-icon";
    planIcon.setAttribute("aria-label", row.PROJECT_TYPE === "actual" ? "実績" : "予定");
    planIcon.textContent = row.PROJECT_TYPE === "actual" ? "実" : "予";
    tdPlan.appendChild(planIcon);
    const tdData = document.createElement("td");
    const dataWrap = document.createElement("div");
    dataWrap.className = "transaction-history-data-cell";
    const amountRow = document.createElement("div");
    amountRow.className = "transaction-history-amount-row";
    const line1 = document.createElement("div");
    line1.className = "transaction-history-amount";
    line1.textContent = row.AMOUNT ? Number(row.AMOUNT).toLocaleString() : "—";
    amountRow.appendChild(line1);
    dataWrap.appendChild(amountRow);
    tdData.appendChild(dataWrap);
    const tdName = document.createElement("td");
    tdName.className = "transaction-history-name-cell";
    const nameWrap = document.createElement("div");
    nameWrap.className = "transaction-history-name-cell-inner";
    const typeIcon = document.createElement("span");
    typeIcon.className = "transaction-history-type-icon";
    const txType = (row.TRANSACTION_TYPE || "expense") as "income" | "expense" | "transfer";
    typeIcon.classList.add(`transaction-history-type-icon--${txType}`);
    typeIcon.setAttribute("aria-label", txType === "income" ? "収入" : txType === "expense" ? "支出" : "振替");
    typeIcon.textContent = txType === "income" ? "収" : txType === "expense" ? "支" : "振";
    nameWrap.appendChild(typeIcon);
    const nameText = document.createElement("span");
    nameText.className = "transaction-history-name-text";
    nameText.textContent = row.NAME || "—";
    nameWrap.appendChild(nameText);
    tdName.appendChild(nameWrap);
    const tdTags = document.createElement("td");
    tdTags.className = "transaction-history-tags-cell";
    const tags = getTagsForTransaction(row.ID);
    if (tags.length > 0) {
      const tagLabelWrap = document.createElement("span");
      tagLabelWrap.className = "transaction-history-tags-label-wrap";
      for (const tag of tags) {
        const wrap = document.createElement("span");
        wrap.className = "transaction-history-tag-label";
        const bg = (tag.COLOR || "").trim() || CHOSEN_LABEL_DEFAULT_BG;
        wrap.style.backgroundColor = bg;
        wrap.style.color = CHOSEN_LABEL_DEFAULT_FG;
        wrap.textContent = tag.TAG_NAME?.trim() || "—";
        tagLabelWrap.appendChild(wrap);
      }
      tdTags.appendChild(tagLabelWrap);
    } else {
      tdTags.textContent = "—";
    }
    const tdAccount = document.createElement("td");
    tdAccount.className = "transaction-history-account-cell";
    const type = row.TRANSACTION_TYPE as "income" | "expense" | "transfer";
    if (type === "income" && row.ACCOUNT_ID_IN) {
      const acc = getAccountById(row.ACCOUNT_ID_IN);
      if (acc) appendAccountWrap(tdAccount, acc, "div");
    } else if (type === "expense" && row.ACCOUNT_ID_OUT) {
      const acc = getAccountById(row.ACCOUNT_ID_OUT);
      if (acc) appendAccountWrap(tdAccount, acc, "div");
    } else if (type === "transfer" && (row.ACCOUNT_ID_IN || row.ACCOUNT_ID_OUT)) {
      const span = document.createElement("span");
      span.className = "transaction-history-transfer-icons";
      const accOut = row.ACCOUNT_ID_OUT ? getAccountById(row.ACCOUNT_ID_OUT) : null;
      const accIn = row.ACCOUNT_ID_IN ? getAccountById(row.ACCOUNT_ID_IN) : null;
      if (accOut) appendAccountWrap(span, accOut, "span");
      const arrow = document.createElement("span");
      arrow.className = "transaction-history-transfer-arrow";
      arrow.textContent = "▶";
      span.appendChild(arrow);
      if (accIn) appendAccountWrap(span, accIn, "span");
      tdAccount.appendChild(span);
    }
    const tdPlanDateTo = document.createElement("td");
    tdPlanDateTo.textContent =
      row.PROJECT_TYPE === "plan" ? (row.TRANDATE_TO || "—") : "—";
    tr.appendChild(tdDate);
    tr.appendChild(tdCat);
    tr.appendChild(tdPlan);
    tr.appendChild(tdData);
    tr.appendChild(tdName);
    tr.appendChild(tdTags);
    tr.appendChild(tdAccount);
    tr.appendChild(tdPlanDateTo);
    tr.dataset.transactionId = row.ID;
    tr.classList.add("transaction-history-row--clickable");
    tr.addEventListener("click", () => {
      const permType = getRowPermissionType(row);
      setTransactionEntryViewOnly(permType === "view");
      setTransactionEntryEditId(row.ID);
      pushNavigation("transaction-entry");
      showMainView("transaction-entry");
      updateCurrentMenuItem();
    });
    tbody.appendChild(tr);
  });
}

/**
 * フィルター変更後に一覧を再描画し、カレンダー表示中ならカレンダー側の再描画も依頼する。
 */
function notifyFilterChange(): void {
  if (currentView === "schedule") {
    onFilterChangeCallbacks.forEach((cb) => cb());
    return;
  }
  if (
    currentView === "transaction-history-weekly" ||
    currentView === "transaction-history-calendar"
  ) {
    onFilterChangeCallbacks.forEach((cb) => cb());
    return;
  }
  renderList();
}

/**
 * 収支履歴・カレンダー共通の検索条件で、カレンダー画面のときは日付行を非表示にする。
 * 収支履歴画面のときは一覧パネルの hidden を外す（カレンダーから戻った際に表示されなくなる不具合を防ぐ）。
 * @returns なし
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

/**
 * 計画・収支種別のフィルターボタンの表示を現在の選択状態に同期する（共通検索エリア内のボタンのみ）。
 * @returns なし
 */
function syncFilterButtons(): void {
  const state = getActiveFilterState();
  const searchArea = document.getElementById("transaction-history-common");
  if (!searchArea) return;
  searchArea.querySelectorAll(".transaction-history-filter-btn[data-status]").forEach((b) => {
    const s = (b as HTMLButtonElement).dataset.status as "plan" | "actual";
    b.classList.toggle("is-active", state.filterStatus.includes(s));
  });
  searchArea.querySelectorAll(".transaction-history-filter-btn[data-type]").forEach((b) => {
    const t = (b as HTMLButtonElement).dataset.type as "income" | "expense" | "transfer";
    b.classList.toggle("is-active", state.filterType.includes(t));
  });
}

const CHOSEN_REMOVE_ICON = "/icon/circle-xmark-solid-full.svg";
const CHOSEN_LABEL_DEFAULT_BG = "#646cff";
const CHOSEN_LABEL_DEFAULT_FG = "#ffffff";

/**
 * 選択表示欄にラベル要素を並べて表示する。onRemove を渡すと各ラベル横に削除アイコンを表示する。
 * @param container - 表示先のコンテナ要素
 * @param ids - 表示する ID の配列
 * @param getName - ID から表示名を取得する関数
 * @param onRemove - 削除クリック時に呼ぶ関数（省略可）
 * @param getColor - ID から背景色を取得する関数（省略時はデフォルト色）
 * @returns なし
 */
function setChosenDisplayLabels(
  container: HTMLElement | null,
  ids: string[],
  getName: (id: string) => string | undefined,
  onRemove?: (id: string) => void,
  getColor?: (id: string) => string | undefined
): void {
  if (!container) return;
  container.textContent = "";
  if (ids.length === 0) {
    container.textContent = "未選択";
    return;
  }
  for (const id of ids) {
    const name = getName(id)?.trim() || "—";
    const wrap = document.createElement("span");
    wrap.className = "transaction-history-chosen-label-wrap";
    const bg = (getColor?.(id) ?? "").trim() || CHOSEN_LABEL_DEFAULT_BG;
    wrap.style.backgroundColor = bg;
    wrap.style.color = CHOSEN_LABEL_DEFAULT_FG;
    const label = document.createElement("span");
    label.className = "transaction-history-chosen-label";
    label.textContent = name;
    wrap.appendChild(label);
    if (onRemove) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "transaction-history-chosen-label-remove";
      btn.setAttribute("aria-label", "選択から削除");
      const img = document.createElement("img");
      img.src = CHOSEN_REMOVE_ICON;
      img.alt = "";
      btn.appendChild(img);
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        onRemove(id);
      });
      wrap.appendChild(btn);
    }
    container.appendChild(wrap);
  }
}

/**
 * カテゴリー・タグ・勘定項目の選択表示欄を更新する（選択された項目名をラベルで表示、COLOR を背景色に、削除アイコン付き）。
 * @returns なし
 */
function updateChosenDisplays(): void {
  const state = getActiveFilterState();
  const categoryEl = document.getElementById("transaction-history-category-display");
  const tagEl = document.getElementById("transaction-history-tag-display");
  const accountEl = document.getElementById("transaction-history-account-display");
  setChosenDisplayLabels(
    categoryEl,
    state.filterCategoryIds,
    (id) => getCategoryById(id)?.CATEGORY_NAME,
    (id) => {
      setActiveFilterState({
        filterCategoryIds: state.filterCategoryIds.filter((x) => x !== id),
      });
      updateChosenDisplays();
      notifyFilterChange();
    },
    (id) => getCategoryById(id)?.COLOR
  );
  setChosenDisplayLabels(
    tagEl,
    state.filterTagIds,
    (id) => tagRows.find((r) => r.ID === id)?.TAG_NAME,
    (id) => {
      setActiveFilterState({
        filterTagIds: state.filterTagIds.filter((x) => x !== id),
      });
      updateChosenDisplays();
      notifyFilterChange();
    },
    (id) => tagRows.find((r) => r.ID === id)?.COLOR
  );
  setChosenDisplayLabels(
    accountEl,
    state.filterAccountIds,
    (id) => getAccountById(id)?.ACCOUNT_NAME,
    (id) => {
      setActiveFilterState({
        filterAccountIds: state.filterAccountIds.filter((x) => x !== id),
      });
      updateChosenDisplays();
      notifyFilterChange();
    },
    (id) => getAccountById(id)?.COLOR
  );
}

/**
 * 選択モーダル内のリストで選択中の ID 一覧を返す。
 * @param listContainerId - リストコンテナ要素の ID
 * @returns 選択された ID の配列
 */
function getSelectedIdsFromList(listContainerId: string): string[] {
  const container = document.getElementById(listContainerId);
  if (!container) return [];
  const selected = container.querySelectorAll<HTMLElement>(".transaction-history-select-item .transaction-history-select-check-btn.is-selected");
  return Array.from(selected)
    .map((btn) => btn.closest(".transaction-history-select-item")?.getAttribute("data-id"))
    .filter((id): id is string => id != null);
}

/**
 * フィルター用選択モーダル内の1行（チェック・アイコン・名前）を生成する。
 * @param id - 項目 ID
 * @param name - 表示名
 * @param color - アイコン背景色
 * @param iconPath - アイコン画像パス
 * @param isSelected - 初期選択状態
 * @param onToggle - 選択切替時に呼ぶコールバック（省略可）
 * @returns 行要素
 */
function createSelectItemRow(
  id: string,
  name: string,
  color: string,
  iconPath: string,
  isSelected: boolean,
  onToggle?: (id: string, selected: boolean) => void
): HTMLElement {
  const row = document.createElement("div");
  row.className = "transaction-history-select-item";
  row.dataset.id = id;
  const checkBtn = document.createElement("button");
  checkBtn.type = "button";
  checkBtn.className = "transaction-history-select-check-btn";
  checkBtn.setAttribute("aria-label", "選択");
  checkBtn.setAttribute("aria-pressed", isSelected ? "true" : "false");
  if (isSelected) checkBtn.classList.add("is-selected");
  const checkIcon = document.createElement("span");
  checkIcon.className = "transaction-history-select-check-icon";
  checkIcon.setAttribute("aria-hidden", "true");
  checkBtn.appendChild(checkIcon);
  const handleToggle = (): void => {
    const pressed = checkBtn.getAttribute("aria-pressed") === "true";
    const next = !pressed;
    checkBtn.setAttribute("aria-pressed", String(next));
    checkBtn.classList.toggle("is-selected", next);
    onToggle?.(id, next);
  };
  checkBtn.addEventListener("click", (e) => {
    e.preventDefault();
    handleToggle();
  });
  const iconWrap = createIconWrap(color, iconPath);
  const nameSpan = document.createElement("span");
  nameSpan.className = "transaction-history-select-item-name";
  nameSpan.textContent = name;
  nameSpan.addEventListener("click", () => handleToggle());
  row.appendChild(checkBtn);
  row.appendChild(iconWrap);
  row.appendChild(nameSpan);
  return row;
}

/** カテゴリー選択モーダルで選択中の収支種別 */
let categorySelectModalType: "income" | "expense" | "transfer" = "expense";

/** カテゴリー選択モーダル内の選択ID（タブ切替でも保持） */
let categorySelectModalSelectedIds = new Set<string>();

/**
 * 収支種別に応じてカテゴリーを絞り込む。
 * @param type - 種別（income / expense / transfer）
 * @returns カテゴリー行の配列
 */
function filterCategoriesByType(type: "income" | "expense" | "transfer"): CategoryRow[] {
  if (type === "income") return categoryRows.filter((c) => (c.TYPE || "").toLowerCase() === "income");
  if (type === "expense") return categoryRows.filter((c) => (c.TYPE || "").toLowerCase() === "expense");
  if (type === "transfer") return categoryRows.filter((c) => ["income", "expense"].includes((c.TYPE || "").toLowerCase()));
  return categoryRows;
}

/**
 * カテゴリー選択モーダルの一覧を指定種別で描画する。
 * @param type - 種別（income / expense / transfer）
 * @returns なし
 */
function renderCategorySelectList(type: "income" | "expense" | "transfer"): void {
  const listEl = document.getElementById("transaction-history-category-select-list");
  if (!listEl) return;
  listEl.innerHTML = "";
  const filtered = filterCategoriesByType(type);
  const sorted = filtered.slice().sort((a, b) => (a.SORT_ORDER || "").localeCompare(b.SORT_ORDER || ""));
  for (const row of sorted) {
    const item = createSelectItemRow(
      row.ID,
      row.CATEGORY_NAME || "—",
      row.COLOR || ICON_DEFAULT_COLOR,
      row.ICON_PATH || "",
      categorySelectModalSelectedIds.has(row.ID),
      (id, selected) => {
        if (selected) categorySelectModalSelectedIds.add(id);
        else categorySelectModalSelectedIds.delete(id);
      }
    );
    listEl.appendChild(item);
  }
}

/**
 * カテゴリーフィルター用選択モーダルを開く。現在のフィルター選択を反映する。
 * @returns なし
 */
function openCategorySelectModal(): void {
  categorySelectModalType = "expense";
  categorySelectModalSelectedIds = new Set(getActiveFilterState().filterCategoryIds);
  const tabs = document.querySelectorAll(".transaction-history-category-select-tab");
  tabs.forEach((tab) => {
    const t = tab as HTMLElement;
    const isActive = (t.dataset.type ?? "expense") === categorySelectModalType;
    t.classList.toggle("is-active", isActive);
    t.setAttribute("aria-selected", String(isActive));
  });
  renderCategorySelectList(categorySelectModalType);
  openOverlay("transaction-history-category-select-overlay");
}

/**
 * タグフィルター用選択モーダルを開く。現在のフィルター選択を反映して一覧を描画する。
 * @returns なし
 */
function openTagSelectModal(): void {
  const listEl = document.getElementById("transaction-history-tag-select-list");
  if (!listEl) return;
  listEl.innerHTML = "";
  const sorted = tagRows.slice().sort((a, b) => (a.SORT_ORDER || "").localeCompare(b.SORT_ORDER || ""));
  const state = getActiveFilterState();
  for (const row of sorted) {
    const item = createSelectItemRow(
      row.ID,
      row.TAG_NAME || "—",
      row.COLOR || ICON_DEFAULT_COLOR,
      row.ICON_PATH || "",
      state.filterTagIds.includes(row.ID)
    );
    listEl.appendChild(item);
  }
  openOverlay("transaction-history-tag-select-overlay");
}

/** 勘定項目選択モーダルで表示中のタブ（個人 or 共有） */
let accountSelectModalTab: "own" | "shared" = "own";

/** 勘定項目選択モーダル内の選択ID（タブ切替でも保持） */
let accountSelectModalSelectedIds = new Set<string>();

/**
 * 自分の勘定一覧を返す（USER_ID がログインユーザーと一致するもの）。SORT_ORDER でソート済み。
 * @returns 勘定行の配列
 */
function getOwnAccountRows(): AccountRow[] {
  const me = currentUserId;
  if (!me) return [];
  return accountRows
    .filter((a) => a.USER_ID === me)
    .sort((a, b) => (a.SORT_ORDER || "").localeCompare(b.SORT_ORDER || ""));
}

/**
 * 参照可能な共有勘定一覧を返す（他ユーザー所有で権限付与されているもの）。SORT_ORDER でソート済み。
 * @returns 勘定行の配列
 */
function getSharedAccountRows(): AccountRow[] {
  const me = currentUserId;
  if (!me) return [];
  const sharedIds = new Set(permissionRows.filter((p) => p.USER_ID === me).map((p) => p.ACCOUNT_ID));
  return accountRows
    .filter((a) => a.USER_ID !== me && sharedIds.has(a.ID))
    .sort((a, b) => (a.SORT_ORDER || "").localeCompare(b.SORT_ORDER || ""));
}

/**
 * 勘定項目選択モーダルの一覧を指定タブ（個人 or 共有）で描画する。
 * @param tab - "own" | "shared"
 * @returns なし
 */
function renderAccountSelectList(tab: "own" | "shared"): void {
  const listEl = document.getElementById("transaction-history-account-select-list");
  if (!listEl) return;
  listEl.innerHTML = "";
  const rows = tab === "own" ? getOwnAccountRows() : getSharedAccountRows();
  for (const row of rows) {
    const item = createSelectItemRow(
      row.ID,
      row.ACCOUNT_NAME || "—",
      row.COLOR || ICON_DEFAULT_COLOR,
      row.ICON_PATH || "",
      accountSelectModalSelectedIds.has(row.ID),
      (id, selected) => {
        if (selected) accountSelectModalSelectedIds.add(id);
        else accountSelectModalSelectedIds.delete(id);
      }
    );
    listEl.appendChild(item);
  }
}

/**
 * 勘定項目フィルター用選択モーダルを開く。現在のフィルター選択を反映する。
 * @returns なし
 */
function openAccountSelectModal(): void {
  accountSelectModalTab = "own";
  accountSelectModalSelectedIds = new Set(filterAccountIds);
  const tabs = document.querySelectorAll(".transaction-history-account-select-tab");
  tabs.forEach((t) => {
    const el = t as HTMLElement;
    const isActive = (el.dataset.tab ?? "own") === accountSelectModalTab;
    el.classList.toggle("is-active", isActive);
    el.setAttribute("aria-selected", String(isActive));
  });
  renderAccountSelectList(accountSelectModalTab);
  openOverlay("transaction-history-account-select-overlay");
}

/**
 * 日付を YYYY-MM-DD にフォーマットする。
 * @param d - 日付
 * @returns フォーマット後の文字列
 */
function formatDateYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * 検索条件を初期状態に戻す。現在表示中のビュー（収支履歴 or スケジュール）の条件のみクリアする。
 * @returns なし
 */
function resetConditions(): void {
  const today = new Date();
  const fromDate = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
  const defaultDateFrom = formatDateYMD(fromDate);
  setActiveFilterState({
    filterStatus: ["plan", "actual"],
    filterType: ["income", "expense", "transfer"],
    filterCategoryIds: [],
    filterTagIds: [],
    filterAccountIds: [],
    filterDateFrom: defaultDateFrom,
    filterDateTo: "",
    filterAmountMin: "",
    filterAmountMax: "",
    filterFreeText: "",
  });

  const dateFromEl = document.getElementById("transaction-history-date-from") as HTMLInputElement | null;
  const dateToEl = document.getElementById("transaction-history-date-to") as HTMLInputElement | null;
  if (dateFromEl) {
    dateFromEl.value = defaultDateFrom;
    dateFromEl.classList.remove("is-empty");
  }
  if (dateToEl) {
    dateToEl.value = "";
    dateToEl.classList.add("is-empty");
  }
  const amountMinEl = document.getElementById("transaction-history-amount-min") as HTMLInputElement | null;
  const amountMaxEl = document.getElementById("transaction-history-amount-max") as HTMLInputElement | null;
  if (amountMinEl) amountMinEl.value = "";
  if (amountMaxEl) amountMaxEl.value = "";
  const freeTextEl = document.getElementById("transaction-history-free-text") as HTMLInputElement | null;
  if (freeTextEl) freeTextEl.value = "";

  syncFilterButtons();
  updateChosenDisplays();
  notifyFilterChange();
}

/**
 * 収支履歴のデータを読み込んで一覧タブを描画する。週・カレンダーは calendar-screen が担当する。
 * @param forceReloadFromCsv - true のときはキャッシュを使わず CSV を再取得する（最新化ボタン用）
 * @returns なし
 */
function loadAndShow(forceReloadFromCsv = false): void {
  updateTransactionHistoryTabLayout();
  loadFormFromFilterState("transaction-history");
  const state = filterStateHistory;
  const dateFromEl = document.getElementById("transaction-history-date-from") as HTMLInputElement | null;
  const dateToEl = document.getElementById("transaction-history-date-to") as HTMLInputElement | null;
  if (state.filterDateFrom === "" && state.filterDateTo === "") {
    const today = new Date();
    const fromDate = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
    state.filterDateFrom = formatDateYMD(fromDate);
    if (dateFromEl) {
      dateFromEl.value = state.filterDateFrom;
      dateFromEl.classList.remove("is-empty");
    }
    if (dateToEl) {
      dateToEl.value = "";
      dateToEl.classList.add("is-empty");
    }
  } else {
    if (dateFromEl) dateFromEl.classList.toggle("is-empty", !dateFromEl.value);
    if (dateToEl) dateToEl.classList.toggle("is-empty", !dateToEl.value);
  }
  loadTransactionData(forceReloadFromCsv).then(() => {
    renderList();
  });
}

/** CSV 監視からの「最新のデータを取得」用。キャッシュを無視して再取得する。 */
/**
 * 収支履歴画面を強制再読み込みして再描画する。CSV 監視の通知後などに呼ぶ。
 * @returns なし
 */
export function refreshTransactionHistory(): void {
  loadAndShow(true);
}

/**
 * 収支履歴画面の初期化を行う。「transaction-history」ビュー表示ハンドラとタブ・フィルター・モーダル等のイベントを登録する。
 * @returns なし
 */
export function initTransactionHistoryView(): void {
  registerViewHandler("transaction-history", loadAndShow);
  registerRefreshHandler("transaction-history", () => loadAndShow(true));

  document.getElementById("transaction-history-reset-conditions-btn")?.addEventListener("click", () => {
    resetConditions();
  });

  function updateDateInputEmptyState(el: HTMLInputElement | null): void {
    if (!el) return;
    if (el.value) el.classList.remove("is-empty");
    else el.classList.add("is-empty");
  }

  const dateFrom = document.getElementById("transaction-history-date-from") as HTMLInputElement;
  const dateTo = document.getElementById("transaction-history-date-to") as HTMLInputElement;
  updateDateInputEmptyState(dateFrom);
  updateDateInputEmptyState(dateTo);
  dateFrom?.addEventListener("change", () => {
    setActiveFilterState({ filterDateFrom: dateFrom.value || "" });
    updateDateInputEmptyState(dateFrom);
    notifyFilterChange();
  });
  dateTo?.addEventListener("change", () => {
    setActiveFilterState({ filterDateTo: dateTo.value || "" });
    updateDateInputEmptyState(dateTo);
    notifyFilterChange();
  });

  const searchArea = document.getElementById("transaction-history-common");
  searchArea?.querySelectorAll(".transaction-history-filter-btn[data-status]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const state = getActiveFilterState();
      const status = (btn as HTMLButtonElement).dataset.status as "plan" | "actual";
      if (state.filterStatus.includes(status)) {
        setActiveFilterState({ filterStatus: state.filterStatus.filter((s) => s !== status) });
      } else {
        setActiveFilterState({ filterStatus: [...state.filterStatus, status] });
      }
      syncFilterButtons();
      notifyFilterChange();
    });
  });

  searchArea?.querySelectorAll(".transaction-history-filter-btn[data-type]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const state = getActiveFilterState();
      const type = (btn as HTMLButtonElement).dataset.type as "income" | "expense" | "transfer";
      if (state.filterType.includes(type)) {
        setActiveFilterState({ filterType: state.filterType.filter((t) => t !== type) });
      } else {
        setActiveFilterState({ filterType: [...state.filterType, type] });
      }
      syncFilterButtons();
      notifyFilterChange();
    });
  });

  const amountMin = document.getElementById("transaction-history-amount-min") as HTMLInputElement;
  const amountMax = document.getElementById("transaction-history-amount-max") as HTMLInputElement;
  amountMin?.addEventListener("input", () => {
    setActiveFilterState({ filterAmountMin: amountMin.value.trim() });
    notifyFilterChange();
  });
  amountMax?.addEventListener("input", () => {
    setActiveFilterState({ filterAmountMax: amountMax.value.trim() });
    notifyFilterChange();
  });

  const freeText = document.getElementById("transaction-history-free-text") as HTMLInputElement;
  freeText?.addEventListener("input", () => {
    setActiveFilterState({ filterFreeText: freeText.value.trim() });
    notifyFilterChange();
  });

  document.getElementById("transaction-history-category-btn")?.addEventListener("click", openCategorySelectModal);
  document.getElementById("transaction-history-tag-btn")?.addEventListener("click", openTagSelectModal);
  document.getElementById("transaction-history-account-btn")?.addEventListener("click", openAccountSelectModal);

  document.querySelectorAll(".transaction-history-category-select-tab").forEach((tabEl) => {
    tabEl.addEventListener("click", () => {
      const type = (tabEl as HTMLElement).dataset.type as "income" | "expense" | "transfer" | undefined;
      if (!type) return;
      categorySelectModalType = type;
      document.querySelectorAll(".transaction-history-category-select-tab").forEach((t) => {
        const el = t as HTMLElement;
        const isActive = (el.dataset.type ?? "expense") === categorySelectModalType;
        el.classList.toggle("is-active", isActive);
        el.setAttribute("aria-selected", String(isActive));
      });
      renderCategorySelectList(categorySelectModalType);
    });
  });

  document.getElementById("transaction-history-category-select-clear")?.addEventListener("click", () => {
    categorySelectModalSelectedIds.clear();
    renderCategorySelectList(categorySelectModalType);
  });
  document.getElementById("transaction-history-category-select-apply")?.addEventListener("click", () => {
    setActiveFilterState({ filterCategoryIds: Array.from(categorySelectModalSelectedIds) });
    updateChosenDisplays();
    notifyFilterChange();
    closeOverlay("transaction-history-category-select-overlay");
  });
  document.getElementById("transaction-history-category-select-overlay")?.addEventListener("click", (e) => {
    if (e.target instanceof HTMLElement && e.target.id === "transaction-history-category-select-overlay") {
      closeOverlay("transaction-history-category-select-overlay");
    }
  });

  document.getElementById("transaction-history-tag-select-clear")?.addEventListener("click", () => {
    document.querySelectorAll("#transaction-history-tag-select-list .transaction-history-select-check-btn").forEach((el) => {
      el.classList.remove("is-selected");
      el.setAttribute("aria-pressed", "false");
    });
  });
  document.getElementById("transaction-history-tag-select-apply")?.addEventListener("click", () => {
    setActiveFilterState({ filterTagIds: getSelectedIdsFromList("transaction-history-tag-select-list") });
    updateChosenDisplays();
    notifyFilterChange();
    closeOverlay("transaction-history-tag-select-overlay");
  });
  document.getElementById("transaction-history-tag-select-overlay")?.addEventListener("click", (e) => {
    if (e.target instanceof HTMLElement && e.target.id === "transaction-history-tag-select-overlay") {
      closeOverlay("transaction-history-tag-select-overlay");
    }
  });

  document.querySelectorAll(".transaction-history-account-select-tab").forEach((tabEl) => {
    tabEl.addEventListener("click", () => {
      const tab = (tabEl as HTMLElement).dataset.tab as "own" | "shared" | undefined;
      if (!tab) return;
      accountSelectModalTab = tab;
      document.querySelectorAll(".transaction-history-account-select-tab").forEach((t) => {
        const el = t as HTMLElement;
        const isActive = (el.dataset.tab ?? "own") === accountSelectModalTab;
        el.classList.toggle("is-active", isActive);
        el.setAttribute("aria-selected", String(isActive));
      });
      renderAccountSelectList(accountSelectModalTab);
    });
  });

  document.getElementById("transaction-history-account-select-own-only")?.addEventListener("click", () => {
    const ownRows = getOwnAccountRows();
    accountSelectModalSelectedIds = new Set(ownRows.map((r) => r.ID));
    renderAccountSelectList(accountSelectModalTab);
  });
  document.getElementById("transaction-history-account-select-clear")?.addEventListener("click", () => {
    accountSelectModalSelectedIds.clear();
    renderAccountSelectList(accountSelectModalTab);
  });
  document.getElementById("transaction-history-account-select-apply")?.addEventListener("click", () => {
    setActiveFilterState({ filterAccountIds: Array.from(accountSelectModalSelectedIds) });
    updateChosenDisplays();
    notifyFilterChange();
    closeOverlay("transaction-history-account-select-overlay");
  });
  document.getElementById("transaction-history-account-select-overlay")?.addEventListener("click", (e) => {
    if (e.target instanceof HTMLElement && e.target.id === "transaction-history-account-select-overlay") {
      closeOverlay("transaction-history-account-select-overlay");
    }
  });
}
