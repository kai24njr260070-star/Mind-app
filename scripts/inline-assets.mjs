// Cloudflare等で「HTMLは届くが assets/*.js が取得できない/404」でも動くよう、
// ビルド済みの dist/index.html に CSS と JS を全部埋め込んだ単一HTMLを作る。
// 出力: freebuff-sites-build/single/index.html (外部アセット参照ゼロ)
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const distDir = resolve(root, "dist");
const outDir = resolve(root, "freebuff-sites-build/single");
const htmlPath = resolve(distDir, "index.html");

let html = readFileSync(htmlPath, "utf8");
const readAsset = (ref) => {
  const rel = ref.replace(/^\.?\//, "");
  return readFileSync(resolve(distDir, rel), "utf8");
};

let inlinedCss = 0;
let inlinedJs = 0;

// <link rel="stylesheet" href="./assets/xxx.css"> → <style>...</style>
html = html.replace(
  /<link\b[^>]*rel="stylesheet"[^>]*>/gi,
  (tag) => {
    const m = tag.match(/href="([^"]+)"/i);
    if (!m) return tag;
    const css = readAsset(m[1]);
    inlinedCss += 1;
    return `<style>\n${css}\n</style>`;
  }
);

// <script type="module" src="./assets/xxx.js"></script> → インラインmodule
html = html.replace(
  /<script\b[^>]*type="module"[^>]*><\/script>/gi,
  (tag) => {
    const m = tag.match(/src="([^"]+)"/i);
    if (!m) return tag;
    const js = readAsset(m[1]).replace(/<\/script/gi, "<\\/script");
    inlinedJs += 1;
    return `<script type="module">\n${js}\n</script>`;
  }
);

// 取りこぼし(参照が残っている)なら失敗させる
const leftover = html.match(/<(?:script|link)\b[^>]*(?:src|href)="[^"]*assets\/[^"]*"/i);
if (leftover) {
  console.error("inline failed: external asset reference remains ->", leftover[0]);
  process.exit(1);
}
if (inlinedCss === 0 || inlinedJs === 0) {
  console.error(`inline failed: css=${inlinedCss} js=${inlinedJs} (expected >=1 each)`);
  process.exit(1);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, "index.html"), html, "utf8");

const kb = (html.length / 1024).toFixed(1);
console.log(`single-file build: ${outDir}/index.html  ${kb} KiB (css:${inlinedCss} js:${inlinedJs})`);
