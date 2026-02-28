import {
  LOGIN_PAGE_PATH,
  USER_ID_STORAGE_KEY,
  SIDEBAR_PANEL_MENU,
  SIDEBAR_PANEL_SETTINGS,
} from "../constants/index";
import {
  currentView,
  pushNavigation,
  setSidebarOpenPanel,
  sidebarOpenPanel,
} from "../state";
import { showMainView } from "./screen";
import { stopCsvWatch } from "../utils/csvWatch";
import { saveDirtyCsvsOnly } from "../utils/saveDirtyCsvs";

/**
 * サイドバーを閉じ、開いていたパネル状態をクリアする。
 * @returns なし
 */
export function closeSidebar(): void {
  const sidebar = document.getElementById("app-sidebar");
  if (sidebar) {
    sidebar.classList.remove("is-visible");
    sidebar.setAttribute("aria-hidden", "true");
  }
  setSidebarOpenPanel(null);
}

/**
 * フッター等からサイドバーを指定パネル（メニュー or 設定）で開く。既に同じパネルで開いていれば閉じる。
 * @param panel - SIDEBAR_PANEL_MENU または SIDEBAR_PANEL_SETTINGS
 * @returns なし
 */
export function openSidebarPanel(panel: string): void {
  const sidebar = document.getElementById("app-sidebar");
  const panelMenu = document.getElementById("sidebar-panel-menu");
  const panelSettings = document.getElementById("sidebar-panel-settings");
  if (!sidebar || !panelMenu || !panelSettings) return;
  const alreadyOpen = sidebar.classList.contains("is-visible");
  // 既に同じパネルで開いていれば閉じる、それ以外は該当パネルを表示
  if (alreadyOpen && sidebarOpenPanel === panel) {
    sidebar.classList.remove("is-visible");
    sidebar.setAttribute("aria-hidden", "true");
    setSidebarOpenPanel(null);
  } else {
    // 指定パネルを active にし、サイドバーを表示
    panelMenu.classList.toggle("is-active", panel === SIDEBAR_PANEL_MENU);
    panelSettings.classList.toggle("is-active", panel === SIDEBAR_PANEL_SETTINGS);
    setSidebarOpenPanel(panel);
    sidebar.classList.add("is-visible");
    sidebar.setAttribute("aria-hidden", "false");
  }
}

const MENU_CURRENT_CLASS = "is-current";
const SETTINGS_CURRENT_CLASS = "is-current";

/**
 * サイドバーのメニュー・設定項目のうち、現在のビューに一致するものを「現在」スタイルにし、他を更新する。
 * @returns なし
 */
export function updateCurrentMenuItem(): void {
  const items = document.querySelectorAll<HTMLButtonElement>(".sidebar-menu-item");
  items.forEach((btn) => {
    const isCurrent = btn.dataset.view === currentView;
    btn.classList.remove(MENU_CURRENT_CLASS);
    if (isCurrent) btn.classList.add(MENU_CURRENT_CLASS);
    btn.disabled = isCurrent;
  });
  const settingsItems = document.querySelectorAll<HTMLButtonElement>(".sidebar-settings-item");
  settingsItems.forEach((btn) => {
    const isCurrent = btn.dataset.view === currentView;
    btn.classList.remove(SETTINGS_CURRENT_CLASS);
    if (isCurrent) btn.classList.add(SETTINGS_CURRENT_CLASS);
    btn.disabled = isCurrent;
  });
}

/**
 * サイドバーの開閉ボタン・メニュー切替・ログアウトのイベントを初期化する。
 * @returns なし
 */
export function initSidebarToggle(): void {
  const sidebar = document.getElementById("app-sidebar");
  const panelMenu = document.getElementById("sidebar-panel-menu");
  const panelSettings = document.getElementById("sidebar-panel-settings");
  const menuBtn = document.getElementById("menubar-toggle-menu");
  if (!sidebar || !panelMenu || !panelSettings || !menuBtn) return;

  function showPanel(panel: string): void {
    panelMenu?.classList.toggle("is-active", panel === SIDEBAR_PANEL_MENU);
    panelSettings?.classList.toggle("is-active", panel === SIDEBAR_PANEL_SETTINGS);
    setSidebarOpenPanel(panel);
  }

  function openSidebar(panel: string): void {
    const alreadyOpen = sidebar?.classList.contains("is-visible");
    if (alreadyOpen && sidebarOpenPanel === panel) {
      sidebar?.classList.remove("is-visible");
      sidebar?.setAttribute("aria-hidden", "true");
      setSidebarOpenPanel(null);
    } else {
      showPanel(panel);
      sidebar?.classList.add("is-visible");
      sidebar?.setAttribute("aria-hidden", "false");
    }
  }

  /** メニューボタン：現在表示中の画面が設定系なら設定パネル、それ以外はメニューパネルを開く */
  const SETTINGS_VIEW_IDS = ["profile", "design", "system"];
  menuBtn.addEventListener("click", () => {
    const panel = SETTINGS_VIEW_IDS.includes(currentView) ? SIDEBAR_PANEL_SETTINGS : SIDEBAR_PANEL_MENU;
    openSidebar(panel);
  });

  const menuCloseBtn = document.getElementById("sidebar-menu-close-btn");
  menuCloseBtn?.addEventListener("click", closeSidebar);

  const settingsCloseBtn = document.getElementById("sidebar-settings-close-btn");
  settingsCloseBtn?.addEventListener("click", closeSidebar);

  const settingsToMenuBtn = document.getElementById("sidebar-settings-to-menu");
  settingsToMenuBtn?.addEventListener("click", () => {
    showPanel(SIDEBAR_PANEL_MENU);
  });

  const menuToSettingsBtn = document.getElementById("sidebar-menu-to-settings");
  menuToSettingsBtn?.addEventListener("click", () => {
    showPanel(SIDEBAR_PANEL_SETTINGS);
  });

  async function handleLogout(): Promise<void> {
    if (!confirm("ログアウトしますが、よろしいですか？")) return;
    sidebar?.classList.remove("is-visible");
    sidebar?.setAttribute("aria-hidden", "true");
    setSidebarOpenPanel(null);
    stopCsvWatch();
    await saveDirtyCsvsOnly();
    sessionStorage.removeItem(USER_ID_STORAGE_KEY);
    window.location.href = LOGIN_PAGE_PATH;
  }

  const logoutBtn = document.getElementById("menubar-logout");
  logoutBtn?.addEventListener("click", handleLogout);

  const settingsLogoutBtn = document.getElementById("sidebar-settings-logout-btn");
  settingsLogoutBtn?.addEventListener("click", handleLogout);
}

/**
 * サイドバーのメニュー・設定項目のクリックで画面遷移するようにイベントを登録する。
 * @returns なし
 */
export function initSidebarMenu(): void {
  updateCurrentMenuItem();
  document.querySelectorAll(".sidebar-menu-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const view = (btn as HTMLButtonElement).dataset.view;
      if (!view || view === currentView) return;
      closeSidebar();
      showMainView(view);
      pushNavigation(view);
      updateCurrentMenuItem();
    });
  });
  document.querySelectorAll(".sidebar-settings-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const view = (btn as HTMLButtonElement).dataset.view;
      if (!view || view === currentView) return;
      closeSidebar();
      showMainView(view);
      pushNavigation(view);
      updateCurrentMenuItem();
    });
  });
}
