/**
 * 収支履歴・カレンダー・スケジュールで共通利用する検索フォーム（日付・カテゴリ・タグ・勘定・予定/実績等）の制御。
 * transaction-history-screen に依存せず、state と utils のみで動作する。
 */
import type { CategoryRow, AccountRow } from "../types";
import {
  currentView,
  currentUserId,
  historyFilterState,
  calendarFilterState,
  scheduleFilterState,
  schedulePlanStatuses,
  calendarPlanStatuses,
  setHistoryFilterState,
  setCalendarFilterState,
  setScheduleFilterState,
  setSchedulePlanStatuses,
  setCalendarPlanStatuses,
} from "../state";
import type { SchedulePlanStatus } from "../state";
import { runFilterChangeCallbacks } from "./transactionDataLayout";
import { registerHistoryFilterDateSetter } from "./transactionDataLayout";
import {
  getCategoryById,
  getAccountById,
  getTagRows,
  getCategoryRows,
  getAccountRows,
  getPermissionRows,
} from "./transactionDataSync";
import type { FilterState } from "./transactionDataFilter";
import { sortOrderNum } from "./dragSort";
import { createIconWrap } from "./iconWrap";
import { openOverlay, closeOverlay } from "./overlay";
import { ICON_DEFAULT_COLOR } from "../constants/colorPresets";

/** 検索条件アコーディオンの開閉をビューごとに保持 */
const searchAccordionOpenByView: Record<string, boolean> = {};

/**
 * 現在のビューに応じた検索条件（FilterState）のコピーを返す。
 * @returns 収支履歴・カレンダー・スケジュールのいずれかの FilterState
 */
function getActiveFilterState(): FilterState {
  // スケジュール画面のときはスケジュール用検索条件を返す
  if (currentView === "schedule") return { ...scheduleFilterState };
  // 週・月カレンダー表示のときはカレンダー用検索条件を返す
  if (
    currentView === "transaction-history-weekly" ||
    currentView === "transaction-history-calendar"
  ) {
    return { ...calendarFilterState };
  }
  // 収支履歴一覧タブ
  return { ...historyFilterState };
}

/**
 * 現在のビューに応じた検索条件 state を部分更新する。
 * @param partial - 更新するフィールドのみのオブジェクト
 * @returns なし
 */
function setActiveFilterState(partial: Partial<FilterState>): void {
  // 現在ビューに応じて更新先の state を切り替えてマージ
  if (currentView === "schedule") {
    setScheduleFilterState(partial);
    return;
  }
  if (
    currentView === "transaction-history-weekly" ||
    currentView === "transaction-history-calendar"
  ) {
    setCalendarFilterState(partial);
    return;
  }
  setHistoryFilterState(partial);
}

/** 現在のビューに応じた予定ステータス（計画中/完了/中止）の配列を返す。 */
function getActivePlanStatuses(): SchedulePlanStatus[] {
  if (currentView === "schedule") return [...schedulePlanStatuses];
  if (
    currentView === "transaction-history-weekly" ||
    currentView === "transaction-history-calendar"
  ) {
    return [...calendarPlanStatuses];
  }
  return [...schedulePlanStatuses];
}

/** 現在のビューに応じて予定ステータスを更新する。 */
function setActivePlanStatuses(value: SchedulePlanStatus[]): void {
  if (currentView === "schedule") {
    setSchedulePlanStatuses(value);
    return;
  }
  if (
    currentView === "transaction-history-weekly" ||
    currentView === "transaction-history-calendar"
  ) {
    setCalendarPlanStatuses(value);
    return;
  }
  setSchedulePlanStatuses(value);
}

/**
 * フィルター変更を通知し、登録済みコールバック（一覧・カレンダー・スケジュールの再描画）を実行する。
 * @returns なし
 */
function notifyFilterChange(): void {
  runFilterChangeCallbacks();
}

/**
 * 指定ビュー用の検索条件をフォームに反映する。ビュー切替時に app/screen から呼ぶ。
 * @param viewId - ビュー ID（transaction-history / transaction-history-weekly / transaction-history-calendar / schedule）
 * @returns なし
 */
