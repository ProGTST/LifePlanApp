/**
 * 論理削除済み（DLT_FLG=1）の取引データを TRANSACTION.csv 等から物理削除する。
 */
import { fetchCsv, rowToObject } from "./csv";
import { saveCsvViaApi } from "./dataApi";
import {
  transactionListToCsv,
  tagManagementListToCsv,
  transactionManagementListToCsv,
} from "./csvExport";

const CSV_NO_CACHE: RequestInit = { cache: "reload" };

export interface PhysicalDeleteResult {
  /** 物理削除した取引行数（TRANSACTION.csv から削除した件数） */
  deletedCount: number;
}

/**
 * 削除済み（DLT_FLG=1）の取引を TRANSACTION.csv から除去し、
 * 当該取引に紐づく TAG_MANAGEMENT / TRANSACTION_MANAGEMENT の行も削除して保存する。
 */
export async function runPhysicalDelete(): Promise<PhysicalDeleteResult> {
  const [txRes, tagMgmtRes, txMgmtRes] = await Promise.all([
    fetchCsv("/data/TRANSACTION.csv", CSV_NO_CACHE),
    fetchCsv("/data/TAG_MANAGEMENT.csv", CSV_NO_CACHE),
    fetchCsv("/data/TRANSACTION_MANAGEMENT.csv", CSV_NO_CACHE),
  ]);

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
  await saveCsvViaApi("TRANSACTION.csv", txCsv);

  if (tagMgmtRes.header.length > 0 && tagMgmtRes.rows.length > 0) {
    const tagMgmtRows: Record<string, string>[] = [];
    for (const cells of tagMgmtRes.rows) {
      const row = rowToObject(tagMgmtRes.header, cells);
      if (deletedIds.has((row.TRANSACTION_ID ?? "").trim())) continue;
      tagMgmtRows.push(row);
    }
    const tagMgmtCsv = tagManagementListToCsv(tagMgmtRows);
    await saveCsvViaApi("TAG_MANAGEMENT.csv", tagMgmtCsv);
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
    await saveCsvViaApi("TRANSACTION_MANAGEMENT.csv", txMgmtCsv);
  }

  return { deletedCount: deletedIds.size };
}
