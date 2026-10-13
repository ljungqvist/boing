import { resolve } from "node:path";
import { defineConfig } from "@playwright/test";

/** Test videos live outside the repo (third-party / personal content). */
export const DATA = resolve(process.env.BOING_DATA ?? resolve(import.meta.dirname, "..", "data"));

export default defineConfig({
  testDir: "e2e",
  timeout: 5 * 60_000,
  expect: { timeout: 60_000 },
  workers: 1,
  webServer: {
    command: "npx vite build --mode e2e && npx vite preview --mode e2e --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: true,
    timeout: 120_000,
  },
  use: {
    baseURL: "http://localhost:4173",
    channel: "chrome", // installed Google Chrome: proprietary codecs, no browser download
    launchOptions: {
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        `--use-file-for-fake-video-capture=${resolve(DATA, "e2e", "front-jump.y4m")}`,
      ],
    },
  },
});
