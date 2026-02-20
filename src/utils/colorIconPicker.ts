import { COLOR_PRESETS, ICON_DEFAULT_COLOR, CUSTOM_ICON_BASE_PATH } from "../constants/colorPresets.ts";

/** アイコンフォルダ名 → ピッカー用サブタイトル表示名 */
const CUSTOM_ICON_FOLDER_SUBTITLES: Record<string, string> = {
  "01-money": "ウォレット",
  "02-person": "人",
  "03-life": "生活",
  "04-building": "建物",
  "04-buildings": "建物",
  "05-documents": "資料",
  "06-work": "仕事",
  "07-vehicle": "乗り物",
  "11-hobby": "趣味",
  "12-sports": "スポーツ",
  "13-foods": "食べ物",
  "14-creatures": "生き物",
  "15-weather": "天気",
  "16-events": "イベント",
  "16-evets": "イベント",
  "99-others": "その他",
};

let resolveApply: ((color: string, iconPath: string) => void) | null = null;
let customColorButtonsBound = false;

/**
 * public/icon/custom/icons.json からフォルダ別アイコン一覧を取得する。
 * @returns Promise。キー=フォルダ名、値=ファイル名の配列のオブジェクト。失敗時は {}
 */
export async function fetchCustomIconList(): Promise<Record<string, string[]>> {
  try {
    const res = await fetch(`${CUSTOM_ICON_BASE_PATH}/icons.json?t=${Date.now()}`);
    if (!res.ok) return {};
    const json = (await res.json()) as Record<string, string[]>;
    if (json && typeof json === "object" && !Array.isArray(json)) return json;
    return {};
  } catch {
    return {};
  }
}

/**
 * 色・アイコンピッカーの DOM 要素をまとめて取得する。
 * @returns オーバーレイ・スウォッチ・カスタム入力・各種ボタン等の要素（存在しない場合は null）
 */
function getPickerEls() {
  const overlay = document.getElementById("color-icon-picker-overlay");
  const swatchesEl = document.getElementById("color-icon-picker-swatches");
  const customInput = document.getElementById("color-icon-picker-custom") as HTMLInputElement | null;
  const customBtn = document.getElementById("color-icon-picker-custom-btn");
  const iconSection = document.getElementById("color-icon-picker-icon-section");
  const iconsEl = document.getElementById("color-icon-picker-icons");
  const defaultBtn = document.getElementById("color-icon-picker-default-btn");
  const applyBtn = document.getElementById("color-icon-picker-apply");
  const cancelBtn = document.getElementById("color-icon-picker-cancel");
  return { overlay, swatchesEl, customInput, customBtn, defaultBtn, iconSection, iconsEl, applyBtn, cancelBtn };
}

export interface ColorIconPickerOptions {
  /** アイコン選択欄を表示するか。false のときは色のみ（例: プロフィールの背景色選択） */
  showIconSection?: boolean;
}

/**
 * 色・アイコンピッカーモーダルを開く。適用ボタンで onApply(選択色, 選択アイコンパス) が呼ばれる。
 * @param initialColor - 初期表示する色（例: #rrggbb）
 * @param initialIconPath - 初期表示するアイコンパス
 * @param onApply - 適用時に呼ぶコールバック (color, iconPath)
 * @param options - showIconSection が false のときはアイコン欄を非表示（色のみ選択）
 * @returns なし
 */
