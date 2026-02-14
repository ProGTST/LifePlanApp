/**
 * オブジェクト配列をヘッダー付き CSV 1 行の文字列に変換する。
 * 値にカンマ・ダブルクォート・改行が含まれる場合はダブルクォートで囲み、内部の " は "" にエスケープする。
 */
function escapeCsvCell(value: string): string {
  if (!/[\n",]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * ヘッダーと行配列から CSV 文字列を生成する。
 */
export function toCsvString(header: string[], rows: Record<string, string>[]): string {
  const headerLine = header.map(escapeCsvCell).join(",");
  const dataLines = rows.map((row) =>
    header.map((key) => escapeCsvCell(String(row[key] ?? ""))).join(",")
  );
  return [headerLine, ...dataLines].join("\n");
}

const ACCOUNT_HEADER = [
  "ID",
  "REGIST_DATETIME",
  "REGIST_USER",
  "UPDATE_DATETIME",
  "UPDATE_USER",
  "USER_ID",
  "ACCOUNT_NAME",
  "COLOR",
  "ICON_PATH",
  "SORT_ORDER",
] as const;

const CATEGORY_HEADER = [
  "ID",
  "REGIST_DATETIME",
  "REGIST_USER",
  "UPDATE_DATETIME",
  "UPDATE_USER",
  "PARENT_ID",
  "TYPE",
  "CATEGORY_NAME",
  "COLOR",
  "ICON_PATH",
  "SORT_ORDER",
] as const;

const TAG_HEADER = [
  "ID",
  "REGIST_DATETIME",
  "REGIST_USER",
  "UPDATE_DATETIME",
  "UPDATE_USER",
  "TAG_NAME",
  "COLOR",
  "ICON_PATH",
  "SORT_ORDER",
] as const;

export function accountListToCsv(rows: Record<string, string>[]): string {
  return toCsvString([...ACCOUNT_HEADER], rows);
}

export function categoryListToCsv(rows: Record<string, string>[]): string {
  return toCsvString([...CATEGORY_HEADER], rows);
}

export function tagListToCsv(rows: Record<string, string>[]): string {
  return toCsvString([...TAG_HEADER], rows);
}

const USER_HEADER = [
  "ID",
  "REGIST_DATETIME",
  "REGIST_USER",
  "UPDATE_DATETIME",
  "UPDATE_USER",
  "NAME",
  "COLOR",
  "ICON_PATH",
] as const;

export function userListToCsv(rows: Record<string, string>[]): string {
  return toCsvString([...USER_HEADER], rows);
}

const COLOR_PALETTE_HEADER = [
  "USER_ID",
  "SEQ_NO",
  "MENUBAR_BG",
  "MENUBAR_FG",
  "HEADER_BG",
  "HEADER_FG",
  "MAIN_BG",
  "MAIN_FG",
  "VIEW_BG",
  "VIEW_FG",
  "FOOTER_BG",
  "FOOTER_FG",
  "BUTTON_BG",
  "BUTTON_FG",
  "BASE_BG",
  "BASE_FG",
  "ACCENT_BG",
  "ACCENT_FG",
] as const;

export function colorPaletteListToCsv(rows: Record<string, string>[]): string {
  return toCsvString([...COLOR_PALETTE_HEADER], rows);
}
