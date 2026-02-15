/**
 * 更新・削除前に CSV から対象行を取得し、VERSION を照合する。
 * 競合時・該当なし時はメッセージを表示し、最新データを再取得するよう促す。
 */
import { fetchCsv, rowToObject } from "./csv.ts";

const MSG_UPDATED =
  "他のユーザーが更新しました。\n最新のデータを取得するので、確認してください。";
const MSG_NOT_FOUND =
  "他のユーザーが更新しました。\n該当のデータはありません。";

/** CSV を取得し、パースした行の配列を返す。VERSION 未設定は "0" に正規化する。 */
export async function fetchCsvRows(
  path: string,
  init?: RequestInit
): Promise<Record<string, string>[]> {
  const { header, rows } = await fetchCsv(path, init ?? { cache: "reload" });
  if (header.length === 0) return [];
  const result: Record<string, string>[] = [];
  for (const cells of rows) {
    const row = rowToObject(header, cells);
    if (row.VERSION === undefined || row.VERSION === "") row.VERSION = "0";
    result.push(row);
  }
  return result;
}

/** ID で行を検索する。 */
export function findRowById(
  rows: Record<string, string>[],
  id: string
): Record<string, string> | null {
  return rows.find((r) => String(r.ID ?? "") === String(id)) ?? null;
}

/** COLOR_PALETTE 用: USER_ID で行を検索する。 */
export function findPaletteRowByUserId(
  rows: Record<string, string>[],
  userId: string
): Record<string, string> | null {
  return rows.find((r) => String(r.USER_ID ?? "") === String(userId)) ?? null;
}

export type VersionCheckResult =
  | { allowed: true }
  | { allowed: false; notFound: true }
  | { allowed: false; notFound: false };

/**
 * 更新・削除前にバージョンを照合する。
 * @param csvPath 例: "/data/ACCOUNT.csv"
 * @param id 対象行の ID（COLOR_PALETTE の場合は userId を渡し、findByUserId を使う）
 * @param currentVersion クライアントが持っているバージョン
 * @param findByUserId true のとき id を USER_ID として COLOR_PALETTE 行を検索
 */
export async function checkVersionBeforeUpdate(
  csvPath: string,
  id: string,
  currentVersion: string,
  findByUserId = false
): Promise<VersionCheckResult> {
  const rows = await fetchCsvRows(csvPath);
  const row = findByUserId
    ? findPaletteRowByUserId(rows, id)
    : findRowById(rows, id);
  if (!row) return { allowed: false, notFound: true };
  const serverVersion = String(row.VERSION ?? "0");
  if (serverVersion !== String(currentVersion ?? "0")) {
    return { allowed: false, notFound: false };
  }
  return { allowed: true };
}

export function getVersionConflictMessage(result: VersionCheckResult): string {
  if (result.allowed) return "";
  return result.notFound ? MSG_NOT_FOUND : MSG_UPDATED;
}
