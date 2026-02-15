import { currentUserId, currentView } from "../state";
import { fetchCsv, rowToObject } from "../utils/csv";
import { registerViewHandler } from "../app/screen";
import { colorPaletteListToCsv } from "../utils/csvExport.ts";
import { PALETTE_KEYS, CSS_VAR_MAP, DEFAULT_PALETTE } from "../constants/index";
import { setColorPaletteDirty, clearColorPaletteDirty } from "../utils/csvDirty.ts";
import { openColorIconPicker } from "../utils/colorIconPicker.ts";
import { getColorPalette, setColorPalette } from "../utils/storage.ts";
import { setNewRowAuditWithoutId, setUpdateAudit } from "../utils/auditFields.ts";
import {
  checkVersionBeforeUpdate,
  getVersionConflictMessage,
} from "../utils/csvVersionCheck.ts";

const HEX_COLOR_6 = /^#[0-9A-Fa-f]{6}$/;
const HEX_COLOR_3 = /^#[0-9A-Fa-f]{3}$/;

/** 白色かどうか（枠線表示用） */
function isWhiteHex(hex: string): boolean {
  const h = toSixDigitHex(hex.trim());
  return h.toUpperCase() === "#FFFFFF";
}

/** 3桁 (#fff) を 6桁 (#ffffff) に展開。input type="color" は #rrggbb のみ有効なため必須 */
function toSixDigitHex(hex: string): string {
  const h = hex.trim();
  if (HEX_COLOR_6.test(h)) return h;
  if (HEX_COLOR_3.test(h)) {
    const r = h[1] + h[1];
    const g = h[2] + h[2];
    const b = h[3] + h[3];
    return `#${r}${g}${b}`;
  }
  return hex;
}

function toValidHex(v: string | undefined, key: (typeof PALETTE_KEYS)[number]): string {
  const t = (v ?? "").trim();
  const normalized = t.startsWith("#") ? t : `#${t}`;
  if (HEX_COLOR_6.test(normalized) || HEX_COLOR_3.test(normalized)) {
    return toSixDigitHex(normalized);
  }
  return toSixDigitHex(DEFAULT_PALETTE[key]);
}

type PaletteRow = Record<string, string>;

let paletteList: PaletteRow[] = [];

const LABELS: Record<string, string> = {
  MENUBAR_BG: "メニューバー背景",
  MENUBAR_FG: "メニューバー文字色",
  HEADER_BG: "ヘッダー背景",
  HEADER_FG: "ヘッダー文字色",
  MAIN_BG: "メイン背景",
  MAIN_FG: "メイン文字色",
  VIEW_BG: "ビュー背景",
  VIEW_FG: "ビュー文字色",
  FOOTER_BG: "フッター背景",
  FOOTER_FG: "フッター文字色",
  BUTTON_BG: "ボタン背景",
  BUTTON_FG: "ボタン文字色",
  BASE_BG: "ベース背景",
  BASE_FG: "ベース文字色",
  ACCENT_BG: "強調背景",
  ACCENT_FG: "強調文字色",
};

async function fetchPaletteList(): Promise<PaletteRow[]> {
  const { header, rows } = await fetchCsv("/data/COLOR_PALETTE.csv");
  if (header.length === 0) return [];
  const list: PaletteRow[] = [];
  for (const cells of rows) {
    list.push(rowToObject(header, cells));
  }
  return list;
}

function getCurrentUserPalette(): PaletteRow | undefined {
  return paletteList.find((r) => r.USER_ID === currentUserId);
}

function getOrCreateCurrentPalette(): PaletteRow {
  let row = getCurrentUserPalette();
  if (row) return row;
  row = {
    USER_ID: currentUserId ?? "",
    SEQ_NO: "1",
    REGIST_DATETIME: "",
    REGIST_USER: "",
    UPDATE_DATETIME: "",
    UPDATE_USER: "",
    MENUBAR_BG: "#2c2c2e",
    MENUBAR_FG: "#ffffff",
    HEADER_BG: "#ffffff",
    HEADER_FG: "#1a1a1a",
    MAIN_BG: "#f0f2f5",
    MAIN_FG: "#1a1a1a",
    VIEW_BG: "#ffffff",
    VIEW_FG: "#1a1a1a",
    FOOTER_BG: "#ffffff",
    FOOTER_FG: "#666666",
    BUTTON_BG: "#646cff",
    BUTTON_FG: "#ffffff",
    BASE_BG: "#ffffff",
    BASE_FG: "#333333",
    ACCENT_BG: "#646cff",
    ACCENT_FG: "#ffffff",
  };
  setNewRowAuditWithoutId(row, currentUserId ?? "");
  paletteList.push(row);
  return row;
}

