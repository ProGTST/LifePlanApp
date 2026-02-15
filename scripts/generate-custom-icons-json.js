/**
 * public/icon/custom 内のサブフォルダを走査し、各フォルダ内の .svg を icons.json に出力する。
 * 出力形式: { "01-money": ["file1.svg", ...], "02-person": [...], ... }
 * npm run build / npm run dev の前に実行し、ピッカーでフォルダごとにサブタイトル付きで表示する。
 */
import fs from "fs";
import path from "path";

const projectRoot = process.cwd();
const customDir = path.join(projectRoot, "public", "icon", "custom");
const outputPath = path.join(customDir, "icons.json");

if (!fs.existsSync(customDir)) {
  console.warn("scripts/generate-custom-icons-json: public/icon/custom が存在しません");
  process.exit(0);
}

const entries = fs.readdirSync(customDir, { withFileTypes: true });
const byFolder = {};

for (const entry of entries) {
  if (!entry.isDirectory()) continue;
  const folderPath = path.join(customDir, entry.name);
  const files = fs.readdirSync(folderPath, { withFileTypes: true });
  const svgFiles = files
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".svg"))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, "ja"));
  if (svgFiles.length > 0) {
    byFolder[entry.name] = svgFiles;
  }
}

const keys = Object.keys(byFolder).sort((a, b) => a.localeCompare(b, "ja"));
const ordered = {};
for (const k of keys) {
  ordered[k] = byFolder[k];
}

fs.writeFileSync(outputPath, JSON.stringify(ordered, null, 2) + "\n", "utf8");
const total = Object.values(ordered).reduce((sum, arr) => sum + arr.length, 0);
console.log(`icons.json を出力しました: ${keys.length} フォルダ, ${total} 件 (${outputPath})`);
