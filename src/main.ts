import "./styles/app.css";
import {
  USER_ID_STORAGE_KEY,
  LOGIN_PAGE_PATH,
  MASTER_LIST_VIEW_IDS,
  SIDEBAR_PANEL_MENU,
  SIDEBAR_PANEL_SETTINGS,
} from "./constants/index";
import {
  setCurrentUserId,
  setAccountListLoaded,
  currentView,
  currentUserId,
  popNavigation,
  pushNavigation,
  setTransactionEntryEditId,
  setTransactionEntryViewOnly,
} from "./state";
import { startCsvWatch } from "./utils/csvWatch";
import { applyUserPalette } from "./app/palette";
import {
  initSidebarToggle,
  initSidebarMenu,
  updateCurrentMenuItem,
  openSidebarPanel,
} from "./app/sidebar";
import { showMainView, triggerRefreshFromCsv } from "./app/screen";
import { initHomeScreen } from "./screens/home-screen";
import { initAccountView } from "./screens/account-screen";
import { initCategoryView } from "./screens/category-screen";
import { initTagView } from "./screens/tag-screen";
import { initProfileView } from "./screens/profile-screen";
import { initDesignView } from "./screens/design-screen";
import { initTransactionHistoryView } from "./screens/transaction-history-screen";
import { initCalendarView } from "./screens/calendar-screen";
import { initScheduleView } from "./screens/schedule-screen";
import { initTransactionEntryView } from "./screens/transaction-entry-screen";

/**
 * アプリ画面の初期化を行う。各画面の init、フッター・サイドバーのイベント登録、初期表示ビュー「home」の表示、CSV 監視の開始を行う。
 * @returns なし
 */
function initAppScreen(): void {
  initHomeScreen();
  initSidebarToggle();
  initSidebarMenu();
  initAccountView();
  initCategoryView();
  initTagView();
  initProfileView();
  initDesignView();
  initTransactionHistoryView();
  initCalendarView();
  initScheduleView();
  initTransactionEntryView();

  /* メニューバー・データ最新化: 常に表示。押下で現在画面の CSV 再取得・再描画 */
  document.getElementById("menubar-refresh-btn")?.addEventListener("click", () => {
    triggerRefreshFromCsv();
  });

  /* フッター・ホーム / スケジュール / 収支履歴: メニュー遷移として該当画面へ */
  function navigateTo(view: string): void {
    showMainView(view);
    pushNavigation(view);
    updateCurrentMenuItem();
  }

  document.getElementById("footer-home-btn")?.addEventListener("click", () => navigateTo("home"));
  document.getElementById("footer-schedule-btn")?.addEventListener("click", () => navigateTo("schedule"));
  document.getElementById("footer-history-btn")?.addEventListener("click", () => navigateTo("transaction-history"));
  document.getElementById("calendar-view-to-history-btn")?.addEventListener("click", () => navigateTo("transaction-history"));
  document.getElementById("footer-entry-btn")?.addEventListener("click", () => {
    setTransactionEntryEditId(null);
    setTransactionEntryViewOnly(false);
    navigateTo("transaction-entry");
  });
  document.getElementById("footer-analysis-btn")?.addEventListener("click", () => navigateTo("transaction-analysis"));
  document.getElementById("footer-menu-btn")?.addEventListener("click", () => openSidebarPanel(SIDEBAR_PANEL_MENU));
  document.getElementById("footer-settings-btn")?.addEventListener("click", () => openSidebarPanel(SIDEBAR_PANEL_SETTINGS));

  /* 戻るボタン: 遷移スタックを pop してひとつ前の画面に戻る（戻り先はスタックに積まない） */
  document.getElementById("footer-back-btn")?.addEventListener("click", () => {
    const isTransactionView =
      currentView === "transaction-history" || currentView === "transaction-entry" || currentView === "transaction-analysis";
    const canGoBack =
      MASTER_LIST_VIEW_IDS.includes(currentView as (typeof MASTER_LIST_VIEW_IDS)[number]) ||
      currentView === "profile" ||
      currentView === "design" ||
      isTransactionView;
    if (!canGoBack) return;
    const target = popNavigation();
    if (target === null) return;
    showMainView(target);
    updateCurrentMenuItem();
  });

  /* 初期表示のヘッダー・フッター・プロフィール領域をホームに合わせる */
  showMainView("home");

  /* CSV 監視: 更新データのキーが localStorage の表示キーに含まれるときのみ通知（各画面で setDisplayedKeys を呼ぶこと） */
  startCsvWatch(() => ({ view: currentView, userId: currentUserId }));
}

window.addEventListener("DOMContentLoaded", () => {
  const userId = sessionStorage.getItem(USER_ID_STORAGE_KEY);
  if (!userId) {
    window.location.href = LOGIN_PAGE_PATH;
    return;
  }
  setCurrentUserId(userId);
  setAccountListLoaded(false);
  applyUserPalette(userId).then(() => {
    initAppScreen();
  });

  // Tauri 環境: ウィンドウ×ボタンで閉じる
  const isTauri = typeof (window as unknown as { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__?.invoke === "function";
  if (isTauri) {
    import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
      const appWindow = getCurrentWindow();
      await appWindow.center();
      await appWindow.onCloseRequested(async (event) => {
        event.preventDefault();
        await appWindow.destroy();
      });
    });
  }
});
