import {
  LOGIN_SCREEN_ID,
  APP_SCREEN_ID,
  MAIN_VIEW_CONTAINER,
  VIEW_TITLES,
  MASTER_LIST_VIEW_IDS,
} from "../constants/index";
import { currentView, setCurrentView } from "../state";

const viewHandlers: Record<string, () => void> = {};
/** 画面遷移時（離脱時）に呼ぶ保存処理。viewId -> fn */
const leaveSaveHandlers: Record<string, () => void> = {};

export function registerLeaveSaveHandler(viewId: string, fn: () => void): void {
  leaveSaveHandlers[viewId] = fn;
}

export function registerViewHandler(viewId: string, fn: () => void): void {
  viewHandlers[viewId] = fn;
}

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

  container.querySelectorAll(".main-view").forEach((el) => {
    const v = el as HTMLElement;
    const isTarget = v.dataset.view === viewId || v.id === viewId;
    v.classList.toggle("main-view--hidden", !isTarget);
  });

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
  if (headerResetConditionsBtn) headerResetConditionsBtn.classList.toggle("is-visible", viewId === "transaction-history");
  const headerRefreshBtn = document.getElementById("transaction-history-refresh-btn");
  if (headerRefreshBtn) headerRefreshBtn.classList.toggle("is-visible", viewId === "transaction-history");

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
    viewId === "transaction-history" || viewId === "transaction-entry" || viewId === "transaction-analysis";
  const footerHomeBtn = document.getElementById("footer-home-btn");
  const footerScheduleBtn = document.getElementById("footer-schedule-btn");
  const footerHistoryBtn = document.getElementById("footer-history-btn");
  const footerEntryBtn = document.getElementById("footer-entry-btn");
  const footerAnalysisBtn = document.getElementById("footer-analysis-btn");
  const footerMenuBtn = document.getElementById("footer-menu-btn");
  const footerSettingsBtn = document.getElementById("footer-settings-btn");
  const footerBackBtn = document.getElementById("footer-back-btn");
  if (footerHomeBtn) footerHomeBtn.classList.toggle("is-visible", showFooterNav || isTransactionView);
  if (footerScheduleBtn) footerScheduleBtn.classList.toggle("is-visible", isMasterListOnly);
  if (footerHistoryBtn)
    footerHistoryBtn.classList.toggle(
      "is-visible",
      isMasterListOnly || viewId === "transaction-entry" || viewId === "transaction-analysis"
    );
  if (footerEntryBtn)
    footerEntryBtn.classList.toggle(
      "is-visible",
      viewId === "transaction-history" || viewId === "transaction-analysis"
    );
  if (footerAnalysisBtn)
    footerAnalysisBtn.classList.toggle(
      "is-visible",
      viewId === "transaction-history" || viewId === "transaction-entry"
    );
  if (footerMenuBtn) footerMenuBtn.classList.toggle("is-visible", isProfileOrDesign);
  if (footerSettingsBtn) footerSettingsBtn.classList.toggle("is-visible", isProfileOrDesign);
  if (footerBackBtn) footerBackBtn.classList.toggle("is-visible", showFooterNav || isTransactionView);

  viewHandlers[viewId]?.();
}