export function loadFormFromFilterState(viewId: string): void {
  // viewId に応じて参照する state を取得（schedule / カレンダー / 収支履歴一覧）
  const isCalendar =
    viewId === "transaction-history-calendar" || viewId === "transaction-history-weekly";
  const state = viewId === "schedule"
    ? { ...scheduleFilterState }
    : isCalendar
      ? { ...calendarFilterState }
      : { ...historyFilterState };
  // 日付範囲をフォームに反映
  const dateFromEl = document.getElementById("transaction-history-date-from") as HTMLInputElement | null;
  const dateToEl = document.getElementById("transaction-history-date-to") as HTMLInputElement | null;
  if (dateFromEl) {
    dateFromEl.value = state.filterDateFrom;
    dateFromEl.classList.toggle("is-empty", !state.filterDateFrom);
  }
  if (dateToEl) {
    dateToEl.value = state.filterDateTo;
    dateToEl.classList.toggle("is-empty", !state.filterDateTo);
  }
  // 金額・フリーテキストをフォームに反映
  const amountMinEl = document.getElementById("transaction-history-amount-min") as HTMLInputElement | null;
  const amountMaxEl = document.getElementById("transaction-history-amount-max") as HTMLInputElement | null;
  if (amountMinEl) amountMinEl.value = state.filterAmountMin;
  if (amountMaxEl) amountMaxEl.value = state.filterAmountMax;
  const freeTextEl = document.getElementById("transaction-history-free-text") as HTMLInputElement | null;
  if (freeTextEl) freeTextEl.value = state.filterFreeText;
  syncFilterButtons();
  updateChosenDisplays();
  // スケジュール・カレンダーではステータス（計画中/完了/中止）行を表示するため、ボタンの ON/OFF を state に同期
  if (viewId === "schedule" || isCalendar) syncPlanStatusButtons();
}

/**
 * 指定ビュー用の検索条件アコーディオン開閉状態を反映する。ビュー切替時に app/screen から呼ぶ。
 * @param viewId - ビュー ID
 * @returns なし
 */
export function applySearchAccordionStateForView(viewId: string): void {
  const common = document.getElementById("transaction-history-common");
  const accordion = common?.querySelector(".transaction-history-search-accordion");
  if (accordion instanceof HTMLDetailsElement) {
    // ビューごとに保持した開閉状態を復元
    accordion.open = searchAccordionOpenByView[viewId] ?? false;
  }
}

/**
 * 検索条件に合わせて予定/実績・収入/支出/振替のボタンの is-active を同期する。
 * @returns なし
 */
function syncFilterButtons(): void {
  const state = getActiveFilterState();
  const searchArea = document.getElementById("transaction-history-common");
  if (!searchArea) return;
  // 予定/実績ボタンの is-active を state に合わせる
  searchArea.querySelectorAll(".transaction-history-filter-btn[data-status]").forEach((b) => {
    const s = (b as HTMLButtonElement).dataset.status as "plan" | "actual";
    b.classList.toggle("is-active", state.filterStatus.includes(s));
  });
  // 収入/支出/振替ボタンの is-active を state に合わせる
  searchArea.querySelectorAll(".transaction-history-filter-btn[data-type]").forEach((b) => {
    const t = (b as HTMLButtonElement).dataset.type as "income" | "expense" | "transfer";
    b.classList.toggle("is-active", state.filterType.includes(t));
  });
}

/**
 * スケジュール画面用のステータス（計画中/完了/中止）ボタンの is-active を state に合わせる。複数選択表示。
 * @returns なし
 */
function syncPlanStatusButtons(): void {
  const searchArea = document.getElementById("transaction-history-common");
  if (!searchArea) return;
  const active = getActivePlanStatuses();
  searchArea.querySelectorAll(".transaction-history-filter-btn[data-plan-status]").forEach((b) => {
    const value = (b as HTMLButtonElement).dataset.planStatus as SchedulePlanStatus;
    b.classList.toggle("is-active", active.includes(value));
  });
}

const CHOSEN_REMOVE_ICON = "/icon/circle-xmark-solid-full.svg";
const CHOSEN_LABEL_DEFAULT_BG = "#646cff";
const CHOSEN_LABEL_DEFAULT_FG = "#ffffff";

/**
 * カテゴリ・タグ・勘定の「選択中」表示エリアにラベルを描画する。
 * @param container - 表示先要素（null のときは何もしない）
 * @param ids - 選択中 ID の配列
 * @param getName - ID から表示名を返す関数
 * @param onRemove - 削除ボタン押下時のコールバック（省略可）
 * @param getColor - ID から色を返す関数（省略可）
 * @returns なし
 */
