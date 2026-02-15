import type { TransactionRow, CategoryRow, AccountRow, AccountPermissionRow, TagRow, TagManagementRow } from "../types";
import { currentUserId, transactionEntryEditId, setTransactionEntryEditId, transactionEntryViewOnly, pushNavigation } from "../state";
import { ICON_DEFAULT_COLOR } from "../constants/colorPresets";
import { fetchCsv, rowToObject } from "../utils/csv";
import { transactionListToCsv, tagManagementListToCsv } from "../utils/csvExport";
import { registerViewHandler, showMainView } from "../app/screen";

const CSV_NO_CACHE: RequestInit = { cache: "reload" };

let categoryRows: CategoryRow[] = [];
let accountRows: AccountRow[] = [];
let permissionRows: AccountPermissionRow[] = [];
let tagRows: TagRow[] = [];
let visibleAccountIds: Set<string> = new Set();
let selectedTagIds: Set<string> = new Set();
let editingTransactionId: string | null = null;

/** 連続モード（新規登録時のみ有効。ONだと保存後に画面遷移せず連続登録） */
let continuousMode = false;

function nowStr(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

function isTauri(): boolean {
  return typeof (window as unknown as { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__?.invoke === "function";
}

function getVisibleAccountIds(accounts: AccountRow[], permissions: AccountPermissionRow[]): Set<string> {
  const ids = new Set<string>();
  const me = currentUserId;
  if (!me) return ids;
  accounts.filter((a) => a.USER_ID === me).forEach((a) => ids.add(a.ID));
  permissions.filter((p) => p.USER_ID === me).forEach((p) => ids.add(p.ACCOUNT_ID));
  return ids;
}

async function fetchCategoryList(noCache = false): Promise<CategoryRow[]> {
  const init = noCache ? CSV_NO_CACHE : undefined;
  const { header, rows } = await fetchCsv("/data/CATEGORY.csv", init);
  if (header.length === 0) return [];
  return rows.map((cells) => rowToObject(header, cells) as unknown as CategoryRow);
}

async function fetchAccountList(noCache = false): Promise<AccountRow[]> {
  const init = noCache ? CSV_NO_CACHE : undefined;
  const { header, rows } = await fetchCsv("/data/ACCOUNT.csv", init);
  if (header.length === 0) return [];
  return rows.map((cells) => rowToObject(header, cells) as unknown as AccountRow);
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

async function fetchTransactionRows(noCache = false): Promise<{ nextId: number; rows: TransactionRow[] }> {
  const init = noCache ? CSV_NO_CACHE : undefined;
  const { header, rows } = await fetchCsv("/data/TRANSACTION.csv", init);
  const list: TransactionRow[] = [];
  let maxId = 0;
  for (const cells of rows) {
    const row = rowToObject(header, cells) as unknown as TransactionRow;
    const n = parseInt(row.ID ?? "0", 10);
    if (!Number.isNaN(n) && n > maxId) maxId = n;
    list.push(row);
  }
  return { nextId: maxId + 1, rows: list };
}

async function fetchTagList(noCache = false): Promise<TagRow[]> {
  const init = noCache ? CSV_NO_CACHE : undefined;
  const { header, rows } = await fetchCsv("/data/TAG.csv", init);
  if (header.length === 0) return [];
  const list: TagRow[] = [];
  for (const cells of rows) {
    if (cells.length === 0 || cells.every((c) => !c.trim())) continue;
    list.push(rowToObject(header, cells) as unknown as TagRow);
  }
  return list;
}

async function fetchTagManagementRows(noCache = false): Promise<{ nextId: number; rows: TagManagementRow[] }> {
  const init = noCache ? CSV_NO_CACHE : undefined;
  const { header, rows } = await fetchCsv("/data/TAG_MANAGEMENT.csv", init);
  const list: TagManagementRow[] = [];
  let maxId = 0;
  for (const cells of rows) {
    if (cells.length === 0 || cells.every((c) => !c.trim())) continue;
    const row = rowToObject(header, cells) as unknown as TagManagementRow;
    const n = parseInt(row.ID ?? "0", 10);
    if (!Number.isNaN(n) && n > maxId) maxId = n;
    list.push(row);
  }
  return { nextId: maxId + 1, rows: list };
}

function getCategoryValueEl(): HTMLInputElement | null {
  return document.getElementById("transaction-entry-category") as HTMLInputElement | null;
}

function renderCategoryIconWrap(color: string, iconPath: string | undefined, tag: "div" | "span" = "div"): HTMLDivElement | HTMLSpanElement {
  const wrap = document.createElement(tag);
  wrap.className = "category-icon-wrap";
  wrap.style.backgroundColor = color || ICON_DEFAULT_COLOR;
  if (iconPath?.trim()) {
    wrap.classList.add("category-icon-wrap--img");
    wrap.style.webkitMaskImage = `url(${iconPath.trim()})`;
    wrap.style.maskImage = `url(${iconPath.trim()})`;
  }
  wrap.setAttribute("aria-hidden", "true");
  return wrap as HTMLDivElement | HTMLSpanElement;
}

function getAccountInValueEl(): HTMLInputElement | null {
  return document.getElementById("transaction-entry-account-in") as HTMLInputElement | null;
}

function getAccountOutValueEl(): HTMLInputElement | null {
  return document.getElementById("transaction-entry-account-out") as HTMLInputElement | null;
}

function getAccountById(id: string): AccountRow | undefined {
  return accountRows.find((a) => a.ID === id);
}

function updateAccountTriggerDisplay(which: "out" | "in", accountId: string): void {
  const prefix = which === "out" ? "transaction-entry-account-out" : "transaction-entry-account-in";
  const triggerIcon = document.querySelector(`#${prefix}-trigger .transaction-entry-account-trigger-icon`);
  const triggerText = document.querySelector(`#${prefix}-trigger .transaction-entry-account-trigger-text`);
  if (!triggerIcon || !triggerText) return;
  if (!accountId) {
    (triggerIcon as HTMLElement).innerHTML = "";
    (triggerIcon as HTMLElement).style.display = "none";
    triggerText.textContent = "—";
    return;
  }
  const acc = getAccountById(accountId);
  if (!acc) {
    triggerText.textContent = "—";
    (triggerIcon as HTMLElement).style.display = "none";
    return;
  }
  (triggerIcon as HTMLElement).innerHTML = "";
  (triggerIcon as HTMLElement).style.display = "";
  const iconWrap = renderCategoryIconWrap(acc.COLOR || ICON_DEFAULT_COLOR, acc.ICON_PATH, "span");
  (triggerIcon as HTMLElement).appendChild(iconWrap);
  triggerText.textContent = (acc.ACCOUNT_NAME || "").trim() || "—";
}

function closeAccountList(which: "out" | "in"): void {
  const prefix = which === "out" ? "transaction-entry-account-out" : "transaction-entry-account-in";
  const list = document.getElementById(`${prefix}-list`);
  const trigger = document.getElementById(`${prefix}-trigger`);
  if (list) {
    list.classList.remove("is-open");
    list.setAttribute("aria-hidden", "true");
  }
  if (trigger) trigger.setAttribute("aria-expanded", "false");
}

function filterCategoriesByType(type: string): CategoryRow[] {
  const t = (type || "").toLowerCase();
  if (t === "income") return categoryRows.filter((c) => (c.TYPE || "").toLowerCase() === "income");
  if (t === "expense") return categoryRows.filter((c) => (c.TYPE || "").toLowerCase() === "expense");
  if (t === "transfer") return categoryRows.filter((c) => (c.TYPE || "").toLowerCase() === "transfer");
  return categoryRows;
}

function getCategoryById(id: string): CategoryRow | undefined {
  return categoryRows.find((c) => c.ID === id);
}

function updateCategoryTriggerDisplay(categoryId: string): void {
  const triggerIcon = document.querySelector(".transaction-entry-category-trigger-icon");
  const triggerText = document.querySelector(".transaction-entry-category-trigger-text");
  if (!triggerIcon || !triggerText) return;
  if (!categoryId) {
    (triggerIcon as HTMLElement).innerHTML = "";
    (triggerIcon as HTMLElement).style.display = "none";
    triggerText.textContent = "選択してください";
    return;
  }
  const cat = getCategoryById(categoryId);
  if (!cat) {
    triggerText.textContent = "選択してください";
    (triggerIcon as HTMLElement).style.display = "none";
    return;
  }
  (triggerIcon as HTMLElement).innerHTML = "";
  (triggerIcon as HTMLElement).style.display = "";
  const iconWrap = renderCategoryIconWrap(cat.COLOR || ICON_DEFAULT_COLOR, cat.ICON_PATH, "span");
  (triggerIcon as HTMLElement).appendChild(iconWrap);
  triggerText.textContent = (cat.CATEGORY_NAME || "").trim() || "—";
}

function closeCategoryList(): void {
  const list = document.getElementById("transaction-entry-category-list");
  const trigger = document.getElementById("transaction-entry-category-trigger");
  if (list) {
    list.classList.remove("is-open");
    list.setAttribute("aria-hidden", "true");
  }
  if (trigger) trigger.setAttribute("aria-expanded", "false");
}

function createTagSelectItemRow(id: string, name: string, color: string, iconPath: string, isSelected: boolean): HTMLElement {
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
  };
  checkBtn.addEventListener("click", (e) => {
    e.preventDefault();
    handleToggle();
  });
  const iconWrap = renderCategoryIconWrap(color || ICON_DEFAULT_COLOR, iconPath, "span");
  const nameSpan = document.createElement("span");
  nameSpan.className = "transaction-history-select-item-name";
  nameSpan.textContent = name;
  nameSpan.addEventListener("click", () => handleToggle());
  row.appendChild(checkBtn);
  row.appendChild(iconWrap);
  row.appendChild(nameSpan);
  return row;
}

function closeTransactionEntryTagModal(): void {
  const overlay = document.getElementById("transaction-entry-tag-select-overlay");
  if (overlay) {
    overlay.classList.remove("is-visible");
    overlay.setAttribute("aria-hidden", "true");
  }
  const trigger = document.getElementById("transaction-entry-tag-open-btn");
  if (trigger instanceof HTMLElement) trigger.focus();
}

function getSelectedTagIdsFromModal(): string[] {
  const container = document.getElementById("transaction-entry-tag-select-list");
  if (!container) return [];
  const selected = container.querySelectorAll<HTMLElement>(
    ".transaction-history-select-item .transaction-history-select-check-btn.is-selected"
  );
  return Array.from(selected)
    .map((btn) => btn.closest(".transaction-history-select-item")?.getAttribute("data-id"))
    .filter((id): id is string => id != null);
}

function renderTagChosenDisplay(): void {
  const el = document.getElementById("transaction-entry-tag-chosen");
  if (!el) return;
  el.innerHTML = "";
  const sorted = tagRows
    .filter((t) => selectedTagIds.has(t.ID))
    .sort((a, b) => (a.SORT_ORDER || "").localeCompare(b.SORT_ORDER || ""));
  sorted.forEach((t) => {
    const chip = document.createElement("span");
    chip.className = "transaction-entry-tag-chip";
    const iconWrap = renderCategoryIconWrap(t.COLOR || ICON_DEFAULT_COLOR, t.ICON_PATH, "span");
    const nameSpan = document.createElement("span");
    nameSpan.textContent = (t.TAG_NAME || "").trim() || "—";
    chip.appendChild(iconWrap);
    chip.appendChild(nameSpan);
    el.appendChild(chip);
  });
}

function openTransactionEntryTagModal(): void {
  const listEl = document.getElementById("transaction-entry-tag-select-list");
  if (!listEl) return;
  listEl.innerHTML = "";
  const sorted = tagRows.slice().sort((a, b) => (a.SORT_ORDER || "").localeCompare(b.SORT_ORDER || ""));
  for (const row of sorted) {
    const item = createTagSelectItemRow(
      row.ID,
      row.TAG_NAME || "—",
      row.COLOR || ICON_DEFAULT_COLOR,
      row.ICON_PATH || "",
      selectedTagIds.has(row.ID)
    );
    listEl.appendChild(item);
  }
  const overlay = document.getElementById("transaction-entry-tag-select-overlay");
  if (overlay) {
    overlay.classList.add("is-visible");
    overlay.setAttribute("aria-hidden", "false");
  }
}

function fillCategorySelect(type: string): void {
  const valueEl = getCategoryValueEl();
  if (!valueEl) return;
  const current = valueEl.value;
  const listEl = document.getElementById("transaction-entry-category-list");
  if (!listEl) return;
  listEl.innerHTML = "";
  const filtered = filterCategoriesByType(type);
  const sorted = filtered.slice().sort((a, b) => (a.SORT_ORDER || "").localeCompare(b.SORT_ORDER || ""));
  const keepCurrent = sorted.some((c) => c.ID === current);
  if (!keepCurrent) {
    valueEl.value = sorted.length > 0 ? sorted[0].ID : "";
  }
  sorted.forEach((c) => {
    const option = document.createElement("div");
    option.className = "transaction-entry-category-option";
    option.setAttribute("role", "option");
    option.dataset.categoryId = c.ID;
    const iconWrap = renderCategoryIconWrap(c.COLOR || ICON_DEFAULT_COLOR, c.ICON_PATH);
    const nameSpan = document.createElement("span");
    nameSpan.className = "transaction-entry-category-option-name";
    nameSpan.textContent = (c.CATEGORY_NAME || "").trim() || "—";
    option.appendChild(iconWrap);
    option.appendChild(nameSpan);
    listEl.appendChild(option);
  });
  updateCategoryTriggerDisplay(valueEl.value);
}

function fillAccountDropdown(which: "out" | "in", visibleIds: Set<string>): void {
  const prefix = which === "out" ? "transaction-entry-account-out" : "transaction-entry-account-in";
  const valueEl = which === "out" ? getAccountOutValueEl() : getAccountInValueEl();
  if (!valueEl) return;
  const listEl = document.getElementById(`${prefix}-list`);
  if (!listEl) return;
  const current = valueEl.value;
  const sorted = accountRows
    .filter((a) => visibleIds.has(a.ID))
    .sort((a, b) => (a.ACCOUNT_NAME || "").localeCompare(b.ACCOUNT_NAME || ""));
  const keepCurrent = sorted.some((a) => a.ID === current);
  if (!keepCurrent) {
    valueEl.value = sorted.length > 0 ? sorted[0].ID : "";
  }
  listEl.innerHTML = "";
  sorted.forEach((a) => {
    const option = document.createElement("div");
    option.className = "transaction-entry-account-option";
    option.setAttribute("role", "option");
    option.dataset.accountId = a.ID;
    const iconWrap = renderCategoryIconWrap(a.COLOR || ICON_DEFAULT_COLOR, a.ICON_PATH);
    const nameSpan = document.createElement("span");
    nameSpan.className = "transaction-entry-account-option-name";
    nameSpan.textContent = (a.ACCOUNT_NAME || "").trim() || "—";
    option.appendChild(iconWrap);
    option.appendChild(nameSpan);
    listEl.appendChild(option);
  });
  updateAccountTriggerDisplay(which, valueEl.value);
}

function fillAccountSelects(visibleIds: Set<string>): void {
  fillAccountDropdown("out", visibleIds);
  fillAccountDropdown("in", visibleIds);
}

function updateAccountRowsVisibility(type: string): void {
  const outRow = document.getElementById("transaction-entry-account-out-row");
  const inRow = document.getElementById("transaction-entry-account-in-row");
  const outVal = getAccountOutValueEl();
  const inVal = getAccountInValueEl();
  if (!outRow || !inRow) return;
  outRow.hidden = type === "income";
  inRow.hidden = type === "expense";
  if (outVal) outVal.required = type === "expense" || type === "transfer";
  if (inVal) inVal.required = type === "income" || type === "transfer";
  if (type === "income" && outVal) {
    outVal.value = "";
    updateAccountTriggerDisplay("out", "");
  }
  if (type === "expense" && inVal) {
    inVal.value = "";
    updateAccountTriggerDisplay("in", "");
  }
  fillAccountSelects(visibleAccountIds);
}

function getTypeInput(): HTMLInputElement | null {
  return document.getElementById("transaction-entry-type") as HTMLInputElement | null;
}

function getStatusInput(): HTMLInputElement | null {
  return document.getElementById("transaction-entry-status") as HTMLInputElement | null;
}

function setTypeAndSync(type: string): void {
  const input = getTypeInput();
  if (!input) return;
  input.value = type;
  const typeGroup = document.getElementById("transaction-entry-type-buttons");
  typeGroup?.querySelectorAll(".transaction-history-filter-btn").forEach((btn) => {
    const t = (btn as HTMLElement).getAttribute("data-type");
    btn.classList.toggle("is-active", t === type);
  });
  fillCategorySelect(type);
  updateAccountRowsVisibility(type);
}

function setStatusAndSync(status: string): void {
  const normalized = status === "plan" ? "plan" : "actual";
  const input = getStatusInput();
  if (!input) return;
  input.value = normalized;
  const statusGroup = document.getElementById("transaction-entry-status-buttons");
  statusGroup?.querySelectorAll(".transaction-history-filter-btn").forEach((btn) => {
    const s = (btn as HTMLElement).getAttribute("data-status");
    btn.classList.toggle("is-active", s === normalized);
  });
  updateDateRowsVisibility(normalized);
}

const todayYMD = (): string => new Date().toISOString().slice(0, 10);

function updateDateRowsVisibility(status: string): void {
  const actualWrap = document.getElementById("transaction-entry-date-actual-wrap");
  const planWrap = document.getElementById("transaction-entry-date-plan-wrap");
  const dateInput = document.getElementById("transaction-entry-date") as HTMLInputElement | null;
  const dateFromInput = document.getElementById("transaction-entry-date-from") as HTMLInputElement | null;
  const dateToInput = document.getElementById("transaction-entry-date-to") as HTMLInputElement | null;
  if (!actualWrap || !planWrap) return;
  const isPlan = status === "plan";
  actualWrap.hidden = isPlan;
  planWrap.hidden = !isPlan;
  if (dateInput) dateInput.required = !isPlan;
  if (dateFromInput) dateFromInput.required = isPlan;
  if (dateToInput) dateToInput.required = isPlan;
  if (isPlan && dateFromInput && dateToInput) {
    const d = dateInput?.value?.trim() || todayYMD();
    if (!dateFromInput.value) dateFromInput.value = d;
    if (!dateToInput.value) dateToInput.value = d;
  }
  if (!isPlan && dateInput && !dateInput.value) dateInput.value = todayYMD();
}

function setTodayToAllDateInputs(): void {
  const t = todayYMD();
  const dateInput = document.getElementById("transaction-entry-date") as HTMLInputElement | null;
  const dateFromInput = document.getElementById("transaction-entry-date-from") as HTMLInputElement | null;
  const dateToInput = document.getElementById("transaction-entry-date-to") as HTMLInputElement | null;
  if (dateInput) dateInput.value = t;
  if (dateFromInput) dateFromInput.value = t;
  if (dateToInput) dateToInput.value = t;
}

function ensureSingleSelection(): void {
  const typeInput = getTypeInput();
  const statusInput = getStatusInput();
  const validTypes = ["expense", "income", "transfer"];
  const validStatuses = ["plan", "actual"];
  const type = typeInput?.value && validTypes.includes(typeInput.value) ? typeInput.value : "expense";
  const status = statusInput?.value && validStatuses.includes(statusInput.value) ? statusInput.value : "actual";
  setTypeAndSync(type);
  setStatusAndSync(status);
}

function resetForm(): void {
  const form = document.getElementById("transaction-entry-form") as HTMLFormElement | null;
  if (form) form.reset();
  const categoryEl = getCategoryValueEl();
  const accountOutEl = getAccountOutValueEl();
  const accountInEl = getAccountInValueEl();
  if (categoryEl) categoryEl.value = "";
  if (accountOutEl) accountOutEl.value = "";
  if (accountInEl) accountInEl.value = "";
  setTypeAndSync("expense");
  setStatusAndSync("actual");
  setTodayToAllDateInputs();
  updateAccountTriggerDisplay("out", getAccountOutValueEl()?.value ?? "");
  updateAccountTriggerDisplay("in", getAccountInValueEl()?.value ?? "");
  selectedTagIds.clear();
  renderTagChosenDisplay();
}

function getFirstVisibleAccountId(_which: "out" | "in"): string {
  const sorted = accountRows
    .filter((a) => visibleAccountIds.has(a.ID))
    .sort((a, b) => (a.ACCOUNT_NAME || "").localeCompare(b.ACCOUNT_NAME || ""));
  return sorted.length > 0 ? sorted[0].ID : "";
}

function updateTransactionEntryDeleteButtonVisibility(): void {
  const btn = document.getElementById("header-transaction-entry-delete");
  if (btn) btn.classList.toggle("is-visible", !!editingTransactionId && !transactionEntryViewOnly);
}

function updateTransactionEntrySubmitButtonVisibility(): void {
  const btn = document.getElementById("header-transaction-entry-submit");
  if (!btn) return;
  const showSubmit = !editingTransactionId || !transactionEntryViewOnly;
  btn.classList.toggle("is-visible", showSubmit);
}

function updateTransactionEntryContinuousButtonVisibility(): void {
  const btn = document.getElementById("header-transaction-entry-continuous");
  if (!btn) return;
  const isNewEntry = !editingTransactionId;
  btn.classList.toggle("is-visible", isNewEntry);
  btn.classList.toggle("is-on", continuousMode);
}

/** 参照モード時: テキスト・入力・プルダウン・ボタンを readonly / disabled にする */
function setTransactionEntryReadonly(readonly: boolean): void {
  const form = document.getElementById("transaction-entry-form");
  form?.classList.toggle("is-readonly", readonly);

  const notice = document.getElementById("transaction-entry-view-only-notice");
  if (notice) {
    notice.classList.toggle("is-visible", readonly);
    notice.setAttribute("aria-hidden", String(!readonly));
  }

  const textInputIds = ["transaction-entry-name", "transaction-entry-amount", "transaction-entry-date", "transaction-entry-date-from", "transaction-entry-date-to"];
  for (const id of textInputIds) {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (el) el.readOnly = readonly;
  }
  const memoEl = document.getElementById("transaction-entry-memo") as HTMLTextAreaElement | null;
  if (memoEl) memoEl.readOnly = readonly;

  const triggerIds = [
    "transaction-entry-category-trigger",
    "transaction-entry-account-out-trigger",
    "transaction-entry-account-in-trigger",
    "transaction-entry-tag-open-btn",
    "transaction-entry-type-expense",
    "transaction-entry-type-income",
    "transaction-entry-type-transfer",
    "transaction-entry-status-plan",
    "transaction-entry-status-actual",
    "header-transaction-entry-reset",
  ];
  for (const id of triggerIds) {
    const el = document.getElementById(id) as HTMLButtonElement | null;
    if (el) el.disabled = readonly;
  }
}

async function loadFormForEdit(transactionId: string): Promise<void> {
  const { rows: txRows } = await fetchTransactionRows(true);
  const row = txRows.find((r) => r.ID === transactionId);
  if (!row) return;
  const type = row.TYPE || "expense";
  const status = row.STATUS || "actual";
  setTypeAndSync(type);
  setStatusAndSync(status);
  const categoryEl = getCategoryValueEl();
  if (categoryEl) {
    categoryEl.value = row.CATEGORY_ID || "";
    updateCategoryTriggerDisplay(row.CATEGORY_ID || "");
  }
  const nameEl = document.getElementById("transaction-entry-name") as HTMLInputElement | null;
  if (nameEl) nameEl.value = row.NAME || "";
  const dateEl = document.getElementById("transaction-entry-date") as HTMLInputElement | null;
  const dateFromEl = document.getElementById("transaction-entry-date-from") as HTMLInputElement | null;
  const dateToEl = document.getElementById("transaction-entry-date-to") as HTMLInputElement | null;
  if (status === "plan") {
    if (dateFromEl) dateFromEl.value = row.PLAN_DATE_FROM || "";
    if (dateToEl) dateToEl.value = row.PLAN_DATE_TO || "";
    if (dateEl) dateEl.value = row.ACTUAL_DATE || "";
  } else {
    if (dateEl) dateEl.value = row.ACTUAL_DATE || "";
    if (dateFromEl) dateFromEl.value = row.PLAN_DATE_FROM || "";
    if (dateToEl) dateToEl.value = row.PLAN_DATE_TO || "";
  }
  const amountEl = document.getElementById("transaction-entry-amount") as HTMLInputElement | null;
  if (amountEl) amountEl.value = row.AMOUNT || "";
  const memoEl = document.getElementById("transaction-entry-memo") as HTMLTextAreaElement | null;
  if (memoEl) memoEl.value = row.MEMO || "";
  const accountInEl = getAccountInValueEl();
  const accountOutEl = getAccountOutValueEl();
  if (accountInEl) accountInEl.value = row.ACCOUNT_ID_IN || "";
  if (accountOutEl) accountOutEl.value = row.ACCOUNT_ID_OUT || "";
  fillCategorySelect(type);
  fillAccountSelects(visibleAccountIds);
  updateAccountRowsVisibility(type);
  if (type === "expense") {
    const firstIn = getFirstVisibleAccountId("in");
    if (accountInEl) accountInEl.value = firstIn;
    updateAccountTriggerDisplay("in", firstIn);
  } else if (type === "income") {
    const firstOut = getFirstVisibleAccountId("out");
    if (accountOutEl) accountOutEl.value = firstOut;
    updateAccountTriggerDisplay("out", firstOut);
  } else {
    updateAccountTriggerDisplay("out", row.ACCOUNT_ID_OUT || "");
    updateAccountTriggerDisplay("in", row.ACCOUNT_ID_IN || "");
  }
  const { rows: mgmtRows } = await fetchTagManagementRows(true);
  selectedTagIds = new Set(
    mgmtRows.filter((r) => r.TRANSACTION_ID === transactionId).map((r) => r.TAG_ID)
  );
  renderTagChosenDisplay();
}

async function loadOptions(): Promise<void> {
  const [categories, accounts, permissions, tags] = await Promise.all([
    fetchCategoryList(true),
    fetchAccountList(true),
    fetchAccountPermissionList(true),
    fetchTagList(true),
  ]);
  categoryRows = categories;
  accountRows = accounts;
  permissionRows = permissions;
  tagRows = tags;
  visibleAccountIds = getVisibleAccountIds(accountRows, permissionRows);
  const typeInput = getTypeInput();
  const type = typeInput?.value ?? "expense";
  fillCategorySelect(type);
  fillAccountSelects(visibleAccountIds);
  updateAccountRowsVisibility(type);
  renderTagChosenDisplay();
}

function buildNewRow(form: HTMLFormElement, nextId: number): Record<string, string> {
  const type = (form.querySelector("#transaction-entry-type") as HTMLInputElement)?.value ?? "expense";
  const status = (form.querySelector("#transaction-entry-status") as HTMLInputElement)?.value ?? "actual";
  const categoryId = (form.querySelector("#transaction-entry-category") as HTMLInputElement)?.value ?? "";
  const name = ((form.querySelector("#transaction-entry-name") as HTMLInputElement)?.value ?? "").trim();
  const date = (form.querySelector("#transaction-entry-date") as HTMLInputElement)?.value ?? "";
  const dateFrom = (form.querySelector("#transaction-entry-date-from") as HTMLInputElement)?.value ?? "";
  const dateTo = (form.querySelector("#transaction-entry-date-to") as HTMLInputElement)?.value ?? "";
  const amount = ((form.querySelector("#transaction-entry-amount") as HTMLInputElement)?.value ?? "").trim();
  const memo = ((form.querySelector("#transaction-entry-memo") as HTMLTextAreaElement)?.value ?? "").trim();
  const accountIn = (form.querySelector("#transaction-entry-account-in") as HTMLInputElement)?.value ?? "";
  const accountOut = (form.querySelector("#transaction-entry-account-out") as HTMLInputElement)?.value ?? "";
  const now = nowStr();
  const userId = currentUserId;
  return {
    ID: String(nextId),
    REGIST_DATETIME: now,
    REGIST_USER: userId,
    UPDATE_DATETIME: now,
    UPDATE_USER: userId,
    TYPE: type,
    STATUS: status,
    CATEGORY_ID: categoryId,
    NAME: name,
    ACTUAL_DATE: status === "plan" ? dateFrom : date,
    PLAN_DATE_FROM: status === "plan" ? dateFrom : date,
    PLAN_DATE_TO: status === "plan" ? dateTo : date,
    AMOUNT: amount,
    MEMO: memo,
    ACCOUNT_ID_IN: type === "income" || type === "transfer" ? accountIn : "",
    ACCOUNT_ID_OUT: type === "expense" || type === "transfer" ? accountOut : "",
  };
}

function buildUpdatedRow(form: HTMLFormElement, existing: TransactionRow): Record<string, string> {
  const type = (form.querySelector("#transaction-entry-type") as HTMLInputElement)?.value ?? "expense";
  const status = (form.querySelector("#transaction-entry-status") as HTMLInputElement)?.value ?? "actual";
  const categoryId = (form.querySelector("#transaction-entry-category") as HTMLInputElement)?.value ?? "";
  const name = ((form.querySelector("#transaction-entry-name") as HTMLInputElement)?.value ?? "").trim();
  const date = (form.querySelector("#transaction-entry-date") as HTMLInputElement)?.value ?? "";
  const dateFrom = (form.querySelector("#transaction-entry-date-from") as HTMLInputElement)?.value ?? "";
  const dateTo = (form.querySelector("#transaction-entry-date-to") as HTMLInputElement)?.value ?? "";
  const amount = ((form.querySelector("#transaction-entry-amount") as HTMLInputElement)?.value ?? "").trim();
  const memo = ((form.querySelector("#transaction-entry-memo") as HTMLTextAreaElement)?.value ?? "").trim();
  const accountIn = (form.querySelector("#transaction-entry-account-in") as HTMLInputElement)?.value ?? "";
  const accountOut = (form.querySelector("#transaction-entry-account-out") as HTMLInputElement)?.value ?? "";
  const now = nowStr();
  const userId = currentUserId;
  return {
    ID: existing.ID,
    REGIST_DATETIME: existing.REGIST_DATETIME ?? "",
    REGIST_USER: existing.REGIST_USER ?? "",
    UPDATE_DATETIME: now,
    UPDATE_USER: userId,
    TYPE: type,
    STATUS: status,
    CATEGORY_ID: categoryId,
    NAME: name,
    ACTUAL_DATE: status === "plan" ? dateFrom : date,
    PLAN_DATE_FROM: status === "plan" ? dateFrom : date,
    PLAN_DATE_TO: status === "plan" ? dateTo : date,
    AMOUNT: amount,
    MEMO: memo,
    ACCOUNT_ID_IN: type === "income" || type === "transfer" ? accountIn : "",
    ACCOUNT_ID_OUT: type === "expense" || type === "transfer" ? accountOut : "",
  };
}

async function saveTransactionCsv(csv: string): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("save_transaction_csv", { transaction: csv });
}

async function saveTagManagementCsv(csv: string): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("save_tag_management_csv", { tagManagement: csv });
}

export function initTransactionEntryView(): void {
  registerViewHandler("transaction-entry", () => {
    (async () => {
      await loadOptions();
      const editId = transactionEntryEditId;
      if (editId) {
        await loadFormForEdit(editId);
        editingTransactionId = editId;
        setTransactionEntryEditId(null);
      } else {
        ensureSingleSelection();
        updateDateRowsVisibility(getStatusInput()?.value ?? "actual");
        setTodayToAllDateInputs();
        resetForm();
        editingTransactionId = null;
      }
      updateTransactionEntryDeleteButtonVisibility();
      updateTransactionEntrySubmitButtonVisibility();
      updateTransactionEntryContinuousButtonVisibility();
      setTransactionEntryReadonly(transactionEntryViewOnly);
    })();
  });

  document.getElementById("transaction-entry-type-buttons")?.querySelectorAll(".transaction-history-filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const type = (btn as HTMLElement).getAttribute("data-type");
      if (!type || (getTypeInput()?.value === type)) return;
      setTypeAndSync(type);
    });
  });
  document.getElementById("transaction-entry-status-buttons")?.querySelectorAll(".transaction-history-filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const status = (btn as HTMLElement).getAttribute("data-status");
      if (!status || (getStatusInput()?.value === status)) return;
      setStatusAndSync(status);
    });
  });

  const form = document.getElementById("transaction-entry-form");
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!(form instanceof HTMLFormElement)) return;
    if (transactionEntryViewOnly) return;
    if (!isTauri()) {
      alert("収支の保存はアプリ起動時（Tauri）でのみ保存できます。");
      return;
    }
    try {
      if (editingTransactionId) {
        const { rows } = await fetchTransactionRows(true);
        const existing = rows.find((r) => r.ID === editingTransactionId);
        if (!existing) {
          alert("対象の取引が見つかりません。");
          return;
        }
        const updatedRow = buildUpdatedRow(form, existing);
        const allRows = rows.map((r) =>
          r.ID === editingTransactionId ? (updatedRow as Record<string, string>) : ({ ...r } as Record<string, string>)
        );
        const csv = transactionListToCsv(allRows);
        await saveTransactionCsv(csv);
        const { nextId: nextMgmtId, rows: mgmtRows } = await fetchTagManagementRows(true);
        const now = nowStr();
        const userId = currentUserId;
        const others = mgmtRows.filter((r) => r.TRANSACTION_ID !== editingTransactionId);
        const newMgmtRows = others.map((r) => ({ ...r } as Record<string, string>));
        let id = nextMgmtId;
        for (const tagId of selectedTagIds) {
          newMgmtRows.push({
            ID: String(id),
            REGIST_DATETIME: now,
            REGIST_USER: userId,
            UPDATE_DATETIME: now,
            UPDATE_USER: userId,
            TRANSACTION_ID: editingTransactionId,
            TAG_ID: tagId,
          });
          id += 1;
        }
        const mgmtCsv = tagManagementListToCsv(newMgmtRows);
        await saveTagManagementCsv(mgmtCsv);
        editingTransactionId = null;
        resetForm();
        pushNavigation("transaction-history");
        showMainView("transaction-history");
      } else {
        const { nextId, rows } = await fetchTransactionRows(true);
        const newRow = buildNewRow(form, nextId);
        const allRows = [...rows.map((r) => ({ ...r } as Record<string, string>)), newRow];
        const csv = transactionListToCsv(allRows);
        await saveTransactionCsv(csv);
        const newTransactionId = String(nextId);
        if (selectedTagIds.size > 0) {
          const { nextId: nextMgmtId, rows: mgmtRows } = await fetchTagManagementRows(true);
          const now = nowStr();
          const userId = currentUserId;
          const newMgmtRows = [...mgmtRows.map((r) => ({ ...r } as Record<string, string>))];
          let id = nextMgmtId;
          for (const tagId of selectedTagIds) {
            newMgmtRows.push({
              ID: String(id),
              REGIST_DATETIME: now,
              REGIST_USER: userId,
              UPDATE_DATETIME: now,
              UPDATE_USER: userId,
              TRANSACTION_ID: newTransactionId,
              TAG_ID: tagId,
            });
            id += 1;
          }
          const mgmtCsv = tagManagementListToCsv(newMgmtRows);
          await saveTagManagementCsv(mgmtCsv);
        }
        resetForm();
        if (continuousMode) {
          alert("保存しました。");
        } else {
          pushNavigation("transaction-history");
          showMainView("transaction-history");
        }
      }
    } catch (err) {
      console.error(err);
      alert("保存に失敗しました。");
    }
  });

  document.getElementById("header-transaction-entry-submit")?.addEventListener("click", () => {
    const form = document.getElementById("transaction-entry-form");
    if (form instanceof HTMLFormElement) form.requestSubmit();
  });
  document.getElementById("header-transaction-entry-reset")?.addEventListener("click", async () => {
    if (editingTransactionId) {
      await loadFormForEdit(editingTransactionId);
    } else {
      resetForm();
    }
  });
  document.getElementById("header-transaction-entry-continuous")?.addEventListener("click", () => {
    continuousMode = !continuousMode;
    updateTransactionEntryContinuousButtonVisibility();
  });
  document.getElementById("header-transaction-entry-delete")?.addEventListener("click", async () => {
    if (!editingTransactionId) return;
    if (!confirm("この取引を削除しますか？")) return;
    if (!isTauri()) {
      alert("削除はアプリ起動時（Tauri）でのみ実行できます。");
      return;
    }
    try {
      const { rows: txRows } = await fetchTransactionRows(true);
      const newTxRows = txRows.filter((r) => r.ID !== editingTransactionId);
      const csv = transactionListToCsv(newTxRows.map((r) => ({ ...r } as Record<string, string>)));
      await saveTransactionCsv(csv);
      const { rows: mgmtRows } = await fetchTagManagementRows(true);
      const newMgmtRows = mgmtRows
        .filter((r) => r.TRANSACTION_ID !== editingTransactionId)
        .map((r) => ({ ...r } as Record<string, string>));
      const mgmtCsv = tagManagementListToCsv(newMgmtRows);
      await saveTagManagementCsv(mgmtCsv);
      editingTransactionId = null;
      resetForm();
      updateTransactionEntryDeleteButtonVisibility();
      updateTransactionEntryContinuousButtonVisibility();
      pushNavigation("transaction-history");
      showMainView("transaction-history");
    } catch (err) {
      console.error(err);
      alert("削除に失敗しました。");
    }
  });

  document.getElementById("transaction-entry-tag-open-btn")?.addEventListener("click", () => openTransactionEntryTagModal());
  document.getElementById("transaction-entry-tag-select-apply")?.addEventListener("click", () => {
    selectedTagIds = new Set(getSelectedTagIdsFromModal());
    renderTagChosenDisplay();
    closeTransactionEntryTagModal();
  });
  document.getElementById("transaction-entry-tag-select-clear")?.addEventListener("click", () => {
    document
      .querySelectorAll("#transaction-entry-tag-select-list .transaction-history-select-check-btn")
      .forEach((el) => {
        el.classList.remove("is-selected");
        el.setAttribute("aria-pressed", "false");
      });
  });
  document.getElementById("transaction-entry-tag-select-overlay")?.addEventListener("click", (e) => {
    if (e.target instanceof HTMLElement && e.target.id === "transaction-entry-tag-select-overlay") {
      closeTransactionEntryTagModal();
    }
  });

  const categoryTrigger = document.getElementById("transaction-entry-category-trigger");
  const categoryList = document.getElementById("transaction-entry-category-list");
  categoryTrigger?.addEventListener("click", (e) => {
    e.preventDefault();
    const list = document.getElementById("transaction-entry-category-list");
    const isOpen = list?.classList.toggle("is-open");
    list?.setAttribute("aria-hidden", String(!isOpen));
    categoryTrigger?.setAttribute("aria-expanded", String(!!isOpen));
  });
  categoryList?.addEventListener("click", (e) => {
    const option = (e.target as HTMLElement).closest(".transaction-entry-category-option");
    if (!option || !(option instanceof HTMLElement)) return;
    const id = option.dataset.categoryId;
    if (!id) return;
    const valueEl = getCategoryValueEl();
    if (valueEl) {
      valueEl.value = id;
      updateCategoryTriggerDisplay(id);
    }
    closeCategoryList();
  });
  document.addEventListener("click", (e) => {
    const target = e.target as Node;
    if (document.querySelector(".transaction-entry-category-dropdown")?.contains(target)) return;
    const inAnyAccountDropdown = Array.from(document.querySelectorAll(".transaction-entry-account-dropdown")).some((el) =>
      el.contains(target)
    );
    if (inAnyAccountDropdown) return;
    closeCategoryList();
    closeAccountList("out");
    closeAccountList("in");
  });

  (["out", "in"] as const).forEach((which) => {
    const prefix = which === "out" ? "transaction-entry-account-out" : "transaction-entry-account-in";
    const trigger = document.getElementById(`${prefix}-trigger`);
    const list = document.getElementById(`${prefix}-list`);
    trigger?.addEventListener("click", (e) => {
      e.preventDefault();
      const listEl = document.getElementById(`${prefix}-list`);
      const isOpen = listEl?.classList.toggle("is-open");
      listEl?.setAttribute("aria-hidden", String(!isOpen));
      trigger?.setAttribute("aria-expanded", String(!!isOpen));
    });
    list?.addEventListener("click", (e) => {
      const option = (e.target as HTMLElement).closest(".transaction-entry-account-option");
      if (!option || !(option instanceof HTMLElement)) return;
      const id = option.dataset.accountId;
      if (!id) return;
      const valueEl = which === "out" ? getAccountOutValueEl() : getAccountInValueEl();
      if (valueEl) {
        valueEl.value = id;
        updateAccountTriggerDisplay(which, id);
      }
      closeAccountList(which);
    });
  });
}
