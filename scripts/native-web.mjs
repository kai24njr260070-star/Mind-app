import { copyFileSync, existsSync } from "node:fs";

// Capacitor / Tauri は webDir の直下に index.html を要求する。
// このプロジェクトのVite入力は app.html なので、ビルド後に index.html として複製する。
const src = "dist-native/app.html";
const dest = "dist-native/index.html";

if (!existsSync(src)) {
  console.error(`native-web: ${src} がありません。先に vite build を実行してください。`);
  process.exit(1);
}

copyFileSync(src, dest);
console.log(`native-web: ${src} → ${dest}`);
