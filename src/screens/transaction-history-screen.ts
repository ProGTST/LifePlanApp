import type {
  TransactionRow,
  CategoryRow,
  AccountRow,
  AccountPermissionRow,
  TagRow,
  TagManagementRow,
} from "../types";
import {
  currentUserId,
  transactionList,
  setTransactionList,
  tagManagementList,
  setTagManagementList,
} from "../state";
import { fetchCsv, rowToObject } from "../utils/csv";
import { registerViewHandler } from "../app/screen";
import { ICON_DEFAULT_COLOR } from "../constants/colorPresets";

// ---------------------------------------------------------------------------
// 定数・状態
// ---------------------------------------------------------------------------

const CSV_NO_CACHE: RequestInit = { cache: "reload" };

let categoryRows: CategoryRow[] = [];
let tagRows: TagRow[] = [];
let accountRows: AccountRow[] = [];
let permissionRows: AccountPermissionRow[] = [];

let filterStatus: ("plan" | "actual")[] = ["plan", "actual"];
let filterType: ("income" | "expense" | "transfer")[] = ["income", "expense", "transfer"];
let filterCategoryIds: string[] = [];
let filterTagIds: string[] = [];
let filterAccountIds: string[] = [];
let filterDateFrom = "";
let filterDateTo = "";
let filterAmountMin = "";
let filterAmountMax = "";
let filterFreeText = "";

// ---------------------------------------------------------------------------
// データ取得
// ---------------------------------------------------------------------------

async function fetchTransactionList(noCache = false): Promise<TransactionRow[]> {
  const init = noCache ? CSV_NO_CACHE : undefined;
  const { header, rows } = await fetchCsv("/data/TRANSACTION.csv", init);
  if (header.length === 0) return [];
  const list: TransactionRow[] = [];
  for (const cells of rows) {
    const row = rowToObject(header, cells) as unknown as TransactionRow;
    list.push(row);
  }
  return list;
}

async function fetchAccountPermissionList(noCache = false): Promise<AccountPermissionRow[]> {
  const init = noCache ? CSV_NO_CACHE : undefined;
  const { header, rows } = await fetchCsv("/data/ACCOUNT_PERMISSION.csv", init);
  if (header.length === 0) return [];
  const list: AccountPermissionRow[] = [];
  for (const cells of rows) {
    if (cells.length === 0 || cells.every((c) => !c.trim())) continue;
    list.push(rowToObject(header, cells) as unknown as AccountPermissionRow);
  }
  return list;
}

/** ログインユーザーが参照できる勘定ID（自分の勘定 + 権限付与された勘定） */
function getVisibleAccountIds(
  accountRows: AccountRow[],
  permissionRows: AccountPermissionRow[]
): Set<string> {
  const ids = new Set<string>();
  const me = currentUserId;
  if (!me) return ids;
  accountRows.filter((a) => a.USER_ID === me).forEach((a) => ids.add(a.ID));
  permissionRows.filter((p) => p.USER_ID === me).forEach((p) => ids.add(p.ACCOUNT_ID));
  return ids;
}

/** 表示対象の取引のみに絞る（参照可能な勘定に紐づくもの） */
function filterTransactionsByVisibleAccounts(
  txList: TransactionRow[],
  visibleAccountIds: Set<string>
): TransactionRow[] {
  return txList.filter((row) => {
    const inId = (row.ACCOUNT_ID_IN || "").trim();
    const outId = (row.ACCOUNT_ID_OUT || "").trim();
    return (inId && visibleAccountIds.has(inId)) || (outId && visibleAccountIds.has(outId));
  });
}

async function fetchCategoryList(noCache = false): Promise<CategoryRow[]> {
  const init = noCache ? CSV_NO_CACHE : undefined;
  const { header, rows } = await fetchCsv("/data/CATEGORY.csv", init);
  if (header.length === 0) return [];
  const list: CategoryRow[] = [];
  for (const cells of rows) {
    list.push(rowToObject(header, cells) as unknown as CategoryRow);
  }
  return list;
}

async function fetchAccountList(noCache = false): Promise<AccountRow[]> {
  const init = noCache ? CSV_NO_CACHE : undefined;
  const { header, rows } = await fetchCsv("/data/ACCOUNT.csv", init);
  if (header.length === 0) return [];
  const list: AccountRow[] = [];
  for (const cells of rows) {
    list.push(rowToObject(header, cells) as unknown as AccountRow);
  }
  return list;
}

async function fetchTagList(noCache = false): Promise<TagRow[]> {
  const init = noCache ? CSV_NO_CACHE : undefined;
  const { header, rows } = await fetchCsv("/data/TAG.csv", init);
  if (header.length === 0) return [];
  const list: TagRow[] = [];
  for (const cells of rows) {
    const row = rowToObject(header, cells) as unknown as TagRow;
    if (row.SORT_ORDER === undefined || row.SORT_ORDER === "") row.SORT_ORDER = String(list.length);
    list.push(row);
  }
  return list;
}

