import type { CategoryRow } from "../types.ts";
import {
  currentUserId,
  currentView,
  categoryListFull,
  categoryList,
  categoryDeleteMode,
  setCategoryListFull,
  setCategoryList,
  setCategoryListLoaded,
  toggleCategoryDeleteMode,
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
import { setCategoryDirty } from "../utils/csvDirty.ts";
import { saveCategoryCsvOnly } from "../utils/saveMasterCsv.ts";
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

/** カテゴリー種別 */
export type CategoryType = "income" | "expense" | "transfer";

const CATEGORY_TYPE_ORDER: CategoryType[] = ["expense", "income", "transfer"];

/** タブで選択中の種別（表示フィルタ） */
let selectedCategoryType: CategoryType = "expense";

/** ツリービュー表示フラグ（初期は ON） */
let categoryTreeViewMode = true;

/**
 * 現在選択中の種別の行だけに絞り、SORT_ORDER 昇順で返す。
 * @returns カテゴリー行の配列
 */
function getSameTypeFiltered(): CategoryRow[] {
  return categoryListFull
    .filter((r) => r.TYPE === selectedCategoryType)
    .sort((a, b) => sortOrderNum(a.SORT_ORDER, b.SORT_ORDER));
}

/**
 * 指定カテゴリーの子・孫・曾孫…の ID をすべて返す（循環防止・親選択除外用）。
 * @param categoryId - 起点となるカテゴリー ID
 * @param rows - カテゴリー行の配列
 * @returns 子孫 ID の Set
 */
function getDescendantIds(categoryId: string, rows: CategoryRow[]): Set<string> {
  const descendants = new Set<string>();
  let currentLevel: string[] = [categoryId];
  while (currentLevel.length > 0) {
    const nextLevel: string[] = [];
    for (const id of currentLevel) {
      // 現在階層の id を親に持つ行を子として追加
      for (const row of rows) {
        if (row.PARENT_ID === id) {
          descendants.add(row.ID);
          nextLevel.push(row.ID);
        }
      }
    }
    currentLevel = nextLevel;
  }
  return descendants;
}


/**
 * 親プルダウン用。同じ種別のうち、自カテゴリーとその子孫を除いた一覧を返す。
 * @param currentCategoryId - 自分自身のカテゴリー ID（除外する）
 * @returns 親候補のカテゴリー行の配列
 */
function getSameTypeCategoriesForParentSelect(currentCategoryId: string): CategoryRow[] {
  const rows = getSameTypeFiltered();
  const excludeIds = getDescendantIds(currentCategoryId, rows);
  excludeIds.add(currentCategoryId);
  return rows.filter((r) => !excludeIds.has(r.ID));
}

/**
 * 指定種別のカテゴリー一覧を返す（モーダル・親選択用）。
 * @param type - 種別（income / expense / transfer）
 * @returns カテゴリー行の配列
 */
function getCategoriesByType(type: CategoryType): CategoryRow[] {
  return categoryList.filter((r) => r.TYPE === type);
}

/**
 * ツリーベースの表示順（ルート→子の階層）で行と深さの配列を返す。同階層の並びは引数 rows の配列順に従う。
 * @param rows - カテゴリー行の配列
 * @returns 行と深さの配列
 */
function getCategoryRowsInTreeOrder(rows: CategoryRow[]): { row: CategoryRow; depth: number }[] {
  const idSet = new Set(rows.map((r) => r.ID));
  const roots = rows.filter((r) => !r.PARENT_ID || !idSet.has(r.PARENT_ID));
  const result: { row: CategoryRow; depth: number }[] = [];
  function visit(list: CategoryRow[], depth: number): void {
    for (const row of list) {
      result.push({ row, depth });
      const children = rows.filter((r) => r.PARENT_ID === row.ID);
      visit(children, depth + 1);
    }
  }
  visit(roots, 0);
  return result;
}

/**
 * 種別ごとに SORT_ORDER 順に並べる（表示順＝配列順のため初回ロード時に使用）。種別順は 支出→収入→振替。
 * @param list - ソート対象のカテゴリー配列（破壊的変更）
 * @returns なし
 */
function sortCategoryListByTypeAndOrder(list: CategoryRow[]): void {
  list.sort((a, b) => {
    if (a.TYPE !== b.TYPE) {
      const ia = CATEGORY_TYPE_ORDER.indexOf(a.TYPE as CategoryType);
      const ib = CATEGORY_TYPE_ORDER.indexOf(b.TYPE as CategoryType);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    }
    return sortOrderNum(a.SORT_ORDER, b.SORT_ORDER);
  });
}

/**
 * CATEGORY.csv を取得し、カテゴリー行の配列に変換して返す。種別・SORT_ORDER でソート済み。
 * @param noCache - true のときキャッシュを使わず再取得する（最新化ボタン用）
 * @returns Promise。カテゴリー行の配列
 */
async function fetchCategoryList(noCache = false): Promise<CategoryRow[]> {
  const { header, rows, version } = await fetchCsv("/data/CATEGORY.csv");
  setLastCsvVersion("CATEGORY.csv", version);
  if (header.length === 0) return [];
  const list: CategoryRow[] = [];
  for (const cells of rows) {
    const row = rowToObject(header, cells) as unknown as CategoryRow;
    if (row.SORT_ORDER === undefined || row.SORT_ORDER === "") row.SORT_ORDER = String(list.length);
    if (row.COLOR === undefined) row.COLOR = "";
    if (row.ICON_PATH === undefined) row.ICON_PATH = "";
    list.push(row);
  }
  sortCategoryListByTypeAndOrder(list);
  return list;
}

/**
 * カテゴリーの変更を dirty にし、CATEGORY.csv の保存を非同期で実行する。
 * @returns なし
 */
function persistCategory(): void {
  setCategoryDirty();
  saveCategoryCsvOnly().catch((e) => {
    if (e instanceof VersionConflictError) {
      alert(e.message);
      loadAndRenderCategoryList(true);
    } else {
      console.error("saveCategoryCsvOnly", e);
    }
  });
}

/**
 * 一覧セルで編集したカテゴリー名を保存する。空の場合は削除。バージョンチェック後に永続化・再描画。
 * @param categoryId - 対象カテゴリー ID
 * @param newName - 新しいカテゴリー名
 * @returns Promise
 */
async function saveCategoryNameFromCell(categoryId: string, newName: string): Promise<void> {
  const trimmed = newName.trim();
  if (!trimmed) {
    await deleteCategoryRow(categoryId);
    return;
  }
  const row = categoryListFull.find((r) => r.ID === categoryId);
  if (!row) return;
  const check = await checkVersionBeforeUpdate(
    "/data/CATEGORY.csv",
    categoryId,
    row.VERSION ?? "0"
  );
  if (!check.allowed) {
    alert(getVersionConflictMessage(check));
    await loadAndRenderCategoryList();
    return;
  }
  row.CATEGORY_NAME = trimmed;
  setUpdateAudit(row as unknown as Record<string, string>, currentUserId ?? "");
  persistCategory();
}

/**
 * 親カテゴリープルダウンで選択した親を保存する。バージョンチェック後に永続化・一覧再描画。
 * @param categoryId - 対象カテゴリー ID
 * @param parentId - 新しい親カテゴリー ID（空の場合はルート）
 * @returns Promise
 */
async function saveParentFromSelect(categoryId: string, parentId: string): Promise<void> {
  const row = categoryListFull.find((r) => r.ID === categoryId);
  if (!row) return;
  const check = await checkVersionBeforeUpdate(
    "/data/CATEGORY.csv",
    categoryId,
    row.VERSION ?? "0"
  );
  if (!check.allowed) {
    alert(getVersionConflictMessage(check));
    await loadAndRenderCategoryList();
    return;
  }
  row.PARENT_ID = parentId;
  setUpdateAudit(row as unknown as Record<string, string>, currentUserId ?? "");
  persistCategory();
  setCategoryList([...categoryListFull]);
  setDisplayedKeys("category", categoryListFull.map((c) => c.ID));
  renderCategoryTable();
}

/**
 * 画面上のスロットを元に同種別内の表示順を並び替え、SORT_ORDER と categoryListFull を更新して永続化・再描画する。
 * @param fromIndex - ドラッグ元の行インデックス
 * @param toSlot - ドロップ先スロット（0=先頭の前 ～ n=末尾の後）
 * @returns Promise
 */
async function moveCategoryOrder(fromIndex: number, toSlot: number): Promise<void> {
  const orderedRows = getSameTypeFiltered();
  const sorted = orderedRows.slice();
  const originalLength = sorted.length;
  if (fromIndex < 0 || toSlot < 0 || fromIndex >= originalLength || toSlot > originalLength) return;
  const [removed] = sorted.splice(fromIndex, 1);
  const insertAt = slotToInsertAt(toSlot, fromIndex, originalLength);
  sorted.splice(insertAt, 0, removed);
  for (const r of sorted) {
    const check = await checkVersionBeforeUpdate("/data/CATEGORY.csv", r.ID, r.VERSION ?? "0");
    if (!check.allowed) {
      alert(getVersionConflictMessage(check));
      await loadAndRenderCategoryList();
      return;
    }
  }
  sorted.forEach((r, i) => {
    r.SORT_ORDER = String(i);
    setUpdateAudit(r as unknown as Record<string, string>, currentUserId ?? "");
  });
  const type = sorted[0].TYPE;
  let sameTypeIdx = 0;
  const newFull = categoryListFull.map((r) => {
    if (r.TYPE !== type) return r;
    return sorted[sameTypeIdx++];
  });
  setCategoryListFull(newFull);
  setCategoryList([...newFull]);
  setDisplayedKeys("category", newFull.map((c) => c.ID));
  persistCategory();
  renderCategoryTable();
}

const CATEGORY_TABLE_COL_COUNT = 5;

/**
 * カテゴリー一覧テーブル（category-tbody）を描画する。ツリー/フラット切替・ドラッグ並び替え・名前編集・親選択・削除に対応。
 * @returns なし
 */
function renderCategoryTable(): void {
  const tbody = document.getElementById("category-tbody");
  const table = document.getElementById("category-table");
  if (!tbody) return;
  const isTreeView = categoryTreeViewMode;
  const sameTypeRows = getSameTypeFiltered();
  const rowsToRender = isTreeView
    ? getCategoryRowsInTreeOrder(sameTypeRows)
    : sameTypeRows.map((row) => ({ row, depth: 0 }));
  if (table) table.classList.toggle("category-table--tree", isTreeView);
  tbody.innerHTML = "";
  const parentOptions = (currentId: string) => getSameTypeCategoriesForParentSelect(currentId);
  rowsToRender.forEach(({ row, depth }, index) => {
    const tr = document.createElement("tr");
    tr.setAttribute("data-category-id", row.ID);
    if (depth > 0) tr.setAttribute("data-tree-depth", String(depth));
    tr.setAttribute("aria-label", isTreeView ? `行 ${index + 1}` : `行 ${index + 1} ドラッグで並び替え`);
    const tdIcon = document.createElement("td");
    tdIcon.className = "data-table-icon-col";
    const iconWrap = createIconWrap(row.COLOR ?? "", row.ICON_PATH ?? "");
    iconWrap.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openColorIconPicker(row.COLOR ?? "", row.ICON_PATH ?? "", async (color, iconPath) => {
        const check = await checkVersionBeforeUpdate(
          "/data/CATEGORY.csv",
          row.ID,
          row.VERSION ?? "0"
        );
        if (!check.allowed) {
          alert(getVersionConflictMessage(check));
          await loadAndRenderCategoryList();
          return;
        }
        row.COLOR = color;
        row.ICON_PATH = iconPath;
        setUpdateAudit(row as unknown as Record<string, string>, currentUserId ?? "");
        persistCategory();
        renderCategoryTable();
      });
    });
    tdIcon.appendChild(iconWrap);
    const tdName = document.createElement("td");
    if (depth > 0) tdName.classList.add("category-tree-cell");
    tdName.contentEditable = "true";
    tdName.textContent = row.CATEGORY_NAME;
    tdName.style.paddingLeft = depth > 0 ? `${0.75 + depth * 1.5}rem` : "";
    attachNameCellBehavior(tdName, () => {
      saveCategoryNameFromCell(row.ID, tdName.textContent ?? "").catch((e) => console.error(e));
    });
    const tdParent = document.createElement("td");
    const select = document.createElement("select");
    select.className = "category-parent-select";
    select.setAttribute("aria-label", "親カテゴリー");
    const optEmpty = document.createElement("option");
    optEmpty.value = "";
    optEmpty.textContent = "未設定";
    select.appendChild(optEmpty);
    const parentCandidates = parentOptions(row.ID);
    parentCandidates.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.ID;
      opt.textContent = p.CATEGORY_NAME;
      select.appendChild(opt);
    });
    const hasParentOption = row.PARENT_ID && parentCandidates.some((p) => p.ID === row.PARENT_ID);
    select.value = hasParentOption ? row.PARENT_ID : "";
    select.addEventListener("change", () => {
      saveParentFromSelect(row.ID, select.value).catch((e) => console.error(e));
    });
    tdParent.classList.add("category-parent-col");
    tdParent.appendChild(select);
    const tdDel = createDeleteButtonCell({
      visible: categoryDeleteMode,
      onDelete: () => deleteCategoryRow(row.ID).catch((e) => console.error(e)),
    });
    if (!isTreeView) {
      const tdDrag = createDragHandleCell();
      tdDrag.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const fromIndex = index;
        const dataRows = tbody.querySelectorAll<HTMLTableRowElement>("tr[data-category-id]");
        const rects = Array.from(dataRows).map((row) => {
          const r = row.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom };
        });
        tr.classList.add("drag-source");
        const indicator = createDropIndicatorRow(CATEGORY_TABLE_COL_COUNT);
        let currentSlot = fromIndex;
        tbody.insertBefore(indicator, dataRows[currentSlot] ?? null);
        const onMouseMove = (e: MouseEvent): void => {
          const slot = getSlotFromRects(e.clientY, rects);
          if (slot === currentSlot) return;
          currentSlot = slot;
          const rows = tbody.querySelectorAll<HTMLTableRowElement>("tr[data-category-id]");
          tbody.insertBefore(indicator, rows[currentSlot] ?? null);
        };
        const onMouseUp = (): void => {
          document.removeEventListener("mousemove", onMouseMove);
          document.removeEventListener("mouseup", onMouseUp);
          tr.classList.remove("drag-source");
          indicator.remove();
          const insertAt = slotToInsertAt(currentSlot, fromIndex, rects.length);
          const noMove = insertAt === fromIndex;
          if (!noMove) moveCategoryOrder(fromIndex, currentSlot).catch((e) => console.error(e));
        };
        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
      });
      tr.appendChild(tdDrag);
    }
    tr.appendChild(tdIcon);
    tr.appendChild(tdName);
    tr.appendChild(tdParent);
    tr.appendChild(tdDel);
    tbody.appendChild(tr);
  });
}

