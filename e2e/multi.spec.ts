import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { DATA } from "../playwright.config";

// Fake camera: own recording with two jumps (60 fps), looping.
const Y4M = resolve(DATA, "e2e", "own-two-jumps.y4m");
test.use({
  launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${Y4M}`] },
});

test("live camera: keeps measuring after the first jump", async ({ page }) => {
  test.skip(!existsSync(Y4M), "fake camera file missing (tools/make_y4m.py own/20261013_174604.mp4)");
  await page.goto("/");
  await page.click("#start");
  // The camera picture must not be cropped (portrait 360x640 source): cropping can cut off the feet.
  await expect.poll(() => page.evaluate(() => { const v = document.getElementById("video") as HTMLVideoElement; return v.videoHeight / (v.videoWidth || 1); })).toBeCloseTo(640 / 360, 1);
  // The latest height is shown large on top of the video right after the jump.
  await expect(page.locator("#flash")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#flash")).toContainText("cm");
  await expect.poll(
    async () => page.evaluate(() => (window as any).boing.results.filter((r: any) => r.accepted).length),
    { timeout: 60_000 },
  ).toBeGreaterThanOrEqual(3);
  const heights: number[] = await page.evaluate(() => (window as any).boing.results.filter((r: any) => r.accepted).map((r: any) => r.hPrimary * 100));
  console.log("live heights", heights.map((h) => h.toFixed(1)));
  for (const h of heights) expect(h).toBeGreaterThan(20), expect(h).toBeLessThan(36);
  // Session summary: one chip per jump, plus best and average.
  await expect(page.locator(".chip")).toHaveCount(heights.length);
  await expect(page.locator("#summary")).toContainText(`Best ${Math.max(...heights).toFixed(1)}`);
  // Tapping a chip opens the details.
  await page.locator(".chip").first().click();
  await expect(page.locator("#details")).toBeVisible();
  await expect(page.locator("#details")).toContainText("Flight-time height");
  // The app never comments on jump technique.
  expect(await page.locator("body").innerText()).not.toMatch(/straight|land with|keep your legs/i);
});

test("live camera: a session can be saved for offline replay", async ({ page }) => {
  test.skip(!existsSync(Y4M), "fake camera file missing");
  await page.goto("/");
  await page.click("#start");
  await page.waitForTimeout(3000);
  await page.click("#menu");
  const [download] = await Promise.all([page.waitForEvent("download"), page.click("#save")]);
  const path = await download.path();
  const session = JSON.parse(readFileSync(path, "utf8"));
  expect(session.frames.length).toBeGreaterThan(60);
  expect(session.width).toBeGreaterThan(0);
  expect(session.meta.timing.source).toMatch(/captureTime|mediaTime/);
});

test("live camera: shows the picture and loading progress while the model downloads", async ({ page }) => {
  test.skip(!existsSync(Y4M), "fake camera file missing");
  // Simulate a slow connection: hold the model download for 6 s.
  await page.route(/pose_landmarker_full\.task/, async (route) => {
    await new Promise((r) => setTimeout(r, 6000));
    await route.continue();
  });
  await page.goto("/");
  await page.evaluate(async () => { for (const k of await caches.keys()) await caches.delete(k); });
  await page.click("#start");
  await expect(page.locator("#status")).toContainText(/Loading pose/, { timeout: 10_000 });
  // The camera picture is already visible while the model loads.
  await expect.poll(() => page.evaluate(() => (document.getElementById("video") as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2);
  await expect(page.locator("#placeholder")).toBeHidden();
  // Once loaded, measuring starts.
  await expect(page.locator("#status")).toHaveText(/Ready|Looking for you|not visible|Jump/, { timeout: 60_000 });
  // A second start reuses the loaded model immediately.
  await page.click("#start");
  await page.click("#start");
  await expect(page.locator("#status")).toHaveText(/Ready|Looking for you|not visible|Jump/, { timeout: 5_000 });
});

test("live camera: a slow phone switches to the lite model", async ({ page }) => {
  test.skip(!existsSync(Y4M), "fake camera file missing");
  // Pose model on the CPU, so CPU throttling makes it slow like an older phone.
  await page.goto("/?delegate=cpu");
  await page.evaluate(() => localStorage.removeItem("boing.model"));
  await page.click("#start");
  await expect(page.locator("#status")).toHaveText(/Ready|Looking for you|not visible|Jump|low frame rate/, { timeout: 60_000 });
  // Make this "phone" slow.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 12 });
  await expect.poll(() => page.evaluate(() => localStorage.getItem("boing.model")), { timeout: 60_000 }).toBe("lite");
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  // Still measuring after the switch.
  const before: number = await page.evaluate(() => (window as any).boing.results.filter((r: any) => r.accepted).length);
  await expect.poll(
    () => page.evaluate(() => (window as any).boing.results.filter((r: any) => r.accepted).length),
    { timeout: 60_000 },
  ).toBeGreaterThan(before);
});