async function fetchTagManagementList(noCache = false): Promise<TagManagementRow[]> {
  const init = noCache ? CSV_NO_CACHE : undefined;
  const { header, rows } = await fetchCsv("/data/TAG_MANAGEMENT.csv", init);
  if (header.length === 0) return [];
  const list: TagManagementRow[] = [];
  for (const cells of rows) {
    list.push(rowToObject(header, cells) as unknown as TagManagementRow);
  }
  return list;
}

function getCategoryById(id: string): CategoryRow | undefined {
  return categoryRows.find((c) => c.ID === id);
}

function getAccountById(id: string): AccountRow | undefined {
  return accountRows.find((a) => a.ID === id);
}

/** 取引に紐づくタグの一覧（TAG_MANAGEMENT と TAG から取得） */
function getTagsForTransaction(transactionId: string): TagRow[] {
  const tagIds = tagManagementList
    .filter((t) => t.TRANSACTION_ID === transactionId)
    .map((t) => t.TAG_ID);
  return tagIds
    .map((id) => tagRows.find((r) => r.ID === id))
    .filter((r): r is TagRow => !!r);
}

// ---------------------------------------------------------------------------
// DOM ヘルパー・フィルタ・一覧描画
// ---------------------------------------------------------------------------

function renderIconWrap(color: string, iconPath: string | undefined, className: string): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = className;
  wrap.style.backgroundColor = color || ICON_DEFAULT_COLOR;
  if (iconPath?.trim()) {
    wrap.classList.add("category-icon-wrap--img");
    wrap.style.webkitMaskImage = `url(${iconPath.trim()})`;
    wrap.style.maskImage = `url(${iconPath.trim()})`;
  }
  wrap.setAttribute("aria-hidden", "true");
  return wrap;
}

/** 勘定のアイコン+名前を指定要素に追加する（一覧の勘定セル用） */
function appendAccountWrap(
  parent: HTMLElement,
  acc: AccountRow,
  tag: "div" | "span" = "div"
): void {
  const wrap = document.createElement(tag);
  wrap.className = "transaction-history-account-wrap";
  wrap.appendChild(
    renderIconWrap(acc.COLOR || ICON_DEFAULT_COLOR, acc.ICON_PATH, "category-icon-wrap")
  );
  const nameSpan = document.createElement("span");
  nameSpan.className = "transaction-history-account-name";
  nameSpan.textContent = acc.ACCOUNT_NAME || "—";
  wrap.appendChild(nameSpan);
  parent.appendChild(wrap);
}

function applyFilters(rows: TransactionRow[]): TransactionRow[] {
  const filtered = rows.filter((row) => {
    if (filterStatus.length > 0 && !filterStatus.includes(row.STATUS as "plan" | "actual")) return false;
    if (filterType.length > 0 && !filterType.includes(row.TYPE as "income" | "expense" | "transfer")) return false;
    const date = row.ACTUAL_DATE || "";
    if (filterDateFrom && date < filterDateFrom) return false;
    if (filterDateTo && date > filterDateTo) return false;
    if (filterCategoryIds.length > 0 && !filterCategoryIds.includes(row.CATEGORY_ID)) return false;
    const amount = Number(row.AMOUNT) || 0;
    if (filterAmountMin !== "" && !isNaN(Number(filterAmountMin)) && amount < Number(filterAmountMin)) return false;
    if (filterAmountMax !== "" && !isNaN(Number(filterAmountMax)) && amount > Number(filterAmountMax)) return false;
    if (filterFreeText.trim()) {
      const q = filterFreeText.trim().toLowerCase();
      const name = (row.NAME || "").toLowerCase();
      const memo = (row.MEMO || "").toLowerCase();
      if (!name.includes(q) && !memo.includes(q)) return false;
    }
    if (filterTagIds.length > 0) {
      const tagIds = tagManagementList.filter((t) => t.TRANSACTION_ID === row.ID).map((t) => t.TAG_ID);
      if (!filterTagIds.some((id) => tagIds.includes(id))) return false;
    }
    if (filterAccountIds.length > 0) {
      const inMatch = row.ACCOUNT_ID_IN && filterAccountIds.includes(row.ACCOUNT_ID_IN);
      const outMatch = row.ACCOUNT_ID_OUT && filterAccountIds.includes(row.ACCOUNT_ID_OUT);
      if (!inMatch && !outMatch) return false;
    }
    return true;
  });
  return filtered.slice().sort((a, b) => {
    const ad = a.ACTUAL_DATE || "";
    const bd = b.ACTUAL_DATE || "";
    const cmpDate = bd.localeCompare(ad);
    if (cmpDate !== 0) return cmpDate;
    const apt = a.PLAN_DATE_TO || "";
    const bpt = b.PLAN_DATE_TO || "";
    const cmpPlan = apt.localeCompare(bpt);
    if (cmpPlan !== 0) return cmpPlan;
    const ar = a.REGIST_DATETIME || "";
    const br = b.REGIST_DATETIME || "";
    return ar.localeCompare(br);
  });
}

