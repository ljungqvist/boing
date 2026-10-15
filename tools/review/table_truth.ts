/**
 * Native-app table session 2026-10-15 (front camera, 60 fps, phone on a table, barefoot on wood):
 * takeoff (last foot off) and landing (first foot down) marked by eye from feet crops, clip time, ±10 ms.
 * Jump 5567 had the feet out of view (no truth).
 */
export const TABLE_TRUTH: Record<string, { off: number; on: number }> = {
  "VisionCamera_1664772788620071637.mp4": { off: 2.515, on: 2.922 },
  "VisionCamera_8730766188874574805.mp4": { off: 0.990, on: 1.395 },
  "VisionCamera_1546257783361247839.mp4": { off: 1.225, on: 1.675 },
  "VisionCamera_4275533128073798782.mp4": { off: 5.040, on: 5.495 },
  "VisionCamera_5095786860068979140.mp4": { off: 2.142, on: 2.558 },
  "VisionCamera_4255918837353869564.mp4": { off: 6.541, on: 6.975 },
  "VisionCamera_1901460937979112645.mp4": { off: 3.075, on: 3.392 },
};
