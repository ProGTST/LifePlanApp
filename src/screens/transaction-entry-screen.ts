import type { TransactionRow, CategoryRow, AccountRow, AccountPermissionRow, TagRow, TransactionTagRow, TransactionManagementRow, AccountHistoryRow } from "../types";
import {
  currentUserId,
  transactionEntryEditId,
  setTransactionEntryEditId,
  transactionEntryViewOnly,
  transactionEntryReturnView,
  setTransactionEntryReturnView,
  pushNavigation,
  getLastCsvVersion,
  setLastCsvVersion,
} from "../state";
import { createIconWrap } from "../utils/iconWrap";
import { openOverlay, closeOverlay } from "../utils/overlay";
import { ICON_DEFAULT_COLOR } from "../constants/colorPresets";
import { fetchCsv, rowToObject } from "../utils/csv";
import { transactionListToCsv, transactionTagListToCsv, transactionManagementListToCsv, accountListToCsv, accountHistoryListToCsv } from "../utils/csvExport";
import { saveCsvViaApi, VersionConflictError } from "../utils/dataApi";
import { registerViewHandler, showMainView } from "../app/screen";
import { updateCurrentMenuItem } from "../app/sidebar";
import { setNewRowAudit, setUpdateAudit } from "../utils/auditFields";
import {
  checkVersionBeforeUpdate,
  getVersionConflictMessage,
} from "../utils/csvVersionCheck.ts";
import { updateTransactionMonthlyForTransaction } from "../utils/transactionMonthlyAggregate";
import { getPlanOccurrenceDates } from "../utils/planOccurrence";
import { getActualTransactionsForPlan, invalidateTransactionDataCache } from "../utils/transactionDataSync";


let categoryRows: CategoryRow[] = [];
let accountRows: AccountRow[] = [];
let permissionRows: AccountPermissionRow[] = [];
let tagRows: TagRow[] = [];
/** 参照可能な勘定 ID（フィルタ等で利用予定）。loadFormData で更新。 */
let visibleAccountIds: Set<string> = new Set();
/** 出金元・入金先プルダウンに表示する勘定 ID（権限が edit のもののみ） */
let editableAccountIds: Set<string> = new Set();
let selectedTagIds: Set<string> = new Set();
/** 予定に紐づける取引実績の ID 一覧（予定編集時のみ有効） */
let selectedActualIds: Set<string> = new Set();
/** 実績選択チップ表示用: id・名称・カテゴリーID（selectedActualIds と同期） */
let selectedActualDisplayInfo: { id: string; name: string; categoryId: string }[] = [];
/** 実績選択モーダル用: 全実績行（年月でフィルタ前） */
let actualSelectAllRows: TransactionRow[] = [];
/** 実績選択モーダル用: 現在表示している年月（YYYY-MM） */
let actualSelectYM: string | null = null;
let editingTransactionId: string | null = null;

/** 月ごとの繰り返しで選択した対象日（1～31, -1=月末, -2=月末の1日前, -3=月末の2日前） */
let selectedMonthlyDays: Set<string> = new Set();

/** 連続モード（新規登録時のみ有効。ONだと保存後に画面遷移せず連続登録） */
let continuousMode = false;

/**
 * ログインユーザーが参照できる勘定 ID の Set を返す（自分の勘定 + 権限付与された勘定）。
 * @param accounts - 勘定行の配列
 * @param permissions - 権限行の配列
 * @returns 勘定 ID の Set
 */
function getVisibleAccountIds(accounts: AccountRow[], permissions: AccountPermissionRow[]): Set<string> {
  const ids = new Set<string>();
  const me = currentUserId;
  if (!me) return ids;
  accounts.filter((a) => a.USER_ID === me).forEach((a) => ids.add(a.ID));
  permissions.filter((p) => p.USER_ID === me).forEach((p) => ids.add(p.ACCOUNT_ID));
  return ids;
}

/**
 * 出金元・入金先プルダウンに表示する勘定 ID の Set を返す（自分の勘定 + 権限が edit のもののみ）。
 * @param accounts - 勘定行の配列
 * @param permissions - 権限行の配列
 * @returns 勘定 ID の Set
 */
function getEditableAccountIds(accounts: AccountRow[], permissions: AccountPermissionRow[]): Set<string> {
  const ids = new Set<string>();
  const me = currentUserId;
  if (!me) return ids;
  accounts.filter((a) => a.USER_ID === me).forEach((a) => ids.add(a.ID));
  permissions
    .filter((p) => p.USER_ID === me && (p.PERMISSION_TYPE || "").toLowerCase() === "edit")
    .forEach((p) => ids.add(p.ACCOUNT_ID));
  return ids;
}

/**
 * 参照可能な勘定に紐づく取引のみに絞る（ACCOUNT_ID_IN または ACCOUNT_ID_OUT が visibleAccountIds に含まれるもの）。
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
 * 日付文字列 YYYY-MM-DD に指定日数を加算した日付を返す。
 * @param dateStr - 基準日（YYYY-MM-DD）
 * @param days - 加算する日数
 * @returns 計算後の日付文字列（YYYY-MM-DD）
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- 将来の週表示用に保持
function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, (m ?? 1) - 1, (d ?? 1) + days);
  const yy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * 指定日を含む週の月曜～日曜の範囲を返す（ISO週）。
 * @param dateStr - 日付（YYYY-MM-DD）
 * @returns 週の開始日・終了日（YYYY-MM-DD）
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- 将来の週表示用に保持
function getWeekRangeFromDate(dateStr: string): { start: string; end: string } {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  const dayOfWeek = date.getDay();
  const daysFromMonday = (dayOfWeek + 6) % 7;
  const monday = new Date(date);
  monday.setDate(date.getDate() - daysFromMonday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const pad = (n: number) => String(n).padStart(2, "0");
  const start = `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`;
  const end = `${sunday.getFullYear()}-${pad(sunday.getMonth() + 1)}-${pad(sunday.getDate())}`;
  return { start, end };
}

/** 週範囲のラベル文字列（例: 2025年2月10日～2月16日）を返す。将来の表示用に保持。 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- 週ラベル表示で利用予定
function formatWeekLabel(weekStart: string, weekEnd: string): string {
  const [ys, ms, ds] = weekStart.split("-").map(Number);
  const [ye, me, de] = weekEnd.split("-").map(Number);
  if (weekStart.slice(0, 4) === weekEnd.slice(0, 4) && weekStart.slice(0, 7) === weekEnd.slice(0, 7)) {
    return `${ys}年${ms}月${ds}日～${de}日`;
  }
  if (weekStart.slice(0, 4) === weekEnd.slice(0, 4)) {
    return `${ys}年${ms}月${ds}日～${me}月${de}日`;
  }
  return `${ys}年${ms}月${ds}日～${ye}年${me}月${de}日`;
}

/** 日付が週範囲内か（以上・以下）で判定する。 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- 将来の週表示用に保持
function isDateInWeek(dateStr: string, weekStart: string, weekEnd: string): boolean {
  return dateStr >= weekStart && dateStr <= weekEnd;
}

/** 指定年月（YYYY-MM）の月初日・月末日を返す。実績選択モーダルの月範囲用。 */
function getMonthDateRange(ym: string): { firstDay: string; lastDay: string } | null {
  const m = ym.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const lastDate = new Date(year, month, 0).getDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    firstDay: `${ym}-01`,
    lastDay: `${ym}-${pad(lastDate)}`,
  };
}

/** 実績取引の対象日（YYYY-MM-DD）。TRANDATE_TO を優先し、未設定時は TRANDATE_FROM。 */
function getActualTargetDate(row: TransactionRow): string {
  const from = (row.TRANDATE_FROM || "").trim().slice(0, 10);
  const to = (row.TRANDATE_TO || "").trim().slice(0, 10);
  return (to || from) || "";
}

/**
 * CATEGORY.csv を取得し、カテゴリー行の配列に変換して返す。
 * @param noCache - true のときキャッシュを使わない
 * @returns Promise。カテゴリー行の配列
 */
async function fetchCategoryList(_noCache = false): Promise<CategoryRow[]> {
  const { header, rows } = await fetchCsv("/data/CATEGORY.csv");
  if (header.length === 0) return [];
  return rows.map((cells) => rowToObject(header, cells) as unknown as CategoryRow);
}

/**
 * ACCOUNT.csv を取得し、勘定行の配列に変換して返す。
 * @param noCache - true のときキャッシュを使わない
 * @returns Promise。勘定行の配列
 */
async function fetchAccountList(_noCache = false): Promise<AccountRow[]> {
  const { header, rows } = await fetchCsv("/data/ACCOUNT.csv");
  if (header.length === 0) return [];
  return rows.map((cells) => rowToObject(header, cells) as unknown as AccountRow);
}

/**
 * ACCOUNT_PERMISSION.csv を取得し、権限行の配列に変換して返す。
 * @param noCache - true のときキャッシュを使わない
 * @returns Promise。権限行の配列
 */
async function fetchAccountPermissionList(_noCache = false): Promise<AccountPermissionRow[]> {
  const { header, rows } = await fetchCsv("/data/ACCOUNT_PERMISSION.csv");
  if (header.length === 0) return [];
  const list: AccountPermissionRow[] = [];
  for (const cells of rows) {
    if (cells.length === 0 || cells.every((c) => !c.trim())) continue;
    list.push(rowToObject(header, cells) as unknown as AccountPermissionRow);
  }
  return list;
}

/**
 * TRANSACTION.csv を取得し、取引行の配列（削除済み含む）と次に使う ID を返す。
 * @param noCache - true のときキャッシュを使わない
 * @returns Promise。nextId と取引行の配列（全件）
 */
async function fetchTransactionRows(_noCache = false): Promise<{ nextId: number; rows: TransactionRow[] }> {
  const { header, rows } = await fetchCsv("/data/TRANSACTION.csv");
  const list: TransactionRow[] = [];
  let maxId = 0;
  for (const cells of rows) {
    const row = rowToObject(header, cells) as unknown as TransactionRow;
    const n = parseInt(row.ID ?? "0", 10);
    if (!Number.isNaN(n) && n > maxId) maxId = n;
    list.push(row);
  }
  return { nextId: maxId + 1, rows: list };
}

/**
 * 取引行の配列から未削除（DLT_FLG≠1）の行のみを返す。
 */
function getNonDeletedTransactionRows(rows: TransactionRow[]): TransactionRow[] {
  return rows.filter((r) => (r.DLT_FLG || "0") !== "1");
}

/**
 * TAG.csv を取得し、タグ行の配列に変換して返す。
 * @param noCache - true のときキャッシュを使わない
 * @returns Promise。タグ行の配列
 */
async function fetchTagList(_noCache = false): Promise<TagRow[]> {
  const { header, rows } = await fetchCsv("/data/TAG.csv");
  if (header.length === 0) return [];
  const list: TagRow[] = [];
  for (const cells of rows) {
    if (cells.length === 0 || cells.every((c) => !c.trim())) continue;
    list.push(rowToObject(header, cells) as unknown as TagRow);
  }
  return list;
}

/**
 * TRANSACTION_TAG.csv を取得し、タグ管理行の配列と次に使う ID を返す。
 * @param noCache - true のときキャッシュを使わない
 * @returns Promise。nextId とタグ管理行の配列
 */
async function fetchTransactionTagRows(_noCache = false): Promise<{ nextId: number; rows: TransactionTagRow[] }> {
  const { header, rows } = await fetchCsv("/data/TRANSACTION_TAG.csv");
  const list: TransactionTagRow[] = [];
  let maxId = 0;
  for (const cells of rows) {
    if (cells.length === 0 || cells.every((c) => !c.trim())) continue;
    const row = rowToObject(header, cells) as unknown as TransactionTagRow;
    const n = parseInt(row.ID ?? "0", 10);
    if (!Number.isNaN(n) && n > maxId) maxId = n;
    list.push(row);
  }
  return { nextId: maxId + 1, rows: list };
}

/**
 * TRANSACTION_MANAGEMENT.csv を取得し、紐付け行の配列と次に使う ID を返す。
 * @param noCache - true のときキャッシュを使わない
 * @returns Promise。nextId と紐付け行の配列
 */
async function fetchTransactionManagementRows(_noCache = false): Promise<{ nextId: number; rows: TransactionManagementRow[] }> {
  const { header, rows } = await fetchCsv("/data/TRANSACTION_MANAGEMENT.csv");
  const list: TransactionManagementRow[] = [];
  let maxId = 0;
  for (const cells of rows) {
    if (cells.length === 0 || cells.every((c) => !c.trim())) continue;
    const row = rowToObject(header, cells) as unknown as TransactionManagementRow;
    const n = parseInt(row.ID ?? "0", 10);
    if (!Number.isNaN(n) && n > maxId) maxId = n;
    list.push(row);
  }
  return { nextId: maxId + 1, rows: list };
}

/**
 * ACCOUNT_HISTORY.csv を取得し、勘定項目履歴行の配列と次に使う ID を返す。
 * @param noCache - true のときキャッシュを使わない
 * @returns Promise。nextId と勘定項目履歴行の配列
 */
async function fetchAccountHistoryRows(
  _noCache = false
): Promise<{ nextId: number; rows: AccountHistoryRow[] }> {
  const { header, rows, version } = await fetchCsv("/data/ACCOUNT_HISTORY.csv");
  setLastCsvVersion("ACCOUNT_HISTORY.csv", version);
  const list: AccountHistoryRow[] = [];
  let maxId = 0;
  for (const cells of rows) {
    if (cells.length === 0 || cells.every((c) => !c.trim())) continue;
    const row = rowToObject(header, cells) as unknown as AccountHistoryRow;
    const n = parseInt(row.ID ?? "0", 10);
    if (!Number.isNaN(n) && n > maxId) maxId = n;
    list.push(row);
  }
  return { nextId: maxId + 1, rows: list };
}

/**
 * 収支記録フォームのカテゴリー入力（hidden）要素を返す。
 * @returns 要素または null
 */
function getCategoryValueEl(): HTMLInputElement | null {
  return document.getElementById("transaction-entry-category") as HTMLInputElement | null;
}

/**
 * 収入側勘定の hidden 入力要素を返す。
 * @returns 要素または null
 */
function getAccountInValueEl(): HTMLInputElement | null {
  return document.getElementById("transaction-entry-account-in") as HTMLInputElement | null;
}

/**
 * 支出側勘定の hidden 入力要素を返す。
 * @returns 要素または null
 */
function getAccountOutValueEl(): HTMLInputElement | null {
  return document.getElementById("transaction-entry-account-out") as HTMLInputElement | null;
}

/**
 * ID で勘定行を検索する。
 * @param id - 勘定 ID
 * @returns 該当行または undefined
 */
function getAccountById(id: string): AccountRow | undefined {
  return accountRows.find((a) => a.ID === id);
}

/**
 * 勘定トリガー（支出/収入のどちらか）の表示を指定勘定で更新する。
 * @param which - "out"（支出）または "in"（収入）
 * @param accountId - 勘定 ID
 * @returns なし
 */