/** 取引が権限付与された勘定に紐づく場合、その権限種別（参照→薄黄、編集→薄緑の行背景に利用） */
function getRowPermissionType(row: TransactionRow): "view" | "edit" | null {
  const me = currentUserId;
  if (!me) return null;
  const inId = (row.ACCOUNT_ID_IN || "").trim();
  const outId = (row.ACCOUNT_ID_OUT || "").trim();
  let hasEdit = false;
  let hasView = false;
  for (const accountId of [inId, outId]) {
    if (!accountId) continue;
    const isOwn = accountRows.some((a) => a.ID === accountId && a.USER_ID === me);
    if (isOwn) continue;
    const perm = permissionRows.find((p) => p.ACCOUNT_ID === accountId && p.USER_ID === me);
    if (perm?.PERMISSION_TYPE === "edit") hasEdit = true;
    else if (perm?.PERMISSION_TYPE === "view") hasView = true;
  }
  if (hasEdit) return "edit";
  if (hasView) return "view";
  return null;
}

/** 予定データで予定終了日が今日より過去か（日付のみで比較しタイムゾーンに左右されない） */
function isPlanDateToPast(row: TransactionRow): boolean {
  if (row.STATUS !== "plan" || !row.PLAN_DATE_TO?.trim()) return false;
  const s = row.PLAN_DATE_TO.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return false;
  const planY = parseInt(m[1], 10);
  const planM = parseInt(m[2], 10);
  const planD = parseInt(m[3], 10);
  const now = new Date();
  const todayY = now.getFullYear();
  const todayM = now.getMonth() + 1;
  const todayD = now.getDate();
  if (planY !== todayY) return planY < todayY;
  if (planM !== todayM) return planM < todayM;
  return planD < todayD;
}

