import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { DATA } from "../playwright.config";

interface Result { hPrimary: number; hFlight: number; fps: number; flags: string[]; accepted: boolean }
type AppState = { state: string; results: Result[]; error: string };
const app = (page: Page) => page.evaluate(() => (window as unknown as { boing: AppState }).boing);

test.beforeEach(async ({ page }) => {
  page.on("console", (m) => { if (m.type() === "error") console.log("[browser]", m.text()); });
});

test("live camera: measures the jump in the fake camera feed", async ({ page }) => {
  test.skip(!existsSync(resolve(DATA, "e2e", "front-jump.y4m")), "fake camera file missing (tools/make_y4m.py)");
  await page.goto("/");
  await page.click("#front");
  // The y4m loops; the first jump is around 5.4 s into the clip.
  await expect.poll(async () => (await app(page)).results.filter((r) => r.accepted).length, { timeout: 120_000 })
    .toBeGreaterThan(0);
  const s = await app(page);
  const jump = s.results.find((r) => r.accepted)!;
  console.log("live result", jump);
  // Offline evaluation (heavy model, 1080p): 37.3 cm takeoff→apex, 39.9 cm flight time.
  expect(jump.hPrimary * 100).toBeGreaterThan(32);
  expect(jump.hPrimary * 100).toBeLessThan(43);
  await expect(page.locator(".result .height").first()).toContainText("cm");
});

test("file: slow-motion recording is converted to real time", async ({ page }) => {
  const file = resolve(DATA, "own", "20261013_174441.mp4");
  test.skip(!existsSync(file), "own slow-motion recording missing");
  await page.goto("/");
  await page.setInputFiles("#file", file);
  await expect.poll(async () => (await app(page)).state, { timeout: 280_000, intervals: [2000] }).toMatch(/done|error/);
  const s = await app(page);
  console.log("file results", s.error, s.results);
  expect(s.error).toBe("");
  const accepted = s.results.filter((r) => r.accepted);
  // Offline evaluation: 23.3 and 22.7 cm takeoff→apex at 120 fps.
  expect(accepted).toHaveLength(2);
  expect(accepted[0].fps).toBeGreaterThan(100);
  for (const [r, ref] of accepted.map((r, i) => [r, [23.3, 22.7][i]] as const)) {
    expect(Math.abs(r.hPrimary * 100 - ref)).toBeLessThan(2);
  }
  await expect(page.locator("#status")).toContainText("captured at 120 fps");
});
