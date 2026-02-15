import { getAccountList, getAccountPermissionList, getCategoryList, getTagList } from "./storage.ts";
import {
  accountListToCsv,
  accountPermissionListToCsv,
  categoryListToCsv,
  tagListToCsv,
} from "./csvExport.ts";
import { flushMasterToStorage } from "./flushMasterStorage.ts";
import { clearAccountDirty, clearCategoryDirty, clearTagDirty } from "./csvDirty.ts";
import { saveCsvViaApi } from "./dataApi.ts";

/** CSV 保存用：ID 昇順でソートした配列を返す */
function sortRowsById(rows: Record<string, string>[]): Record<string, string>[] {
  return [...rows].sort((a, b) => {
    const idA = Number(a.ID);
    const idB = Number(b.ID);
    if (!Number.isNaN(idA) && !Number.isNaN(idB)) return idA - idB;
    return String(a.ID ?? "").localeCompare(String(b.ID ?? ""));
  });
}

/**
 * localStorage の勘定・カテゴリー・タグを CSV に変換し、API 経由で保存する。
 * 保存時は常に ID 昇順で出力する。
 */
export async function saveMasterToCsv(): Promise<void> {
  const accountList = getAccountList();
  const categoryList = getCategoryList();
  const tagList = getTagList();

  const account =
    accountList != null && Array.isArray(accountList)
      ? accountListToCsv(sortRowsById(accountList as Record<string, string>[]))
      : "";
  const category =
    categoryList != null && Array.isArray(categoryList)
      ? categoryListToCsv(sortRowsById(categoryList as Record<string, string>[]))
      : "";
  const tag =
    tagList != null && Array.isArray(tagList)
      ? tagListToCsv(sortRowsById(tagList as Record<string, string>[]))
      : "";

  if (account) await saveCsvViaApi("ACCOUNT.csv", account);
  if (category) await saveCsvViaApi("CATEGORY.csv", category);
  if (tag) await saveCsvViaApi("TAG.csv", tag);
}

/** 勘定と勘定参照権限を ACCOUNT.csv / ACCOUNT_PERMISSION.csv に保存する（画面遷移時用）。保存完了後に clearAccountDirty。 */
export function saveAccountCsvOnly(): Promise<void> {
  flushMasterToStorage();
  const accountList = getAccountList();
  const account =
    accountList != null && Array.isArray(accountList)
      ? accountListToCsv(sortRowsById(accountList as Record<string, string>[]))
      : "";
  const permissionList = getAccountPermissionList();
  const account_permission =
    permissionList != null && Array.isArray(permissionList) && permissionList.length > 0
      ? accountPermissionListToCsv(sortRowsById(permissionList as Record<string, string>[]))
      : accountPermissionListToCsv([]);
  return Promise.all([
    account ? saveCsvViaApi("ACCOUNT.csv", account) : Promise.resolve(),
    saveCsvViaApi("ACCOUNT_PERMISSION.csv", account_permission),
  ]).then(() => clearAccountDirty());
}

/** カテゴリーのみ CATEGORY.csv に保存する（画面遷移時用）。保存完了後に clearCategoryDirty。 */
export function saveCategoryCsvOnly(): Promise<void> {
  flushMasterToStorage();
  const categoryList = getCategoryList();
  const category =
    categoryList != null && Array.isArray(categoryList)
      ? categoryListToCsv(sortRowsById(categoryList as Record<string, string>[]))
      : "";
  return (category ? saveCsvViaApi("CATEGORY.csv", category) : Promise.resolve()).then(() =>
    clearCategoryDirty()
  );
}

/** タグのみ TAG.csv に保存する（画面遷移時用）。保存完了後に clearTagDirty。 */
export function saveTagCsvOnly(): Promise<void> {
  flushMasterToStorage();
  const tagList = getTagList();
  const tag =
    tagList != null && Array.isArray(tagList)
      ? tagListToCsv(sortRowsById(tagList as Record<string, string>[]))
      : "";
  return (tag ? saveCsvViaApi("TAG.csv", tag) : Promise.resolve()).then(() => clearTagDirty());
}
