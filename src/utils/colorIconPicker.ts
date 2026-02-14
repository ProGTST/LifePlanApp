import { COLOR_PRESETS, ICON_DEFAULT_COLOR, CUSTOM_ICON_BASE_PATH } from "../constants/colorPresets.ts";

let resolveApply: ((color: string, iconPath: string) => void) | null = null;
let customColorButtonsBound = false;

/** public/icon/custom/icons.json からアイコン一覧を取得（毎回取得して全アイコンを表示） */
export async function fetchCustomIconList(): Promise<string[]> {
  try {
    const res = await fetch(`${CUSTOM_ICON_BASE_PATH}/icons.json?t=${Date.now()}`);
    if (!res.ok) return [];
    const json = (await res.json()) as string[];
    return Array.isArray(json) ? json : [];
  } catch {
    return [];
  }
}

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
 * 色・アイコンピッカーモーダルを開く。
 * 適用時に onApply(selectedColor, selectedIconPath) が呼ばれる。
 * options.showIconSection が false のときはアイコン欄を非表示にする（色のみ選択）。
 */
export function openColorIconPicker(
  initialColor: string,
  initialIconPath: string,
  onApply: (color: string, iconPath: string) => void,
  options: ColorIconPickerOptions = {}
): void {
  const { overlay, swatchesEl, customInput, customBtn, defaultBtn, iconSection, iconsEl, applyBtn, cancelBtn } = getPickerEls();
  if (!overlay || !swatchesEl || !iconsEl || !applyBtn || !cancelBtn) return;

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
    overlay.style.setProperty("--picker-selected-color", hex);
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

  // アイコン一覧（非同期で取得）
  iconsEl.innerHTML = "";
  fetchCustomIconList().then((list) => {
    list.forEach((filename) => {
      const path = `${CUSTOM_ICON_BASE_PATH}/${filename}`;
      const pathNorm = path.replace(/\/+$/, "").trim();
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "picker-icon-btn";
      btn.dataset.iconPath = path;
      if (pathNorm === normalizedSelectedIcon) btn.classList.add("is-selected");
      const iconDiv = document.createElement("div");
      iconDiv.className = "picker-icon-img";
      iconDiv.style.webkitMaskImage = `url(${path})`;
      iconDiv.style.maskImage = `url(${path})`;
      btn.appendChild(iconDiv);
      btn.addEventListener("click", () => {
        if (btn.classList.contains("is-selected")) {
          btn.classList.remove("is-selected");
          selectedIconPath = "";
        } else {
          iconsEl.querySelectorAll(".picker-icon-btn").forEach((b) => b.classList.remove("is-selected"));
          btn.classList.add("is-selected");
          selectedIconPath = path;
        }
      });
      iconsEl.appendChild(btn);
    });
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
