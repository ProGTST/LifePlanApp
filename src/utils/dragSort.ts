/**
 * マスタ一覧のドラッグ＆ドロップ並び替えで共通利用するユーティリティ
 */

/**
 * SORT_ORDER 文字列を数値として比較する。未定義・空・NaN は末尾扱い。
 * @param a - 比較対象の文字列
 * @param b - 比較対象の文字列
 * @returns ソート用の数値（a < b で負、a > b で正）
 */
export function sortOrderNum(a: string | undefined, b: string | undefined): number {
  const na = a === undefined || a === null || a === "" ? NaN : Number(a);
  const nb = b === undefined || b === null || b === "" ? NaN : Number(b);
  const va = Number.isNaN(na) ? 999999 : na;
  const vb = Number.isNaN(nb) ? 999999 : nb;
  return va - vb;
}

/**
 * 画面上のスロット（0=先頭の前, 1=行0と1の間, ..., n=末尾の後）を、ドラッグ元を除いた配列での挿入インデックスに変換する。
 * @param rawSlot - ドロップ位置のスロット番号
 * @param fromIndex - ドラッグ元の行インデックス
 * @param originalLength - 元の行数
 * @returns 挿入先のインデックス（0 ～ originalLength-1）
 */
export function slotToInsertAt(
  rawSlot: number,
  fromIndex: number,
  originalLength: number
): number {
  if (originalLength <= 0) return 0;
  if (rawSlot <= 0) return 0;
  if (rawSlot >= originalLength) return originalLength - 1;
  return fromIndex <= rawSlot - 1 ? rawSlot - 1 : rawSlot;
}

/**
 * ドラッグ開始時に取得した行の rect 一覧から、指定 Y 座標がどのスロットに該当するか算出する。
 * @param clientY - クライアント座標 Y
 * @param rects - 各行の top/bottom の配列
 * @returns スロット番号（0=先頭の前 ～ rects.length=末尾の後）
 */
export function getSlotFromRects(
  clientY: number,
  rects: { top: number; bottom: number }[]
): number {
  if (rects.length === 0) return 0;
  if (clientY < rects[0].top) return 0;
  for (let i = 0; i < rects.length - 1; i++) {
    if (clientY >= rects[i].bottom && clientY < rects[i + 1].top) return i + 1;
  }
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    if (clientY >= r.top && clientY < r.bottom) {
      const mid = r.top + (r.bottom - r.top) / 2;
      return clientY < mid ? i : i + 1;
    }
  }
  return rects.length;
}

/**
 * ドロップ位置を示すインジケーター行（1行の tr）を生成する。
 * @param colCount - 結合する列数（td の colSpan）
 * @returns インジケーター用の tr 要素
 */
export function createDropIndicatorRow(colCount: number): HTMLTableRowElement {
  const tr = document.createElement("tr");
  tr.className = "drop-indicator-row";
  const td = document.createElement("td");
  td.colSpan = colCount;
  const line = document.createElement("div");
  line.className = "drop-indicator-line";
  td.appendChild(line);
  tr.appendChild(td);
  return tr;
}
