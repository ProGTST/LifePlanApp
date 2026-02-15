/**
 * CSV の読み書きはすべて Fastify API 経由（Tauri / ブラウザ共通）。
 * ベース URL 未設定時は相対パス /api を使用（Vite プロキシで API サーバーへ転送）。
 */

/** データ API のベース URL。未設定なら ''（相対 /api を使用）。 */
export function getDataApiBase(): string {
  return typeof import.meta.env?.VITE_DATA_API_BASE === "string" ? import.meta.env.VITE_DATA_API_BASE : "";
}

export function isTauri(): boolean {
  const w = typeof window !== "undefined" ? (window as unknown as { __TAURI_INTERNALS__?: { invoke?: unknown } }) : null;
  return typeof w?.__TAURI_INTERNALS__?.invoke === "function";
}

/**
 * 指定 CSV を API から取得（GET /api/data/:name）。
 */
export async function fetchCsvFromApi(name: string, init?: RequestInit): Promise<string> {
  const base = getDataApiBase();
  const url = `${base}/api/data/${name}`;
  const res = await fetch(url, init);
  if (!res.ok) return "";
  return res.text();
}

/**
 * 指定 CSV を API で保存（POST /api/data/:name）。
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
