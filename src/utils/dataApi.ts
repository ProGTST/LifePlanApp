/**
 * CSV の読み書きはすべて Fastify API 経由（Tauri / ブラウザ共通）。
 * ベース URL 未設定時は相対パス /api を使用（Vite プロキシで API サーバーへ転送）。
 *
 * キャッシュ設計: HTTP キャッシュは廃止。データ取得は常に通常の fetch。
 * データ整合性・I/O 最適化は Fastify 側の Node キャッシュが担当する。
 */

/**
 * データ API のベース URL を返す。
 * @returns 未設定なら ''（相対 /api を使用）、設定されていればその文字列
 */
export function getDataApiBase(): string {
  const env = (import.meta as unknown as { env?: { VITE_DATA_API_BASE?: string } }).env;
  return typeof env?.VITE_DATA_API_BASE === "string" ? env.VITE_DATA_API_BASE : "";
}

/**
 * Tauri 環境で動作しているかどうかを判定する。
 * @returns window.__TAURI_INTERNALS__.invoke が関数なら true
 */
export function isTauri(): boolean {
  const w = typeof window !== "undefined" ? (window as unknown as { __TAURI_INTERNALS__?: { invoke?: unknown } }) : null;
  return typeof w?.__TAURI_INTERNALS__?.invoke === "function";
}

/**
 * 指定 CSV を API から取得する（GET /api/data/:name）。
 * @param name - CSV ファイル名（例: "USER.csv"）
 * @returns { text, version }。取得失敗時は { text: "", version: 0 }
 */
export async function fetchCsvFromApi(name: string): Promise<{ text: string; version: number }> {
  const base = getDataApiBase();
  const url = `${base}/api/data/${name}`;
  const res = await fetch(url);
  if (!res.ok) return { text: "", version: 0 };
  const text = await res.text();
  const version = Number(res.headers.get("X-Data-Version") ?? 0) || 0;
  return { text, version };
}

/**
 * 指定 CSV のメタ情報のみ取得（GET /api/data/:name/meta）。ポーリング用で軽量。
 * @param name - CSV ファイル名（例: "TRANSACTION.csv"）
 * @returns { version, lastUpdatedUser }。失敗時は { version: 0, lastUpdatedUser: "" }
 */
export async function fetchCsvMetaFromApi(
  name: string
): Promise<{ version: number; lastUpdatedUser: string }> {
  const base = getDataApiBase();
  const url = `${base}/api/data/${name}/meta`;
  const res = await fetch(url);
  if (!res.ok) return { version: 0, lastUpdatedUser: "" };
  const json = (await res.json()) as { version?: number; lastUpdatedUser?: string };
  return {
    version: Number(json.version ?? 0) || 0,
    lastUpdatedUser: String(json.lastUpdatedUser ?? "").trim(),
  };
}

/** 楽観ロックで 409 が返ったときに throw する専用エラー。メッセージは日本語。 */
export class VersionConflictError extends Error {
  constructor(
    message = "他のユーザーが更新したため保存できませんでした。最新のデータを再取得してから再度お試しください。"
  ) {
    super(message);
    this.name = "VersionConflictError";
    Object.setPrototypeOf(this, VersionConflictError.prototype);
  }
}

/**
 * 指定 CSV を API で保存する（POST /api/data/:name）。
 * 楽観ロック: expectedVersion を送り、サーバー側の version と一致しない場合は 409 で VersionConflictError を throw。
 * @param name - CSV ファイル名（例: "USER.csv"）
 * @param csv - 保存する CSV 全文
 * @param expectedVersion - 取得時の X-Data-Version。省略時はサーバー側で検証しない
 * @returns 完了時に resolve。409 時は VersionConflictError を throw
 */
export async function saveCsvViaApi(
  name: string,
  csv: string,
  expectedVersion?: number
): Promise<void> {
  const base = getDataApiBase();
  const url = `${base}/api/data/${name}`;
  const body: { csv: string; expectedVersion?: number } = { csv };
  if (expectedVersion !== undefined) body.expectedVersion = expectedVersion;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 409) {
    throw new VersionConflictError();
  }
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || `save ${name} failed: ${res.status}`);
  }
}
