/**
 * モーダル・オーバーレイの表示/非表示を共通で扱うユーティリティ。
 * 各画面のモーダル開閉で利用する。
 */

/**
 * 指定 ID のオーバーレイを表示する。
 * @param overlayId - オーバーレイ要素の id 属性
 * @returns なし
 */
export function openOverlay(overlayId: string): void {
  const overlay = document.getElementById(overlayId);
  if (overlay) {
    overlay.classList.add("is-visible");
    overlay.setAttribute("aria-hidden", "false");
  }
}

/**
 * 指定 ID のオーバーレイを閉じる。フォーカスがオーバーレイ内にあれば blur してから閉じる。
 * @param overlayId - オーバーレイ要素の id 属性
 * @returns なし
 */
export function closeOverlay(overlayId: string): void {
  const overlay = document.getElementById(overlayId);
  if (overlay) {
    if (overlay.contains(document.activeElement)) {
      (document.activeElement as HTMLElement)?.blur();
    }
    overlay.classList.remove("is-visible");
    overlay.setAttribute("aria-hidden", "true");
  }
}