/** フォームの色をプレビュー用ラッパーに反映する。子要素は var(--color-*) で参照（継承）。色は常に6桁で設定する */
function applyPaletteToPreview(): void {
  const wrap = document.getElementById("design-preview-wrap");
  const container = document.getElementById("design-form-fields");
  if (!wrap || !container) return;
  PALETTE_KEYS.forEach((key) => {
    const colorEl = container.querySelector(`.design-palette-color[data-palette-key="${key}"]`) as HTMLInputElement;
    const value = toValidHex(colorEl?.value, key);
    wrap.style.setProperty(CSS_VAR_MAP[key], value);
  });
}

function renderDesignForm(): void {
  const container = document.getElementById("design-form-fields");
  if (!container) return;
  const palette = getOrCreateCurrentPalette();
  container.innerHTML = "";

  PALETTE_KEYS.forEach((key) => {
    const label = LABELS[key] ?? key;
    const value = toValidHex(palette[key], key);
    const row = document.createElement("div");
    row.className = "form-row design-palette-row";
    const id = `design-form-${key}`;
    row.innerHTML = `
      <label for="${id}">${label}</label>
      <div class="design-palette-input-row">
        <input type="color" id="${id}" value="${value}" class="design-palette-color design-palette-input-hidden" data-palette-key="${key}" aria-hidden="true" />
        <input type="text" class="design-palette-hex" value="${value}" maxlength="7" data-palette-key="${key}" aria-label="${label}（カラーコード）" />
        <div class="category-icon-wrap form-color-icon-preview design-palette-swatch${isWhiteHex(value) ? " design-palette-swatch--light" : ""}" data-palette-key="${key}" style="background-color:${value}" role="button" tabindex="0" aria-label="${label}を選択"></div>
      </div>
    `;
    container.appendChild(row);
  });

  function updateSwatch(key: string, hex: string): void {
    const swatch = container?.querySelector(`.design-palette-swatch[data-palette-key="${key}"]`) as HTMLElement | null;
    if (!swatch) return;
    swatch.style.backgroundColor = hex;
    swatch.classList.toggle("design-palette-swatch--light", isWhiteHex(hex));
  }

  container.querySelectorAll(".design-palette-swatch").forEach((el) => {
    const swatch = el as HTMLElement;
    const key = swatch.dataset.paletteKey as (typeof PALETTE_KEYS)[number] | undefined;
    if (!key) return;
    const openPicker = (): void => {
      const colorEl = container.querySelector(`.design-palette-color[data-palette-key="${key}"]`) as HTMLInputElement;
      const hexEl = container.querySelector(`.design-palette-hex[data-palette-key="${key}"]`) as HTMLInputElement;
      if (!colorEl || !hexEl) return;
      const currentColor = toValidHex(colorEl.value, key);
      openColorIconPicker(currentColor, "", (color) => {
        const hex = color.startsWith("#") ? color : `#${color}`;
        colorEl.value = hex;
        hexEl.value = hex;
        updateSwatch(key, hex);
        setColorPaletteDirty();
        applyPaletteToPreview();
      }, { showIconSection: false });
    };
    swatch.addEventListener("click", (e) => {
      e.preventDefault();
      openPicker();
    });
    swatch.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openPicker();
      }
    });
  });

  container.querySelectorAll(".design-palette-hex").forEach((input) => {
    input.addEventListener("input", function (this: HTMLInputElement) {
      setColorPaletteDirty();
      const key = this.dataset.paletteKey;
      let v = this.value.trim();
      if (!v.startsWith("#")) v = "#" + v;
      if (/^#[0-9A-Fa-f]{6}$/.test(v)) {
        const colorInput = container.querySelector(`.design-palette-color[data-palette-key="${key}"]`) as HTMLInputElement;
        if (colorInput) colorInput.value = v;
        const swatch = container?.querySelector(`.design-palette-swatch[data-palette-key="${key}"]`) as HTMLElement | null;
        if (swatch) {
          swatch.style.backgroundColor = v;
          swatch.classList.toggle("design-palette-swatch--light", isWhiteHex(v));
        }
        applyPaletteToPreview();
      }
    });
  });

  applyPaletteToPreview();
}

