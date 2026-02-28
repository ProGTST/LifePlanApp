import type { TagRow } from "../types.ts";
import { EMPTY_USER_ID } from "../constants";
import {
  currentUserId,
  currentView,
  tagListFull,
  tagList,
  tagDeleteMode,
  setTagListFull,
  setTagList,
  setTagListLoaded,
  toggleTagDeleteMode,
  setLastCsvVersion,
} from "../state";
import { fetchCsv, rowToObject } from "../utils/csv";
import {
  sortOrderNum,
  slotToInsertAt,
  getSlotFromRects,
  createDropIndicatorRow,
} from "../utils/dragSort.ts";
import {
  createDeleteButtonCell,
  createDragHandleCell,
  attachNameCellBehavior,
} from "../utils/tableCells.ts";
import { setTagDirty } from "../utils/csvDirty.ts";
import { saveTagCsvOnly } from "../utils/saveMasterCsv.ts";
import { VersionConflictError } from "../utils/dataApi.ts";
import { setNewRowAudit, setUpdateAudit } from "../utils/auditFields.ts";
import {
  checkVersionBeforeUpdate,
  getVersionConflictMessage,
} from "../utils/csvVersionCheck.ts";
import { setDisplayedKeys } from "../utils/csvWatch.ts";
import { registerViewHandler, registerRefreshHandler } from "../app/screen";
import { openColorIconPicker } from "../utils/colorIconPicker.ts";
import { createIconWrap, applyColorIconToElement } from "../utils/iconWrap.ts";
import { openOverlay, closeOverlay } from "../utils/overlay.ts";
import { ICON_DEFAULT_COLOR } from "../constants/colorPresets.ts";

/** 全ユーザー分を含むタグの最大 ID（新規登録時の ID 採番用） */
let tagGlobalMaxId = 0;

/**
 * TAG.csv を取得し、タグ行の配列に変換して返す。
 * @param noCache - true のときキャッシュを使わず再取得する（最新化ボタン用）
 * @returns Promise。タグ行の配列
 */
async function fetchTagList(_noCache = false): Promise<TagRow[]> {
  const { header, rows, version } = await fetchCsv("/data/TAG.csv");
  setLastCsvVersion("TAG.csv", version);
  if (header.length === 0) return [];
  const me = (currentUserId ?? "").trim();
  const list: TagRow[] = [];
  let globalMax = 0;
  for (const cells of rows) {
    const row = rowToObject(header, cells) as unknown as TagRow;
    const n = parseInt(row.ID ?? "0", 10);
    if (!Number.isNaN(n) && n > globalMax) globalMax = n;
    const rowUserId = (row.USER_ID ?? "").trim() || EMPTY_USER_ID;
    if (rowUserId !== me) continue;
    if (row.SORT_ORDER === undefined || row.SORT_ORDER === "") row.SORT_ORDER = String(list.length);
    if (row.COLOR === undefined) row.COLOR = "";
    if (row.ICON_PATH === undefined) row.ICON_PATH = "";
    list.push(row);
  }
  tagGlobalMaxId = globalMax;
  return list;
}


/**
 * タグの変更を dirty にし、TAG.csv の保存を非同期で実行する。
 * @returns なし
 */
function persistTag(): void {
  setTagDirty();
  saveTagCsvOnly().catch((e) => {
    if (e instanceof VersionConflictError) {
      alert(e.message);
      loadAndRenderTagList(true);
    } else {
      console.error("saveTagCsvOnly", e);
    }
  });
}

/**
 * 一覧セルで編集したタグ名を保存する。空の場合は削除。バージョンチェック後に永続化。
 * @param tagId - 対象タグ ID
 * @param newName - 新しいタグ名
 * @returns Promise
 */
async function saveTagNameFromCell(tagId: string, newName: string): Promise<void> {
  const trimmed = newName.trim();
  if (!trimmed) {
    await deleteTagRow(tagId);
    return;
  }
  const row = tagListFull.find((r) => r.ID === tagId);
  if (!row) return;
  const check = await checkVersionBeforeUpdate("/data/TAG.csv", tagId, row.VERSION ?? "0");
  if (!check.allowed) {
    alert(getVersionConflictMessage(check));
    await loadAndRenderTagList();
    return;
  }
  row.TAG_NAME = trimmed;
  setUpdateAudit(row as unknown as Record<string, string>, currentUserId ?? "");
  persistTag();
}