function updateAccountTriggerDisplay(which: "out" | "in", accountId: string): void {
  const prefix = which === "out" ? "transaction-entry-account-out" : "transaction-entry-account-in";
  const triggerIcon = document.querySelector(`#${prefix}-trigger .transaction-entry-account-trigger-icon`);
  const triggerText = document.querySelector(`#${prefix}-trigger .transaction-entry-account-trigger-text`);
  if (!triggerIcon || !triggerText) return;
  if (!accountId) {
    (triggerIcon as HTMLElement).innerHTML = "";
    (triggerIcon as HTMLElement).style.display = "none";
    triggerText.textContent = "—";
    return;
  }
  const acc = getAccountById(accountId);
  if (!acc) {
    // 勘定が見つからない場合はプレースホルダ表示
    triggerText.textContent = "—";
    (triggerIcon as HTMLElement).style.display = "none";
    return;
  }
  (triggerIcon as HTMLElement).innerHTML = "";
  (triggerIcon as HTMLElement).style.display = "";
  const iconWrap = createIconWrap(acc.COLOR || ICON_DEFAULT_COLOR, acc.ICON_PATH, { tag: "span" });
  (triggerIcon as HTMLElement).appendChild(iconWrap);
  triggerText.textContent = (acc.ACCOUNT_NAME || "").trim() || "—";
}

/**
 * 勘定選択リスト（支出/収入のどちらか）を閉じる。
 * @param which - "out" | "in"
 * @returns なし
 */
function closeAccountList(which: "out" | "in"): void {
  const prefix = which === "out" ? "transaction-entry-account-out" : "transaction-entry-account-in";
  const list = document.getElementById(`${prefix}-list`);
  const trigger = document.getElementById(`${prefix}-trigger`);
  if (list) {
    list.classList.remove("is-open");
    list.setAttribute("aria-hidden", "true");
  }
  if (trigger) trigger.setAttribute("aria-expanded", "false");
}

/**
 * 収支種別に応じてカテゴリーを絞り込む。
 * @param type - 種別（income / expense / transfer）
 * @returns カテゴリー行の配列
 */
function filterCategoriesByType(type: string): CategoryRow[] {
  const t = (type || "").toLowerCase();
  if (t === "income") return categoryRows.filter((c) => (c.TYPE || "").toLowerCase() === "income");
  if (t === "expense") return categoryRows.filter((c) => (c.TYPE || "").toLowerCase() === "expense");
  if (t === "transfer") return categoryRows.filter((c) => (c.TYPE || "").toLowerCase() === "transfer");
  return categoryRows;
}

/**
 * ID でカテゴリー行を検索する。
 * @param id - カテゴリー ID
 * @returns 該当行または undefined
 */
function getCategoryById(id: string): CategoryRow | undefined {
  return categoryRows.find((c) => c.ID === id);
}

/**
 * カテゴリートリガーの表示を指定カテゴリーで更新する。
 * @param categoryId - カテゴリー ID
 * @returns なし
 */
function updateCategoryTriggerDisplay(categoryId: string): void {
  const triggerIcon = document.querySelector(".transaction-entry-category-trigger-icon");
  const triggerText = document.querySelector(".transaction-entry-category-trigger-text");
  if (!triggerIcon || !triggerText) return;
  if (!categoryId) {
    (triggerIcon as HTMLElement).innerHTML = "";
    (triggerIcon as HTMLElement).style.display = "none";
    triggerText.textContent = "選択してください";
    return;
  }
  const cat = getCategoryById(categoryId);
  if (!cat) {
    triggerText.textContent = "選択してください";
    (triggerIcon as HTMLElement).style.display = "none";
    return;
  }
  (triggerIcon as HTMLElement).innerHTML = "";
  (triggerIcon as HTMLElement).style.display = "";
  const iconWrap = createIconWrap(cat.COLOR || ICON_DEFAULT_COLOR, cat.ICON_PATH, { tag: "span" });
  (triggerIcon as HTMLElement).appendChild(iconWrap);
  triggerText.textContent = (cat.CATEGORY_NAME || "").trim() || "—";
}

/**
 * カテゴリー選択リストを閉じる。
 * @returns なし
 */
function closeCategoryList(): void {
  const list = document.getElementById("transaction-entry-category-list");
  const trigger = document.getElementById("transaction-entry-category-trigger");
  if (list) {
    list.classList.remove("is-open");
    list.setAttribute("aria-hidden", "true");
  }
  if (trigger) trigger.setAttribute("aria-expanded", "false");
}

/**
 * タグ選択モーダル内の1行（チェック・アイコン・名前）を生成する。
 * @param id - タグ ID
 * @param name - 表示名
 * @param color - アイコン背景色
 * @param iconPath - アイコン画像パス
 * @param isSelected - 初期選択状態
 * @returns 行要素
 */
function createTagSelectItemRow(id: string, name: string, color: string, iconPath: string, isSelected: boolean): HTMLElement {
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
  };
  checkBtn.addEventListener("click", (e) => {
    e.preventDefault();
    handleToggle();
  });
  const iconWrap = createIconWrap(color || ICON_DEFAULT_COLOR, iconPath, { tag: "span" });
  const nameSpan = document.createElement("span");
  nameSpan.className = "transaction-history-select-item-name";
  nameSpan.textContent = name;
  nameSpan.addEventListener("click", () => handleToggle());
  row.appendChild(checkBtn);
  row.appendChild(iconWrap);
  row.appendChild(nameSpan);
  return row;
}

function closeTransactionEntryTagModal(): void {
  closeOverlay("transaction-entry-tag-select-overlay");
  const trigger = document.getElementById("transaction-entry-tag-open-btn");
  if (trigger instanceof HTMLElement) trigger.focus();
}

function getSelectedTagIdsFromModal(): string[] {
  const container = document.getElementById("transaction-entry-tag-select-list");
  if (!container) return [];
  const selected = container.querySelectorAll<HTMLElement>(
    ".transaction-history-select-item .transaction-history-select-check-btn.is-selected"
  );
  return Array.from(selected)
    .map((btn) => btn.closest(".transaction-history-select-item")?.getAttribute("data-id"))
    .filter((id): id is string => id != null);
}

const TAG_CHIP_REMOVE_ICON = "/icon/circle-xmark-solid-full.svg";

function renderTagChosenDisplay(): void {
  const el = document.getElementById("transaction-entry-tag-chosen");
  if (!el) return;
  el.innerHTML = "";
  const tagSortOrderNum = (v: string | undefined): number => (v !== undefined && v !== "" ? Number(v) : 0);
  const sorted = tagRows
    .filter((t) => selectedTagIds.has(t.ID))
    .sort((a, b) => tagSortOrderNum(a.SORT_ORDER) - tagSortOrderNum(b.SORT_ORDER));
  if (sorted.length === 0) {
    el.textContent = "未選択";
    return;
  }
  sorted.forEach((t) => {
    const wrap = document.createElement("span");
    wrap.className = "transaction-history-chosen-label-wrap";
    const bg = (t.COLOR ?? "").trim() || "#646cff";
    wrap.style.backgroundColor = bg;
    wrap.style.color = "#ffffff";
    const label = document.createElement("span");
    label.className = "transaction-history-chosen-label";
    label.textContent = (t.TAG_NAME || "").trim() || "—";
    wrap.appendChild(label);
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "transaction-history-chosen-label-remove";
    removeBtn.setAttribute("aria-label", "選択から削除");
    const removeImg = document.createElement("img");
    removeImg.src = TAG_CHIP_REMOVE_ICON;
    removeImg.alt = "";
    removeBtn.appendChild(removeImg);
    removeBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      selectedTagIds.delete(t.ID);
      renderTagChosenDisplay();
    });
    wrap.appendChild(removeBtn);
    el.appendChild(wrap);
  });
}

function openTransactionEntryTagModal(): void {
  const listBody = document.getElementById("transaction-entry-tag-select-list-body");
  if (!listBody) return;
  listBody.innerHTML = "";
  const tagSortOrderNum = (v: string | undefined): number => (v !== undefined && v !== "" ? Number(v) : 0);
  const sorted = tagRows.slice().sort((a, b) => tagSortOrderNum(a.SORT_ORDER) - tagSortOrderNum(b.SORT_ORDER));
  for (const row of sorted) {
    // SORT_ORDER 順でタグを1行ずつ追加
    const item = createTagSelectItemRow(
      row.ID,
      row.TAG_NAME || "—",
      row.COLOR || ICON_DEFAULT_COLOR,
      row.ICON_PATH || "",
      selectedTagIds.has(row.ID)
    );
    listBody.appendChild(item);
  }
  openOverlay("transaction-entry-tag-select-overlay");
}

/**
 * フォームの現在値から予定取引用の行オブジェクトを組み立てる（発生日計算・完了日モーダル用）。
 */
function buildPlanRowFromForm(): TransactionRow {
  const dateFrom = (document.getElementById("transaction-entry-date-from") as HTMLInputElement)?.value ?? "";
  const dateTo = (document.getElementById("transaction-entry-date-to") as HTMLInputElement)?.value ?? "";
  const frequency = getFrequency();
  const interval = getInterval();
  const cycleUnit = getCycleUnit();
  const amount = (document.getElementById("transaction-entry-amount") as HTMLInputElement)?.value ?? "";
  const completed = (document.getElementById("transaction-entry-completed-plandate") as HTMLInputElement)?.value ?? "";
  return {
    TRANDATE_FROM: dateFrom.trim().slice(0, 10),
    TRANDATE_TO: dateTo.trim().slice(0, 10),
    FREQUENCY: frequency,
    INTERVAL: interval,
    CYCLE_UNIT: cycleUnit,
    AMOUNT: amount.trim(),
    COMPLETED_PLANDATE: completed.trim(),
  } as TransactionRow;
}

/**
 * 予定完了日の選択に応じてステータスを同期する。
 * ・計画中で予定完了日にすべての予定発生日を設定している場合のみ → ステータスを完了に変更（中止のままは変更しない）
 * ・完了で予定完了日にすべての予定発生日を設定していない場合 → ステータスを計画中に変更
 */
function syncPlanStatusFromCompletedDates(): void {
  if (getStatusInput()?.value !== "plan") return;
  const planRow = buildPlanRowFromForm();
  const occurrenceDates = getPlanOccurrenceDates(planRow);
  const input = document.getElementById("transaction-entry-completed-plandate") as HTMLInputElement | null;
  if (!input || occurrenceDates.length === 0) return;
  const raw = (input.value ?? "").trim();
  const completedList = raw
    .split(",")
    .map((s) => s.trim().slice(0, 10))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  const completedSet = new Set(completedList);
  const allSelected = occurrenceDates.every((d) => completedSet.has(d));
  const currentStatus = getPlanStatus();
  if (allSelected && currentStatus === "planning") {
    setPlanStatus("complete");
  } else if (!allSelected && currentStatus === "complete") {
    setPlanStatus("planning");
  }
}

/**
 * 完了日選択エリアに COMPLETED_PLANDATE の日付をチップ表示する（月の対象日チップと同様のレイアウト）。×で選択解除可能。
 */
function renderCompletedDatesChosenDisplay(): void {
  const container = document.getElementById("transaction-entry-completed-dates-chosen");
  const input = document.getElementById("transaction-entry-completed-plandate") as HTMLInputElement | null;
  if (!container || !input) return;
  container.innerHTML = "";
  const raw = (input.value ?? "").trim();
  if (!raw) {
    const empty = document.createElement("span");
    empty.className = "transaction-entry-completed-dates-chips-empty";
    empty.textContent = "完了日なし";
    container.appendChild(empty);
    return;
  }
  const dates = raw
    .split(",")
    .map((s) => s.trim().slice(0, 10))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
  dates.forEach((d) => {
    const chip = document.createElement("span");
    chip.className = "transaction-entry-completed-dates-chip";
    chip.setAttribute("data-date", d);
    chip.textContent = d.replace(/-/g, "/");
    const rm = document.createElement("button");
    rm.type = "button";
    rm.className = "transaction-entry-completed-dates-remove";
    rm.setAttribute("aria-label", "選択解除");
    rm.textContent = "×";
    rm.addEventListener("click", (e) => {
      e.preventDefault();
      const remaining = dates.filter((x) => x !== d);
      if (input) input.value = remaining.join(",");
      renderCompletedDatesChosenDisplay();
      syncPlanStatusFromCompletedDates();
    });
    chip.appendChild(rm);
    container.appendChild(chip);
  });
}

/**
 * 完了日を選択モーダルを開く。フォームの予定内容から発生日一覧を算出し、スケジュールの取引予定日画面と同様の表で表示する。
 */
function openTransactionEntryCompletedDatesModal(): void {
  const row = buildPlanRowFromForm();
  const datesWrap = document.getElementById("transaction-entry-completed-dates-wrap");
  if (!datesWrap) return;

  const dates = getPlanOccurrenceDates(row);
  const completedRaw = (row.COMPLETED_PLANDATE ?? "").trim();
  const completedSet = new Set<string>();
  if (completedRaw) {
    for (const p of completedRaw.split(",").map((s) => s.trim().slice(0, 10))) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(p)) completedSet.add(p);
    }
  }
  const amount = parseFloat(String(row.AMOUNT ?? "0")) || 0;
  const amountFmt = amount === 0 ? "0" : amount.toLocaleString(undefined, { maximumFractionDigits: 0 });

  datesWrap.innerHTML = "";
  if (dates.length === 0) {
    const p = document.createElement("p");
    p.className = "schedule-occurrence-dates-empty";
    p.textContent = "対象日がありません。期間・頻度・繰り返しを設定してください。";
    datesWrap.appendChild(p);
  } else {
    const table = document.createElement("table");
    table.className = "schedule-occurrence-dates-table";
    table.setAttribute("aria-label", "対象日一覧");
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    const thComplete = document.createElement("th");
    thComplete.scope = "col";
    thComplete.textContent = "完了";
    const thDate = document.createElement("th");
    thDate.scope = "col";
    thDate.textContent = "取引予定日";
    const thAmount = document.createElement("th");
    thAmount.scope = "col";
    thAmount.textContent = "金額";
    headerRow.appendChild(thComplete);
    headerRow.appendChild(thDate);
    headerRow.appendChild(thAmount);
    thead.appendChild(headerRow);
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    for (const d of dates) {
      const tr = document.createElement("tr");
      const tdComplete = document.createElement("td");
      const isSelected = completedSet.has(d);
      const checkBtn = document.createElement("button");
      checkBtn.type = "button";
      checkBtn.className = "schedule-occurrence-complete-check-btn";
      checkBtn.setAttribute("data-date", d);
      checkBtn.setAttribute("aria-label", `完了：${d.replace(/-/g, "/")}`);
      checkBtn.setAttribute("aria-pressed", isSelected ? "true" : "false");
      if (isSelected) checkBtn.classList.add("is-selected");
      const checkIcon = document.createElement("span");
      checkIcon.className = "schedule-occurrence-complete-check-icon";
      checkIcon.setAttribute("aria-hidden", "true");
      checkBtn.appendChild(checkIcon);
      const handleToggle = (): void => {
        const pressed = checkBtn.getAttribute("aria-pressed") === "true";
        const next = !pressed;
        checkBtn.setAttribute("aria-pressed", String(next));
        checkBtn.classList.toggle("is-selected", next);
      };
      checkBtn.addEventListener("click", (e) => {
        e.preventDefault();
        handleToggle();
      });
      tdComplete.appendChild(checkBtn);
      const tdDate = document.createElement("td");
      tdDate.className = "schedule-occurrence-dates-date-cell";
      tdDate.textContent = d.replace(/-/g, "/");
      tdDate.addEventListener("click", () => handleToggle());
      const tdAmount = document.createElement("td");
      tdAmount.textContent = amountFmt;
      tdAmount.className = "schedule-occurrence-dates-amount";
      tr.appendChild(tdComplete);
      tr.appendChild(tdDate);
      tr.appendChild(tdAmount);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    datesWrap.appendChild(table);
  }
  openOverlay("transaction-entry-completed-dates-overlay");
}

