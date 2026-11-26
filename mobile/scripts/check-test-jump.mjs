// Checks an app result (scripts/analyze-on-*.sh) for the test jump of scripts/make-test-jump.sh:
// exactly one accepted jump, both heights 30.0 cm within −3.5/+1.5 cm. The photo leaves the floor at the full
// takeoff speed (a real foot speeds up from the floor), and the takeoff is taken once the feet are 0.05 leg lengths
// up: ≈ 15 ms after the photo's takeoff, which reads ≈ 2–3 cm low here.
//   node scripts/check-test-jump.mjs result.json
import { readFileSync } from "node:fs";

const r = JSON.parse(readFileSync(process.argv[2], "utf8"));
const fail = (msg) => {
  console.error(`FAIL: ${msg}\n${JSON.stringify(r, null, 2)}`);
  process.exit(1);
};
if (r.error) fail(`the app reported an error: ${r.error}`);
const ok = (r.jumps ?? []).filter((j) => j.flags.length === 0);
if (ok.length !== 1) fail(`expected 1 accepted jump, got ${ok.length} (of ${r.jumps?.length ?? 0})`);
const [j] = ok;
for (const [name, h] of [["takeoff→apex", j.h], ["flight time", j.hFlight]]) {
  if (h < 0.265 || h > 0.315) fail(`${name} height ${(h * 100).toFixed(1)} cm, expected 26.5–31.5`);
}
console.log(
  `OK: ${(j.h * 100).toFixed(1)} cm (flight time ${(j.hFlight * 100).toFixed(1)} cm), ${j.frames} frames in the air, ` +
    `${Math.round(r.fps)} fps, rotation ${r.info?.rotation}°, ${(r.ms / 1000).toFixed(1)} s`,
);