/**
 * 画面上のスロットを元に表示順を並び替え、SORT_ORDER と tagList を更新して永続化・再描画する。
 * @param fromIndex - ドラッグ元の行インデックス
 * @param toSlot - ドロップ先スロット（0=先頭の前 ～ n=末尾の後）
 * @returns Promise
 */
async function moveTagOrder(fromIndex: number, toSlot: number): Promise<void> {
  const sorted = tagList.slice();
  const originalLength = sorted.length;
  if (fromIndex < 0 || toSlot < 0 || fromIndex >= originalLength || toSlot > originalLength) return;
  const [removed] = sorted.splice(fromIndex, 1);
  const insertAt = slotToInsertAt(toSlot, fromIndex, originalLength);
  sorted.splice(insertAt, 0, removed);
  // 全行のバージョンチェック（競合時はアラートして再読み込み）
  for (const r of sorted) {
    const check = await checkVersionBeforeUpdate("/data/TAG.csv", r.ID, r.VERSION ?? "0");
    if (!check.allowed) {
      alert(getVersionConflictMessage(check));
      await loadAndRenderTagList();
      return;
    }
  }
  sorted.forEach((r, i) => {
    r.SORT_ORDER = String(i);
    setUpdateAudit(r as unknown as Record<string, string>, currentUserId ?? "");
  });
  setTagList(sorted);
  setDisplayedKeys("tag", sorted.map((t) => t.ID));
  persistTag();
  renderTagTable();
}

const TAG_TABLE_COL_COUNT = 4;

/**
 * タグ一覧テーブル（tag-tbody）を描画する。ドラッグ並び替え・名前編集・色アイコン・削除に対応。
 * @returns なし
 */
function renderTagTable(): void {
  const tbody = document.getElementById("tag-tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  tagList.forEach((row, index) => {
    const tr = document.createElement("tr");
    tr.setAttribute("data-tag-id", row.ID);
    tr.setAttribute("aria-label", `行 ${index + 1} ドラッグで並び替え`);
    const tdDrag = createDragHandleCell();
    const tdIcon = document.createElement("td");
    tdIcon.className = "data-table-icon-col";
    const iconWrap = createIconWrap(row.COLOR ?? "", row.ICON_PATH ?? "");
    // アイコンクリックで色・アイコンピッカーを開き、変更後にバージョンチェック・永続化
    iconWrap.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openColorIconPicker(row.COLOR ?? "", row.ICON_PATH ?? "", async (color, iconPath) => {
        const check = await checkVersionBeforeUpdate(
          "/data/TAG.csv",
          row.ID,
          row.VERSION ?? "0"
        );
        if (!check.allowed) {
          alert(getVersionConflictMessage(check));
          await loadAndRenderTagList();
          return;
        }
        row.COLOR = color;
        row.ICON_PATH = iconPath;
        setUpdateAudit(row as unknown as Record<string, string>, currentUserId ?? "");
        persistTag();
        renderTagTable();
      });
    });
    tdIcon.appendChild(iconWrap);
    const tdName = document.createElement("td");
    tdName.contentEditable = "true";
    tdName.textContent = row.TAG_NAME;
    attachNameCellBehavior(tdName, () => {
      saveTagNameFromCell(row.ID, tdName.textContent ?? "").catch((e) => console.error(e));
    });
    const tdDel = createDeleteButtonCell({
      visible: tagDeleteMode,
      onDelete: () => deleteTagRow(row.ID).catch((e) => console.error(e)),
    });
    tdDrag.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const fromIndex = index;
      const dataRows = tbody.querySelectorAll<HTMLTableRowElement>("tr[data-tag-id]");
      const rects = Array.from(dataRows).map((row) => {
        const r = row.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom };
      });
      tr.classList.add("drag-source");
      const indicator = createDropIndicatorRow(TAG_TABLE_COL_COUNT);
      let currentSlot = fromIndex;
      tbody.insertBefore(indicator, dataRows[currentSlot] ?? null);
      const onMouseMove = (e: MouseEvent): void => {
        const slot = getSlotFromRects(e.clientY, rects);
        if (slot === currentSlot) return;
        currentSlot = slot;
        const rows = tbody.querySelectorAll<HTMLTableRowElement>("tr[data-tag-id]");
        tbody.insertBefore(indicator, rows[currentSlot] ?? null);
      };
      const onMouseUp = (): void => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        tr.classList.remove("drag-source");
        indicator.remove();
        const insertAt = slotToInsertAt(currentSlot, fromIndex, rects.length);
        const noMove = insertAt === fromIndex;
        if (!noMove) moveTagOrder(fromIndex, currentSlot).catch((e) => console.error(e));
      };
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    });
    tr.appendChild(tdDrag);
    tr.appendChild(tdIcon);
    tr.appendChild(tdName);
    tr.appendChild(tdDel);
    tbody.appendChild(tr);
  });
}

