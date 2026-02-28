/** ユーザー（USER）の1行 */
export interface UserRow {
  ID: string;
  VERSION: string;
  REGIST_DATETIME: string;
  REGIST_USER: string;
  UPDATE_DATETIME: string;
  UPDATE_USER: string;
  NAME: string;
  /** プロフィールアイコン背景色（デフォルト表示時）。例: #646cff */
  COLOR?: string;
  ICON_PATH?: string;
}

/** 勘定項目（ACCOUNT）の1行 */
export interface AccountRow {
  ID: string;
  VERSION: string;
  REGIST_DATETIME: string;
  REGIST_USER: string;
  UPDATE_DATETIME: string;
  UPDATE_USER: string;
  USER_ID: string;
  ACCOUNT_NAME: string;
  /** 色（例: #ff0000） */
  COLOR?: string;
  /** アイコンパス（例: /icon/xxx.svg） */
  ICON_PATH?: string;
  /** 残高。初期値 0 */
  BALANCE?: string;
  SORT_ORDER?: string;
}

/** 勘定項目参照権限（ACCOUNT_PERMISSION）の1行 */
export interface AccountPermissionRow {
  ID: string;
  VERSION: string;
  REGIST_DATETIME: string;
  REGIST_USER: string;
  UPDATE_DATETIME: string;
  UPDATE_USER: string;
  ACCOUNT_ID: string;
  USER_ID: string;
  PERMISSION_TYPE: string;
}

/** 勘定項目履歴（ACCOUNT_HISTORY）の1行 */
export interface AccountHistoryRow {
  ID: string;
  VERSION: string;
  REGIST_DATETIME: string;
  REGIST_USER: string;
  UPDATE_DATETIME: string;
  UPDATE_USER: string;
  ACCOUNT_ID: string;
  TRANSACTION_ID: string;
  BALANCE: string;
  /** 取引ステータス: regist / update / delete */
  TRANSACTION_STATUS: string;
}

/** カテゴリー（CATEGORY）の1行 */
export interface CategoryRow {
  ID: string;
  VERSION: string;
  REGIST_DATETIME: string;
  REGIST_USER: string;
  UPDATE_DATETIME: string;
  UPDATE_USER: string;
  USER_ID: string;
  PARENT_ID: string;
  TYPE: string;
  CATEGORY_NAME: string;
  /** 色（例: #ff0000 やカラー名） */
  COLOR?: string;
  /** アイコンパス（例: /icon/xxx.svg） */
  ICON_PATH?: string;
  SORT_ORDER?: string;
}

/** タグ（TAG）の1行 */
export interface TagRow {
  ID: string;
  VERSION: string;
  REGIST_DATETIME: string;
  REGIST_USER: string;
  UPDATE_DATETIME: string;
  UPDATE_USER: string;
  USER_ID: string;
  TAG_NAME: string;
  /** 色（例: #ff0000） */
  COLOR?: string;
  /** アイコンパス（例: /icon/xxx.svg） */
  ICON_PATH?: string;
  SORT_ORDER?: string;
}

/** 収支（TRANSACTION）の1行 */
export interface TransactionRow {
  ID: string;
  VERSION: string;
  REGIST_DATETIME: string;
  REGIST_USER: string;
  UPDATE_DATETIME: string;
  UPDATE_USER: string;
  TRANSACTION_TYPE: string;
  PROJECT_TYPE: string;
  CATEGORY_ID: string;
  NAME: string;
  TRANDATE_FROM: string;
  TRANDATE_TO: string;
  /** 頻度: day / daily / weekly / monthly / yearly */
  FREQUENCY?: string;
  /** 間隔（day のとき 0、それ以外は 1 以上） */
  INTERVAL?: string;
  /** 繰り返し単位（週・日・年指定の結合。day/daily のとき空） */
  CYCLE_UNIT?: string;
  AMOUNT: string;
  MEMO: string;
  ACCOUNT_ID_IN: string;
  ACCOUNT_ID_OUT: string;
  /** 予定完了日（予定取引のみ）。カンマ区切りで複数日付を保持。例: "2026-01-01,2026-02-05" */
  COMPLETED_PLANDATE?: string;
  /** 予定状況: planning（計画中） / complete（完了） / canceled（中止） */
  PLAN_STATUS?: string;
  /** 削除フラグ: 0＝有効、1＝削除扱い（論理削除） */
  DLT_FLG?: string;
}

/** タグ管理（TRANSACTION_TAG）の1行 */
export interface TransactionTagRow {
  ID: string;
  VERSION: string;
  REGIST_DATETIME: string;
  REGIST_USER: string;
  UPDATE_DATETIME: string;
  UPDATE_USER: string;
  TRANSACTION_ID: string;
  TAG_ID: string;
}

/** 取引予定-実績紐付け（TRANSACTION_MANAGEMENT）の1行 */
export interface TransactionManagementRow {
  ID: string;
  VERSION: string;
  REGIST_DATETIME: string;
  REGIST_USER: string;
  UPDATE_DATETIME: string;
  UPDATE_USER: string;
  TRAN_PLAN_ID: string;
  TRAN_ACTUAL_ID: string;
}
