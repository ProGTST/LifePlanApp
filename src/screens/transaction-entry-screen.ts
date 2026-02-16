import type { TransactionRow, CategoryRow, AccountRow, AccountPermissionRow, TagRow, TagManagementRow, TransactionManagementRow } from "../types";
import { currentUserId, transactionEntryEditId, setTransactionEntryEditId, transactionEntryViewOnly, pushNavigation } from "../state";
import { createIconWrap } from "../utils/iconWrap";
import { openOverlay, closeOverlay } from "../utils/overlay";
import { ICON_DEFAULT_COLOR } from "../constants/colorPresets";
import { fetchCsv, rowToObject } from "../utils/csv";
import { transactionListToCsv, tagManagementListToCsv, transactionManagementListToCsv } from "../utils/csvExport";
import { saveCsvViaApi } from "../utils/dataApi";
import { registerViewHandler, showMainView } from "../app/screen";
import { setNewRowAudit, setUpdateAudit } from "../utils/auditFields";
import {
  checkVersionBeforeUpdate,
  getVersionConflictMessage,
} from "../utils/csvVersionCheck.ts";

const CSV_NO_CACHE: RequestInit = { cache: "reload" };

let categoryRows: CategoryRow[] = [];
let accountRows: AccountRow[] = [];
let permissionRows: AccountPermissionRow[] = [];
let tagRows: TagRow[] = [];
let visibleAccountIds: Set<string> = new Set();
/** 出金元・入金先プルダウンに表示する勘定 ID（権限が edit のもののみ） */
let editableAccountIds: Set<string> = new Set();
let selectedTagIds: Set<string> = new Set();
/** 予定に紐づける取引実績の ID 一覧（予定編集時のみ有効） */
let selectedActualIds: Set<string> = new Set();
/** 実績選択チップ表示用: id・名称・カテゴリーID（selectedActualIds と同期） */
let selectedActualDisplayInfo: { id: string; name: string; categoryId: string }[] = [];
/** 実績選択モーダル用: 全実績行（週でフィルタ前） */
let actualSelectAllRows: TransactionRow[] = [];
/** 実績選択モーダル用: 現在表示している週範囲 */
let actualSelectWeek: { start: string; end: string } | null = null;
let editingTransactionId: string | null = null;

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

/** 日付文字列 YYYY-MM-DD に days 日を加算した日付を返す。 */
function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, (m ?? 1) - 1, (d ?? 1) + days);
  const yy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** 指定日を含む週の月曜～日曜の範囲を返す（ISO週）。 */
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

/** 週範囲のラベル文字列（例: 2025年2月10日～2月16日）を返す。 */
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
function isDateInWeek(dateStr: string, weekStart: string, weekEnd: string): boolean {
  return dateStr >= weekStart && dateStr <= weekEnd;
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
  return rows.map((cells) => rowToObject(header, cells) as unknown as CategoryRow);
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
  return rows.map((cells) => rowToObject(header, cells) as unknown as AccountRow);
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
 * TRANSACTION.csv を取得し、取引行の配列と次に使う ID を返す。
 * @param noCache - true のときキャッシュを使わない
 * @returns Promise。nextId と取引行の配列
 */
async function fetchTransactionRows(noCache = false): Promise<{ nextId: number; rows: TransactionRow[] }> {
  const init = noCache ? CSV_NO_CACHE : undefined;
  const { header, rows } = await fetchCsv("/data/TRANSACTION.csv", init);
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
    if (cells.length === 0 || cells.every((c) => !c.trim())) continue;
    list.push(rowToObject(header, cells) as unknown as TagRow);
  }
  return list;
}

/**
 * TAG_MANAGEMENT.csv を取得し、タグ管理行の配列と次に使う ID を返す。
 * @param noCache - true のときキャッシュを使わない
 * @returns Promise。nextId とタグ管理行の配列
 */