/**
 * 指定タグを一覧と state から削除し、TAG.csv を永続化する。
 * @param tagId - 削除するタグ ID
 * @returns Promise
 */
async function deleteTagRow(tagId: string): Promise<void> {
  const row = tagListFull.find((r) => r.ID === tagId);
  if (!row) return;
  const check = await checkVersionBeforeUpdate("/data/TAG.csv", tagId, row.VERSION ?? "0");
  if (!check.allowed) {
    alert(getVersionConflictMessage(check));
    await loadAndRenderTagList();
    return;
  }
  const idx = tagListFull.findIndex((r) => r.ID === tagId);
  if (idx !== -1) tagListFull.splice(idx, 1);
  const sorted = tagListFull.slice().sort((a, b) => sortOrderNum(a.SORT_ORDER, b.SORT_ORDER));
  setTagList(sorted);
  setDisplayedKeys("tag", sorted.map((t) => t.ID));
  persistTag();
  renderTagTable();
}

/**
 * タグ一覧を取得し、タグテーブルを描画する。表示キーを setDisplayedKeys に登録する。
 * @param forceReloadFromCsv - true のときキャッシュを使わず CSV を再取得する（最新化ボタン用）
 * @returns Promise
 */
export async function loadAndRenderTagList(forceReloadFromCsv = false): Promise<void> {
  const list = await fetchTagList(forceReloadFromCsv);
  setTagListFull(list);
  setTagListLoaded(true);
  const sorted = tagListFull.slice().sort((a, b) => sortOrderNum(a.SORT_ORDER, b.SORT_ORDER));
  setTagList(sorted);
  setDisplayedKeys("tag", sorted.map((t) => t.ID));
  document.getElementById("header-delete-btn")?.classList.toggle("is-active", tagDeleteMode);
  renderTagTable();
}

/**
 * タグ追加モーダルを開く。フォームを初期化し、オーバーレイを表示する。
 * @returns なし
 */
function openTagModal(): void {
  const formName = document.getElementById("tag-form-name") as HTMLInputElement;
  const formColor = document.getElementById("tag-form-color") as HTMLInputElement;
  const formIconPath = document.getElementById("tag-form-icon-path") as HTMLInputElement;
  if (formName) formName.value = "";
  if (formColor) formColor.value = ICON_DEFAULT_COLOR;
  if (formIconPath) formIconPath.value = "";
  updateTagFormColorIconPreview();
  openOverlay("tag-modal-overlay");
}

/**
 * タグフォームの色・アイコンフィールドの値をプレビュー要素に反映する。
 * @returns なし
 */
function updateTagFormColorIconPreview(): void {
  const wrap = document.getElementById("tag-form-color-icon-preview");
  const color = (document.getElementById("tag-form-color") as HTMLInputElement)?.value || ICON_DEFAULT_COLOR;
  const path = (document.getElementById("tag-form-icon-path") as HTMLInputElement)?.value || "";
  if (wrap) applyColorIconToElement(wrap, color, path);
}

/**
 * タグ追加モーダルを閉じる。
 * @returns なし
 */
