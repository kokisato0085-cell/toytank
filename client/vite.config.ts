import { defineConfig } from "vite";

// 開発サーバー設定。
// 段階1はオフライン（サーバー不要）。段階2でGo権威サーバーへ /api プロキシを追加予定。
// WSL の /mnt 上では inotify が効かないため、ファイル監視はポーリングにする。
//
// マルチページ：ゲーム本体(index.html) と ToyTank Maker(editor.html) の2エントリ。
export default defineConfig(({ command }) => ({
  // 本番ビルドは GitHub Pages のサブパス(/toytank/)で配信するため base を付ける。
  // dev サーバーはルート(/)配信のまま。
  base: command === "build" ? "/toytank/" : "/",
  server: {
    watch: { usePolling: true, interval: 300 },
  },
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        editor: "editor.html",
      },
    },
  },
}));