function renderList(): void {
  const tbody = document.getElementById("transaction-history-tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  const filtered = applyFilters(transactionList);
  filtered.forEach((row) => {
    const tr = document.createElement("tr");
    if (isPlanDateToPast(row)) tr.classList.add("transaction-history-row--past-plan");
    const permType = getRowPermissionType(row);
    if (permType === "view") tr.classList.add("transaction-history-row--permission-view");
    else if (permType === "edit") tr.classList.add("transaction-history-row--permission-edit");
    const tdDate = document.createElement("td");
    tdDate.textContent = row.ACTUAL_DATE || "—";
    const cat = getCategoryById(row.CATEGORY_ID);
    const tdCat = document.createElement("td");
    const catWrap = document.createElement("div");
    catWrap.className = "transaction-history-category-cell";
    if (cat) {
      const iconWrap = renderIconWrap(cat.COLOR || ICON_DEFAULT_COLOR, cat.ICON_PATH, "category-icon-wrap");
      catWrap.appendChild(iconWrap);
      const nameSpan = document.createElement("span");
      nameSpan.className = "transaction-history-category-name";
      nameSpan.textContent = cat.CATEGORY_NAME || "—";
      catWrap.appendChild(nameSpan);
    } else {
      catWrap.textContent = "—";
    }
    tdCat.appendChild(catWrap);
    const tdData = document.createElement("td");
    const dataWrap = document.createElement("div");
    dataWrap.className = "transaction-history-data-cell";
    const amountRow = document.createElement("div");
    amountRow.className = "transaction-history-amount-row";
    const planIcon = document.createElement("span");
    planIcon.className = "transaction-history-plan-icon";
    planIcon.setAttribute("aria-label", row.STATUS === "actual" ? "実績" : "予定");
    planIcon.textContent = row.STATUS === "actual" ? "実" : "予";
    amountRow.appendChild(planIcon);
    const line1 = document.createElement("div");
    line1.className = "transaction-history-amount";
    line1.textContent = row.AMOUNT ? Number(row.AMOUNT).toLocaleString() : "—";
    amountRow.appendChild(line1);
    dataWrap.appendChild(amountRow);
    tdData.appendChild(dataWrap);
    const tdName = document.createElement("td");
    tdName.className = "transaction-history-name-cell";
    const nameWrap = document.createElement("div");
    nameWrap.className = "transaction-history-name-cell-inner";
    const typeIcon = document.createElement("span");
    typeIcon.className = "transaction-history-type-icon";
    const txType = (row.TYPE || "expense") as "income" | "expense" | "transfer";
    typeIcon.classList.add(`transaction-history-type-icon--${txType}`);
    typeIcon.setAttribute("aria-label", txType === "income" ? "収入" : txType === "expense" ? "支出" : "振替");
    typeIcon.textContent = txType === "income" ? "収" : txType === "expense" ? "支" : "振";
    nameWrap.appendChild(typeIcon);
    const nameText = document.createElement("span");
    nameText.className = "transaction-history-name-text";
    nameText.textContent = row.NAME || "—";
    nameWrap.appendChild(nameText);
    tdName.appendChild(nameWrap);
    const tdTags = document.createElement("td");
    tdTags.className = "transaction-history-tags-cell";
    const tags = getTagsForTransaction(row.ID);
    if (tags.length > 0) {
      const tagLabelWrap = document.createElement("span");
      tagLabelWrap.className = "transaction-history-tags-label-wrap";
      for (const tag of tags) {
        const wrap = document.createElement("span");
        wrap.className = "transaction-history-tag-label";
        const bg = (tag.COLOR || "").trim() || CHOSEN_LABEL_DEFAULT_BG;
        wrap.style.backgroundColor = bg;
        wrap.style.color = CHOSEN_LABEL_DEFAULT_FG;
        wrap.textContent = tag.TAG_NAME?.trim() || "—";
        tagLabelWrap.appendChild(wrap);
      }
      tdTags.appendChild(tagLabelWrap);
    } else {
      tdTags.textContent = "—";
    }
    const tdAccount = document.createElement("td");
    tdAccount.className = "transaction-history-account-cell";
    const type = row.TYPE as "income" | "expense" | "transfer";
    if (type === "income" && row.ACCOUNT_ID_IN) {
      const acc = getAccountById(row.ACCOUNT_ID_IN);
      if (acc) appendAccountWrap(tdAccount, acc, "div");
    } else if (type === "expense" && row.ACCOUNT_ID_OUT) {
      const acc = getAccountById(row.ACCOUNT_ID_OUT);
      if (acc) appendAccountWrap(tdAccount, acc, "div");
    } else if (type === "transfer" && (row.ACCOUNT_ID_IN || row.ACCOUNT_ID_OUT)) {
      const span = document.createElement("span");
      span.className = "transaction-history-transfer-icons";
      const accIn = row.ACCOUNT_ID_IN ? getAccountById(row.ACCOUNT_ID_IN) : null;
      const accOut = row.ACCOUNT_ID_OUT ? getAccountById(row.ACCOUNT_ID_OUT) : null;
      if (accIn) appendAccountWrap(span, accIn, "span");
      const arrow = document.createElement("span");
      arrow.className = "transaction-history-transfer-arrow";
      arrow.textContent = "▶";
      span.appendChild(arrow);
      if (accOut) appendAccountWrap(span, accOut, "span");
      tdAccount.appendChild(span);
    }
    const tdPlanDateTo = document.createElement("td");
    tdPlanDateTo.textContent =
      row.STATUS === "plan" ? (row.PLAN_DATE_TO || "—") : "—";
    tr.appendChild(tdDate);
    tr.appendChild(tdCat);
    tr.appendChild(tdData);
    tr.appendChild(tdName);
    tr.appendChild(tdTags);
    tr.appendChild(tdAccount);
    tr.appendChild(tdPlanDateTo);
    tbody.appendChild(tr);
  });
}

function switchTab(tabId: string): void {
  document.querySelectorAll(".transaction-history-tab").forEach((btn) => {
    const b = btn as HTMLButtonElement;
    b.classList.toggle("is-active", b.dataset.tab === tabId);
    b.setAttribute("aria-selected", b.dataset.tab === tabId ? "true" : "false");
  });
  document.querySelectorAll(".transaction-history-panel").forEach((panel) => {
    const isList = panel.id === "transaction-history-list-panel" && tabId === "list";
    const isWeekly = panel.id === "transaction-history-weekly-panel" && tabId === "weekly";
    const isCalendar = panel.id === "transaction-history-calendar-panel" && tabId === "calendar";
    (panel as HTMLElement).classList.toggle("transaction-history-panel--hidden", !isList && !isWeekly && !isCalendar);
  });
}

/** 計画・収支種別のフィルターボタンの表示を現在の選択状態に同期する */
function syncFilterButtons(): void {
  document.querySelectorAll(".transaction-history-filter-btn[data-status]").forEach((b) => {
    const s = (b as HTMLButtonElement).dataset.status as "plan" | "actual";
    b.classList.toggle("is-active", filterStatus.includes(s));
  });
  document.querySelectorAll(".transaction-history-filter-btn[data-type]").forEach((b) => {
    const t = (b as HTMLButtonElement).dataset.type as "income" | "expense" | "transfer";
    b.classList.toggle("is-active", filterType.includes(t));
  });
}

const CHOSEN_REMOVE_ICON = "/icon/circle-xmark-solid-full.svg";
const CHOSEN_LABEL_DEFAULT_BG = "#646cff";
const CHOSEN_LABEL_DEFAULT_FG = "#ffffff";

/** 選択表示欄にラベル要素を並べて表示する。onRemove を渡すと各ラベル横に削除アイコンを表示。getColor で項目の背景色を指定（未設定時はデフォルト色） */
function setChosenDisplayLabels(
  container: HTMLElement | null,
  ids: string[],
  getName: (id: string) => string | undefined,
  onRemove?: (id: string) => void,
  getColor?: (id: string) => string | undefined
): void {
  if (!container) return;
  container.textContent = "";
  if (ids.length === 0) {
    container.textContent = "未選択";
    return;
  }
  for (const id of ids) {
    const name = getName(id)?.trim() || "—";
    const wrap = document.createElement("span");
    wrap.className = "transaction-history-chosen-label-wrap";
    const bg = (getColor?.(id) ?? "").trim() || CHOSEN_LABEL_DEFAULT_BG;
    wrap.style.backgroundColor = bg;
    wrap.style.color = CHOSEN_LABEL_DEFAULT_FG;
    const label = document.createElement("span");
    label.className = "transaction-history-chosen-label";
    label.textContent = name;
    wrap.appendChild(label);
    if (onRemove) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "transaction-history-chosen-label-remove";
      btn.setAttribute("aria-label", "選択から削除");
      const img = document.createElement("img");
      img.src = CHOSEN_REMOVE_ICON;
      img.alt = "";
      btn.appendChild(img);
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        onRemove(id);
      });
      wrap.appendChild(btn);
    }
    container.appendChild(wrap);
  }
}

