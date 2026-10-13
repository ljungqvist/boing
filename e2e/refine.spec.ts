import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { DATA } from "../playwright.config";

// Fake camera: own recording with two jumps (60 fps), looping.
const Y4M = resolve(DATA, "e2e", "own-two-jumps.y4m");
test.use({
  launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${Y4M}`] },
});

interface Result {
  hPrimary: number; flight: number; fps: number; flags: string[]; accepted: boolean;
  refined: boolean; approximate: boolean; framesLive: number; framesRefined: number | null;
}
const accepted = (page: Page) =>
  page.evaluate(() => ((window as any).boing.results as Result[]).filter((r) => r.accepted));
const show = (rs: Result[]) =>
  rs.map((r) => `${(r.hPrimary * 100).toFixed(1)} cm ${r.refined ? "refined" : r.approximate ? "≈" : "live"} ` +
    `frames ${r.framesLive}→${r.framesRefined} @${r.fps.toFixed(0)} fps`);

test.beforeEach(async ({ page }) => {
  test.skip(!existsSync(Y4M), "fake camera file missing (tools/make_y4m.py own/20261013_174604.mp4)");
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.log("[browser]", m.text()); });
});

test("refined: every live jump is measured again from all recorded frames", async ({ page }) => {
  await page.goto("/");
  await page.click("#start");
  // After the landing the overlay says "Measuring…", then shows the refined height.
  await expect(page.locator("#flash")).toHaveText("Measuring…", { timeout: 60_000 });
  await expect(page.locator("#flash")).toContainText("cm", { timeout: 20_000 });
  await expect.poll(async () => (await accepted(page)).length, { timeout: 90_000 }).toBeGreaterThanOrEqual(4);
  const rs = await accepted(page);
  console.log("refined", show(rs));
  // A jump right after "Ready" can come before the first recorded piece covers it: approximate.
  expect(rs[0].refined || rs[0].approximate).toBe(true);
  for (const r of rs.slice(1)) expect(r.refined).toBe(true);
  for (const r of rs.filter((r) => r.refined)) expect(r.framesRefined!).toBeGreaterThanOrEqual(r.framesLive);
  for (const r of rs) {
    // The fake camera runs a few per cent slow, which inflates heights a little.
    expect(r.hPrimary * 100).toBeGreaterThan(20);
    expect(r.hPrimary * 100).toBeLessThan(36);
  }
  await page.locator(".chip").last().click();
  await expect(page.locator("#details")).toContainText(/Frames in the air\s*\d+ \(live analysis: \d+\)/);
});

test("refined: a slow phone still gets every recorded frame analysed", async ({ page }) => {
  // Pose on the CPU, so CPU throttling makes the live analysis slow like an older phone.
  await page.goto("/?delegate=cpu&model=full");
  await page.click("#start");
  await expect(page.locator("#status")).toHaveText(/Ready|Looking for you|not visible|Jump|low frame rate/, { timeout: 60_000 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await expect.poll(async () => (await accepted(page)).filter((r) => r.refined).length, { timeout: 150_000, intervals: [2000] })
    .toBeGreaterThanOrEqual(2);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  const all = await page.evaluate(() => (window as any).boing.results as Result[]);
  console.log("slow phone", show(all));
  const refined = all.filter((r) => r.accepted && r.refined);
  // The live analysis really was slow: far fewer frames in the air than recorded.
  expect(Math.min(...refined.map((r) => r.framesLive))).toBeLessThan(0.5 * Math.min(...refined.map((r) => r.framesRefined!)));
  for (const r of refined) {
    // All frames of the flight: recorded fps × time in the air.
    expect(r.framesRefined!).toBeGreaterThanOrEqual(0.8 * r.fps * r.flight);
    expect(r.hPrimary * 100).toBeGreaterThan(20);
    expect(r.hPrimary * 100).toBeLessThan(36);
  }
});

test("refine=off: live results only, as before", async ({ page }) => {
  await page.goto("/?refine=off");
  await page.click("#start");
  await expect(page.locator("#flash")).toContainText("cm", { timeout: 60_000 });
  await expect.poll(async () => (await accepted(page)).length, { timeout: 60_000 }).toBeGreaterThanOrEqual(2);
  const rs = await accepted(page);
  console.log("live only", show(rs));
  for (const r of rs) {
    expect(r.refined).toBe(false);
    expect(r.approximate).toBe(false);
    expect(r.hPrimary * 100).toBeGreaterThan(20);
    expect(r.hPrimary * 100).toBeLessThan(36);
  }
  expect(await page.evaluate(() => (window as any).boing.results.length)).toBeGreaterThan(0);
});
