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

export async function saveDirtyCsvsOnly(): Promise<void> {
  const promises: Promise<void>[] = [];
  if (accountDirty) promises.push(saveAccountCsvOnly());
  if (categoryDirty) promises.push(saveCategoryCsvOnly());
  if (tagDirty) promises.push(saveTagCsvOnly());
  if (userDirty) promises.push(saveUserCsvOnNavigate());
  if (colorPaletteDirty) promises.push(saveColorPaletteCsvOnNavigate());
  await Promise.all(promises);
}
