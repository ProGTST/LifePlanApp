/** localStorage のキー（マスタデータ永続化） */
const KEY_ACCOUNT = "lifeplan_account";
const KEY_ACCOUNT_PERMISSION = "lifeplan_account_permission";
const KEY_CATEGORY = "lifeplan_category";
const KEY_TAG = "lifeplan_tag";
const KEY_COLOR_PALETTE = "lifeplan_color_palette";

function get<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function set(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // quota exceeded or disabled
  }
}

export function getAccountList(): unknown[] | null {
  return get<unknown[]>(KEY_ACCOUNT);
}

export function setAccountList(list: unknown[]): void {
  set(KEY_ACCOUNT, list);
}

export function getAccountPermissionList(): unknown[] | null {
  return get<unknown[]>(KEY_ACCOUNT_PERMISSION);
}

export function setAccountPermissionList(list: unknown[]): void {
  set(KEY_ACCOUNT_PERMISSION, list);
}

export function getCategoryList(): unknown[] | null {
  return get<unknown[]>(KEY_CATEGORY);
}

export function setCategoryList(list: unknown[]): void {
  set(KEY_CATEGORY, list);
}

export function getTagList(): unknown[] | null {
  return get<unknown[]>(KEY_TAG);
}

export function setTagList(list: unknown[]): void {
  set(KEY_TAG, list);
}

/** ユーザー別カラーパレット（キー: パレットキー, 値: 6桁hex） */
export function getColorPalette(userId: string): Record<string, string> | null {
  const all = get<Record<string, Record<string, string>>>(KEY_COLOR_PALETTE);
  if (!all || !userId) return null;
  return all[userId] ?? null;
}

export function setColorPalette(userId: string, palette: Record<string, string>): void {
  if (!userId) return;
  const all = get<Record<string, Record<string, string>>>(KEY_COLOR_PALETTE) ?? {};
  all[userId] = palette;
  set(KEY_COLOR_PALETTE, all);
}
