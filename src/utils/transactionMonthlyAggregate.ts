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
  "PREV_CARRYOVER_TOTAL",
  "CARRYOVER_TOTAL",
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
  /** 前月の繰越残高（初月は0。2月目以降は、前月の CARRYOVER_TOTAL） */
  PREV_CARRYOVER_TOTAL: number;
  /** 繰越残高（初月は0。2月目以降は、対象月より前の月の直近 CARRYOVER_TOTAL ＋ 対象月 BALANCE_TOTAL の累計） */
  CARRYOVER_TOTAL: number;
}

export interface ComputeMonthlyResult {
  rows: MonthlyRow[];
  /** 集計対象にした取引件数（TRANSACTION.csv の条件を満たした件数） */
  eligibleCount: number;
  /** ログインユーザーの参照可能勘定 ID の Set（TRANSACTION_MONTHLY の整合性用） */
  visibleAccountIds: Set<string>;
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
      PREV_CARRYOVER_TOTAL: 0,
      CARRYOVER_TOTAL: 0,
    });
  }

  // 同一 ACCOUNT_ID, PROJECT_TYPE 内で年月順に並べ、PREV_CARRYOVER_TOTAL と CARRYOVER_TOTAL を設定
  const groupKey = (r: MonthlyRow) => `${r.ACCOUNT_ID},${r.PROJECT_TYPE}`;
  const byGroup = new Map<string, MonthlyRow[]>();
  for (const r of rows) {
    const k = groupKey(r);
    if (!byGroup.has(k)) byGroup.set(k, []);
    byGroup.get(k)!.push(r);
  }
  for (const list of byGroup.values()) {
    list.sort((a, b) => {
      const c = a.YEAR.localeCompare(b.YEAR);
      return c !== 0 ? c : a.MONTH.localeCompare(b.MONTH);
    });
    let runningSum = 0;
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (i === 0) {
        r.PREV_CARRYOVER_TOTAL = 0;
        r.CARRYOVER_TOTAL = r.BALANCE_TOTAL;
        runningSum = r.BALANCE_TOTAL;
      } else {
        r.PREV_CARRYOVER_TOTAL = list[i - 1].CARRYOVER_TOTAL;
        runningSum += r.BALANCE_TOTAL;
        r.CARRYOVER_TOTAL = runningSum;
      }
    }
  }

  return { rows, eligibleCount: eligible.length, visibleAccountIds: visibleIds };
}

/** 既存の TRANSACTION_MONTHLY の1行（ヘッダーキーでアクセスするオブジェクト） */
type ExistingMonthlyRow = Record<string, string>;

/**
 * TRANSACTION_MONTHLY.csv を取得する。存在しない・エラー時は空の行配列を返す。
 * カレンダー残高推移グラフ等で利用する。
 */