async function saveDesignForm(): Promise<void> {
  const palette = getOrCreateCurrentPalette();
  const container = document.getElementById("design-form-fields");
  if (!container) return;

  PALETTE_KEYS.forEach((key) => {
    const colorEl = container.querySelector(`.design-palette-color[data-palette-key="${key}"]`) as HTMLInputElement;
    if (colorEl) palette[key] = colorEl.value;
  });

  const check = await checkVersionBeforeUpdate(
    "/data/COLOR_PALETTE.csv",
    currentUserId ?? "",
    palette.VERSION ?? "0",
    true
  );
  if (!check.allowed) {
    alert(getVersionConflictMessage(check));
    await loadAndRenderDesign();
    return;
  }
  setUpdateAudit(palette, currentUserId ?? "");

  // localStorage に保存
  if (currentUserId) {
    const toStore: Record<string, string> = {};
    PALETTE_KEYS.forEach((key) => {
      toStore[key] = toValidHex(palette[key], key);
    });
    setColorPalette(currentUserId, toStore);
  }

  const { saveCsvViaApi } = await import("../utils/dataApi");
  const csv = colorPaletteListToCsv(paletteList);
  await saveCsvViaApi("COLOR_PALETTE.csv", csv);
  clearColorPaletteDirty();

  // 画面に色を反映（Tauri でなくても編集内容を即時適用）。不正値はデフォルトにフォールバック
  const appEl = document.getElementById("app");
  if (appEl) {
    PALETTE_KEYS.forEach((key) => {
      const value = toValidHex(palette[key], key);
      appEl.style.setProperty(CSS_VAR_MAP[key], value);
    });
  }
}

/** 画面遷移時に呼ぶ。フォーム内容を paletteList に反映し COLOR_PALETTE.csv を保存する（Tauri 時）。保存完了後に clearColorPaletteDirty。 */
export function saveColorPaletteCsvOnNavigate(): Promise<void> {
  const palette = getOrCreateCurrentPalette();
  const container = document.getElementById("design-form-fields");
  if (container) {
    PALETTE_KEYS.forEach((key) => {
      const colorEl = container.querySelector(`.design-palette-color[data-palette-key="${key}"]`) as HTMLInputElement;
      if (colorEl) palette[key] = colorEl.value;
    });
  }
  setUpdateAudit(palette, currentUserId ?? "");
  const csv = colorPaletteListToCsv(paletteList);
  return import("../utils/dataApi").then(({ saveCsvViaApi }) =>
    saveCsvViaApi("COLOR_PALETTE.csv", csv).then(() => clearColorPaletteDirty())
  );
}

export async function loadAndRenderDesign(): Promise<void> {
  paletteList = await fetchPaletteList();
  const stored = currentUserId ? getColorPalette(currentUserId) : null;
  if (stored) {
    const row = getOrCreateCurrentPalette();
    PALETTE_KEYS.forEach((key) => {
      if (stored[key]) row[key] = toValidHex(stored[key], key);
    });
  }
  renderDesignForm();
}

async function resetDesignToDefault(): Promise<void> {
  const row = getOrCreateCurrentPalette();
  PALETTE_KEYS.forEach((key) => {
    row[key] = DEFAULT_PALETTE[key];
  });
  renderDesignForm();
  applyPaletteToPreview();
  const appEl = document.getElementById("app");
  if (appEl) {
    PALETTE_KEYS.forEach((key) => {
      appEl.style.setProperty(CSS_VAR_MAP[key], DEFAULT_PALETTE[key]);
    });
  }
  clearColorPaletteDirty();
  await saveDesignForm();
}

export function initDesignView(): void {
  registerViewHandler("design", loadAndRenderDesign);

  document.getElementById("design-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    await saveDesignForm();
  });

  document.getElementById("header-save-btn")?.addEventListener("click", async () => {
    if (currentView !== "design") return;
    await saveDesignForm();
  });

  document.getElementById("header-default-btn")?.addEventListener("click", async () => {
    if (currentView !== "design") return;
    await resetDesignToDefault();
  });
}
