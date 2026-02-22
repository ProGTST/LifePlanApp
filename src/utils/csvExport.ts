/**
 * CSV セル値をエスケープする。カンマ・ダブルクォート・改行を含む場合はダブルクォートで囲み、内部の " は "" にエスケープする。
 * @param value - セルに出力する文字列
 * @returns エスケープ済みの文字列
 */
function escapeCsvCell(value: string): string {
  if (!/[\n",]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * ヘッダーと行配列から CSV 文字列（1行目=ヘッダー、2行目以降=データ）を生成する。
 * @param header - 列名の配列
 * @param rows - キーが列名・値がセル値のオブジェクトの配列
 * @returns 改行区切りの CSV 文字列
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
  "VERSION",
  "REGIST_DATETIME",
  "REGIST_USER",
  "UPDATE_DATETIME",
  "UPDATE_USER",
  "USER_ID",
  "ACCOUNT_NAME",
  "COLOR",
  "ICON_PATH",
  "BALANCE",
  "SORT_ORDER",
] as const;

const CATEGORY_HEADER = [
  "ID",
  "VERSION",
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
  "VERSION",
  "REGIST_DATETIME",
  "REGIST_USER",
  "UPDATE_DATETIME",
  "UPDATE_USER",
  "TAG_NAME",
  "COLOR",
  "ICON_PATH",
  "SORT_ORDER",
] as const;

const ACCOUNT_PERMISSION_HEADER = [
  "ID",
  "VERSION",
  "REGIST_DATETIME",
  "REGIST_USER",
  "UPDATE_DATETIME",
  "UPDATE_USER",
  "ACCOUNT_ID",
  "USER_ID",
  "PERMISSION_TYPE",
] as const;

/**
 * 勘定一覧を ACCOUNT.csv 形式の CSV 文字列に変換する。
 * @param rows - 勘定行のオブジェクト配列
 * @returns CSV 文字列
 */
export function accountListToCsv(rows: Record<string, string>[]): string {
  return toCsvString([...ACCOUNT_HEADER], rows);
}

/**
 * カテゴリー一覧を CATEGORY.csv 形式の CSV 文字列に変換する。
 * @param rows - カテゴリー行のオブジェクト配列
 * @returns CSV 文字列
 */
export function categoryListToCsv(rows: Record<string, string>[]): string {
  return toCsvString([...CATEGORY_HEADER], rows);
}

/**
 * タグ一覧を TAG.csv 形式の CSV 文字列に変換する。
 * @param rows - タグ行のオブジェクト配列
 * @returns CSV 文字列
 */
export function tagListToCsv(rows: Record<string, string>[]): string {
  return toCsvString([...TAG_HEADER], rows);
}

/**
 * 勘定参照権限一覧を ACCOUNT_PERMISSION.csv 形式の CSV 文字列に変換する。
 * @param rows - 権限行のオブジェクト配列
 * @returns CSV 文字列
 */
export function accountPermissionListToCsv(rows: Record<string, string>[]): string {
  return toCsvString([...ACCOUNT_PERMISSION_HEADER], rows);
}

const ACCOUNT_HISTORY_HEADER = [
  "ID",
  "VERSION",
  "REGIST_DATETIME",
  "REGIST_USER",
  "UPDATE_DATETIME",
  "UPDATE_USER",
  "ACCOUNT_ID",
  "TRANSACTION_ID",
  "BALANCE",
  "TRANSACTION_STATUS",
] as const;

/**
 * 勘定項目履歴一覧を ACCOUNT_HISTORY.csv 形式の CSV 文字列に変換する。
 * @param rows - 勘定項目履歴行のオブジェクト配列
 * @returns CSV 文字列
 */
export function accountHistoryListToCsv(rows: Record<string, string>[]): string {
  return toCsvString([...ACCOUNT_HISTORY_HEADER], rows);
}

const TRANSACTION_HEADER = [
  "ID",
  "VERSION",
  "REGIST_DATETIME",
  "REGIST_USER",
  "UPDATE_DATETIME",
  "UPDATE_USER",
  "TRANSACTION_TYPE",
  "PROJECT_TYPE",
  "CATEGORY_ID",
  "NAME",
  "TRANDATE_FROM",
  "TRANDATE_TO",
  "FREQUENCY",
  "INTERVAL",
  "CYCLE_UNIT",
  "AMOUNT",
  "MEMO",
  "ACCOUNT_ID_IN",
  "ACCOUNT_ID_OUT",
  "PLAN_STATUS",
  "DLT_FLG",
] as const;

/**
 * 取引一覧を TRANSACTION.csv 形式の CSV 文字列に変換する。
 * @param rows - 取引行のオブジェクト配列
 * @returns CSV 文字列
 */
export function transactionListToCsv(rows: Record<string, string>[]): string {
  return toCsvString([...TRANSACTION_HEADER], rows);
}

const TRANSACTION_TAG_HEADER = [
  "ID",
  "VERSION",
  "REGIST_DATETIME",
  "REGIST_USER",
  "UPDATE_DATETIME",
  "UPDATE_USER",
  "TRANSACTION_ID",
  "TAG_ID",
] as const;

/**
 * 取引-タグ紐付け一覧を TRANSACTION_TAG.csv 形式の CSV 文字列に変換する。
 * @param rows - 紐付け行のオブジェクト配列
 * @returns CSV 文字列
 */
export function transactionTagListToCsv(rows: Record<string, string>[]): string {
  return toCsvString([...TRANSACTION_TAG_HEADER], rows);
}

const TRANSACTION_MANAGEMENT_HEADER = [
  "ID",
  "VERSION",
  "REGIST_DATETIME",
  "REGIST_USER",
  "UPDATE_DATETIME",
  "UPDATE_USER",
  "TRAN_PLAN_ID",
  "TRAN_ACTUAL_ID",
] as const;

/**
 * 取引予定-実績紐付け一覧を TRANSACTION_MANAGEMENT.csv 形式の CSV 文字列に変換する。
 * @param rows - 紐付け行のオブジェクト配列
 * @returns CSV 文字列
 */
export function transactionManagementListToCsv(rows: Record<string, string>[]): string {
  return toCsvString([...TRANSACTION_MANAGEMENT_HEADER], rows);
}

const USER_HEADER = [
  "ID",
  "VERSION",
  "REGIST_DATETIME",
  "REGIST_USER",
  "UPDATE_DATETIME",
  "UPDATE_USER",
  "NAME",
  "COLOR",
  "ICON_PATH",
] as const;

/**
 * ユーザー一覧を USER.csv 形式の CSV 文字列に変換する。
 * @param rows - ユーザー行のオブジェクト配列
 * @returns CSV 文字列
 */
export function userListToCsv(rows: Record<string, string>[]): string {
  return toCsvString([...USER_HEADER], rows);
}

const COLOR_PALETTE_HEADER = [
  "USER_ID",
  "SEQ_NO",
  "VERSION",
  "REGIST_DATETIME",
  "REGIST_USER",
  "UPDATE_DATETIME",
  "UPDATE_USER",
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

/**
 * カラーパレット一覧を COLOR_PALETTE.csv 形式の CSV 文字列に変換する。
 * @param rows - パレット行のオブジェクト配列
 * @returns CSV 文字列
 */
export function colorPaletteListToCsv(rows: Record<string, string>[]): string {
  return toCsvString([...COLOR_PALETTE_HEADER], rows);
}
