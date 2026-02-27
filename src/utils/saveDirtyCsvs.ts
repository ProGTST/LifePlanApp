/**
 * ログアウト・終了時: 未保存のマスタだけ CSV 保存する。
 */
import {
  accountDirty,
  categoryDirty,
  tagDirty,
  userDirty,
  colorPaletteDirty,
} from "./csvDirty.ts";
import {
  saveAccountCsvOnly,
  saveCategoryCsvOnly,
  saveTagCsvOnly,
} from "./saveMasterCsv.ts";
import { saveUserCsvOnNavigate } from "../screens/profile-screen.ts";
import { saveColorPaletteCsvOnNavigate } from "../screens/design-screen.ts";
import { VersionConflictError } from "./dataApi.ts";

/**
 * 409 のときメッセージを表示してから再 throw する。
 */
function catchVersionConflict(p: Promise<void>): Promise<void> {
  return p.catch((e) => {
    if (e instanceof VersionConflictError) alert(e.message);
    throw e;
  });
}

/**
 * ログアウト・終了時用。未保存のマスタ（勘定・カテゴリー・タグ・ユーザー・カラーパレット）だけを CSV 保存する。
 * 409 のときは日本語メッセージを表示してから Promise を reject する。
 * @returns Promise（該当する保存がすべて完了で resolve）
 */
export async function saveDirtyCsvsOnly(): Promise<void> {
  const promises: Promise<void>[] = [];
  if (accountDirty) promises.push(catchVersionConflict(saveAccountCsvOnly()));
  if (categoryDirty) promises.push(catchVersionConflict(saveCategoryCsvOnly()));
  if (tagDirty) promises.push(catchVersionConflict(saveTagCsvOnly()));
  if (userDirty) promises.push(catchVersionConflict(saveUserCsvOnNavigate()));
  if (colorPaletteDirty) promises.push(catchVersionConflict(saveColorPaletteCsvOnNavigate()));
  await Promise.all(promises);
}

