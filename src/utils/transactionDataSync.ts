/**
 * 収支履歴・カレンダー・スケジュールで共通利用する取引・マスタデータの読み込みと参照用ユーティリティ（transactionDataSync）。
 */
import type {
  TransactionRow,
  CategoryRow,
  AccountRow,
  AccountPermissionRow,
  TagRow,
  TransactionTagRow,
  TransactionManagementRow,
} from "../types";
import { currentUserId, setTransactionList, setTransactionTagList, transactionList } from "../state";
import { fetchCsv, rowToObject } from "./csv";
import { sortOrderNum } from "./dragSort";

const CSV_NO_CACHE: RequestInit = { cache: "reload" };

let categoryRows: CategoryRow[] = [];
let tagRows: TagRow[] = [];
let accountRows: AccountRow[] = [];
let permissionRows: AccountPermissionRow[] = [];
let transactionManagementRows: TransactionManagementRow[] = [];

/** 取引・マスタを一度でも読み込み済みか（メニューからスケジュール/カレンダーを再表示するときのキャッシュ判定に使用） */
let transactionDataLoaded = false;

/**
 * 取引データのキャッシュを無効化する。次回の loadTransactionData() で再取得される。
 * 収支記録の保存後や、取引関連 CSV の更新後に呼ぶと、スケジュール・カレンダーで最新が表示される。
 */
export function invalidateTransactionDataCache(): void {
  transactionDataLoaded = false;
}

/**
 * TRANSACTION.csv を取得して取引行の配列で返す。
 * @param noCache - true のときキャッシュを使わず再取得する
 * @returns 取引行の配列
 */
async function fetchTransactionList(noCache = false): Promise<TransactionRow[]> {
  const init = noCache ? CSV_NO_CACHE : undefined;
  const { header, rows } = await fetchCsv("/data/TRANSACTION.csv", init);
  if (header.length === 0) return [];
  const list: TransactionRow[] = [];
  for (const cells of rows) {
    // 行をオブジェクト化して配列に追加
    const row = rowToObject(header, cells) as unknown as TransactionRow;
    list.push(row);
  }
  return list;
}

/**
 * ACCOUNT_PERMISSION.csv を取得して権限行の配列で返す。
 * @param noCache - true のときキャッシュを使わず再取得する
 * @returns 勘定権限行の配列
 */
async function fetchAccountPermissionList(noCache = false): Promise<AccountPermissionRow[]> {
  const init = noCache ? CSV_NO_CACHE : undefined;
  const { header, rows } = await fetchCsv("/data/ACCOUNT_PERMISSION.csv", init);
  if (header.length === 0) return [];
  const list: AccountPermissionRow[] = [];
  // 空行はスキップし、有効な行のみオブジェクトに変換
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
  // 自分の勘定 ID と権限付与された勘定 ID を Set に集約
  accountRows.filter((a) => a.USER_ID === me).forEach((a) => ids.add(a.ID));
  permissionRows.filter((p) => p.USER_ID === me).forEach((p) => ids.add(p.ACCOUNT_ID));
  return ids;
}

/**
 * 参照可能な勘定に紐づく取引のみに絞る。
 * @param txList - 取引行の配列
 * @param visibleAccountIds - 参照可能な勘定 ID の Set
 * @returns 絞り込み後の取引行の配列
 */
function filterTransactionsByVisibleAccounts(
  txList: TransactionRow[],
  visibleAccountIds: Set<string>
): TransactionRow[] {
  // 入金先または出金元のいずれかが参照可能勘定に含まれる取引のみ残す
  // 入金先または出金元のどちらかが参照可能な勘定に含まれる取引のみ残す
  return txList.filter((row) => {
    const inId = (row.ACCOUNT_ID_IN || "").trim();
    const outId = (row.ACCOUNT_ID_OUT || "").trim();
    return (inId && visibleAccountIds.has(inId)) || (outId && visibleAccountIds.has(outId));
  });
}

/**
 * CATEGORY.csv を取得してカテゴリー行の配列で返す。
 * @param noCache - true のときキャッシュを使わず再取得する
 * @returns カテゴリー行の配列
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
 * ACCOUNT.csv を取得して勘定行の配列で返す。
 * @param noCache - true のときキャッシュを使わず再取得する
 * @returns 勘定行の配列
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
 * TAG.csv を取得してタグ行の配列で返す。SORT_ORDER 未設定時は行番で補う。
 * @param noCache - true のときキャッシュを使わず再取得する
 * @returns タグ行の配列
 */
async function fetchTagList(noCache = false): Promise<TagRow[]> {
  const init = noCache ? CSV_NO_CACHE : undefined;
  const { header, rows } = await fetchCsv("/data/TAG.csv", init);
  if (header.length === 0) return [];
  const list: TagRow[] = [];
  for (const cells of rows) {
    const row = rowToObject(header, cells) as unknown as TagRow;
    // SORT_ORDER 未設定時は行番で補う
    if (row.SORT_ORDER === undefined || row.SORT_ORDER === "") row.SORT_ORDER = String(list.length);
    list.push(row);
  }
  return list;
}