/**
 * 指定カテゴリーを一覧と state から削除し、CATEGORY.csv を永続化する。
 * @param categoryId - 削除するカテゴリー ID
 * @returns Promise
 */
async function deleteCategoryRow(categoryId: string): Promise<void> {
  const row = categoryListFull.find((r) => r.ID === categoryId);
  if (!row) return;
  const check = await checkVersionBeforeUpdate(
    "/data/CATEGORY.csv",
    categoryId,
    row.VERSION ?? "0"
  );
  if (!check.allowed) {
    alert(getVersionConflictMessage(check));
    await loadAndRenderCategoryList();
    return;
  }
  const idx = categoryListFull.findIndex((r) => r.ID === categoryId);
  if (idx !== -1) categoryListFull.splice(idx, 1);
  const sorted = categoryListFull.slice().sort((a, b) => sortOrderNum(a.SORT_ORDER, b.SORT_ORDER));
  setCategoryList(sorted);
  setDisplayedKeys("category", sorted.map((c) => c.ID));
  persistCategory();
  renderCategoryTable();
}

/**
 * カテゴリー一覧を取得し、カテゴリーテーブルを描画する。表示キーを setDisplayedKeys に登録する。
 * @param forceReloadFromCsv - true のときキャッシュを使わず CSV を再取得する（最新化ボタン用）
 * @returns Promise
 */
