import { defineConfig } from "vitest/config";

// Unit tests only; e2e/ is run by Playwright (`npm run e2e`).
export default defineConfig({ test: { include: ["src/**/*.test.ts", "mobile/src/**/*.test.ts", "tools/**/*.test.ts"] } });
