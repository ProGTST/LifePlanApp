import {
  LOGIN_SCREEN_ID,
  APP_SCREEN_ID,
  MAIN_VIEW_CONTAINER,
  VIEW_TITLES,
  MASTER_LIST_VIEW_IDS,
} from "../constants/index";
import { currentView, setCurrentView, setTransactionHistoryInitialTab } from "../state";
import { loadFormFromFilterState, applySearchAccordionStateForView } from "../screens/transaction-history-screen";

const viewHandlers: Record<string, () => void> = {};
/** メニューバーの「データ最新化」押下時に呼ぶハンドラ。viewId -> fn（CSV から再取得して再描画） */
const refreshHandlers: Record<string, () => void> = {};
/** 画面遷移時（離脱時）に呼ぶ保存処理。viewId -> fn */
const leaveSaveHandlers: Record<string, () => void> = {};

/**
 * 指定ビューを離脱するときに呼ぶ保存処理を登録する。
 * @param viewId - ビュー ID
 * @param fn - 離脱時に実行する関数（保存処理など）
 * @returns なし
 */
export function registerLeaveSaveHandler(viewId: string, fn: () => void): void {
  leaveSaveHandlers[viewId] = fn;
}

/**
 * 指定ビューを表示するときに呼ぶハンドラ（データ取得・描画）を登録する。
 * @param viewId - ビュー ID
 * @param fn - 表示時に実行する関数
 * @returns なし
 */
export function registerViewHandler(viewId: string, fn: () => void): void {
  viewHandlers[viewId] = fn;
}

/**
 * 指定ビューでメニューバー「データ最新化」押下時に呼ぶハンドラを登録する。
 * @param viewId - ビュー ID
 * @param fn - CSV から再取得して再描画する関数
 * @returns なし
 */
export function registerRefreshHandler(viewId: string, fn: () => void): void {
  refreshHandlers[viewId] = fn;
}

/**
 * 現在のビュー用のデータ最新化を実行する。登録されていれば refresh ハンドラ、なければ view ハンドラを呼ぶ。
 * @returns なし
 */
export function triggerRefreshFromCsv(): void {
  const refreshFn = refreshHandlers[currentView];
  if (refreshFn) {
    refreshFn();
  } else {
    viewHandlers[currentView]?.();
  }
}

/**
 * ログイン画面またはアプリ画面のどちらを表示するか切り替える。
 * @param screenId - LOGIN_SCREEN_ID または APP_SCREEN_ID
 * @returns なし
 */
export function showScreen(screenId: string): void {
  const loginEl = document.getElementById(LOGIN_SCREEN_ID);
  const appEl = document.getElementById(APP_SCREEN_ID);
  if (!loginEl || !appEl) return;

  if (screenId === LOGIN_SCREEN_ID) {
    loginEl.classList.remove("screen--hidden");
    appEl.classList.add("screen--hidden");
  } else {
    loginEl.classList.add("screen--hidden");
    appEl.classList.remove("screen--hidden");
  }
}

/**
 * メインコンテンツ領域で表示するビューを切り替える。離脱時の保存処理を実行し、ヘッダー・フッターの表示を更新する。
 * @param viewId - 表示するビュー ID（home, account, profile 等）
 * @returns なし
 */