export async function loadAndRenderCategoryList(forceReloadFromCsv = false): Promise<void> {
  const list = await fetchCategoryList(forceReloadFromCsv);
  setCategoryListFull(list);
  setCategoryListLoaded(true);
  const sorted = categoryListFull.slice().sort((a, b) => sortOrderNum(a.SORT_ORDER, b.SORT_ORDER));
  setCategoryList(sorted);
  setDisplayedKeys("category", sorted.map((c) => c.ID));
  updateCategoryTabsActive();
  updateCategoryViewButton();
  document.getElementById("header-delete-btn")?.classList.toggle("is-active", categoryDeleteMode);
  renderCategoryTable();
}

/**
 * 追加モーダル内の親カテゴリープルダウンを指定種別の候補で再描画する。
 * @param type - 種別（income / expense / transfer）
 * @returns なし
 */
function fillCategoryFormParentSelect(type: CategoryType): void {
  const formParent = document.getElementById("category-form-parent") as HTMLSelectElement | null;
  if (!formParent) return;
  formParent.innerHTML = "";
  const optEmpty = document.createElement("option");
  optEmpty.value = "";
  optEmpty.textContent = "未選択";
  formParent.appendChild(optEmpty);
  const rows = getCategoriesByType(type);
  rows.forEach((row) => {
    const opt = document.createElement("option");
    opt.value = row.ID;
    opt.textContent = row.CATEGORY_NAME;
    formParent.appendChild(opt);
  });
}