export function openColorIconPicker(
  initialColor: string,
  initialIconPath: string,
  onApply: (color: string, iconPath: string) => void,
  options: ColorIconPickerOptions = {}
): void {
  const { overlay, swatchesEl, customInput, customBtn, defaultBtn, iconSection, iconsEl, applyBtn, cancelBtn } = getPickerEls();
  if (!overlay || !swatchesEl || !iconsEl || !applyBtn || !cancelBtn) return;
  const overlayEl = overlay;

  const showIconSection = options.showIconSection !== false;
  if (iconSection) {
    iconSection.style.display = showIconSection ? "" : "none";
  }

  if (!customColorButtonsBound && customBtn) {
    customColorButtonsBound = true;
    const trigger = () => (document.getElementById("color-icon-picker-custom") as HTMLInputElement | null)?.click();
    customBtn.addEventListener("click", trigger);
  }

  const color = (initialColor?.trim() || ICON_DEFAULT_COLOR).toUpperCase();
  let selectedColor = color;
  let selectedIconPath = initialIconPath?.trim() || "";

  function setPickerSelectedColor(hex: string) {
    overlayEl.style.setProperty("--picker-selected-color", hex);
  }
  setPickerSelectedColor(selectedColor);

  // プリセット色スウォッチ
  swatchesEl.innerHTML = "";
  COLOR_PRESETS.forEach((hex) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "picker-swatch";
    btn.style.backgroundColor = hex;
    btn.dataset.color = hex;
    btn.setAttribute("aria-label", hex);
    if (hex.toUpperCase() === color) btn.classList.add("is-selected");
    btn.addEventListener("click", () => {
      swatchesEl.querySelectorAll(".picker-swatch").forEach((b) => b.classList.remove("is-selected"));
      btn.classList.add("is-selected");
      selectedColor = hex;
      if (customInput) customInput.value = hex;
      setPickerSelectedColor(hex);
    });
    swatchesEl.appendChild(btn);
  });

  if (customInput) {
    customInput.value = color.length === 7 && color.startsWith("#") ? color : ICON_DEFAULT_COLOR;
    customInput.addEventListener("input", () => {
      selectedColor = customInput.value;
      swatchesEl.querySelectorAll(".picker-swatch").forEach((b) => b.classList.remove("is-selected"));
      setPickerSelectedColor(selectedColor);
    });
  }

  // 選択中アイコンパスの正規化（比較用）
  const normalizedSelectedIcon = selectedIconPath.replace(/\/+$/, "").trim();

  // アイコン一覧（フォルダごとにサブタイトル付きで表示）
  iconsEl.innerHTML = "";
  fetchCustomIconList().then((byFolder) => {
    const folderNames = Object.keys(byFolder).sort((a, b) => a.localeCompare(b, "ja"));
    for (const folderName of folderNames) {
      const subtitle = document.createElement("div");
      subtitle.className = "picker-icon-subtitle";
      subtitle.textContent = CUSTOM_ICON_FOLDER_SUBTITLES[folderName] ?? folderName;
      iconsEl.appendChild(subtitle);
      const filenames = byFolder[folderName] || [];
      for (const filename of filenames) {
        const iconPath = `${CUSTOM_ICON_BASE_PATH}/${folderName}/${filename}`;
        const pathNorm = iconPath.replace(/\/+$/, "").trim();
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "picker-icon-btn";
        btn.dataset.iconPath = iconPath;
        if (pathNorm === normalizedSelectedIcon) btn.classList.add("is-selected");
        const iconDiv = document.createElement("div");
        iconDiv.className = "picker-icon-img";
        iconDiv.style.webkitMaskImage = `url(${iconPath})`;
        iconDiv.style.maskImage = `url(${iconPath})`;
        btn.appendChild(iconDiv);
        btn.addEventListener("click", () => {
          if (btn.classList.contains("is-selected")) {
            btn.classList.remove("is-selected");
            selectedIconPath = "";
          } else {
            iconsEl.querySelectorAll(".picker-icon-btn").forEach((b) => b.classList.remove("is-selected"));
            btn.classList.add("is-selected");
            selectedIconPath = iconPath;
          }
        });
        iconsEl.appendChild(btn);
      }
    }
  });

  function close() {
    if (overlay?.contains(document.activeElement)) (document.activeElement as HTMLElement)?.blur();
    overlay?.classList.remove("is-visible");
    overlay?.setAttribute("aria-hidden", "true");
    resolveApply = null;
  }

  resolveApply = (col: string, path: string) => {
    onApply(col, path);
    close();
  };

  applyBtn.replaceWith(applyBtn.cloneNode(true));
  if (defaultBtn) defaultBtn.replaceWith(defaultBtn.cloneNode(true));
  cancelBtn.replaceWith(cancelBtn.cloneNode(true));
  document.getElementById("color-icon-picker-apply")?.addEventListener("click", () => {
    const col = selectedColor || customInput?.value || ICON_DEFAULT_COLOR;
    resolveApply?.(col, selectedIconPath);
  });
  document.getElementById("color-icon-picker-default-btn")?.addEventListener("click", () => {
    const hex = ICON_DEFAULT_COLOR.toUpperCase();
    selectedColor = hex;
    selectedIconPath = "";
    if (customInput) customInput.value = hex;
    setPickerSelectedColor(hex);
    swatchesEl.querySelectorAll(".picker-swatch").forEach((b) => {
      b.classList.remove("is-selected");
      if ((b as HTMLElement).dataset.color?.toUpperCase() === hex) b.classList.add("is-selected");
    });
    iconsEl.querySelectorAll(".picker-icon-btn").forEach((b) => b.classList.remove("is-selected"));
  });
  document.getElementById("color-icon-picker-cancel")?.addEventListener("click", close);

  overlay?.classList.add("is-visible");
  overlay?.setAttribute("aria-hidden", "false");

  function onOverlayClick(e: Event) {
    if ((e.target as HTMLElement).id === "color-icon-picker-overlay") close();
    overlay?.removeEventListener("click", onOverlayClick);
  }
  overlay?.addEventListener("click", onOverlayClick);
}