/** カテゴリー・タグ・勘定項目の選択表示欄を更新する（選択された項目名をラベルで表示、項目の COLOR を背景色に、削除アイコン付き） */
function updateChosenDisplays(): void {
  const categoryEl = document.getElementById("transaction-history-category-display");
  const tagEl = document.getElementById("transaction-history-tag-display");
  const accountEl = document.getElementById("transaction-history-account-display");
  setChosenDisplayLabels(
    categoryEl,
    filterCategoryIds,
    (id) => getCategoryById(id)?.CATEGORY_NAME,
    (id) => {
      filterCategoryIds = filterCategoryIds.filter((x) => x !== id);
      updateChosenDisplays();
      renderList();
    },
    (id) => getCategoryById(id)?.COLOR
  );
  setChosenDisplayLabels(
    tagEl,
    filterTagIds,
    (id) => tagRows.find((r) => r.ID === id)?.TAG_NAME,
    (id) => {
      filterTagIds = filterTagIds.filter((x) => x !== id);
      updateChosenDisplays();
      renderList();
    },
    (id) => tagRows.find((r) => r.ID === id)?.COLOR
  );
  setChosenDisplayLabels(
    accountEl,
    filterAccountIds,
    (id) => getAccountById(id)?.ACCOUNT_NAME,
    (id) => {
      filterAccountIds = filterAccountIds.filter((x) => x !== id);
      updateChosenDisplays();
      renderList();
    },
    (id) => getAccountById(id)?.COLOR
  );
}

function closeSelectModal(overlayId: string): void {
  const overlay = document.getElementById(overlayId);
  if (overlay) {
    overlay.classList.remove("is-visible");
    overlay.setAttribute("aria-hidden", "true");
  }
}

function getSelectedIdsFromList(listContainerId: string): string[] {
  const container = document.getElementById(listContainerId);
  if (!container) return [];
  const selected = container.querySelectorAll<HTMLElement>(".transaction-history-select-item .transaction-history-select-check-btn.is-selected");
  return Array.from(selected)
    .map((btn) => btn.closest(".transaction-history-select-item")?.getAttribute("data-id"))
    .filter((id): id is string => id != null);
}

function createSelectItemRow(
  id: string,
  name: string,
  color: string,
  iconPath: string,
  isSelected: boolean,
  onToggle?: (id: string, selected: boolean) => void
): HTMLElement {
  const row = document.createElement("div");
  row.className = "transaction-history-select-item";
  row.dataset.id = id;
  const checkBtn = document.createElement("button");
  checkBtn.type = "button";
  checkBtn.className = "transaction-history-select-check-btn";
  checkBtn.setAttribute("aria-label", "選択");
  checkBtn.setAttribute("aria-pressed", isSelected ? "true" : "false");
  if (isSelected) checkBtn.classList.add("is-selected");
  const checkIcon = document.createElement("span");
  checkIcon.className = "transaction-history-select-check-icon";
  checkIcon.setAttribute("aria-hidden", "true");
  checkBtn.appendChild(checkIcon);
  const handleToggle = (): void => {
    const pressed = checkBtn.getAttribute("aria-pressed") === "true";
    const next = !pressed;
    checkBtn.setAttribute("aria-pressed", String(next));
    checkBtn.classList.toggle("is-selected", next);
    onToggle?.(id, next);
  };
  checkBtn.addEventListener("click", (e) => {
    e.preventDefault();
    handleToggle();
  });
  const iconWrap = renderIconWrap(color, iconPath, "category-icon-wrap");
  const nameSpan = document.createElement("span");
  nameSpan.className = "transaction-history-select-item-name";
  nameSpan.textContent = name;
  nameSpan.addEventListener("click", () => handleToggle());
  row.appendChild(checkBtn);
  row.appendChild(iconWrap);
  row.appendChild(nameSpan);
  return row;
}

/** カテゴリー選択モーダルで選択中の収支種別 */
let categorySelectModalType: "income" | "expense" | "transfer" = "expense";

/** カテゴリー選択モーダル内の選択ID（タブ切替でも保持） */
let categorySelectModalSelectedIds = new Set<string>();

