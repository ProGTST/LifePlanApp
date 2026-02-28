import {
  accountListFull,
  accountPermissionListFull,
  categoryListFull,
  tagListFull,
  getLastCsvVersion,
} from "../state";
import { currentUserId } from "../state";
import { EMPTY_USER_ID } from "../constants";
import {
  accountListToCsv,
  accountPermissionListToCsv,
  categoryListToCsv,
  tagListToCsv,
} from "./csvExport.ts";
import { clearAccountDirty, clearCategoryDirty, clearTagDirty } from "./csvDirty.ts";
import { saveCsvViaApi } from "./dataApi.ts";
import { fetchCsv } from "./csv.ts";
import { rowToObject } from "./csv.ts";

/**
 * 行配列を ID 列で昇順にソートする（数値として解釈、無効は末尾）。CSV 保存時の出力順に利用する。
 * @param rows - キーに ID を持つオブジェクトの配列
 * @returns ソート済みの新規配列
 */
function sortRowsById(rows: Record<string, string>[]): Record<string, string>[] {
  return [...rows].sort((a, b) => {
    const idA = Number(a.ID);
    const idB = Number(b.ID);
    if (!Number.isNaN(idA) && !Number.isNaN(idB)) return idA - idB;
    return String(a.ID ?? "").localeCompare(String(b.ID ?? ""));
  });
}

/**
 * 勘定と勘定参照権限を ACCOUNT.csv / ACCOUNT_PERMISSION.csv に保存する（画面遷移時用）。保存完了後に clearAccountDirty を呼ぶ。
 * @returns Promise（保存とクリア完了で resolve）
 */
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
    account
      ? saveCsvViaApi("ACCOUNT.csv", account, getLastCsvVersion("ACCOUNT.csv"))
      : Promise.resolve(),
    saveCsvViaApi(
      "ACCOUNT_PERMISSION.csv",
      account_permission,
      getLastCsvVersion("ACCOUNT_PERMISSION.csv")
    ),
  ]).then(() => clearAccountDirty());
}

/**
 * カテゴリーのみ CATEGORY.csv に保存する（画面遷移時用）。他ユーザーの行を維持しつつ、自ユーザーの行をマージして保存。保存完了後に clearCategoryDirty を呼ぶ。
 * @returns Promise（保存とクリア完了で resolve）
 */
export function saveCategoryCsvOnly(): Promise<void> {
  const me = (currentUserId ?? "").trim();
  return fetchCsv("/data/CATEGORY.csv")
    .then(({ header, rows }) => {
      const otherRows: Record<string, string>[] = [];
      for (const cells of rows) {
        const row = rowToObject(header, cells);
        const rowUserId = (row.USER_ID ?? "").trim() || EMPTY_USER_ID;
        if (rowUserId !== me) otherRows.push(row);
      }
      const merged = [...otherRows, ...(categoryListFull as unknown as Record<string, string>[])];
      return categoryListToCsv(sortRowsById(merged));
    })
    .then((category) =>
      category
        ? saveCsvViaApi("CATEGORY.csv", category, getLastCsvVersion("CATEGORY.csv"))
        : Promise.resolve()
    )
    .then(() => clearCategoryDirty())
    .catch((e) => {
      clearCategoryDirty();
      throw e;
    });
}

/**
 * タグのみ TAG.csv に保存する（画面遷移時用）。他ユーザーの行を維持しつつ、自ユーザーの行をマージして保存。保存完了後に clearTagDirty を呼ぶ。
 * @returns Promise（保存とクリア完了で resolve）
 */
export function saveTagCsvOnly(): Promise<void> {
  const me = (currentUserId ?? "").trim();
  return fetchCsv("/data/TAG.csv")
    .then(({ header, rows }) => {
      const otherRows: Record<string, string>[] = [];
      for (const cells of rows) {
        const row = rowToObject(header, cells);
        const rowUserId = (row.USER_ID ?? "").trim() || EMPTY_USER_ID;
        if (rowUserId !== me) otherRows.push(row);
      }
      const merged = [...otherRows, ...(tagListFull as unknown as Record<string, string>[])];
      return tagListToCsv(sortRowsById(merged));
    })
    .then((tag) =>
      tag ? saveCsvViaApi("TAG.csv", tag, getLastCsvVersion("TAG.csv")) : Promise.resolve()
    )
    .then(() => clearTagDirty())
    .catch((e) => {
      clearTagDirty();
      throw e;
    });
}
