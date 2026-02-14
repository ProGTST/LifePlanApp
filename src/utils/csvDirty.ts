/**
 * 各マスタが CSV に未保存かどうか（メモリ／localStorage と CSV の差分）。
 * ログアウト・終了時は dirty なものだけ CSV に保存する。
 */
export let accountDirty = false;
export let categoryDirty = false;
export let tagDirty = false;
export let userDirty = false;
export let colorPaletteDirty = false;

export function setAccountDirty(): void {
  accountDirty = true;
}
export function setCategoryDirty(): void {
  categoryDirty = true;
}
export function setTagDirty(): void {
  tagDirty = true;
}
export function setUserDirty(): void {
  userDirty = true;
}
export function setColorPaletteDirty(): void {
  colorPaletteDirty = true;
}

export function clearAccountDirty(): void {
  accountDirty = false;
}
export function clearCategoryDirty(): void {
  categoryDirty = false;
}
export function clearTagDirty(): void {
  tagDirty = false;
}
export function clearUserDirty(): void {
  userDirty = false;
}
export function clearColorPaletteDirty(): void {
  colorPaletteDirty = false;
}
