/**
 * 取引データの月別集計を行い、TRANSACTION_MONTHLY.csv を再計算・保存する。
 */
import type { TransactionRow, AccountRow, AccountPermissionRow } from "../types";
import { currentUserId } from "../state";
import { fetchCsv, rowToObject } from "./csv";
import { getPlanOccurrenceDates } from "./planOccurrence";
import { saveCsvViaApi } from "./dataApi";

const CSV_NO_CACHE: RequestInit = { cache: "reload" };

const TRANSACTION_MONTHLY_HEADER = [
  "ID",
  "VERSION",
  "REGIST_DATETIME",
  "REGIST_USER",
  "UPDATE_DATETIME",
  "UPDATE_USER",
  "ACCOUNT_ID",
  "PROJECT_TYPE",
  "YEAR",
  "MONTH",
  "INCOME_TOTAL",
  "EXPENSE_TOTAL",
  "BALANCE_TOTAL",
];

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

/** CSV セルをエスケープする（カンマ・改行・ダブルクォートを含む場合は引用で囲む） */
function escapeCsvCell(value: string): string {
  const s = String(value ?? "").trim();
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function nowDatetime(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export interface MonthlyRow {
  ACCOUNT_ID: string;
  PROJECT_TYPE: string;
  YEAR: string;
  MONTH: string;
  INCOME_TOTAL: number;
  EXPENSE_TOTAL: number;
  BALANCE_TOTAL: number;
}

export interface ComputeMonthlyResult {
  rows: MonthlyRow[];
  /** 集計対象にした取引件数（TRANSACTION.csv の条件を満たした件数） */
  eligibleCount: number;
}

/**
 * TRANSACTION.csv 等を取得し、条件に合う取引を月別に集計して TRANSACTION_MONTHLY の行リストを返す。
 */
export async function computeTransactionMonthlyRows(): Promise<ComputeMonthlyResult> {
  const [txRes, accRes, permRes] = await Promise.all([
    fetchCsv("/data/TRANSACTION.csv", CSV_NO_CACHE),
    fetchCsv("/data/ACCOUNT.csv", CSV_NO_CACHE),
    fetchCsv("/data/ACCOUNT_PERMISSION.csv", CSV_NO_CACHE),
  ]);

  const accountRows: AccountRow[] = [];
  for (const cells of accRes.rows) {
    if (cells.length === 0 || cells.every((c) => !c.trim())) continue;
    accountRows.push(rowToObject(accRes.header, cells) as unknown as AccountRow);
  }
  const permissionRows: AccountPermissionRow[] = [];
  for (const cells of permRes.rows) {
    if (cells.length === 0 || cells.every((c) => !c.trim())) continue;
    permissionRows.push(rowToObject(permRes.header, cells) as unknown as AccountPermissionRow);
  }

  const visibleIds = getVisibleAccountIds(accountRows, permissionRows);
  const transactionRows: TransactionRow[] = [];
  for (const cells of txRes.rows) {
    if (txRes.header.length === 0) break;
    const row = rowToObject(txRes.header, cells) as unknown as TransactionRow;
    if ((row.DLT_FLG || "0") === "1") continue;
    transactionRows.push(row);
  }
  const filtered = filterTransactionsByVisibleAccounts(transactionRows, visibleIds);

  // 予定は PLAN_STATUS が planning のみ
  const eligible = filtered.filter((r) => {
    const pt = (r.PROJECT_TYPE || "").toLowerCase();
    if (pt === "plan") {
      return (r.PLAN_STATUS || "planning").toLowerCase() === "planning";
    }
    return true;
  });

  // key: "ACCOUNT_ID,PROJECT_TYPE,YEAR,MONTH" -> { income, expense }
  const map = new Map<string, { income: number; expense: number }>();

  function add(accountId: string, projectType: string, year: string, month: string, income: number, expense: number): void {
    if (!accountId) return;
    const key = `${accountId},${projectType},${year},${month}`;
    const cur = map.get(key) ?? { income: 0, expense: 0 };
    cur.income += income;
    cur.expense += expense;
    map.set(key, cur);
  }

  const typeLower = (t: string) => (t || "").toLowerCase();

  for (const row of eligible) {
    const amount = parseFloat(String(row.AMOUNT ?? "0")) || 0;
    const type = typeLower(row.TRANSACTION_TYPE);
    const projectType = (row.PROJECT_TYPE || "").toLowerCase();
    const accountIn = (row.ACCOUNT_ID_IN || "").trim();
    const accountOut = (row.ACCOUNT_ID_OUT || "").trim();

    if (projectType === "actual") {
      const dateStr = (row.TRANDATE_TO || row.TRANDATE_FROM || "").trim().slice(0, 10);
      if (dateStr.length < 10) continue;
      const year = dateStr.slice(0, 4);
      const month = dateStr.slice(5, 7);
      if (type === "income") {
        add(accountIn, "actual", year, month, amount, 0);
      } else if (type === "expense") {
        add(accountOut, "actual", year, month, 0, amount);
      } else if (type === "transfer") {
        add(accountIn, "actual", year, month, amount, 0);
        add(accountOut, "actual", year, month, 0, amount);
      }
    } else {
      // plan: 発生日ごとに集計
      const dates = getPlanOccurrenceDates(row);
      for (const ymd of dates) {
        const year = ymd.slice(0, 4);
        const month = ymd.slice(5, 7);
        if (type === "income") {
          add(accountIn, "plan", year, month, amount, 0);
        } else if (type === "expense") {
          add(accountOut, "plan", year, month, 0, amount);
        } else if (type === "transfer") {
          add(accountIn, "plan", year, month, amount, 0);
          add(accountOut, "plan", year, month, 0, amount);
        }
      }
    }
  }

  const rows: MonthlyRow[] = [];
  const sortedKeys = Array.from(map.keys()).sort();

  for (const key of sortedKeys) {
    const [ACCOUNT_ID, PROJECT_TYPE, YEAR, MONTH] = key.split(",");
    const cur = map.get(key)!;
    const INCOME_TOTAL = cur.income;
    const EXPENSE_TOTAL = cur.expense;
    const BALANCE_TOTAL = INCOME_TOTAL - EXPENSE_TOTAL;
    rows.push({
      ACCOUNT_ID,
      PROJECT_TYPE,
      YEAR,
      MONTH,
      INCOME_TOTAL,
      EXPENSE_TOTAL,
      BALANCE_TOTAL,
    });
  }

  return { rows, eligibleCount: eligible.length };
}

/** 既存の TRANSACTION_MONTHLY の1行（ヘッダーキーでアクセスするオブジェクト） */
type ExistingMonthlyRow = Record<string, string>;

/**
 * 既存の TRANSACTION_MONTHLY.csv を取得する。存在しない・エラー時は空の行配列を返す。
 */
async function fetchExistingTransactionMonthly(): Promise<ExistingMonthlyRow[]> {
  try {
    const res = await fetchCsv("/data/TRANSACTION_MONTHLY.csv", CSV_NO_CACHE);
    if (!res.header.length || !res.rows.length) return [];
    const out: ExistingMonthlyRow[] = [];
    for (const cells of res.rows) {
      if (cells.length === 0 || cells.every((c) => !c.trim())) continue;
      const obj = rowToObject(res.header, cells) as ExistingMonthlyRow;
      out.push(obj);
    }
    return out;
  } catch {
    return [];
  }
}

/** 1行オブジェクトをヘッダー順の CSV 行文字列にする */
function existingRowToCsvLine(row: ExistingMonthlyRow): string {
  return TRANSACTION_MONTHLY_HEADER.map((h) => escapeCsvCell(String(row[h] ?? ""))).join(",");
}

/**
 * 月別集計結果を TRANSACTION_MONTHLY.csv に反映する。
 * 既存データのうち、今回集計対象の ACCOUNT_ID に該当する行は削除し、
 * ACCOUNT_ID, PROJECT_TYPE, YEAR, MONTH 単位の集計データを新規登録する。
 * @returns 保存後の TRANSACTION_MONTHLY の総行数（登録件数）
 */
export async function saveTransactionMonthlyCsv(rows: MonthlyRow[]): Promise<number> {
  const now = nowDatetime();
  const user = currentUserId || "";

  const existing = await fetchExistingTransactionMonthly();
  const accountIdsToReplace = new Set(rows.map((r) => (r.ACCOUNT_ID || "").trim()).filter(Boolean));
  const kept = existing.filter((row) => !accountIdsToReplace.has((row.ACCOUNT_ID || "").trim()));

  let nextId = 1;
  for (const row of kept) {
    const n = parseInt(String(row.ID ?? "0"), 10) || 0;
    if (n >= nextId) nextId = n + 1;
  }

  const lines: string[] = [TRANSACTION_MONTHLY_HEADER.join(",")];
  for (const r of kept) {
    lines.push(existingRowToCsvLine(r));
  }
  for (const r of rows) {
    const cells = [
      String(nextId++),
      "0",
      now,
      user,
      now,
      user,
      escapeCsvCell(r.ACCOUNT_ID),
      escapeCsvCell(r.PROJECT_TYPE),
      escapeCsvCell(r.YEAR),
      escapeCsvCell(r.MONTH),
      String(r.INCOME_TOTAL),
      String(r.EXPENSE_TOTAL),
      String(r.BALANCE_TOTAL),
    ];
    lines.push(cells.join(","));
  }
  const csv = lines.join("\n");
  await saveCsvViaApi("TRANSACTION_MONTHLY.csv", csv);
  return kept.length + rows.length;
}

export interface MonthlyAggregationResult {
  /** 集計対象にした取引件数（TRANSACTION.csv） */
  eligibleCount: number;
  /** 保存後の月別集計の登録件数（TRANSACTION_MONTHLY.csv） */
  resultCount: number;
}

/**
 * 月別集計を再計算し、TRANSACTION_MONTHLY.csv に保存する。
 */
export async function runMonthlyAggregation(): Promise<MonthlyAggregationResult> {
  const { rows, eligibleCount } = await computeTransactionMonthlyRows();
  const resultCount = await saveTransactionMonthlyCsv(rows);
  return { eligibleCount, resultCount };
}