function closeTransactionEntryCompletedDatesModal(): void {
  closeOverlay("transaction-entry-completed-dates-overlay");
}

/**
 * 実績選択欄に選択中の取引実績を表示する（名称・バツ・カテゴリー色のチップ）。
 */
function renderActualChosenDisplay(): void {
  const container = document.getElementById("transaction-entry-actual-chosen");
  if (!container) return;
  container.innerHTML = "";
  if (selectedActualDisplayInfo.length === 0) {
    container.textContent = "実績なし";
    return;
  }
  selectedActualDisplayInfo.forEach((info) => {
    // 選択中実績ごとにチップ（名称・削除ボタン）を生成して追加
    const wrap = document.createElement("span");
    wrap.className = "transaction-history-chosen-label-wrap";
    const cat = getCategoryById(info.categoryId);
    const bg = (cat?.COLOR ?? "").trim() || "#646cff";
    wrap.style.backgroundColor = bg;
    wrap.style.color = "#ffffff";
    const label = document.createElement("span");
    label.className = "transaction-history-chosen-label";
    label.textContent = info.name;
    wrap.appendChild(label);
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "transaction-history-chosen-label-remove";
    removeBtn.setAttribute("aria-label", "選択から削除");
    const removeImg = document.createElement("img");
    removeImg.src = TAG_CHIP_REMOVE_ICON;
    removeImg.alt = "";
    removeBtn.appendChild(removeImg);
    removeBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      selectedActualIds.delete(info.id);
      selectedActualDisplayInfo = selectedActualDisplayInfo.filter((a) => a.id !== info.id);
      renderActualChosenDisplay();
    });
    wrap.appendChild(removeBtn);
    container.appendChild(wrap);
  });
}

/**
 * 実績選択モーダル内の1行（チェック・カテゴリーアイコン・取引名・日付・金額）を生成する。
 */
function createActualSelectItemRow(row: TransactionRow, isSelected: boolean): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "transaction-history-select-item";
  wrap.dataset.id = row.ID;
  wrap.dataset.name = (row.NAME || "").trim() || "—";
  wrap.dataset.categoryId = row.CATEGORY_ID || "";
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
  wrap.appendChild(checkBtn);
  const cat = getCategoryById(row.CATEGORY_ID);
  if (cat) {
    // カテゴリーアイコンを追加
    const catIconWrap = createIconWrap(cat.COLOR || ICON_DEFAULT_COLOR, cat.ICON_PATH, { tag: "span" });
    catIconWrap.classList.add("transaction-entry-actual-select-category-icon");
    wrap.appendChild(catIconWrap);
  }
  const nameSpan = document.createElement("span");
  nameSpan.className = "transaction-entry-actual-select-name";
  nameSpan.textContent = row.NAME || "—";
  wrap.appendChild(nameSpan);
  const dateSpan = document.createElement("span");
  dateSpan.className = "transaction-entry-actual-select-date";
  dateSpan.textContent = getActualTargetDate(row) || "—";
  wrap.appendChild(dateSpan);
  const amountWrap = document.createElement("span");
  amountWrap.className = "transaction-entry-actual-select-amount-wrap";
  const amountNum = document.createElement("span");
  amountNum.className = "transaction-entry-actual-select-amount-num";
  amountNum.textContent = row.AMOUNT ? Number(row.AMOUNT).toLocaleString() : "—";
  const amountUnit = document.createElement("span");
  amountUnit.className = "transaction-entry-actual-select-amount-unit";
  amountUnit.textContent = row.AMOUNT ? "円" : "";
  amountWrap.appendChild(amountNum);
  amountWrap.appendChild(amountUnit);
  wrap.appendChild(amountWrap);
  const handleRowClick = (): void => {
    const pressed = checkBtn.getAttribute("aria-pressed") === "true";
    const next = !pressed;
    checkBtn.setAttribute("aria-pressed", String(next));
    checkBtn.classList.toggle("is-selected", next);
  };
  checkBtn.addEventListener("click", handleRowClick);
  // 名前・日付・金額クリックでも選択切替
  nameSpan.addEventListener("click", handleRowClick);
  dateSpan.addEventListener("click", handleRowClick);
  amountWrap.addEventListener("click", handleRowClick);
  return wrap;
}

/**
 * 実績選択モーダルで年月を切り替える前に、現在表示中のリストの選択状態を selectedActualIds に反映する。
 * 他月で選択した ID はそのまま残す。
 */
function mergeActualSelectionFromModal(): void {
  const listEl = document.getElementById("transaction-entry-actual-select-list");
  if (!listEl) return;
  const items = listEl.querySelectorAll<HTMLElement>(".transaction-history-select-item");
  const currentListIds = new Set(
    Array.from(items)
      .map((el) => el.getAttribute("data-id"))
      .filter((id): id is string => id != null)
  );
  const selectedInDom = new Set(getSelectedActualIdsFromModal());
  selectedActualIds = new Set([
    ...[...selectedActualIds].filter((id) => !currentListIds.has(id)),
    ...selectedInDom,
  ]);
}

/**
 * 実績選択モーダルのリストと年月ラベルを、actualSelectAllRows と actualSelectYM に従って描画する。
 */
function renderActualSelectList(): void {
  const listEl = document.getElementById("transaction-entry-actual-select-list");
  const ymInput = document.getElementById("transaction-entry-actual-select-ym-label") as HTMLInputElement | null;
  if (!listEl || !actualSelectYM) return;
  const listBody = document.getElementById("transaction-entry-actual-select-list-body");
  if (!listBody) return;
  const range = getMonthDateRange(actualSelectYM);
  if (!range) return;
  if (ymInput) ymInput.value = actualSelectYM;
  const { firstDay, lastDay } = range;
  const inMonth = actualSelectAllRows.filter((r) => {
    const d = getActualTargetDate(r);
    return d >= firstDay && d <= lastDay;
  });
  const sorted = inMonth.slice().sort((a, b) => getActualTargetDate(b).localeCompare(getActualTargetDate(a)));
  listBody.innerHTML = "";
  if (sorted.length === 0) {
    const emptyEl = document.createElement("p");
    emptyEl.className = "transaction-entry-actual-select-empty";
    emptyEl.textContent = "この月は取引実績がありません。";
    listBody.appendChild(emptyEl);
  } else {
    for (const row of sorted) {
      const item = createActualSelectItemRow(row, selectedActualIds.has(row.ID));
      listBody.appendChild(item);
    }
  }
}

function openTransactionEntryActualModal(): void {
  const planType = (getTypeInput()?.value ?? "expense").toLowerCase();
  const today = new Date();
  const initialYM = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  (async () => {
    const [txResult, accList, permList] = await Promise.all([
      fetchTransactionRows(true),
      fetchAccountList(true),
      fetchAccountPermissionList(true),
    ]);
    const visibleIds = getVisibleAccountIds(accList, permList);
    const nonDeleted = getNonDeletedTransactionRows(txResult.rows);
    const txRows = filterTransactionsByVisibleAccounts(nonDeleted, visibleIds);
    const actualRows = txRows.filter(
      (r) =>
        (r.PROJECT_TYPE || "").toLowerCase() === "actual" &&
        (r.TRANSACTION_TYPE || "").toLowerCase() === planType &&
        r.ID !== editingTransactionId
    );
    actualSelectAllRows = actualRows;
    actualSelectYM = initialYM;
    renderActualSelectList();
    openOverlay("transaction-entry-actual-select-overlay");
  })();
}

function getSelectedActualIdsFromModal(): string[] {
  return getSelectedActualsFromModal().map((a) => a.id);
}

/** モーダル内で選択されている実績の id・名称・カテゴリーID を返す。 */
function getSelectedActualsFromModal(): { id: string; name: string; categoryId: string }[] {
  const listEl = document.getElementById("transaction-entry-actual-select-list");
  if (!listEl) return [];
  return Array.from(listEl.querySelectorAll<HTMLElement>(".transaction-history-select-item .transaction-history-select-check-btn.is-selected"))
    .map((btn) => {
      const item = btn.closest(".transaction-history-select-item");
      const id = item?.getAttribute("data-id");
      const name = item?.getAttribute("data-name") ?? "—";
      const categoryId = item?.getAttribute("data-category-id") ?? "";
      return id != null ? { id, name, categoryId } : null;
    })
    .filter((a): a is { id: string; name: string; categoryId: string } => a != null);
}

function closeTransactionEntryActualModal(): void {
  closeOverlay("transaction-entry-actual-select-overlay");
}

/**
 * 予定/実績切替時に実績欄・取引予定日欄の表示・非表示を更新する。
 */
function updateActualRowVisibility(): void {
  const status = getStatusInput()?.value ?? "actual";
  const actualRow = document.getElementById("transaction-entry-actual-row");
  const planDatesRow = document.getElementById("transaction-entry-plan-dates-row");
  if (actualRow) actualRow.hidden = status !== "plan";
  if (planDatesRow) planDatesRow.hidden = status !== "plan";
  if (status === "plan") renderCompletedDatesChosenDisplay();
}

function fillCategorySelect(type: string): void {
  const valueEl = getCategoryValueEl();
  if (!valueEl) return;
  const current = valueEl.value;
  const listEl = document.getElementById("transaction-entry-category-list");
  if (!listEl) return;
  listEl.innerHTML = "";
  const filtered = filterCategoriesByType(type);
  const sortOrderNum = (v: string | undefined): number => (v !== undefined && v !== "" ? Number(v) : 0);
  const sorted = filtered.slice().sort((a, b) => sortOrderNum(a.SORT_ORDER) - sortOrderNum(b.SORT_ORDER));
  const keepCurrent = sorted.some((c) => c.ID === current);
  if (!keepCurrent) {
    valueEl.value = sorted.length > 0 ? sorted[0].ID : "";
  }
  sorted.forEach((c) => {
    // 種別に合うカテゴリーを option として追加
    const option = document.createElement("div");
    option.className = "transaction-entry-category-option";
    option.setAttribute("role", "option");
    option.dataset.categoryId = c.ID;
    const iconWrap = createIconWrap(c.COLOR || ICON_DEFAULT_COLOR, c.ICON_PATH);
    const nameSpan = document.createElement("span");
    nameSpan.className = "transaction-entry-category-option-name";
    nameSpan.textContent = (c.CATEGORY_NAME || "").trim() || "—";
    option.appendChild(iconWrap);
    option.appendChild(nameSpan);
    listEl.appendChild(option);
  });
  updateCategoryTriggerDisplay(valueEl.value);
}

function fillAccountDropdown(which: "out" | "in", visibleIds: Set<string>): void {
  const prefix = which === "out" ? "transaction-entry-account-out" : "transaction-entry-account-in";
  const valueEl = which === "out" ? getAccountOutValueEl() : getAccountInValueEl();
  if (!valueEl) return;
  const listEl = document.getElementById(`${prefix}-list`);
  if (!listEl) return;
  const current = valueEl.value;
  const me = currentUserId;
  const sortOrderNum = (v: string | undefined): number => (v !== undefined && v !== "" ? Number(v) : 0);
  const owned = accountRows.filter((a) => visibleIds.has(a.ID) && a.USER_ID === me);
  const permitted = accountRows.filter((a) => visibleIds.has(a.ID) && a.USER_ID !== me);
  const sorted = [
    ...owned.slice().sort((a, b) => sortOrderNum(a.SORT_ORDER) - sortOrderNum(b.SORT_ORDER)),
    ...permitted.slice().sort((a, b) => sortOrderNum(a.SORT_ORDER) - sortOrderNum(b.SORT_ORDER)),
  ];
  const keepCurrent = sorted.some((a) => a.ID === current);
  if (!keepCurrent) {
    valueEl.value = sorted.length > 0 ? sorted[0].ID : "";
  }
  listEl.innerHTML = "";
  sorted.forEach((a) => {
    // 参照可能な勘定を自分の勘定→共有勘定の順で option 追加
    const option = document.createElement("div");
    option.className = "transaction-entry-account-option";
    option.setAttribute("role", "option");
    option.dataset.accountId = a.ID;
    const iconWrap = createIconWrap(a.COLOR || ICON_DEFAULT_COLOR, a.ICON_PATH);
    const nameSpan = document.createElement("span");
    nameSpan.className = "transaction-entry-account-option-name";
    nameSpan.textContent = (a.ACCOUNT_NAME || "").trim() || "—";
    option.appendChild(iconWrap);
    option.appendChild(nameSpan);
    listEl.appendChild(option);
  });
  updateAccountTriggerDisplay(which, valueEl.value);
}

function fillAccountSelects(visibleIds: Set<string>): void {
  fillAccountDropdown("out", visibleIds);
  fillAccountDropdown("in", visibleIds);
}

function updateAccountRowsVisibility(type: string): void {
  const outRow = document.getElementById("transaction-entry-account-out-row");
  const inRow = document.getElementById("transaction-entry-account-in-row");
  const outVal = getAccountOutValueEl();
  const inVal = getAccountInValueEl();
  if (!outRow || !inRow) return;
  outRow.hidden = type === "income";
  inRow.hidden = type === "expense";
  if (outVal) outVal.required = type === "expense" || type === "transfer";
  if (inVal) inVal.required = type === "income" || type === "transfer";
  if (type === "income" && outVal) {
    // 収入のときは出金元をクリア
    outVal.value = "";
    updateAccountTriggerDisplay("out", "");
  }
  if (type === "expense" && inVal) {
    // 支出のときは入金先をクリア
    inVal.value = "";
    updateAccountTriggerDisplay("in", "");
  }
  fillAccountSelects(editableAccountIds);
}

/**
 * 収支種別に応じた勘定（出金元・入金先）の入力チェックを行う。
 * @returns エラー時はメッセージ、問題なければ null
 */
function validateAccountByType(): string | null {
  const type = (getTypeInput()?.value ?? "").toLowerCase();
  const accountOut = (getAccountOutValueEl()?.value ?? "").trim();
  const accountIn = (getAccountInValueEl()?.value ?? "").trim();
  if (type === "income" && !accountIn) return "入金先を選択してください。";
  if (type === "expense" && !accountOut) return "出金元を選択してください。";
  if (type === "transfer") {
    if (!accountOut && !accountIn) return "出金元と入金先を選択してください。";
    if (!accountOut) return "出金元を選択してください。";
    if (!accountIn) return "入金先を選択してください。";
  }
  return null;
}

function getTypeInput(): HTMLInputElement | null {
  return document.getElementById("transaction-entry-type") as HTMLInputElement | null;
}

function getStatusInput(): HTMLInputElement | null {
  return document.getElementById("transaction-entry-status") as HTMLInputElement | null;
}

function setTypeAndSync(type: string): void {
  const input = getTypeInput();
  if (!input) return;
  input.value = type;
  const typeGroup = document.getElementById("transaction-entry-type-buttons");
  typeGroup?.querySelectorAll(".transaction-history-filter-btn").forEach((btn) => {
    const t = (btn as HTMLElement).getAttribute("data-type");
    btn.classList.toggle("is-active", t === type);
  });
  fillCategorySelect(type);
  updateAccountRowsVisibility(type);
}

