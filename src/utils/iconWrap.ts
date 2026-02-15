/**
 * 色・アイコン表示用のラッパー要素を生成する共通ユーティリティ。
 * マスタ一覧・収支履歴・収支記録などで共通利用する。
 */

import { ICON_DEFAULT_COLOR } from "../constants/colorPresets";

const DEFAULT_CLASS = "category-icon-wrap";

export interface CreateIconWrapOptions {
  /** 要素のタグ名。省略時は "div" */
  tag?: "div" | "span";
  /** 付与するクラス名。省略時は "category-icon-wrap" */
  className?: string;
}

/**
 * 色・アイコンを表示するラッパー要素を生成する。
 * @param color - 背景色（#rrggbb）。空の場合は ICON_DEFAULT_COLOR
 * @param iconPath - アイコン画像パス。空の場合は色のみ表示
 * @param options - tag / className
 * @returns 生成した要素
 */
export function createIconWrap(
  color: string,
  iconPath: string | undefined,
  options: CreateIconWrapOptions = {}
): HTMLDivElement | HTMLSpanElement {
  const { tag = "div", className = DEFAULT_CLASS } = options;
  const wrap = document.createElement(tag);
  wrap.className = className;
  wrap.style.backgroundColor = (color?.trim() || ICON_DEFAULT_COLOR) as string;
  if (iconPath?.trim()) {
    wrap.classList.add("category-icon-wrap--img");
    wrap.style.webkitMaskImage = `url(${iconPath.trim()})`;
    wrap.style.maskImage = `url(${iconPath.trim()})`;
    wrap.setAttribute("aria-hidden", "true");
  }
  return wrap as HTMLDivElement | HTMLSpanElement;
}

/**
 * 既存の要素に色・アイコン表示を反映する（フォームのプレビュー欄更新用）。
 * @param wrap - プレビュー用の要素
 * @param color - 背景色。空の場合は ICON_DEFAULT_COLOR
 * @param iconPath - アイコン画像パス。空の場合は色のみ
 * @returns なし
 */
export function applyColorIconToElement(
  wrap: HTMLElement,
  color: string,
  iconPath: string | undefined
): void {
  const bg = (color?.trim() || ICON_DEFAULT_COLOR) as string;
  wrap.style.backgroundColor = bg;
  wrap.classList.toggle("category-icon-wrap--img", !!iconPath?.trim());
  wrap.style.webkitMaskImage = iconPath?.trim() ? `url(${iconPath.trim()})` : "";
  wrap.style.maskImage = iconPath?.trim() ? `url(${iconPath.trim()})` : "";
}
