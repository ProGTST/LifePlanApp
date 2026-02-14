/**
 * 1行のCSVをパース（ダブルクォート・カンマ対応）
 */
export function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
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
 * CSVファイルを取得し、ヘッダーと行の配列に分解する。
 * init を渡すと fetch の第二引数に渡す（例: { cache: 'reload' } でキャッシュを無効化）。
 */
export async function fetchCsv(
  path: string,
  init?: RequestInit
): Promise<{ header: string[]; rows: string[][] }> {
  const res = await fetch(path, init);
  if (!res.ok) return { header: [], rows: [] };
  const text = await res.text();
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 1) return { header: [], rows: [] };
  const header = parseCsvLine(lines[0]);
  const rows: string[][] = [];
  for (let i = 1; i < lines.length; i++) {
    rows.push(parseCsvLine(lines[i]));
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
