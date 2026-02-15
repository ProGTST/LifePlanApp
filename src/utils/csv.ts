/**
 * 1行（論理行・改行含む）のCSVをパースする。
 * ダブルクォート・カンマ・RFC 4180 の "" エスケープに対応。
 */
export function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
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
 * CSV本文を論理行に分割する。ダブルクォートで囲まれた中の改行は行区切りとみなさない。
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
 * CSVファイルを API (GET /api/data/:filename) から取得し、ヘッダーと行の配列に分解する。
 * init を渡すと fetch の第二引数に渡す（例: { cache: 'reload' } でキャッシュを無効化）。
 */
export async function fetchCsv(
  path: string,
  init?: RequestInit
): Promise<{ header: string[]; rows: string[][] }> {
  const { fetchCsvFromApi } = await import("./dataApi");
  const name = path.replace(/^\/data\//, "").replace(/^\//, "") || path.split("/").pop() || "";
  const text = await fetchCsvFromApi(name, init);
  const logicalRows = splitCsvLogicalRows(text);
  if (logicalRows.length < 1) return { header: [], rows: [] };
  const header = parseCsvLine(logicalRows[0]);
  const rows: string[][] = [];
  for (let i = 1; i < logicalRows.length; i++) {
    rows.push(parseCsvLine(logicalRows[i]));
  }
  return { header, rows };
}

/**
 * ヘッダーと1行のセル配列からオブジェクトを生成
 */
export function rowToObject(header: string[], cells: string[]): Record<string, string> {
  const obj: Record<string, string> = {};
  header.forEach((h, j) => {
    obj[h] = cells[j] ?? "";
  });
  return obj;
}
