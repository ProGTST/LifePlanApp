/** 画面ID（index.html はアプリのみのため APP_SCREEN_ID は #app の識別用） */
export const LOGIN_SCREEN_ID = "login-screen";
export const APP_SCREEN_ID = "app";

/** 認証・画面遷移（案1: ログインとアプリで2ファイル） */
export const USER_ID_STORAGE_KEY = "userId";
export const LOGIN_PAGE_PATH = "login.html";
export const APP_PAGE_PATH = "index.html";

/** メインコンテンツのコンテナセレクタ */
export const MAIN_VIEW_CONTAINER = ".app-main";

/** サイドバーパネル種別 */
export const SIDEBAR_PANEL_MENU = "menu";
export const SIDEBAR_PANEL_SETTINGS = "settings";

/** デフォルトのメインビュー */
export const DEFAULT_VIEW = "home";

/** ビューIDとメニューバー表示タイトルの対応 */
export const VIEW_TITLES: Record<string, string> = {
  home: "ホーム",
  schedule: "スケジュール",
  calendar: "カレンダー",
  "transaction-history": "収支履歴",
  "transaction-history-weekly": "カレンダー",
  "transaction-history-calendar": "カレンダー",
  "transaction-entry": "収支記録",
  "transaction-analysis": "収支分析",
  account: "勘定項目",
  category: "カテゴリー",
  tag: "タグ",
  profile: "プロフィール",
  design: "デザイン",
  system: "システム",
};

/** 一覧・追加ボタン・フッター「戻る」を表示するビュー（勘定・カテゴリー・タグ） */
export const MASTER_LIST_VIEW_IDS = ["account", "category", "tag"] as const;

/** カラーパレットのキー一覧 */
export const PALETTE_KEYS = [
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

/** パレットキー → CSS変数名 */
export const CSS_VAR_MAP: Record<(typeof PALETTE_KEYS)[number], string> = {
  MENUBAR_BG: "--color-menubar-bg",
  MENUBAR_FG: "--color-menubar-fg",
  HEADER_BG: "--color-header-bg",
  HEADER_FG: "--color-header-fg",
  MAIN_BG: "--color-main-bg",
  MAIN_FG: "--color-main-fg",
  VIEW_BG: "--color-view-bg",
  VIEW_FG: "--color-view-fg",
  FOOTER_BG: "--color-footer-bg",
  FOOTER_FG: "--color-footer-fg",
  BUTTON_BG: "--color-button-bg",
  BUTTON_FG: "--color-button-fg",
  BASE_BG: "--color-base-bg",
  BASE_FG: "--color-base-fg",
  ACCENT_BG: "--color-accent-bg",
  ACCENT_FG: "--color-accent-fg",
};

/** デフォルトのパレット色 */
export const DEFAULT_PALETTE: Record<(typeof PALETTE_KEYS)[number], string> = {
  MENUBAR_BG: "#2c2c2e",
  MENUBAR_FG: "#ffffff",
  HEADER_BG: "#ffffff",
  HEADER_FG: "#1a1a1a",
  MAIN_BG: "#f0f2f5",
  MAIN_FG: "#1a1a1a",
  VIEW_BG: "#ffffff",
  VIEW_FG: "#1a1a1a",
  FOOTER_BG: "#ffffff",
  FOOTER_FG: "#666666",
  BUTTON_BG: "#646cff",
  BUTTON_FG: "#ffffff",
  BASE_BG: "#ffffff",
  BASE_FG: "#333333",
  ACCENT_BG: "#646cff",
  ACCENT_FG: "#ffffff",
};
