import type { TransactionRow } from "../types";
import type { SchedulePlanStatus } from "../state";
import {
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
  getCategoryById,
  getRowPermissionType,
  getActualIdsForPlanId,
  getActualTransactionsForPlan,
} from "../utils/transactionDataSync";
import { registerFilterChangeCallback } from "../utils/transactionDataLayout";
import { getFilteredTransactionListForSchedule } from "../utils/transactionDataFilter";
import { getPlanOccurrenceDatesForDisplay } from "../utils/planOccurrence";
import { openOverlay, closeOverlay } from "../utils/overlay";
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

const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"];

type ScheduleUnit = "day" | "week" | "month";

/** 表示単位の前回値。単位切り替え時に過去・未来をその単位の初期値に戻すために使用 */
let lastScheduleUnit: ScheduleUnit | null = null;

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
  if (frequency === "day") {
    return overlaps(from, to, col.dateFrom, col.dateTo);
  }
  const excludeCompleted = !schedulePlanStatuses.includes("complete");
  const occurrenceDates = getPlanOccurrenceDatesForDisplay(row, excludeCompleted);
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
 * 予定に紐づく実績の対象日が、指定列の期間に含まれるかどうか。
 * @param planId - 予定の取引 ID
 * @param col - 日付列の定義
 * @param unit - 表示単位
 * @returns 実績の対象日が列に含まれていれば true
 */
function isActualTargetInColumn(
  planId: string,
  col: { dateFrom: string; dateTo: string },
  unit: ScheduleUnit
): boolean {
  const actuals = getActualTransactionsForPlan(planId);
  if (actuals.length === 0) return false;
  for (const a of actuals) {
    const target = getActualTargetDate(a);
    if (!target) continue;
    if (unit === "day") {
      if (col.dateFrom === col.dateTo && target === col.dateFrom) return true;
    } else {
      if (target >= col.dateFrom && target <= col.dateTo) return true;
    }
  }
  return false;
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
  return byStatus.slice().sort((a, b) => {
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
  });
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

  const planName = (row.NAME || "").trim();
  if (titleEl) titleEl.textContent = planName ? `取引予定日：${planName}` : "取引予定日";

  const frequency = (row.FREQUENCY ?? "day").toLowerCase();
  const interval = Math.max(1, parseInt(row.INTERVAL ?? "1", 10) || 1);

  if (freqEl) freqEl.textContent = FREQUENCY_LABELS[frequency] ?? frequency;
  if (intervalEl) intervalEl.textContent = String(interval);
  if (cycleEl) cycleEl.textContent = formatCycleUnitForDisplay(row);

  const excludeCompleted = !schedulePlanStatuses.includes("complete");
  const dates = getPlanOccurrenceDatesForDisplay(row, excludeCompleted);
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
    const table = document.createElement("table");
    table.className = "schedule-occurrence-dates-table";
    table.setAttribute("aria-label", "対象日一覧");
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    const thDate = document.createElement("th");
    thDate.scope = "col";
    thDate.textContent = "取引予定日";
    const thAmount = document.createElement("th");
    thAmount.scope = "col";
    thAmount.textContent = "金額";
    headerRow.appendChild(thDate);
    headerRow.appendChild(thAmount);
    thead.appendChild(headerRow);
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    for (const d of dates) {
      const tr = document.createElement("tr");
      const tdDate = document.createElement("td");
      tdDate.textContent = d.replace(/-/g, "/");
      const tdAmount = document.createElement("td");
      tdAmount.textContent = amountFmt;
      tdAmount.className = "schedule-occurrence-dates-amount";
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
  // 過去・未来の月数（日/週/月単位で select のオプションを切り替え済み）
  const dayRange: DayRangeOptions | undefined =
    pastSelect && futureSelect
      ? { pastMonths: Number(pastSelect.value) || 3, futureMonths: Number(futureSelect.value) || 6 }
      : undefined;

  // 日付列と予定行を取得し、今日の日付でハイライト用に保持
  const columns = getDateColumns(startYMD, unit, dayRange);
  const rows = getPlanRows();
  const todayYMD = getTodayYMD();

  // 年月結合行: 固定列の th を追加し、単位に応じて getMonthGroups / getYearGroups で結合ヘッダーを描画
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

  // 表ヘッダー行: 種類・取引名・取引日・状況の固定列＋日付列
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
  // 各日付列の th を追加（開始日・今日に data 属性やクラスを付与）
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
  // 予定ごとに1行ずつ描画し、各日付列に重なりがあればアクティブクラスを付与
  rows.forEach((row) => {
    const cat = getCategoryById(row.CATEGORY_ID);
    const from = (row.TRANDATE_FROM || "").slice(0, 10);
    const to = (row.TRANDATE_TO || "").slice(0, 10) || from;

    const tr = document.createElement("tr");
    const permType = getRowPermissionType(row);
    if (permType === "view") tr.classList.add("transaction-history-row--permission-view");
    else if (permType === "edit") tr.classList.add("transaction-history-row--permission-edit");
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
    const excludeCompleted = !schedulePlanStatuses.includes("complete");
    const occurrenceDates = getPlanOccurrenceDatesForDisplay(row, excludeCompleted);
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
    dateRangeTd.addEventListener("click", () => openScheduleOccurrencePopup(row));
    dateRangeTd.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openScheduleOccurrencePopup(row);
      }
    });
    const statusTd = document.createElement("td");
    statusTd.className = "schedule-col-status";
    const planStatus = (row.PLAN_STATUS || "planning").toLowerCase();
    const hasActual = getActualIdsForPlanId(row.ID).length > 0;
    const statusLabel =
      planStatus === "complete"
        ? "完了"
        : planStatus === "canceled"
          ? "中止"
          : hasActual
            ? "進行中"
            : "未着";
    const statusModifier =
      planStatus === "complete"
        ? "complete"
        : planStatus === "canceled"
          ? "canceled"
          : hasActual
            ? "in-progress"
            : "not-started";
    const statusBtn = document.createElement("button");
    statusBtn.type = "button";
    statusBtn.className = `schedule-status-btn schedule-status-btn--${statusModifier}`;
    statusBtn.textContent = statusLabel;
    statusBtn.setAttribute("aria-label", hasActual ? "取引実績を確認" : statusLabel);
    if (hasActual) {
      statusBtn.addEventListener("click", () => openScheduleActualListPopup(row.ID, row.NAME || ""));
    }
    statusTd.appendChild(statusBtn);
    tr.appendChild(typeTd);
    tr.appendChild(catTd);
    tr.appendChild(nameTd);
    tr.appendChild(amountTd);
    tr.appendChild(dateRangeTd);
    tr.appendChild(statusTd);
    // 各日付列にセルを追加。対象日計算に基づき対象セルのみアクティブクラス・クリック可能。今日なら current クラス。実績の対象日には「実」アイコンを表示
    columns.forEach((col) => {
      const td = document.createElement("td");
      const isTargetCell = isCellActiveForPlan(row, col, unit);
      td.className = "schedule-view-date-cell";
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
      const isCurrentDay = unit === "day" && col.dateFrom === todayYMD;
      const isCurrentWeek = unit === "week" && todayYMD >= col.dateFrom && todayYMD <= col.dateTo;
      const isCurrentMonth = unit === "month" && todayYMD >= col.dateFrom && todayYMD <= col.dateTo;
      if (isCurrentDay || isCurrentWeek || isCurrentMonth) {
        td.classList.add("schedule-view-date-cell--current");
      }
      if (isActualTargetInColumn(row.ID, col, unit)) {
        const actualIcon = document.createElement("span");
        actualIcon.className = "transaction-history-plan-icon schedule-view-date-cell-actual-icon";
        actualIcon.setAttribute("aria-label", "実績");
        actualIcon.textContent = "実";
        td.appendChild(actualIcon);
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  // 集計ビューを更新（表示データの予定・実績の合計と進捗率）
  renderScheduleSummary(rows);

  // 日単位・週単位・月単位のときは開始日（または開始日を含む週・月）が固定列の横に来るようスクロール
  if (unit === "day" || unit === "week" || unit === "month") {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => scrollScheduleGridToStartDate());
    });
  }
}