async function fetchTagManagementRows(noCache = false): Promise<{ nextId: number; rows: TagManagementRow[] }> {
  const init = noCache ? CSV_NO_CACHE : undefined;
  const { header, rows } = await fetchCsv("/data/TAG_MANAGEMENT.csv", init);
  const list: TagManagementRow[] = [];
  let maxId = 0;
  for (const cells of rows) {
    if (cells.length === 0 || cells.every((c) => !c.trim())) continue;
    const row = rowToObject(header, cells) as unknown as TagManagementRow;
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
async function fetchTransactionManagementRows(noCache = false): Promise<{ nextId: number; rows: TransactionManagementRow[] }> {
  const init = noCache ? CSV_NO_CACHE : undefined;
  const { header, rows } = await fetchCsv("/data/TRANSACTION_MANAGEMENT.csv", init);
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
  const listEl = document.getElementById("transaction-entry-tag-select-list");
  if (!listEl) return;
  listEl.innerHTML = "";
  const tagSortOrderNum = (v: string | undefined): number => (v !== undefined && v !== "" ? Number(v) : 0);
  const sorted = tagRows.slice().sort((a, b) => tagSortOrderNum(a.SORT_ORDER) - tagSortOrderNum(b.SORT_ORDER));
  for (const row of sorted) {
    const item = createTagSelectItemRow(
      row.ID,
      row.TAG_NAME || "—",
      row.COLOR || ICON_DEFAULT_COLOR,
      row.ICON_PATH || "",
      selectedTagIds.has(row.ID)
    );
    listEl.appendChild(item);
  }
  openOverlay("transaction-entry-tag-select-overlay");
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
  dateSpan.textContent = row.TRANDATE_FROM || "—";
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
  nameSpan.addEventListener("click", handleRowClick);
  dateSpan.addEventListener("click", handleRowClick);
  amountWrap.addEventListener("click", handleRowClick);
  return wrap;
}

/**
 * 実績選択モーダルで週を切り替える前に、現在表示中の週の選択状態だけを selectedActualIds に反映する。
 * 他週で選択した ID はそのまま残す。
 */
function mergeActualSelectionFromModal(): void {
  const listEl = document.getElementById("transaction-entry-actual-select-list");
  if (!listEl) return;
  const items = listEl.querySelectorAll<HTMLElement>(".transaction-history-select-item");
  const currentWeekIds = new Set(
    Array.from(items)
      .map((el) => el.getAttribute("data-id"))
      .filter((id): id is string => id != null)
  );
  const selectedInDom = new Set(getSelectedActualIdsFromModal());
  selectedActualIds = new Set([
    ...[...selectedActualIds].filter((id) => !currentWeekIds.has(id)),
    ...selectedInDom,
  ]);
}

/**
 * 実績選択モーダルのリストと週ラベルを、actualSelectAllRows と actualSelectWeek に従って描画する。
 */
function renderActualSelectList(): void {
  const listEl = document.getElementById("transaction-entry-actual-select-list");
  const weekInput = document.getElementById("transaction-entry-actual-select-week-label") as HTMLInputElement | null;
  if (!listEl || !actualSelectWeek) return;
  const { start: weekStart, end: weekEnd } = actualSelectWeek;
  if (weekInput) weekInput.value = weekStart;
  const inWeek = actualSelectAllRows.filter((r) => isDateInWeek((r.TRANDATE_FROM || "").slice(0, 10), weekStart, weekEnd));
  const sorted = inWeek.slice().sort((a, b) => (b.TRANDATE_FROM || "").localeCompare(a.TRANDATE_FROM || ""));
  listEl.innerHTML = "";
  if (sorted.length === 0) {
    const emptyEl = document.createElement("p");
    emptyEl.className = "transaction-entry-actual-select-empty";
    emptyEl.textContent = "この週は取引実績がありません。";
    listEl.appendChild(emptyEl);
  } else {
    for (const row of sorted) {
      const item = createActualSelectItemRow(row, selectedActualIds.has(row.ID));
      listEl.appendChild(item);
    }
  }
}

function openTransactionEntryActualModal(): void {
  const listEl = document.getElementById("transaction-entry-actual-select-list");
  if (!listEl) return;
  const planType = (getTypeInput()?.value ?? "expense").toLowerCase();
  const dateFromEl = document.getElementById("transaction-entry-date-from") as HTMLInputElement | null;
  const dateEl = document.getElementById("transaction-entry-date") as HTMLInputElement | null;
  const planStart = (dateFromEl?.value || dateEl?.value || "").trim();
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const initialDate = planStart || todayStr;
  (async () => {
    const [txResult, accList, permList] = await Promise.all([
      fetchTransactionRows(true),
      fetchAccountList(true),
      fetchAccountPermissionList(true),
    ]);
    const visibleIds = getVisibleAccountIds(accList, permList);
    const txRows = filterTransactionsByVisibleAccounts(txResult.rows, visibleIds);
    const actualRows = txRows.filter(
      (r) =>
        (r.STATUS || "").toLowerCase() === "actual" &&
        (r.TYPE || "").toLowerCase() === planType &&
        r.ID !== editingTransactionId
    );
    actualSelectAllRows = actualRows;
    actualSelectWeek = getWeekRangeFromDate(initialDate);
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
 * 予定/実績切替時に実績欄の表示・非表示を更新する。
 */
function updateActualRowVisibility(): void {
  const status = getStatusInput()?.value ?? "actual";
  const row = document.getElementById("transaction-entry-actual-row");
  if (row) row.hidden = status !== "plan";
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
    outVal.value = "";
    updateAccountTriggerDisplay("out", "");
  }
  if (type === "expense" && inVal) {
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
  updateDateRowsVisibility(normalized);
  updateActualRowVisibility();
}

const todayYMD = (): string => new Date().toISOString().slice(0, 10);

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
  setTypeAndSync("expense");
  setStatusAndSync("actual");
  setTodayToAllDateInputs();
  updateAccountTriggerDisplay("out", getAccountOutValueEl()?.value ?? "");
  updateAccountTriggerDisplay("in", getAccountInValueEl()?.value ?? "");
  selectedTagIds.clear();
  selectedActualIds.clear();
  selectedActualDisplayInfo = [];
  renderTagChosenDisplay();
  renderActualChosenDisplay();
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
    fetchTagManagementRows(true),
    fetchTransactionManagementRows(true),
    fetchTransactionRows(true),
  ]);
  const txRows = txResult.rows;
  const row = txRows.find((r) => r.ID === transactionId);
  if (!row) return;
  const type = row.TYPE || "expense";
  const status = row.STATUS || "actual";
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
  fillAccountSelects(editableAccountIds);
  updateAccountRowsVisibility(type);
  if (type === "expense") {
    const firstIn = getFirstEditableAccountId("in");
    if (accountInEl) accountInEl.value = firstIn;
    updateAccountTriggerDisplay("in", firstIn);
  } else if (type === "income") {
    const firstOut = getFirstEditableAccountId("out");
    if (accountOutEl) accountOutEl.value = firstOut;
    updateAccountTriggerDisplay("out", firstOut);
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
  editableAccountIds = getEditableAccountIds(accountRows, permissionRows);
  const typeInput = getTypeInput();
  const type = typeInput?.value ?? "expense";
  fillCategorySelect(type);
  fillAccountSelects(editableAccountIds);
  updateAccountRowsVisibility(type);
  renderTagChosenDisplay();
}

function buildNewRow(form: HTMLFormElement, nextId: number): Record<string, string> {
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
  const row: Record<string, string> = {
    ID: String(nextId),
    REGIST_DATETIME: "",
    REGIST_USER: "",
    UPDATE_DATETIME: "",
    UPDATE_USER: "",
    TYPE: type,
    STATUS: status,
    CATEGORY_ID: categoryId,
    NAME: name,
    TRANDATE_FROM: trFrom,
    TRANDATE_TO: trTo,
    AMOUNT: amount,
    MEMO: memo,
    ACCOUNT_ID_IN: type === "income" || type === "transfer" ? accountIn : "",
    ACCOUNT_ID_OUT: type === "expense" || type === "transfer" ? accountOut : "",
  };
  setNewRowAudit(row, userId, String(nextId));
  return row;
}

function buildUpdatedRow(form: HTMLFormElement, existing: TransactionRow): Record<string, string> {
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
  const row: Record<string, string> = {
    ID: existing.ID,
    VERSION: existing.VERSION ?? "0",
    REGIST_DATETIME: existing.REGIST_DATETIME ?? "",
    REGIST_USER: existing.REGIST_USER ?? "",
    UPDATE_DATETIME: "",
    UPDATE_USER: "",
    TYPE: type,
    STATUS: status,
    CATEGORY_ID: categoryId,
    NAME: name,
    TRANDATE_FROM: trFrom,
    TRANDATE_TO: trTo,
    AMOUNT: amount,
    MEMO: memo,
    ACCOUNT_ID_IN: type === "income" || type === "transfer" ? accountIn : "",
    ACCOUNT_ID_OUT: type === "expense" || type === "transfer" ? accountOut : "",
  };
  setUpdateAudit(row, userId);
  return row;
}

async function saveTransactionCsv(csv: string): Promise<void> {
  await saveCsvViaApi("TRANSACTION.csv", csv);
}

async function saveTagManagementCsv(csv: string): Promise<void> {
  await saveCsvViaApi("TAG_MANAGEMENT.csv", csv);
}

async function saveTransactionManagementCsv(csv: string): Promise<void> {
  await saveCsvViaApi("TRANSACTION_MANAGEMENT.csv", csv);
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
      updateActualRowVisibility();
      setTransactionEntryReadonly(transactionEntryViewOnly);
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
    try {
      if (editingTransactionId) {
        const { rows } = await fetchTransactionRows(true);
        const existing = rows.find((r) => r.ID === editingTransactionId);
        if (!existing) {
          alert(getVersionConflictMessage({ allowed: false, notFound: true }));
          editingTransactionId = null;
          resetForm();
          pushNavigation("transaction-history");
          showMainView("transaction-history");
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
        const updatedRow = buildUpdatedRow(form, existing);
        const allRows = rows.map((r) =>
          r.ID === editingTransactionId ? (updatedRow as Record<string, string>) : ({ ...r } as Record<string, string>)
        );
        const csv = transactionListToCsv(allRows);
        await saveTransactionCsv(csv);
        const { nextId: nextMgmtId, rows: mgmtRows } = await fetchTagManagementRows(true);
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
        const mgmtCsv = tagManagementListToCsv(newMgmtRows);
        await saveTagManagementCsv(mgmtCsv);
        const { nextId: nextTxMgmtId, rows: txMgmtRows } = await fetchTransactionManagementRows(true);
        const othersTxMgmt = txMgmtRows.filter(
          (r) => r.TRAN_PLAN_ID !== editingTransactionId && (r.ID ?? "").trim() !== ""
        );
        const newTxMgmtRows = othersTxMgmt.map((r) => ({ ...r } as Record<string, string>));
        const savedStatus = (updatedRow as Record<string, string>).STATUS ?? "";
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
        resetForm();
        pushNavigation("transaction-history");
        showMainView("transaction-history");
      } else {
        const { nextId, rows } = await fetchTransactionRows(true);
        const newRow = buildNewRow(form, nextId);
        const allRows = [...rows.map((r) => ({ ...r } as Record<string, string>)), newRow];
        const csv = transactionListToCsv(allRows);
        await saveTransactionCsv(csv);
        const newTransactionId = String(nextId);
        if (selectedTagIds.size > 0) {
          const { nextId: nextMgmtId, rows: mgmtRows } = await fetchTagManagementRows(true);
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
          const mgmtCsv = tagManagementListToCsv(newMgmtRows);
          await saveTagManagementCsv(mgmtCsv);
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
        resetForm();
        if (!continuousMode) {
          pushNavigation("transaction-history");
          showMainView("transaction-history");
        }
      }
    } catch (err) {
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
        pushNavigation("transaction-history");
        showMainView("transaction-history");
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
      const newTxRows = txRows.filter((r) => r.ID !== editingTransactionId);
      const csv = transactionListToCsv(newTxRows.map((r) => ({ ...r } as Record<string, string>)));
      await saveTransactionCsv(csv);
      const { rows: mgmtRows } = await fetchTagManagementRows(true);
      const newMgmtRows = mgmtRows
        .filter((r) => r.TRANSACTION_ID !== editingTransactionId)
        .map((r) => ({ ...r } as Record<string, string>));
      const mgmtCsv = tagManagementListToCsv(newMgmtRows);
      await saveTagManagementCsv(mgmtCsv);
      const { rows: txMgmtRows } = await fetchTransactionManagementRows(true);
      const newTxMgmtRows = txMgmtRows
        .filter((r) => r.TRAN_PLAN_ID !== editingTransactionId && r.TRAN_ACTUAL_ID !== editingTransactionId)
        .map((r) => ({ ...r } as Record<string, string>));
      const txMgmtCsv = transactionManagementListToCsv(newTxMgmtRows);
      await saveTransactionManagementCsv(txMgmtCsv);
      editingTransactionId = null;
      resetForm();
      updateTransactionEntryDeleteButtonVisibility();
      updateTransactionEntryCopyAsNewButtonVisibility();
      updateTransactionEntryContinuousButtonVisibility();
      pushNavigation("transaction-history");
      showMainView("transaction-history");
    } catch (err) {
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
      const newRow = buildNewRow(form, nextId);
      const allRows = [...rows.map((r) => ({ ...r } as Record<string, string>)), newRow];
      const csv = transactionListToCsv(allRows);
      await saveTransactionCsv(csv);
      const newTransactionId = String(nextId);
      if (selectedTagIds.size > 0) {
        const { nextId: nextMgmtId, rows: mgmtRows } = await fetchTagManagementRows(true);
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
        const mgmtCsv = tagManagementListToCsv(newMgmtRows);
        await saveTagManagementCsv(mgmtCsv);
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
      editingTransactionId = null;
      resetForm();
      updateTransactionEntryDeleteButtonVisibility();
      updateTransactionEntrySubmitButtonVisibility();
      updateTransactionEntryCopyAsNewButtonVisibility();
      pushNavigation("transaction-history");
      showMainView("transaction-history");
    } catch (err) {
      console.error(err);
      alert("参照登録に失敗しました。");
    }
  });

  document.getElementById("transaction-entry-tag-open-btn")?.addEventListener("click", () => openTransactionEntryTagModal());
  document.getElementById("transaction-entry-actual-open-btn")?.addEventListener("click", () => openTransactionEntryActualModal());
  document.getElementById("transaction-entry-actual-select-apply")?.addEventListener("click", () => {
    const selected = getSelectedActualsFromModal();
    selectedActualIds = new Set(selected.map((a) => a.id));
    selectedActualDisplayInfo = selected;
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
  document.querySelector(".transaction-entry-actual-select-week-prev")?.addEventListener("click", () => {
    if (!actualSelectWeek) return;
    mergeActualSelectionFromModal();
    actualSelectWeek = {
      start: addDays(actualSelectWeek.start, -7),
      end: addDays(actualSelectWeek.end, -7),
    };
    renderActualSelectList();
  });
  document.querySelector(".transaction-entry-actual-select-week-next")?.addEventListener("click", () => {
    if (!actualSelectWeek) return;
    mergeActualSelectionFromModal();
    actualSelectWeek = {
      start: addDays(actualSelectWeek.start, 7),
      end: addDays(actualSelectWeek.end, 7),
    };
    renderActualSelectList();
  });
  document.getElementById("transaction-entry-actual-select-week-label")?.addEventListener("change", (e) => {
    const input = e.target as HTMLInputElement;
    const value = (input?.value || "").trim();
    if (value) {
      mergeActualSelectionFromModal();
      actualSelectWeek = getWeekRangeFromDate(value);
      renderActualSelectList();
    }
  });
  document.getElementById("transaction-entry-actual-select-overlay")?.addEventListener("click", (e) => {
    if (e.target instanceof HTMLElement && e.target.id === "transaction-entry-actual-select-overlay") {
      closeTransactionEntryActualModal();
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
