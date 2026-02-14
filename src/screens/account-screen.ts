import type { AccountRow } from "../types.ts";
import {
  currentUserId,
  currentView,
  accountListFull,
  accountList,
  accountListLoaded,
  accountDeleteMode,
  setAccountListFull,
  setAccountList,
  setAccountListLoaded,
  toggleAccountDeleteMode,
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
import { getAccountList, setAccountList as persistAccountList } from "../utils/storage.ts";
import { setAccountDirty } from "../utils/csvDirty.ts";
import { registerViewHandler } from "../app/screen";
import { openColorIconPicker } from "../utils/colorIconPicker.ts";
import { ICON_DEFAULT_COLOR } from "../constants/colorPresets.ts";

async function fetchAccountList(): Promise<AccountRow[]> {
  const stored = getAccountList();
  if (stored != null && Array.isArray(stored) && stored.length > 0) {
    const list = stored as AccountRow[];
    list.forEach((r, i) => {
      if (r.SORT_ORDER === undefined || r.SORT_ORDER === "") r.SORT_ORDER = String(i);
      if (r.COLOR === undefined) r.COLOR = "";
      if (r.ICON_PATH === undefined) r.ICON_PATH = "";
    });
    return list;
  }
  const { header, rows } = await fetchCsv("/data/ACCOUNT.csv");
  if (header.length === 0) return [];
  const list: AccountRow[] = [];
  for (const cells of rows) {
    const row = rowToObject(header, cells) as unknown as AccountRow;
    if (row.SORT_ORDER === undefined || row.SORT_ORDER === "") row.SORT_ORDER = String(list.length);
    if (row.COLOR === undefined) row.COLOR = "";
    if (row.ICON_PATH === undefined) row.ICON_PATH = "";
    list.push(row);
  }
  return list;
}

function persistAccount(): void {
  persistAccountList(accountListFull);
  setAccountDirty();
}

function saveAccountNameFromCell(accountId: string, newName: string): void {
  const trimmed = newName.trim();
  if (!trimmed) {
    deleteAccountRow(accountId);
    return;
  }
  const row = accountListFull.find((r) => r.ID === accountId);
  if (row && row.USER_ID === currentUserId) {
    row.ACCOUNT_NAME = trimmed;
    row.UPDATE_DATETIME = new Date().toISOString().slice(0, 19).replace("T", " ");
    row.UPDATE_USER = currentUserId;
    persistAccount();
  }
}

/** 画面上のスロットを元に表示順を並び替え、SORT_ORDER と accountListFull を更新して永続化・再描画 */
function moveAccountOrder(fromIndex: number, toSlot: number): void {
  const sorted = accountList.slice();
  const originalLength = sorted.length;
  if (fromIndex < 0 || toSlot < 0 || fromIndex >= originalLength || toSlot > originalLength) return;
  const [removed] = sorted.splice(fromIndex, 1);
  const insertAt = slotToInsertAt(toSlot, fromIndex, originalLength);
  sorted.splice(insertAt, 0, removed);
  sorted.forEach((r, i) => {
    r.SORT_ORDER = String(i);
  });
  // 画面遷移後に loadAndRenderAccountList が accountListFull から再フィルタ・ソートするため、
  // 当該ユーザーの行を newFull 内で新しい並びに差し替える
  let sortedIdx = 0;
  const newFull = accountListFull.map((r) =>
    r.USER_ID === currentUserId ? sorted[sortedIdx++] : r
  );
  setAccountListFull(newFull);
  setAccountList(sorted);
  persistAccount();
  renderAccountTable();
}

const ACCOUNT_TABLE_COL_COUNT = 4;
const ACCOUNT_ICON_DEFAULT_COLOR = "#646cff";

function renderAccountTable(): void {
  const tbody = document.getElementById("account-tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  accountList.forEach((row, index) => {
    const tr = document.createElement("tr");
    tr.setAttribute("data-account-id", row.ID);
    tr.setAttribute("aria-label", `行 ${index + 1} ドラッグで並び替え`);
    const tdDrag = createDragHandleCell();
    const iconColor = (row.COLOR?.trim() || ACCOUNT_ICON_DEFAULT_COLOR) as string;
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
        persistAccount();
        renderAccountTable();
      });
    });
    tdIcon.appendChild(iconWrap);
    const tdName = document.createElement("td");
    tdName.contentEditable = "true";
    tdName.textContent = row.ACCOUNT_NAME;
    attachNameCellBehavior(tdName, () => saveAccountNameFromCell(row.ID, tdName.textContent ?? ""));
    const tdDel = createDeleteButtonCell({
      visible: accountDeleteMode,
      onDelete: () => deleteAccountRow(row.ID),
    });
    tdDrag.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const fromIndex = index;
      const dataRows = tbody.querySelectorAll<HTMLTableRowElement>("tr[data-account-id]");
      const rects = Array.from(dataRows).map((row) => {
        const r = row.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom };
      });
      tr.classList.add("drag-source");
      const indicator = createDropIndicatorRow(ACCOUNT_TABLE_COL_COUNT);
      let currentSlot = fromIndex;
      tbody.insertBefore(indicator, dataRows[currentSlot] ?? null);
      const onMouseMove = (e: MouseEvent): void => {
        const slot = getSlotFromRects(e.clientY, rects);
        if (slot === currentSlot) return;
        currentSlot = slot;
        const rows = tbody.querySelectorAll<HTMLTableRowElement>("tr[data-account-id]");
        tbody.insertBefore(indicator, rows[currentSlot] ?? null);
      };
      const onMouseUp = (): void => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        tr.classList.remove("drag-source");
        indicator.remove();
        const insertAt = slotToInsertAt(currentSlot, fromIndex, rects.length);
        const noMove = insertAt === fromIndex;
        if (!noMove) moveAccountOrder(fromIndex, currentSlot);
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

