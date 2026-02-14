/**
 * メモリ上のマスタデータ（勘定・カテゴリー・タグ）を localStorage に書き出す。
 * ログアウト時やアプリ終了前に呼び、続けて saveMasterToCsv で CSV 更新する想定。
 */
import { accountListFull, categoryListFull, tagListFull } from "../state";
import { setAccountList, setCategoryList, setTagList } from "./storage.ts";

export function flushMasterToStorage(): void {
  setAccountList(accountListFull);
  setCategoryList(categoryListFull);
  setTagList(tagListFull);
}