function setStatusAndSync(status: string): void {
  const normalized = status === "plan" ? "plan" : "actual";
  const input = getStatusInput();
  if (!input) return;
  input.value = normalized;
  const statusGroup = document.getElementById("transaction-entry-status-buttons");
  statusGroup?.querySelectorAll(".transaction-history-filter-btn").forEach((btn) => {
    const s = (btn as HTMLElement).getAttribute("data-status");
    btn.classList.toggle("is-active", s === normalized);
  });
  if (normalized === "actual") {
    setFrequency("day");
    setInterval(0);
    setCycleUnit("");
    setPlanStatus("complete");
  } else {
    setPlanStatus("planning");
  }
  updateDateRowsVisibility(normalized);
  updatePlanOnlyRowsVisibility(normalized);
  updateActualRowVisibility();
}

const todayYMD = (): string => new Date().toISOString().slice(0, 10);

const WEEKDAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;
const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

function getFrequency(): string {
  const btn = document.querySelector("#transaction-entry-frequency-buttons .transaction-history-filter-btn.is-active");
  return (btn as HTMLElement)?.getAttribute("data-frequency") ?? "day";
}

function setFrequency(frequency: string): void {
  const normalized = ["day", "daily", "weekly", "monthly", "yearly"].includes(frequency) ? frequency : "day";
  document.querySelectorAll("#transaction-entry-frequency-buttons .transaction-history-filter-btn").forEach((b) => {
    const el = b as HTMLElement;
    el.classList.toggle("is-active", el.getAttribute("data-frequency") === normalized);
  });
  updateFrequencyDependentVisibility(normalized);
}

function getInterval(): string {
  const el = document.getElementById("transaction-entry-interval") as HTMLInputElement | null;
  const v = el?.value?.trim() ?? "1";
  const n = parseInt(v, 10);
  return Number.isNaN(n) || n < 0 ? "1" : String(n);
}

function setInterval(value: number): void {
  const el = document.getElementById("transaction-entry-interval") as HTMLInputElement | null;
  if (el) el.value = String(Math.max(0, value));
}

function getCycleUnit(): string {
  const freq = getFrequency();
  if (freq === "day" || freq === "daily") return "";
  if (freq === "weekly") {
    const selected = Array.from(document.querySelectorAll("#transaction-entry-cycle-content .transaction-history-filter-btn.is-active"))
      .map((b) => (b as HTMLElement).getAttribute("data-weekday"))
      .filter((s): s is string => !!s);
    return selected.sort((a, b) => WEEKDAY_CODES.indexOf(a as typeof WEEKDAY_CODES[number]) - WEEKDAY_CODES.indexOf(b as typeof WEEKDAY_CODES[number])).join(",");
  }
  if (freq === "monthly") {
    const arr = Array.from(selectedMonthlyDays)
      .map((s) => parseInt(s, 10))
      .sort((a, b) => a - b)
      .map((n) => String(n));
    return arr.join(",");
  }
  if (freq === "yearly") {
    const items = document.querySelectorAll("#transaction-entry-cycle-yearly-list [data-mmdd]");
    return Array.from(items)
      .map((el) => (el as HTMLElement).getAttribute("data-mmdd"))
      .filter((s): s is string => !!s)
      .sort()
      .join(",");
  }
  return "";
}

function setCycleUnit(cycleUnit: string): void {
  const freq = getFrequency();
  if (freq === "day" || freq === "daily") return;
  const parts = cycleUnit ? cycleUnit.split(",").map((s) => s.trim()).filter(Boolean) : [];
  if (freq === "weekly") {
    const set = new Set(parts);
    document.querySelectorAll("#transaction-entry-cycle-content .transaction-history-filter-btn").forEach((b) => {
      const el = b as HTMLElement;
      el.classList.toggle("is-active", set.has(el.getAttribute("data-weekday") ?? ""));
    });
    return;
  }
  if (freq === "monthly") {
    selectedMonthlyDays = new Set(parts);
    updateMonthlyChipsDisplay();
    return;
  }
  if (freq === "yearly") {
    const listEl = document.getElementById("transaction-entry-cycle-yearly-list");
    if (!listEl) return;
    listEl.innerHTML = "";
    parts.forEach((mmdd) => {
      if (mmdd.length === 4) {
        const m = mmdd.slice(0, 2);
        const d = mmdd.slice(2, 4);
        const li = document.createElement("span");
        li.className = "transaction-entry-cycle-yearly-chip";
        li.setAttribute("data-mmdd", mmdd);
        li.textContent = `${m}月${d}日`;
        const rm = document.createElement("button");
        rm.type = "button";
        rm.className = "transaction-entry-cycle-yearly-remove";
        rm.setAttribute("aria-label", "削除");
        rm.textContent = "×";
        rm.addEventListener("click", () => {
          li.remove();
          updateYearlyListEmptyState();
        });
        li.appendChild(rm);
        listEl.appendChild(li);
      }
    });
    updateYearlyListEmptyState();
  }
}

function updateYearlyListEmptyState(): void {
  const listEl = document.getElementById("transaction-entry-cycle-yearly-list");
  if (!listEl) return;
  const hasChips = listEl.querySelectorAll("[data-mmdd]").length > 0;
  const emptyEl = listEl.querySelector(".transaction-entry-cycle-yearly-list-empty");
  if (hasChips) {
    if (emptyEl) emptyEl.remove();
  } else {
    if (!emptyEl) {
      const span = document.createElement("span");
      span.className = "transaction-entry-cycle-yearly-list-empty";
      span.textContent = "繰り返し日なし";
      listEl.appendChild(span);
    }
  }
}

function getPlanStatus(): string {
  const btn = document.querySelector("#transaction-entry-plan-status-buttons .transaction-history-filter-btn.is-active");
  const v = (btn as HTMLElement)?.getAttribute("data-plan-status") ?? "planning";
  return ["planning", "complete", "canceled"].includes(v) ? v : "planning";
}

function setPlanStatus(planStatus: string): void {
  const normalized = ["planning", "complete", "canceled"].includes(planStatus) ? planStatus : "planning";
  document.querySelectorAll("#transaction-entry-plan-status-buttons .transaction-history-filter-btn").forEach((b) => {
    const el = b as HTMLElement;
    el.classList.toggle("is-active", el.getAttribute("data-plan-status") === normalized);
  });
}

const FREQUENCY_LABELS: Record<string, string> = {
  day: "1日",
  daily: "日ごと",
  weekly: "週ごと",
  monthly: "月ごと",
  yearly: "年ごと",
};

const MONTHLY_SPECIAL_LABELS: Record<string, string> = {
  "-1": "月末",
  "-2": "月末の1日前",
  "-3": "月末の2日前",
};

function getMonthlyDayLabel(value: string): string {
  const n = parseInt(value, 10);
  if (n >= 1 && n <= 31) return `${n}日`;
  return MONTHLY_SPECIAL_LABELS[value] ?? value;
}

function updateIntervalFrequencyLabel(frequency: string): void {
  const el = document.getElementById("transaction-entry-interval-frequency-label");
  if (el) el.textContent = FREQUENCY_LABELS[frequency] ?? "";
}

/** 間隔欄は頻度が1日以外のとき表示、繰り返し欄は1日・日ごと以外のとき表示 */
function updateFrequencyDependentVisibility(frequency: string): void {
  const intervalRow = document.getElementById("transaction-entry-interval-row");
  const cycleRow = document.getElementById("transaction-entry-cycle-row");
  const intervalInput = document.getElementById("transaction-entry-interval") as HTMLInputElement | null;
  if (intervalRow) intervalRow.hidden = frequency === "day";
  if (frequency === "day" && intervalInput) intervalInput.value = "0";
  if (cycleRow) cycleRow.hidden = frequency === "day" || frequency === "daily";
  updateIntervalFrequencyLabel(frequency);
  if (!cycleRow?.hidden) renderCycleContent(frequency);
}

/** 月ごとの繰り返しで選択した対象日のチップ表示を更新する。 */
function updateMonthlyChipsDisplay(): void {
  const chipsEl = document.getElementById("transaction-entry-cycle-monthly-chips");
  if (!chipsEl) return;
  chipsEl.innerHTML = "";
  const sorted = Array.from(selectedMonthlyDays)
    .map((s) => parseInt(s, 10))
    .sort((a, b) => a - b)
    .map((n) => String(n));
  if (sorted.length === 0) {
    const empty = document.createElement("span");
    empty.className = "transaction-entry-cycle-monthly-chips-empty";
    empty.textContent = "対象日なし";
    chipsEl.appendChild(empty);
    return;
  }
  sorted.forEach((value) => {
    const chip = document.createElement("span");
    chip.className = "transaction-entry-cycle-monthly-chip";
    chip.setAttribute("data-monthday", value);
    chip.textContent = getMonthlyDayLabel(value);
    const rm = document.createElement("button");
    rm.type = "button";
    rm.className = "transaction-entry-cycle-monthly-remove";
    rm.setAttribute("aria-label", "削除");
    rm.textContent = "×";
    rm.addEventListener("click", () => {
      selectedMonthlyDays.delete(value);
      updateMonthlyChipsDisplay();
    });
    chip.appendChild(rm);
    chipsEl.appendChild(chip);
  });
}

const TRANSACTION_ENTRY_CYCLE_MONTHLY_OVERLAY_ID = "transaction-entry-cycle-monthly-select-overlay";

/** 月ごと「対象日を選択」ポップアップのグリッドを組み立てて表示する。 */
function openTransactionEntryCycleMonthlySelectOverlay(): void {
  const gridEl = document.getElementById("transaction-entry-cycle-monthly-select-grid");
  if (!gridEl) return;
  gridEl.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "transaction-entry-cycle-month-select-inner";
  const daysGrid = document.createElement("div");
  daysGrid.className = "transaction-entry-cycle-month-days-grid";
  for (let d = 1; d <= 31; d++) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-secondary transaction-history-filter-btn transaction-entry-cycle-month-day";
    btn.setAttribute("data-monthday", String(d));
    btn.textContent = String(d);
    btn.classList.toggle("is-active", selectedMonthlyDays.has(String(d)));
    btn.addEventListener("click", () => btn.classList.toggle("is-active", !btn.classList.contains("is-active")));
    daysGrid.appendChild(btn);
  }
  wrap.appendChild(daysGrid);
  const specialRow = document.createElement("div");
  specialRow.className = "transaction-entry-cycle-month-special";
  ["月末", "月末の1日前", "月末の2日前"].forEach((label, i) => {
    const value = String(-1 - i);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-secondary transaction-history-filter-btn";
    btn.setAttribute("data-monthday", value);
    btn.textContent = label;
    btn.classList.toggle("is-active", selectedMonthlyDays.has(value));
    btn.addEventListener("click", () => btn.classList.toggle("is-active", !btn.classList.contains("is-active")));
    specialRow.appendChild(btn);
  });
  wrap.appendChild(specialRow);
  gridEl.appendChild(wrap);
  openOverlay(TRANSACTION_ENTRY_CYCLE_MONTHLY_OVERLAY_ID);
}

/** 月ごと対象日選択ポップアップで「設定」を押したときの処理。 */
function applyTransactionEntryCycleMonthlySelect(): void {
  const gridEl = document.getElementById("transaction-entry-cycle-monthly-select-grid");
  if (!gridEl) return;
  const selected = Array.from(gridEl.querySelectorAll<HTMLElement>(".transaction-history-filter-btn.is-active"))
    .map((el) => el.getAttribute("data-monthday"))
    .filter((s): s is string => !!s);
  selectedMonthlyDays = new Set(selected);
  updateMonthlyChipsDisplay();
  closeOverlay(TRANSACTION_ENTRY_CYCLE_MONTHLY_OVERLAY_ID);
}

function renderCycleContent(frequency: string): void {
  const container = document.getElementById("transaction-entry-cycle-content");
  if (!container) return;
  container.innerHTML = "";
  if (frequency === "weekly") {
    WEEKDAY_CODES.forEach((code, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn-secondary transaction-history-filter-btn";
      btn.setAttribute("data-weekday", code);
      btn.textContent = WEEKDAY_LABELS[i];
      btn.addEventListener("click", () => {
        btn.classList.toggle("is-active", !btn.classList.contains("is-active"));
      });
      container.appendChild(btn);
    });
    return;
  }
  if (frequency === "monthly") {
    const monthWrap = document.createElement("div");
    monthWrap.className = "transaction-entry-cycle-month-wrap transaction-entry-cycle-month-wrap--button";
    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.className = "btn-secondary transaction-entry-cycle-monthly-open-btn";
    openBtn.textContent = "対象日を選択";
    openBtn.addEventListener("click", () => openTransactionEntryCycleMonthlySelectOverlay());
    monthWrap.appendChild(openBtn);
    const chipsWrap = document.createElement("div");
    chipsWrap.id = "transaction-entry-cycle-monthly-chips";
    chipsWrap.className = "transaction-entry-cycle-monthly-chips";
    monthWrap.appendChild(chipsWrap);
    container.appendChild(monthWrap);
    updateMonthlyChipsDisplay();
    return;
  }
  if (frequency === "yearly") {
    const wrap = document.createElement("div");
    wrap.className = "transaction-entry-cycle-yearly-wrap";
    const addRow = document.createElement("div");
    addRow.className = "transaction-entry-cycle-yearly-add";
    const monthSelect = document.createElement("select");
    monthSelect.className = "transaction-entry-cycle-yearly-month";
    monthSelect.setAttribute("aria-label", "月");
    const monthPlaceholder = document.createElement("option");
    monthPlaceholder.value = "";
    monthPlaceholder.textContent = "月";
    monthSelect.appendChild(monthPlaceholder);
    for (let m = 1; m <= 12; m++) {
      const opt = document.createElement("option");
      opt.value = String(m);
      opt.textContent = `${m}月`;
      monthSelect.appendChild(opt);
    }
    const daySelect = document.createElement("select");
    daySelect.className = "transaction-entry-cycle-yearly-day";
    daySelect.setAttribute("aria-label", "日");
    const dayPlaceholder = document.createElement("option");
    dayPlaceholder.value = "";
    dayPlaceholder.textContent = "日";
    daySelect.appendChild(dayPlaceholder);
    for (let d = 1; d <= 31; d++) {
      const opt = document.createElement("option");
      opt.value = String(d);
      opt.textContent = `${d}日`;
      daySelect.appendChild(opt);
    }
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "btn-secondary";
    addBtn.textContent = "追加";
    addBtn.addEventListener("click", () => {
      const m = parseInt(monthSelect.value, 10);
      const d = parseInt(daySelect.value, 10);
      if (Number.isNaN(m) || m < 1 || m > 12 || Number.isNaN(d) || d < 1 || d > 31) return;
      const mmdd = `${String(m).padStart(2, "0")}${String(d).padStart(2, "0")}`;
      if (document.querySelector(`#transaction-entry-cycle-yearly-list [data-mmdd="${mmdd}"]`)) return;
      const li = document.createElement("span");
      li.className = "transaction-entry-cycle-yearly-chip";
      li.setAttribute("data-mmdd", mmdd);
      li.textContent = `${m}月${d}日`;
      const rm = document.createElement("button");
      rm.type = "button";
      rm.className = "transaction-entry-cycle-yearly-remove";
      rm.setAttribute("aria-label", "削除");
      rm.textContent = "×";
      rm.addEventListener("click", () => {
        li.remove();
        updateYearlyListEmptyState();
      });
      li.appendChild(rm);
      listEl.appendChild(li);
      monthSelect.value = "";
      daySelect.value = "";
      updateYearlyListEmptyState();
    });
    addRow.appendChild(monthSelect);
    addRow.appendChild(daySelect);
    addRow.appendChild(addBtn);
    wrap.appendChild(addRow);
    const listEl = document.createElement("div");
    listEl.id = "transaction-entry-cycle-yearly-list";
    listEl.className = "transaction-entry-cycle-yearly-list";
    wrap.appendChild(listEl);
    container.appendChild(wrap);
    updateYearlyListEmptyState();
  }
}

