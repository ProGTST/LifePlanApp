/**
 * 各マスタが CSV に未保存かどうか（メモリ／localStorage と CSV の差分）。
 * ログアウト・終了時は dirty なものだけ CSV に保存する。
 */
export let accountDirty = false;
export let categoryDirty = false;
export let tagDirty = false;
export let userDirty = false;
export let colorPaletteDirty = false;

/** 勘定項目が未保存であることをマークする。戻り値なし。 */
export function setAccountDirty(): void {
  accountDirty = true;
}
/** カテゴリーが未保存であることをマークする。戻り値なし。 */
export function setCategoryDirty(): void {
  categoryDirty = true;
}
/** タグが未保存であることをマークする。戻り値なし。 */
export function setTagDirty(): void {
  tagDirty = true;
}
/** ユーザーが未保存であることをマークする。戻り値なし。 */
export function setUserDirty(): void {
  userDirty = true;
}
/** カラーパレットが未保存であることをマークする。戻り値なし。 */
export function setColorPaletteDirty(): void {
  colorPaletteDirty = true;
}

/** 勘定項目の未保存フラグをクリアする。戻り値なし。 */
export function clearAccountDirty(): void {
  accountDirty = false;
}
/** カテゴリーの未保存フラグをクリアする。戻り値なし。 */
export function clearCategoryDirty(): void {
  categoryDirty = false;
}
/** タグの未保存フラグをクリアする。戻り値なし。 */
export function clearTagDirty(): void {
  tagDirty = false;
}
/** ユーザーの未保存フラグをクリアする。戻り値なし。 */
export function clearUserDirty(): void {
  userDirty = false;
}
/** カラーパレットの未保存フラグをクリアする。戻り値なし。 */
export function clearColorPaletteDirty(): void {
  colorPaletteDirty = false;
}