function deleteAccountRow(accountId: string): void {
  const row = accountListFull.find((r) => r.ID === accountId);
  if (row && row.USER_ID === currentUserId) {
    const idx = accountListFull.indexOf(row);
    if (idx !== -1) accountListFull.splice(idx, 1);
  }
  const next = currentUserId
    ? accountListFull.filter((r) => r.USER_ID === currentUserId)
    : accountListFull;
  setAccountList(next);
  persistAccount();
  renderAccountTable();
}

export async function loadAndRenderAccountList(): Promise<void> {
  if (!accountListLoaded) {
    const list = await fetchAccountList();
    setAccountListFull(list);
    setAccountListLoaded(true);
    persistAccountList(list);
  }
  let next = currentUserId
    ? accountListFull.filter((r) => r.USER_ID === currentUserId)
    : [...accountListFull];
  next = next.slice().sort((a, b) => sortOrderNum(a.SORT_ORDER, b.SORT_ORDER));
  setAccountList(next);
  document.getElementById("header-delete-btn")?.classList.toggle("is-active", accountDeleteMode);
  renderAccountTable();
}

function openAccountModal(): void {
  const formName = document.getElementById("account-form-name") as HTMLInputElement;
  const formColor = document.getElementById("account-form-color") as HTMLInputElement;
  const formIconPath = document.getElementById("account-form-icon-path") as HTMLInputElement;
  const overlay = document.getElementById("account-modal-overlay");
  if (formName) formName.value = "";
  if (formColor) formColor.value = ICON_DEFAULT_COLOR;
  if (formIconPath) formIconPath.value = "";
  updateAccountFormColorIconPreview();
  if (overlay) {
    overlay.classList.add("is-visible");
    overlay.setAttribute("aria-hidden", "false");
  }
}

function closeAccountModal(): void {
  const overlay = document.getElementById("account-modal-overlay");
  if (overlay) {
    overlay.classList.remove("is-visible");
    overlay.setAttribute("aria-hidden", "true");
  }
}

