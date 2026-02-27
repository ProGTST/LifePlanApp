/**
 * public/data の CSV をポーリングで監視し、
 * 更新者以外のユーザーが対応する画面を表示しているときに
 * 「データが更新されました。最新のデータを取得しますか？」と通知する。
 *
 * 通知条件: 更新された行の「表示キー」が、その画面で検索・表示した際に
 * localStorage に保存した表示データのキー一覧に含まれる場合のみ通知する。
 */

import { triggerRefreshForView } from "../app/screen";
import { fetchCsvFromApi } from "./dataApi";
import { parseCsvLine, rowToObject } from "./csv";

const POLL_INTERVAL_MS = 15_000;
const STORAGE_KEY_DISPLAYED = "lifeplan_csvwatch_displayed";

/** 監視するCSVファイル名（APIで使う名前） */
const WATCHED_FILES = [
  "USER.csv",
  "COLOR_PALETTE.csv",
  "ACCOUNT.csv",
  "ACCOUNT_PERMISSION.csv",
  "ACCOUNT_HISTORY.csv",
  "CATEGORY.csv",
  "TAG.csv",
  "TRANSACTION.csv",
  "TRANSACTION_TAG.csv",
  "TRANSACTION_MANAGEMENT.csv",
  "TRANSACTION_MONTHLY.csv",
] as const;

/** ファイル → 画面ID */
const FILE_TO_VIEW: Record<string, string> = {
  "USER.csv": "profile",
  "COLOR_PALETTE.csv": "design",
  "ACCOUNT.csv": "account",
  "ACCOUNT_PERMISSION.csv": "account",
  "ACCOUNT_HISTORY.csv": "account",
  "CATEGORY.csv": "category",
  "TAG.csv": "tag",
  "TRANSACTION.csv": "transaction-history",
  "TRANSACTION_TAG.csv": "transaction-history",
  "TRANSACTION_MANAGEMENT.csv": "transaction-history",
  "TRANSACTION_MONTHLY.csv": "transaction-history",
};

/**
 * 検索や画面表示でデータ取得した際に、表示しているデータのキー一覧を localStorage に保存する。各画面の loadAndRender や検索条件適用後に呼ぶ。
 * @param viewId - 画面 ID（例: "profile", "account"）
 * @param keys - 表示中のデータのキー（ID 等）の配列
 * @returns なし
 */
export function setDisplayedKeys(viewId: string, keys: string[]): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_DISPLAYED);
    const data: Record<string, string[]> = raw ? JSON.parse(raw) : {};
    data[viewId] = keys;
    localStorage.setItem(STORAGE_KEY_DISPLAYED, JSON.stringify(data));
  } catch {
    // ignore
  }
}

/**
 * localStorage から指定画面の表示キー一覧を取得する。
 * @param viewId - 画面 ID
 * @returns 表示キーの配列。未保存・失敗時は空配列
 */
function getDisplayedKeys(viewId: string): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_DISPLAYED);
    const data: Record<string, string[]> = raw ? JSON.parse(raw) : {};
    return data[viewId] ?? [];
  } catch {
    return [];
  }
}

/**
 * CSV 本文を論理行に分割する。ダブルクォート内の改行は行区切りとみなさない。
 * @param text - CSV 全文
 * @returns 論理行の配列
 */
function splitCsvLogicalRows(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const rows: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < trimmed.length; i++) {
    const c = trimmed[i];
    if (c === '"') {
      inQuotes = !inQuotes;
      current += c;
    } else if (!inQuotes && (c === "\n" || c === "\r")) {
      rows.push(current);
      current = "";
      if (c === "\r" && trimmed[i + 1] === "\n") i += 1;
    } else {
      current += c;
    }
  }
  if (current.length > 0) rows.push(current);
  return rows;
}

/**
 * CSV 本文から UPDATE_DATETIME が最も新しい行を1件取り、ヘッダー名をキーとしたオブジェクトで返す。
 * @param text - CSV 全文
 * @returns 行オブジェクト。取得できない場合は null
 */
function getLastUpdateRowFromCsvText(text: string): Record<string, string> | null {
  const rows = splitCsvLogicalRows(text);
  if (rows.length < 2) return null;
  const header = parseCsvLine(rows[0]);
  const dateIdx = header.findIndex((h) => h === "UPDATE_DATETIME");
  const userIdx = header.findIndex((h) => h === "UPDATE_USER");
  if (dateIdx === -1 || userIdx === -1) return null;
  let maxDate = "";
  let lastRowCells: string[] = [];
  for (let i = 1; i < rows.length; i++) {
    // データ行から UPDATE_DATETIME を比較し、最新行を保持
    const cells = parseCsvLine(rows[i]);
    const d = cells[dateIdx] ?? "";
    if (d && d >= maxDate) {
      maxDate = d;
      lastRowCells = cells;
    }
  }
  if (lastRowCells.length === 0) return null;
  return rowToObject(header, lastRowCells);
}

/**
 * 更新行から、その画面で「表示データのキー」として照合する値を返す。localStorage の表示キー一覧に含まれるか判定に使う。
 * @param viewId - 画面 ID
 * @param fileName - CSV ファイル名（例: "USER.csv"）
 * @param row - 更新された行オブジェクト
 * @returns 照合用のキー文字列。該当しない組み合わせの場合は空文字
 */
