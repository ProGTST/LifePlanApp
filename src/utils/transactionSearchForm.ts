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
  setHistoryFilterState,
  setCalendarFilterState,
  setScheduleFilterState,
} from "../state";
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
import { createIconWrap } from "./iconWrap";
import { openOverlay, closeOverlay } from "./overlay";
import { ICON_DEFAULT_COLOR } from "../constants/colorPresets";

/** 検索条件アコーディオンの開閉をビューごとに保持 */
const searchAccordionOpenByView: Record<string, boolean> = {};

function getActiveFilterState(): FilterState {
  if (currentView === "schedule") return { ...scheduleFilterState };
  if (
    currentView === "transaction-history-weekly" ||
    currentView === "transaction-history-calendar"
  ) {
    return { ...calendarFilterState };
  }
  return { ...historyFilterState };
}

function setActiveFilterState(partial: Partial<FilterState>): void {
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

function notifyFilterChange(): void {
  runFilterChangeCallbacks();
}

/**
 * 指定ビュー用の検索条件をフォームに反映する。ビュー切替時に app/screen から呼ぶ。
 */
export function loadFormFromFilterState(viewId: string): void {
  const isCalendar =
    viewId === "transaction-history-calendar" || viewId === "transaction-history-weekly";
  const state = viewId === "schedule"
    ? { ...scheduleFilterState }
    : isCalendar
      ? { ...calendarFilterState }
      : { ...historyFilterState };
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
  const amountMinEl = document.getElementById("transaction-history-amount-min") as HTMLInputElement | null;
  const amountMaxEl = document.getElementById("transaction-history-amount-max") as HTMLInputElement | null;
  if (amountMinEl) amountMinEl.value = state.filterAmountMin;
  if (amountMaxEl) amountMaxEl.value = state.filterAmountMax;
  const freeTextEl = document.getElementById("transaction-history-free-text") as HTMLInputElement | null;
  if (freeTextEl) freeTextEl.value = state.filterFreeText;
  syncFilterButtons();
  updateChosenDisplays();
}

/**
 * 指定ビュー用の検索条件アコーディオン開閉状態を反映する。ビュー切替時に app/screen から呼ぶ。
 */
export function applySearchAccordionStateForView(viewId: string): void {
  const common = document.getElementById("transaction-history-common");
  const accordion = common?.querySelector(".transaction-history-search-accordion");
  if (accordion instanceof HTMLDetailsElement) {
    accordion.open = searchAccordionOpenByView[viewId] ?? false;
  }
}

function syncFilterButtons(): void {
  const state = getActiveFilterState();
  const searchArea = document.getElementById("transaction-history-common");
  if (!searchArea) return;
  searchArea.querySelectorAll(".transaction-history-filter-btn[data-status]").forEach((b) => {
    const s = (b as HTMLButtonElement).dataset.status as "plan" | "actual";
    b.classList.toggle("is-active", state.filterStatus.includes(s));
  });
  searchArea.querySelectorAll(".transaction-history-filter-btn[data-type]").forEach((b) => {
    const t = (b as HTMLButtonElement).dataset.type as "income" | "expense" | "transfer";
    b.classList.toggle("is-active", state.filterType.includes(t));
  });
}

const CHOSEN_REMOVE_ICON = "/icon/circle-xmark-solid-full.svg";
const CHOSEN_LABEL_DEFAULT_BG = "#646cff";
const CHOSEN_LABEL_DEFAULT_FG = "#ffffff";

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

function updateChosenDisplays(): void {
  const state = getActiveFilterState();
  const categoryEl = document.getElementById("transaction-history-category-display");
  const tagEl = document.getElementById("transaction-history-tag-display");
  const accountEl = document.getElementById("transaction-history-account-display");
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

function getSelectedIdsFromList(listContainerId: string): string[] {
  const container = document.getElementById(listContainerId);
  if (!container) return [];
  const selected = container.querySelectorAll<HTMLElement>(".transaction-history-select-item .transaction-history-select-check-btn.is-selected");
  return Array.from(selected)
    .map((btn) => btn.closest(".transaction-history-select-item")?.getAttribute("data-id"))
    .filter((id): id is string => id != null);
}

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

function filterCategoriesByType(type: "income" | "expense" | "transfer"): CategoryRow[] {
  const rows = getCategoryRows();
  if (type === "income") return rows.filter((c) => (c.TYPE || "").toLowerCase() === "income");
  if (type === "expense") return rows.filter((c) => (c.TYPE || "").toLowerCase() === "expense");
  if (type === "transfer") return rows.filter((c) => ["income", "expense"].includes((c.TYPE || "").toLowerCase()));
  return rows;
}

function renderCategorySelectList(type: "income" | "expense" | "transfer"): void {
  const listEl = document.getElementById("transaction-history-category-select-list");
  if (!listEl) return;
  listEl.innerHTML = "";
  const filtered = filterCategoriesByType(type);
  const sorted = filtered.slice().sort((a, b) => (a.SORT_ORDER || "").localeCompare(b.SORT_ORDER || ""));
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

function openCategorySelectModal(): void {
  categorySelectModalType = "expense";
  categorySelectModalSelectedIds = new Set(getActiveFilterState().filterCategoryIds);
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

function openTagSelectModal(): void {
  const listEl = document.getElementById("transaction-history-tag-select-list");
  if (!listEl) return;
  listEl.innerHTML = "";
  const sorted = getTagRows();
  const state = getActiveFilterState();
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

function getOwnAccountRows(): AccountRow[] {
  const me = currentUserId;
  if (!me) return [];
  return getAccountRows()
    .filter((a) => a.USER_ID === me)
    .sort((a, b) => (a.SORT_ORDER || "").localeCompare(b.SORT_ORDER || ""));
}

function getSharedAccountRows(): AccountRow[] {
  const me = currentUserId;
  if (!me) return [];
  const sharedIds = new Set(getPermissionRows().filter((p) => p.USER_ID === me).map((p) => p.ACCOUNT_ID));
  return getAccountRows()
    .filter((a) => a.USER_ID !== me && sharedIds.has(a.ID))
    .sort((a, b) => (a.SORT_ORDER || "").localeCompare(b.SORT_ORDER || ""));
}

function renderAccountSelectList(tab: "own" | "shared"): void {
  const listEl = document.getElementById("transaction-history-account-select-list");
  if (!listEl) return;
  listEl.innerHTML = "";
  const rows = tab === "own" ? getOwnAccountRows() : getSharedAccountRows();
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

function openAccountSelectModal(): void {
  accountSelectModalTab = "own";
  accountSelectModalSelectedIds = new Set(getActiveFilterState().filterAccountIds);
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

function formatDateYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function resetConditions(): void {
  const today = new Date();
  const fromDate = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
  const defaultDateFrom = formatDateYMD(fromDate);
  setActiveFilterState({
    filterStatus: ["plan", "actual"],
    filterType: ["income", "expense", "transfer"],
    filterCategoryIds: [],
    filterTagIds: [],
    filterAccountIds: [],
    filterDateFrom: defaultDateFrom,
    filterDateTo: "",
    filterAmountMin: "",
    filterAmountMax: "",
    filterFreeText: "",
  });

  const dateFromEl = document.getElementById("transaction-history-date-from") as HTMLInputElement | null;
  const dateToEl = document.getElementById("transaction-history-date-to") as HTMLInputElement | null;
  if (dateFromEl) {
    dateFromEl.value = defaultDateFrom;
    dateFromEl.classList.remove("is-empty");
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

  syncFilterButtons();
  updateChosenDisplays();
  notifyFilterChange();
}

/**
 * 検索フォームのイベントを登録する。アプリ起動時に main から 1 回呼ぶ。
 */
export function initTransactionSearchForm(): void {
  registerHistoryFilterDateSetter((from, to) => {
    setHistoryFilterState({ filterDateFrom: from, filterDateTo: to });
  });

  document.getElementById("transaction-history-reset-conditions-btn")?.addEventListener("click", () => {
    resetConditions();
  });

  function updateDateInputEmptyState(el: HTMLInputElement | null): void {
    if (!el) return;
    if (el.value) el.classList.remove("is-empty");
    else el.classList.add("is-empty");
  }

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

  const searchArea = document.getElementById("transaction-history-common");
  const accordionEl = searchArea?.querySelector(".transaction-history-search-accordion");
  if (accordionEl instanceof HTMLDetailsElement) {
    accordionEl.addEventListener("toggle", () => {
      searchAccordionOpenByView[currentView] = accordionEl.open;
    });
  }
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

  document.getElementById("transaction-history-category-btn")?.addEventListener("click", openCategorySelectModal);
  document.getElementById("transaction-history-tag-btn")?.addEventListener("click", openTagSelectModal);
  document.getElementById("transaction-history-account-btn")?.addEventListener("click", openAccountSelectModal);

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