function updatePlanOnlyRowsVisibility(status: string): void {
  const isPlan = status === "plan";
  const view = document.getElementById("view-transaction-entry");
  view?.querySelectorAll(".transaction-entry-plan-only").forEach((el) => {
    const htmlEl = el as HTMLElement;
    if (isPlan) {
      htmlEl.removeAttribute("hidden");
    } else {
      htmlEl.setAttribute("hidden", "");
    }
  });
  if (isPlan) updateFrequencyDependentVisibility(getFrequency());
}

function updateDateRowsVisibility(status: string): void {
  const actualWrap = document.getElementById("transaction-entry-date-actual-wrap");
  const planWrap = document.getElementById("transaction-entry-date-plan-wrap");
  const dateInput = document.getElementById("transaction-entry-date") as HTMLInputElement | null;
  const dateFromInput = document.getElementById("transaction-entry-date-from") as HTMLInputElement | null;
  const dateToInput = document.getElementById("transaction-entry-date-to") as HTMLInputElement | null;
  if (!actualWrap || !planWrap) return;
  const isPlan = status === "plan";
  actualWrap.hidden = isPlan;
  planWrap.hidden = !isPlan;
  if (dateInput) dateInput.required = !isPlan;
  if (dateFromInput) dateFromInput.required = isPlan;
  if (dateToInput) dateToInput.required = isPlan;
  if (isPlan && dateFromInput && dateToInput) {
    const d = dateInput?.value?.trim() || todayYMD();
    if (!dateFromInput.value) dateFromInput.value = d;
    if (!dateToInput.value) dateToInput.value = d;
  }
  if (!isPlan && dateInput && !dateInput.value) dateInput.value = todayYMD();
  updatePlanOnlyRowsVisibility(status);
  updateActualRowVisibility();
}

function setTodayToAllDateInputs(): void {
  const t = todayYMD();
  const dateInput = document.getElementById("transaction-entry-date") as HTMLInputElement | null;
  const dateFromInput = document.getElementById("transaction-entry-date-from") as HTMLInputElement | null;
  const dateToInput = document.getElementById("transaction-entry-date-to") as HTMLInputElement | null;
  if (dateInput) dateInput.value = t;
  if (dateFromInput) dateFromInput.value = t;
  if (dateToInput) dateToInput.value = t;
}

function ensureSingleSelection(): void {
  const typeInput = getTypeInput();
  const statusInput = getStatusInput();
  const validTypes = ["expense", "income", "transfer"];
  const validStatuses = ["plan", "actual"];
  const type = typeInput?.value && validTypes.includes(typeInput.value) ? typeInput.value : "expense";
  const status = statusInput?.value && validStatuses.includes(statusInput.value) ? statusInput.value : "actual";
  setTypeAndSync(type);
  setStatusAndSync(status);
}

function resetForm(): void {
  const form = document.getElementById("transaction-entry-form") as HTMLFormElement | null;
  if (form) form.reset();
  const categoryEl = getCategoryValueEl();
  const accountOutEl = getAccountOutValueEl();
  const accountInEl = getAccountInValueEl();
  if (categoryEl) categoryEl.value = "";
  if (accountOutEl) accountOutEl.value = "";
  if (accountInEl) accountInEl.value = "";
  updateCategoryTriggerDisplay("");
  setTypeAndSync("expense");
  setStatusAndSync("actual");
  setPlanStatus("planning");
  setFrequency("day");
  setInterval(1);
  setCycleUnit("");
  selectedMonthlyDays = new Set();
  setTodayToAllDateInputs();
  updateAccountTriggerDisplay("out", getAccountOutValueEl()?.value ?? "");
  updateAccountTriggerDisplay("in", getAccountInValueEl()?.value ?? "");
  selectedTagIds.clear();
  selectedActualIds.clear();
  selectedActualDisplayInfo = [];
  const completedEl = document.getElementById("transaction-entry-completed-plandate") as HTMLInputElement | null;
  if (completedEl) completedEl.value = "";
  renderTagChosenDisplay();
  renderActualChosenDisplay();
  renderCompletedDatesChosenDisplay();
  updateActualRowVisibility();
}

/**
 * プルダウンに表示される勘定のうち先頭の ID を返す（権限 edit のもののみ対象）。
 * @param _which - "out" | "in"（未使用・呼び出し元でどちらの列か判別用）
 * @returns 勘定 ID または空文字
 */
function getFirstEditableAccountId(_which: "out" | "in"): string {
  const sorted = accountRows
    .filter((a) => editableAccountIds.has(a.ID))
    .sort((a, b) => (a.ACCOUNT_NAME || "").localeCompare(b.ACCOUNT_NAME || ""));
  return sorted.length > 0 ? sorted[0].ID : "";
}

function updateTransactionEntryDeleteButtonVisibility(): void {
  const btn = document.getElementById("header-transaction-entry-delete");
  if (btn) btn.classList.toggle("is-visible", !!editingTransactionId && !transactionEntryViewOnly);
}

function updateTransactionEntrySubmitButtonVisibility(): void {
  const btn = document.getElementById("header-transaction-entry-submit");
  if (!btn) return;
  const showSubmit = !editingTransactionId || !transactionEntryViewOnly;
  btn.classList.toggle("is-visible", showSubmit);
  const isNew = !editingTransactionId;
  btn.textContent = isNew ? "登録" : "更新";
  btn.classList.toggle("transaction-entry-submit--register", isNew);
  btn.classList.toggle("transaction-entry-submit--update", !isNew);
  btn.setAttribute("aria-label", isNew ? "登録" : "更新");
}

function updateTransactionEntryContinuousButtonVisibility(): void {
  const btn = document.getElementById("header-transaction-entry-continuous");
  if (!btn) return;
  const isNewEntry = !editingTransactionId;
  btn.classList.toggle("is-visible", isNewEntry);
  btn.classList.toggle("is-on", continuousMode);
}

function updateTransactionEntryCopyAsNewButtonVisibility(): void {
  const btn = document.getElementById("header-transaction-entry-copy-as-new");
  if (btn) btn.classList.toggle("is-visible", !!editingTransactionId && !transactionEntryViewOnly);
}

/** 参照モード時: テキスト・入力・プルダウン・ボタンを readonly / disabled にする */
function setTransactionEntryReadonly(readonly: boolean): void {
  const form = document.getElementById("transaction-entry-form");
  form?.classList.toggle("is-readonly", readonly);

  const notice = document.getElementById("transaction-entry-view-only-notice");
  if (notice) {
    notice.classList.toggle("is-visible", readonly);
    notice.setAttribute("aria-hidden", String(!readonly));
  }

  const textInputIds = ["transaction-entry-name", "transaction-entry-amount", "transaction-entry-date", "transaction-entry-date-from", "transaction-entry-date-to"];
  for (const id of textInputIds) {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (el) el.readOnly = readonly;
  }
  const memoEl = document.getElementById("transaction-entry-memo") as HTMLTextAreaElement | null;
  if (memoEl) memoEl.readOnly = readonly;

  const triggerIds = [
    "transaction-entry-category-trigger",
    "transaction-entry-account-out-trigger",
    "transaction-entry-account-in-trigger",
    "transaction-entry-tag-open-btn",
    "transaction-entry-actual-open-btn",
    "transaction-entry-completed-dates-open-btn",
    "transaction-entry-type-expense",
    "transaction-entry-type-income",
    "transaction-entry-type-transfer",
    "transaction-entry-status-plan",
    "transaction-entry-status-actual",
    "header-transaction-entry-reset",
  ];
  for (const id of triggerIds) {
    const el = document.getElementById(id) as HTMLButtonElement | null;
    if (el) el.disabled = readonly;
  }
}

async function loadFormForEdit(transactionId: string): Promise<void> {
  const [tagMgmtResult, txMgmtResult, txResult] = await Promise.all([
    fetchTransactionTagRows(true),
    fetchTransactionManagementRows(true),
    fetchTransactionRows(true),
  ]);
  const txRows = getNonDeletedTransactionRows(txResult.rows);
  const row = txRows.find((r) => r.ID === transactionId);
  if (!row) return;
  const type = row.TRANSACTION_TYPE || "expense";
  const status = row.PROJECT_TYPE || "actual";
  setTypeAndSync(type);
  setStatusAndSync(status);
  const categoryEl = getCategoryValueEl();
  if (categoryEl) {
    categoryEl.value = row.CATEGORY_ID || "";
    updateCategoryTriggerDisplay(row.CATEGORY_ID || "");
  }
  const nameEl = document.getElementById("transaction-entry-name") as HTMLInputElement | null;
  if (nameEl) nameEl.value = row.NAME || "";
  const dateEl = document.getElementById("transaction-entry-date") as HTMLInputElement | null;
  const dateFromEl = document.getElementById("transaction-entry-date-from") as HTMLInputElement | null;
  const dateToEl = document.getElementById("transaction-entry-date-to") as HTMLInputElement | null;
  const from = row.TRANDATE_FROM || "";
  const to = row.TRANDATE_TO || "";
  if (status === "plan") {
    if (dateFromEl) dateFromEl.value = from;
    if (dateToEl) dateToEl.value = to;
    if (dateEl) dateEl.value = from;
    setPlanStatus(row.PLAN_STATUS ?? "planning");
    const frequency = (row.FREQUENCY ?? "day").toLowerCase();
    setFrequency(frequency);
    const intervalNum = parseInt(row.INTERVAL ?? "1", 10);
    setInterval(Number.isNaN(intervalNum) || intervalNum < 0 ? 1 : intervalNum);
    setCycleUnit(row.CYCLE_UNIT ?? "");
    requestAnimationFrame(() => {
      updateFrequencyDependentVisibility(getFrequency());
      setCycleUnit(row.CYCLE_UNIT ?? "");
    });
  } else {
    if (dateEl) dateEl.value = from;
    if (dateFromEl) dateFromEl.value = from;
    if (dateToEl) dateToEl.value = to;
  }
  const amountEl = document.getElementById("transaction-entry-amount") as HTMLInputElement | null;
  if (amountEl) amountEl.value = row.AMOUNT || "";
  const memoEl = document.getElementById("transaction-entry-memo") as HTMLTextAreaElement | null;
  if (memoEl) memoEl.value = row.MEMO || "";
  const accountInEl = getAccountInValueEl();
  const accountOutEl = getAccountOutValueEl();
  if (accountInEl) accountInEl.value = row.ACCOUNT_ID_IN || "";
  if (accountOutEl) accountOutEl.value = row.ACCOUNT_ID_OUT || "";
  fillCategorySelect(type);
  // 編集時は取引の勘定をドロップダウンに含める（権限付与の参照のみ勘定でも正しく表示するため）
  const accountIdsForSelect = new Set(editableAccountIds);
  if ((row.ACCOUNT_ID_IN || "").trim()) accountIdsForSelect.add((row.ACCOUNT_ID_IN || "").trim());
  if ((row.ACCOUNT_ID_OUT || "").trim()) accountIdsForSelect.add((row.ACCOUNT_ID_OUT || "").trim());
  fillAccountSelects(accountIdsForSelect);
  updateAccountRowsVisibility(type);
  // 編集時: updateAccountRowsVisibility 内の fillAccountSelects(editableAccountIds) で勘定が上書きされるため、取引の勘定を再反映する（参照のみ勘定でも正しく表示）
  if (accountInEl) accountInEl.value = row.ACCOUNT_ID_IN || "";
  if (accountOutEl) accountOutEl.value = row.ACCOUNT_ID_OUT || "";
  if (type === "expense") {
    const firstIn = getFirstEditableAccountId("in");
    if (accountInEl) accountInEl.value = firstIn;
    updateAccountTriggerDisplay("out", row.ACCOUNT_ID_OUT || "");
    updateAccountTriggerDisplay("in", firstIn);
  } else if (type === "income") {
    const firstOut = getFirstEditableAccountId("out");
    if (accountOutEl) accountOutEl.value = firstOut;
    updateAccountTriggerDisplay("out", firstOut);
    updateAccountTriggerDisplay("in", row.ACCOUNT_ID_IN || "");
  } else {
    updateAccountTriggerDisplay("out", row.ACCOUNT_ID_OUT || "");
    updateAccountTriggerDisplay("in", row.ACCOUNT_ID_IN || "");
  }
  const mgmtRows = tagMgmtResult.rows;
  const txMgmtRows = txMgmtResult.rows;
  selectedTagIds = new Set(
    mgmtRows.filter((r) => r.TRANSACTION_ID === transactionId).map((r) => r.TAG_ID)
  );
  selectedActualIds = new Set(
    txMgmtRows.filter((r) => r.TRAN_PLAN_ID === transactionId).map((r) => r.TRAN_ACTUAL_ID)
  );
  selectedActualDisplayInfo = Array.from(selectedActualIds)
    .map((id) => {
      const r = txRows.find((row) => row.ID === id);
      return r
        ? { id: r.ID, name: (r.NAME || "").trim() || "—", categoryId: r.CATEGORY_ID || "" }
        : null;
    })
    .filter((x): x is { id: string; name: string; categoryId: string } => x != null);
  if (status === "plan") {
    const completedEl = document.getElementById("transaction-entry-completed-plandate") as HTMLInputElement | null;
    if (completedEl) completedEl.value = row.COMPLETED_PLANDATE ?? "";
    renderCompletedDatesChosenDisplay();
  }
  renderTagChosenDisplay();
  renderActualChosenDisplay();
  updateActualRowVisibility();
}

async function loadOptions(): Promise<void> {
  const [categories, accounts, permissions, tags] = await Promise.all([
    fetchCategoryList(true),
    fetchAccountList(true),
    fetchAccountPermissionList(true),
    fetchTagList(true),
  ]);
  categoryRows = categories;
  accountRows = accounts;
  permissionRows = permissions;
  tagRows = tags;
  visibleAccountIds = getVisibleAccountIds(accountRows, permissionRows);
  void visibleAccountIds; // 参照可能勘定を保持（フィルタ等で利用予定）
  editableAccountIds = getEditableAccountIds(accountRows, permissionRows);
  const typeInput = getTypeInput();
  const type = typeInput?.value ?? "expense";
  fillCategorySelect(type);
  fillAccountSelects(editableAccountIds);
  updateAccountRowsVisibility(type);
  renderTagChosenDisplay();
}

/**
 * 予定完了日（COMPLETED_PLANDATE）の文字列を、予定発生日に含まれる日付のみに絞り込む。
 * 期間・頻度・繰り返しを変更した結果、発生日に含まれなくなった日付は登録されないようにする。
 */
