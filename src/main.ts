import "./styles/app.css";
import {
  USER_ID_STORAGE_KEY,
  LOGIN_PAGE_PATH,
  MASTER_LIST_VIEW_IDS,
  SIDEBAR_PANEL_MENU,
  SIDEBAR_PANEL_SETTINGS,
} from "./constants/index";
import { setCurrentUserId, setAccountListLoaded, currentView, popNavigation, pushNavigation, setTransactionEntryEditId } from "./state";
import { applyUserPalette } from "./app/palette";
import {
  initSidebarToggle,
  initSidebarMenu,
  updateCurrentMenuItem,
  openSidebarPanel,
} from "./app/sidebar";
import { showMainView, registerLeaveSaveHandler } from "./app/screen";
import { initHomeScreen } from "./screens/home-screen";
import { initAccountView } from "./screens/account-screen";
import { initCategoryView } from "./screens/category-screen";
import { initTagView } from "./screens/tag-screen";
import { initProfileView } from "./screens/profile-screen";
import { initDesignView } from "./screens/design-screen";
import { initTransactionHistoryView } from "./screens/transaction-history-screen";
import { initTransactionEntryView } from "./screens/transaction-entry-screen";
import { flushMasterToStorage } from "./utils/flushMasterStorage.ts";
import { saveAccountCsvOnly, saveCategoryCsvOnly, saveTagCsvOnly } from "./utils/saveMasterCsv.ts";
import { saveDirtyCsvsOnly } from "./utils/saveDirtyCsvs.ts";

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
  initTransactionEntryView();

  registerLeaveSaveHandler("account", saveAccountCsvOnly);
  registerLeaveSaveHandler("category", saveCategoryCsvOnly);
  registerLeaveSaveHandler("tag", saveTagCsvOnly);

  /* フッター・ホーム / スケジュール / 収支履歴: メニュー遷移として該当画面へ */
  function navigateTo(view: string): void {
    showMainView(view);
    pushNavigation(view);
    updateCurrentMenuItem();
  }

  document.getElementById("footer-home-btn")?.addEventListener("click", () => navigateTo("home"));
  document.getElementById("footer-schedule-btn")?.addEventListener("click", () => navigateTo("schedule"));
  document.getElementById("footer-history-btn")?.addEventListener("click", () => navigateTo("transaction-history"));
  document.getElementById("footer-entry-btn")?.addEventListener("click", () => {
    setTransactionEntryEditId(null);
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
    updateCurrentMenuItem();
    showMainView(target);
  });

  /* 初期表示のヘッダー・フッター・プロフィール領域をホームに合わせる */
  showMainView("home");
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

  // タブ/ウィンドウを閉じる直前にメモリ上のマスタを localStorage に書き出す（CSV は Tauri 時のみ）
  window.addEventListener("beforeunload", () => {
    flushMasterToStorage();
  });
  window.addEventListener("pagehide", () => {
    flushMasterToStorage();
  });

  // Tauri 環境: ウィンドウ×ボタンで閉じる前に保存してから閉じる。保存に失敗しても必ず destroy する
  const isTauri = typeof (window as unknown as { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__?.invoke === "function";
  if (isTauri) {
    import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
      const appWindow = getCurrentWindow();
      await appWindow.center();
      await appWindow.onCloseRequested(async (event) => {
        event.preventDefault();
        try {
          await saveDirtyCsvsOnly();
        } finally {
          await appWindow.destroy();
        }
      });
    });
  }
});
