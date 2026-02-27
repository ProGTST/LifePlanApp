/**
 * 論理削除済み（DLT_FLG=1）の取引データを TRANSACTION.csv 等から物理削除する。
 */
import { fetchCsv, rowToObject } from "./csv";
import { saveCsvViaApi } from "./dataApi";
import {
  transactionListToCsv,
  transactionTagListToCsv,
  transactionManagementListToCsv,
} from "./csvExport";

export interface PhysicalDeleteResult {
  /** 物理削除した取引行数（TRANSACTION.csv から削除した件数） */
  deletedCount: number;
}

/**
 * 削除済み（DLT_FLG=1）の取引を TRANSACTION.csv から除去し、
 * 当該取引に紐づく TRANSACTION_TAG / TRANSACTION_MANAGEMENT の行も削除して保存する。
 */
export async function runPhysicalDelete(): Promise<PhysicalDeleteResult> {
  const [txRes, txTagRes, txMgmtRes] = await Promise.all([
    fetchCsv("/data/TRANSACTION.csv"),
    fetchCsv("/data/TRANSACTION_TAG.csv"),
    fetchCsv("/data/TRANSACTION_MANAGEMENT.csv"),
  ]);
  const txVersion = txRes.version;
  const txTagVersion = txTagRes.version;
  const txMgmtVersion = txMgmtRes.version;

  const txRows: Record<string, string>[] = [];
  const deletedIds = new Set<string>();
  for (const cells of txRes.rows) {
    if (txRes.header.length === 0) break;
    const row = rowToObject(txRes.header, cells);
    if ((row.DLT_FLG || "0") === "1") {
      const id = (row.ID ?? "").trim();
      if (id) deletedIds.add(id);
      continue;
    }
    txRows.push(row);
  }

  const txCsv = transactionListToCsv(txRows);
  await saveCsvViaApi("TRANSACTION.csv", txCsv, txVersion);

  if (txTagRes.header.length > 0 && txTagRes.rows.length > 0) {
    const txTagRows: Record<string, string>[] = [];
    for (const cells of txTagRes.rows) {
      const row = rowToObject(txTagRes.header, cells);
      if (deletedIds.has((row.TRANSACTION_ID ?? "").trim())) continue;
      txTagRows.push(row);
    }
    const txTagCsv = transactionTagListToCsv(txTagRows);
    await saveCsvViaApi("TRANSACTION_TAG.csv", txTagCsv, txTagVersion);
  }

  if (txMgmtRes.header.length > 0 && txMgmtRes.rows.length > 0) {
    const txMgmtRows: Record<string, string>[] = [];
    for (const cells of txMgmtRes.rows) {
      const row = rowToObject(txMgmtRes.header, cells);
      const planId = (row.TRAN_PLAN_ID ?? "").trim();
      const actualId = (row.TRAN_ACTUAL_ID ?? "").trim();
      if (deletedIds.has(planId) || deletedIds.has(actualId)) continue;
      txMgmtRows.push(row);
    }
    const txMgmtCsv = transactionManagementListToCsv(txMgmtRows);
    await saveCsvViaApi("TRANSACTION_MANAGEMENT.csv", txMgmtCsv, txMgmtVersion);
  }

  return { deletedCount: deletedIds.size };
}