export async function getTransactionMonthlyRows(): Promise<ExistingMonthlyRow[]> {
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

/**
 * 既存の TRANSACTION_MONTHLY.csv を取得する。（saveTransactionMonthlyCsv 等の内部用）
 */
async function fetchExistingTransactionMonthly(): Promise<ExistingMonthlyRow[]> {
  return getTransactionMonthlyRows();
}

/** 1行オブジェクトをヘッダー順の CSV 行文字列にする */
function existingRowToCsvLine(row: ExistingMonthlyRow): string {
  return TRANSACTION_MONTHLY_HEADER.map((h) => escapeCsvCell(String(row[h] ?? ""))).join(",");
}

/**
 * 月別集計結果を TRANSACTION_MONTHLY.csv に反映する。
 * 既存データのうち、参照可能勘定で今回集計に含まれない ACCOUNT_ID の行は削除し（TRANSACTION に取引が無い勘定の月別データを除去）、
 * 今回集計対象の ACCOUNT_ID に該当する行は置き換え、ACCOUNT_ID, PROJECT_TYPE, YEAR, MONTH 単位の集計データを登録する。
 * @param visibleAccountIds - 指定時は、この勘定 ID に属さない既存行は保持。この勘定のうち rows に含まれないものは既存行も削除して整合性を取る。
 * @returns 保存後の TRANSACTION_MONTHLY の総行数（登録件数）
 */
export async function saveTransactionMonthlyCsv(
  rows: MonthlyRow[],
  visibleAccountIds?: Set<string>
): Promise<number> {
  const now = nowDatetime();
  const user = currentUserId || "";

  const existing = await fetchExistingTransactionMonthly();
  const accountIdsToReplace = new Set(rows.map((r) => (r.ACCOUNT_ID || "").trim()).filter(Boolean));
  // 参照可能勘定の既存行はすべて削除し、今回の計算結果で置き換える（重複防止・整合性）。参照不可の勘定の行のみ保持。
  const kept =
    visibleAccountIds !== undefined
      ? existing.filter((row) => !visibleAccountIds.has((row.ACCOUNT_ID || "").trim()))
      : existing.filter((row) => !accountIdsToReplace.has((row.ACCOUNT_ID || "").trim()));

  let nextId = 1;
  for (const row of kept) {
    const n = parseInt(String(row.ID ?? "0"), 10) || 0;
    if (n >= nextId) nextId = n + 1;
  }

  const rowsWithId: { id: number; line: string }[] = [];
  for (const r of kept) {
    const id = parseInt(String(r.ID ?? "0"), 10) || 0;
    rowsWithId.push({ id, line: existingRowToCsvLine(r) });
  }
  for (const r of rows) {
    const id = nextId++;
    rowsWithId.push({
      id,
      line: [
        String(id),
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
        String(r.PREV_CARRYOVER_TOTAL),
        String(r.CARRYOVER_TOTAL),
      ].join(","),
    });
  }
  rowsWithId.sort((a, b) => a.id - b.id);
  const lines = [TRANSACTION_MONTHLY_HEADER.join(","), ...rowsWithId.map((r) => r.line)];
  const csv = lines.join("\n");
  await saveCsvViaApi("TRANSACTION_MONTHLY.csv", csv);
  return kept.length + rows.length;
}

export interface MonthlyAggregationResult {
  /** 集計対象にした取引件数（TRANSACTION.csv） */
  eligibleCount: number;
  /** 今回登録した月別集計の件数（ログインユーザーの参照可能勘定に紐づく集計データのみ） */
  resultCount: number;
}

/**
 * 月別集計を再計算し、TRANSACTION_MONTHLY.csv に保存する。
 * 参照可能勘定のうち TRANSACTION に取引が無い勘定の月別データは削除し、TRANSACTION に合わせて整合性を取る。
 */
export async function runMonthlyAggregation(): Promise<MonthlyAggregationResult> {
  const { rows, eligibleCount, visibleAccountIds } = await computeTransactionMonthlyRows();
  await saveTransactionMonthlyCsv(rows, visibleAccountIds);
  return { eligibleCount, resultCount: rows.length };
}

// --- 収支記録画面での登録・更新・削除時の増分更新用 ---

export interface MonthlyDelta {
  accountId: string;
  projectType: "actual" | "plan";
  year: string;
  month: string;
  incomeDelta: number;
  expenseDelta: number;
}

/**
 * 実績は TRANDATE_TO（未設定時 TRANDATE_FROM）の年月を1件返す。
 * 予定は getPlanOccurrenceDates の各発生日ごとに年月を返す（同月に複数発生日があれば複数件＝金額×発生日の考慮）。
 */
function getYearMonthsForRow(row: TransactionRow): { year: string; month: string }[] {
  const projectType = (row.PROJECT_TYPE || "").toLowerCase();
  if (projectType === "actual") {
    const dateStr = (row.TRANDATE_TO || row.TRANDATE_FROM || "").trim().slice(0, 10);
    if (dateStr.length < 10) return [];
    return [{ year: dateStr.slice(0, 4), month: dateStr.slice(5, 7) }];
  }
  const dates = getPlanOccurrenceDates(row);
  return dates.map((ymd) => ({ year: ymd.slice(0, 4), month: ymd.slice(5, 7) }));
}

/** 予定のフィルタ: 計画このみ / 中止・完了のみ / 全ステータス */
export type MonthlyDeltaPlanFilter = "planning_only" | "complete_canceled_only" | "all";

/**
 * 1件の取引行から月別集計用のデルタ配列を組み立てる。
 * @param row - 取引行
 * @param multiplier - 1=加算（登録・更新の新値）、-1=減算（削除または更新の旧値）
 * @param planFilter - 予定の対象: planning_only=計画このみ（登録・更新）、complete_canceled_only=中止・完了のみ（削除時）、all=全対象
 */
export function buildMonthlyDeltasForRow(
  row: TransactionRow,
  multiplier: 1 | -1,
  planFilter: MonthlyDeltaPlanFilter
): MonthlyDelta[] {
  const projectType = (row.PROJECT_TYPE || "").toLowerCase() as "actual" | "plan";
  if (projectType === "plan") {
    const status = (row.PLAN_STATUS || "planning").toLowerCase();
    if (planFilter === "planning_only" && status !== "planning") return [];
    if (planFilter === "complete_canceled_only" && status !== "complete" && status !== "canceled") return [];
  }
  const type = (row.TRANSACTION_TYPE || "").toLowerCase();
  const amount = parseFloat(String(row.AMOUNT ?? "0")) || 0;
  const accountIn = (row.ACCOUNT_ID_IN || "").trim();
  const accountOut = (row.ACCOUNT_ID_OUT || "").trim();
  const yearMonths = getYearMonthsForRow(row);
  if (!yearMonths.length) return [];

  const deltas: MonthlyDelta[] = [];
  for (const { year, month } of yearMonths) {
    if (type === "income" && accountIn) {
      deltas.push({
        accountId: accountIn,
        projectType,
        year,
        month,
        incomeDelta: amount * multiplier,
        expenseDelta: 0,
      });
    } else if (type === "expense" && accountOut) {
      deltas.push({
        accountId: accountOut,
        projectType,
        year,
        month,
        incomeDelta: 0,
        expenseDelta: amount * multiplier,
      });
    } else if (type === "transfer") {
      if (accountIn) {
        deltas.push({
          accountId: accountIn,
          projectType,
          year,
          month,
          incomeDelta: amount * multiplier,
          expenseDelta: 0,
        });
      }
      if (accountOut) {
        deltas.push({
          accountId: accountOut,
          projectType,
          year,
          month,
          incomeDelta: 0,
          expenseDelta: amount * multiplier,
        });
      }
    }
  }
  return deltas;
}

/**
 * 月別集計にデルタを反映する（取得 or 新規作成 → 加算/減算 → BALANCE_TOTAL 更新 → 同一勘定・計画種別内で CARRYOVER_TOTAL を累計で再計算 → 保存）。
 * 参照可能勘定のうち TRANSACTION に取引が無い勘定の月別行は削除し、TRANSACTION に合わせて整合性を取る。
 */
export async function applyTransactionMonthlyDeltas(deltas: MonthlyDelta[]): Promise<void> {
  const existing = await fetchExistingTransactionMonthly();
  const key = (r: { ACCOUNT_ID: string; PROJECT_TYPE: string; YEAR: string; MONTH: string }) =>
    `${(r.ACCOUNT_ID || "").trim()},${(r.PROJECT_TYPE || "").toLowerCase()},${(r.YEAR || "").trim()},${(r.MONTH || "").trim()}`;
  type RowState = {
    existing: ExistingMonthlyRow | null;
    income: number;
    expense: number;
  };
  const map = new Map<string, RowState>();
  const keysModified = new Set<string>();
  for (const row of existing) {
    const k = key(row as { ACCOUNT_ID: string; PROJECT_TYPE: string; YEAR: string; MONTH: string });
    const inc = parseFloat(String(row.INCOME_TOTAL ?? "0")) || 0;
    const exp = parseFloat(String(row.EXPENSE_TOTAL ?? "0")) || 0;
    map.set(k, { existing: row, income: inc, expense: exp });
  }
  for (const d of deltas) {
    const k = `${d.accountId},${d.projectType},${d.year},${d.month}`;
    keysModified.add(k);
    let state = map.get(k);
    if (!state) {
      state = { existing: null, income: 0, expense: 0 };
      map.set(k, state);
    }
    state.income += d.incomeDelta;
    state.expense += d.expenseDelta;
  }

  // 参照可能勘定のうち TRANSACTION に取引が無い勘定の月別行を削除（TRANSACTION に合わせて整合性を取る）
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
  const visibleAccountIds = getVisibleAccountIds(accountRows, permissionRows);
  const accountIdsWithTransactions = new Set<string>();
  for (const cells of txRes.rows) {
    if (txRes.header.length === 0) break;
    const row = rowToObject(txRes.header, cells) as unknown as TransactionRow;
    if ((row.DLT_FLG || "0") === "1") continue;
    const inId = (row.ACCOUNT_ID_IN || "").trim();
    const outId = (row.ACCOUNT_ID_OUT || "").trim();
    if (inId) accountIdsWithTransactions.add(inId);
    if (outId) accountIdsWithTransactions.add(outId);
  }
  for (const aid of visibleAccountIds) {
    if (accountIdsWithTransactions.has(aid)) continue;
    for (const k of map.keys()) {
      if (k.startsWith(`${aid},`)) map.delete(k);
    }
  }

  // 各キーの BALANCE_TOTAL を確定し、同一 ACCOUNT_ID, PROJECT_TYPE 内で年月順に CARRYOVER_TOTAL を累計で再計算
  const sortedKeys = Array.from(map.keys()).sort();
  const groupKey = (k: string) => {
    const parts = k.split(",");
    return `${parts[0]},${parts[1]}`;
  };
  const byGroup = new Map<string, string[]>();
  for (const k of sortedKeys) {
    const g = groupKey(k);
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g)!.push(k);
  }
  const carryoverByKey = new Map<string, number>();
  const prevCarryoverByKey = new Map<string, number>();
  for (const keysOfGroup of byGroup.values()) {
    keysOfGroup.sort((a, b) => {
      const [, , yA, mA] = a.split(",");
      const [, , yB, mB] = b.split(",");
      const c = yA.localeCompare(yB);
      return c !== 0 ? c : mA.localeCompare(mB);
    });
    let runningSum = 0;
    for (let i = 0; i < keysOfGroup.length; i++) {
      const k = keysOfGroup[i];
      const state = map.get(k)!;
      const BALANCE_TOTAL = state.income - state.expense;
      prevCarryoverByKey.set(k, i === 0 ? 0 : carryoverByKey.get(keysOfGroup[i - 1]) ?? 0);
      if (i === 0) {
        carryoverByKey.set(k, 0);
        runningSum = BALANCE_TOTAL;
      } else {
        runningSum += BALANCE_TOTAL;
        carryoverByKey.set(k, runningSum);
      }
    }
  }

  const now = nowDatetime();
  const user = currentUserId || "";
  let nextId = 1;
  for (const state of map.values()) {
    if (state.existing) {
      const n = parseInt(String(state.existing.ID ?? "0"), 10) || 0;
      if (n >= nextId) nextId = n + 1;
    }
  }
  const rowsWithId: { id: number; line: string }[] = [];
  for (const k of sortedKeys) {
    const state = map.get(k)!;
    const [ACCOUNT_ID, PROJECT_TYPE, YEAR, MONTH] = k.split(",");
    const INCOME_TOTAL = state.income;
    const EXPENSE_TOTAL = state.expense;
    const BALANCE_TOTAL = INCOME_TOTAL - EXPENSE_TOTAL;
    const CARRYOVER_TOTAL = carryoverByKey.get(k) ?? 0;
    const PREV_CARRYOVER_TOTAL = prevCarryoverByKey.get(k) ?? 0;
    if (state.existing) {
      const r = { ...state.existing } as ExistingMonthlyRow;
      r.INCOME_TOTAL = String(INCOME_TOTAL);
      r.EXPENSE_TOTAL = String(EXPENSE_TOTAL);
      r.BALANCE_TOTAL = String(BALANCE_TOTAL);
      r.PREV_CARRYOVER_TOTAL = String(PREV_CARRYOVER_TOTAL);
      r.CARRYOVER_TOTAL = String(CARRYOVER_TOTAL);
      if (keysModified.has(k)) {
        r.UPDATE_DATETIME = now;
        r.UPDATE_USER = user;
        r.VERSION = String((parseInt(String(r.VERSION ?? "0"), 10) || 0) + 1);
      }
      const id = parseInt(String(r.ID ?? "0"), 10) || 0;
      rowsWithId.push({ id, line: existingRowToCsvLine(r) });
    } else {
      const n = nextId++;
      rowsWithId.push({
        id: n,
        line: [
          String(n),
          "0",
          now,
          user,
          now,
          user,
          escapeCsvCell(ACCOUNT_ID),
          escapeCsvCell(PROJECT_TYPE),
          escapeCsvCell(YEAR),
          escapeCsvCell(MONTH),
          String(INCOME_TOTAL),
          String(EXPENSE_TOTAL),
          String(BALANCE_TOTAL),
          String(PREV_CARRYOVER_TOTAL),
          String(CARRYOVER_TOTAL),
        ].join(","),
      });
    }
  }
  rowsWithId.sort((a, b) => a.id - b.id);
  const lines = [TRANSACTION_MONTHLY_HEADER.join(","), ...rowsWithId.map((r) => r.line)];
  const csv = lines.join("\n");
  await saveCsvViaApi("TRANSACTION_MONTHLY.csv", csv);
}