/** 収支種別に応じてカテゴリーを絞り込む */
function filterCategoriesByType(type: "income" | "expense" | "transfer"): CategoryRow[] {
  if (type === "income") return categoryRows.filter((c) => (c.TYPE || "").toLowerCase() === "income");
  if (type === "expense") return categoryRows.filter((c) => (c.TYPE || "").toLowerCase() === "expense");
  if (type === "transfer") return categoryRows.filter((c) => ["income", "expense"].includes((c.TYPE || "").toLowerCase()));
  return categoryRows;
}

/** カテゴリー選択モーダルの一覧を指定種別で描画する */
function renderCategorySelectList(type: "income" | "expense" | "transfer"): void {
  const listEl = document.getElementById("transaction-history-category-select-list");
  if (!listEl) return;
  listEl.innerHTML = "";
  const filtered = filterCategoriesByType(type);
  const sorted = filtered.slice().sort((a, b) => (a.SORT_ORDER || "").localeCompare(b.SORT_ORDER || ""));
  for (const row of sorted) {
    const item = createSelectItemRow(
      row.ID,
      row.CATEGORY_NAME || "—",
      row.COLOR || ICON_DEFAULT_COLOR,
      row.ICON_PATH || "",
      categorySelectModalSelectedIds.has(row.ID),
      (id, selected) => {
        if (selected) categorySelectModalSelectedIds.add(id);
        else categorySelectModalSelectedIds.delete(id);
      }
    );
    listEl.appendChild(item);
  }
}

function openCategorySelectModal(): void {
  categorySelectModalType = "expense";
  categorySelectModalSelectedIds = new Set(filterCategoryIds);
  const tabs = document.querySelectorAll(".transaction-history-category-select-tab");
  tabs.forEach((tab) => {
    const t = tab as HTMLElement;
    const isActive = (t.dataset.type ?? "expense") === categorySelectModalType;
    t.classList.toggle("is-active", isActive);
    t.setAttribute("aria-selected", String(isActive));
  });
  renderCategorySelectList(categorySelectModalType);
  const overlay = document.getElementById("transaction-history-category-select-overlay");
  if (overlay) {
    overlay.classList.add("is-visible");
    overlay.setAttribute("aria-hidden", "false");
  }
}

function openTagSelectModal(): void {
  const listEl = document.getElementById("transaction-history-tag-select-list");
  if (!listEl) return;
  listEl.innerHTML = "";
  const sorted = tagRows.slice().sort((a, b) => (a.SORT_ORDER || "").localeCompare(b.SORT_ORDER || ""));
  for (const row of sorted) {
    const item = createSelectItemRow(
      row.ID,
      row.TAG_NAME || "—",
      row.COLOR || ICON_DEFAULT_COLOR,
      row.ICON_PATH || "",
      filterTagIds.includes(row.ID)
    );
    listEl.appendChild(item);
  }
  const overlay = document.getElementById("transaction-history-tag-select-overlay");
  if (overlay) {
    overlay.classList.add("is-visible");
    overlay.setAttribute("aria-hidden", "false");
  }
}

/** 勘定項目選択モーダルで表示中のタブ（個人 or 共有） */
let accountSelectModalTab: "own" | "shared" = "own";

/** 勘定項目選択モーダル内の選択ID（タブ切替でも保持） */
let accountSelectModalSelectedIds = new Set<string>();

/** 自分の勘定一覧（USER_ID がログインユーザーと一致） */
function getOwnAccountRows(): AccountRow[] {
  const me = currentUserId;
  if (!me) return [];
  return accountRows
    .filter((a) => a.USER_ID === me)
    .sort((a, b) => (a.SORT_ORDER || "").localeCompare(b.SORT_ORDER || ""));
}

/** 参照可能な共有勘定一覧（他ユーザー所有で権限付与されているもの） */
function getSharedAccountRows(): AccountRow[] {
  const me = currentUserId;
  if (!me) return [];
  const sharedIds = new Set(permissionRows.filter((p) => p.USER_ID === me).map((p) => p.ACCOUNT_ID));
  return accountRows
    .filter((a) => a.USER_ID !== me && sharedIds.has(a.ID))
    .sort((a, b) => (a.SORT_ORDER || "").localeCompare(b.SORT_ORDER || ""));
}

/** 勘定項目選択モーダルの一覧を指定タブで描画する */
function renderAccountSelectList(tab: "own" | "shared"): void {
  const listEl = document.getElementById("transaction-history-account-select-list");
  if (!listEl) return;
  listEl.innerHTML = "";
  const rows = tab === "own" ? getOwnAccountRows() : getSharedAccountRows();
  for (const row of rows) {
    const item = createSelectItemRow(
      row.ID,
      row.ACCOUNT_NAME || "—",
      row.COLOR || ICON_DEFAULT_COLOR,
      row.ICON_PATH || "",
      accountSelectModalSelectedIds.has(row.ID),
      (id, selected) => {
        if (selected) accountSelectModalSelectedIds.add(id);
        else accountSelectModalSelectedIds.delete(id);
      }
    );
    listEl.appendChild(item);
  }
}

