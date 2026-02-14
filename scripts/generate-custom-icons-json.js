/**
 * public/icon/custom 内の全 .svg ファイル名を icons.json に出力する。
 * npm run build / npm run dev の前に実行し、ピッカーで全アイコンを選択可能にする。
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
const svgFiles = entries
  .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".svg"))
  .map((e) => e.name)
  .sort((a, b) => a.localeCompare(b, "ja"));

fs.writeFileSync(outputPath, JSON.stringify(svgFiles, null, 0) + "\n", "utf8");
console.log(`icons.json を出力しました: ${svgFiles.length} 件 (${outputPath})`);
