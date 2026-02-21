import type { TransactionRow, AccountRow } from "../types";
import {
  transactionList,
  tagManagementList,
  setTransactionEntryEditId,
  setTransactionEntryViewOnly,
  pushNavigation,
  historyFilterState,
  setHistoryFilterState,
} from "../state";
import { setDisplayedKeys } from "../utils/csvWatch.ts";
import { registerViewHandler, registerRefreshHandler, showMainView } from "../app/screen";
import { updateCurrentMenuItem } from "../app/sidebar";
import { createIconWrap } from "../utils/iconWrap";
import { ICON_DEFAULT_COLOR } from "../constants/colorPresets";
import {
  loadTransactionData,
  getCategoryById,
  getAccountById,
  getRowPermissionType,
  getTagsForTransaction,
} from "../utils/transactionDataSync";
import { updateTransactionHistoryTabLayout, registerFilterChangeCallback } from "../utils/transactionDataLayout";
import { applyFilters, type FilterState } from "../utils/transactionDataFilter";
import { loadFormFromFilterState } from "../utils/transactionSearchForm";

// ---------------------------------------------------------------------------
// 定数・状態
// ---------------------------------------------------------------------------

/** 一覧のタグラベルで色未設定時に使う背景色 */
const CHOSEN_LABEL_DEFAULT_BG = "#646cff";
/** 一覧のタグラベルで色未設定時に使う文字色 */
const CHOSEN_LABEL_DEFAULT_FG = "#ffffff";

/** 収支履歴用の検索条件を返す（state の historyFilterState を参照）。一覧のフィルター適用で使用。 */
function getHistoryFilterState(): FilterState {
  return { ...historyFilterState };
}

// ---------------------------------------------------------------------------
// DOM ヘルパー・フィルタ・一覧描画
// ---------------------------------------------------------------------------

/**
 * 勘定のアイコンと名前を指定要素に追加する（一覧の勘定セル用）。
 * @param parent - 追加先の親要素
 * @param acc - 勘定行
 * @param tag - ラッパーに使うタグ名（div または span）
 * @returns なし
 */
function appendAccountWrap(
  parent: HTMLElement,
  acc: AccountRow,
  tag: "div" | "span" = "div"
): void {
  const wrap = document.createElement(tag);
  wrap.className = "transaction-history-account-wrap";
  wrap.appendChild(createIconWrap(acc.COLOR || ICON_DEFAULT_COLOR, acc.ICON_PATH));
  const nameSpan = document.createElement("span");
  nameSpan.className = "transaction-history-account-name";
  nameSpan.textContent = acc.ACCOUNT_NAME || "—";
  wrap.appendChild(nameSpan);
  parent.appendChild(wrap);
}

/**
 * 予定データで取引終了日が今日より過去かどうかを返す（日付のみで比較、タイムゾーンに左右されない）。
 * @param row - 取引行
 * @returns 過去の予定なら true
 */
function isPlanDateToPast(row: TransactionRow): boolean {
  if (row.PROJECT_TYPE !== "plan" || !row.TRANDATE_TO?.trim()) return false;
  const s = row.TRANDATE_TO.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return false;
  const planY = parseInt(m[1], 10);
  const planM = parseInt(m[2], 10);
  const planD = parseInt(m[3], 10);
  const now = new Date();
  const todayY = now.getFullYear();
  const todayM = now.getMonth() + 1;
  const todayD = now.getDate();
  if (planY !== todayY) return planY < todayY;
  if (planM !== todayM) return planM < todayM;
  return planD < todayD;
}

/**
 * 収支履歴の一覧タブのテーブルを描画する。フィルター適用済みの取引を行で表示する。
 * @returns なし
 */
