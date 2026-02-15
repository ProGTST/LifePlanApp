/** localStorage のキー（デザイン：ユーザー別カラーパレットのみ使用） */
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