function setChosenDisplayLabels(
  container: HTMLElement | null,
  ids: string[],
  getName: (id: string) => string | undefined,
  onRemove?: (id: string) => void,
  getColor?: (id: string) => string | undefined
): void {
  if (!container) return;
  container.textContent = "";
  if (ids.length === 0) {
    container.textContent = "未選択";
    return;
  }
  // 選択中 ID ごとにラベル（＋削除ボタン）を追加
  for (const id of ids) {
    const name = getName(id)?.trim() || "—";
    const wrap = document.createElement("span");
    wrap.className = "transaction-history-chosen-label-wrap";
    const bg = (getColor?.(id) ?? "").trim() || CHOSEN_LABEL_DEFAULT_BG;
    wrap.style.backgroundColor = bg;
    wrap.style.color = CHOSEN_LABEL_DEFAULT_FG;
    const label = document.createElement("span");
    label.className = "transaction-history-chosen-label";
    label.textContent = name;
    wrap.appendChild(label);
    // 削除コールバックがある場合のみ削除ボタンを付与
    if (onRemove) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "transaction-history-chosen-label-remove";
      btn.setAttribute("aria-label", "選択から削除");
      const img = document.createElement("img");
      img.src = CHOSEN_REMOVE_ICON;
      img.alt = "";
      btn.appendChild(img);
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        onRemove(id);
      });
      wrap.appendChild(btn);
    }
    container.appendChild(wrap);
  }
}

/**
 * 検索条件のカテゴリ・タグ・勘定の選択表示を再描画し、フィルターボタンと同期する。
 * @returns なし
 */
function updateChosenDisplays(): void {
  const state = getActiveFilterState();
  const categoryEl = document.getElementById("transaction-history-category-display");
  const tagEl = document.getElementById("transaction-history-tag-display");
  const accountEl = document.getElementById("transaction-history-account-display");
  // カテゴリの選択表示を描画（削除時は state 更新・再描画・フィルター通知）
  setChosenDisplayLabels(
    categoryEl,
    state.filterCategoryIds,
    (id) => getCategoryById(id)?.CATEGORY_NAME,
    (id) => {
      setActiveFilterState({
        filterCategoryIds: state.filterCategoryIds.filter((x) => x !== id),
      });
      updateChosenDisplays();
      notifyFilterChange();
    },
    (id) => getCategoryById(id)?.COLOR
  );
  // タグの選択表示を描画
  setChosenDisplayLabels(
    tagEl,
    state.filterTagIds,
    (id) => getTagRows().find((r) => r.ID === id)?.TAG_NAME,
    (id) => {
      setActiveFilterState({
        filterTagIds: state.filterTagIds.filter((x) => x !== id),
      });
      updateChosenDisplays();
      notifyFilterChange();
    },
    (id) => getTagRows().find((r) => r.ID === id)?.COLOR
  );
  // 勘定の選択表示を描画
  setChosenDisplayLabels(
    accountEl,
    state.filterAccountIds,
    (id) => getAccountById(id)?.ACCOUNT_NAME,
    (id) => {
      setActiveFilterState({
        filterAccountIds: state.filterAccountIds.filter((x) => x !== id),
      });
      updateChosenDisplays();
      notifyFilterChange();
    },
    (id) => getAccountById(id)?.COLOR
  );
}

/**
 * モーダル内の選択リストで選択中の ID 一覧を返す。
 * @param listContainerId - リストコンテナの id
 * @returns 選択中 ID の配列
 */
function getSelectedIdsFromList(listContainerId: string): string[] {
  const container = document.getElementById(listContainerId);
  if (!container) return [];
  // 選択中チェックボタンから行をたどり data-id を収集
  const selected = container.querySelectorAll<HTMLElement>(".transaction-history-select-item .transaction-history-select-check-btn.is-selected");
  return Array.from(selected)
    .map((btn) => btn.closest(".transaction-history-select-item")?.getAttribute("data-id"))
    .filter((id): id is string => id != null);
}

/**
 * カテゴリ・タグ・勘定選択モーダル用の1行（チェック・アイコン・名前）を生成する。
 * @param id - 項目 ID
 * @param name - 表示名
 * @param color - アイコン色
 * @param iconPath - アイコンパス
 * @param isSelected - 選択中かどうか
 * @param onToggle - 選択切替時のコールバック（省略可）
 * @returns 生成した行要素
 */
