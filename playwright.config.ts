import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e-tests",
  timeout: 60000,
  retries: 1,
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://192.168.68.71:3003",
    headless: true,
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
