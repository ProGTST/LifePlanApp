/**
 * データ登録・更新時の共通監査項目（ID, REGIST_*, UPDATE_*）を設定するユーティリティ。
 * 収支記録・勘定項目・カテゴリー・タグ・プロフィール・デザインで共通利用。
 */

/** 現在日時を "YYYY-MM-DD HH:mm:ss" 形式で返す */
export function getAuditTimestamp(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

/**
 * 新規登録時に監査項目を設定する。
 * 対象: ID, VERSION, REGIST_DATETIME, REGIST_USER, UPDATE_DATETIME, UPDATE_USER
 */
export function setNewRowAudit(
  row: Record<string, string>,
  userId: string,
  id: string
): void {
  const now = getAuditTimestamp();
  row.ID = id;
  row.VERSION = "0";
  row.REGIST_DATETIME = now;
  row.REGIST_USER = userId;
  row.UPDATE_DATETIME = now;
  row.UPDATE_USER = userId;
}

/**
 * 更新時に監査項目を設定する。
 * 対象: VERSION（インクリメント）, UPDATE_DATETIME, UPDATE_USER
 */
export function setUpdateAudit(row: Record<string, string>, userId: string): void {
  const now = getAuditTimestamp();
  const current = parseInt(String(row.VERSION ?? "0"), 10) || 0;
  row.VERSION = String(current + 1);
  row.UPDATE_DATETIME = now;
  row.UPDATE_USER = userId;
}

/**
 * 新規登録時（ID を持たない行用、例: COLOR_PALETTE）に監査項目を設定する。
 * 対象: VERSION, REGIST_DATETIME, REGIST_USER, UPDATE_DATETIME, UPDATE_USER
 */
export function setNewRowAuditWithoutId(row: Record<string, string>, userId: string): void {
  const now = getAuditTimestamp();
  row.VERSION = "0";
  row.REGIST_DATETIME = now;
  row.REGIST_USER = userId;
  row.UPDATE_DATETIME = now;
  row.UPDATE_USER = userId;
}
