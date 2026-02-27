/**
 * 個人の勘定項目の残高（BALANCE）を、実績取引データのみから 0 ベースで再計算し、ACCOUNT.csv を更新する。
 */
import type { TransactionRow, AccountRow } from "../types";
import { currentUserId } from "../state";
import { fetchCsv, rowToObject } from "./csv";
import { accountListToCsv } from "./csvExport";
import { saveCsvViaApi } from "./dataApi";


function nowDatetime(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export interface AccountAggregateResult {
  /** 再計算の対象にした実績取引件数 */
  transactionCount: number;
  /** 残高を更新した個人勘定の件数 */
  accountCount: number;
}

/**
 * 実績取引のみを日付順にソートするためのキー（TRANDATE_TO 優先、なければ TRANDATE_FROM）。
 */
function getActualTransactionSortKey(row: TransactionRow): string {
  const to = (row.TRANDATE_TO || "").trim().slice(0, 10);
  const from = (row.TRANDATE_FROM || "").trim().slice(0, 10);
  const date = to || from || "0000-00-00";
  return `${date}_${row.ID || ""}`;
}

/**
 * 個人の勘定項目について、実績取引データのみから残高を 0 から再計算し、ACCOUNT.csv を保存する。
 * 収入・支出・振替それぞれの種別に応じて勘定に加減算する。
 */
export async function runAccountBalanceRecalculate(): Promise<AccountAggregateResult> {
  const me = currentUserId;
  if (!me) {
    throw new Error("ログインしていません。");
  }

  const [txRes, accRes] = await Promise.all([
    fetchCsv("/data/TRANSACTION.csv"),
    fetchCsv("/data/ACCOUNT.csv"),
  ]);
  const accountVersion = accRes.version;

  const accountRows: AccountRow[] = [];
  for (const cells of accRes.rows) {
    if (cells.length === 0 || cells.every((c) => !c.trim())) continue;
    accountRows.push(rowToObject(accRes.header, cells) as unknown as AccountRow);
  }

  const personalAccountIds = new Set(
    accountRows.filter((a) => (a.USER_ID || "").trim() === me).map((a) => a.ID)
  );
  if (personalAccountIds.size === 0) {
    return { transactionCount: 0, accountCount: 0 };
  }

  const transactionRows: TransactionRow[] = [];
  for (const cells of txRes.rows) {
    if (txRes.header.length === 0) break;
    const row = rowToObject(txRes.header, cells) as unknown as TransactionRow;
    if ((row.DLT_FLG || "0") === "1") continue;
    if ((row.PROJECT_TYPE || "").toLowerCase() !== "actual") continue;
    const inId = (row.ACCOUNT_ID_IN || "").trim();
    const outId = (row.ACCOUNT_ID_OUT || "").trim();
    const touchesPersonal =
      (inId && personalAccountIds.has(inId)) || (outId && personalAccountIds.has(outId));
    if (!touchesPersonal) continue;
    transactionRows.push(row);
  }

  transactionRows.sort((a, b) =>
    getActualTransactionSortKey(a).localeCompare(getActualTransactionSortKey(b))
  );

  const balanceByAccountId = new Map<string, number>();
  for (const id of personalAccountIds) {
    balanceByAccountId.set(id, 0);
  }

  const typeLower = (v: string) => (v || "").toLowerCase();
  for (const row of transactionRows) {
    const type = typeLower(row.TRANSACTION_TYPE);
    const amount = parseFloat(String(row.AMOUNT ?? "0")) || 0;
    const inId = (row.ACCOUNT_ID_IN || "").trim();
    const outId = (row.ACCOUNT_ID_OUT || "").trim();

    if (type === "income" && inId && personalAccountIds.has(inId)) {
      balanceByAccountId.set(inId, (balanceByAccountId.get(inId) ?? 0) + amount);
    } else if (type === "expense" && outId && personalAccountIds.has(outId)) {
      balanceByAccountId.set(outId, (balanceByAccountId.get(outId) ?? 0) - amount);
    } else if (type === "transfer") {
      if (outId && personalAccountIds.has(outId)) {
        balanceByAccountId.set(outId, (balanceByAccountId.get(outId) ?? 0) - amount);
      }
      if (inId && personalAccountIds.has(inId)) {
        balanceByAccountId.set(inId, (balanceByAccountId.get(inId) ?? 0) + amount);
      }
    }
  }

  const now = nowDatetime();
  const records = accountRows.map((a) => {
    const id = a.ID ?? "";
    const isPersonal = personalAccountIds.has(id);
    const newBalance = isPersonal ? balanceByAccountId.get(id) ?? 0 : parseFloat(String(a.BALANCE ?? "0")) || 0;
    const version = Number(a.VERSION ?? "0") + (isPersonal ? 1 : 0);
    return {
      ID: id,
      VERSION: String(version),
      REGIST_DATETIME: a.REGIST_DATETIME ?? "",
      REGIST_USER: a.REGIST_USER ?? "",
      UPDATE_DATETIME: isPersonal ? now : (a.UPDATE_DATETIME ?? ""),
      UPDATE_USER: isPersonal ? me : (a.UPDATE_USER ?? ""),
      USER_ID: a.USER_ID ?? "",
      ACCOUNT_NAME: a.ACCOUNT_NAME ?? "",
      COLOR: a.COLOR ?? "",
      ICON_PATH: a.ICON_PATH ?? "",
      BALANCE: String(newBalance),
      SORT_ORDER: a.SORT_ORDER ?? "",
    };
  });

  const csv = accountListToCsv(records);
  await saveCsvViaApi("ACCOUNT.csv", csv, accountVersion);

  return {
    transactionCount: transactionRows.length,
    accountCount: personalAccountIds.size,
  };
}
