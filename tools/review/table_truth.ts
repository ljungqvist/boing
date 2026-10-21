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

/**
 * Native-app floor session 2026-10-15 (phone on the floor leaning back 18°, front camera, 60 fps,
 * barefoot): marked the same way. 6501 was rejected by the app (out of view); its truth is kept.
 */
export const FLOOR_TRUTH: Record<string, { off: number; on: number }> = {
  "VisionCamera_577077169869515521.mp4": { off: 7.858, on: 8.275 },
  "VisionCamera_5931249020898260113.mp4": { off: 5.058, on: 5.491 },
  "VisionCamera_8497524966434495682.mp4": { off: 4.208, on: 4.641 },
  "VisionCamera_5587491634124200328.mp4": { off: 12.340, on: 12.757 },
  "VisionCamera_5827433014185243455.mp4": { off: 8.591, on: 9.024 },
  "VisionCamera_6501339074568151020.mp4": { off: 1.341, on: 1.758 },
};