function getDisplayKeyForUpdate(
  viewId: string,
  fileName: string,
  row: Record<string, string>
): string {
  const id = (v: string | undefined) => String(v ?? "").trim();
  switch (viewId) {
    case "profile":
      return fileName === "USER.csv" ? id(row.ID) : "";
    case "design":
      return fileName === "COLOR_PALETTE.csv" ? `${id(row.USER_ID)}:${id(row.SEQ_NO)}` : "";
    case "account":
      if (fileName === "ACCOUNT.csv") return id(row.ID);
      if (fileName === "ACCOUNT_PERMISSION.csv") return id(row.ACCOUNT_ID);
      if (fileName === "ACCOUNT_HISTORY.csv") return id(row.ID);
      return "";
    case "category":
      return fileName === "CATEGORY.csv" ? id(row.ID) : "";
    case "tag":
      return fileName === "TAG.csv" ? id(row.ID) : "";
    case "transaction-history":
      if (fileName === "TRANSACTION.csv") return id(row.ID);
      if (fileName === "TRANSACTION_TAG.csv") return id(row.ID);
      if (fileName === "TRANSACTION_MONTHLY.csv") return id(row.ID);
      return "";
    default:
      return "";
  }
}

/**
 * テキストの簡易ハッシュを返す。CSV の変更検知に使用。
 * @param text - 対象文字列
 * @returns 長さと末尾200文字からなるハッシュ文字列
 */
function contentHash(text: string): string {
  return `${text.length}:${text.slice(-200)}`;
}

type GetCurrentState = () => { view: string; userId: string };

/**
 * 指定画面の最新データを再取得して表示し直す。通知で「OK」押下時に呼ぶ。
 * 各画面は registerRefreshHandler でハンドラを登録しているため、app/screen 経由で実行する。
 * @param viewId - 画面 ID（profile, design, account 等）
 * @returns なし
 */
function refreshView(viewId: string): void {
  triggerRefreshForView(viewId);
}

/**
 * 「データが更新されました。最新のデータを取得しますか？」と confirm し、OK なら refreshView を実行する。
 * @param viewId - 画面 ID
 * @returns なし
 */
function showUpdateNotifyDialog(viewId: string): void {
  const message = "データが更新されました。最新のデータを取得しますか？";
  if (!confirm(message)) return;
  refreshView(viewId);
}

/**
 * 1ファイルを取得し、変更・更新者を判定する。更新データのキーが localStorage の表示キーに含まれるときのみ通知対象とする。
 * @param name - CSV ファイル名（例: "ACCOUNT.csv"）
 * @param getState - 現在の view と userId を返す関数
 * @param lastState - 前回のハッシュ等を保持するオブジェクト（破壊的に更新）
 * @returns 通知する場合は { viewId, shouldNotify: true }、しない場合は null
 */
async function checkFile(
  name: string,
  getState: GetCurrentState,
  lastState: { hash: string; updateUser: string }
): Promise<{ viewId: string; shouldNotify: boolean } | null> {
  const viewId = FILE_TO_VIEW[name];
  if (!viewId) return null;

  let text: string;
  try {
    text = await fetchCsvFromApi(name);
  } catch {
    return null;
  }

  const newHash = contentHash(text);
  if (newHash === lastState.hash) return null;

  const isFirstPoll = lastState.hash === "";
  lastState.hash = newHash;

  const row = getLastUpdateRowFromCsvText(text);
  if (!row) return null;

  const updateUser = String(row.UPDATE_USER ?? "").trim();
  if (isFirstPoll) return null;

  const { view, userId } = getState();
  if (view !== viewId) return null;
  if (userId && updateUser === userId) return null;

  const displayKey = getDisplayKeyForUpdate(viewId, name, row);
  if (!displayKey) return null;

  const displayedKeys = getDisplayedKeys(viewId);
  if (displayedKeys.length === 0 || !displayedKeys.includes(displayKey)) return null;

  return { viewId, shouldNotify: true };
}

let pollTimer: ReturnType<typeof setInterval> | null = null;
const lastKnown = new Map<string, { hash: string; updateUser: string }>();

/**
 * CSV 監視を開始する。ログイン後（currentUserId が設定済み）に呼ぶ。定期的にポーリングし、表示キーに含まれる更新があれば通知する。
 * @param getState - 現在の view と userId を返す関数
 * @returns なし
 */
export function startCsvWatch(getState: GetCurrentState): void {
  if (pollTimer != null) return;

  function poll(): void {
    const { userId } = getState();
    if (!userId) return;

    Promise.all(
      WATCHED_FILES.map(async (name) => {
        let state = lastKnown.get(name);
        if (!state) {
          state = { hash: "", updateUser: "" };
          lastKnown.set(name, state);
        }
        return checkFile(name, getState, state);
      })
    ).then((results) => {
      const viewIds = [...new Set(results.filter((r): r is { viewId: string; shouldNotify: true } => r?.shouldNotify === true).map((r) => r.viewId))];
      if (viewIds.length > 0) showUpdateNotifyDialog(viewIds[0]);
    });
  }

  poll();
  pollTimer = setInterval(poll, POLL_INTERVAL_MS);
}

/**
 * CSV 監視を停止する。ログアウト時などに呼ぶ。タイマーを解除し、保持状態をクリアする。
 * @returns なし
 */
export function stopCsvWatch(): void {
  if (pollTimer != null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  lastKnown.clear();
}
