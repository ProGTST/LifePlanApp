/**
 * 予定取引の発生日（対象日）計算。カレンダー・スケジュールで共通利用。
 */
import type { TransactionRow } from "../types";

/** 曜日コード（週ごと頻度の CYCLE_UNIT で使用）。0=日〜6=土。 */
const WEEKDAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

function addDays(ymd: string, delta: number): string {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  const date = new Date(y, m - 1, d + delta);
  const yy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function addMonths(ymd: string, delta: number): string {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setMonth(date.getMonth() + delta);
  const yy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function getSundayOfWeek(ymd: string): string {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return addDays(ymd.slice(0, 10), -date.getDay());
}

/**
 * 予定の発生日一覧（YYYY-MM-DD）を返す。TRANDATE_FROM～TO の範囲内のみ。
 * 頻度（FREQUENCY）・間隔（INTERVAL）・繰り返し（CYCLE_UNIT）に従って対象日を列挙する。
 * @param row - 予定の取引行
 * @returns 発生日の YYYY-MM-DD 文字列の配列
 */
export function getPlanOccurrenceDates(row: TransactionRow): string[] {
  const from = (row.TRANDATE_FROM || "").trim().slice(0, 10);
  const to = (row.TRANDATE_TO || "").trim().slice(0, 10);
  if (!from || !to || from.length < 10 || to.length < 10 || from > to) return [];
  const frequency = (row.FREQUENCY ?? "day").toLowerCase();
  const interval = Math.max(1, parseInt(row.INTERVAL ?? "1", 10) || 1);
  const cycleUnit = (row.CYCLE_UNIT ?? "").trim();
  const pad = (n: number) => String(n).padStart(2, "0");

  // 頻度＝1日: 対象日は終了日の1日のみ
  if (frequency === "day") {
    return [to];
  }

  // 頻度＝日ごと: FROM から間隔日ごとに TO まで列挙
  if (frequency === "daily") {
    const out: string[] = [];
    let d = from;
    while (d <= to) {
      out.push(d);
      d = addDays(d, interval);
    }
    return out;
  }

  // 頻度＝週ごと: FROM を含む週から間隔週ごと、CYCLE_UNIT の曜日のみ
  if (frequency === "weekly") {
    const weekdays = cycleUnit ? cycleUnit.split(",").map((s) => s.trim().toUpperCase()) : [];
    const weekdaySet = new Set(weekdays);
    const weekSunday = getSundayOfWeek(from);
    const out: string[] = [];
    let weekStart = weekSunday;
    while (weekStart <= to) {
      const weekEnd = addDays(weekStart, 6);
      if (weekEnd < from) {
        weekStart = addDays(weekStart, 7 * interval);
        continue;
      }
      for (let i = 0; i < 7; i++) {
        const d = addDays(weekStart, i);
        if (d < from || d > to) continue;
        const date = new Date(parseInt(d.slice(0, 4), 10), parseInt(d.slice(5, 7), 10) - 1, parseInt(d.slice(8, 10), 10));
        const code = WEEKDAY_CODES[date.getDay()];
        if (weekdaySet.size === 0 || weekdaySet.has(code)) out.push(d);
      }
      weekStart = addDays(weekStart, 7 * interval);
    }
    return out;
  }

  // 頻度＝月ごと: FROM の月から間隔月ごと、CYCLE_UNIT の日（または月末等）のみ
  if (frequency === "monthly") {
    const daySpecs = cycleUnit ? cycleUnit.split(",").map((s) => s.trim()) : [];
    const out: string[] = [];
    let monthFirst = from.slice(0, 7) + "-01";
    const toFirst = to.slice(0, 7) + "-01";
    while (monthFirst <= toFirst) {
      const [y, m] = monthFirst.split("-").map(Number);
      const lastDate = new Date(y, m, 0).getDate();
      const daysToAdd = daySpecs.length > 0 ? daySpecs : ["1"];
      for (const spec of daysToAdd) {
        const n = parseInt(spec, 10);
        let day: number;
        if (Number.isNaN(n) || n === 0) continue;
        if (n === -1) day = lastDate;
        else if (n === -2) day = Math.max(1, lastDate - 1);
        else if (n === -3) day = Math.max(1, lastDate - 2);
        else if (n >= 1 && n <= 31) day = Math.min(n, lastDate);
        else continue;
        const d = `${y}-${pad(m)}-${pad(day)}`;
        if (d >= from && d <= to) out.push(d);
      }
      monthFirst = addMonths(monthFirst, interval).slice(0, 7) + "-01";
    }
    return out;
  }

  // 頻度＝年ごと: FROM の年から間隔年ごと、CYCLE_UNIT の MMDD のみ
  if (frequency === "yearly") {
    const mmddList = cycleUnit ? cycleUnit.split(",").map((s) => s.trim()).filter((s) => s.length === 4) : [];
    const out: string[] = [];
    const fromY = parseInt(from.slice(0, 4), 10);
    const toY = parseInt(to.slice(0, 4), 10);
    for (let y = fromY; y <= toY; y += interval) {
      if (mmddList.length === 0) {
        const d = `${y}-${from.slice(5, 7)}-${from.slice(8, 10)}`;
        if (d >= from && d <= to) out.push(d);
        continue;
      }
      for (const mmdd of mmddList) {
        const m = parseInt(mmdd.slice(0, 2), 10);
        const day = parseInt(mmdd.slice(2, 4), 10);
        if (m < 1 || m > 12 || day < 1 || day > 31) continue;
        const lastD = new Date(y, m, 0).getDate();
        const d = `${y}-${mmdd.slice(0, 2)}-${pad(Math.min(day, lastD))}`;
        if (d >= from && d <= to) out.push(d);
      }
    }
    return out;
  }

  return [to];
}