function updateAccountFormColorIconPreview(): void {
  const color = (document.getElementById("account-form-color") as HTMLInputElement)?.value || ICON_DEFAULT_COLOR;
  const path = (document.getElementById("account-form-icon-path") as HTMLInputElement)?.value || "";
  const wrap = document.getElementById("account-form-color-icon-preview");
  if (!wrap) return;
  wrap.style.backgroundColor = color;
  wrap.classList.toggle("category-icon-wrap--img", !!path);
  wrap.style.webkitMaskImage = path ? `url(${path})` : "";
  wrap.style.maskImage = path ? `url(${path})` : "";
}

function saveAccountFormFromModal(): void {
  const formName = document.getElementById("account-form-name") as HTMLInputElement;
  if (!formName) return;
  const name = formName.value.trim();
  if (!name) {
    formName.focus();
    return;
  }
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  const userId = currentUserId || "1";
  const maxId = accountListFull.reduce(
    (m, r) => Math.max(m, parseInt(r.ID, 10) || 0),
    0
  );
  const userRows = currentUserId ? accountListFull.filter((r) => r.USER_ID === currentUserId) : accountListFull;
  const maxOrder = userRows.reduce(
    (m, r) => Math.max(m, Number(r.SORT_ORDER ?? 0) || 0),
    -1
  );
  const formColor = (document.getElementById("account-form-color") as HTMLInputElement)?.value?.trim() || "";
  const formIconPath = (document.getElementById("account-form-icon-path") as HTMLInputElement)?.value?.trim() || "";
  accountListFull.push({
    ID: String(maxId + 1),
    REGIST_DATETIME: now,
    REGIST_USER: userId,
    UPDATE_DATETIME: now,
    UPDATE_USER: userId,
    USER_ID: currentUserId,
    ACCOUNT_NAME: name,
    COLOR: formColor || "",
    ICON_PATH: formIconPath || "",
    SORT_ORDER: String(maxOrder + 1),
  });
  let next = currentUserId
    ? accountListFull.filter((r) => r.USER_ID === currentUserId)
    : [...accountListFull];
  next = next.slice().sort((a, b) => sortOrderNum(a.SORT_ORDER, b.SORT_ORDER));
  setAccountList(next);
  persistAccount();
  closeAccountModal();
  renderAccountTable();
}

function handleToggleDeleteMode(): void {
  toggleAccountDeleteMode();
  document.getElementById("header-delete-btn")?.classList.toggle("is-active", accountDeleteMode);
  renderAccountTable();
}

export function initAccountView(): void {
  registerViewHandler("account", loadAndRenderAccountList);

  document.getElementById("header-add-btn")?.addEventListener("click", () => {
    if (currentView === "account") openAccountModal();
  });
  document.getElementById("header-delete-btn")?.addEventListener("click", () => {
    if (currentView === "account") handleToggleDeleteMode();
  });
  document.getElementById("account-form-cancel")?.addEventListener("click", closeAccountModal);
  document.getElementById("account-form-color-icon-btn")?.addEventListener("click", () => {
    const formColor = (document.getElementById("account-form-color") as HTMLInputElement)?.value ?? ICON_DEFAULT_COLOR;
    const formIconPath = (document.getElementById("account-form-icon-path") as HTMLInputElement)?.value ?? "";
    openColorIconPicker(formColor, formIconPath, (color, iconPath) => {
      const colorEl = document.getElementById("account-form-color") as HTMLInputElement;
      const pathEl = document.getElementById("account-form-icon-path") as HTMLInputElement;
      if (colorEl) colorEl.value = color;
      if (pathEl) pathEl.value = iconPath;
      updateAccountFormColorIconPreview();
    });
  });
  document.getElementById("account-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    saveAccountFormFromModal();
  });
  document.getElementById("account-modal-overlay")?.addEventListener("click", (e) => {
    if (e.target instanceof HTMLElement && e.target.id === "account-modal-overlay")
      closeAccountModal();
  });
}
