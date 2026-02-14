/**
 * マスタ一覧テーブルで共通利用するセル・ボタン部品
 */

/** 削除ボタン付きの td を生成（削除モード時のみ表示） */
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

/** ドラッグハンドル用の td（並び替えアイコンのみ）。mousedown は呼び出し元で登録すること */
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

/** contentEditable な名前セルに共通で付ける keydown/input の挙動（Enter 無効・改行をスペースに） */
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