export function showMainView(viewId: string): void {
  const container = document.querySelector(MAIN_VIEW_CONTAINER);
  if (!container) return;

  const previousView = currentView;
  // 編集中のセル（contenteditable 等）の blur を発生させ、変更を state に反映してから保存する
  const active = document.activeElement as HTMLElement | null;
  if (active?.isContentEditable || active?.tagName === "INPUT" || active?.tagName === "SELECT" || active?.tagName === "TEXTAREA") {
    active.blur();
  }
  leaveSaveHandlers[previousView]?.();

  setCurrentView(viewId);

  const isTransactionHistorySubView =
    viewId === "transaction-history-weekly" || viewId === "transaction-history-calendar";
  if (isTransactionHistorySubView) {
    setTransactionHistoryInitialTab(viewId === "transaction-history-weekly" ? "weekly" : "calendar");
  }
  const effectiveViewId = isTransactionHistorySubView ? "transaction-history-calendar" : viewId;

  container.querySelectorAll(".main-view").forEach((el) => {
    const v = el as HTMLElement;
    const isTarget = v.dataset.view === effectiveViewId || v.id === `view-${effectiveViewId}`;
    v.classList.toggle("main-view--hidden", !isTarget);
  });

  const showSearchCommon =
    viewId === "transaction-history" || isTransactionHistorySubView || viewId === "schedule";
  const transactionHistoryCommon = document.getElementById("transaction-history-common");
  if (transactionHistoryCommon) {
    transactionHistoryCommon.classList.toggle("main-view--hidden", !showSearchCommon);
    transactionHistoryCommon.classList.toggle("is-schedule-search", viewId === "schedule");
  }
  if (showSearchCommon) {
    const formViewId =
      viewId === "schedule"
        ? "schedule"
        : viewId === "transaction-history-weekly" || viewId === "transaction-history-calendar"
          ? viewId
          : "transaction-history";
    loadFormFromFilterState(formViewId);
    applySearchAccordionStateForView(formViewId);
  }

  const menubarTitleEl = document.getElementById("menubar-title");
  if (menubarTitleEl) menubarTitleEl.textContent = VIEW_TITLES[viewId] ?? viewId;

  const showMasterTools = MASTER_LIST_VIEW_IDS.includes(viewId as (typeof MASTER_LIST_VIEW_IDS)[number]);
  const showFooterNav = showMasterTools || viewId === "profile" || viewId === "design";

  const headerAddBtn = document.getElementById("header-add-btn");
  if (headerAddBtn) headerAddBtn.classList.toggle("is-visible", showMasterTools);

  const headerDeleteBtn = document.getElementById("header-delete-btn");
  if (headerDeleteBtn) headerDeleteBtn.classList.toggle("is-visible", showMasterTools);

  const headerSaveBtn = document.getElementById("header-save-btn");
  if (headerSaveBtn) headerSaveBtn.classList.toggle("is-visible", viewId === "profile" || viewId === "design");

  const headerDefaultBtn = document.getElementById("header-default-btn");
  if (headerDefaultBtn) headerDefaultBtn.classList.toggle("is-visible", viewId === "design");

  const headerResetConditionsBtn = document.getElementById("transaction-history-reset-conditions-btn");
  if (headerResetConditionsBtn)
    headerResetConditionsBtn.classList.toggle(
      "is-visible",
      viewId === "transaction-history" || isTransactionHistorySubView || viewId === "schedule"
    );

  const headerTransactionEntrySubmit = document.getElementById("header-transaction-entry-submit");
  if (headerTransactionEntrySubmit) headerTransactionEntrySubmit.classList.toggle("is-visible", viewId === "transaction-entry");
  const headerTransactionEntryReset = document.getElementById("header-transaction-entry-reset");
  if (headerTransactionEntryReset) headerTransactionEntryReset.classList.toggle("is-visible", viewId === "transaction-entry");
  const headerTransactionEntryDelete = document.getElementById("header-transaction-entry-delete");
  if (headerTransactionEntryDelete) headerTransactionEntryDelete.classList.remove("is-visible");
  const headerTransactionEntryContinuous = document.getElementById("header-transaction-entry-continuous");
  if (headerTransactionEntryContinuous) headerTransactionEntryContinuous.classList.remove("is-visible");

  const viewOnlyNotice = document.getElementById("transaction-entry-view-only-notice");
  if (viewOnlyNotice && viewId !== "transaction-entry") {
    viewOnlyNotice.classList.remove("is-visible");
    viewOnlyNotice.setAttribute("aria-hidden", "true");
  }
  const headerTransactionEntryCopyAsNew = document.getElementById("header-transaction-entry-copy-as-new");
  if (headerTransactionEntryCopyAsNew && viewId !== "transaction-entry") {
    headerTransactionEntryCopyAsNew.classList.remove("is-visible");
  }

  const menubarProfileArea = document.getElementById("menubar-profile-area");
  if (menubarProfileArea) {
    const showProfile = viewId !== "profile";
    menubarProfileArea.classList.toggle("is-visible", showProfile);
    menubarProfileArea.setAttribute("aria-hidden", showProfile ? "false" : "true");
  }

  const isProfileOrDesign = viewId === "profile" || viewId === "design";
  const isMasterListOnly = showFooterNav && !isProfileOrDesign;
  const isTransactionView =
    viewId === "transaction-history" ||
    viewId === "transaction-history-weekly" ||
    viewId === "transaction-history-calendar" ||
    viewId === "transaction-entry" ||
    viewId === "transaction-analysis";
  const footerHomeBtn = document.getElementById("footer-home-btn");
  const footerCalendarBtn = document.getElementById("footer-calendar-btn");
  const footerScheduleBtn = document.getElementById("footer-schedule-btn");
  const footerHistoryBtn = document.getElementById("footer-history-btn");
  const footerEntryBtn = document.getElementById("footer-entry-btn");
  const footerAnalysisBtn = document.getElementById("footer-analysis-btn");
  const footerMenuBtn = document.getElementById("footer-menu-btn");
  const footerSettingsBtn = document.getElementById("footer-settings-btn");
  const footerBackBtn = document.getElementById("footer-back-btn");
  const isScheduleView = viewId === "schedule";
  if (footerHomeBtn) footerHomeBtn.classList.toggle("is-visible", showFooterNav || isTransactionView || isScheduleView);
  if (footerCalendarBtn)
    footerCalendarBtn.classList.toggle("is-visible", isScheduleView);
  if (footerScheduleBtn)
    footerScheduleBtn.classList.toggle("is-visible", (isMasterListOnly || isTransactionHistorySubView) && !isScheduleView);
  if (footerHistoryBtn)
    footerHistoryBtn.classList.toggle(
      "is-visible",
      isMasterListOnly ||
        isScheduleView ||
        viewId === "transaction-entry" ||
        viewId === "transaction-analysis" ||
        isTransactionHistorySubView
    );
  if (footerEntryBtn)
    footerEntryBtn.classList.toggle(
      "is-visible",
      (viewId === "transaction-history" || viewId === "transaction-analysis") && !isTransactionHistorySubView && !isScheduleView
    );
  if (footerAnalysisBtn)
    footerAnalysisBtn.classList.toggle(
      "is-visible",
      (viewId === "transaction-history" || viewId === "transaction-entry") && !isTransactionHistorySubView && !isScheduleView
    );
  if (footerMenuBtn) footerMenuBtn.classList.toggle("is-visible", isProfileOrDesign);
  if (footerSettingsBtn) footerSettingsBtn.classList.toggle("is-visible", isProfileOrDesign);
  if (footerBackBtn) footerBackBtn.classList.toggle("is-visible", showFooterNav || isTransactionView || isScheduleView);

  const handlerViewId = viewId;
  viewHandlers[handlerViewId]?.();
}
