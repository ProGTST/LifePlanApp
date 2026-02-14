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

/** カテゴリー・タグ・勘定項目の選択表示欄を更新する（未選択時は「未選択」） */
function updateChosenDisplays(): void {
  const categoryEl = document.getElementById("transaction-history-category-display");
  const tagEl = document.getElementById("transaction-history-tag-display");
  const accountEl = document.getElementById("transaction-history-account-display");
  if (categoryEl) categoryEl.textContent = filterCategoryIds.length === 0 ? "未選択" : `${filterCategoryIds.length}件選択`;
  if (tagEl) tagEl.textContent = filterTagIds.length === 0 ? "未選択" : `${filterTagIds.length}件選択`;
  if (accountEl) accountEl.textContent = filterAccountIds.length === 0 ? "未選択" : `${filterAccountIds.length}件選択`;
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
  const checked = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked');
  return Array.from(checked)
    .map((el) => el.dataset.id)
    .filter((id): id is string => id != null);
}

function openCategorySelectModal(): void {
  const listEl = document.getElementById("transaction-history-category-select-list");
  if (!listEl) return;
  listEl.innerHTML = "";
  const sorted = categoryRows.slice().sort((a, b) => (a.SORT_ORDER || "").localeCompare(b.SORT_ORDER || ""));
  for (const row of sorted) {
    const label = document.createElement("label");
    label.className = "transaction-history-select-item";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.dataset.id = row.ID;
    cb.checked = filterCategoryIds.includes(row.ID);
    label.appendChild(cb);
    const iconWrap = renderIconWrap(row.COLOR || ICON_DEFAULT_COLOR, row.ICON_PATH, "category-icon-wrap");
    label.appendChild(iconWrap);
    const nameSpan = document.createElement("span");
    nameSpan.textContent = row.CATEGORY_NAME || "—";
    label.appendChild(nameSpan);
    listEl.appendChild(label);
  }
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
    const label = document.createElement("label");
    label.className = "transaction-history-select-item";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.dataset.id = row.ID;
    cb.checked = filterTagIds.includes(row.ID);
    label.appendChild(cb);
    const iconWrap = renderIconWrap(row.COLOR || ICON_DEFAULT_COLOR, row.ICON_PATH, "category-icon-wrap");
    label.appendChild(iconWrap);
    const nameSpan = document.createElement("span");
    nameSpan.textContent = row.TAG_NAME || "—";
    label.appendChild(nameSpan);
    listEl.appendChild(label);
  }
  const overlay = document.getElementById("transaction-history-tag-select-overlay");
  if (overlay) {
    overlay.classList.add("is-visible");
    overlay.setAttribute("aria-hidden", "false");
  }
}

function openAccountSelectModal(): void {
  const listEl = document.getElementById("transaction-history-account-select-list");
  if (!listEl) return;
  listEl.innerHTML = "";
  const sorted = accountRows.slice().sort((a, b) => (a.SORT_ORDER || "").localeCompare(b.SORT_ORDER || ""));
  for (const row of sorted) {
    const label = document.createElement("label");
    label.className = "transaction-history-select-item";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.dataset.id = row.ID;
    cb.checked = filterAccountIds.includes(row.ID);
    label.appendChild(cb);
    const iconWrap = renderIconWrap(row.COLOR || ICON_DEFAULT_COLOR, row.ICON_PATH, "category-icon-wrap");
    label.appendChild(iconWrap);
    const nameSpan = document.createElement("span");
    nameSpan.textContent = row.ACCOUNT_NAME || "—";
    label.appendChild(nameSpan);
    listEl.appendChild(label);
  }
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

  document.getElementById("transaction-history-category-select-clear")?.addEventListener("click", () => {
    document.querySelectorAll("#transaction-history-category-select-list input[type='checkbox']").forEach((el) => {
      (el as HTMLInputElement).checked = false;
    });
  });
  document.getElementById("transaction-history-category-select-apply")?.addEventListener("click", () => {
    filterCategoryIds = getSelectedIdsFromList("transaction-history-category-select-list");
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
    document.querySelectorAll("#transaction-history-tag-select-list input[type='checkbox']").forEach((el) => {
      (el as HTMLInputElement).checked = false;
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

  document.getElementById("transaction-history-account-select-clear")?.addEventListener("click", () => {
    document.querySelectorAll("#transaction-history-account-select-list input[type='checkbox']").forEach((el) => {
      (el as HTMLInputElement).checked = false;
    });
  });
  document.getElementById("transaction-history-account-select-apply")?.addEventListener("click", () => {
    filterAccountIds = getSelectedIdsFromList("transaction-history-account-select-list");
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