function openAccountSelectModal(): void {
  accountSelectModalTab = "own";
  accountSelectModalSelectedIds = new Set(filterAccountIds);
  const tabs = document.querySelectorAll(".transaction-history-account-select-tab");
  tabs.forEach((t) => {
    const el = t as HTMLElement;
    const isActive = (el.dataset.tab ?? "own") === accountSelectModalTab;
    el.classList.toggle("is-active", isActive);
    el.setAttribute("aria-selected", String(isActive));
  });
  renderAccountSelectList(accountSelectModalTab);
  const overlay = document.getElementById("transaction-history-account-select-overlay");
  if (overlay) {
    overlay.classList.add("is-visible");
    overlay.setAttribute("aria-hidden", "false");
  }
}

/** 日付を YYYY-MM-DD にフォーマット */
function formatDateYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * 収支履歴のデータを読み込んで表示する。
 * @param forceReloadFromCsv true のときはキャッシュを使わず CSV を再取得する（最新化ボタン用）
 */
function loadAndShow(forceReloadFromCsv = false): void {
  syncFilterButtons();
  updateChosenDisplays();
  const dateFromEl = document.getElementById("transaction-history-date-from") as HTMLInputElement | null;
  const dateToEl = document.getElementById("transaction-history-date-to") as HTMLInputElement | null;
  if (filterDateFrom === "" && filterDateTo === "") {
    const today = new Date();
    const fromDate = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
    const toDate = new Date(today.getFullYear(), today.getMonth() + 6, today.getDate());
    const fromStr = formatDateYMD(fromDate);
    const toStr = formatDateYMD(toDate);
    filterDateFrom = fromStr;
    filterDateTo = toStr;
    if (dateFromEl) dateFromEl.value = fromStr;
    if (dateToEl) dateToEl.value = toStr;
  }
  if (dateFromEl) dateFromEl.classList.toggle("is-empty", !dateFromEl.value);
  if (dateToEl) dateToEl.classList.toggle("is-empty", !dateToEl.value);
  Promise.all([
    fetchTransactionList(forceReloadFromCsv),
    fetchCategoryList(forceReloadFromCsv),
    fetchTagList(forceReloadFromCsv),
    fetchAccountList(forceReloadFromCsv),
    fetchAccountPermissionList(forceReloadFromCsv),
    fetchTagManagementList(forceReloadFromCsv),
  ]).then(([txList, catList, tagList, accList, permList, tagMgmt]) => {
    const visibleIds = getVisibleAccountIds(accList, permList);
    const filteredTx = filterTransactionsByVisibleAccounts(txList, visibleIds);
    setTransactionList(filteredTx);
    categoryRows = catList;
    tagRows = tagList;
    accountRows = accList;
    permissionRows = permList;
    setTagManagementList(tagMgmt);
    renderList();
  });
}