/**
 * カテゴリー追加モーダルを開く。フォームを初期化し、オーバーレイを表示する。
 * @returns なし
 */
/**
 * カテゴリー追加フォームの種別ボタンの表示を、hidden の値に合わせて更新する。
 * @param type - 選択中の種別
 * @returns なし
 */
function syncCategoryFormTypeButtons(type: CategoryType): void {
  const formTypeInput = document.getElementById("category-form-type") as HTMLInputElement;
  if (formTypeInput) formTypeInput.value = type;
  document.querySelectorAll(".category-form-type-btn").forEach((btn) => {
    const t = (btn as HTMLButtonElement).dataset.type as CategoryType | undefined;
    const active = t === type;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-pressed", String(active));
  });
}

function openCategoryModal(): void {
  const formName = document.getElementById("category-form-name") as HTMLInputElement;
  const formType = document.getElementById("category-form-type") as HTMLInputElement;
  const formParent = document.getElementById("category-form-parent") as HTMLSelectElement;
  const formColor = document.getElementById("category-form-color") as HTMLInputElement;
  const formIconPath = document.getElementById("category-form-icon-path") as HTMLInputElement;
  if (formName) formName.value = "";
  if (formType) formType.value = selectedCategoryType;
  syncCategoryFormTypeButtons(selectedCategoryType);
  fillCategoryFormParentSelect(selectedCategoryType);
  if (formParent) formParent.value = "";
  if (formColor) formColor.value = ICON_DEFAULT_COLOR;
  if (formIconPath) formIconPath.value = "";
  updateCategoryFormColorIconPreview();
  openOverlay("category-modal-overlay");
}

