import { APP_SCREEN_ID } from "../constants/index";
import {
  PALETTE_KEYS,
  CSS_VAR_MAP,
  DEFAULT_PALETTE,
} from "../constants/index";
import { fetchCsv, rowToObject } from "../utils/csv";
import { getColorPalette } from "../utils/storage";

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

/** ヘッダー先頭の BOM を除去（CSV の USER_ID 列が正しく一致するようにする） */
function normalizeHeader(header: string[]): string[] {
  if (header.length === 0) return header;
  return header.map((h, i) => (i === 0 ? h.replace(/^\uFEFF/, "") : h));
}

function toValidHex(v: string | undefined, key: (typeof PALETTE_KEYS)[number]): string {
  const t = (v ?? "").trim();
  const normalized = t.startsWith("#") ? t : `#${t}`;
  return HEX_COLOR.test(normalized) ? normalized : DEFAULT_PALETTE[key];
}

export async function applyUserPalette(userId: string): Promise<void> {
  const appEl = document.getElementById(APP_SCREEN_ID);
  if (!appEl) return;

  PALETTE_KEYS.forEach((key) => {
    appEl.style.setProperty(CSS_VAR_MAP[key], DEFAULT_PALETTE[key]);
  });

  const { header, rows } = await fetchCsv("/data/COLOR_PALETTE.csv");
  if (header.length === 0) return;

  const normalizedHeader = normalizeHeader(header);
  const colIndex: Record<string, number> = {};
  normalizedHeader.forEach((name, i) => {
    colIndex[name] = i;
  });
  const userCol = colIndex["USER_ID"];
  if (userCol === undefined) return;

  for (const cells of rows) {
    if (cells[userCol] !== userId) continue;
    const row = rowToObject(normalizedHeader, cells);
    PALETTE_KEYS.forEach((key) => {
      const value = toValidHex(row[key], key);
      appEl.style.setProperty(CSS_VAR_MAP[key], value);
    });
    break;
  }

  // デザイン画面で保存したパレット（localStorage）があれば上書き（MAIN_BG/MAIN_FG 等を反映）
  const stored = getColorPalette(userId);
  if (stored) {
    PALETTE_KEYS.forEach((key) => {
      const value = toValidHex(stored[key], key);
      appEl.style.setProperty(CSS_VAR_MAP[key], value);
    });
  }
}
