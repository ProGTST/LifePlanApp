import type { TagRow } from "../types.ts";
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
import { registerViewHandler } from "../app/screen";
import { openColorIconPicker } from "../utils/colorIconPicker.ts";
import { ICON_DEFAULT_COLOR } from "../constants/colorPresets.ts";

async function fetchTagList(): Promise<TagRow[]> {
  const { header, rows } = await fetchCsv("/data/TAG.csv");
  if (header.length === 0) return [];
  const list: TagRow[] = [];
  for (const cells of rows) {
    const row = rowToObject(header, cells) as unknown as TagRow;
    if (row.SORT_ORDER === undefined || row.SORT_ORDER === "") row.SORT_ORDER = String(list.length);
    if (row.COLOR === undefined) row.COLOR = "";
    if (row.ICON_PATH === undefined) row.ICON_PATH = "";
    list.push(row);
  }
  return list;
}

function persistTag(): void {
  setTagDirty();
  saveTagCsvOnly().catch((e) => console.error("saveTagCsvOnly", e));
}

function saveTagNameFromCell(tagId: string, newName: string): void {
  const trimmed = newName.trim();
  if (!trimmed) {
    deleteTagRow(tagId);
    return;
  }
  const row = tagListFull.find((r) => r.ID === tagId);
  if (row) {
    row.TAG_NAME = trimmed;
    row.UPDATE_DATETIME = new Date().toISOString().slice(0, 19).replace("T", " ");
    row.UPDATE_USER = currentUserId;
    persistTag();
  }
}

/** 画面上のスロットを元に表示順を並び替え、永続化・再描画 */
function moveTagOrder(fromIndex: number, toSlot: number): void {
  const sorted = tagList.slice();
  const originalLength = sorted.length;
  if (fromIndex < 0 || toSlot < 0 || fromIndex >= originalLength || toSlot > originalLength) return;
  const [removed] = sorted.splice(fromIndex, 1);
  const insertAt = slotToInsertAt(toSlot, fromIndex, originalLength);
  sorted.splice(insertAt, 0, removed);
  sorted.forEach((r, i) => {
    r.SORT_ORDER = String(i);
  });
  setTagList(sorted);
  persistTag();
  renderTagTable();
}

const TAG_TABLE_COL_COUNT = 4;

