import type { TransactionRow } from "../types";
import type { SchedulePlanStatus } from "../state";
import {
  currentUserId,
  transactionList,
  transactionTagList,
  scheduleFilterState,
  schedulePlanStatuses,
  setTransactionEntryEditId,
  setTransactionEntryViewOnly,
  setTransactionEntryReturnView,
  pushNavigation,
} from "../state";
import {
  loadTransactionData,
  getAccountRows,
  getCategoryById,
  getRowPermissionType,
  getActualIdsForPlanId,
  getActualTransactionsForPlan,
} from "../utils/transactionDataSync";
import { registerFilterChangeCallback } from "../utils/transactionDataLayout";
import { getFilteredTransactionListForSchedule } from "../utils/transactionDataFilter";
import { getPlanOccurrenceDates, getPlanOccurrenceDatesForDisplay, getDelayedPlanDates, hasDelayedPlanDates } from "../utils/planOccurrence";
import { openOverlay, closeOverlay } from "../utils/overlay";
import { fetchCsv, rowToObject } from "../utils/csv";
import { transactionListToCsv } from "../utils/csvExport";
import { saveCsvViaApi } from "../utils/dataApi";
import { registerViewHandler, registerRefreshHandler, showMainView } from "../app/screen";
import { updateCurrentMenuItem } from "../app/sidebar";
import { setDisplayedKeys } from "../utils/csvWatch";
import { createIconWrap } from "../utils/iconWrap";
import { ICON_DEFAULT_COLOR } from "../constants/colorPresets";

/**
 * スケジュール用の検索条件を返す（当画面用。state の scheduleFilterState を参照）。
 * @returns スケジュール用 FilterState のコピー
 */
function getScheduleFilterState() {
  return { ...scheduleFilterState };
}

/**
 * 集計に含める「自分の勘定のみ」の ID の Set。
 * 権限付与された勘定項目（他ユーザー勘定で ACCOUNT_PERMISSION で共有されているもの）は含めず、集計対象にしない。
 */
function getOwnAccountIdsForSchedule(): Set<string> {
  const ids = new Set<string>();
  const me = currentUserId;
  if (!me) return ids;
  getAccountRows()
    .filter((a) => (a.USER_ID || "").trim() === me)
    .forEach((a) => ids.add(a.ID));
  return ids;
}

/**
 * 取引が自分の勘定のみに紐づくか（権限付与勘定を含まないか）。集計対象判定に使用。
 * ACCOUNT_ID_IN / ACCOUNT_ID_OUT のいずれかが「自分の勘定」でない場合は false（集計対象外）。
 */
function isRowOnlyOwnAccounts(row: TransactionRow, ownAccountIds: Set<string>): boolean {
  const inId = (row.ACCOUNT_ID_IN || "").trim();
  const outId = (row.ACCOUNT_ID_OUT || "").trim();
  if (inId && !ownAccountIds.has(inId)) return false;
  if (outId && !ownAccountIds.has(outId)) return false;
  return true;
}

const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"];

type ScheduleUnit = "day" | "week" | "month";

/** 表示単位の前回値。単位切り替え時に過去・未来をその単位の初期値に戻すために使用 */
let lastScheduleUnit: ScheduleUnit | null = null;

/** 取引予定日ポップアップで編集中の予定行（設定ボタンで COMPLETED_PLANDATE を保存するときに使用） */
let occurrencePopupPlanRow: TransactionRow | null = null;

/** 対象日一覧モーダルを開いた行に付与するクラス（モーダル表示中、その行の固定列を実績線より前面にする） */
const SCHEDULE_OCCURRENCE_ROW_OPEN_CLASS = "schedule-occurrence-row-open";

/** 対象日一覧モーダルを閉じたときに、開いていた行からクラスを外す */
function clearScheduleOccurrenceRowOpen(): void {
  document
    .querySelectorAll(`#schedule-tbody tr.${SCHEDULE_OCCURRENCE_ROW_OPEN_CLASS}`)
    .forEach((tr) => tr.classList.remove(SCHEDULE_OCCURRENCE_ROW_OPEN_CLASS));
}

/** 対象日一覧モーダルを閉じ、行ハイライト用クラスを外す（設定・閉じる・オーバーレイ外クリックで共通利用） */
function closeScheduleOccurrenceOverlay(): void {
  clearScheduleOccurrenceRowOpen();
  closeOverlay("schedule-occurrence-overlay");
}

/**
 * 対象日一覧モーダルを開く。クリックした行の tr を渡すと、その行にハイライト用クラスを付与してからモーダルを表示する（実績線の重なり防止）。
 * @param row - 予定の取引行
 * @param clickedTr - クリック／キー操作したセルが属する tr。null の場合はクラス付与なしでモーダルのみ開く
 */
function openOccurrencePopupWithRowHighlight(row: TransactionRow, clickedTr: HTMLElement | null): void {
  clearScheduleOccurrenceRowOpen();
  if (clickedTr?.closest?.("#schedule-tbody")) {
    clickedTr.classList.add(SCHEDULE_OCCURRENCE_ROW_OPEN_CLASS);
    // クラス適用をレイアウトに反映させてからモーダルを開く（一瞬の重なり防止）
    void clickedTr.offsetHeight;
  }
  openScheduleOccurrencePopup(row);
}

interface DateColumn {
  key: string;
  /** 日付の上に表示（週単位は yyyy年、日単位は yyyy年m月、月単位は yyyy年m月） */
  labelLine0?: string;
  labelLine1: string;
  labelLine2: string;
  dateFrom: string;
  dateTo: string;
}

/**
 * 今日の日付を YYYY-MM-DD 形式で返す。
 * @returns 今日の日付文字列
 */
