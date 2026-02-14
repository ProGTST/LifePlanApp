import { getAccountList, getCategoryList, getTagList } from "./storage.ts";
import {
  accountListToCsv,
  categoryListToCsv,
  tagListToCsv,
} from "./csvExport.ts";
import { flushMasterToStorage } from "./flushMasterStorage.ts";
import { clearAccountDirty, clearCategoryDirty, clearTagDirty } from "./csvDirty.ts";

/** Tauri 2 では invoke は __TAURI_INTERNALS__ 経由。__TAURI__ は withGlobalTauri: true のときのみ。 */
function isTauri(): boolean {
  return typeof (window as unknown as { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__?.invoke === "function";
}

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
 * localStorage の勘定・カテゴリー・タグを CSV 文字列に変換し、
 * Tauri 環境であれば app_data_dir/data/ に ACCOUNT.csv / CATEGORY.csv / TAG.csv として保存する。
 * 保存時は常に ID 昇順で出力する。
 */
export async function saveMasterToCsv(): Promise<void> {
  if (!isTauri()) return;

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

  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("save_master_csv", { account, category, tag });
}

/** 勘定のみ ACCOUNT.csv に保存する（画面遷移時用）。保存完了後に clearAccountDirty。 */
export function saveAccountCsvOnly(): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  flushMasterToStorage();
  const accountList = getAccountList();
  const account =
    accountList != null && Array.isArray(accountList)
      ? accountListToCsv(sortRowsById(accountList as Record<string, string>[]))
      : "";
  return import("@tauri-apps/api/core").then(({ invoke }) =>
    invoke("save_account_csv", { account }).then(() => clearAccountDirty())
  );
}

/** カテゴリーのみ CATEGORY.csv に保存する（画面遷移時用）。保存完了後に clearCategoryDirty。 */
export function saveCategoryCsvOnly(): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  flushMasterToStorage();
  const categoryList = getCategoryList();
  const category =
    categoryList != null && Array.isArray(categoryList)
      ? categoryListToCsv(sortRowsById(categoryList as Record<string, string>[]))
      : "";
  return import("@tauri-apps/api/core").then(({ invoke }) =>
    invoke("save_category_csv", { category }).then(() => clearCategoryDirty())
  );
}

/** タグのみ TAG.csv に保存する（画面遷移時用）。保存完了後に clearTagDirty。 */
export function saveTagCsvOnly(): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  flushMasterToStorage();
  const tagList = getTagList();
  const tag =
    tagList != null && Array.isArray(tagList)
      ? tagListToCsv(sortRowsById(tagList as Record<string, string>[]))
      : "";
  return import("@tauri-apps/api/core").then(({ invoke }) =>
    invoke("save_tag_csv", { tag }).then(() => clearTagDirty())
  );
}
