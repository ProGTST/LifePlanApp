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

/** カテゴリー（CATEGORY）の1行 */
export interface CategoryRow {
  ID: string;
  VERSION: string;
  REGIST_DATETIME: string;
  REGIST_USER: string;
  UPDATE_DATETIME: string;
  UPDATE_USER: string;
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
  TYPE: string;
  STATUS: string;
  CATEGORY_ID: string;
  NAME: string;
  TRANDATE_FROM: string;
  TRANDATE_TO: string;
  AMOUNT: string;
  MEMO: string;
  ACCOUNT_ID_IN: string;
  ACCOUNT_ID_OUT: string;
}

/** タグ管理（TAG_MANAGEMENT）の1行 */
export interface TagManagementRow {
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