function renderList(): void {
  const tbody = document.getElementById("transaction-history-tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  const filtered = applyFilters(transactionList, getHistoryFilterState(), tagManagementList);
  setDisplayedKeys("transaction-history", filtered.map((row) => row.ID));
  filtered.forEach((row) => {
    const tr = document.createElement("tr");
    if (isPlanDateToPast(row)) tr.classList.add("transaction-history-row--past-plan");
    const permType = getRowPermissionType(row);
    if (permType === "view") tr.classList.add("transaction-history-row--permission-view");
    else if (permType === "edit") tr.classList.add("transaction-history-row--permission-edit");
    const tdDate = document.createElement("td");
    tdDate.textContent = row.TRANDATE_FROM || "—";
    const cat = getCategoryById(row.CATEGORY_ID);
    const tdCat = document.createElement("td");
    const catWrap = document.createElement("div");
    catWrap.className = "transaction-history-category-cell";
    if (cat) {
      const iconWrap = createIconWrap(cat.COLOR || ICON_DEFAULT_COLOR, cat.ICON_PATH);
      catWrap.appendChild(iconWrap);
      const nameSpan = document.createElement("span");
      nameSpan.className = "transaction-history-category-name";
      nameSpan.textContent = cat.CATEGORY_NAME || "—";
      catWrap.appendChild(nameSpan);
    } else {
      catWrap.textContent = "—";
    }
    tdCat.appendChild(catWrap);
    const tdPlan = document.createElement("td");
    tdPlan.className = "transaction-history-plan-cell";
    const planIcon = document.createElement("span");
    planIcon.className = "transaction-history-plan-icon";
    planIcon.setAttribute("aria-label", row.PROJECT_TYPE === "actual" ? "実績" : "予定");
    planIcon.textContent = row.PROJECT_TYPE === "actual" ? "実" : "予";
    tdPlan.appendChild(planIcon);
    const tdData = document.createElement("td");
    const dataWrap = document.createElement("div");
    dataWrap.className = "transaction-history-data-cell";
    const amountRow = document.createElement("div");
    amountRow.className = "transaction-history-amount-row";
    const line1 = document.createElement("div");
    line1.className = "transaction-history-amount";
    line1.textContent = row.AMOUNT ? Number(row.AMOUNT).toLocaleString() : "—";
    amountRow.appendChild(line1);
    dataWrap.appendChild(amountRow);
    tdData.appendChild(dataWrap);
    const tdName = document.createElement("td");
    tdName.className = "transaction-history-name-cell";
    const nameWrap = document.createElement("div");
    nameWrap.className = "transaction-history-name-cell-inner";
    const typeIcon = document.createElement("span");
    typeIcon.className = "transaction-history-type-icon";
    const txType = (row.TRANSACTION_TYPE || "expense") as "income" | "expense" | "transfer";
    typeIcon.classList.add(`transaction-history-type-icon--${txType}`);
    typeIcon.setAttribute("aria-label", txType === "income" ? "収入" : txType === "expense" ? "支出" : "振替");
    typeIcon.textContent = txType === "income" ? "収" : txType === "expense" ? "支" : "振";
    nameWrap.appendChild(typeIcon);
    const nameText = document.createElement("span");
    nameText.className = "transaction-history-name-text";
    nameText.textContent = row.NAME || "—";
    nameWrap.appendChild(nameText);
    tdName.appendChild(nameWrap);
    const tdTags = document.createElement("td");
    tdTags.className = "transaction-history-tags-cell";
    const tags = getTagsForTransaction(row.ID, tagManagementList);
    if (tags.length > 0) {
      const tagLabelWrap = document.createElement("span");
      tagLabelWrap.className = "transaction-history-tags-label-wrap";
      for (const tag of tags) {
        const wrap = document.createElement("span");
        wrap.className = "transaction-history-tag-label";
        const bg = (tag.COLOR || "").trim() || CHOSEN_LABEL_DEFAULT_BG;
        wrap.style.backgroundColor = bg;
        wrap.style.color = CHOSEN_LABEL_DEFAULT_FG;
        wrap.textContent = tag.TAG_NAME?.trim() || "—";
        tagLabelWrap.appendChild(wrap);
      }
      tdTags.appendChild(tagLabelWrap);
    } else {
      tdTags.textContent = "—";
    }
    const tdAccount = document.createElement("td");
    tdAccount.className = "transaction-history-account-cell";
    const type = row.TRANSACTION_TYPE as "income" | "expense" | "transfer";
    if (type === "income" && row.ACCOUNT_ID_IN) {
      const acc = getAccountById(row.ACCOUNT_ID_IN);
      if (acc) appendAccountWrap(tdAccount, acc, "div");
    } else if (type === "expense" && row.ACCOUNT_ID_OUT) {
      const acc = getAccountById(row.ACCOUNT_ID_OUT);
      if (acc) appendAccountWrap(tdAccount, acc, "div");
    } else if (type === "transfer" && (row.ACCOUNT_ID_IN || row.ACCOUNT_ID_OUT)) {
      const span = document.createElement("span");
      span.className = "transaction-history-transfer-icons";
      const accOut = row.ACCOUNT_ID_OUT ? getAccountById(row.ACCOUNT_ID_OUT) : null;
      const accIn = row.ACCOUNT_ID_IN ? getAccountById(row.ACCOUNT_ID_IN) : null;
      if (accOut) appendAccountWrap(span, accOut, "span");
      const arrow = document.createElement("span");
      arrow.className = "transaction-history-transfer-arrow";
      arrow.textContent = "▶";
      span.appendChild(arrow);
      if (accIn) appendAccountWrap(span, accIn, "span");
      tdAccount.appendChild(span);
    }
    const tdPlanDateTo = document.createElement("td");
    tdPlanDateTo.textContent =
      row.PROJECT_TYPE === "plan" ? (row.TRANDATE_TO || "—") : "—";
    tr.appendChild(tdDate);
    tr.appendChild(tdCat);
    tr.appendChild(tdPlan);
    tr.appendChild(tdData);
    tr.appendChild(tdName);
    tr.appendChild(tdTags);
    tr.appendChild(tdAccount);
    tr.appendChild(tdPlanDateTo);
    tr.dataset.transactionId = row.ID;
    tr.classList.add("transaction-history-row--clickable");
    tr.addEventListener("click", () => {
      const permType = getRowPermissionType(row);
      setTransactionEntryViewOnly(permType === "view");
      setTransactionEntryEditId(row.ID);
      pushNavigation("transaction-entry");
      showMainView("transaction-entry");
      updateCurrentMenuItem();
    });
    tbody.appendChild(tr);
  });
}

/**
 * 日付を YYYY-MM-DD にフォーマットする。loadAndShow の初期日付用。
 */
function formatDateYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * 収支履歴のデータを読み込んで一覧タブを描画する。週・カレンダーは calendar-screen が担当する。
 * @param forceReloadFromCsv - true のときはキャッシュを使わず CSV を再取得する（最新化ボタン用）
 * @returns なし
 */
function loadAndShow(forceReloadFromCsv = false): void {
  updateTransactionHistoryTabLayout();
  loadFormFromFilterState("transaction-history");
  const state = historyFilterState;
  const dateFromEl = document.getElementById("transaction-history-date-from") as HTMLInputElement | null;
  const dateToEl = document.getElementById("transaction-history-date-to") as HTMLInputElement | null;
  if (state.filterDateFrom === "" && state.filterDateTo === "") {
    const today = new Date();
    const fromDate = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
    setHistoryFilterState({ filterDateFrom: formatDateYMD(fromDate), filterDateTo: "" });
    if (dateFromEl) {
      dateFromEl.value = historyFilterState.filterDateFrom;
      dateFromEl.classList.remove("is-empty");
    }
    if (dateToEl) {
      dateToEl.value = "";
      dateToEl.classList.add("is-empty");
    }
  } else {
    if (dateFromEl) dateFromEl.classList.toggle("is-empty", !dateFromEl.value);
    if (dateToEl) dateToEl.classList.toggle("is-empty", !dateToEl.value);
  }
  loadTransactionData(forceReloadFromCsv).then(() => {
    renderList();
  });
}

/**
 * 収支履歴画面の初期化を行う。ビュー表示・更新ハンドラとフィルター変更時の一覧再描画のみ登録する。
 * 検索フォームのイベントは transactionSearchForm.initTransactionSearchForm で登録済み。
 */
export function initTransactionHistoryView(): void {
  registerViewHandler("transaction-history", loadAndShow);
  registerRefreshHandler("transaction-history", () => loadAndShow(true));
  registerFilterChangeCallback(renderList);
}
