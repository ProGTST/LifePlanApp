import type { TransactionRow } from "../types";
import {
  loadTransactionData,
  getFilteredTransactionListForSchedule,
  getCategoryById,
  getRowPermissionType,
  registerFilterChangeCallback,
} from "./transaction-history-screen";
import { registerViewHandler, registerRefreshHandler } from "../app/screen";
import { setDisplayedKeys } from "../utils/csvWatch";
import { createIconWrap } from "../utils/iconWrap";
import { ICON_DEFAULT_COLOR } from "../constants/colorPresets";

const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"];

type ScheduleUnit = "day" | "week" | "month";

interface DateColumn {
  key: string;
  /** 日付の上に表示（週単位は yyyy年、日単位は yyyy年m月、月単位は yyyy年m月） */
  labelLine0?: string;
  labelLine1: string;
  labelLine2: string;
  dateFrom: string;
  dateTo: string;
}

function getTodayYMD(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(y, m - 1, d + delta);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addMonths(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setMonth(date.getMonth() + delta);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getWeekNumberInMonth(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const date = new Date(y, m - 1, d);
  const dayOfWeek = first.getDay();
  const firstMonday = 1 + ((8 - dayOfWeek) % 7);
  if (firstMonday > 1) {
    const firstWeekEnd = firstMonday - 1;
    if (d <= firstWeekEnd) return 1;
    return Math.floor((d - firstWeekEnd - 1) / 7) + 2;
  }
  return Math.floor((d - 1) / 7) + 1;
}

/** 年月単位の結合ヘッダー用。1日の上に yyyy年m月 を表示する */
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

/** 週単位用。年単位で結合し yyyy年 を表示する */
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

/** 指定日付を含む週の日曜日を YYYY-MM-DD で返す（週は日曜始まり） */
function getSundayOfWeek(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const dayOfWeek = date.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  return addDays(ymd, -dayOfWeek);
}

function getDateColumns(
  startYMD: string,
  unit: ScheduleUnit,
  dayRange?: DayRangeOptions
): DateColumn[] {
  const [startY] = startYMD.split("-").map(Number);
  const columns: DateColumn[] = [];
  const pad = (n: number) => String(n).padStart(2, "0");

  if (unit === "day") {
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

function overlaps(rowFrom: string, rowTo: string, colFrom: string, colTo: string): boolean {
  return rowFrom <= colTo && rowTo >= colFrom;
}

function getPlanRows(): TransactionRow[] {
  const list = getFilteredTransactionListForSchedule();
  const planOnly = list.filter((r) => (r.STATUS || "").toLowerCase() === "plan");
  return planOnly.slice().sort((a, b) => {
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

function getTypeLabel(type: string): string {
  const t = (type || "expense").toLowerCase();
  if (t === "income") return "収入";
  if (t === "transfer") return "振替";
  return "支出";
}

function renderScheduleGrid(): void {
  const startInput = document.getElementById("schedule-start-date") as HTMLInputElement | null;
  const unitRadios = document.querySelectorAll<HTMLInputElement>('input[name="schedule-unit"]');
  const headRow = document.getElementById("schedule-head-row");
  const tbody = document.getElementById("schedule-tbody");
  const dayRangeWrap = document.getElementById("schedule-day-range-wrap");
  const pastSelect = document.getElementById("schedule-past-months") as HTMLSelectElement | null;
  const futureSelect = document.getElementById("schedule-future-months") as HTMLSelectElement | null;

  if (!startInput || !headRow || !tbody) return;

  const startYMD = startInput.value || getTodayYMD();
  if (!startYMD) return;

  let unit: ScheduleUnit = "day";
  unitRadios.forEach((r) => {
    if (r.checked) unit = r.value as ScheduleUnit;
  });

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
    const setOptions = (
      sel: HTMLSelectElement,
      opts: { value: number; label: string }[],
      defaultVal: number
    ) => {
      const current = Number(sel.value) || defaultVal;
      const valid = opts.some((o) => o.value === current);
      sel.innerHTML = opts.map((o) => `<option value="${o.value}">${o.label}</option>`).join("");
      sel.value = String(valid ? current : defaultVal);
    };
    setOptions(pastSelect, options, defaultPast);
    setOptions(futureSelect, options, defaultFuture);
  }
  if (pastSelect) {
    pastSelect.setAttribute("aria-label", "過去の月数");
  }
  if (futureSelect) {
    futureSelect.setAttribute("aria-label", "未来の月数");
  }
  const dayRange: DayRangeOptions | undefined =
    pastSelect && futureSelect
      ? { pastMonths: Number(pastSelect.value) || 3, futureMonths: Number(futureSelect.value) || 6 }
      : undefined;

  const columns = getDateColumns(startYMD, unit, dayRange);
  const rows = getPlanRows();
  const todayYMD = getTodayYMD();

  const yearMonthRow = document.getElementById("schedule-yearmonth-row");
  if (yearMonthRow) {
    yearMonthRow.innerHTML = "";
    const ymFixed1 = document.createElement("th");
    ymFixed1.scope = "col";
    ymFixed1.colSpan = 2;
    ymFixed1.className = "schedule-view-yearmonth-col schedule-view-yearmonth-col--fixed";
    yearMonthRow.appendChild(ymFixed1);
    for (let i = 0; i < 3; i++) {
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
  rows.forEach((row) => {
    const cat = getCategoryById(row.CATEGORY_ID);
    const from = (row.TRANDATE_FROM || "").slice(0, 10);
    const to = (row.TRANDATE_TO || "").slice(0, 10) || from;

    const tr = document.createElement("tr");
    const permType = getRowPermissionType(row);
    if (permType === "view") tr.classList.add("transaction-history-row--permission-view");
    else if (permType === "edit") tr.classList.add("transaction-history-row--permission-edit");
    const typeTd = document.createElement("td");
    typeTd.className = "schedule-col-type";
    const txType = (row.TYPE || "expense") as "income" | "expense" | "transfer";
    const typeIcon = document.createElement("span");
    typeIcon.className = "transaction-history-type-icon transaction-history-type-icon--" + txType;
    typeIcon.setAttribute("aria-label", txType === "income" ? "収入" : txType === "expense" ? "支出" : "振替");
    typeIcon.textContent = txType === "income" ? "収" : txType === "expense" ? "支" : "振";
    typeTd.appendChild(typeIcon);
    typeTd.title = getTypeLabel(row.TYPE || "expense");
    const catTd = document.createElement("td");
    catTd.className = "schedule-col-category";
    const catIcon = createIconWrap(cat?.COLOR || ICON_DEFAULT_COLOR, cat?.ICON_PATH, { tag: "span" });
    catTd.appendChild(catIcon);
    const nameTd = document.createElement("td");
    nameTd.className = "schedule-col-name";
    nameTd.textContent = (row.NAME || "").trim() || "—";
    const dateRangeTd = document.createElement("td");
    dateRangeTd.className = "schedule-col-date-range";
    const fromFmt = from ? from.replace(/-/g, "/") : "";
    const toFmt = to ? to.replace(/-/g, "/") : "";
    dateRangeTd.textContent = from && to ? (from === to ? fromFmt : `${fromFmt}～${toFmt}`) : "—";
    const statusTd = document.createElement("td");
    statusTd.className = "schedule-col-status";
    statusTd.textContent = "予定";
    tr.appendChild(typeTd);
    tr.appendChild(catTd);
    tr.appendChild(nameTd);
    tr.appendChild(dateRangeTd);
    tr.appendChild(statusTd);
    columns.forEach((col) => {
      const td = document.createElement("td");
      td.className = "schedule-view-date-cell";
      if (overlaps(from, to, col.dateFrom, col.dateTo)) {
        td.classList.add("schedule-view-date-cell--active");
        td.setAttribute("aria-label", "対象期間");
      }
      const isCurrentDay = unit === "day" && col.dateFrom === todayYMD;
      const isCurrentWeek = unit === "week" && todayYMD >= col.dateFrom && todayYMD <= col.dateTo;
      const isCurrentMonth = unit === "month" && todayYMD >= col.dateFrom && todayYMD <= col.dateTo;
      if (isCurrentDay || isCurrentWeek || isCurrentMonth) {
        td.classList.add("schedule-view-date-cell--current");
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  // 日単位・週単位・月単位のときは開始日（または開始日を含む週・月）が固定列の横に来るようスクロール
  if (unit === "day" || unit === "week" || unit === "month") {
    const gridWrap = document.querySelector(".schedule-view-grid-wrap");
    const startDateTh = document.querySelector(".schedule-view-date-col[data-schedule-start-date=\"true\"]");
    if (gridWrap && startDateTh) {
      const scrollToStartDate = (): void => {
        const wrap = gridWrap as HTMLElement;
        const startTh = startDateTh as HTMLElement;
        const firstDateTh = wrap.querySelector(".schedule-view-date-col");
        if (firstDateTh) {
          const firstLeft = (firstDateTh as HTMLElement).offsetLeft;
          const startLeft = startTh.offsetLeft;
          wrap.scrollLeft = startLeft - firstLeft;
        }
      };
      requestAnimationFrame(() => {
        requestAnimationFrame(() => scrollToStartDate());
      });
    }
  }
}

export function initScheduleView(): void {
  registerViewHandler("schedule", () => {
    loadTransactionData().then(() => {
      const startInput = document.getElementById("schedule-start-date") as HTMLInputElement | null;
      if (startInput && !startInput.value) {
        startInput.value = getTodayYMD();
      }
      renderScheduleGrid();
    });
    setDisplayedKeys("schedule", ["TRANSACTION.csv", "CATEGORY.csv"]);
  });

  registerRefreshHandler("schedule", () => {
    loadTransactionData(true).then(() => renderScheduleGrid());
  });

  registerFilterChangeCallback(() => {
    if (document.getElementById("view-schedule")?.classList.contains("main-view--hidden") === false) {
      renderScheduleGrid();
    }
  });

  const startInput = document.getElementById("schedule-start-date") as HTMLInputElement | null;
  startInput?.addEventListener("change", () => renderScheduleGrid());

  document.querySelectorAll('input[name="schedule-unit"]').forEach((radio) => {
    radio.addEventListener("change", () => renderScheduleGrid());
  });

  const pastSelect = document.getElementById("schedule-past-months") as HTMLSelectElement | null;
  const futureSelect = document.getElementById("schedule-future-months") as HTMLSelectElement | null;
  pastSelect?.addEventListener("change", () => renderScheduleGrid());
  futureSelect?.addEventListener("change", () => renderScheduleGrid());
}