/**
 * カテゴリー追加モーダルを閉じる。
 * @returns なし
 */
function closeCategoryModal(): void {
  closeOverlay("category-modal-overlay");
}

/**
 * カテゴリーフォームの色・アイコンフィールドの値をプレビュー要素に反映する。
 * @returns なし
 */
function updateCategoryFormColorIconPreview(): void {
  const wrap = document.getElementById("category-form-color-icon-preview");
  const color = (document.getElementById("category-form-color") as HTMLInputElement)?.value || ICON_DEFAULT_COLOR;
  const path = (document.getElementById("category-form-icon-path") as HTMLInputElement)?.value || "";
  if (wrap) applyColorIconToElement(wrap, color, path);
}

/**
 * カテゴリーモーダルのフォーム内容を検証し、新規カテゴリーを追加して永続化する。完了後にモーダルを閉じ一覧を再描画する。
 * @returns なし
 */
function saveCategoryFormFromModal(): void {
  const formName = document.getElementById("category-form-name") as HTMLInputElement;
  const formType = document.getElementById("category-form-type") as HTMLInputElement;
  const formParent = document.getElementById("category-form-parent") as HTMLSelectElement;
  if (!formName) return;
  const name = formName.value.trim();
  if (!name) {
    formName.focus();
    return;
  }
  const userId = currentUserId ?? "";
  const typeRaw = formType?.value;
  const type: CategoryType =
    typeRaw === "income" ? "income" : typeRaw === "transfer" ? "transfer" : "expense";
  const parentId = formParent?.value ?? "";
  const maxId = categoryListFull.reduce(
    (m, r) => Math.max(m, parseInt(r.ID, 10) || 0),
    0
  );
  const newId = String(maxId + 1);
  const sameType = categoryListFull.filter((r) => r.TYPE === type);
  const maxOrder = sameType.reduce(
    (m, r) => Math.max(m, Number(r.SORT_ORDER ?? 0) || 0),
    -1
  );
  const formColor = (document.getElementById("category-form-color") as HTMLInputElement)?.value?.trim() || "";
  const formIconPath = (document.getElementById("category-form-icon-path") as HTMLInputElement)?.value?.trim() || "";
  const newRow: CategoryRow = {
    ID: newId,
    VERSION: "0",
    REGIST_DATETIME: "",
    REGIST_USER: "",
    UPDATE_DATETIME: "",
    UPDATE_USER: "",
    PARENT_ID: parentId,
    TYPE: type,
    CATEGORY_NAME: name,
    COLOR: formColor || "",
    ICON_PATH: formIconPath || "",
    SORT_ORDER: String(maxOrder + 1),
  };
  setNewRowAudit(newRow as unknown as Record<string, string>, userId, newId);
  categoryListFull.push(newRow);
  setCategoryList([...categoryListFull]);
  setDisplayedKeys("category", categoryListFull.map((c) => c.ID));
  persistCategory();
  closeCategoryModal();
  renderCategoryTable();
}