function closeTagModal(): void {
  closeOverlay("tag-modal-overlay");
}

/**
 * タグモーダルのフォーム内容を検証し、新規タグを追加して永続化する。完了後にモーダルを閉じ一覧を再描画する。
 * @returns なし
 */
function saveTagFormFromModal(): void {
  const formName = document.getElementById("tag-form-name") as HTMLInputElement;
  if (!formName) return;
  const name = formName.value.trim();
  if (!name) {
    formName.focus();
    return;
  }
  const userId = currentUserId ?? "";
  const maxId = Math.max(
    tagGlobalMaxId,
    tagListFull.reduce((m, r) => Math.max(m, parseInt(r.ID, 10) || 0), 0)
  );
  const newId = String(maxId + 1);
  tagGlobalMaxId = maxId + 1;
  const maxOrder = tagListFull.reduce(
    (m, r) => Math.max(m, Number(r.SORT_ORDER ?? 0) || 0),
    -1
  );
  const formColor = (document.getElementById("tag-form-color") as HTMLInputElement)?.value?.trim() || "";
  const formIconPath = (document.getElementById("tag-form-icon-path") as HTMLInputElement)?.value?.trim() || "";
  const newRow: TagRow = {
    ID: newId,
    VERSION: "0",
    REGIST_DATETIME: "",
    REGIST_USER: "",
    UPDATE_DATETIME: "",
    UPDATE_USER: "",
    USER_ID: userId,
    TAG_NAME: name,
    COLOR: formColor || "",
    ICON_PATH: formIconPath || "",
    SORT_ORDER: String(maxOrder + 1),
  };
  setNewRowAudit(newRow as unknown as Record<string, string>, userId, newId);
  tagListFull.push(newRow);
  const sorted = tagListFull.slice().sort((a, b) => sortOrderNum(a.SORT_ORDER, b.SORT_ORDER));
  setTagList(sorted);
  setDisplayedKeys("tag", sorted.map((t) => t.ID));
  persistTag();
  closeTagModal();
  renderTagTable();
}

/**
 * タグ画面の削除モードをトグルし、削除ボタンの表示とヘッダーボタンの状態を更新する。
 * @returns なし
 */
function handleToggleDeleteMode(): void {
  toggleTagDeleteMode();
  document.getElementById("header-delete-btn")?.classList.toggle("is-active", tagDeleteMode);
  renderTagTable();
}

/**
 * タグ画面の初期化を行う。「tag」ビュー表示ハンドラとモーダル・削除モードのイベントを登録する。
 * @returns なし
 */
export function initTagView(): void {
  registerViewHandler("tag", loadAndRenderTagList);
  registerRefreshHandler("tag", () => loadAndRenderTagList(true));

  document.getElementById("header-add-btn")?.addEventListener("click", () => {
    if (currentView === "tag") openTagModal();
  });
  document.getElementById("header-delete-btn")?.addEventListener("click", () => {
    if (currentView === "tag") handleToggleDeleteMode();
  });
  document.getElementById("tag-form-cancel")?.addEventListener("click", closeTagModal);
  document.getElementById("tag-form-color-icon-btn")?.addEventListener("click", () => {
    const formColor = (document.getElementById("tag-form-color") as HTMLInputElement)?.value ?? ICON_DEFAULT_COLOR;
    const formIconPath = (document.getElementById("tag-form-icon-path") as HTMLInputElement)?.value ?? "";
    openColorIconPicker(formColor, formIconPath, (color, iconPath) => {
      const colorEl = document.getElementById("tag-form-color") as HTMLInputElement;
      const pathEl = document.getElementById("tag-form-icon-path") as HTMLInputElement;
      if (colorEl) colorEl.value = color;
      if (pathEl) pathEl.value = iconPath;
      updateTagFormColorIconPreview();
    });
  });
  document.getElementById("tag-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    saveTagFormFromModal();
  });
  document.getElementById("tag-modal-overlay")?.addEventListener("click", (e) => {
    if (e.target instanceof HTMLElement && e.target.id === "tag-modal-overlay")
      closeTagModal();
  });
}
