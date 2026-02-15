/**
 * Fastify API: public/data/*.csv の読み書き。
 * 起動: npm run server または node server/index.js
 * 環境変数: PORT=3000, DATA_DIR=./public/data（省略時はプロジェクトルート基準）
 */
import Fastify from "fastify";
import cors from "@fastify/cors";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const DATA_DIR = path.resolve(projectRoot, process.env.DATA_DIR || "public/data");
const PORT = Number(process.env.PORT) || 3000;

const ALLOWED_NAMES = new Set([
  "ACCOUNT.csv",
  "ACCOUNT_PERMISSION.csv",
  "CATEGORY.csv",
  "COLOR_PALETTE.csv",
  "TAG.csv",
  "TAG_MANAGEMENT.csv",
  "TRANSACTION.csv",
  "USER.csv",
]);

function resolveFilename(filename) {
  const base = path.basename(filename);
  if (!base.endsWith(".csv") || base !== filename || filename.includes("..")) {
    return null;
  }
  if (!ALLOWED_NAMES.has(base)) return null;
  return path.join(DATA_DIR, base);
}

const fastify = Fastify({ logger: true });

await fastify.register(cors, {
  origin: true,
});

fastify.get("/api/data/:filename", async (request, reply) => {
  const filePath = resolveFilename(request.params.filename);
  if (!filePath) {
    return reply.status(400).send("Invalid filename");
  }
  if (!fs.existsSync(filePath)) {
    return reply.status(404).send("Not found");
  }
  const csv = fs.readFileSync(filePath, "utf8");
  reply.header("Content-Type", "text/csv; charset=utf-8");
  return csv;
});

fastify.post("/api/data/:filename", async (request, reply) => {
  const filePath = resolveFilename(request.params.filename);
  if (!filePath) {
    return reply.status(400).send("Invalid filename");
  }
  const body = request.body;
  if (body && typeof body.csv === "string") {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, body.csv, "utf8");
    return { ok: true };
  }
  return reply.status(400).send("Body must be { csv: string }");
});

try {
  await fastify.listen({ port: PORT, host: "0.0.0.0" });
  console.log(`Data API: http://localhost:${PORT} (data dir: ${DATA_DIR})`);
} catch (err) {
  if (err.code === "EADDRINUSE") {
    console.error(`ポート ${PORT} は使用中です。別のポートで起動する例: PORT=3001 npm run server`);
  }
  fastify.log.error(err);
  process.exit(1);
}
