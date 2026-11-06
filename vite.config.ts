import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // 配信先のパスがルート以外でもJS/CSSが読めるよう相対参照にする(Cloudflare等で公開するため)
  base: "./",
  // リポジトリ直下の index.html は「ビルド済み単一ファイル」(Cloudflare Pagesがそのまま配信する)のため、
  // Viteの開発用エントリは app.html に分けている。
  build: {
    rollupOptions: {
      input: "app.html",
    },
  },
  server: {
    open: "/app.html",
    // wrangler dev(worker)を別プロセスで起動している場合にAPIをそちらへ渡す
    proxy: {
      "/api": "http://localhost:8787",
    },
  },
});