function createSelectItemRow(
  id: string,
  name: string,
  color: string,
  iconPath: string,
  isSelected: boolean,
  onToggle?: (id: string, selected: boolean) => void
): HTMLElement {
  const row = document.createElement("div");
  row.className = "transaction-history-select-item";
  row.dataset.id = id;
  // チェックボタン（押下で選択切替）
  const checkBtn = document.createElement("button");
  checkBtn.type = "button";
  checkBtn.className = "transaction-history-select-check-btn";
  checkBtn.setAttribute("aria-label", "選択");
  checkBtn.setAttribute("aria-pressed", isSelected ? "true" : "false");
  if (isSelected) checkBtn.classList.add("is-selected");
  const checkIcon = document.createElement("span");
  checkIcon.className = "transaction-history-select-check-icon";
  checkIcon.setAttribute("aria-hidden", "true");
  checkBtn.appendChild(checkIcon);
  // 選択状態を反転し、コールバックがあれば呼ぶ
  const handleToggle = (): void => {
    const pressed = checkBtn.getAttribute("aria-pressed") === "true";
    const next = !pressed;
    checkBtn.setAttribute("aria-pressed", String(next));
    checkBtn.classList.toggle("is-selected", next);
    onToggle?.(id, next);
  };
  checkBtn.addEventListener("click", (e) => {
    e.preventDefault();
    handleToggle();
  });
  const iconWrap = createIconWrap(color, iconPath);
  const nameSpan = document.createElement("span");
  nameSpan.className = "transaction-history-select-item-name";
  nameSpan.textContent = name;
  nameSpan.addEventListener("click", () => handleToggle());
  row.appendChild(checkBtn);
  row.appendChild(iconWrap);
  row.appendChild(nameSpan);
  return row;
}

let categorySelectModalType: "income" | "expense" | "transfer" = "expense";
let categorySelectModalSelectedIds = new Set<string>();

/**
 * 取引種別に応じてカテゴリ行を絞り込む。
 * @param type - 取引種別（income / expense / transfer）
 * @returns 該当するカテゴリ行の配列
 */
function filterCategoriesByType(type: "income" | "expense" | "transfer"): CategoryRow[] {
  const rows = getCategoryRows();
  if (type === "income") return rows.filter((c) => (c.TYPE || "").toLowerCase() === "income");
  if (type === "expense") return rows.filter((c) => (c.TYPE || "").toLowerCase() === "expense");
  if (type === "transfer") return rows.filter((c) => (c.TYPE || "").toLowerCase() === "transfer");
  return rows;
}

/**
 * カテゴリ選択モーダル内のリストを指定種別で描画する。
 * @param type - 取引種別（タブに応じたカテゴリのみ表示）
 * @returns なし
 */
function renderCategorySelectList(type: "income" | "expense" | "transfer"): void {
  const listEl = document.getElementById("transaction-history-category-select-list");
  if (!listEl) return;
  listEl.innerHTML = "";
  const filtered = filterCategoriesByType(type);
  const sorted = filtered.slice().sort((a, b) => sortOrderNum(a.SORT_ORDER, b.SORT_ORDER));
  // 種別に合うカテゴリを SORT_ORDER 順で1行ずつ追加
  for (const row of sorted) {
    const item = createSelectItemRow(
      row.ID,
      row.CATEGORY_NAME || "—",
      row.COLOR || ICON_DEFAULT_COLOR,
      row.ICON_PATH || "",
      categorySelectModalSelectedIds.has(row.ID),
      (id, selected) => {
        if (selected) categorySelectModalSelectedIds.add(id);
        else categorySelectModalSelectedIds.delete(id);
      }
    );
    listEl.appendChild(item);
  }
}

/**
 * カテゴリ選択モーダルを開き、現在の検索条件で選択状態を初期化してリストを描画する。
 * @returns なし
 */
function openCategorySelectModal(): void {
  categorySelectModalType = "expense";
  categorySelectModalSelectedIds = new Set(getActiveFilterState().filterCategoryIds);
  // タブの active 状態を「支出」に合わせる
  const tabs = document.querySelectorAll(".transaction-history-category-select-tab");
  tabs.forEach((tab) => {
    const t = tab as HTMLElement;
    const isActive = (t.dataset.type ?? "expense") === categorySelectModalType;
    t.classList.toggle("is-active", isActive);
    t.setAttribute("aria-selected", String(isActive));
  });
  renderCategorySelectList(categorySelectModalType);
  openOverlay("transaction-history-category-select-overlay");
}

/**
 * タグ選択モーダルを開き、現在の検索条件で選択状態を反映してリストを描画する。
 * @returns なし
 */