function filterCompletedPlanDateToOccurrenceDates(
  trFrom: string,
  trTo: string,
  frequency: string,
  interval: string,
  cycleUnit: string,
  completedPlanDateRaw: string
): string {
  const from = trFrom.trim().slice(0, 10);
  const to = trTo.trim().slice(0, 10);
  if (!from || !to || from > to) return "";
  const planRow = {
    TRANDATE_FROM: from,
    TRANDATE_TO: to,
    FREQUENCY: frequency,
    INTERVAL: interval,
    CYCLE_UNIT: cycleUnit,
  } as TransactionRow;
  const occurrenceDates = getPlanOccurrenceDates(planRow);
  const occurrenceSet = new Set(occurrenceDates);
  const completed = completedPlanDateRaw
    .split(",")
    .map((s) => s.trim().slice(0, 10))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  const filtered = completed.filter((d) => occurrenceSet.has(d));
  return filtered.sort().join(",");
}

/**
 * 予定完了日とステータスを整合させる。
 * ・実績取引の取引日が予定発生日なら予定完了日に追加（既存紐づけ＋フォームで選択中の実績）
 * ・ステータスが完了で予定完了日に全発生日が無い場合は計画中に
 * ・ステータスが完了のときは予定完了日に全発生日を設定
 * ・ステータスが計画中で予定完了日に全発生日を選択している場合は完了に
 */
function resolveCompletedPlanDateAndStatus(
  occurrenceDates: string[],
  completedPlanDate: string,
  planStatus: string,
  planId: string | null,
  selectedActualDates?: string[]
): { completedPlanDate: string; planStatus: string } {
  const occurrenceSet = new Set(occurrenceDates);
  const completedList = completedPlanDate
    .split(",")
    .map((s) => s.trim().slice(0, 10))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && occurrenceSet.has(d));
  const completedSet = new Set(completedList);

  if (planId) {
    for (const actual of getActualTransactionsForPlan(planId)) {
      const d = getActualTargetDate(actual).slice(0, 10);
      if (d && occurrenceSet.has(d)) completedSet.add(d);
    }
  }
  if (selectedActualDates?.length) {
    for (const d of selectedActualDates) {
      const ymd = d.trim().slice(0, 10);
      if (ymd && /^\d{4}-\d{2}-\d{2}$/.test(ymd) && occurrenceSet.has(ymd)) completedSet.add(ymd);
    }
  }
  let completed = [...completedSet].sort().join(",");
  let status = (planStatus || "planning").toLowerCase();

  if (occurrenceDates.length === 0) return { completedPlanDate: completed, planStatus: status };

  const allSelected =
    occurrenceDates.length > 0 && occurrenceDates.every((d) => completedSet.has(d));
  if (status === "complete" && !allSelected) status = "planning";
  if (status === "complete") completed = occurrenceDates.slice().sort().join(",");
  if (status === "planning" && allSelected) status = "complete";

  return { completedPlanDate: completed, planStatus: status };
}

function buildNewRow(
  form: HTMLFormElement,
  nextId: number,
  allTransactionRows?: TransactionRow[]
): Record<string, string> {
  const type = (form.querySelector("#transaction-entry-type") as HTMLInputElement)?.value ?? "expense";
  const status = (form.querySelector("#transaction-entry-status") as HTMLInputElement)?.value ?? "actual";
  const categoryId = (form.querySelector("#transaction-entry-category") as HTMLInputElement)?.value ?? "";
  const name = ((form.querySelector("#transaction-entry-name") as HTMLInputElement)?.value ?? "").trim();
  const date = (form.querySelector("#transaction-entry-date") as HTMLInputElement)?.value ?? "";
  const dateFrom = (form.querySelector("#transaction-entry-date-from") as HTMLInputElement)?.value ?? "";
  const dateTo = (form.querySelector("#transaction-entry-date-to") as HTMLInputElement)?.value ?? "";
  const amount = ((form.querySelector("#transaction-entry-amount") as HTMLInputElement)?.value ?? "").trim();
  const memo = ((form.querySelector("#transaction-entry-memo") as HTMLTextAreaElement)?.value ?? "").trim();
  const accountIn = (form.querySelector("#transaction-entry-account-in") as HTMLInputElement)?.value ?? "";
  const accountOut = (form.querySelector("#transaction-entry-account-out") as HTMLInputElement)?.value ?? "";
  const userId = currentUserId ?? "";
  const trFrom = status === "plan" ? dateFrom : date;
  const trTo = status === "plan" ? dateTo : date;
  const frequency = status === "plan" ? getFrequency() : "day";
  const interval = status === "plan" ? (frequency === "day" ? "0" : getInterval()) : "1";
  const cycleUnit = status === "plan" ? getCycleUnit() : "";
  let planStatus = status === "plan" ? getPlanStatus() : "complete";
  const completedPlanDateRaw = status === "plan" ? ((form.querySelector("#transaction-entry-completed-plandate") as HTMLInputElement)?.value ?? "").trim() : "";
  let completedPlanDate =
    status === "plan"
      ? filterCompletedPlanDateToOccurrenceDates(trFrom, trTo, frequency, interval, cycleUnit, completedPlanDateRaw)
      : "";
  if (status === "plan") {
    const planRow = {
      TRANDATE_FROM: trFrom,
      TRANDATE_TO: trTo,
      FREQUENCY: frequency,
      INTERVAL: interval,
      CYCLE_UNIT: cycleUnit,
    } as TransactionRow;
    const occurrenceDates = getPlanOccurrenceDates(planRow);
    const selectedActualDates = allTransactionRows
      ? Array.from(selectedActualIds)
          .map((id) => {
            const r = allTransactionRows.find((row) => row.ID === id);
            return r ? getActualTargetDate(r).trim().slice(0, 10) : "";
          })
          .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
      : undefined;
    const resolved = resolveCompletedPlanDateAndStatus(
      occurrenceDates,
      completedPlanDate,
      planStatus,
      null,
      selectedActualDates
    );
    completedPlanDate = resolved.completedPlanDate;
    planStatus = resolved.planStatus;
  }
  const row: Record<string, string> = {
    ID: String(nextId),
    REGIST_DATETIME: "",
    REGIST_USER: "",
    UPDATE_DATETIME: "",
    UPDATE_USER: "",
    TRANSACTION_TYPE: type,
    PROJECT_TYPE: status,
    CATEGORY_ID: categoryId,
    NAME: name,
    TRANDATE_FROM: trFrom,
    TRANDATE_TO: trTo,
    FREQUENCY: frequency,
    INTERVAL: interval,
    CYCLE_UNIT: cycleUnit,
    AMOUNT: amount,
    MEMO: memo,
    ACCOUNT_ID_IN: type === "income" || type === "transfer" ? accountIn : "",
    ACCOUNT_ID_OUT: type === "expense" || type === "transfer" ? accountOut : "",
    COMPLETED_PLANDATE: completedPlanDate,
    PLAN_STATUS: planStatus,
    DLT_FLG: "0",
  };
  setNewRowAudit(row, userId, String(nextId));
  return row;
}

function buildUpdatedRow(
  form: HTMLFormElement,
  existing: TransactionRow,
  allTransactionRows?: TransactionRow[]
): Record<string, string> {
  const type = (form.querySelector("#transaction-entry-type") as HTMLInputElement)?.value ?? "expense";
  const status = (form.querySelector("#transaction-entry-status") as HTMLInputElement)?.value ?? "actual";
  const categoryId = (form.querySelector("#transaction-entry-category") as HTMLInputElement)?.value ?? "";
  const name = ((form.querySelector("#transaction-entry-name") as HTMLInputElement)?.value ?? "").trim();
  const date = (form.querySelector("#transaction-entry-date") as HTMLInputElement)?.value ?? "";
  const dateFrom = (form.querySelector("#transaction-entry-date-from") as HTMLInputElement)?.value ?? "";
  const dateTo = (form.querySelector("#transaction-entry-date-to") as HTMLInputElement)?.value ?? "";
  const amount = ((form.querySelector("#transaction-entry-amount") as HTMLInputElement)?.value ?? "").trim();
  const memo = ((form.querySelector("#transaction-entry-memo") as HTMLTextAreaElement)?.value ?? "").trim();
  const accountIn = (form.querySelector("#transaction-entry-account-in") as HTMLInputElement)?.value ?? "";
  const accountOut = (form.querySelector("#transaction-entry-account-out") as HTMLInputElement)?.value ?? "";
  const userId = currentUserId ?? "";
  const trFrom = status === "plan" ? dateFrom : date;
  const trTo = status === "plan" ? dateTo : date;
  const frequency = status === "plan" ? getFrequency() : "day";
  const interval = status === "plan" ? (frequency === "day" ? "0" : getInterval()) : "1";
  const cycleUnit = status === "plan" ? getCycleUnit() : "";
  let planStatus = status === "plan" ? getPlanStatus() : "complete";
  const completedPlanDateRaw =
    status === "plan"
      ? ((form.querySelector("#transaction-entry-completed-plandate") as HTMLInputElement)?.value ?? "").trim()
      : existing.COMPLETED_PLANDATE ?? "";
  let completedPlanDate =
    status === "plan"
      ? filterCompletedPlanDateToOccurrenceDates(trFrom, trTo, frequency, interval, cycleUnit, completedPlanDateRaw)
      : completedPlanDateRaw;
  if (status === "plan") {
    const planRow = {
      TRANDATE_FROM: trFrom,
      TRANDATE_TO: trTo,
      FREQUENCY: frequency,
      INTERVAL: interval,
      CYCLE_UNIT: cycleUnit,
    } as TransactionRow;
    const occurrenceDates = getPlanOccurrenceDates(planRow);
    const planId = (existing.PROJECT_TYPE || "").toLowerCase() === "plan" ? (existing.ID ?? null) : null;
    const selectedActualDates = allTransactionRows
      ? Array.from(selectedActualIds)
          .map((id) => {
            const r = allTransactionRows.find((row) => row.ID === id);
            return r ? getActualTargetDate(r).trim().slice(0, 10) : "";
          })
          .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
      : undefined;
    const resolved = resolveCompletedPlanDateAndStatus(
      occurrenceDates,
      completedPlanDate,
      planStatus,
      planId,
      selectedActualDates
    );
    completedPlanDate = resolved.completedPlanDate;
    planStatus = resolved.planStatus;
  }
  const row: Record<string, string> = {
    ID: existing.ID,
    VERSION: existing.VERSION ?? "0",
    REGIST_DATETIME: existing.REGIST_DATETIME ?? "",
    REGIST_USER: existing.REGIST_USER ?? "",
    UPDATE_DATETIME: "",
    UPDATE_USER: "",
    TRANSACTION_TYPE: type,
    PROJECT_TYPE: status,
    CATEGORY_ID: categoryId,
    NAME: name,
    TRANDATE_FROM: trFrom,
    TRANDATE_TO: trTo,
    FREQUENCY: frequency,
    INTERVAL: interval,
    CYCLE_UNIT: cycleUnit,
    AMOUNT: amount,
    MEMO: memo,
    ACCOUNT_ID_IN: type === "income" || type === "transfer" ? accountIn : "",
    ACCOUNT_ID_OUT: type === "expense" || type === "transfer" ? accountOut : "",
    COMPLETED_PLANDATE: completedPlanDate,
    PLAN_STATUS: planStatus,
    DLT_FLG: existing.DLT_FLG ?? "0",
  };
  setUpdateAudit(row, userId);
  return row;
}

async function saveTransactionCsv(csv: string): Promise<void> {
  await saveCsvViaApi("TRANSACTION.csv", csv, getLastCsvVersion("TRANSACTION.csv"));
}

async function saveTransactionTagCsv(csv: string): Promise<void> {
  await saveCsvViaApi("TRANSACTION_TAG.csv", csv, getLastCsvVersion("TRANSACTION_TAG.csv"));
}

async function saveTransactionManagementCsv(csv: string): Promise<void> {
  await saveCsvViaApi(
    "TRANSACTION_MANAGEMENT.csv",
    csv,
    getLastCsvVersion("TRANSACTION_MANAGEMENT.csv")
  );
}

async function saveAccountHistoryCsv(csv: string): Promise<void> {
  await saveCsvViaApi("ACCOUNT_HISTORY.csv", csv, getLastCsvVersion("ACCOUNT_HISTORY.csv"));
}

/**
 * 実績取引の登録・更新・削除に応じて ACCOUNT.csv の残高（BALANCE）を更新し、
 * ACCOUNT_HISTORY.csv に当該取引時点の残高履歴を追記する。予定取引の場合は何もしない。
 * @param transactionId - 取引ID（TRANSACTION.ID）
 * @param operation - "register" | "update" | "delete"
 * @param transactionType - "expense" | "income" | "transfer"
 * @param accountOutId - 出金元勘定ID（支出・振替で使用）
 * @param accountInId - 入金先勘定ID（収入・振替で使用）
 * @param amount - 金額（登録・削除時はそのまま、更新時は新金額）
 * @param oldAmount - 更新時のみ。更新前の金額
 */
