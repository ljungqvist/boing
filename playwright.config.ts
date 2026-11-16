import { resolve } from "node:path";
import { defineConfig } from "@playwright/test";

/** Fake-camera clips and test videos (tools/make_y4m.py): not in the repo. e2e/clips/ or $BOING_E2E. */
export const DATA = resolve(process.env.BOING_E2E ?? resolve(import.meta.dirname, "e2e", "clips"));

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
        `--use-file-for-fake-video-capture=${resolve(DATA, "front-jump.y4m")}`,
      ],
    },
  },
});
