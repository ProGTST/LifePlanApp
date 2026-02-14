import type { TransactionRow, CategoryRow, AccountRow, TagManagementRow } from "../types";
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

let categoryRows: CategoryRow[] = [];
let accountRows: AccountRow[] = [];

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

async function fetchTransactionList(): Promise<TransactionRow[]> {
  const { header, rows } = await fetchCsv("/data/TRANSACTION.csv");
  if (header.length === 0) return [];
  const list: TransactionRow[] = [];
  for (const cells of rows) {
    const row = rowToObject(header, cells) as unknown as TransactionRow;
    if (row.REGIST_USER === currentUserId) list.push(row);
  }
  return list;
}

async function fetchCategoryList(): Promise<CategoryRow[]> {
  const { header, rows } = await fetchCsv("/data/CATEGORY.csv");
  if (header.length === 0) return [];
  const list: CategoryRow[] = [];
  for (const cells of rows) {
    list.push(rowToObject(header, cells) as unknown as CategoryRow);
  }
  return list;
}

async function fetchAccountList(): Promise<AccountRow[]> {
  const { header, rows } = await fetchCsv("/data/ACCOUNT.csv");
  if (header.length === 0) return [];
  const list: AccountRow[] = [];
  for (const cells of rows) {
    list.push(rowToObject(header, cells) as unknown as AccountRow);
  }
  return list;
}

async function fetchTagManagementList(): Promise<TagManagementRow[]> {
  const { header, rows } = await fetchCsv("/data/TAG_MANAGEMENT.csv");
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

function applyFilters(rows: TransactionRow[]): TransactionRow[] {
  return rows.filter((row) => {
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
    tdName.textContent = row.NAME || "—";
    const tdAccount = document.createElement("td");
    tdAccount.className = "transaction-history-account-cell";
    const type = row.TYPE as "income" | "expense" | "transfer";
    if (type === "income" && row.ACCOUNT_ID_IN) {
      const acc = getAccountById(row.ACCOUNT_ID_IN);
      if (acc) {
        const wrap = document.createElement("div");
        wrap.className = "transaction-history-account-wrap";
        wrap.appendChild(
          renderIconWrap(acc.COLOR || ICON_DEFAULT_COLOR, acc.ICON_PATH, "category-icon-wrap")
        );
        const nameSpan = document.createElement("span");
        nameSpan.className = "transaction-history-account-name";
        nameSpan.textContent = acc.ACCOUNT_NAME || "—";
        wrap.appendChild(nameSpan);
        tdAccount.appendChild(wrap);
      }
    } else if (type === "expense" && row.ACCOUNT_ID_OUT) {
      const acc = getAccountById(row.ACCOUNT_ID_OUT);
      if (acc) {
        const wrap = document.createElement("div");
        wrap.className = "transaction-history-account-wrap";
        wrap.appendChild(
          renderIconWrap(acc.COLOR || ICON_DEFAULT_COLOR, acc.ICON_PATH, "category-icon-wrap")
        );
        const nameSpan = document.createElement("span");
        nameSpan.className = "transaction-history-account-name";
        nameSpan.textContent = acc.ACCOUNT_NAME || "—";
        wrap.appendChild(nameSpan);
        tdAccount.appendChild(wrap);
      }
    } else if (type === "transfer" && (row.ACCOUNT_ID_IN || row.ACCOUNT_ID_OUT)) {
      const span = document.createElement("span");
      span.className = "transaction-history-transfer-icons";
      const accIn = row.ACCOUNT_ID_IN ? getAccountById(row.ACCOUNT_ID_IN) : null;
      const accOut = row.ACCOUNT_ID_OUT ? getAccountById(row.ACCOUNT_ID_OUT) : null;
      if (accIn) {
        const wrapIn = document.createElement("span");
        wrapIn.className = "transaction-history-account-wrap";
        wrapIn.appendChild(
          renderIconWrap(accIn.COLOR || ICON_DEFAULT_COLOR, accIn.ICON_PATH, "category-icon-wrap")
        );
        const nameIn = document.createElement("span");
        nameIn.className = "transaction-history-account-name";
        nameIn.textContent = accIn.ACCOUNT_NAME || "—";
        wrapIn.appendChild(nameIn);
        span.appendChild(wrapIn);
      }
      const arrow = document.createElement("span");
      arrow.className = "transaction-history-transfer-arrow";
      arrow.textContent = "▶";
      span.appendChild(arrow);
      if (accOut) {
        const wrapOut = document.createElement("span");
        wrapOut.className = "transaction-history-account-wrap";
        wrapOut.appendChild(
          renderIconWrap(accOut.COLOR || ICON_DEFAULT_COLOR, accOut.ICON_PATH, "category-icon-wrap")
        );
        const nameOut = document.createElement("span");
        nameOut.className = "transaction-history-account-name";
        nameOut.textContent = accOut.ACCOUNT_NAME || "—";
        wrapOut.appendChild(nameOut);
        span.appendChild(wrapOut);
      }
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

function loadAndShow(): void {
  syncFilterButtons();
  updateChosenDisplays();
  Promise.all([
    fetchTransactionList(),
    fetchCategoryList(),
    fetchAccountList(),
    fetchTagManagementList(),
  ]).then(([txList, catList, accList, tagMgmt]) => {
    setTransactionList(txList);
    categoryRows = catList;
    accountRows = accList;
    setTagManagementList(tagMgmt);
    renderList();
  });
}

export function initTransactionHistoryView(): void {
  registerViewHandler("transaction-history", loadAndShow);

  document.getElementById("transaction-history-refresh-btn")?.addEventListener("click", () => {
    loadAndShow();
  });

  document.querySelectorAll(".transaction-history-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = (btn as HTMLButtonElement).dataset.tab;
      if (tab) switchTab(tab);
    });
  });

  const dateFrom = document.getElementById("transaction-history-date-from") as HTMLInputElement;
  const dateTo = document.getElementById("transaction-history-date-to") as HTMLInputElement;
  dateFrom?.addEventListener("change", () => {
    filterDateFrom = dateFrom.value || "";
    renderList();
  });
  dateTo?.addEventListener("change", () => {
    filterDateTo = dateTo.value || "";
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
}
