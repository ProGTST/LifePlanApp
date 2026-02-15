import type { AccountRow, AccountPermissionRow, UserRow } from "../types.ts";
import {
  currentUserId,
  currentView,
  accountListFull,
  accountList,
  accountListLoaded,
  accountDeleteMode,
  accountPermissionListFull,
  setAccountListFull,
  setAccountList,
  setAccountListLoaded,
  setAccountPermissionListFull,
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
import { setAccountDirty } from "../utils/csvDirty.ts";
import { saveAccountCsvOnly } from "../utils/saveMasterCsv.ts";
import { registerViewHandler } from "../app/screen";
import { openColorIconPicker } from "../utils/colorIconPicker.ts";
import { ICON_DEFAULT_COLOR } from "../constants/colorPresets.ts";

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

const ACCOUNT_TABLE_COL_COUNT = 5;
const ACCOUNT_ICON_DEFAULT_COLOR = "#646cff";
const ICON_DELETE = "/icon/circle-minus-solid-full.svg";

// ---------------------------------------------------------------------------
// データ取得
// ---------------------------------------------------------------------------

function getAccountPermissionRows(): AccountPermissionRow[] {
  return accountPermissionListFull;
}

function nowStr(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

async function fetchAccountList(): Promise<AccountRow[]> {
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

async function fetchUserList(): Promise<UserRow[]> {
  const { header, rows } = await fetchCsv("/data/USER.csv");
  if (header.length === 0) return [];
  const list: UserRow[] = [];
  for (const cells of rows) {
    list.push(rowToObject(header, cells) as unknown as UserRow);
  }
  return list;
}

async function fetchAccountPermissionList(): Promise<AccountPermissionRow[]> {
  const { header, rows } = await fetchCsv("/data/ACCOUNT_PERMISSION.csv", { cache: "reload" });
  if (header.length === 0) return [];
  const list: AccountPermissionRow[] = [];
  for (const cells of rows) {
    if (cells.length === 0 || cells.every((c) => !c.trim())) continue;
    list.push(rowToObject(header, cells) as unknown as AccountPermissionRow);
  }
  setAccountPermissionListFull(list);
  return list;
}

function persistAccount(): void {
  setAccountDirty();
  saveAccountCsvOnly().catch((e) => console.error("saveAccountCsvOnly", e));
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
    row.UPDATE_DATETIME = nowStr();
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

// ---------------------------------------------------------------------------
// 権限・フォーム状態
// ---------------------------------------------------------------------------

type PermissionFormRow = { userId: string; userName: string; permissionType: string };
let accountFormPermissionRows: PermissionFormRow[] = [];
/** 一覧の「権限追加」から開いた場合の対象勘定ID。null のときは新規勘定フォーム用 */
let accountPermissionAddTargetId: string | null = null;
/** 権限ユーザーモーダルで編集中の勘定ID。null のときはモーダル非表示 */
let accountPermissionEditTargetId: string | null = null;

function getPermissionCountForAccount(accountId: string): number {
  return getAccountPermissionRows().filter((p) => p.ACCOUNT_ID === accountId).length;
}

/** ACCOUNT_PERMISSION で USER_ID がログインユーザーと一致する勘定（他ユーザー所有）を取得 */
function getSharedWithMeAccountIds(): string[] {
  const me = currentUserId;
  if (!me) return [];
  return [...new Set(getAccountPermissionRows().filter((p) => p.USER_ID === me).map((p) => p.ACCOUNT_ID))];
}

function createAccountIconWrap(color: string, iconPath: string): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "category-icon-wrap";
  wrap.style.backgroundColor = (color?.trim() || ACCOUNT_ICON_DEFAULT_COLOR) as string;
  if (iconPath?.trim()) {
    wrap.classList.add("category-icon-wrap--img");
    wrap.style.webkitMaskImage = `url(${iconPath.trim()})`;
    wrap.style.maskImage = `url(${iconPath.trim()})`;
    wrap.setAttribute("aria-hidden", "true");
  }
  return wrap;
}

async function renderSharedWithMeAccountTable(): Promise<void> {
  const tbody = document.getElementById("account-shared-tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  const permittedIds = getSharedWithMeAccountIds();
  const permissionList = getAccountPermissionRows();
  const shared = accountListFull.filter(
    (r) => r.USER_ID !== currentUserId && permittedIds.includes(r.ID)
  );
  if (shared.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 4;
    td.className = "account-shared-empty";
    td.textContent = "参照可能な勘定はありません";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }
  const userList = await fetchUserList();
  const userMap = new Map<string, string>();
  userList.forEach((u) => userMap.set(u.ID, (u.NAME || u.ID || "—").trim()));
  const sorted = shared.slice().sort((a, b) => {
    const nameA = userMap.get(a.USER_ID) ?? a.USER_ID;
    const nameB = userMap.get(b.USER_ID) ?? b.USER_ID;
    return nameA.localeCompare(nameB) || (a.ACCOUNT_NAME || "").localeCompare(b.ACCOUNT_NAME || "");
  });
  sorted.forEach((row) => {
    const perm = permissionList.find((p) => p.ACCOUNT_ID === row.ID && p.USER_ID === currentUserId);
    const permissionType = (perm?.PERMISSION_TYPE ?? "view") as "view" | "edit";
    const tr = document.createElement("tr");
    tr.setAttribute("data-account-id", row.ID);
    const tdIcon = document.createElement("td");
    tdIcon.className = "data-table-icon-col";
    tdIcon.appendChild(createAccountIconWrap(row.COLOR ?? "", row.ICON_PATH ?? ""));
    const tdName = document.createElement("td");
    tdName.textContent = row.ACCOUNT_NAME || "—";
    const tdUser = document.createElement("td");
    tdUser.className = "account-shared-user-name account-shared-user-col";
    tdUser.textContent = userMap.get(row.USER_ID) ?? row.USER_ID;
    const tdPermission = document.createElement("td");
    tdPermission.className = "account-shared-permission-col";
    const permSpan = document.createElement("span");
    permSpan.className = `account-shared-permission-badge account-shared-permission-badge--${permissionType}`;
    permSpan.textContent = permissionType === "edit" ? "編集" : "参照";
    tdPermission.appendChild(permSpan);
    tr.appendChild(tdIcon);
    tr.appendChild(tdName);
    tr.appendChild(tdUser);
    tr.appendChild(tdPermission);
    tbody.appendChild(tr);
  });
}

// ---------------------------------------------------------------------------
// 一覧テーブル描画
// ---------------------------------------------------------------------------

function renderAccountTable(): void {
  const tbody = document.getElementById("account-tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  accountList.forEach((row, index) => {
    const tr = document.createElement("tr");
    tr.setAttribute("data-account-id", row.ID);
    tr.setAttribute("aria-label", `行 ${index + 1} ドラッグで並び替え`);
    const tdDrag = createDragHandleCell();
    const tdIcon = document.createElement("td");
    tdIcon.className = "data-table-icon-col";
    const iconWrap = createAccountIconWrap(row.COLOR ?? "", row.ICON_PATH ?? "");
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
    const tdPermission = document.createElement("td");
    tdPermission.className = "account-table-permission-col";
    const permCount = getPermissionCountForAccount(row.ID);
    const permCountSpan = document.createElement("span");
    permCountSpan.className = "account-table-permission-count";
    permCountSpan.textContent = `${permCount}人`;
    const permAddBtn = document.createElement("button");
    permAddBtn.type = "button";
    permAddBtn.className = "account-table-permission-add-btn";
    permAddBtn.textContent = "権限追加";
    permAddBtn.setAttribute("aria-label", `${row.ACCOUNT_NAME}の権限ユーザーを管理`);
    permAddBtn.addEventListener("click", (e) => {
      e.preventDefault();
      openAccountPermissionUsersModal(row.ID, row.ACCOUNT_NAME || "—");
    });
    tdPermission.appendChild(permCountSpan);
    tdPermission.appendChild(permAddBtn);
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
    tr.appendChild(tdPermission);
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
  const permissionWithoutAccount = getAccountPermissionRows().filter(
    (p) => p.ACCOUNT_ID !== accountId
  );
  setAccountPermissionListFull(permissionWithoutAccount);
  saveAccountCsvOnly().catch((e) => console.error("saveAccountCsvOnly", e));
  let next = currentUserId
    ? accountListFull.filter((r) => r.USER_ID === currentUserId)
    : [...accountListFull];
  next = next.slice().sort((a, b) => sortOrderNum(a.SORT_ORDER, b.SORT_ORDER));
  setAccountList(next);
  persistAccount();
  renderAccountTable();
}

// ---------------------------------------------------------------------------
// 画面読み込み・モーダル
// ---------------------------------------------------------------------------

export async function loadAndRenderAccountList(): Promise<void> {
  if (!accountListLoaded) {
    const [list] = await Promise.all([fetchAccountList(), fetchAccountPermissionList()]);
    setAccountListFull(list);
    setAccountListLoaded(true);
  }
  let next = currentUserId
    ? accountListFull.filter((r) => r.USER_ID === currentUserId)
    : [...accountListFull];
  next = next.slice().sort((a, b) => sortOrderNum(a.SORT_ORDER, b.SORT_ORDER));
  setAccountList(next);
  document.getElementById("header-delete-btn")?.classList.toggle("is-active", accountDeleteMode);
  renderAccountTable();
  await renderSharedWithMeAccountTable();
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
  accountFormPermissionRows = [];
  renderAccountFormPermissionList(accountFormPermissionRows);
  if (overlay) {
    overlay.classList.add("is-visible");
    overlay.setAttribute("aria-hidden", "false");
  }
}

function closeAccountModal(): void {
  const overlay = document.getElementById("account-modal-overlay");
  if (overlay) {
    if (overlay.contains(document.activeElement)) (document.activeElement as HTMLElement)?.blur();
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

// ---------------------------------------------------------------------------
// フォーム：権限リスト描画・ユーザー選択
// ---------------------------------------------------------------------------

function renderAccountFormPermissionList(rows: PermissionFormRow[]): void {
  const listEl = document.getElementById("account-form-permission-list");
  if (!listEl) return;
  listEl.innerHTML = "";
  if (rows.length === 0) {
    const emptySpan = document.createElement("span");
    emptySpan.className = "account-form-permission-empty";
    emptySpan.textContent = "未設定";
    listEl.appendChild(emptySpan);
    return;
  }
  rows.forEach((row, index) => {
    const div = document.createElement("div");
    div.className = "account-form-permission-item";
    const nameSpan = document.createElement("span");
    nameSpan.className = "account-form-permission-user-name";
    nameSpan.textContent = row.userName || row.userId || "—";
    const permBtn = document.createElement("button");
    permBtn.type = "button";
    const isEdit = row.permissionType === "edit";
    permBtn.className = `account-form-permission-toggle account-form-permission-toggle--${isEdit ? "edit" : "view"}`;
    permBtn.textContent = isEdit ? "編集" : "参照";
    permBtn.setAttribute("aria-label", isEdit ? "編集（クリックで参照に切り替え）" : "参照（クリックで編集に切り替え）");
    permBtn.addEventListener("click", () => {
      const next = accountFormPermissionRows[index].permissionType === "edit" ? "view" : "edit";
      accountFormPermissionRows[index] = { ...accountFormPermissionRows[index], permissionType: next };
      renderAccountFormPermissionList(accountFormPermissionRows);
    });
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "account-row-delete-btn is-visible";
    removeBtn.setAttribute("aria-label", "削除");
    const removeImg = document.createElement("img");
    removeImg.src = ICON_DELETE;
    removeImg.alt = "";
    removeImg.width = 20;
    removeImg.height = 20;
    removeBtn.appendChild(removeImg);
    removeBtn.addEventListener("click", () => {
      accountFormPermissionRows.splice(index, 1);
      renderAccountFormPermissionList(accountFormPermissionRows);
    });
    div.appendChild(nameSpan);
    div.appendChild(permBtn);
    div.appendChild(removeBtn);
    listEl.appendChild(div);
  });
}

function openAccountFormUserPicker(forAccountId?: string): void {
  accountPermissionAddTargetId = forAccountId ?? null;
  const permissionList = getAccountPermissionRows();
  fetchUserList().then((userList) => {
    const others = userList.filter((u) => u.ID !== currentUserId);
    const listEl = document.getElementById("account-form-user-picker-list");
    if (!listEl) return;
    listEl.innerHTML = "";
    if (others.length === 0) {
      const p = document.createElement("p");
      p.className = "form-hint";
      p.textContent = "ログインユーザー以外のユーザーがいません。";
      listEl.appendChild(p);
    } else {
      others.forEach((user) => {
        const already = forAccountId
          ? permissionList.some((p) => p.ACCOUNT_ID === forAccountId && p.USER_ID === user.ID)
          : accountFormPermissionRows.some((r) => r.userId === user.ID);
        const row = document.createElement("div");
        row.className = "account-form-user-picker-item";
        row.dataset.userId = user.ID;
        row.dataset.userName = user.NAME || user.ID || "—";
        const checkBtn = document.createElement("button");
        checkBtn.type = "button";
        checkBtn.className = "account-form-user-picker-check-btn";
        checkBtn.setAttribute("aria-label", "選択");
        checkBtn.setAttribute("aria-pressed", already ? "true" : "false");
        if (already) checkBtn.classList.add("is-selected");
        const checkIcon = document.createElement("span");
        checkIcon.className = "account-form-user-picker-check-icon";
        checkIcon.setAttribute("aria-hidden", "true");
        checkBtn.appendChild(checkIcon);
        checkBtn.addEventListener("click", (e) => {
          e.preventDefault();
          const pressed = checkBtn.getAttribute("aria-pressed") === "true";
          checkBtn.setAttribute("aria-pressed", String(!pressed));
          checkBtn.classList.toggle("is-selected", !pressed);
        });
        const nameSpan = document.createElement("span");
        nameSpan.className = "account-form-user-picker-item-name";
        nameSpan.textContent = user.NAME || user.ID || "—";
        nameSpan.addEventListener("click", () => {
          const pressed = checkBtn.getAttribute("aria-pressed") === "true";
          checkBtn.setAttribute("aria-pressed", String(!pressed));
          checkBtn.classList.toggle("is-selected", !pressed);
        });
        row.appendChild(checkBtn);
        row.appendChild(nameSpan);
        listEl.appendChild(row);
      });
    }
    const overlay = document.getElementById("account-form-user-picker-overlay");
    if (overlay) {
      overlay.classList.add("is-visible");
      overlay.setAttribute("aria-hidden", "false");
    }
  });
}

function applyAccountFormUserPicker(): void {
  const listEl = document.getElementById("account-form-user-picker-list");
  if (!listEl) return;
  const selected = listEl.querySelectorAll<HTMLElement>(".account-form-user-picker-item .account-form-user-picker-check-btn.is-selected");
  if (accountPermissionAddTargetId) {
    const targetAccountId = accountPermissionAddTargetId;
    const existing = getAccountPermissionRows();
    const selectedUserIds = Array.from(selected)
      .map((btn) => btn.closest(".account-form-user-picker-item")?.getAttribute("data-user-id"))
      .filter((id): id is string => !!id);
    const existingForAccount = existing.filter((p) => p.ACCOUNT_ID === targetAccountId);
    const keepRows = existingForAccount.filter((p) => selectedUserIds.includes(p.USER_ID));
    const toAddIds = selectedUserIds.filter((id) => !existingForAccount.some((p) => p.USER_ID === id));
    let nextId = existing.reduce((m, r) => Math.max(m, parseInt(r.ID, 10) || 0), 0) + 1;
    const now = nowStr();
    const userId = currentUserId ?? "";
    const newRows: AccountPermissionRow[] = toAddIds.map((targetUserId) => ({
      ID: String(nextId++),
      REGIST_DATETIME: now,
      REGIST_USER: userId,
      UPDATE_DATETIME: now,
      UPDATE_USER: userId,
      ACCOUNT_ID: targetAccountId,
      USER_ID: targetUserId,
      PERMISSION_TYPE: "view",
    }));
    const merged = existing.filter((p) => p.ACCOUNT_ID !== targetAccountId).concat(keepRows).concat(newRows);
    setAccountPermissionListFull(merged);
    setAccountDirty();
    saveAccountCsvOnly().catch((e) => console.error("saveAccountCsvOnly", e));
    accountPermissionAddTargetId = null;
    renderAccountTable();
    if (accountPermissionEditTargetId) renderAccountPermissionUsersModal();
    closeAccountFormUserPicker();
    return;
  }
  const selectedRows: PermissionFormRow[] = Array.from(selected).map((btn) => {
    const row = btn.closest(".account-form-user-picker-item");
    const userId = row?.getAttribute("data-user-id") ?? "";
    const userName = row?.getAttribute("data-user-name") ?? "—";
    return { userId, userName, permissionType: "view" };
  });
  accountFormPermissionRows = selectedRows.filter((r) => r.userId.trim() !== "");
  renderAccountFormPermissionList(accountFormPermissionRows);
  closeAccountFormUserPicker();
}

function closeAccountFormUserPicker(): void {
  const overlay = document.getElementById("account-form-user-picker-overlay");
  if (overlay) {
    if (overlay.contains(document.activeElement)) (document.activeElement as HTMLElement)?.blur();
    overlay.classList.remove("is-visible");
    overlay.setAttribute("aria-hidden", "true");
  }
}

function openAccountPermissionUsersModal(accountId: string, accountName: string): void {
  accountPermissionEditTargetId = accountId;
  const titleEl = document.getElementById("account-permission-users-title");
  if (titleEl) titleEl.textContent = `権限ユーザー：${accountName}`;
  renderAccountPermissionUsersModal();
  const overlay = document.getElementById("account-permission-users-overlay");
  if (overlay) {
    overlay.classList.add("is-visible");
    overlay.setAttribute("aria-hidden", "false");
  }
}

function closeAccountPermissionUsersModal(): void {
  const overlay = document.getElementById("account-permission-users-overlay");
  if (overlay) {
    if (overlay.contains(document.activeElement)) (document.activeElement as HTMLElement)?.blur();
    overlay.classList.remove("is-visible");
    overlay.setAttribute("aria-hidden", "true");
  }
  accountPermissionEditTargetId = null;
  renderAccountTable();
  renderSharedWithMeAccountTable();
}

function renderAccountPermissionUsersModal(): void {
  if (!accountPermissionEditTargetId) return;
  const listEl = document.getElementById("account-permission-users-list");
  if (!listEl) return;
  const accountId = accountPermissionEditTargetId;
  const rows = getAccountPermissionRows().filter((p) => p.ACCOUNT_ID === accountId);
  listEl.innerHTML = "";
  if (rows.length === 0) {
    const emptySpan = document.createElement("span");
    emptySpan.className = "account-permission-users-empty";
    emptySpan.textContent = "権限ユーザーはいません。「権限追加」で追加できます。";
    listEl.appendChild(emptySpan);
  } else {
    fetchUserList().then((userList) => {
      const userMap = new Map<string, string>();
      userList.forEach((u) => userMap.set(u.ID, (u.NAME || u.ID || "—").trim()));
      rows.forEach((perm) => {
        const div = document.createElement("div");
        div.className = "account-permission-users-item";
        const nameSpan = document.createElement("span");
        nameSpan.className = "account-permission-users-user-name";
        nameSpan.textContent = userMap.get(perm.USER_ID) ?? perm.USER_ID;
        const permBtn = document.createElement("button");
        permBtn.type = "button";
        const isEdit = perm.PERMISSION_TYPE === "edit";
        permBtn.className = `account-permission-users-toggle account-permission-users-toggle--${isEdit ? "edit" : "view"}`;
        permBtn.textContent = isEdit ? "編集" : "参照";
        permBtn.setAttribute("aria-label", isEdit ? "編集（クリックで参照に切り替え）" : "参照（クリックで編集に切り替え）");
        permBtn.addEventListener("click", () => {
          const next = getAccountPermissionRows().map((p) =>
            p.ACCOUNT_ID === accountId && p.USER_ID === perm.USER_ID
              ? { ...p, PERMISSION_TYPE: p.PERMISSION_TYPE === "edit" ? "view" : "edit" }
              : p
          );
          setAccountPermissionListFull(next);
          setAccountDirty();
          saveAccountCsvOnly().catch((e) => console.error("saveAccountCsvOnly", e));
          renderAccountPermissionUsersModal();
        });
        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "account-row-delete-btn is-visible";
        removeBtn.setAttribute("aria-label", "削除");
        const removeImg = document.createElement("img");
        removeImg.src = ICON_DELETE;
        removeImg.alt = "";
        removeImg.width = 20;
        removeImg.height = 20;
        removeBtn.appendChild(removeImg);
        removeBtn.addEventListener("click", () => {
          const next = getAccountPermissionRows().filter(
            (p) => !(p.ACCOUNT_ID === accountId && p.USER_ID === perm.USER_ID)
          );
          setAccountPermissionListFull(next);
          setAccountDirty();
          saveAccountCsvOnly().catch((e) => console.error("saveAccountCsvOnly", e));
          renderAccountPermissionUsersModal();
        });
        div.appendChild(nameSpan);
        div.appendChild(permBtn);
        div.appendChild(removeBtn);
        listEl.appendChild(div);
      });
    });
  }
}

function getAccountFormPermissionRowsForSubmit(): { userId: string; permissionType: string }[] {
  return accountFormPermissionRows
    .filter((r) => r.userId.trim() !== "")
    .map((r) => ({ userId: r.userId.trim(), permissionType: r.permissionType || "view" }));
}

function saveAccountFormFromModal(): void {
  const formName = document.getElementById("account-form-name") as HTMLInputElement;
  if (!formName) return;
  const name = formName.value.trim();
  if (!name) {
    formName.focus();
    return;
  }
  const now = nowStr();
  const userId = currentUserId || "1";
  const maxId = accountListFull.reduce(
    (m, r) => Math.max(m, parseInt(r.ID, 10) || 0),
    0
  );
  const newAccountId = String(maxId + 1);
  const userRows = currentUserId ? accountListFull.filter((r) => r.USER_ID === currentUserId) : accountListFull;
  const maxOrder = userRows.reduce(
    (m, r) => Math.max(m, Number(r.SORT_ORDER ?? 0) || 0),
    -1
  );
  const formColor = (document.getElementById("account-form-color") as HTMLInputElement)?.value?.trim() || "";
  const formIconPath = (document.getElementById("account-form-icon-path") as HTMLInputElement)?.value?.trim() || "";
  accountListFull.push({
    ID: newAccountId,
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
  const permissionRows = getAccountFormPermissionRowsForSubmit();
  if (permissionRows.length > 0) {
    const existing = getAccountPermissionRows();
    const maxPermId = existing.reduce(
      (m, r) => Math.max(m, parseInt(r.ID, 10) || 0),
      0
    );
    const newPermissions: AccountPermissionRow[] = permissionRows.map((row, i) => ({
      ID: String(maxPermId + 1 + i),
      REGIST_DATETIME: now,
      REGIST_USER: userId,
      UPDATE_DATETIME: now,
      UPDATE_USER: userId,
      ACCOUNT_ID: newAccountId,
      USER_ID: row.userId,
      PERMISSION_TYPE: row.permissionType || "view",
    }));
    const merged = [...existing, ...newPermissions];
    setAccountPermissionListFull(merged);
  }
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

// ---------------------------------------------------------------------------
// 初期化（イベント登録）
// ---------------------------------------------------------------------------

export function initAccountView(): void {
  registerViewHandler("account", loadAndRenderAccountList);

  document.getElementById("header-add-btn")?.addEventListener("click", () => {
    if (currentView === "account") openAccountModal();
  });
  document.getElementById("header-delete-btn")?.addEventListener("click", () => {
    if (currentView === "account") handleToggleDeleteMode();
  });
  document.getElementById("account-form-cancel")?.addEventListener("click", closeAccountModal);
  document.getElementById("account-form-permission-add")?.addEventListener("click", () => openAccountFormUserPicker());
  document.getElementById("account-form-user-picker-apply")?.addEventListener("click", applyAccountFormUserPicker);
  document.getElementById("account-form-user-picker-overlay")?.addEventListener("click", (e) => {
    if (e.target instanceof HTMLElement && e.target.id === "account-form-user-picker-overlay") closeAccountFormUserPicker();
  });
  document.getElementById("account-permission-users-add")?.addEventListener("click", () => {
    if (accountPermissionEditTargetId) {
      accountPermissionAddTargetId = accountPermissionEditTargetId;
      openAccountFormUserPicker(accountPermissionEditTargetId);
    }
  });
  document.getElementById("account-permission-users-close")?.addEventListener("click", closeAccountPermissionUsersModal);
  document.getElementById("account-permission-users-overlay")?.addEventListener("click", (e) => {
    if (e.target instanceof HTMLElement && e.target.id === "account-permission-users-overlay") closeAccountPermissionUsersModal();
  });
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
