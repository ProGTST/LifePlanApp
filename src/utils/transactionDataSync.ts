/**
 * 収支履歴・カレンダー・スケジュールで共通利用する取引・マスタデータの読み込みと参照用ユーティリティ（transactionDataSync）。
 */
import type {
  TransactionRow,
  CategoryRow,
  AccountRow,
  AccountPermissionRow,
  TagRow,
  TagManagementRow,
  TransactionManagementRow,
} from "../types";
import { currentUserId, setTransactionList, setTagManagementList, transactionList } from "../state";
import { fetchCsv, rowToObject } from "./csv";

const CSV_NO_CACHE: RequestInit = { cache: "reload" };

let categoryRows: CategoryRow[] = [];
let tagRows: TagRow[] = [];
let accountRows: AccountRow[] = [];
let permissionRows: AccountPermissionRow[] = [];
let transactionManagementRows: TransactionManagementRow[] = [];

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

/**
 * ID でカテゴリー行を検索する。
 */
export function getCategoryById(id: string): CategoryRow | undefined {
  return categoryRows.find((c) => c.ID === id);
}

/**
 * ID で勘定行を検索する。
 */
export function getAccountById(id: string): AccountRow | undefined {
  return accountRows.find((a) => a.ID === id);
}

/**
 * 取引が権限付与された勘定に紐づく場合、その権限種別を返す（参照→薄黄、編集→薄緑の行背景に利用）。
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
 * 取引予定に紐づく取引実績の ID 一覧を返す（TRANSACTION_MANAGEMENT から取得）。
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
 */
export function getTagsForTransaction(
  transactionId: string,
  tagManagementList: TagManagementRow[]
): TagRow[] {
  const tagIds = tagManagementList
    .filter((t) => t.TRANSACTION_ID === transactionId)
    .map((t) => t.TAG_ID);
  return tagIds
    .map((id) => tagRows.find((r) => r.ID === id))
    .filter((r): r is TagRow => !!r);
}

/** タグ一覧（ソート順）。収支履歴のタグモーダル等で使用。 */
export function getTagRows(): TagRow[] {
  return tagRows.slice().sort((a, b) => (a.SORT_ORDER || "").localeCompare(b.SORT_ORDER || ""));
}

/** カテゴリー一覧。収支履歴のカテゴリーフィルター等で使用。 */
export function getCategoryRows(): CategoryRow[] {
  return categoryRows.slice();
}

/** 勘定一覧。収支履歴の勘定フィルター等で使用。 */
export function getAccountRows(): AccountRow[] {
  return accountRows.slice();
}

/** 勘定権限一覧。共有勘定の参照用。 */
export function getPermissionRows(): AccountPermissionRow[] {
  return permissionRows.slice();
}
