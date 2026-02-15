/**
 * public/data の CSV をポーリングで監視し、
 * 更新者以外のユーザーが対応する画面を表示しているときに
 * 「データが更新されました。最新のデータを取得しますか？」と通知する。
 */

import { fetchCsvFromApi } from "./dataApi";
import { parseCsvLine } from "./csv";

const POLL_INTERVAL_MS = 15_000;

/** 監視するCSVファイル名（APIで使う名前） */
const WATCHED_FILES = [
  "USER.csv",
  "COLOR_PALETTE.csv",
  "ACCOUNT.csv",
  "ACCOUNT_PERMISSION.csv",
  "CATEGORY.csv",
  "TAG.csv",
  "TRANSACTION.csv",
  "TAG_MANAGEMENT.csv",
] as const;

/** ファイル → 画面ID。複数ファイルが同一画面に対応する場合あり */
const FILE_TO_VIEW: Record<string, string> = {
  "USER.csv": "profile",
  "COLOR_PALETTE.csv": "design",
  "ACCOUNT.csv": "account",
  "ACCOUNT_PERMISSION.csv": "account",
  "CATEGORY.csv": "category",
  "TAG.csv": "tag",
  "TRANSACTION.csv": "transaction-history",
  "TAG_MANAGEMENT.csv": "transaction-history",
};

/** ファイル → 更新行の「表示キー」列名。複数列の場合は "COL1,COL2" とし、値は "val1:val2" に結合する */
const FILE_TO_KEY_COLUMN: Record<string, string> = {
  "USER.csv": "ID",
  "COLOR_PALETTE.csv": "USER_ID,SEQ_NO",
  "ACCOUNT.csv": "ID",
  "ACCOUNT_PERMISSION.csv": "ID",
  "CATEGORY.csv": "ID",
  "TAG.csv": "ID",
  "TRANSACTION.csv": "ID",
  "TAG_MANAGEMENT.csv": "ID",
};

/** 論理行に分割（ダブルクォート内の改行は無視） */
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
 * CSV本文から「最も最近更新した行」の UPDATE_USER と表示キー列の値を返す。
 * keyColumn が "COL1,COL2" の場合は複数列を "val1:val2" に結合する。
 */
function getLastUpdateInfoFromCsvText(
  text: string,
  keyColumn: string
): { updateUser: string; updatedRowKey: string } {
  const rows = splitCsvLogicalRows(text);
  const empty = { updateUser: "", updatedRowKey: "" };
  if (rows.length < 2) return empty;
  const header = parseCsvLine(rows[0]);
  const dateIdx = header.findIndex((h) => h === "UPDATE_DATETIME");
  const userIdx = header.findIndex((h) => h === "UPDATE_USER");
  const keyColumns = keyColumn.split(",").map((c) => c.trim());
  const keyIndices = keyColumns.map((col) => header.findIndex((h) => h === col));
  if (dateIdx === -1 || userIdx === -1) return empty;
  let maxDate = "";
  let lastUser = "";
  let lastKeyParts: string[] = [];
  for (let i = 1; i < rows.length; i++) {
    const cells = parseCsvLine(rows[i]);
    const d = cells[dateIdx] ?? "";
    const u = cells[userIdx] ?? "";
    const parts = keyIndices.map((idx) => (idx >= 0 ? (cells[idx] ?? "") : ""));
    if (d && d >= maxDate) {
      maxDate = d;
      lastUser = u;
      lastKeyParts = parts;
    }
  }
  const lastKey = lastKeyParts.length > 0 ? lastKeyParts.join(":") : "";
  return { updateUser: lastUser, updatedRowKey: lastKey };
}

/** 簡易ハッシュ（変更検知用） */
function contentHash(text: string): string {
  return `${text.length}:${text.slice(-200)}`;
}

type GetCurrentState = () => { view: string; userId: string };
/** 指定画面で現在表示しているデータのキー（ID 等）の一覧。空の場合は「表示中のデータなし」とみなす */
type GetViewingKeys = (viewId: string) => string[];

