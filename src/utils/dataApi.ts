/**
 * CSV の読み書きはすべて Fastify API 経由（Tauri / ブラウザ共通）。
 * ベース URL 未設定時は相対パス /api を使用（Vite プロキシで API サーバーへ転送）。
 */

/**
 * データ API のベース URL を返す。
 * @returns 未設定なら ''（相対 /api を使用）、設定されていればその文字列
 */
export function getDataApiBase(): string {
  return typeof import.meta.env?.VITE_DATA_API_BASE === "string" ? import.meta.env.VITE_DATA_API_BASE : "";
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
 * @param init - 省略可。fetch の RequestInit（cache 等）
 * @returns CSV 本文の文字列。取得失敗時は空文字
 */
export async function fetchCsvFromApi(name: string, init?: RequestInit): Promise<string> {
  const base = getDataApiBase();
  const url = `${base}/api/data/${name}`;
  const res = await fetch(url, init);
  if (!res.ok) return "";
  return res.text();
}

/**
 * 指定 CSV を API で保存する（POST /api/data/:name）。
 * @param name - CSV ファイル名（例: "USER.csv"）
 * @param csv - 保存する CSV 全文
 * @returns 完了時に resolve。失敗時は throw
 */
export async function saveCsvViaApi(name: string, csv: string): Promise<void> {
  const base = getDataApiBase();
  const url = `${base}/api/data/${name}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ csv }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || `save ${name} failed: ${res.status}`);
  }
}
