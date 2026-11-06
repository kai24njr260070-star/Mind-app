import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // wrangler dev(worker)を別プロセスで起動している場合にAPIをそちらへ渡す
    proxy: {
      "/api": "http://localhost:8787",
    },
  },
});
