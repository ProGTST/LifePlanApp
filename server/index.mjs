/**
 * Fastify API: public/data/ 内の CSV を読み書きする。
 * ブラウザから fetch で呼び出す。CORS 有効。
 *
 * キャッシュ設計:
 * - GET: Node キャッシュから返却。mtime 不一致時はファイル再読込（外部変更耐性）。
 * - POST: expectedVersion で楽観ロック。不一致時は 409 Conflict。
 * - GET /api/data/:name/meta: ポーリング用に version と lastUpdatedUser のみ返却。
 */
import Fastify from "fastify";
import { readFile, writeFile, stat } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
const dataDir = join(projectRoot, "public", "data");

const ALLOWED_NAMES = new Set([
  "ACCOUNT",
  "ACCOUNT_HISTORY",
  "ACCOUNT_PERMISSION",
  "CATEGORY",
  "COLOR_PALETTE",
  "TAG",
  "TRANSACTION_TAG",
  "TRANSACTION",
  "TRANSACTION_MANAGEMENT",
  "TRANSACTION_MONTHLY",
  "USER",
]);

function normalizeName(name) {
  if (typeof name !== "string") return "";
  const s = name.trim().toUpperCase();
  return s.endsWith(".CSV") ? s.slice(0, -4) : s;
}

function isValidName(name) {
  const base = normalizeName(name);
  return base !== "" && /^[A-Z_]+$/.test(base) && ALLOWED_NAMES.has(base);
}

/** Node キャッシュ: ファイル名 → { text, version, mtimeMs }。version は CSV に持たせずサーバー起動時 1、POST でインクリメント。mtime で外部変更を検知。 */
const dataCache = new Map();

async function getCachedOrLoad(baseName) {
  const filePath = join(dataDir, `${baseName}.csv`);
  let statResult;
  try {
    statResult = await stat(filePath);
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
  const mtimeMs = statResult.mtimeMs;
  const entry = dataCache.get(baseName);
  if (entry && entry.mtimeMs === mtimeMs) return entry;
  const text = await readFile(filePath, "utf8");
  const version = entry ? entry.version : 1;
  const newEntry = { text, version, mtimeMs };
  dataCache.set(baseName, newEntry);
  return newEntry;
}

/** 1行を RFC 4180 風にパース（ダブルクォート内のカンマを無視）。meta 用。 */
function parseCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (inQuotes || c !== ",") {
      current += c;
    } else {
      result.push(current.trim());
      current = "";
    }
  }
  result.push(current.trim());
  return result;
}

/** 論理行に分割（引用内の改行は区切りにしない）。 */
function splitCsvRows(text) {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const rows = [];
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

/** CSV 本文から UPDATE_DATETIME が最も新しい行の UPDATE_USER を返す。meta 用。 */
function getLastUpdatedUserFromCsvText(text) {
  const rows = splitCsvRows(text);
  if (rows.length < 2) return "";
  const header = parseCsvLine(rows[0]);
  const dateIdx = header.findIndex((h) => h === "UPDATE_DATETIME");
  const userIdx = header.findIndex((h) => h === "UPDATE_USER");
  if (dateIdx === -1 || userIdx === -1) return "";
  let maxDate = "";
  let lastUser = "";
  for (let i = 1; i < rows.length; i++) {
    const cells = parseCsvLine(rows[i]);
    const d = cells[dateIdx] ?? "";
    if (d && d >= maxDate) {
      maxDate = d;
      lastUser = cells[userIdx] ?? "";
    }
  }
  return lastUser;
}

const fastify = Fastify({ logger: true });

fastify.addHook("onSend", async (_request, reply, payload) => {
  reply.header("Access-Control-Allow-Origin", "*");
  reply.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  reply.header("Access-Control-Allow-Headers", "Content-Type");
  return payload;
});
fastify.addHook("preHandler", async (request, reply) => {
  if (request.method === "OPTIONS") {
    reply.header("Access-Control-Allow-Origin", "*");
    reply.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    reply.header("Access-Control-Allow-Headers", "Content-Type");
    return reply.send();
  }
});

fastify.get("/api/data/:name", async (request, reply) => {
  const { name } = request.params;
  const baseName = normalizeName(name);
  if (!baseName || !ALLOWED_NAMES.has(baseName)) {
    return reply.code(400).send({ error: "Invalid name" });
  }
  try {
    const entry = await getCachedOrLoad(baseName);
    if (!entry) {
      return reply.code(404).send("");
    }
    reply.header("Content-Type", "text/csv; charset=utf-8");
    reply.header("X-Data-Version", String(entry.version));
    return reply.send(entry.text);
  } catch (err) {
    fastify.log.error(err);
    return reply.code(500).send({ error: "Failed to read file" });
  }
});

/** ポーリング用: version と lastUpdatedUser のみ返却。本体取得より軽量。 */
fastify.get("/api/data/:name/meta", async (request, reply) => {
  const { name } = request.params;
  const baseName = normalizeName(name);
  if (!baseName || !ALLOWED_NAMES.has(baseName)) {
    return reply.code(400).send({ error: "Invalid name" });
  }
  try {
    const entry = await getCachedOrLoad(baseName);
    if (!entry) {
      return reply.code(404).send({ version: 0, lastUpdatedUser: "" });
    }
    const lastUpdatedUser = getLastUpdatedUserFromCsvText(entry.text);
    return reply.send({ version: entry.version, lastUpdatedUser });
  } catch (err) {
    fastify.log.error(err);
    return reply.code(500).send({ error: "Failed to read meta" });
  }
});

fastify.post("/api/data/:name", async (request, reply) => {
  const { name } = request.params;
  const baseName = normalizeName(name);
  if (!baseName || !ALLOWED_NAMES.has(baseName)) {
    return reply.code(400).send({ error: "Invalid name" });
  }
  const body = request.body;
  const csv = body && typeof body.csv === "string" ? body.csv : "";
  const expectedVersion = body && typeof body.expectedVersion === "number" ? body.expectedVersion : undefined;

  const entry = await getCachedOrLoad(baseName);
  if (entry && expectedVersion !== undefined && Number(entry.version) !== Number(expectedVersion)) {
    return reply.code(409).send({
      error: "Version conflict",
      currentVersion: entry.version,
    });
  }

  const filePath = join(dataDir, `${baseName}.csv`);
  try {
    await writeFile(filePath, csv, "utf8");
    const statResult = await stat(filePath);
    const nextVersion = entry ? entry.version + 1 : 1;
    dataCache.set(baseName, { text: csv, version: nextVersion, mtimeMs: statResult.mtimeMs });
    reply.header("X-Data-Version", String(nextVersion));
    return reply.code(204).send();
  } catch (err) {
    fastify.log.error(err);
    return reply.code(500).send({ error: "Failed to write file" });
  }
});

const port = Number(process.env.PORT) || 3000;
try {
  await fastify.listen({ port, host: "0.0.0.0" });
  console.log(`Data API: http://localhost:${port}`);
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
