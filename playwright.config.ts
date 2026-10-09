import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests",
  testMatch: "ui.spec.ts",
  workers: 1,
  timeout: 40000,
  use: {
    baseURL: "http://localhost:5174",
    browserName: "chromium",
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "node node_modules/tsx/dist/cli.mjs tests/rpc-server.mjs",
      url: "http://127.0.0.1:7788/health",
      timeout: 30000,
    },
    {
      command:
        "node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5174 --strictPort",
      url: "http://localhost:5174",
      env: {
        VITE_SUPABASE_URL: "http://127.0.0.1:7788",
        VITE_SUPABASE_PUBLIC_KEY: "test-public-key",
      },
      timeout: 30000,
    },
    {
      command:
        "node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5175 --strictPort",
      url: "http://localhost:5175",
      env: { VITE_SUPABASE_URL: "", VITE_SUPABASE_PUBLIC_KEY: "" },
      timeout: 30000,
    },
  ],
});