/**
 * 表示中の予定行から集計（予定収入/支出/残高、実績収入/支出/残高、進捗率）を算出し、集計ビューに反映する。
 * 予定収入・予定支出は SUM(予定金額 × 対象日の日数) で計算する。対象日の日数は planOccurrence の計算による。
 * @param rows - 表示中の予定取引の配列（getPlanRows() の戻り値）
 */
function renderScheduleSummary(rows: TransactionRow[]): void {
  let planIncome = 0;
  let planExpense = 0;
  const excludeCompleted = !schedulePlanStatuses.includes("complete");
  for (const r of rows) {
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

  const progressRateIncome =
    planIncome !== 0 ? (actualIncome / planIncome) * 100 : null;
  const progressRateExpense =
    planExpense !== 0 ? ((planExpense - actualExpense) / planExpense) * 100 : null;
  const progressRateBalance =
    planBalance !== 0 ? (actualBalance / planBalance) * 100 : null;

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
  // スケジュール表示時に取引データを読み込み、開始日未設定なら今日を入れてグリッド描画
  registerViewHandler("schedule", () => {
    loadTransactionData().then(() => {
      const startInput = document.getElementById("schedule-start-date") as HTMLInputElement | null;
      if (startInput && !startInput.value) {
        startInput.value = getTodayYMD();
      }
      renderScheduleGrid();
    });
    setDisplayedKeys("schedule", ["TRANSACTION.csv", "CATEGORY.csv", "TRANSACTION_MANAGEMENT.csv"]);
  });

  registerRefreshHandler("schedule", () => {
    loadTransactionData(true).then(() => renderScheduleGrid());
  });

  // 検索条件変更時に表示中ならグリッドを再描画
  registerFilterChangeCallback(() => {
    if (document.getElementById("view-schedule")?.classList.contains("main-view--hidden") === false) {
      renderScheduleGrid();
    }
  });

  // 開始日・表示単位・過去/未来の月数変更でグリッド再描画
  const startInput = document.getElementById("schedule-start-date") as HTMLInputElement | null;
  startInput?.addEventListener("change", () => renderScheduleGrid());

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

  const pastSelect = document.getElementById("schedule-past-months") as HTMLSelectElement | null;
  const futureSelect = document.getElementById("schedule-future-months") as HTMLSelectElement | null;
  pastSelect?.addEventListener("change", () => renderScheduleGrid());
  futureSelect?.addEventListener("change", () => renderScheduleGrid());

  document.getElementById("schedule-scroll-reset-btn")?.addEventListener("click", () => {
    scrollScheduleGridToStartDate();
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

  // 対象日一覧オーバーレイの閉じるボタンとオーバーレイ外クリック
  document.getElementById("schedule-occurrence-close")?.addEventListener("click", () => {
    closeOverlay("schedule-occurrence-overlay");
  });
  document.getElementById("schedule-occurrence-overlay")?.addEventListener("click", (e) => {
    if (e.target instanceof HTMLElement && e.target.id === "schedule-occurrence-overlay") {
      closeOverlay("schedule-occurrence-overlay");
    }
  });
}