function renderTagTable(): void {
  const tbody = document.getElementById("tag-tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  tagList.forEach((row, index) => {
    const tr = document.createElement("tr");
    tr.setAttribute("data-tag-id", row.ID);
    tr.setAttribute("aria-label", `行 ${index + 1} ドラッグで並び替え`);
    const tdDrag = createDragHandleCell();
    const iconColor = (row.COLOR?.trim() || ICON_DEFAULT_COLOR) as string;
    const tdIcon = document.createElement("td");
    tdIcon.className = "data-table-icon-col";
    const iconWrap = document.createElement("div");
    iconWrap.className = "category-icon-wrap";
    iconWrap.style.backgroundColor = iconColor;
    if (row.ICON_PATH?.trim()) {
      iconWrap.classList.add("category-icon-wrap--img");
      iconWrap.style.webkitMaskImage = `url(${row.ICON_PATH.trim()})`;
      iconWrap.style.maskImage = `url(${row.ICON_PATH.trim()})`;
      iconWrap.setAttribute("aria-hidden", "true");
    }
    iconWrap.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openColorIconPicker(row.COLOR ?? "", row.ICON_PATH ?? "", (color, iconPath) => {
        row.COLOR = color;
        row.ICON_PATH = iconPath;
        persistTag();
        renderTagTable();
      });
    });
    tdIcon.appendChild(iconWrap);
    const tdName = document.createElement("td");
    tdName.contentEditable = "true";
    tdName.textContent = row.TAG_NAME;
    attachNameCellBehavior(tdName, () => saveTagNameFromCell(row.ID, tdName.textContent ?? ""));
    const tdDel = createDeleteButtonCell({
      visible: tagDeleteMode,
      onDelete: () => deleteTagRow(row.ID),
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
        if (!noMove) moveTagOrder(fromIndex, currentSlot);
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

function deleteTagRow(tagId: string): void {
  const idx = tagListFull.findIndex((r) => r.ID === tagId);
  if (idx !== -1) tagListFull.splice(idx, 1);
  const sorted = tagListFull.slice().sort((a, b) => sortOrderNum(a.SORT_ORDER, b.SORT_ORDER));
  setTagList(sorted);
  persistTag();
  renderTagTable();
}

export async function loadAndRenderTagList(): Promise<void> {
  const list = await fetchTagList();
  setTagListFull(list);
  setTagListLoaded(true);
  const sorted = tagListFull.slice().sort((a, b) => sortOrderNum(a.SORT_ORDER, b.SORT_ORDER));
  setTagList(sorted);
  document.getElementById("header-delete-btn")?.classList.toggle("is-active", tagDeleteMode);
  renderTagTable();
}

function openTagModal(): void {
  const formName = document.getElementById("tag-form-name") as HTMLInputElement;
  const formColor = document.getElementById("tag-form-color") as HTMLInputElement;
  const formIconPath = document.getElementById("tag-form-icon-path") as HTMLInputElement;
  const overlay = document.getElementById("tag-modal-overlay");
  if (formName) formName.value = "";
  if (formColor) formColor.value = ICON_DEFAULT_COLOR;
  if (formIconPath) formIconPath.value = "";
  updateTagFormColorIconPreview();
  if (overlay) {
    overlay.classList.add("is-visible");
    overlay.setAttribute("aria-hidden", "false");
  }
}

function updateTagFormColorIconPreview(): void {
  const color = (document.getElementById("tag-form-color") as HTMLInputElement)?.value || ICON_DEFAULT_COLOR;
  const path = (document.getElementById("tag-form-icon-path") as HTMLInputElement)?.value || "";
  const wrap = document.getElementById("tag-form-color-icon-preview");
  if (!wrap) return;
  wrap.style.backgroundColor = color;
  wrap.classList.toggle("category-icon-wrap--img", !!path);
  wrap.style.webkitMaskImage = path ? `url(${path})` : "";
  wrap.style.maskImage = path ? `url(${path})` : "";
}

function closeTagModal(): void {
  const overlay = document.getElementById("tag-modal-overlay");
  if (overlay) {
    overlay.classList.remove("is-visible");
    overlay.setAttribute("aria-hidden", "true");
  }
}

function saveTagFormFromModal(): void {
  const formName = document.getElementById("tag-form-name") as HTMLInputElement;
  if (!formName) return;
  const name = formName.value.trim();
  if (!name) {
    formName.focus();
    return;
  }
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  const userId = currentUserId || "1";
  const maxId = tagListFull.reduce(
    (m, r) => Math.max(m, parseInt(r.ID, 10) || 0),
    0
  );
  const maxOrder = tagListFull.reduce(
    (m, r) => Math.max(m, Number(r.SORT_ORDER ?? 0) || 0),
    -1
  );
  const formColor = (document.getElementById("tag-form-color") as HTMLInputElement)?.value?.trim() || "";
  const formIconPath = (document.getElementById("tag-form-icon-path") as HTMLInputElement)?.value?.trim() || "";
  tagListFull.push({
    ID: String(maxId + 1),
    REGIST_DATETIME: now,
    REGIST_USER: userId,
    UPDATE_DATETIME: now,
    UPDATE_USER: userId,
    TAG_NAME: name,
    COLOR: formColor || "",
    ICON_PATH: formIconPath || "",
    SORT_ORDER: String(maxOrder + 1),
  });
  const sorted = tagListFull.slice().sort((a, b) => sortOrderNum(a.SORT_ORDER, b.SORT_ORDER));
  setTagList(sorted);
  persistTag();
  closeTagModal();
  renderTagTable();
}

function handleToggleDeleteMode(): void {
  toggleTagDeleteMode();
  document.getElementById("header-delete-btn")?.classList.toggle("is-active", tagDeleteMode);
  renderTagTable();
}

export function initTagView(): void {
  registerViewHandler("tag", loadAndRenderTagList);

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