/**
 * 収支記録画面での登録・更新・削除に合わせて TRANSACTION_MONTHLY を増分更新する。
 * 登録・更新: 実績は常に反映。予定はステータスが計画中のときのみ反映。
 * 削除: 実績は常に逆反映。予定はステータスが中止・完了のときのみ逆反映する。
 * @param row - 登録/更新時は新行、削除時は削除する行
 * @param operation - "register" | "update" | "delete"
 * @param oldRow - 更新時のみ。更新前の取引行（逆反映に使用）
 */
export async function updateTransactionMonthlyForTransaction(
  row: TransactionRow,
  operation: "register" | "update" | "delete",
  oldRow?: TransactionRow
): Promise<void> {
  const deltas: MonthlyDelta[] = [];
  if (operation === "delete") {
    deltas.push(...buildMonthlyDeltasForRow(row, -1, "complete_canceled_only"));
  } else if (operation === "register") {
    deltas.push(...buildMonthlyDeltasForRow(row, 1, "planning_only"));
  } else {
    if (oldRow) deltas.push(...buildMonthlyDeltasForRow(oldRow, -1, "planning_only"));
    deltas.push(...buildMonthlyDeltasForRow(row, 1, "planning_only"));
  }
  await applyTransactionMonthlyDeltas(deltas);
}