/**
 * カテゴリー画面の削除モードをトグルし、削除ボタンの表示とヘッダーボタンの状態を更新する。
 * @returns なし
 */
function handleToggleDeleteMode(): void {
  toggleCategoryDeleteMode();
  document.getElementById("header-delete-btn")?.classList.toggle("is-active", categoryDeleteMode);
  renderCategoryTable();
}

/**
 * 種別タブのアクティブ状態と aria-selected を現在の選択種別に合わせて更新する。
 * @returns なし
 */
function updateCategoryTabsActive(): void {
  document.querySelectorAll(".category-tab").forEach((btn) => {
    const type = (btn as HTMLButtonElement).dataset.type;
    const isActive = type === selectedCategoryType;
    btn.classList.toggle("is-active", isActive);
    btn.setAttribute("aria-selected", String(isActive));
  });
}

/**
 * ツリービュー/フラットビューボタンのラベルと見た目を現在のモードに合わせて更新する。
 * @returns なし
 */
function updateCategoryViewButton(): void {
  const btn = document.getElementById("category-tree-view-btn");
  if (!btn) return;
  if (categoryTreeViewMode) {
    btn.textContent = "フラットビュー";
    btn.classList.add("is-tree-mode");
    btn.setAttribute("aria-pressed", "true");
    btn.title = "一覧表示に切り替え";
  } else {
    btn.textContent = "ツリービュー";
    btn.classList.remove("is-tree-mode");
    btn.setAttribute("aria-pressed", "false");
    btn.title = "ツリービュー";
  }
}

/**
 * カテゴリー画面の初期化を行う。「category」ビュー表示ハンドラとモーダル・削除モード・タブ等のイベントを登録する。
 * @returns なし
 */
export function initCategoryView(): void {
  registerViewHandler("category", loadAndRenderCategoryList);
  registerRefreshHandler("category", () => loadAndRenderCategoryList(true));

  document.querySelectorAll(".category-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const type = (btn as HTMLButtonElement).dataset.type as CategoryType | undefined;
      if (type === "income" || type === "expense" || type === "transfer") {
        selectedCategoryType = type;
        updateCategoryTabsActive();
        renderCategoryTable();
      }
    });
  });

  const treeViewBtn = document.getElementById("category-tree-view-btn");
  treeViewBtn?.addEventListener("click", () => {
    categoryTreeViewMode = !categoryTreeViewMode;
    updateCategoryViewButton();
    renderCategoryTable();
  });

  document.getElementById("header-add-btn")?.addEventListener("click", () => {
    if (currentView === "category") openCategoryModal();
  });
  document.getElementById("header-delete-btn")?.addEventListener("click", () => {
    if (currentView === "category") handleToggleDeleteMode();
  });
  document.getElementById("category-form-cancel")?.addEventListener("click", closeCategoryModal);
  document.getElementById("category-form-color-icon-btn")?.addEventListener("click", () => {
    const formColor = (document.getElementById("category-form-color") as HTMLInputElement)?.value ?? ICON_DEFAULT_COLOR;
    const formIconPath = (document.getElementById("category-form-icon-path") as HTMLInputElement)?.value ?? "";
    openColorIconPicker(formColor, formIconPath, (color, iconPath) => {
      const colorEl = document.getElementById("category-form-color") as HTMLInputElement;
      const pathEl = document.getElementById("category-form-icon-path") as HTMLInputElement;
      if (colorEl) colorEl.value = color;
      if (pathEl) pathEl.value = iconPath;
      updateCategoryFormColorIconPreview();
    });
  });
  document.querySelector(".category-form-type-buttons")?.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest(".category-form-type-btn");
    if (!btn) return;
    const type = (btn as HTMLButtonElement).dataset.type as CategoryType | undefined;
    if (type !== "income" && type !== "expense" && type !== "transfer") return;
    const formParent = document.getElementById("category-form-parent") as HTMLSelectElement;
    syncCategoryFormTypeButtons(type);
    fillCategoryFormParentSelect(type);
    if (formParent) formParent.value = "";
  });
  document.getElementById("category-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    saveCategoryFormFromModal();
  });
  document.getElementById("category-modal-overlay")?.addEventListener("click", (e) => {
    if (e.target instanceof HTMLElement && e.target.id === "category-modal-overlay")
      closeCategoryModal();
  });
}