function openTagSelectModal(): void {
  const listEl = document.getElementById("transaction-history-tag-select-list");
  if (!listEl) return;
  listEl.innerHTML = "";
  const sorted = getTagRows();
  const state = getActiveFilterState();
  // タグを SORT_ORDER 順で1行ずつ追加（選択状態は state.filterTagIds に合わせる）
  for (const row of sorted) {
    const item = createSelectItemRow(
      row.ID,
      row.TAG_NAME || "—",
      row.COLOR || ICON_DEFAULT_COLOR,
      row.ICON_PATH || "",
      state.filterTagIds.includes(row.ID)
    );
    listEl.appendChild(item);
  }
  openOverlay("transaction-history-tag-select-overlay");
}

let accountSelectModalTab: "own" | "shared" = "own";
let accountSelectModalSelectedIds = new Set<string>();

/**
 * ログインユーザーが所有する勘定行を SORT_ORDER でソートして返す。
 * @returns 自分の勘定行の配列
 */
function getOwnAccountRows(): AccountRow[] {
  const me = currentUserId;
  if (!me) return [];
  return getAccountRows()
    .filter((a) => a.USER_ID === me)
    .sort((a, b) => (a.SORT_ORDER || "").localeCompare(b.SORT_ORDER || ""));
}

/**
 * 権限付与された共有勘定行を SORT_ORDER でソートして返す。
 * @returns 共有勘定行の配列
 */
function getSharedAccountRows(): AccountRow[] {
  const me = currentUserId;
  if (!me) return [];
  const sharedIds = new Set(getPermissionRows().filter((p) => p.USER_ID === me).map((p) => p.ACCOUNT_ID));
  return getAccountRows()
    .filter((a) => a.USER_ID !== me && sharedIds.has(a.ID))
    .sort((a, b) => (a.SORT_ORDER || "").localeCompare(b.SORT_ORDER || ""));
}

/**
 * 勘定選択モーダル内のリストを「自分の勘定」または「共有勘定」タブで描画する。
 * @param tab - "own" | "shared"
 * @returns なし
 */
function renderAccountSelectList(tab: "own" | "shared"): void {
  const listEl = document.getElementById("transaction-history-account-select-list");
  if (!listEl) return;
  listEl.innerHTML = "";
  const rows = tab === "own" ? getOwnAccountRows() : getSharedAccountRows();
  // タブに応じた勘定を1行ずつ追加
  for (const row of rows) {
    const item = createSelectItemRow(
      row.ID,
      row.ACCOUNT_NAME || "—",
      row.COLOR || ICON_DEFAULT_COLOR,
      row.ICON_PATH || "",
      accountSelectModalSelectedIds.has(row.ID),
      (id, selected) => {
        if (selected) accountSelectModalSelectedIds.add(id);
        else accountSelectModalSelectedIds.delete(id);
      }
    );
    listEl.appendChild(item);
  }
}

/**
 * 勘定選択モーダルを開き、現在の検索条件で選択状態を初期化してリストを描画する。
 * @returns なし
 */
function openAccountSelectModal(): void {
  accountSelectModalTab = "own";
  accountSelectModalSelectedIds = new Set(getActiveFilterState().filterAccountIds);
  // タブの active 状態を「自分の勘定」に合わせる
  const tabs = document.querySelectorAll(".transaction-history-account-select-tab");
  tabs.forEach((t) => {
    const el = t as HTMLElement;
    const isActive = (el.dataset.tab ?? "own") === accountSelectModalTab;
    el.classList.toggle("is-active", isActive);
    el.setAttribute("aria-selected", String(isActive));
  });
  renderAccountSelectList(accountSelectModalTab);
  openOverlay("transaction-history-account-select-overlay");
}

/**
 * 日付を YYYY-MM-DD 形式にフォーマットする。
 * @param d - 日付
 * @returns YYYY-MM-DD 文字列
 */
function formatDateYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * 検索条件を初期値にリセットし、フォームと表示を更新してフィルター変更を通知する。
 * @returns なし
 */