/**
 * TRANSACTION_TAG.csv を取得してタグ紐付け行の配列で返す。
 * @param noCache - true のときキャッシュを使わず再取得する
 * @returns タグ紐付け行の配列
 */
async function fetchTransactionTagList(noCache = false): Promise<TransactionTagRow[]> {
  const init = noCache ? CSV_NO_CACHE : undefined;
  const { header, rows } = await fetchCsv("/data/TRANSACTION_TAG.csv", init);
  if (header.length === 0) return [];
  const list: TransactionTagRow[] = [];
  for (const cells of rows) {
    list.push(rowToObject(header, cells) as unknown as TransactionTagRow);
  }
  return list;
}

/**
 * TRANSACTION_MANAGEMENT.csv を取得して予定-実績紐付け行の配列で返す。
 * @param noCache - true のときキャッシュを使わず再取得する
 * @returns 紐付け行の配列
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
 * 取引・マスタデータを CSV から取得し state に反映する。一覧・カレンダー両方で利用。
 * レスポンス改善: noCache が false で既に読み込み済みの場合は再取得せず即解決する
 * （メニューからスケジュール/カレンダーを再表示するときの体感速度向上）。
 * @param noCache - true のときキャッシュを使わず必ず再取得する（データ最新化時など）
 * @returns 完了する Promise
 */
export function loadTransactionData(noCache = false): Promise<void> {
  if (!noCache && transactionDataLoaded) {
    return Promise.resolve();
  }
  if (noCache) {
    transactionDataLoaded = false;
  }
  return Promise.all([
    fetchTransactionList(noCache),
    fetchCategoryList(noCache),
    fetchTagList(noCache),
    fetchAccountList(noCache),
    fetchAccountPermissionList(noCache),
    fetchTransactionTagList(noCache),
    fetchTransactionManagementList(noCache),
  ]).then(([txList, catList, tagList, accList, permList, txTag, txMgmt]) => {
    // 参照可能な勘定 ID を算出し、削除フラグ未設定かつ参照可能な取引のみ state に設定
    const visibleIds = getVisibleAccountIds(accList, permList);
    const notDeleted = txList.filter((r) => (r.DLT_FLG || "0") !== "1");
    const filteredTx = filterTransactionsByVisibleAccounts(notDeleted, visibleIds);
    setTransactionList(filteredTx);
    // マスタをメモリに保持（getCategoryById 等で参照）
    categoryRows = catList;
    tagRows = tagList;
    accountRows = accList;
    permissionRows = permList;
    setTransactionTagList(txTag);
    transactionManagementRows = txMgmt;
    transactionDataLoaded = true;
  });
}

/**
 * ID でカテゴリー行を検索する。
 * @param id - カテゴリー ID
 * @returns 該当するカテゴリー行。なければ undefined
 */
export function getCategoryById(id: string): CategoryRow | undefined {
  return categoryRows.find((c) => c.ID === id);
}

/**
 * ID で勘定行を検索する。
 * @param id - 勘定 ID
 * @returns 該当する勘定行。なければ undefined
 */
export function getAccountById(id: string): AccountRow | undefined {
  return accountRows.find((a) => a.ID === id);
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
  // 入金先・出金元の各勘定について、他人勘定なら権限種別を確認
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
 * 取引に紐づくタグの一覧を返す（TRANSACTION_TAG と TAG から取得）。
 * @param transactionId - 取引 ID
 * @param transactionTagList - タグ紐付け一覧
 * @returns タグ行の配列
 */
export function getTagsForTransaction(
  transactionId: string,
  transactionTagList: TransactionTagRow[]
): TagRow[] {
  const tagIds = transactionTagList
    .filter((t) => t.TRANSACTION_ID === transactionId)
    .map((t) => t.TAG_ID);
  return tagIds
    .map((id) => tagRows.find((r) => r.ID === id))
    .filter((r): r is TagRow => !!r);
}

/**
 * タグ一覧をソート順で返す。収支履歴のタグモーダル等で使用。
 * @returns タグ行の配列（SORT_ORDER を数値としてソート済み）
 */
export function getTagRows(): TagRow[] {
  return tagRows.slice().sort((a, b) => sortOrderNum(a.SORT_ORDER, b.SORT_ORDER));
}

/**
 * カテゴリー一覧を返す。収支履歴のカテゴリーフィルター等で使用。
 * @returns カテゴリー行の配列
 */
export function getCategoryRows(): CategoryRow[] {
  return categoryRows.slice();
}

/**
 * 勘定一覧を返す。収支履歴の勘定フィルター等で使用。
 * @returns 勘定行の配列
 */
export function getAccountRows(): AccountRow[] {
  return accountRows.slice();
}

/**
 * 勘定権限一覧を返す。共有勘定の参照用。
 * @returns 勘定権限行の配列
 */
export function getPermissionRows(): AccountPermissionRow[] {
  return permissionRows.slice();
}