async function updateAccountBalancesForActual(
  transactionId: string,
  operation: "register" | "update" | "delete",
  transactionType: string,
  accountOutId: string,
  accountInId: string,
  amount: number,
  oldAmount?: number
): Promise<void> {
  if (operation === "update" && oldAmount !== undefined && amount === oldAmount) {
    return;
  }
  const type = (transactionType || "expense").toLowerCase();
  const accounts = await fetchAccountList(true);
  const userId = currentUserId ?? "";

  const toRecord = (a: AccountRow): Record<string, string> => ({
    ID: a.ID ?? "",
    VERSION: a.VERSION ?? "0",
    REGIST_DATETIME: a.REGIST_DATETIME ?? "",
    REGIST_USER: a.REGIST_USER ?? "",
    UPDATE_DATETIME: a.UPDATE_DATETIME ?? "",
    UPDATE_USER: a.UPDATE_USER ?? "",
    USER_ID: a.USER_ID ?? "",
    ACCOUNT_NAME: a.ACCOUNT_NAME ?? "",
    COLOR: a.COLOR ?? "",
    ICON_PATH: a.ICON_PATH ?? "",
    BALANCE: a.BALANCE ?? "0",
    SORT_ORDER: a.SORT_ORDER ?? "",
  });

  const records = accounts.map(toRecord);

  const parseBal = (s: string): number => {
    const n = parseFloat(String(s).trim());
    return Number.isNaN(n) ? 0 : n;
  };

  const applyDelta = (id: string, delta: number): void => {
    const r = records.find((row) => row.ID === id);
    if (!r) return;
    const cur = parseBal(r.BALANCE ?? "0");
    r.BALANCE = String(cur + delta);
    r.VERSION = String(Number(r.VERSION || "0") + 1);
    setUpdateAudit(r, userId);
  };

  const affectedAccountIds: string[] = [];
  if (operation === "register") {
    if (type === "expense" && accountOutId) {
      affectedAccountIds.push(accountOutId);
      applyDelta(accountOutId, -amount);
    } else if (type === "income" && accountInId) {
      affectedAccountIds.push(accountInId);
      applyDelta(accountInId, amount);
    } else if (type === "transfer") {
      if (accountOutId) {
        affectedAccountIds.push(accountOutId);
        applyDelta(accountOutId, -amount);
      }
      if (accountInId) {
        affectedAccountIds.push(accountInId);
        applyDelta(accountInId, amount);
      }
    }
  } else if (operation === "update" && oldAmount !== undefined) {
    const diff = amount - oldAmount;
    if (type === "expense" && accountOutId) {
      affectedAccountIds.push(accountOutId);
      applyDelta(accountOutId, -diff);
    } else if (type === "income" && accountInId) {
      affectedAccountIds.push(accountInId);
      applyDelta(accountInId, diff);
    } else if (type === "transfer") {
      if (accountOutId) {
        affectedAccountIds.push(accountOutId);
        applyDelta(accountOutId, -diff);
      }
      if (accountInId) {
        affectedAccountIds.push(accountInId);
        applyDelta(accountInId, diff);
      }
    }
  } else if (operation === "delete") {
    if (type === "expense" && accountOutId) {
      affectedAccountIds.push(accountOutId);
      applyDelta(accountOutId, amount);
    } else if (type === "income" && accountInId) {
      affectedAccountIds.push(accountInId);
      applyDelta(accountInId, -amount);
    } else if (type === "transfer") {
      if (accountOutId) {
        affectedAccountIds.push(accountOutId);
        applyDelta(accountOutId, amount);
      }
      if (accountInId) {
        affectedAccountIds.push(accountInId);
        applyDelta(accountInId, -amount);
      }
    }
  }

  const csv = accountListToCsv(records);
  await saveCsvViaApi("ACCOUNT.csv", csv, getLastCsvVersion("ACCOUNT.csv"));

  if (affectedAccountIds.length === 0) return;
  const statusForHistory = operation === "register" ? "regist" : operation;
  const { nextId, rows: historyRows } = await fetchAccountHistoryRows(true);
  const newHistoryRows = historyRows.map((r) => ({ ...r } as Record<string, string>));
  let historyId = nextId;
  for (const accountId of affectedAccountIds) {
    const rec = records.find((row) => row.ID === accountId);
    const balance = rec ? String(parseBal(rec.BALANCE ?? "0")) : "0";
    const row: Record<string, string> = {
      ID: String(historyId),
      VERSION: "0",
      REGIST_DATETIME: "",
      REGIST_USER: userId,
      UPDATE_DATETIME: "",
      UPDATE_USER: userId,
      ACCOUNT_ID: accountId,
      TRANSACTION_ID: transactionId,
      BALANCE: balance,
      TRANSACTION_STATUS: statusForHistory,
    };
    setNewRowAudit(row, userId, String(historyId));
    newHistoryRows.push(row);
    historyId += 1;
  }
  const historyCsv = accountHistoryListToCsv(newHistoryRows);
  await saveAccountHistoryCsv(historyCsv);
}

/**
 * 収支記録画面の初期化を行う。「transaction-entry」ビュー表示ハンドラとフォーム送信・削除・連続入力等のイベントを登録する。
 * @returns なし
 */