function resetConditions(): void {
  const isCalendar =
    currentView === "transaction-history-calendar" || currentView === "transaction-history-weekly";
  const isScheduleOrCalendar = currentView === "schedule" || isCalendar;
  // 収支履歴一覧では日付 From を1年前に、スケジュール・カレンダーでは未指定（空）にする
  const today = new Date();
  const fromDate = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
  const defaultDateFrom = formatDateYMD(fromDate);
  const dateFromValue = isScheduleOrCalendar ? "" : defaultDateFrom;
  setActiveFilterState({
    filterStatus: ["plan", "actual"],
    filterType: ["income", "expense", "transfer"],
    filterCategoryIds: [],
    filterTagIds: [],
    filterAccountIds: [],
    filterDateFrom: dateFromValue,
    filterDateTo: "",
    filterAmountMin: "",
    filterAmountMax: "",
    filterFreeText: "",
  });
  // 日付・金額・フリーテキストの入力欄を同期
  const dateFromEl = document.getElementById("transaction-history-date-from") as HTMLInputElement | null;
  const dateToEl = document.getElementById("transaction-history-date-to") as HTMLInputElement | null;
  if (dateFromEl) {
    dateFromEl.value = dateFromValue;
    dateFromEl.classList.toggle("is-empty", !dateFromValue);
  }
  if (dateToEl) {
    dateToEl.value = "";
    dateToEl.classList.add("is-empty");
  }
  const amountMinEl = document.getElementById("transaction-history-amount-min") as HTMLInputElement | null;
  const amountMaxEl = document.getElementById("transaction-history-amount-max") as HTMLInputElement | null;
  if (amountMinEl) amountMinEl.value = "";
  if (amountMaxEl) amountMaxEl.value = "";
  const freeTextEl = document.getElementById("transaction-history-free-text") as HTMLInputElement | null;
  if (freeTextEl) freeTextEl.value = "";
  // ボタン・選択表示を同期し、一覧・カレンダー・スケジュールの再描画を促す
  syncFilterButtons();
  if (currentView === "schedule") {
    setSchedulePlanStatuses(["planning"]);
    syncPlanStatusButtons();
  } else if (
    currentView === "transaction-history-weekly" ||
    currentView === "transaction-history-calendar"
  ) {
    setCalendarPlanStatuses(["planning", "complete"]);
    syncPlanStatusButtons();
  }
  updateChosenDisplays();
  notifyFilterChange();
}

/**
 * 検索フォームのイベントを登録する。アプリ起動時に main から 1 回呼ぶ。
 * @returns なし
 */
