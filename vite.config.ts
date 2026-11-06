import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // 配信先のパスがルート以外でもJS/CSSが読めるよう相対参照にする(Cloudflare等で公開するため)
  base: "./",
  server: {
    // wrangler dev(worker)を別プロセスで起動している場合にAPIをそちらへ渡す
    proxy: {
      "/api": "http://localhost:8787",
    },
  },
});