export function initTransactionHistoryView(): void {
  registerViewHandler("transaction-history", loadAndShow);

  document.getElementById("transaction-history-refresh-btn")?.addEventListener("click", () => {
    loadAndShow(true);
  });

  document.querySelectorAll(".transaction-history-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = (btn as HTMLButtonElement).dataset.tab;
      if (tab) switchTab(tab);
    });
  });

  function updateDateInputEmptyState(el: HTMLInputElement | null): void {
    if (!el) return;
    if (el.value) el.classList.remove("is-empty");
    else el.classList.add("is-empty");
  }

  const dateFrom = document.getElementById("transaction-history-date-from") as HTMLInputElement;
  const dateTo = document.getElementById("transaction-history-date-to") as HTMLInputElement;
  updateDateInputEmptyState(dateFrom);
  updateDateInputEmptyState(dateTo);
  dateFrom?.addEventListener("change", () => {
    filterDateFrom = dateFrom.value || "";
    updateDateInputEmptyState(dateFrom);
    renderList();
  });
  dateTo?.addEventListener("change", () => {
    filterDateTo = dateTo.value || "";
    updateDateInputEmptyState(dateTo);
    renderList();
  });

  document.querySelectorAll(".transaction-history-filter-btn[data-status]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const status = (btn as HTMLButtonElement).dataset.status as "plan" | "actual";
      if (filterStatus.includes(status)) {
        filterStatus = filterStatus.filter((s) => s !== status);
      } else {
        filterStatus = [...filterStatus, status];
      }
      if (filterStatus.length === 0) filterStatus = ["plan", "actual"];
      syncFilterButtons();
      renderList();
    });
  });

  document.querySelectorAll(".transaction-history-filter-btn[data-type]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const type = (btn as HTMLButtonElement).dataset.type as "income" | "expense" | "transfer";
      if (filterType.includes(type)) {
        filterType = filterType.filter((t) => t !== type);
      } else {
        filterType = [...filterType, type];
      }
      if (filterType.length === 0) filterType = ["income", "expense", "transfer"];
      syncFilterButtons();
      renderList();
    });
  });

  const amountMin = document.getElementById("transaction-history-amount-min") as HTMLInputElement;
  const amountMax = document.getElementById("transaction-history-amount-max") as HTMLInputElement;
  amountMin?.addEventListener("input", () => {
    filterAmountMin = amountMin.value.trim();
    renderList();
  });
  amountMax?.addEventListener("input", () => {
    filterAmountMax = amountMax.value.trim();
    renderList();
  });

  const freeText = document.getElementById("transaction-history-free-text") as HTMLInputElement;
  freeText?.addEventListener("input", () => {
    filterFreeText = freeText.value.trim();
    renderList();
  });

  document.getElementById("transaction-history-category-btn")?.addEventListener("click", openCategorySelectModal);
  document.getElementById("transaction-history-tag-btn")?.addEventListener("click", openTagSelectModal);
  document.getElementById("transaction-history-account-btn")?.addEventListener("click", openAccountSelectModal);

  document.querySelectorAll(".transaction-history-category-select-tab").forEach((tabEl) => {
    tabEl.addEventListener("click", () => {
      const type = (tabEl as HTMLElement).dataset.type as "income" | "expense" | "transfer" | undefined;
      if (!type) return;
      categorySelectModalType = type;
      document.querySelectorAll(".transaction-history-category-select-tab").forEach((t) => {
        const el = t as HTMLElement;
        const isActive = (el.dataset.type ?? "expense") === categorySelectModalType;
        el.classList.toggle("is-active", isActive);
        el.setAttribute("aria-selected", String(isActive));
      });
      renderCategorySelectList(categorySelectModalType);
    });
  });

  document.getElementById("transaction-history-category-select-clear")?.addEventListener("click", () => {
    categorySelectModalSelectedIds.clear();
    renderCategorySelectList(categorySelectModalType);
  });
  document.getElementById("transaction-history-category-select-apply")?.addEventListener("click", () => {
    filterCategoryIds = Array.from(categorySelectModalSelectedIds);
    updateChosenDisplays();
    renderList();
    closeSelectModal("transaction-history-category-select-overlay");
  });
  document.getElementById("transaction-history-category-select-overlay")?.addEventListener("click", (e) => {
    if (e.target instanceof HTMLElement && e.target.id === "transaction-history-category-select-overlay") {
      closeSelectModal("transaction-history-category-select-overlay");
    }
  });

  document.getElementById("transaction-history-tag-select-clear")?.addEventListener("click", () => {
    document.querySelectorAll("#transaction-history-tag-select-list .transaction-history-select-check-btn").forEach((el) => {
      el.classList.remove("is-selected");
      el.setAttribute("aria-pressed", "false");
    });
  });
  document.getElementById("transaction-history-tag-select-apply")?.addEventListener("click", () => {
    filterTagIds = getSelectedIdsFromList("transaction-history-tag-select-list");
    updateChosenDisplays();
    renderList();
    closeSelectModal("transaction-history-tag-select-overlay");
  });
  document.getElementById("transaction-history-tag-select-overlay")?.addEventListener("click", (e) => {
    if (e.target instanceof HTMLElement && e.target.id === "transaction-history-tag-select-overlay") {
      closeSelectModal("transaction-history-tag-select-overlay");
    }
  });

  document.querySelectorAll(".transaction-history-account-select-tab").forEach((tabEl) => {
    tabEl.addEventListener("click", () => {
      const tab = (tabEl as HTMLElement).dataset.tab as "own" | "shared" | undefined;
      if (!tab) return;
      accountSelectModalTab = tab;
      document.querySelectorAll(".transaction-history-account-select-tab").forEach((t) => {
        const el = t as HTMLElement;
        const isActive = (el.dataset.tab ?? "own") === accountSelectModalTab;
        el.classList.toggle("is-active", isActive);
        el.setAttribute("aria-selected", String(isActive));
      });
      renderAccountSelectList(accountSelectModalTab);
    });
  });

  document.getElementById("transaction-history-account-select-own-only")?.addEventListener("click", () => {
    const ownRows = getOwnAccountRows();
    accountSelectModalSelectedIds = new Set(ownRows.map((r) => r.ID));
    renderAccountSelectList(accountSelectModalTab);
  });
  document.getElementById("transaction-history-account-select-clear")?.addEventListener("click", () => {
    accountSelectModalSelectedIds.clear();
    renderAccountSelectList(accountSelectModalTab);
  });
  document.getElementById("transaction-history-account-select-apply")?.addEventListener("click", () => {
    filterAccountIds = Array.from(accountSelectModalSelectedIds);
    updateChosenDisplays();
    renderList();
    closeSelectModal("transaction-history-account-select-overlay");
  });
  document.getElementById("transaction-history-account-select-overlay")?.addEventListener("click", (e) => {
    if (e.target instanceof HTMLElement && e.target.id === "transaction-history-account-select-overlay") {
      closeSelectModal("transaction-history-account-select-overlay");
    }
  });
}