export function initTransactionSearchForm(): void {
  // 収支履歴の日付セッター（カレンダーから日付クリックで絞り込むときに使用）
  registerHistoryFilterDateSetter((from, to) => {
    setHistoryFilterState({ filterDateFrom: from, filterDateTo: to });
  });

  // 条件表示ボタン: 検索条件パネルを開閉トグル
  document.getElementById("transaction-history-show-conditions-btn")?.addEventListener("click", () => {
    const panel = document.getElementById("transaction-history-common");
    if (!panel?.classList.contains("search-conditions-panel")) return;
    const isOpen = panel.classList.contains("search-conditions-panel--open");
    if (isOpen) {
      panel.classList.add("search-conditions-panel--closed");
      panel.classList.remove("search-conditions-panel--open");
      panel.setAttribute("aria-hidden", "true");
      panel.removeAttribute("role");
      panel.removeAttribute("aria-modal");
      panel.style.left = "";
      panel.style.top = "";
      panel.style.width = "";
      panel.style.bottom = "";
      panel.style.right = "";
    } else {
      panel.classList.remove("search-conditions-panel--closed");
      panel.classList.add("search-conditions-panel--open");
      panel.setAttribute("aria-hidden", "false");
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-modal", "false");
      panel.setAttribute("aria-label", "検索条件");
      panel.style.left = "";
      panel.style.top = "";
      panel.style.width = "";
      panel.style.bottom = "";
      panel.style.right = "";
      const accordion = panel.querySelector(".transaction-history-search-accordion");
      if (accordion instanceof HTMLDetailsElement) accordion.open = true;
    }
  });

  // 検索条件パネル: ドラッグで移動
  (() => {
    const panel = document.getElementById("transaction-history-common");
    const handle = document.getElementById("search-conditions-panel-drag-handle");
    if (!panel || !handle) return;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    const onMove = (e: MouseEvent): void => {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      (panel as HTMLElement).style.left = `${startLeft + dx}px`;
      (panel as HTMLElement).style.top = `${startTop + dy}px`;
    };
    const onUp = (): void => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    handle.addEventListener("mousedown", (e: MouseEvent) => {
      if (!panel.classList.contains("search-conditions-panel--open")) return;
      e.preventDefault();
      const rect = panel.getBoundingClientRect();
      if (!(panel as HTMLElement).style.left) {
        (panel as HTMLElement).style.bottom = "auto";
        (panel as HTMLElement).style.right = "auto";
        (panel as HTMLElement).style.left = `${rect.left}px`;
        (panel as HTMLElement).style.top = `${rect.top}px`;
        (panel as HTMLElement).style.width = `${rect.width}px`;
      }
      startX = e.clientX;
      startY = e.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  })();

  // 検索条件リセットボタン
  document.getElementById("transaction-history-reset-conditions-btn")?.addEventListener("click", () => {
    resetConditions();
  });

  function updateDateInputEmptyState(el: HTMLInputElement | null): void {
    if (!el) return;
    if (el.value) el.classList.remove("is-empty");
    else el.classList.add("is-empty");
  }

  // 日付入力の change で state 更新・空欄表示・フィルター通知
  const dateFrom = document.getElementById("transaction-history-date-from") as HTMLInputElement;
  const dateTo = document.getElementById("transaction-history-date-to") as HTMLInputElement;
  updateDateInputEmptyState(dateFrom);
  updateDateInputEmptyState(dateTo);
  dateFrom?.addEventListener("change", () => {
    setActiveFilterState({ filterDateFrom: dateFrom.value || "" });
    updateDateInputEmptyState(dateFrom);
    notifyFilterChange();
  });
  dateTo?.addEventListener("change", () => {
    setActiveFilterState({ filterDateTo: dateTo.value || "" });
    updateDateInputEmptyState(dateTo);
    notifyFilterChange();
  });

  // 検索アコーディオン: 開閉時に現在ビューの状態を記録（ビュー切替で復元するため）
  const searchArea = document.getElementById("transaction-history-common");
  const accordionEl = searchArea?.querySelector(".transaction-history-search-accordion");
  if (accordionEl instanceof HTMLDetailsElement) {
    accordionEl.addEventListener("toggle", () => {
      searchAccordionOpenByView[currentView] = accordionEl.open;
    });
  }
  // 予定/実績ボタン押下で filterStatus をトグル
  searchArea?.querySelectorAll(".transaction-history-filter-btn[data-status]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const state = getActiveFilterState();
      const status = (btn as HTMLButtonElement).dataset.status as "plan" | "actual";
      if (state.filterStatus.includes(status)) {
        setActiveFilterState({ filterStatus: state.filterStatus.filter((s) => s !== status) });
      } else {
        setActiveFilterState({ filterStatus: [...state.filterStatus, status] });
      }
      syncFilterButtons();
      notifyFilterChange();
    });
  });
  // 収入/支出/振替ボタン押下で filterType をトグル
  searchArea?.querySelectorAll(".transaction-history-filter-btn[data-type]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const state = getActiveFilterState();
      const type = (btn as HTMLButtonElement).dataset.type as "income" | "expense" | "transfer";
      if (state.filterType.includes(type)) {
        setActiveFilterState({ filterType: state.filterType.filter((t) => t !== type) });
      } else {
        setActiveFilterState({ filterType: [...state.filterType, type] });
      }
      syncFilterButtons();
      notifyFilterChange();
    });
  });
  // スケジュール・カレンダー用ステータス（計画中/完了/中止）ボタン押下で複数選択トグル
  searchArea?.querySelectorAll(".transaction-history-filter-btn[data-plan-status]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const value = (btn as HTMLButtonElement).dataset.planStatus as SchedulePlanStatus;
      const active = getActivePlanStatuses();
      const next = active.includes(value)
        ? active.filter((s) => s !== value)
        : [...active, value];
      setActivePlanStatuses(next);
      syncPlanStatusButtons();
      notifyFilterChange();
    });
  });

  // 金額・フリーテキストの input で state 更新とフィルター通知
  const amountMin = document.getElementById("transaction-history-amount-min") as HTMLInputElement;
  const amountMax = document.getElementById("transaction-history-amount-max") as HTMLInputElement;
  amountMin?.addEventListener("input", () => {
    setActiveFilterState({ filterAmountMin: amountMin.value.trim() });
    notifyFilterChange();
  });
  amountMax?.addEventListener("input", () => {
    setActiveFilterState({ filterAmountMax: amountMax.value.trim() });
    notifyFilterChange();
  });

  const freeText = document.getElementById("transaction-history-free-text") as HTMLInputElement;
  freeText?.addEventListener("input", () => {
    setActiveFilterState({ filterFreeText: freeText.value.trim() });
    notifyFilterChange();
  });

  // カテゴリ・タグ・勘定選択ボタンでモーダルを開く
  document.getElementById("transaction-history-category-btn")?.addEventListener("click", openCategorySelectModal);
  document.getElementById("transaction-history-tag-btn")?.addEventListener("click", openTagSelectModal);
  document.getElementById("transaction-history-account-btn")?.addEventListener("click", openAccountSelectModal);

  // カテゴリモーダル: タブ切替で種別変更・リスト再描画
  document.querySelectorAll(".transaction-history-category-select-tab").forEach((tabEl) => {
    tabEl.addEventListener("click", () => {
      const type = (tabEl as HTMLElement).dataset.type as "income" | "expense" | "transfer" | undefined;
      if (!type) return;
      categorySelectModalType = type;
      document.querySelectorAll(".transaction-history-category-select-tab").forEach((t) => {
        const el = t as HTMLElement;
        const isActive = (el.dataset.type ?? "expense") === categorySelectModalType;
        el.classList.toggle("is-active", isActive);
        el.setAttribute("aria-selected", String(isActive));
      });
      renderCategorySelectList(categorySelectModalType);
    });
  });

  // カテゴリモーダル: クリア・適用・オーバーレイ外クリック
  document.getElementById("transaction-history-category-select-clear")?.addEventListener("click", () => {
    categorySelectModalSelectedIds.clear();
    renderCategorySelectList(categorySelectModalType);
  });
  document.getElementById("transaction-history-category-select-apply")?.addEventListener("click", () => {
    setActiveFilterState({ filterCategoryIds: Array.from(categorySelectModalSelectedIds) });
    updateChosenDisplays();
    notifyFilterChange();
    closeOverlay("transaction-history-category-select-overlay");
  });
  document.getElementById("transaction-history-category-select-overlay")?.addEventListener("click", (e) => {
    if (e.target instanceof HTMLElement && e.target.id === "transaction-history-category-select-overlay") {
      closeOverlay("transaction-history-category-select-overlay");
    }
  });

  // タグモーダル: クリア・適用・オーバーレイ外クリック
  document.getElementById("transaction-history-tag-select-clear")?.addEventListener("click", () => {
    document.querySelectorAll("#transaction-history-tag-select-list .transaction-history-select-check-btn").forEach((el) => {
      el.classList.remove("is-selected");
      el.setAttribute("aria-pressed", "false");
    });
  });
  document.getElementById("transaction-history-tag-select-apply")?.addEventListener("click", () => {
    setActiveFilterState({ filterTagIds: getSelectedIdsFromList("transaction-history-tag-select-list") });
    updateChosenDisplays();
    notifyFilterChange();
    closeOverlay("transaction-history-tag-select-overlay");
  });
  document.getElementById("transaction-history-tag-select-overlay")?.addEventListener("click", (e) => {
    if (e.target instanceof HTMLElement && e.target.id === "transaction-history-tag-select-overlay") {
      closeOverlay("transaction-history-tag-select-overlay");
    }
  });

  // 勘定モーダル: タブ切替・自分のみ選択・クリア・適用・オーバーレイ外クリック
  document.querySelectorAll(".transaction-history-account-select-tab").forEach((tabEl) => {
    tabEl.addEventListener("click", () => {
      const tab = (tabEl as HTMLElement).dataset.tab as "own" | "shared" | undefined;
      if (!tab) return;
      accountSelectModalTab = tab;
      document.querySelectorAll(".transaction-history-account-select-tab").forEach((t) => {
        const el = t as HTMLElement;
        const isActive = (el.dataset.tab ?? "own") === accountSelectModalTab;
        el.classList.toggle("is-active", isActive);
        el.setAttribute("aria-selected", String(isActive));
      });
      renderAccountSelectList(accountSelectModalTab);
    });
  });

  // 勘定モーダル: 「自分のみ選択」で自分の勘定を全選択してリスト再描画
  document.getElementById("transaction-history-account-select-own-only")?.addEventListener("click", () => {
    const ownRows = getOwnAccountRows();
    accountSelectModalSelectedIds = new Set(ownRows.map((r) => r.ID));
    renderAccountSelectList(accountSelectModalTab);
  });
  document.getElementById("transaction-history-account-select-clear")?.addEventListener("click", () => {
    accountSelectModalSelectedIds.clear();
    renderAccountSelectList(accountSelectModalTab);
  });
  document.getElementById("transaction-history-account-select-apply")?.addEventListener("click", () => {
    setActiveFilterState({ filterAccountIds: Array.from(accountSelectModalSelectedIds) });
    updateChosenDisplays();
    notifyFilterChange();
    closeOverlay("transaction-history-account-select-overlay");
  });
  document.getElementById("transaction-history-account-select-overlay")?.addEventListener("click", (e) => {
    if (e.target instanceof HTMLElement && e.target.id === "transaction-history-account-select-overlay") {
      closeOverlay("transaction-history-account-select-overlay");
    }
  });
}