/** 画面ごとの「最新データを取得」処理 */
async function refreshView(viewId: string): Promise<void> {
  switch (viewId) {
    case "profile": {
      const { loadAndRenderProfile } = await import("../screens/profile-screen");
      await loadAndRenderProfile();
      break;
    }
    case "design": {
      const { loadAndRenderDesign } = await import("../screens/design-screen");
      await loadAndRenderDesign();
      break;
    }
    case "account": {
      const { loadAndRenderAccountList } = await import("../screens/account-screen");
      await loadAndRenderAccountList();
      break;
    }
    case "category": {
      const { loadAndRenderCategoryList } = await import("../screens/category-screen");
      await loadAndRenderCategoryList();
      break;
    }
    case "tag": {
      const { loadAndRenderTagList } = await import("../screens/tag-screen");
      await loadAndRenderTagList();
      break;
    }
    case "transaction-history": {
      const { refreshTransactionHistory } = await import("../screens/transaction-history-screen");
      refreshTransactionHistory();
      break;
    }
    default:
      break;
  }
}

/** 通知ダイアログを表示し、OK なら refresh を実行 */
function showUpdateNotifyDialog(viewId: string): void {
  const message = "データが更新されました。最新のデータを取得しますか？";
  if (!confirm(message)) return;
  refreshView(viewId);
}

/** 1ファイルを取得して変更・更新者・更新行キーを判定し、表示中データと一致するときのみ通知対象にする */
async function checkFile(
  name: string,
  getState: GetCurrentState,
  getViewingKeys: GetViewingKeys,
  lastState: { hash: string; updateUser: string; updatedRowKey: string }
): Promise<{ viewId: string; shouldNotify: boolean } | null> {
  const viewId = FILE_TO_VIEW[name];
  const keyColumn = FILE_TO_KEY_COLUMN[name];
  if (!viewId) return null;

  let text: string;
  try {
    text = await fetchCsvFromApi(name, { cache: "no-store" });
  } catch {
    return null;
  }

  const newHash = contentHash(text);
  if (newHash === lastState.hash) return null;

  const isFirstPoll = lastState.hash === "";
  lastState.hash = newHash;
  const info = getLastUpdateInfoFromCsvText(text, keyColumn ?? "");
  lastState.updateUser = info.updateUser;
  lastState.updatedRowKey = info.updatedRowKey;
  if (isFirstPoll) return null;

  const { view, userId } = getState();
  if (view !== viewId) return null;
  if (userId && lastState.updateUser === userId) return null;

  const viewingKeys = getViewingKeys(viewId);
  if (viewingKeys.length > 0 && !viewingKeys.includes(lastState.updatedRowKey)) return null;

  return { viewId, shouldNotify: true };
}

let pollTimer: ReturnType<typeof setInterval> | null = null;
const lastKnown = new Map<string, { hash: string; updateUser: string; updatedRowKey: string }>();

/**
 * CSV 監視を開始する。ログイン後（currentUserId が設定済み）に呼ぶ。
 * getViewingKeys: 各画面で現在表示しているデータのキー（ID 等）の一覧。更新された行のキーがこの一覧に含まれるときのみ通知する。
 */
export function startCsvWatch(getState: GetCurrentState, getViewingKeys: GetViewingKeys): void {
  if (pollTimer != null) return;

  function poll(): void {
    const { userId } = getState();
    if (!userId) return;

    Promise.all(
      WATCHED_FILES.map(async (name) => {
        let state = lastKnown.get(name);
        if (!state) {
          state = { hash: "", updateUser: "", updatedRowKey: "" };
          lastKnown.set(name, state);
        }
        return checkFile(name, getState, getViewingKeys, state);
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
 * 監視を停止する（ログアウト時など）。
 */
export function stopCsvWatch(): void {
  if (pollTimer != null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  lastKnown.clear();
}
