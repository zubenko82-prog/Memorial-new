// vite.config.ts
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const hmrHost = env.WEBAPP_URL ? new URL(env.WEBAPP_URL).host : undefined;

  return {
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: true,
      // ПРОКСИ на API и статику сервера
      proxy: {
        "/api": {
          target: "http://localhost:3000",
          changeOrigin: true
        },
        "/static": {
          target: "http://localhost:3000",
          changeOrigin: true
        }
      },
      // Разрешаем ngrok-хост
      allowedHosts: true,
      // HMR по wss через ngrok (опционально)
      hmr: hmrHost ? { protocol: "wss", host: hmrHost, port: 443 } : undefined
    }
  };
});
