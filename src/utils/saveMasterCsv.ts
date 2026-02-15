import { accountListFull, accountPermissionListFull, categoryListFull, tagListFull } from "../state";
import {
  accountListToCsv,
  accountPermissionListToCsv,
  categoryListToCsv,
  tagListToCsv,
} from "./csvExport.ts";
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
 * メモリ上の勘定・カテゴリー・タグを CSV に変換し、API 経由で保存する。
 * 保存時は常に ID 昇順で出力する。
 */
export async function saveMasterToCsv(): Promise<void> {
  const account =
    accountListFull.length > 0
      ? accountListToCsv(sortRowsById(accountListFull as unknown as Record<string, string>[]))
      : "";
  const category =
    categoryListFull.length > 0
      ? categoryListToCsv(sortRowsById(categoryListFull as unknown as Record<string, string>[]))
      : "";
  const tag =
    tagListFull.length > 0
      ? tagListToCsv(sortRowsById(tagListFull as unknown as Record<string, string>[]))
      : "";

  if (account) await saveCsvViaApi("ACCOUNT.csv", account);
  if (category) await saveCsvViaApi("CATEGORY.csv", category);
  if (tag) await saveCsvViaApi("TAG.csv", tag);
}

/** 勘定と勘定参照権限を ACCOUNT.csv / ACCOUNT_PERMISSION.csv に保存する（画面遷移時用）。保存完了後に clearAccountDirty。 */
export function saveAccountCsvOnly(): Promise<void> {
  const account =
    accountListFull.length > 0
      ? accountListToCsv(sortRowsById(accountListFull as unknown as Record<string, string>[]))
      : "";
  const account_permission =
    accountPermissionListFull.length > 0
      ? accountPermissionListToCsv(sortRowsById(accountPermissionListFull as unknown as Record<string, string>[]))
      : accountPermissionListToCsv([]);
  return Promise.all([
    account ? saveCsvViaApi("ACCOUNT.csv", account) : Promise.resolve(),
    saveCsvViaApi("ACCOUNT_PERMISSION.csv", account_permission),
  ]).then(() => clearAccountDirty());
}

/** カテゴリーのみ CATEGORY.csv に保存する（画面遷移時用）。保存完了後に clearCategoryDirty。 */
export function saveCategoryCsvOnly(): Promise<void> {
  const category =
    categoryListFull.length > 0
      ? categoryListToCsv(sortRowsById(categoryListFull as unknown as Record<string, string>[]))
      : "";
  return (category ? saveCsvViaApi("CATEGORY.csv", category) : Promise.resolve()).then(() =>
    clearCategoryDirty()
  );
}

/** タグのみ TAG.csv に保存する（画面遷移時用）。保存完了後に clearTagDirty。 */
export function saveTagCsvOnly(): Promise<void> {
  const tag =
    tagListFull.length > 0
      ? tagListToCsv(sortRowsById(tagListFull as unknown as Record<string, string>[]))
      : "";
  return (tag ? saveCsvViaApi("TAG.csv", tag) : Promise.resolve()).then(() => clearTagDirty());
}