export function initTransactionEntryView(): void {
  registerViewHandler("transaction-entry", () => {
    (async () => {
      await loadOptions();
      const editId = transactionEntryEditId;
      if (editId) {
        await loadFormForEdit(editId);
        editingTransactionId = editId;
        setTransactionEntryEditId(null);
      } else {
        ensureSingleSelection();
        updateDateRowsVisibility(getStatusInput()?.value ?? "actual");
        setTodayToAllDateInputs();
        resetForm();
        editingTransactionId = null;
      }
      updateTransactionEntryDeleteButtonVisibility();
      updateTransactionEntrySubmitButtonVisibility();
      updateTransactionEntryContinuousButtonVisibility();
      updateTransactionEntryCopyAsNewButtonVisibility();
      updatePlanOnlyRowsVisibility(getStatusInput()?.value ?? "actual");
      updateActualRowVisibility();
      setTransactionEntryReadonly(editId ? transactionEntryViewOnly : false);
    })();
  });

  document.getElementById("transaction-entry-type-buttons")?.querySelectorAll(".transaction-history-filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const type = (btn as HTMLElement).getAttribute("data-type");
      if (!type || (getTypeInput()?.value === type)) return;
      setTypeAndSync(type);
    });
  });
  document.getElementById("transaction-entry-status-buttons")?.querySelectorAll(".transaction-history-filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const status = (btn as HTMLElement).getAttribute("data-status");
      if (!status || (getStatusInput()?.value === status)) return;
      setStatusAndSync(status);
    });
  });
  document.getElementById("transaction-entry-plan-status-buttons")?.querySelectorAll(".transaction-history-filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const planStatus = (btn as HTMLElement).getAttribute("data-plan-status");
      if (!planStatus) return;
      setPlanStatus(planStatus);
      // ステータスを完了にしたとき、予定完了日を全発生日で即時反映する
      if (planStatus === "complete" && getStatusInput()?.value === "plan") {
        const planRow = buildPlanRowFromForm();
        const dates = getPlanOccurrenceDates(planRow);
        const input = document.getElementById("transaction-entry-completed-plandate") as HTMLInputElement | null;
        if (input && dates.length > 0) {
          input.value = dates.slice().sort().join(",");
          renderCompletedDatesChosenDisplay();
        }
      }
    });
  });
  document.getElementById("transaction-entry-frequency-buttons")?.querySelectorAll(".transaction-history-filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const frequency = (btn as HTMLElement).getAttribute("data-frequency");
      if (!frequency) return;
      setFrequency(frequency);
    });
  });

  const intervalEl = document.getElementById("transaction-entry-interval") as HTMLInputElement | null;
  intervalEl?.addEventListener("input", () => {
    const n = parseInt(intervalEl.value, 10);
    if (Number.isNaN(n) || n < 0) intervalEl.value = "0";
    else if (n > 999) intervalEl.value = "999";
  });
  const amountEl = document.getElementById("transaction-entry-amount") as HTMLInputElement | null;
  amountEl?.addEventListener("input", () => {
    const n = parseFloat(amountEl.value);
    if (!Number.isNaN(n) && n < 0) amountEl.value = "0";
  });

  const dateFromEl = document.getElementById("transaction-entry-date-from") as HTMLInputElement | null;
  const dateToEl = document.getElementById("transaction-entry-date-to") as HTMLInputElement | null;
  dateFromEl?.addEventListener("change", () => {
    if (dateToEl && dateFromEl.value) dateToEl.value = dateFromEl.value;
  });

  const form = document.getElementById("transaction-entry-form");
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!(form instanceof HTMLFormElement)) return;
    if (transactionEntryViewOnly) return;
    const accountError = validateAccountByType();
    if (accountError) {
      alert(accountError);
      return;
    }
    if (editingTransactionId) {
      const { rows } = await fetchTransactionRows(true);
      const existing = rows.find((r) => r.ID === editingTransactionId);
      if (!existing) {
        alert(getVersionConflictMessage({ allowed: false, notFound: true }));
        editingTransactionId = null;
        resetForm();
        const returnView = transactionEntryReturnView || "transaction-history";
        setTransactionEntryReturnView(null);
        pushNavigation(returnView);
        showMainView(returnView);
        updateCurrentMenuItem();
        return;
      }
      const updatedRowForConfirm = buildUpdatedRow(form, existing);
      const projectTypeChanged =
        (existing.PROJECT_TYPE ?? "").toLowerCase() !== (updatedRowForConfirm.PROJECT_TYPE ?? "").toLowerCase();
      if (projectTypeChanged && !confirm("計画が変更されていますが、よろしいでしょうか？")) return;
      if (!confirm("取引を更新しますか？")) return;
    }
    try {
      if (editingTransactionId) {
        const { rows } = await fetchTransactionRows(true);
        const existing = rows.find((r) => r.ID === editingTransactionId);
        if (!existing) {
          alert(getVersionConflictMessage({ allowed: false, notFound: true }));
          editingTransactionId = null;
          resetForm();
          const returnView = transactionEntryReturnView || "transaction-history";
          setTransactionEntryReturnView(null);
          pushNavigation(returnView);
          showMainView(returnView);
          updateCurrentMenuItem();
          return;
        }
        const check = await checkVersionBeforeUpdate(
          "/data/TRANSACTION.csv",
          editingTransactionId,
          existing.VERSION ?? "0"
        );
        if (!check.allowed) {
          alert(getVersionConflictMessage(check));
          await loadFormForEdit(editingTransactionId);
          return;
        }
        const updatedRow = buildUpdatedRow(form, existing, rows);
        const allRows = rows.map((r) =>
          r.ID === editingTransactionId ? (updatedRow as Record<string, string>) : ({ ...r } as Record<string, string>)
        );
        const csv = transactionListToCsv(allRows);
        await saveTransactionCsv(csv);
        const savedStatusRow = (updatedRow as Record<string, string>).PROJECT_TYPE ?? "";
        if (savedStatusRow.toLowerCase() === "actual") {
          const typeRow = (updatedRow as Record<string, string>).TRANSACTION_TYPE ?? "expense";
          const outId = (updatedRow as Record<string, string>).ACCOUNT_ID_OUT ?? "";
          const inId = (updatedRow as Record<string, string>).ACCOUNT_ID_IN ?? "";
          const newAmt = parseFloat(String((updatedRow as Record<string, string>).AMOUNT ?? "0")) || 0;
          const oldAmt = parseFloat(String(existing.AMOUNT ?? "0")) || 0;
          await updateAccountBalancesForActual(editingTransactionId!, "update", typeRow, outId, inId, newAmt, oldAmt);
        }
        await updateTransactionMonthlyForTransaction(
          updatedRow as unknown as TransactionRow,
          "update",
          existing
        );
        const { nextId: nextMgmtId, rows: mgmtRows } = await fetchTransactionTagRows(true);
        const userId = currentUserId ?? "";
        const others = mgmtRows.filter((r) => r.TRANSACTION_ID !== editingTransactionId);
        const newMgmtRows = others.map((r) => ({ ...r } as Record<string, string>));
        let id = nextMgmtId;
        for (const tagId of selectedTagIds) {
          const row: Record<string, string> = {
            TRANSACTION_ID: editingTransactionId,
            TAG_ID: tagId,
          };
          setNewRowAudit(row, userId, String(id));
          newMgmtRows.push(row);
          id += 1;
        }
        const mgmtCsv = transactionTagListToCsv(newMgmtRows);
        await saveTransactionTagCsv(mgmtCsv);
        const { nextId: nextTxMgmtId, rows: txMgmtRows } = await fetchTransactionManagementRows(true);
        const othersTxMgmt = txMgmtRows.filter(
          (r) => r.TRAN_PLAN_ID !== editingTransactionId && (r.ID ?? "").trim() !== ""
        );
        const newTxMgmtRows = othersTxMgmt.map((r) => ({ ...r } as Record<string, string>));
        const savedStatus = (updatedRow as Record<string, string>).PROJECT_TYPE ?? "";
        if (savedStatus.toLowerCase() === "plan") {
          let txMgmtId = nextTxMgmtId;
          for (const actualId of selectedActualIds) {
            const row: Record<string, string> = {
              TRAN_PLAN_ID: editingTransactionId,
              TRAN_ACTUAL_ID: actualId,
            };
            setNewRowAudit(row, currentUserId ?? "", String(txMgmtId));
            newTxMgmtRows.push(row);
            txMgmtId += 1;
          }
        }
        const txMgmtCsv = transactionManagementListToCsv(newTxMgmtRows);
        await saveTransactionManagementCsv(txMgmtCsv);
        editingTransactionId = null;
        invalidateTransactionDataCache();
        resetForm();
        const returnView = transactionEntryReturnView || "transaction-history";
        setTransactionEntryReturnView(null);
        pushNavigation(returnView);
        showMainView(returnView);
        updateCurrentMenuItem();
      } else {
        const { nextId, rows } = await fetchTransactionRows(true);
        const newRow = buildNewRow(form, nextId, rows);
        const allRows = [...rows.map((r) => ({ ...r } as Record<string, string>)), newRow];
        const csv = transactionListToCsv(allRows);
        await saveTransactionCsv(csv);
        const newTransactionId = String(nextId);
        if ((newRow as Record<string, string>).PROJECT_TYPE?.toLowerCase() === "actual") {
          const typeNew = (newRow as Record<string, string>).TRANSACTION_TYPE ?? "expense";
          const outIdNew = (newRow as Record<string, string>).ACCOUNT_ID_OUT ?? "";
          const inIdNew = (newRow as Record<string, string>).ACCOUNT_ID_IN ?? "";
          const amt = parseFloat(String((newRow as Record<string, string>).AMOUNT ?? "0")) || 0;
          await updateAccountBalancesForActual(newTransactionId, "register", typeNew, outIdNew, inIdNew, amt);
        }
        await updateTransactionMonthlyForTransaction(newRow as unknown as TransactionRow, "register");
        if (selectedTagIds.size > 0) {
          const { nextId: nextMgmtId, rows: mgmtRows } = await fetchTransactionTagRows(true);
          const userId = currentUserId ?? "";
          const newMgmtRows = [...mgmtRows.map((r) => ({ ...r } as Record<string, string>))];
          let id = nextMgmtId;
          for (const tagId of selectedTagIds) {
            const row: Record<string, string> = {
              TRANSACTION_ID: newTransactionId,
              TAG_ID: tagId,
            };
            setNewRowAudit(row, userId, String(id));
            newMgmtRows.push(row);
            id += 1;
          }
          const mgmtCsv = transactionTagListToCsv(newMgmtRows);
          await saveTransactionTagCsv(mgmtCsv);
        }
        if (getStatusInput()?.value === "plan" && selectedActualIds.size > 0) {
          const { nextId: nextTxMgmtId, rows: txMgmtRows } = await fetchTransactionManagementRows(true);
          const userId = currentUserId ?? "";
          const newTxMgmtRows = [...txMgmtRows.map((r) => ({ ...r } as Record<string, string>))];
          let txMgmtId = nextTxMgmtId;
          for (const actualId of selectedActualIds) {
            const row: Record<string, string> = {
              TRAN_PLAN_ID: newTransactionId,
              TRAN_ACTUAL_ID: actualId,
            };
            setNewRowAudit(row, userId, String(txMgmtId));
            newTxMgmtRows.push(row);
            txMgmtId += 1;
          }
          const txMgmtCsv = transactionManagementListToCsv(newTxMgmtRows);
          await saveTransactionManagementCsv(txMgmtCsv);
        }
        invalidateTransactionDataCache();
        resetForm();
        if (!continuousMode) {
          const returnView = transactionEntryReturnView || "transaction-history";
          setTransactionEntryReturnView(null);
          pushNavigation(returnView);
          showMainView(returnView);
          updateCurrentMenuItem();
        }
      }
    } catch (err) {
      if (err instanceof VersionConflictError) {
        alert(err.message);
        invalidateTransactionDataCache();
        await loadTransactionData(true);
        if (editingTransactionId) await loadFormForEdit(editingTransactionId);
        return;
      }
      console.error(err);
      alert("保存に失敗しました。");
    }
  });

  document.getElementById("header-transaction-entry-submit")?.addEventListener("click", () => {
    const form = document.getElementById("transaction-entry-form");
    if (form instanceof HTMLFormElement) form.requestSubmit();
  });
  document.getElementById("header-transaction-entry-reset")?.addEventListener("click", async () => {
    if (editingTransactionId) {
      await loadFormForEdit(editingTransactionId);
    } else {
      resetForm();
    }
  });
  document.getElementById("header-transaction-entry-continuous")?.addEventListener("click", () => {
    continuousMode = !continuousMode;
    updateTransactionEntryContinuousButtonVisibility();
  });
  document.getElementById("header-transaction-entry-delete")?.addEventListener("click", async () => {
    if (!editingTransactionId) return;
    if (!confirm("この取引を削除しますか？")) return;
    try {
      const { rows: txRows } = await fetchTransactionRows(true);
      const row = txRows.find((r) => r.ID === editingTransactionId);
      if (!row) {
        alert(getVersionConflictMessage({ allowed: false, notFound: true }));
        editingTransactionId = null;
        resetForm();
        const returnView = transactionEntryReturnView || "transaction-history";
        setTransactionEntryReturnView(null);
        pushNavigation(returnView);
        showMainView(returnView);
        updateCurrentMenuItem();
        return;
      }
      const check = await checkVersionBeforeUpdate(
        "/data/TRANSACTION.csv",
        editingTransactionId,
        row.VERSION ?? "0"
      );
      if (!check.allowed) {
        alert(getVersionConflictMessage(check));
        await loadFormForEdit(editingTransactionId);
        return;
      }
      const userId = currentUserId ?? "";
      const newTxRows = txRows.map((r) => {
        const rec = { ...r } as Record<string, string>;
        if (r.ID === editingTransactionId) {
          rec.DLT_FLG = "1";
          rec.VERSION = String(Number(r.VERSION || "0") + 1);
          setUpdateAudit(rec, userId);
        }
        return rec;
      });
      const csv = transactionListToCsv(newTxRows);
      await saveTransactionCsv(csv);
      if ((row.PROJECT_TYPE ?? "").toLowerCase() === "actual") {
        const typeDel = (row.TRANSACTION_TYPE ?? "expense").toLowerCase();
        const outIdDel = row.ACCOUNT_ID_OUT ?? "";
        const inIdDel = row.ACCOUNT_ID_IN ?? "";
        const amtDel = parseFloat(String(row.AMOUNT ?? "0")) || 0;
        await updateAccountBalancesForActual(editingTransactionId!, "delete", typeDel, outIdDel, inIdDel, amtDel);
      }
      await updateTransactionMonthlyForTransaction(row, "delete");
      const { rows: mgmtRows } = await fetchTransactionTagRows(true);
      const newMgmtRows = mgmtRows
        .filter((r) => r.TRANSACTION_ID !== editingTransactionId)
        .map((r) => ({ ...r } as Record<string, string>));
      const mgmtCsv = transactionTagListToCsv(newMgmtRows);
      await saveTransactionTagCsv(mgmtCsv);
      const { rows: txMgmtRows } = await fetchTransactionManagementRows(true);
      const newTxMgmtRows = txMgmtRows
        .filter((r) => r.TRAN_PLAN_ID !== editingTransactionId && r.TRAN_ACTUAL_ID !== editingTransactionId)
        .map((r) => ({ ...r } as Record<string, string>));
      const txMgmtCsv = transactionManagementListToCsv(newTxMgmtRows);
      await saveTransactionManagementCsv(txMgmtCsv);
      invalidateTransactionDataCache();
      editingTransactionId = null;
      resetForm();
      updateTransactionEntryDeleteButtonVisibility();
      updateTransactionEntryCopyAsNewButtonVisibility();
      updateTransactionEntryContinuousButtonVisibility();
      const returnView = transactionEntryReturnView || "transaction-history";
      setTransactionEntryReturnView(null);
      pushNavigation(returnView);
      showMainView(returnView);
      updateCurrentMenuItem();
    } catch (err) {
      if (err instanceof VersionConflictError) {
        alert(err.message);
        invalidateTransactionDataCache();
        await loadTransactionData(true);
        if (editingTransactionId) await loadFormForEdit(editingTransactionId);
        return;
      }
      console.error(err);
      alert("削除に失敗しました。");
    }
  });
  document.getElementById("header-transaction-entry-copy-as-new")?.addEventListener("click", async () => {
    if (!editingTransactionId) return;
    const form = document.getElementById("transaction-entry-form");
    if (!(form instanceof HTMLFormElement)) return;
    try {
      const { nextId, rows } = await fetchTransactionRows(true);
      const newRow = buildNewRow(form, nextId, rows);
      const allRows = [...rows.map((r) => ({ ...r } as Record<string, string>)), newRow];
      const csv = transactionListToCsv(allRows);
      await saveTransactionCsv(csv);
      const newTransactionId = String(nextId);
      if ((newRow as Record<string, string>).PROJECT_TYPE?.toLowerCase() === "actual") {
        const typeCopy = (newRow as Record<string, string>).TRANSACTION_TYPE ?? "expense";
        const outIdCopy = (newRow as Record<string, string>).ACCOUNT_ID_OUT ?? "";
        const inIdCopy = (newRow as Record<string, string>).ACCOUNT_ID_IN ?? "";
        const amtCopy = parseFloat(String((newRow as Record<string, string>).AMOUNT ?? "0")) || 0;
        await updateAccountBalancesForActual(newTransactionId, "register", typeCopy, outIdCopy, inIdCopy, amtCopy);
      }
      await updateTransactionMonthlyForTransaction(newRow as unknown as TransactionRow, "register");
      if (selectedTagIds.size > 0) {
        const { nextId: nextMgmtId, rows: mgmtRows } = await fetchTransactionTagRows(true);
        const userId = currentUserId ?? "";
        const newMgmtRows = [...mgmtRows.map((r) => ({ ...r } as Record<string, string>))];
        let id = nextMgmtId;
        for (const tagId of selectedTagIds) {
          const row: Record<string, string> = {
            TRANSACTION_ID: newTransactionId,
            TAG_ID: tagId,
          };
          setNewRowAudit(row, userId, String(id));
          newMgmtRows.push(row);
          id += 1;
        }
        const mgmtCsv = transactionTagListToCsv(newMgmtRows);
        await saveTransactionTagCsv(mgmtCsv);
      }
      if (selectedActualIds.size > 0) {
        const { nextId: nextTxMgmtId, rows: txMgmtRows } = await fetchTransactionManagementRows(true);
        const userId = currentUserId ?? "";
        const newTxMgmtRows = [...txMgmtRows.map((r) => ({ ...r } as Record<string, string>))];
        let txMgmtId = nextTxMgmtId;
        for (const actualId of selectedActualIds) {
          const row: Record<string, string> = {
            TRAN_PLAN_ID: newTransactionId,
            TRAN_ACTUAL_ID: actualId,
          };
          setNewRowAudit(row, userId, String(txMgmtId));
          newTxMgmtRows.push(row);
          txMgmtId += 1;
        }
        const txMgmtCsv = transactionManagementListToCsv(newTxMgmtRows);
        await saveTransactionManagementCsv(txMgmtCsv);
      }
      invalidateTransactionDataCache();
      editingTransactionId = null;
      resetForm();
      updateTransactionEntryDeleteButtonVisibility();
      updateTransactionEntrySubmitButtonVisibility();
      updateTransactionEntryCopyAsNewButtonVisibility();
      const returnView = transactionEntryReturnView || "transaction-history";
      setTransactionEntryReturnView(null);
      pushNavigation(returnView);
      showMainView(returnView);
      updateCurrentMenuItem();
    } catch (err) {
      if (err instanceof VersionConflictError) {
        alert(err.message);
        invalidateTransactionDataCache();
        await loadTransactionData(true);
        if (editingTransactionId) await loadFormForEdit(editingTransactionId);
        return;
      }
      console.error(err);
      alert("参照登録に失敗しました。");
    }
  });

  document.getElementById("transaction-entry-tag-open-btn")?.addEventListener("click", () => openTransactionEntryTagModal());
  document.getElementById("transaction-entry-actual-open-btn")?.addEventListener("click", () => openTransactionEntryActualModal());
  document.getElementById("transaction-entry-actual-select-apply")?.addEventListener("click", () => {
    mergeActualSelectionFromModal();
    selectedActualDisplayInfo = Array.from(selectedActualIds)
      .map((id) => {
        const row = actualSelectAllRows.find((r) => r.ID === id);
        return row
          ? { id: row.ID, name: (row.NAME || "").trim() || "—", categoryId: row.CATEGORY_ID || "" }
          : null;
      })
      .filter((a): a is { id: string; name: string; categoryId: string } => a != null);
    renderActualChosenDisplay();
    closeTransactionEntryActualModal();
  });
  document.getElementById("transaction-entry-actual-select-clear")?.addEventListener("click", () => {
    document
      .querySelectorAll("#transaction-entry-actual-select-list .transaction-history-select-check-btn")
      .forEach((el) => {
        el.classList.remove("is-selected");
        el.setAttribute("aria-pressed", "false");
      });
  });
  document.querySelector(".transaction-entry-actual-select-ym-prev")?.addEventListener("click", () => {
    if (!actualSelectYM) return;
    mergeActualSelectionFromModal();
    const [y, m] = actualSelectYM.split("-").map(Number);
    const d = new Date(y, m - 2, 1);
    actualSelectYM = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    renderActualSelectList();
  });
  document.querySelector(".transaction-entry-actual-select-ym-next")?.addEventListener("click", () => {
    if (!actualSelectYM) return;
    mergeActualSelectionFromModal();
    const [y, m] = actualSelectYM.split("-").map(Number);
    const d = new Date(y, m, 1);
    actualSelectYM = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    renderActualSelectList();
  });
  document.getElementById("transaction-entry-actual-select-ym-label")?.addEventListener("change", (e) => {
    const input = e.target as HTMLInputElement;
    const value = (input?.value || "").trim();
    if (value && /^\d{4}-\d{2}$/.test(value)) {
      mergeActualSelectionFromModal();
      actualSelectYM = value;
      renderActualSelectList();
    }
  });
  document.getElementById("transaction-entry-actual-select-overlay")?.addEventListener("click", (e) => {
    if (e.target instanceof HTMLElement && e.target.id === "transaction-entry-actual-select-overlay") {
      closeTransactionEntryActualModal();
    }
  });
  document.getElementById("transaction-entry-completed-dates-open-btn")?.addEventListener("click", () => {
    openTransactionEntryCompletedDatesModal();
  });
  document.getElementById("transaction-entry-completed-dates-apply")?.addEventListener("click", () => {
    const wrap = document.getElementById("transaction-entry-completed-dates-wrap");
    const checkBtns = wrap?.querySelectorAll<HTMLButtonElement>(".schedule-occurrence-complete-check-btn.is-selected");
    const completedDates: string[] = [];
    checkBtns?.forEach((btn) => {
      const raw = btn.getAttribute("data-date");
      const d = raw != null ? raw.trim().slice(0, 10) : "";
      if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) completedDates.push(d);
    });
    const input = document.getElementById("transaction-entry-completed-plandate") as HTMLInputElement | null;
    if (input) input.value = completedDates.sort().join(",");
    renderCompletedDatesChosenDisplay();
    syncPlanStatusFromCompletedDates();
    closeTransactionEntryCompletedDatesModal();
  });
  document.getElementById("transaction-entry-completed-dates-overlay")?.addEventListener("click", (e) => {
    if (e.target instanceof HTMLElement && e.target.id === "transaction-entry-completed-dates-overlay") {
      closeTransactionEntryCompletedDatesModal();
    }
  });
  document.getElementById("transaction-entry-tag-select-apply")?.addEventListener("click", () => {
    selectedTagIds = new Set(getSelectedTagIdsFromModal());
    renderTagChosenDisplay();
    closeTransactionEntryTagModal();
  });
  document.getElementById("transaction-entry-tag-select-clear")?.addEventListener("click", () => {
    document
      .querySelectorAll("#transaction-entry-tag-select-list .transaction-history-select-check-btn")
      .forEach((el) => {
        el.classList.remove("is-selected");
        el.setAttribute("aria-pressed", "false");
      });
  });
  document.getElementById("transaction-entry-tag-select-overlay")?.addEventListener("click", (e) => {
    if (e.target instanceof HTMLElement && e.target.id === "transaction-entry-tag-select-overlay") {
      closeTransactionEntryTagModal();
    }
  });
  document.getElementById("transaction-entry-cycle-monthly-select-apply")?.addEventListener("click", () => {
    applyTransactionEntryCycleMonthlySelect();
  });
  document.getElementById("transaction-entry-cycle-monthly-select-cancel")?.addEventListener("click", () => {
    closeOverlay(TRANSACTION_ENTRY_CYCLE_MONTHLY_OVERLAY_ID);
  });
  document.getElementById("transaction-entry-cycle-monthly-select-overlay")?.addEventListener("click", (e) => {
    if (e.target instanceof HTMLElement && e.target.id === "transaction-entry-cycle-monthly-select-overlay") {
      closeOverlay(TRANSACTION_ENTRY_CYCLE_MONTHLY_OVERLAY_ID);
    }
  });

  const categoryTrigger = document.getElementById("transaction-entry-category-trigger");
  const categoryList = document.getElementById("transaction-entry-category-list");
  categoryTrigger?.addEventListener("click", (e) => {
    e.preventDefault();
    const list = document.getElementById("transaction-entry-category-list");
    const isOpen = list?.classList.toggle("is-open");
    list?.setAttribute("aria-hidden", String(!isOpen));
    categoryTrigger?.setAttribute("aria-expanded", String(!!isOpen));
  });
  categoryList?.addEventListener("click", (e) => {
    const option = (e.target as HTMLElement).closest(".transaction-entry-category-option");
    if (!option || !(option instanceof HTMLElement)) return;
    const id = option.dataset.categoryId;
    if (!id) return;
    const valueEl = getCategoryValueEl();
    if (valueEl) {
      valueEl.value = id;
      updateCategoryTriggerDisplay(id);
    }
    closeCategoryList();
  });
  document.addEventListener("click", (e) => {
    const target = e.target as Node;
    if (document.querySelector(".transaction-entry-category-dropdown")?.contains(target)) return;
    const inAnyAccountDropdown = Array.from(document.querySelectorAll(".transaction-entry-account-dropdown")).some((el) =>
      el.contains(target)
    );
    if (inAnyAccountDropdown) return;
    closeCategoryList();
    closeAccountList("out");
    closeAccountList("in");
  });

  (["out", "in"] as const).forEach((which) => {
    const prefix = which === "out" ? "transaction-entry-account-out" : "transaction-entry-account-in";
    const trigger = document.getElementById(`${prefix}-trigger`);
    const list = document.getElementById(`${prefix}-list`);
    trigger?.addEventListener("click", (e) => {
      e.preventDefault();
      const listEl = document.getElementById(`${prefix}-list`);
      const isOpen = listEl?.classList.toggle("is-open");
      listEl?.setAttribute("aria-hidden", String(!isOpen));
      trigger?.setAttribute("aria-expanded", String(!!isOpen));
    });
    list?.addEventListener("click", (e) => {
      const option = (e.target as HTMLElement).closest(".transaction-entry-account-option");
      if (!option || !(option instanceof HTMLElement)) return;
      const id = option.dataset.accountId;
      if (!id) return;
      const valueEl = which === "out" ? getAccountOutValueEl() : getAccountInValueEl();
      if (valueEl) {
        valueEl.value = id;
        updateAccountTriggerDisplay(which, id);
      }
      closeAccountList(which);
    });
  });
}