function getTodayYMD(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * 今月の初日と末日を YYYY-MM-DD で返す。
 * @returns { first: "YYYY-MM-01", last: "YYYY-MM-DD" }
 */
function getCurrentMonthFirstAndLast(): { first: string; last: string } {
  const today = getTodayYMD();
  const [y, m] = today.split("-").map(Number);
  const mm = String(m).padStart(2, "0");
  const first = `${y}-${mm}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const last = `${y}-${mm}-${String(lastDay).padStart(2, "0")}`;
  return { first, last };
}

/**
 * 指定日付に日数を加算した日付を YYYY-MM-DD で返す。
 * @param ymd - 基準日（YYYY-MM-DD）
 * @param delta - 加算する日数（負の値で過去）
 * @returns 計算後の日付文字列
 */
function addDays(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(y, m - 1, d + delta);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * 指定日付に月数を加算した日付を YYYY-MM-DD で返す。
 * @param ymd - 基準日（YYYY-MM-DD）
 * @param delta - 加算する月数
 * @returns 計算後の日付文字列
 */
function addMonths(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setMonth(date.getMonth() + delta);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * 指定日付がその月の第何週に当たるかを返す（月内の週番号。月曜始まりを想定）。
 * @param ymd - 日付（YYYY-MM-DD）
 * @returns 週番号（1 始まり）
 */
function getWeekNumberInMonth(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const dayOfWeek = first.getDay();
  const firstMonday = 1 + ((8 - dayOfWeek) % 7);
  if (firstMonday > 1) {
    const firstWeekEnd = firstMonday - 1;
    if (d <= firstWeekEnd) return 1;
    return Math.floor((d - firstWeekEnd - 1) / 7) + 2;
  }
  return Math.floor((d - 1) / 7) + 1;
}

/**
 * 年月単位の結合ヘッダー用。各日の上に「yyyy年m月」を表示するためのグループを返す。
 * @param columns - 日付列の定義
 * @returns ラベルと colspan の配列
 */
function getMonthGroups(columns: DateColumn[]): { label: string; colspan: number }[] {
  if (columns.length === 0) return [];
  const groups: { label: string; colspan: number }[] = [];
  let currentYM = "";
  let count = 0;
  for (const col of columns) {
    const ymd = col.dateFrom.slice(0, 10);
    const [y, m] = ymd.split("-").map(Number);
    const ym = `${y}-${m}`;
    if (ym !== currentYM) {
      if (count > 0) {
        const [py, pm] = currentYM.split("-").map(Number);
        groups.push({ label: `${py}年${pm}月`, colspan: count });
      }
      currentYM = ym;
      count = 0;
    }
    count++;
  }
  if (count > 0) {
    const [y, m] = currentYM.split("-").map(Number);
    groups.push({ label: `${y}年${m}月`, colspan: count });
  }
  return groups;
}

/**
 * 週単位用。年単位で結合し「yyyy年」を表示するためのグループを返す。
 * @param columns - 日付列の定義
 * @returns ラベルと colspan の配列
 */
function getYearGroups(columns: DateColumn[]): { label: string; colspan: number }[] {
  if (columns.length === 0) return [];
  const groups: { label: string; colspan: number }[] = [];
  let currentY: number | null = null;
  let count = 0;
  for (const col of columns) {
    const y = Number(col.dateFrom.slice(0, 4));
    if (y !== currentY) {
      if (count > 0 && currentY !== null) {
        groups.push({ label: `${currentY}年`, colspan: count });
      }
      currentY = y;
      count = 0;
    }
    count++;
  }
  if (count > 0 && currentY !== null) {
    groups.push({ label: `${currentY}年`, colspan: count });
  }
  return groups;
}

interface DayRangeOptions {
  pastMonths: number;
  futureMonths: number;
}

/**
 * 指定日付を含む週の日曜日を YYYY-MM-DD で返す（週は日曜始まり）。
 * @param ymd - 日付（YYYY-MM-DD）
 * @returns その週の日曜日の日付文字列
 */
function getSundayOfWeek(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const dayOfWeek = date.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  return addDays(ymd, -dayOfWeek);
}

/**
 * 表示単位（日/週/月）と開始日・範囲に応じて、スケジュール表の日付列定義を生成する。
 * @param startYMD - 開始日（YYYY-MM-DD）
 * @param unit - 表示単位
 * @param dayRange - 日/週表示時の過去・未来の月数（省略時は unit に応じた既定値）
 * @returns 日付列の配列
 */
function getDateColumns(
  startYMD: string,
  unit: ScheduleUnit,
  dayRange?: DayRangeOptions
): DateColumn[] {
  const [startY] = startYMD.split("-").map(Number);
  const columns: DateColumn[] = [];

  if (unit === "day") {
    // 過去・未来の月数で範囲を決め、範囲内の日付を1日ずつリスト化
    const pastMonths = dayRange?.pastMonths ?? 3;
    const futureMonths = dayRange?.futureMonths ?? 6;
    const rangeStart = addMonths(startYMD, -pastMonths);
    const rangeEnd = addMonths(startYMD, futureMonths);
    const list: string[] = [];
    let d = rangeStart;
    while (d <= rangeEnd) {
      list.push(d);
      d = addDays(d, 1);
    }
    const startIdx = list.indexOf(startYMD);
    // 開始日が範囲外の場合はリスト全体をそのまま列に変換
    if (startIdx < 0) {
      list.forEach((ymd) => {
        const [y, m, day] = ymd.split("-").map(Number);
        const date = new Date(y, m - 1, day);
        const week = WEEKDAY_JA[date.getDay()];
        columns.push({
          key: ymd,
          labelLine1: `${day}日`,
          labelLine2: week,
          dateFrom: ymd,
          dateTo: ymd,
        });
      });
      return columns;
    }
    // 過去→開始日→未来の順で列を並べ、スクロールで過去日も表示できるようにする
    list.forEach((ymd) => {
      const [y, m, day] = ymd.split("-").map(Number);
      const date = new Date(y, m - 1, day);
      const week = WEEKDAY_JA[date.getDay()];
      columns.push({
        key: ymd,
        labelLine1: `${day}日`,
        labelLine2: week,
        dateFrom: ymd,
        dateTo: ymd,
      });
    });
    return columns;
  }

  if (unit === "week") {
    // 日/週表示で範囲指定がある場合: 範囲内の週を日曜始まりで列挙
    if (dayRange) {
      const pastMonths = dayRange.pastMonths ?? 3;
      const futureMonths = dayRange.futureMonths ?? 6;
      const rangeStart = addMonths(startYMD, -pastMonths);
      const rangeEnd = addMonths(startYMD, futureMonths);
      const firstSunday = getSundayOfWeek(rangeStart);
      const lastSunday = getSundayOfWeek(rangeEnd);
      let weekStart = firstSunday;
      const weekCountByMonth: Record<string, number> = {};
      while (weekStart <= lastSunday) {
        const [y, m] = weekStart.split("-").map(Number);
        const monthKey = `${y}-${m}`;
        weekCountByMonth[monthKey] = (weekCountByMonth[monthKey] ?? 0) + 1;
        const weekIndexInMonth = weekCountByMonth[monthKey];
        const weekEnd = addDays(weekStart, 6);
        const [, , d1] = weekStart.split("-").map(Number);
        const [, , d2] = weekEnd.split("-").map(Number);
        columns.push({
          key: weekStart,
          labelLine1: `${weekIndexInMonth}週目`,
          labelLine2: `${d1}日～${d2}日`,
          dateFrom: weekStart,
          dateTo: weekEnd,
        });
        weekStart = addDays(weekStart, 7);
      }
      return columns;
    }
    // 週単位で範囲指定がない場合: 開始年の1～12月を週ごとに列に分割
    const year = startY;
    for (let month = 1; month <= 12; month++) {
      const lastDate = new Date(year, month, 0).getDate();
      const weekCount = getWeekNumberInMonth(`${year}-${String(month).padStart(2, "0")}-${String(lastDate).padStart(2, "0")}`);
      for (let w = 1; w <= weekCount; w++) {
        const fromDay = 1 + (w - 1) * 7;
        const toDay = Math.min(fromDay + 6, lastDate);
        const dateFrom = `${year}-${String(month).padStart(2, "0")}-${String(fromDay).padStart(2, "0")}`;
        const dateTo = `${year}-${String(month).padStart(2, "0")}-${String(toDay).padStart(2, "0")}`;
        columns.push({
          key: `${year}-${month}-${w}`,
          labelLine1: `${fromDay}日～${toDay}日`,
          labelLine2: `${w}週目`,
          dateFrom,
          dateTo,
        });
      }
    }
    return columns;
  }

  if (unit === "month") {
    // 月単位で範囲指定がある場合: 開始月～終了月を1列ずつ追加
    if (dayRange) {
      const pastMonths = dayRange.pastMonths ?? 3;
      const futureMonths = dayRange.futureMonths ?? 6;
      const rangeStart = addMonths(startYMD, -pastMonths);
      const rangeEnd = addMonths(startYMD, futureMonths);
      const [startY, startM] = rangeStart.split("-").map(Number);
      const [endY, endM] = rangeEnd.split("-").map(Number);
      let y = startY;
      let m = startM;
      const pad = (n: number) => String(n).padStart(2, "0");
      while (y < endY || (y === endY && m <= endM)) {
        const lastDate = new Date(y, m, 0).getDate();
        const dateFrom = `${y}-${pad(m)}-01`;
        const dateTo = `${y}-${pad(m)}-${pad(lastDate)}`;
        columns.push({
          key: `${y}-${m}`,
          labelLine1: `${m}月`,
          labelLine2: "",
          dateFrom,
          dateTo,
        });
        m += 1;
        if (m > 12) {
          m = 1;
          y += 1;
        }
      }
      return columns;
    }
    // 月単位で範囲指定がない場合: 開始年の1～12月を1列ずつ追加
    for (let month = 1; month <= 12; month++) {
      const y = startY;
      const lastDate = new Date(y, month, 0).getDate();
      const dateFrom = `${y}-${String(month).padStart(2, "0")}-01`;
      const dateTo = `${y}-${String(month).padStart(2, "0")}-${String(lastDate).padStart(2, "0")}`;
      columns.push({
        key: `${y}-${month}`,
        labelLine1: `${month}月`,
        labelLine2: "",
        dateFrom,
        dateTo,
      });
    }
    return columns;
  }

  return columns;
}

/**
 * 取引期間と列の期間が重なっているかどうかを判定する（間隔1日の予定用）。
 * @param rowFrom - 取引開始日（YYYY-MM-DD）
 * @param rowTo - 取引終了日（YYYY-MM-DD）
 * @param colFrom - 列の開始日
 * @param colTo - 列の終了日
 * @returns 重なっていれば true
 */
function overlaps(rowFrom: string, rowTo: string, colFrom: string, colTo: string): boolean {
  return rowFrom <= colTo && rowTo >= colFrom;
}

/**
 * 予定行について、指定列を対象セルとするかどうかを返す。
 * 間隔1日（FREQUENCY=day）のときは取引日の開始日～終了日で重なり判定。
 * それ以外はカレンダーと同様の対象日計算を使い、日単位＝対象日、週単位＝対象日を含む週、月単位＝対象日を含む月で判定。
 * @param row - 予定の取引行
 * @param col - 日付列の定義
 * @param unit - 表示単位
 * @returns 対象セルなら true
 */
function isCellActiveForPlan(
  row: TransactionRow,
  col: { dateFrom: string; dateTo: string },
  unit: ScheduleUnit
): boolean {
  const from = (row.TRANDATE_FROM || "").slice(0, 10);
  const to = (row.TRANDATE_TO || "").slice(0, 10);
  const frequency = (row.FREQUENCY ?? "day").toLowerCase();
  // 予定完了日に含まれる日は背景を付けない（常に完了日を除外してアクティブ判定）
  const occurrenceDates = getPlanOccurrenceDatesForDisplay(row, true);
  if (frequency === "day") {
    if (unit === "day") return col.dateFrom === col.dateTo && occurrenceDates.includes(col.dateFrom);
    if (unit === "week" || unit === "month") return occurrenceDates.some((d) => d >= col.dateFrom && d <= col.dateTo);
    return overlaps(from, to, col.dateFrom, col.dateTo);
  }
  if (unit === "day") {
    return col.dateFrom === col.dateTo && occurrenceDates.includes(col.dateFrom);
  }
  if (unit === "week" || unit === "month") {
    return occurrenceDates.some((d) => d >= col.dateFrom && d <= col.dateTo);
  }
  return false;
}

/** 実績取引の対象日（YYYY-MM-DD）。TRANDATE_TO を優先し、未設定時は TRANDATE_FROM。 */
function getActualTargetDate(actualRow: TransactionRow): string {
  const from = (actualRow.TRANDATE_FROM || "").trim().slice(0, 10);
  const to = (actualRow.TRANDATE_TO || "").trim().slice(0, 10);
  return (to || from) || "";
}

/**
 * 予定に紐づく実績の対象日が表示される列インデックスの一覧を返す（重複除去・昇順）。
 * 別日に複数実績がある場合、アイコンが離れた列に表示される。
 */
function getActualIconColumnIndices(
  planId: string,
  columns: { dateFrom: string; dateTo: string }[],
  unit: ScheduleUnit
): number[] {
  const actuals = getActualTransactionsForPlan(planId);
  const indices: number[] = [];
  for (const a of actuals) {
    const target = getActualTargetDate(a);
    if (!target) continue;
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      if (unit === "day") {
        if (col.dateFrom === col.dateTo && target === col.dateFrom) {
          indices.push(i);
          break;
        }
      } else {
        if (target >= col.dateFrom && target <= col.dateTo) {
          indices.push(i);
          break;
        }
      }
    }
  }
  return [...new Set(indices)].sort((x, y) => x - y);
}

/** スケジュール表の固定列数（種類・カテゴリ・取引名・金額・取引日・状況）。日付列はこの次から。 */
const SCHEDULE_FIXED_COL_COUNT = 6;

/**
 * 実績アイコンが複数列ある行について、オーバーレイで1本の線を描画する。
 * テーブル描画後の requestAnimationFrame から呼ぶ想定。
 */
function renderScheduleConnectorOverlays(): void {
  const container = document.getElementById("schedule-connector-overlays");
  const tbody = document.getElementById("schedule-tbody");
  const wrapper = document.getElementById("schedule-connector-overlays-wrapper");
  const tableInner = container?.closest(".schedule-view-table-inner") ?? undefined;
  if (!container || !tbody || !tableInner || !wrapper) return;

  container.innerHTML = "";

  // ラッパーの left/width を設定し、実績線を日付列部分だけにクリップする
  const firstDataRowForOffset = tbody.querySelector("tr:not(.schedule-connector-overlays-row)");
  const firstDateCellForOffset = firstDataRowForOffset?.children[SCHEDULE_FIXED_COL_COUNT] as
    | HTMLElement
    | undefined;
  if (firstDateCellForOffset) {
    const innerRect = tableInner.getBoundingClientRect();
    const dateCellRect = firstDateCellForOffset.getBoundingClientRect();
    const offsetLeft = dateCellRect.left - innerRect.left;
    wrapper.style.left = `${offsetLeft}px`;
    wrapper.style.width = `${innerRect.width - offsetLeft}px`;
    wrapper.dataset.scheduleFixedWidth = String(Math.round(offsetLeft));
  } else {
    wrapper.style.left = "0";
    wrapper.style.width = "0";
  }
  container.style.left = "0";
  container.style.width = "100%";

  // 高さ確定後に線位置を計算するため、rAF で高さを適用してから次のフレームで線を描画
  requestAnimationFrame(() => {
    const tbodyHeight = tbody.getBoundingClientRect().height;
    const heightPx = `${Math.max(0, tbodyHeight)}px`;
    const connectorRowEl = tbody.querySelector(".schedule-connector-overlays-row");
    if (connectorRowEl instanceof HTMLElement) {
      connectorRowEl.style.height = heightPx;
    }
    const connectorTd = connectorRowEl?.querySelector(".schedule-connector-overlays-td");
    if (connectorTd instanceof HTMLElement) {
      connectorTd.style.height = heightPx;
    }
    if (wrapper) {
      wrapper.style.height = heightPx;
    }
    if (container) {
      container.style.height = heightPx;
    }
    requestAnimationFrame(() => {
      const containerRect = container.getBoundingClientRect();
      if (containerRect.width === 0 || containerRect.height === 0) return;

      // 実績アイコンが2列以上にある行ごとに、アイコン間を結ぶ線を1本描画
      const dataRows = tbody.querySelectorAll("tr[data-actual-icon-cols]");
      dataRows.forEach((tr) => {
        const attr = tr.getAttribute("data-actual-icon-cols");
        if (!attr) return;
        const indices = attr.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !Number.isNaN(n));
        if (indices.length < 2) return;

        const firstCol = indices[0];
        const lastCol = indices[indices.length - 1];
        const firstCell = tr.children[SCHEDULE_FIXED_COL_COUNT + firstCol] as HTMLElement | undefined;
        const lastCell = tr.children[SCHEDULE_FIXED_COL_COUNT + lastCol] as HTMLElement | undefined;
        if (!firstCell || !lastCell) return;

        const firstIcon = firstCell.querySelector(".schedule-view-date-cell-actual-icon") as HTMLElement | null;
        const lastIcon = lastCell.querySelector(".schedule-view-date-cell-actual-icon") as HTMLElement | null;
        const firstRect = (firstIcon ?? firstCell).getBoundingClientRect();
        const lastRect = (lastIcon ?? lastCell).getBoundingClientRect();

        let lineLeft = firstRect.right - containerRect.left;
        let lineWidth = Math.max(0, lastRect.left - firstRect.right);
        if (lineLeft < 0) {
          lineWidth = lineWidth + lineLeft;
          lineLeft = 0;
        }
        lineWidth = Math.max(0, Math.min(lineWidth, containerRect.width - lineLeft));
        const top = firstRect.top - containerRect.top + firstRect.height / 2 - 1;
        const height = 2;

        const line = document.createElement("div");
        line.className = "schedule-connector-line";
        line.setAttribute("aria-hidden", "true");
        line.style.cssText = `left:${lineLeft}px;top:${top}px;width:${lineWidth}px;height:${height}px;`;
        container.appendChild(line);
      });
    });
  });
}

/**
 * スケジュール用フィルターで絞り込んだ「予定」のみを、開始日・終了日・登録日時でソートして返す。
 * @returns 予定の取引行の配列
 */
function getPlanRows(): TransactionRow[] {
  // スケジュール用検索条件でフィルターし、予定（PROJECT_TYPE=plan）のみに絞る
  const list = getFilteredTransactionListForSchedule(transactionList, getScheduleFilterState(), transactionTagList);
  const planOnly = list.filter((r) => (r.PROJECT_TYPE || "").toLowerCase() === "plan");
  // ステータス（計画中/完了/中止）で絞り込み。未設定は計画中扱い。選択なしの場合は全表示
  const statusNormalized = (s: string) => (s || "planning").toLowerCase() as SchedulePlanStatus;
  const byStatus =
    schedulePlanStatuses.length === 0
      ? planOnly
      : planOnly.filter((r) =>
          schedulePlanStatuses.includes(statusNormalized(r.PLAN_STATUS || "planning"))
        );
  // 開始日・終了日・登録日時の順でソート
  return byStatus.slice().sort(comparePlanRowsByDate);
}

/**
 * 「今月の評価」用に、ステータスで絞り込まない予定取引一覧を返す。
 * 検索条件のその他（勘定・タグ・日付範囲など）は getPlanRows と同様に適用する。
 * @returns 予定の取引行の配列（全ステータス）
 */
function getPlanRowsForMonthSummary(): TransactionRow[] {
  const list = getFilteredTransactionListForSchedule(transactionList, getScheduleFilterState(), transactionTagList);
  const planOnly = list.filter((r) => (r.PROJECT_TYPE || "").toLowerCase() === "plan");
  return planOnly.slice().sort(comparePlanRowsByDate);
}

function comparePlanRowsByDate(a: TransactionRow, b: TransactionRow): number {
  const af = a.TRANDATE_FROM || "";
  const bf = b.TRANDATE_FROM || "";
  const cmpFrom = af.localeCompare(bf);
  if (cmpFrom !== 0) return cmpFrom;
  const at = a.TRANDATE_TO || "";
  const bt = b.TRANDATE_TO || "";
  const cmpTo = at.localeCompare(bt);
  if (cmpTo !== 0) return cmpTo;
  const ar = a.REGIST_DATETIME || "";
  const br = b.REGIST_DATETIME || "";
  return ar.localeCompare(br);
}

/**
 * 取引種別コードを表示用ラベルに変換する。
 * @param type - 取引種別（income / expense / transfer）
 * @returns 表示用文字列（収入 / 支出 / 振替）
 */
function getTypeLabel(type: string): string {
  const t = (type || "expense").toLowerCase();
  if (t === "income") return "収入";
  if (t === "transfer") return "振替";
  return "支出";
}

/**
 * スケジュールの行（予定取引）を収支記録画面で開く。
 * @param row - 予定の取引行
 * @returns なし
 */
function openTransactionEntryForPlan(row: TransactionRow): void {
  const permType = getRowPermissionType(row);
  setTransactionEntryViewOnly(permType === "view");
  setTransactionEntryEditId(row.ID);
  setTransactionEntryReturnView("schedule");
  pushNavigation("transaction-entry");
  showMainView("transaction-entry");
  updateCurrentMenuItem();
}

/**
 * 取引予定に紐づく取引実績一覧をオーバーレイで表示する。
 * @param planId - 予定の取引 ID
 * @param planName - 予定の取引名（タイトル表示用）
 * @returns なし
 */
function openScheduleActualListPopup(planId: string, planName: string): void {
  const bodyEl = document.getElementById("schedule-actual-list-body");
  const titleEl = document.getElementById("schedule-actual-list-title");
  if (!bodyEl) return;
  if (titleEl) titleEl.textContent = `取引実績${planName ? `：${planName}` : ""}`;

  const actuals = getActualTransactionsForPlan(planId);
  bodyEl.innerHTML = "";

  // 実績が0件のときはメッセージのみ、それ以外は表で一覧表示
  if (actuals.length === 0) {
    const p = document.createElement("p");
    p.className = "schedule-actual-list-empty";
    p.textContent = "表示できる取引実績がありません。";
    bodyEl.appendChild(p);
  } else {
    // 取引実績を表形式で描画（取引日・カテゴリ(アイコン)・取引名・金額）
    const table = document.createElement("table");
    table.className = "schedule-actual-list-table";
    table.setAttribute("aria-label", "取引実績一覧");
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    const headerLabels = ["取引日", "", "取引名", "金額"];
    headerLabels.forEach((text, i) => {
      const th = document.createElement("th");
      th.scope = "col";
      th.textContent = text;
      if (i === 1) {
        th.setAttribute("aria-label", "カテゴリ");
        th.className = "schedule-actual-list-th-category";
      } else if (i === 2) th.className = "schedule-actual-list-th-name";
      else if (i === 3) th.className = "schedule-actual-list-th-amount";
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    for (const row of actuals) {
      const tr = document.createElement("tr");
      const from = (row.TRANDATE_FROM || "").slice(0, 10).replace(/-/g, "/");
      const cat = getCategoryById(row.CATEGORY_ID);

      const dateTd = document.createElement("td");
      dateTd.textContent = from;
      tr.appendChild(dateTd);

      const catTd = document.createElement("td");
      catTd.className = "schedule-actual-list-col-category";
      const catIcon = createIconWrap(cat?.COLOR || ICON_DEFAULT_COLOR, cat?.ICON_PATH, { tag: "span" });
      catTd.appendChild(catIcon);
      tr.appendChild(catTd);

      const nameTd = document.createElement("td");
      nameTd.className = "schedule-actual-list-col-name";
      nameTd.textContent = (row.NAME || "").trim() || "—";
      tr.appendChild(nameTd);

      const amountTd = document.createElement("td");
      amountTd.textContent = row.AMOUNT ? Number(row.AMOUNT).toLocaleString() : "—";
      amountTd.className = "schedule-actual-list-col-amount";
      tr.appendChild(amountTd);

      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    bodyEl.appendChild(table);
  }

  openOverlay("schedule-actual-list-overlay");
}

/** 頻度の表示ラベル */
const FREQUENCY_LABELS: Record<string, string> = {
  day: "1日",
  daily: "日ごと",
  weekly: "週ごと",
  monthly: "月ごと",
  yearly: "年ごと",
};

const WEEKDAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;
const MONTHLY_SPECIAL_LABELS: Record<string, string> = {
  "-1": "月末",
  "-2": "月末の1日前",
  "-3": "月末の2日前",
};

/**
 * 繰り返し（CYCLE_UNIT）を表示用文字列に変換する。
 */
function formatCycleUnitForDisplay(row: TransactionRow): string {
  const frequency = (row.FREQUENCY ?? "day").toLowerCase();
  const cycleUnit = (row.CYCLE_UNIT ?? "").trim();
  if (!cycleUnit || frequency === "day" || frequency === "daily") return "—";
  if (frequency === "weekly") {
    const codes = cycleUnit.split(",").map((s) => s.trim().toUpperCase());
    return codes
      .map((c) => {
        const i = WEEKDAY_CODES.indexOf(c as (typeof WEEKDAY_CODES)[number]);
        return i >= 0 ? WEEKDAY_JA[i] : c;
      })
      .join(", ");
  }
  if (frequency === "monthly") {
    const parts = cycleUnit.split(",").map((s) => s.trim());
    return parts
      .map((p) => {
        const n = parseInt(p, 10);
        if (n >= 1 && n <= 31) return `${n}日`;
        return MONTHLY_SPECIAL_LABELS[p] ?? p;
      })
      .join(", ");
  }
  if (frequency === "yearly") {
    const parts = cycleUnit.split(",").map((s) => s.trim()).filter((s) => s.length === 4);
    return parts.map((mmdd) => `${mmdd.slice(0, 2)}/${mmdd.slice(2, 4)}`).join(", ") || "—";
  }
  return cycleUnit || "—";
}

/**
 * 予定取引の対象日一覧をポップアップで表示する。
 * @param row - 予定の取引行
 */
function openScheduleOccurrencePopup(row: TransactionRow): void {
  const titleEl = document.getElementById("schedule-occurrence-title");
  const freqEl = document.getElementById("schedule-occurrence-frequency");
  const intervalEl = document.getElementById("schedule-occurrence-interval");
  const cycleEl = document.getElementById("schedule-occurrence-cycle");
  const datesWrap = document.getElementById("schedule-occurrence-dates-wrap");
  if (!datesWrap) return;

  occurrencePopupPlanRow = row;

  // ヘッダー（タイトル・頻度・間隔・繰り返し）を設定
  const planName = (row.NAME || "").trim();
  if (titleEl) titleEl.textContent = planName ? `取引予定日：${planName}` : "取引予定日";

  const frequency = (row.FREQUENCY ?? "day").toLowerCase();
  const interval = Math.max(1, parseInt(row.INTERVAL ?? "1", 10) || 1);

  if (freqEl) freqEl.textContent = FREQUENCY_LABELS[frequency] ?? frequency;
  if (intervalEl) intervalEl.textContent = String(interval);
  if (cycleEl) cycleEl.textContent = formatCycleUnitForDisplay(row);

  // 対象日一覧と完了日セットを取得
  const dates = getPlanOccurrenceDates(row);
  const completedRaw = (row.COMPLETED_PLANDATE ?? "").trim();
  const completedSet = new Set<string>();
  if (completedRaw) {
    for (const p of completedRaw.split(",").map((s) => s.trim().slice(0, 10))) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(p)) completedSet.add(p);
    }
  }
  const amount = parseFloat(String(row.AMOUNT ?? "0")) || 0;
  const amountFmt =
    amount === 0 ? "0" : amount.toLocaleString(undefined, { maximumFractionDigits: 0 });

  datesWrap.innerHTML = "";
  if (dates.length === 0) {
    const p = document.createElement("p");
    p.className = "schedule-occurrence-dates-empty";
    p.textContent = "対象日がありません。";
    datesWrap.appendChild(p);
  } else {
    // 対象日ごとに完了チェック・日付・金額の行を追加
    const table = document.createElement("table");
    table.className = "schedule-occurrence-dates-table";
    table.setAttribute("aria-label", "対象日一覧");
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    const thComplete = document.createElement("th");
    thComplete.scope = "col";
    thComplete.textContent = "完了";
    const thDate = document.createElement("th");
    thDate.scope = "col";
    thDate.textContent = "取引予定日";
    const thAmount = document.createElement("th");
    thAmount.scope = "col";
    thAmount.textContent = "金額";
    headerRow.appendChild(thComplete);
    headerRow.appendChild(thDate);
    headerRow.appendChild(thAmount);
    thead.appendChild(headerRow);
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    for (const d of dates) {
      const tr = document.createElement("tr");
      const tdComplete = document.createElement("td");
      const isSelected = completedSet.has(d);
      const checkBtn = document.createElement("button");
      // 完了トグル時は実績が紐づく日は未完了にできない旨をチェック
      checkBtn.type = "button";
      checkBtn.className = "schedule-occurrence-complete-check-btn";
      checkBtn.setAttribute("data-date", d);
      checkBtn.setAttribute("aria-label", `完了：${d.replace(/-/g, "/")}`);
      checkBtn.setAttribute("aria-pressed", isSelected ? "true" : "false");
      if (isSelected) checkBtn.classList.add("is-selected");
      const checkIcon = document.createElement("span");
      checkIcon.className = "schedule-occurrence-complete-check-icon";
      checkIcon.setAttribute("aria-hidden", "true");
      checkBtn.appendChild(checkIcon);
      const handleToggle = (): void => {
        const pressed = checkBtn.getAttribute("aria-pressed") === "true";
        const next = !pressed;
        if (pressed && !next) {
          const actuals = getActualTransactionsForPlan(row.ID ?? "");
          const actualDates = new Set(
            actuals.map((a) => getActualTargetDate(a).trim().slice(0, 10)).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x))
          );
          if (actualDates.has(d)) {
            const dateLabel = d.replace(/-/g, "/");
            alert(`${dateLabel}に実績取引が存在するため\n未完了の場合、紐づく実績取引を解除してください。`);
            return;
          }
        }
        checkBtn.setAttribute("aria-pressed", String(next));
        checkBtn.classList.toggle("is-selected", next);
      };
      checkBtn.addEventListener("click", (e) => {
        e.preventDefault();
        handleToggle();
      });
      tdComplete.appendChild(checkBtn);
      const tdDate = document.createElement("td");
      tdDate.className = "schedule-occurrence-dates-date-cell";
      tdDate.textContent = d.replace(/-/g, "/");
      tdDate.addEventListener("click", () => handleToggle());
      const tdAmount = document.createElement("td");
      tdAmount.textContent = amountFmt;
      tdAmount.className = "schedule-occurrence-dates-amount";
      tr.appendChild(tdComplete);
      tr.appendChild(tdDate);
      tr.appendChild(tdAmount);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    datesWrap.appendChild(table);
  }

  openOverlay("schedule-occurrence-overlay");
}

/**
 * スケジュール表（日付列・予定行・ガント風のセル）を再描画する。
 * 開始日・表示単位・過去/未来の範囲を DOM から読み取り、getDateColumns / getPlanRows でデータを取得して描画する。
 * @returns なし
 */
function renderScheduleGrid(): void {
  // --- 必須 DOM 要素の取得と開始日・表示単位の確定 ---
  const startInput = document.getElementById("schedule-start-date") as HTMLInputElement | null;
  const headRow = document.getElementById("schedule-head-row");
  const tbody = document.getElementById("schedule-tbody");
  const dayRangeWrap = document.getElementById("schedule-day-range-wrap");
  const pastSelect = document.getElementById("schedule-past-months") as HTMLSelectElement | null;
  const futureSelect = document.getElementById("schedule-future-months") as HTMLSelectElement | null;

  if (!startInput || !headRow || !tbody) return;

  const startYMD = startInput.value || getTodayYMD();
  if (!startYMD) return;

  // 表示単位（日/週/月）をボタンから取得
  let unit: ScheduleUnit = "day";
  const activeUnitBtn = document.querySelector(".schedule-view-unit-btn.is-active");
  const unitValue = activeUnitBtn?.getAttribute("data-schedule-unit");
  if (unitValue === "day" || unitValue === "week" || unitValue === "month") unit = unitValue;

  if (dayRangeWrap) {
    dayRangeWrap.classList.toggle("is-hidden", false);
  }
  // 過去・未来の範囲選択用オプション（月単位は年数、日/週単位は月数）
  const monthUnitOptions = Array.from({ length: 10 }, (_, i) => ({
    value: (i + 1) * 12,
    label: `${i + 1}年`,
  }));
  const dayWeekOptions = Array.from({ length: 12 }, (_, i) => ({
    value: i + 1,
    label: `${i + 1}ヶ月`,
  }));
  if (pastSelect && futureSelect) {
    const isMonth = (unit as ScheduleUnit) === "month";
    const options = isMonth ? monthUnitOptions : dayWeekOptions;
    const defaultPast = isMonth ? 12 : 3;
    const defaultFuture = isMonth ? 60 : 6;
    const unitChanged = lastScheduleUnit !== null && lastScheduleUnit !== unit;
    lastScheduleUnit = unit;
    const setOptions = (
      sel: HTMLSelectElement,
      opts: { value: number; label: string }[],
      defaultVal: number,
      forceDefault: boolean
    ) => {
      const currentBefore = Number(sel.value) || defaultVal;
      sel.innerHTML = opts.map((o) => `<option value="${o.value}">${o.label}</option>`).join("");
      if (forceDefault) {
        sel.value = String(defaultVal);
      } else {
        const valid = opts.some((o) => o.value === currentBefore);
        sel.value = String(valid ? currentBefore : defaultVal);
      }
    };
    setOptions(pastSelect, options, defaultPast, unitChanged);
    setOptions(futureSelect, options, defaultFuture, unitChanged);
  }
  if (pastSelect) pastSelect.setAttribute("aria-label", "過去の月数");
  if (futureSelect) futureSelect.setAttribute("aria-label", "未来の月数");
  const dayRange: DayRangeOptions | undefined =
    pastSelect && futureSelect
      ? { pastMonths: Number(pastSelect.value) || 3, futureMonths: Number(futureSelect.value) || 6 }
      : undefined;

  // --- 日付列・予定行の取得（描画のデータソース） ---
  const columns = getDateColumns(startYMD, unit, dayRange);
  const rows = getPlanRows();
  const todayYMD = getTodayYMD();

  // --- 年月結合行: 固定列 th ＋ 単位に応じた結合ヘッダー（yyyy年m月 など） ---
  const yearMonthRow = document.getElementById("schedule-yearmonth-row");
  if (yearMonthRow) {
    yearMonthRow.innerHTML = "";
    const ymFixed1 = document.createElement("th");
    ymFixed1.scope = "col";
    ymFixed1.colSpan = 2;
    ymFixed1.className = "schedule-view-yearmonth-col schedule-view-yearmonth-col--fixed";
    yearMonthRow.appendChild(ymFixed1);
    for (let i = 0; i < 4; i++) {
      const th = document.createElement("th");
      th.scope = "col";
      th.className = "schedule-view-yearmonth-col schedule-view-yearmonth-col--fixed";
      yearMonthRow.appendChild(th);
    }
    const headerGroups =
      (unit as ScheduleUnit) === "month" ? getYearGroups(columns) : getMonthGroups(columns);
    headerGroups.forEach((g) => {
      const th = document.createElement("th");
      th.className = "schedule-view-yearmonth-col";
      th.scope = "col";
      th.colSpan = g.colspan;
      th.textContent = g.label;
      yearMonthRow.appendChild(th);
    });
  }

  // --- 表ヘッダー行: 固定列（種類・取引名・金額・取引日・状況）＋各日付列の th ---
  headRow.innerHTML = "";
  const kindTh = document.createElement("th");
  kindTh.scope = "col";
  kindTh.colSpan = 2;
  kindTh.className = "schedule-view-head-col";
  kindTh.textContent = "種類";
  kindTh.setAttribute("aria-label", "種類");
  headRow.appendChild(kindTh);
  [
    { label: "取引名", ariaLabel: "取引名" },
    { label: "金額", ariaLabel: "金額（予定金額×発生日数）" },
    { label: "取引日", ariaLabel: "取引日" },
    { label: "状況", ariaLabel: "状況" },
  ].forEach(({ label, ariaLabel }) => {
    const th = document.createElement("th");
    th.scope = "col";
    th.className = "schedule-view-head-col";
    th.textContent = label;
    th.setAttribute("aria-label", ariaLabel);
    headRow.appendChild(th);
  });
  // 各日付列の th を追加（開始日・今日に data 属性／クラスを付与してスクロール・ハイライトに利用）
  columns.forEach((col) => {
    const th = document.createElement("th");
    th.className = "schedule-view-date-col";
    th.scope = "col";
    const isStartDay = unit === "day" && col.dateFrom === startYMD;
    const isStartWeek = unit === "week" && startYMD >= col.dateFrom && startYMD <= col.dateTo;
    const isStartMonth = unit === "month" && startYMD >= col.dateFrom && startYMD <= col.dateTo;
    if (isStartDay || isStartWeek || isStartMonth) {
      th.setAttribute("data-schedule-start-date", "true");
    }
    const isCurrentDay = unit === "day" && col.dateFrom === todayYMD;
    const isCurrentWeek = unit === "week" && todayYMD >= col.dateFrom && todayYMD <= col.dateTo;
    const isCurrentMonth = unit === "month" && todayYMD >= col.dateFrom && todayYMD <= col.dateTo;
    if (isCurrentDay || isCurrentWeek || isCurrentMonth) {
      th.classList.add("schedule-view-date-col--current");
    }
    const line0 = col.labelLine0 ? `<span class="schedule-view-date-line0">${col.labelLine0}</span>` : "";
    th.innerHTML = `${line0}<span class="schedule-view-date-line1">${col.labelLine1}</span><span class="schedule-view-date-line2">${col.labelLine2}</span>`;
    headRow.appendChild(th);
  });

  tbody.innerHTML = "";
  // 予定行の描画: 1予定1行。固定列（種類・カテゴリ・取引名・金額・取引日・状況）＋日付列セル
  rows.forEach((row) => {
    const cat = getCategoryById(row.CATEGORY_ID);
    const from = (row.TRANDATE_FROM || "").slice(0, 10);
    const to = (row.TRANDATE_TO || "").slice(0, 10) || from;

    const excludeCompleted = !schedulePlanStatuses.includes("complete");
    const occurrenceDates = getPlanOccurrenceDatesForDisplay(row, excludeCompleted);

    const tr = document.createElement("tr");
    const permType = getRowPermissionType(row);
    if (permType === "view") tr.classList.add("transaction-history-row--permission-view");
    else if (permType === "edit") tr.classList.add("transaction-history-row--permission-edit");
    // 固定列セル（種類・カテゴリ・取引名・金額・取引日・状況）を生成し、クリックで収支記録またはモーダルを開く
    const typeTd = document.createElement("td");
    typeTd.className = "schedule-col-type schedule-cell--clickable";
    typeTd.setAttribute("role", "button");
    typeTd.tabIndex = 0;
    typeTd.setAttribute("aria-label", `種類：${getTypeLabel(row.TRANSACTION_TYPE || "expense")}。収支記録を開く`);
    const txType = (row.TRANSACTION_TYPE || "expense") as "income" | "expense" | "transfer";
    const typeIcon = document.createElement("span");
    typeIcon.className = "transaction-history-type-icon transaction-history-type-icon--" + txType;
    typeIcon.setAttribute("aria-label", txType === "income" ? "収入" : txType === "expense" ? "支出" : "振替");
    typeIcon.textContent = txType === "income" ? "収" : txType === "expense" ? "支" : "振";
    typeTd.appendChild(typeIcon);
    typeTd.title = getTypeLabel(row.TRANSACTION_TYPE || "expense");
    typeTd.addEventListener("click", () => openTransactionEntryForPlan(row));
    typeTd.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openTransactionEntryForPlan(row);
      }
    });
    const catTd = document.createElement("td");
    catTd.className = "schedule-col-category";
    const catIcon = createIconWrap(cat?.COLOR || ICON_DEFAULT_COLOR, cat?.ICON_PATH, { tag: "span" });
    catTd.appendChild(catIcon);
    const nameTd = document.createElement("td");
    nameTd.className = "schedule-col-name schedule-cell--clickable";
    nameTd.setAttribute("role", "button");
    nameTd.tabIndex = 0;
    nameTd.setAttribute("aria-label", `取引名：${(row.NAME || "").trim() || "—"}。収支記録を開く`);
    nameTd.textContent = (row.NAME || "").trim() || "—";
    nameTd.addEventListener("click", () => openTransactionEntryForPlan(row));
    nameTd.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openTransactionEntryForPlan(row);
      }
    });
    const amountTd = document.createElement("td");
    amountTd.className = "schedule-col-amount schedule-cell--clickable";
    amountTd.setAttribute("role", "button");
    amountTd.tabIndex = 0;
    const amount = parseFloat(String(row.AMOUNT ?? "0")) || 0;
    const amountTotal = amount * occurrenceDates.length;
    amountTd.textContent =
      amountTotal === 0 ? "0" : amountTotal.toLocaleString(undefined, { maximumFractionDigits: 0 });
    amountTd.setAttribute(
      "aria-label",
      `金額：${amountTotal.toLocaleString()}（予定金額×発生日数）。収支記録を開く`
    );
    amountTd.addEventListener("click", () => openTransactionEntryForPlan(row));
    amountTd.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openTransactionEntryForPlan(row);
      }
    });
    const dateRangeTd = document.createElement("td");
    dateRangeTd.className = "schedule-col-date-range schedule-cell--clickable";
    dateRangeTd.setAttribute("role", "button");
    dateRangeTd.tabIndex = 0;
    dateRangeTd.setAttribute("aria-label", "取引日。対象日一覧を表示");
    const fromFmt = from ? from.replace(/-/g, "/") : "";
    const toFmt = to ? to.replace(/-/g, "/") : "";
    dateRangeTd.textContent = from && to ? (from === to ? fromFmt : `${fromFmt}～${toFmt}`) : "—";
    dateRangeTd.addEventListener("click", (e) => {
      const tr = (e.currentTarget as HTMLElement).closest?.("tr") ?? null;
      openOccurrencePopupWithRowHighlight(row, tr);
    });
    dateRangeTd.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const tr = (e.currentTarget as HTMLElement).closest?.("tr") ?? null;
        openOccurrencePopupWithRowHighlight(row, tr);
      }
    });
    const statusTd = document.createElement("td");
    statusTd.className = "schedule-col-status";
    const planStatus = (row.PLAN_STATUS || "planning").toLowerCase();
    const hasActual = getActualIdsForPlanId(row.ID).length > 0;
    const hasCompletedPlanDate = (row.COMPLETED_PLANDATE ?? "").trim() !== "";
    const hasActualOrCompletedPlanDate = hasActual || hasCompletedPlanDate;
    const actualTargetDates = new Set(
      getActualTransactionsForPlan(row.ID).map((a) => getActualTargetDate(a)).filter(Boolean)
    );
    const isDelayed =
      planStatus !== "complete" && planStatus !== "canceled" && hasDelayedPlanDates(row, todayYMD, actualTargetDates);
    const statusLabel =
      planStatus === "complete"
        ? "完了"
        : planStatus === "canceled"
          ? "中止"
          : isDelayed
            ? "遅れ"

            : hasActualOrCompletedPlanDate
              ? "進行中"
              : "未着";
    const statusModifier =
      planStatus === "complete"
        ? "complete"
        : planStatus === "canceled"
          ? "canceled"
          : isDelayed
            ? "delayed"
            : hasActualOrCompletedPlanDate
              ? "in-progress"
              : "not-started";
    const statusBtn = document.createElement("button");
    statusBtn.type = "button";
    statusBtn.className = `schedule-status-btn schedule-status-btn--${statusModifier}`;
    statusBtn.textContent = statusLabel;
    statusBtn.setAttribute(
      "aria-label",
      hasActualOrCompletedPlanDate ? "取引実績を確認" : isDelayed ? "遅れ" : statusLabel
    );
    // 実績または完了日がある場合のみクリックで実績一覧モーダルを開く
    if (hasActualOrCompletedPlanDate) {
      statusBtn.addEventListener("click", () => {
        openScheduleActualListPopup(row.ID, row.NAME || "");
      });
    }
    statusTd.appendChild(statusBtn);
    tr.appendChild(typeTd);
    tr.appendChild(catTd);
    tr.appendChild(nameTd);
    tr.appendChild(amountTd);
    tr.appendChild(dateRangeTd);
    tr.appendChild(statusTd);
    // 実績アイコンが複数列にまたがる場合、オーバーレイで線を引くため列インデックスを tr に持たせる
    const actualIconColIndices = getActualIconColumnIndices(row.ID, columns, unit);
    if (actualIconColIndices.length >= 2) {
      tr.setAttribute("data-actual-icon-cols", actualIconColIndices.join(","));
    }
    const delayedDatesSet = new Set(
      planStatus !== "complete" && planStatus !== "canceled"
        ? getDelayedPlanDates(row, todayYMD, actualTargetDates)
        : []
    );
    // 各日付列にセルを追加: 対象セルはアクティブ・クリック可、今日列は current、実績／遅れはアイコン表示
    columns.forEach((col, colIndex) => {
      const td = document.createElement("td");
      const isTargetCell = isCellActiveForPlan(row, col, unit);
      td.className = "schedule-view-date-cell";
      // 対象期間のセルのみクリックで収支記録を開く
      if (isTargetCell) {
        td.classList.add("schedule-view-date-cell--active", "schedule-cell--clickable");
        td.setAttribute("role", "button");
        td.tabIndex = 0;
        td.setAttribute("aria-label", "対象期間。収支記録を開く");
        td.addEventListener("click", () => openTransactionEntryForPlan(row));
        td.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openTransactionEntryForPlan(row);
          }
        });
      } else {
        td.setAttribute("aria-label", "対象外");
      }
      // 今日を含む列には current クラスを付与（スタイル用）
      const isCurrentDay = unit === "day" && col.dateFrom === todayYMD;
      const isCurrentWeek = unit === "week" && todayYMD >= col.dateFrom && todayYMD <= col.dateTo;
      const isCurrentMonth = unit === "month" && todayYMD >= col.dateFrom && todayYMD <= col.dateTo;
      if (isCurrentDay || isCurrentWeek || isCurrentMonth) {
        td.classList.add("schedule-view-date-cell--current");
      }
      // 実績の対象日列には「実」アイコンを表示
      if (actualIconColIndices.includes(colIndex)) {
        const actualIcon = document.createElement("span");
        actualIcon.className = "transaction-history-plan-icon schedule-view-date-cell-actual-icon";
        actualIcon.setAttribute("aria-label", "実績");
        actualIcon.textContent = "実";
        td.appendChild(actualIcon);
      }
      // 遅れ対象日がこの列に含まれる場合は fire アイコンを表示
      const hasDelayedInCell =
        unit === "day"
          ? delayedDatesSet.has(col.dateFrom)
          : [...delayedDatesSet].some((d) => d >= col.dateFrom && d <= col.dateTo);
      if (hasDelayedInCell) {
        const delayedIcon = document.createElement("span");
        delayedIcon.className = "schedule-view-date-cell-delayed-icon";
        delayedIcon.setAttribute("aria-label", "遅れ");
        const delayedImg = document.createElement("img");
        delayedImg.src = "/icon/fire-solid-full.svg";
        delayedImg.alt = "";
        delayedImg.className = "schedule-view-date-cell-delayed-img";
        delayedIcon.appendChild(delayedImg);
        td.appendChild(delayedIcon);
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  // --- 実績つなぎ線用の行を tbody 先頭に挿入（z-index: 1 で日付列の上・固定列の下に描画） ---
  const connectorRow = document.createElement("tr");
  connectorRow.className = "schedule-connector-overlays-row";
  connectorRow.setAttribute("aria-hidden", "true");
  const connectorTd = document.createElement("td");
  connectorTd.colSpan = SCHEDULE_FIXED_COL_COUNT + columns.length;
  connectorTd.className = "schedule-connector-overlays-td";
  const wrapper = document.createElement("div");
  wrapper.className = "schedule-connector-overlays-wrapper";
  wrapper.id = "schedule-connector-overlays-wrapper";
  const container = document.createElement("div");
  container.className = "schedule-connector-overlays";
  container.id = "schedule-connector-overlays";
  container.style.left = "0";
  container.style.width = "100%";
  wrapper.appendChild(container);
  connectorTd.appendChild(wrapper);
  connectorRow.appendChild(connectorTd);
  tbody.insertBefore(connectorRow, tbody.firstChild);

  // 実績つなぎ線の位置はレイアウト確定後に計算するため rAF で遅延実行
  requestAnimationFrame(() => {
    renderScheduleConnectorOverlays();
  });

  renderScheduleSummary(rows, getPlanRowsForMonthSummary());

  // 開始日列が固定列の右に来るよう横スクロール位置を調整
  if (unit === "day" || unit === "week" || unit === "month") {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => scrollScheduleGridToStartDate());
    });
  }
}

/**
 * 表示中の予定行から集計（予定収入/支出/残高、実績収入/支出/残高、進捗率）を算出し、集計ビューに反映する。
 * 予定収入・予定支出は SUM(予定金額 × 対象日の日数) で計算する。対象日の日数は planOccurrence の計算による。
 * 権限付与された勘定項目の取引データは集計対象に含めない（自分の勘定に紐づく取引のみ集計）。
 * 「今月の評価」のみ、ステータス絞りにかかわらず全ステータスの取引予定で集計する。
 * @param rows - 表示中の予定取引の配列（getPlanRows() の戻り値）
 * @param rowsForMonthSummary - 今月の評価用の予定取引（全ステータス）。省略時は rows を使用
 */
function renderScheduleSummary(rows: TransactionRow[], rowsForMonthSummary?: TransactionRow[]): void {
  const ownAccountIds = getOwnAccountIdsForSchedule();
  let planIncome = 0;
  let planExpense = 0;
  const excludeCompleted = !schedulePlanStatuses.includes("complete");
  for (const r of rows) {
    if (!isRowOnlyOwnAccounts(r, ownAccountIds)) continue; // 権限付与勘定の取引は集計しない
    const type = (r.TRANSACTION_TYPE || "").toLowerCase();
    const amount = parseFloat(String(r.AMOUNT ?? "0")) || 0;
    const occurrenceDates = getPlanOccurrenceDatesForDisplay(r, excludeCompleted);
    const count = occurrenceDates.length;
    if (type === "income") planIncome += amount * count;
    else if (type === "expense") planExpense += amount * count;
  }
  const planBalance = planIncome - planExpense;

  const actualRowsById = new Map<string, TransactionRow>();
  for (const row of rows) {
    const actuals = getActualTransactionsForPlan(row.ID);
    for (const a of actuals) {
      if (!isRowOnlyOwnAccounts(a, ownAccountIds)) continue; // 権限付与勘定の実績は集計しない
      if (!actualRowsById.has(a.ID)) actualRowsById.set(a.ID, a);
    }
  }
  let actualIncome = 0;
  let actualExpense = 0;
  for (const a of actualRowsById.values()) {
    const type = (a.TRANSACTION_TYPE || "").toLowerCase();
    const amount = parseFloat(String(a.AMOUNT ?? "0")) || 0;
    if (type === "income") actualIncome += amount;
    else if (type === "expense") actualExpense += amount;
  }
  const actualBalance = actualIncome - actualExpense;

  // 今月の評価：全ステータスの取引予定で集計（検索条件のステータス選択に依存しない）
  const monthRows = rowsForMonthSummary ?? rows;
  const { first: monthFirst, last: monthLast } = getCurrentMonthFirstAndLast();
  let monthPlanIncome = 0;
  let monthPlanExpense = 0;
  const excludeCompletedForMonth = false; // 今月の評価は全ステータス対象のため完了予定の日も含める
  for (const r of monthRows) {
    if (!isRowOnlyOwnAccounts(r, ownAccountIds)) continue;
    const type = (r.TRANSACTION_TYPE || "").toLowerCase();
    const amount = parseFloat(String(r.AMOUNT ?? "0")) || 0;
    const occurrenceDates = getPlanOccurrenceDatesForDisplay(r, excludeCompletedForMonth);
    const count = occurrenceDates.filter((d) => d >= monthFirst && d <= monthLast).length;
    if (type === "income") monthPlanIncome += amount * count;
    else if (type === "expense") monthPlanExpense += amount * count;
  }
  const monthPlanBalance = monthPlanIncome - monthPlanExpense;

  // 今月の実績は「今月の評価」対象の予定に紐づく実績のみ（全ステータス分）
  const actualRowsByIdForMonth = new Map<string, TransactionRow>();
  for (const row of monthRows) {
    const actuals = getActualTransactionsForPlan(row.ID);
    for (const a of actuals) {
      if (!isRowOnlyOwnAccounts(a, ownAccountIds)) continue;
      if (!actualRowsByIdForMonth.has(a.ID)) actualRowsByIdForMonth.set(a.ID, a);
    }
  }
  let monthActualIncome = 0;
  let monthActualExpense = 0;
  for (const a of actualRowsByIdForMonth.values()) {
    const target = getActualTargetDate(a).trim().slice(0, 10);
    if (!target || target < monthFirst || target > monthLast) continue;
    const type = (a.TRANSACTION_TYPE || "").toLowerCase();
    const amount = parseFloat(String(a.AMOUNT ?? "0")) || 0;
    if (type === "income") monthActualIncome += amount;
    else if (type === "expense") monthActualExpense += amount;
  }
  const monthActualBalance = monthActualIncome - monthActualExpense;

  const monthProgressRateIncome =
    monthPlanIncome !== 0 ? (monthActualIncome / monthPlanIncome) * 100 : null;
  const monthProgressRateExpense =
    monthPlanExpense !== 0 ? ((monthPlanExpense - monthActualExpense) / monthPlanExpense) * 100 : null;
  const monthProgressRateBalance =
    monthPlanBalance !== 0 ? (monthActualBalance / monthPlanBalance) * 100 : null;

  // 進捗率（％）。予定が0の場合は null
  const progressRateIncome =
    planIncome !== 0 ? (actualIncome / planIncome) * 100 : null;
  const progressRateExpense =
    planExpense !== 0 ? ((planExpense - actualExpense) / planExpense) * 100 : null;
  const progressRateBalance =
    planBalance !== 0 ? (actualBalance / planBalance) * 100 : null;

  // DOM 更新用ヘルパー（集計値テキストと色クラスを一括設定）
  const setSummary = (id: string, text: string): void => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };
  const setSummaryClass = (id: string, color: "red" | "blue" | null): void => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove("schedule-summary-value--red", "schedule-summary-value--blue");
    if (color === "red") el.classList.add("schedule-summary-value--red");
    else if (color === "blue") el.classList.add("schedule-summary-value--blue");
  };

  setSummary("schedule-summary-plan-income", planIncome.toLocaleString());
  setSummary("schedule-summary-plan-expense", planExpense.toLocaleString());
  setSummary("schedule-summary-plan-balance", planBalance.toLocaleString());
  setSummaryClass("schedule-summary-plan-balance", planBalance < 0 ? "red" : null);

  setSummary("schedule-summary-actual-income", actualIncome.toLocaleString());
  setSummary("schedule-summary-actual-expense", actualExpense.toLocaleString());
  setSummary("schedule-summary-actual-balance", actualBalance.toLocaleString());

  // 進捗率に応じて表示色（赤/青/null）を決定
  const incomeColor =
    progressRateIncome !== null
      ? progressRateIncome <= 50
        ? "red"
        : progressRateIncome >= 101
          ? "blue"
          : null
      : null;
  const expenseColor =
    progressRateExpense !== null
      ? progressRateExpense <= 50
        ? "red"
        : progressRateExpense >= 101
          ? "blue"
          : null
      : null;
  const balanceColor =
    progressRateBalance !== null
      ? progressRateBalance <= 50
        ? "red"
        : progressRateBalance >= 101
          ? "blue"
          : null
      : null;

  setSummaryClass("schedule-summary-actual-income", incomeColor);
  setSummaryClass("schedule-summary-actual-expense", expenseColor);
  setSummaryClass("schedule-summary-actual-balance", balanceColor);

  setSummary(
    "schedule-summary-progress-rate-income",
    progressRateIncome !== null ? `${Math.round(progressRateIncome)}%` : "—"
  );
  setSummary(
    "schedule-summary-progress-rate-expense",
    progressRateExpense !== null ? `${Math.round(progressRateExpense)}%` : "—"
  );
  setSummary(
    "schedule-summary-progress-rate-balance",
    progressRateBalance !== null ? `${Math.round(progressRateBalance)}%` : "—"
  );
  setSummaryClass("schedule-summary-progress-rate-income", incomeColor);
  setSummaryClass("schedule-summary-progress-rate-expense", expenseColor);
  setSummaryClass("schedule-summary-progress-rate-balance", balanceColor);

  // 左ブロック「今月の評価」
  setSummary("schedule-summary-month-plan-income", monthPlanIncome.toLocaleString());
  setSummary("schedule-summary-month-plan-expense", monthPlanExpense.toLocaleString());
  setSummary("schedule-summary-month-plan-balance", monthPlanBalance.toLocaleString());
  setSummaryClass("schedule-summary-month-plan-balance", monthPlanBalance < 0 ? "red" : null);

  setSummary("schedule-summary-month-actual-income", monthActualIncome.toLocaleString());
  setSummary("schedule-summary-month-actual-expense", monthActualExpense.toLocaleString());
  setSummary("schedule-summary-month-actual-balance", monthActualBalance.toLocaleString());

  const monthIncomeColor =
    monthProgressRateIncome !== null
      ? monthProgressRateIncome <= 50
        ? "red"
        : monthProgressRateIncome >= 101
          ? "blue"
          : null
      : null;
  const monthExpenseColor =
    monthProgressRateExpense !== null
      ? monthProgressRateExpense <= 50
        ? "red"
        : monthProgressRateExpense >= 101
          ? "blue"
          : null
      : null;
  const monthBalanceColor =
    monthProgressRateBalance !== null
      ? monthProgressRateBalance <= 50
        ? "red"
        : monthProgressRateBalance >= 101
          ? "blue"
          : null
      : null;

  setSummaryClass("schedule-summary-month-actual-income", monthIncomeColor);
  setSummaryClass("schedule-summary-month-actual-expense", monthExpenseColor);
  setSummaryClass("schedule-summary-month-actual-balance", monthBalanceColor);

  setSummary(
    "schedule-summary-month-progress-rate-income",
    monthProgressRateIncome !== null ? `${Math.round(monthProgressRateIncome)}%` : "—"
  );
  setSummary(
    "schedule-summary-month-progress-rate-expense",
    monthProgressRateExpense !== null ? `${Math.round(monthProgressRateExpense)}%` : "—"
  );
  setSummary(
    "schedule-summary-month-progress-rate-balance",
    monthProgressRateBalance !== null ? `${Math.round(monthProgressRateBalance)}%` : "—"
  );
  setSummaryClass("schedule-summary-month-progress-rate-income", monthIncomeColor);
  setSummaryClass("schedule-summary-month-progress-rate-expense", monthExpenseColor);
  setSummaryClass("schedule-summary-month-progress-rate-balance", monthBalanceColor);
}

/**
 * スケジュールグリッドの横スクロールを開始日列の位置に戻す。
 * @returns なし
 */
function scrollScheduleGridToStartDate(): void {
  const gridWrap = document.querySelector(".schedule-view-grid-wrap");
  const startDateTh = document.querySelector(".schedule-view-date-col[data-schedule-start-date=\"true\"]");
  if (!gridWrap || !startDateTh) return;
  const wrap = gridWrap as HTMLElement;
  const startTh = startDateTh as HTMLElement;
  const firstDateTh = wrap.querySelector(".schedule-view-date-col");
  if (firstDateTh) {
    const firstLeft = (firstDateTh as HTMLElement).offsetLeft;
    const startLeft = startTh.offsetLeft;
    wrap.scrollLeft = startLeft - firstLeft;
  }
}

/**
 * スケジュール画面の初期化を行う。ビュー・更新・フィルター変更のハンドラ登録と、開始日・単位・範囲のイベント登録を行う。
 * @returns なし
 */
export function initScheduleView(): void {
  // ビュー表示時: 取引データ読み込み後、開始日未設定なら今日をセットしてグリッド描画
  registerViewHandler("schedule", () => {
    loadTransactionData().then(() => {
      requestAnimationFrame(() => {
        const startInput = document.getElementById("schedule-start-date") as HTMLInputElement | null;
        if (startInput && !startInput.value) {
          startInput.value = getTodayYMD();
        }
        renderScheduleGrid();
      });
    });
    setDisplayedKeys("schedule", ["TRANSACTION.csv", "CATEGORY.csv", "TRANSACTION_MANAGEMENT.csv"]);
  });

  registerRefreshHandler("schedule", () => {
    loadTransactionData(true).then(() => renderScheduleGrid());
  });

  // フィルター変更時: スケジュール表示中ならグリッドを再描画
  registerFilterChangeCallback(() => {
    if (document.getElementById("view-schedule")?.classList.contains("main-view--hidden") === false) {
      renderScheduleGrid();
    }
  });

  // 開始日変更でグリッド再描画
  const startInput = document.getElementById("schedule-start-date") as HTMLInputElement | null;
  startInput?.addEventListener("change", () => renderScheduleGrid());

  // 表示単位ボタン（日/週/月）: 選択中を切り替え、次フレームでグリッド再描画
  document.querySelectorAll(".schedule-view-unit-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const value = (btn as HTMLElement).getAttribute("data-schedule-unit");
      if (value !== "day" && value !== "week" && value !== "month") return;
      document.querySelectorAll(".schedule-view-unit-btn").forEach((b) => {
        b.classList.remove("is-active");
        b.setAttribute("aria-pressed", "false");
      });
      btn.classList.add("is-active");
      btn.setAttribute("aria-pressed", "true");
      // ボタンの色を先に描画させるため、重いグリッド再描画は次フレームに遅延（日単位は列数が多くブロックしやすい）
      requestAnimationFrame(() => {
        renderScheduleGrid();
      });
    });
  });

  // 過去・未来の範囲変更でグリッド再描画
  const pastSelect = document.getElementById("schedule-past-months") as HTMLSelectElement | null;
  const futureSelect = document.getElementById("schedule-future-months") as HTMLSelectElement | null;
  pastSelect?.addEventListener("change", () => renderScheduleGrid());
  futureSelect?.addEventListener("change", () => renderScheduleGrid());

  document.getElementById("schedule-scroll-reset-btn")?.addEventListener("click", () => {
    scrollScheduleGridToStartDate();
  });

  // リサイズ時に実績つなぎ線オーバーレイの位置を再計算
  let overlayResizeTimer: ReturnType<typeof setTimeout> | null = null;
  window.addEventListener("resize", () => {
    if (overlayResizeTimer) clearTimeout(overlayResizeTimer);
    overlayResizeTimer = setTimeout(() => {
      overlayResizeTimer = null;
      if (document.getElementById("view-schedule")?.classList.contains("main-view--hidden") === false) {
        renderScheduleConnectorOverlays();
      }
    }, 150);
  });

  // 取引実績オーバーレイの閉じるボタンとオーバーレイ外クリック
  document.getElementById("schedule-actual-list-close")?.addEventListener("click", () => {
    closeOverlay("schedule-actual-list-overlay");
  });
  document.getElementById("schedule-actual-list-overlay")?.addEventListener("click", (e) => {
    if (e.target instanceof HTMLElement && e.target.id === "schedule-actual-list-overlay") {
      closeOverlay("schedule-actual-list-overlay");
    }
  });

  // 対象日一覧の「設定」: チェックされた日付を COMPLETED_PLANDATE に保存し、CSV 更新後にモーダルを閉じる
  document.getElementById("schedule-occurrence-apply")?.addEventListener("click", async () => {
    const row = occurrencePopupPlanRow;
    if (!row?.ID) {
      closeScheduleOccurrenceOverlay();
      return;
    }
    const wrap = document.getElementById("schedule-occurrence-dates-wrap");
    const checkBtns = wrap?.querySelectorAll<HTMLButtonElement>(".schedule-occurrence-complete-check-btn.is-selected");
    const completedDates: string[] = [];
    checkBtns?.forEach((btn) => {
      const d = btn.getAttribute("data-date")?.trim().slice(0, 10);
      if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) completedDates.push(d);
    });
    const newCompletedPlanDate = completedDates.sort().join(",");
    const allOccurrenceDates = getPlanOccurrenceDates(row);
    const completedSet = new Set(completedDates);
    const allComplete =
      allOccurrenceDates.length > 0 && allOccurrenceDates.every((d) => completedSet.has(d));
    const notAllComplete =
      allOccurrenceDates.length > 0 && !allOccurrenceDates.every((d) => completedSet.has(d));
    const currentPlanStatus = (row.PLAN_STATUS || "planning").toLowerCase();

    try {
      const { header, rows } = await fetchCsv("/data/TRANSACTION.csv");
      if (header.length === 0 || !rows.length) {
        closeScheduleOccurrenceOverlay();
        return;
      }
      const allRows = rows.map((cells) => rowToObject(header, cells));
      const target = allRows.find((r) => (r.ID ?? "").trim() === String(row.ID).trim());
      if (!target) {
        closeScheduleOccurrenceOverlay();
        return;
      }
      target.COMPLETED_PLANDATE = newCompletedPlanDate;
      if (currentPlanStatus === "planning" && allComplete) {
        target.PLAN_STATUS = "complete";
      } else if (currentPlanStatus === "complete" && notAllComplete) {
        target.PLAN_STATUS = "planning";
      }
      target.VERSION = String((parseInt(target.VERSION ?? "0", 10) || 0) + 1);
      const csv = transactionListToCsv(allRows);
      await saveCsvViaApi("TRANSACTION.csv", csv);
      occurrencePopupPlanRow = null;
      closeScheduleOccurrenceOverlay();
      await loadTransactionData(true);
      renderScheduleGrid();
    } catch {
      occurrencePopupPlanRow = null;
      closeScheduleOccurrenceOverlay();
    }
  });
  document.getElementById("schedule-occurrence-overlay")?.addEventListener("click", (e) => {
    if (e.target instanceof HTMLElement && e.target.id === "schedule-occurrence-overlay") {
      closeScheduleOccurrenceOverlay();
    }
  });
}
