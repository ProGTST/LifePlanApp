/**
 * 1行（論理行・改行含む）の CSV をパースする。ダブルクォート・カンマ・RFC 4180 の "" エスケープに対応。
 * @param line - 1行分の CSV 文字列
 * @returns フィールドの配列
 */
export function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // 引用内の "" はエスケープとして 1 文字の " を追加
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (inQuotes) {
      current += c;
    } else if (c === ",") {
      result.push(current.trim());
      current = "";
    } else {
      current += c;
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * CSV 本文を論理行に分割する。ダブルクォートで囲まれた中の改行は行区切りとみなさない。
 * @param text - CSV 全文
 * @returns 論理行の配列
 */
function splitCsvLogicalRows(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const rows: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < trimmed.length; i++) {
    const c = trimmed[i];
    if (c === '"') {
      inQuotes = !inQuotes;
      current += c;
    } else if (!inQuotes && (c === "\n" || c === "\r")) {
      // 引用外の改行で論理行区切り
      rows.push(current);
      current = "";
      if (c === "\r" && trimmed[i + 1] === "\n") i += 1;
    } else {
      current += c;
    }
  }
  if (current.length > 0) rows.push(current);
  return rows;
}

/**
 * CSV を API (GET /api/data/:filename) から取得し、ヘッダーと行の配列に分解する。
 * @param path - 例: "/data/USER.csv"
 * @returns { header, rows, version }。version はサーバーの X-Data-Version（楽観ロック・保存時に利用）
 */
export async function fetchCsv(
  path: string
): Promise<{ header: string[]; rows: string[][]; version: number }> {
  const { fetchCsvFromApi } = await import("./dataApi");
  const name = path.replace(/^\/data\//, "").replace(/^\//, "") || path.split("/").pop() || "";
  const { text, version } = await fetchCsvFromApi(name);
  const logicalRows = splitCsvLogicalRows(text);
  if (logicalRows.length < 1) return { header: [], rows: [], version: 0 };
  const header = parseCsvLine(logicalRows[0]);
  const rows: string[][] = [];
  for (let i = 1; i < logicalRows.length; i++) {
    rows.push(parseCsvLine(logicalRows[i]));
  }
  return { header, rows, version };
}

/**
 * ヘッダーと1行のセル配列からキー・値のオブジェクトを生成する。VERSION 列が空の場合は "0" を設定（後方互換）。
 * @param header - 列名の配列
 * @param cells - その行のセル値の配列
 * @returns 列名をキー、セル値を値としたオブジェクト
 */
export function rowToObject(header: string[], cells: string[]): Record<string, string> {
  const obj: Record<string, string> = {};
  header.forEach((h, j) => {
    obj[h] = cells[j] ?? "";
  });
  if ("VERSION" in obj && (obj.VERSION === undefined || obj.VERSION === "")) {
    obj.VERSION = "0";
  }
  return obj;
}
