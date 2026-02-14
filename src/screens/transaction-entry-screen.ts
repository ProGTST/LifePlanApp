import type { TransactionRow, CategoryRow, AccountRow, AccountPermissionRow } from "../types";
import { currentUserId } from "../state";
import { fetchCsv, rowToObject } from "../utils/csv";
import { transactionListToCsv } from "../utils/csvExport";
import { registerViewHandler } from "../app/screen";

const CSV_NO_CACHE: RequestInit = { cache: "reload" };

let categoryRows: CategoryRow[] = [];
let accountRows: AccountRow[] = [];
let permissionRows: AccountPermissionRow[] = [];

function nowStr(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

function isTauri(): boolean {
  return typeof (window as unknown as { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__?.invoke === "function";
}

/** ログインユーザーが参照できる勘定ID（自分の勘定 + 権限付与された勘定） */
function getVisibleAccountIds(
  accounts: AccountRow[],
  permissions: AccountPermissionRow[]
): Set<string> {
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

/** 既存の TRANSACTION.csv を取得し、次の ID と全行を返す */
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

function getCategorySelectEl(): HTMLSelectElement | null {
  return document.getElementById("transaction-entry-category") as HTMLSelectElement | null;
}

function getAccountInSelectEl(): HTMLSelectElement | null {
  return document.getElementById("transaction-entry-account-in") as HTMLSelectElement | null;
}

function getAccountOutSelectEl(): HTMLSelectElement | null {
  return document.getElementById("transaction-entry-account-out") as HTMLSelectElement | null;
}

/** 収支種別に応じてカテゴリー選択肢を絞り込み */
function filterCategoriesByType(type: string): CategoryRow[] {
  if (type === "income") return categoryRows.filter((c) => (c.TYPE || "").toLowerCase() === "income");
  if (type === "expense") return categoryRows.filter((c) => (c.TYPE || "").toLowerCase() === "expense");
  if (type === "transfer") return categoryRows.filter((c) => ["income", "expense"].includes((c.TYPE || "").toLowerCase()));
  return categoryRows;
}

function fillCategorySelect(type: string): void {
  const sel = getCategorySelectEl();
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = "";
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = "選択してください";
  sel.appendChild(opt0);
  const filtered = filterCategoriesByType(type);
  filtered.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c.ID;
    opt.textContent = (c.CATEGORY_NAME || "").trim() || "—";
    sel.appendChild(opt);
  });
  if (filtered.some((c) => c.ID === current)) sel.value = current;
}

function fillAccountSelects(visibleIds: Set<string>): void {
  const inSel = getAccountInSelectEl();
  const outSel = getAccountOutSelectEl();
  const sorted = accountRows
    .filter((a) => visibleIds.has(a.ID))
    .sort((a, b) => (a.ACCOUNT_NAME || "").localeCompare(b.ACCOUNT_NAME || ""));
  [inSel, outSel].forEach((sel) => {
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = "";
    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = "選択してください";
    sel.appendChild(opt0);
    sorted.forEach((a) => {
      const opt = document.createElement("option");
      opt.value = a.ID;
      opt.textContent = (a.ACCOUNT_NAME || "").trim() || "—";
      sel.appendChild(opt);
    });
    if (sorted.some((a) => a.ID === current)) sel.value = current;
  });
}

/** 収支種別に応じて勘定（入金先・支出元）の表示を切り替え */
function updateAccountRowsVisibility(type: string): void {
  const outRow = document.getElementById("transaction-entry-account-out-row");
  const inRow = document.getElementById("transaction-entry-account-in-row");
  const outSel = getAccountOutSelectEl();
  const inSel = getAccountInSelectEl();
  if (!outRow || !inRow) return;
  outRow.hidden = type === "income";
  inRow.hidden = type === "expense";
  if (outSel) outSel.required = type === "expense" || type === "transfer";
  if (inSel) inSel.required = type === "income" || type === "transfer";
  if (type === "income" && outSel) outSel.value = "";
  if (type === "expense" && inSel) inSel.value = "";
}

function resetForm(): void {
  const form = document.getElementById("transaction-entry-form") as HTMLFormElement | null;
  if (form) form.reset();
  const typeSel = document.getElementById("transaction-entry-type") as HTMLSelectElement | null;
  if (typeSel) {
    fillCategorySelect(typeSel.value);
    updateAccountRowsVisibility(typeSel.value);
  }
  const dateInput = document.getElementById("transaction-entry-date") as HTMLInputElement | null;
  if (dateInput) dateInput.value = new Date().toISOString().slice(0, 10);
}

async function loadOptions(): Promise<void> {
  const [categories, accounts, permissions] = await Promise.all([
    fetchCategoryList(true),
    fetchAccountList(true),
    fetchAccountPermissionList(true),
  ]);
  categoryRows = categories;
  accountRows = accounts;
  permissionRows = permissions;
  const visibleIds = getVisibleAccountIds(accountRows, permissionRows);
  const typeSel = document.getElementById("transaction-entry-type") as HTMLSelectElement | null;
  fillCategorySelect(typeSel?.value ?? "expense");
  fillAccountSelects(visibleIds);
  updateAccountRowsVisibility(typeSel?.value ?? "expense");
}

function buildNewRow(form: HTMLFormElement, nextId: number): Record<string, string> {
  const type = (form.querySelector("#transaction-entry-type") as HTMLSelectElement)?.value ?? "expense";
  const status = (form.querySelector("#transaction-entry-status") as HTMLSelectElement)?.value ?? "actual";
  const categoryId = (form.querySelector("#transaction-entry-category") as HTMLSelectElement)?.value ?? "";
  const name = ((form.querySelector("#transaction-entry-name") as HTMLInputElement)?.value ?? "").trim();
  const date = (form.querySelector("#transaction-entry-date") as HTMLInputElement)?.value ?? "";
  const amount = ((form.querySelector("#transaction-entry-amount") as HTMLInputElement)?.value ?? "").trim();
  const memo = ((form.querySelector("#transaction-entry-memo") as HTMLInputElement)?.value ?? "").trim();
  const accountIn = (form.querySelector("#transaction-entry-account-in") as HTMLSelectElement)?.value ?? "";
  const accountOut = (form.querySelector("#transaction-entry-account-out") as HTMLSelectElement)?.value ?? "";
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
    ACTUAL_DATE: status === "actual" ? date : "",
    PLAN_DATE_FROM: status === "plan" ? date : date,
    PLAN_DATE_TO: status === "plan" ? date : date,
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

export function initTransactionEntryView(): void {
  registerViewHandler("transaction-entry", () => {
    loadOptions();
    const dateInput = document.getElementById("transaction-entry-date") as HTMLInputElement | null;
    if (dateInput && !dateInput.value) dateInput.value = new Date().toISOString().slice(0, 10);
  });

  const typeSel = document.getElementById("transaction-entry-type");
  typeSel?.addEventListener("change", () => {
    const v = (typeSel as HTMLSelectElement).value;
    fillCategorySelect(v);
    updateAccountRowsVisibility(v);
  });

  const form = document.getElementById("transaction-entry-form");
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!(form instanceof HTMLFormElement)) return;
    if (!isTauri()) {
      alert("収支の登録はアプリ起動時（Tauri）でのみ保存できます。");
      return;
    }
    try {
      const { nextId, rows } = await fetchTransactionRows(true);
      const newRow = buildNewRow(form, nextId);
      const allRows = [...rows.map((r) => ({ ...r } as Record<string, string>)), newRow];
      const csv = transactionListToCsv(allRows);
      await saveTransactionCsv(csv);
      resetForm();
      alert("登録しました。");
    } catch (err) {
      console.error(err);
      alert("登録に失敗しました。");
    }
  });

  const resetBtn = document.getElementById("transaction-entry-reset");
  resetBtn?.addEventListener("click", () => resetForm());
}
