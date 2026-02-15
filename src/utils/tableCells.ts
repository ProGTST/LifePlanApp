/**
 * マスタ一覧テーブルで共通利用するセル・ボタン部品
 */

/**
 * 削除ボタン付きの td を生成する。visible が true のときのみボタンを表示する。
 * @param options - visible: 削除ボタンを表示するか。onDelete: クリック時に呼ぶ関数
 * @returns 削除ボタンを含む td 要素
 */
export function createDeleteButtonCell(options: {
  visible: boolean;
  onDelete: () => void;
}): HTMLTableCellElement {
  const td = document.createElement("td");
  td.className = "account-table-delete-col";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "account-row-delete-btn";
  btn.setAttribute("aria-label", "削除");
  const img = document.createElement("img");
  img.src = "/icon/circle-minus-solid-full.svg";
  img.alt = "";
  img.width = 20;
  img.height = 20;
  btn.appendChild(img);
  if (options.visible) btn.classList.add("is-visible");
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    options.onDelete();
  });
  td.appendChild(btn);
  return td;
}

/**
 * ドラッグハンドル用の td（並び替えアイコンのみ）を生成する。mousedown は呼び出し元で登録すること。
 * @returns ドラッグハンドル用の td 要素
 */
export function createDragHandleCell(): HTMLTableCellElement {
  const td = document.createElement("td");
  td.className = "data-table-drag-col";
  td.setAttribute("aria-label", "ドラッグで並び替え");
  const img = document.createElement("img");
  img.src = "/icon/sort-solid-full.svg";
  img.alt = "";
  img.width = 20;
  img.height = 20;
  img.setAttribute("aria-hidden", "true");
  td.appendChild(img);
  return td;
}

/**
 * contentEditable な名前セルに共通の挙動を付与する（Enter 無効・改行をスペースに変換・blur で onBlur 呼び出し）。
 * @param cell - 対象のセル要素
 * @param onBlur - フォーカスが外れたときに呼ぶ関数
 * @returns なし
 */
export function attachNameCellBehavior(cell: HTMLElement, onBlur: () => void): void {
  cell.addEventListener("keydown", (e) => {
    if (e.key === "Enter") e.preventDefault();
  });
  cell.addEventListener("input", () => {
    const text = cell.textContent ?? "";
    if (text.includes("\n")) cell.textContent = text.replace(/\r?\n/g, " ");
  });
  cell.addEventListener("blur", onBlur);
}
