/**
 * Fastify API: public/data/ 内の CSV を読み書きする。
 * ブラウザから fetch で呼び出す。CORS 有効。
 *
 * キャッシュ設計:
 * - HTTP キャッシュは使わない（廃止）。データ整合性・I/O 最適化は Node キャッシュで行う。
 * - GET: メモリ（Node キャッシュ）から返却。未キャッシュ時はファイル読み込み後にキャッシュへ格納。X-Data-Version ヘッダでバージョンを返す。
 * - POST: ファイル更新後にキャッシュを更新し version をインクリメント。
 */
import Fastify from "fastify";
import { readFile, writeFile } from "fs/promises";
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

/** Node キャッシュ: ファイル名 → { text, version }。データ整合性と I/O 最適化の責務を持つ。 */
const dataCache = new Map();

async function getCachedOrLoad(baseName) {
  let entry = dataCache.get(baseName);
  if (entry) return entry;
  const filePath = join(dataDir, `${baseName}.csv`);
  try {
    const text = await readFile(filePath, "utf8");
    entry = { text, version: 1 };
    dataCache.set(baseName, entry);
    return entry;
  } catch (err) {
    if (err.code === "ENOENT") {
      return null;
    }
    throw err;
  }
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

fastify.post("/api/data/:name", async (request, reply) => {
  const { name } = request.params;
  const baseName = normalizeName(name);
  if (!baseName || !ALLOWED_NAMES.has(baseName)) {
    return reply.code(400).send({ error: "Invalid name" });
  }
  const body = request.body;
  const csv = body && typeof body.csv === "string" ? body.csv : "";
  const filePath = join(dataDir, `${baseName}.csv`);
  try {
    await writeFile(filePath, csv, "utf8");
    const existing = dataCache.get(baseName);
    const nextVersion = existing ? existing.version + 1 : 1;
    dataCache.set(baseName, { text: csv, version: nextVersion });
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
