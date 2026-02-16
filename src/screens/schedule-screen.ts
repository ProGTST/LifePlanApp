import type { TransactionRow } from "../types";
import { loadTransactionData, getFilteredTransactionList, getCategoryById } from "./transaction-history-screen";
import { registerViewHandler, registerRefreshHandler } from "../app/screen";
import { setDisplayedKeys } from "../utils/csvWatch";
import { createIconWrap } from "../utils/iconWrap";
import { ICON_DEFAULT_COLOR } from "../constants/colorPresets";

const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"];

type ScheduleUnit = "day" | "week" | "month";

interface DateColumn {
  key: string;
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

/** 年月単位の結合ヘッダー用。1日の上に yyyy年M月 を表示する */
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

function getDateColumns(startYMD: string, unit: ScheduleUnit): DateColumn[] {
  const [startY, startM, startD] = startYMD.split("-").map(Number);
  const columns: DateColumn[] = [];

  if (unit === "day") {
    const year = startY;
    const month = startM;
    const lastDate = new Date(year, month, 0).getDate();
    const pad = (n: number) => String(n).padStart(2, "0");
    for (let day = 1; day <= lastDate; day++) {
      const d = `${year}-${pad(month)}-${pad(day)}`;
      const date = new Date(year, month - 1, day);
      const week = WEEKDAY_JA[date.getDay()];
      columns.push({
        key: d,
        labelLine1: `${day}日`,
        labelLine2: week,
        dateFrom: d,
        dateTo: d,
      });
    }
    return columns;
  }

  if (unit === "week") {
    const year = startY;
    for (let month = 1; month <= 12; month++) {
      const firstOfMonth = `${year}-${String(month).padStart(2, "0")}-01`;
      const lastDate = new Date(year, month, 0).getDate();
      const lastOfMonth = `${year}-${String(month).padStart(2, "0")}-${String(lastDate).padStart(2, "0")}`;
      const weekCount = getWeekNumberInMonth(lastOfMonth);
      for (let w = 1; w <= weekCount; w++) {
        const fromDay = 1 + (w - 1) * 7;
        const toDay = Math.min(fromDay + 6, lastDate);
        const dateFrom = `${year}-${String(month).padStart(2, "0")}-${String(fromDay).padStart(2, "0")}`;
        const dateTo = `${year}-${String(month).padStart(2, "0")}-${String(toDay).padStart(2, "0")}`;
        columns.push({
          key: `${year}-${month}-${w}`,
          labelLine1: `${month}月`,
          labelLine2: `${w}週目`,
          dateFrom,
          dateTo,
        });
      }
    }
    return columns;
  }

  if (unit === "month") {
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
  const list = getFilteredTransactionList();
  return list.filter((r) => (r.STATUS || "").toLowerCase() === "plan");
}

function getTypeLabel(type: string): string {
  const t = (type || "expense").toLowerCase();
  if (t === "income") return "収入";
  if (t === "transfer") return "振替";
  return "支出";
}

function getTypeIconPath(type: string): string {
  const t = (type || "expense").toLowerCase();
  if (t === "income") return "/icon/circle-arrow-down-solid.svg";
  if (t === "transfer") return "/icon/arrow-right-arrow-left-solid.svg";
  return "/icon/circle-arrow-up-solid.svg";
}

function renderScheduleGrid(): void {
  const startInput = document.getElementById("schedule-start-date") as HTMLInputElement | null;
  const unitRadios = document.querySelectorAll<HTMLInputElement>('input[name="schedule-unit"]');
  const headRow = document.getElementById("schedule-head-row");
  const tbody = document.getElementById("schedule-tbody");
  const tbodyFixed = document.getElementById("schedule-tbody-fixed");

  if (!startInput || !headRow || !tbody || !tbodyFixed) return;

  const startYMD = startInput.value || getTodayYMD();
  if (!startYMD) return;

  let unit: ScheduleUnit = "day";
  unitRadios.forEach((r) => {
    if (r.checked) unit = r.value as ScheduleUnit;
  });

  const columns = getDateColumns(startYMD, unit);
  const rows = getPlanRows();

  const yearMonthRow = document.getElementById("schedule-yearmonth-row");
  if (yearMonthRow) {
    yearMonthRow.innerHTML = "";
    getMonthGroups(columns).forEach((g) => {
      const th = document.createElement("th");
      th.className = "schedule-view-yearmonth-col";
      th.scope = "col";
      th.colSpan = g.colspan;
      th.textContent = g.label;
      yearMonthRow.appendChild(th);
    });
  }

  headRow.innerHTML = "";
  columns.forEach((col) => {
    const th = document.createElement("th");
    th.className = "schedule-view-date-col";
    th.scope = "col";
    th.innerHTML = `<span class="schedule-view-date-line1">${col.labelLine1}</span><span class="schedule-view-date-line2">${col.labelLine2}</span>`;
    headRow.appendChild(th);
  });

  tbody.innerHTML = "";
  tbodyFixed.innerHTML = "";
  rows.forEach((row) => {
    const cat = getCategoryById(row.CATEGORY_ID);
    const from = (row.TRANDATE_FROM || "").slice(0, 10);
    const to = (row.TRANDATE_TO || "").slice(0, 10) || from;

    const trFixed = document.createElement("tr");
    const typeTd = document.createElement("td");
    typeTd.className = "schedule-col-type";
    const typeIcon = createIconWrap(ICON_DEFAULT_COLOR, getTypeIconPath(row.TYPE || "expense"), { tag: "span" });
    typeTd.appendChild(typeIcon);
    typeTd.title = getTypeLabel(row.TYPE || "expense");
    const catTd = document.createElement("td");
    catTd.className = "schedule-col-category";
    const catIcon = createIconWrap(cat?.COLOR || ICON_DEFAULT_COLOR, cat?.ICON_PATH, { tag: "span" });
    catTd.appendChild(catIcon);
    const nameTd = document.createElement("td");
    nameTd.className = "schedule-col-name";
    nameTd.textContent = (row.NAME || "").trim() || "—";
    const statusTd = document.createElement("td");
    statusTd.className = "schedule-col-status";
    statusTd.textContent = "予定";
    trFixed.appendChild(typeTd);
    trFixed.appendChild(catTd);
    trFixed.appendChild(nameTd);
    trFixed.appendChild(statusTd);
    tbodyFixed.appendChild(trFixed);

    const tr = document.createElement("tr");
    columns.forEach((col) => {
      const td = document.createElement("td");
      td.className = "schedule-view-date-cell";
      if (overlaps(from, to, col.dateFrom, col.dateTo)) {
        td.classList.add("schedule-view-date-cell--active");
        td.setAttribute("aria-label", "対象期間");
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
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
    setDisplayedKeys(["TRANSACTION.csv", "CATEGORY.csv"]);
  });

  registerRefreshHandler("schedule", () => {
    loadTransactionData(true).then(() => renderScheduleGrid());
  });

  const startInput = document.getElementById("schedule-start-date") as HTMLInputElement | null;
  startInput?.addEventListener("change", () => renderScheduleGrid());

  document.querySelectorAll('input[name="schedule-unit"]').forEach((radio) => {
    radio.addEventListener("change", () => renderScheduleGrid());
  });
}
