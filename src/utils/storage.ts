/** localStorage のキー（デザイン：ユーザー別カラーパレットのみ使用） */
const KEY_COLOR_PALETTE = "lifeplan_color_palette";

/**
 * localStorage から JSON を取得してパースする。
 * @param key - キー名
 * @returns パース結果。失敗時は null
 */
function get<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * オブジェクトを JSON 化して localStorage に保存する。
 * @param key - キー名
 * @param value - 保存する値（JSON 化可能なもの）
 * @returns なし
 */
function set(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // quota exceeded or disabled
  }
}

/**
 * 指定ユーザーのカラーパレット（パレットキー → 6桁hex）を取得する。
 * @param userId - ユーザー ID
 * @returns パレットオブジェクト。未保存なら null
 */
export function getColorPalette(userId: string): Record<string, string> | null {
  const all = get<Record<string, Record<string, string>>>(KEY_COLOR_PALETTE);
  if (!all || !userId) return null;
  return all[userId] ?? null;
}

/**
 * 指定ユーザーのカラーパレットを localStorage に保存する。
 * @param userId - ユーザー ID
 * @param palette - パレットキーをキー、色（6桁hex等）を値としたオブジェクト
 * @returns なし
 */
export function setColorPalette(userId: string, palette: Record<string, string>): void {
  if (!userId) return;
  const all = get<Record<string, Record<string, string>>>(KEY_COLOR_PALETTE) ?? {};
  all[userId] = palette;
  set(KEY_COLOR_PALETTE, all);
}
