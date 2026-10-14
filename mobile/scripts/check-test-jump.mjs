// Checks an app result (scripts/analyze-on-*.sh) for the test jump of scripts/make-test-jump.sh:
// exactly one accepted jump, both heights 30.0 cm within ±1.5 cm.
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
  if (Math.abs(h - 0.3) > 0.015) fail(`${name} height ${(h * 100).toFixed(1)} cm, expected 30.0 ± 1.5`);
}
console.log(
  `OK: ${(j.h * 100).toFixed(1)} cm (flight time ${(j.hFlight * 100).toFixed(1)} cm), ${j.frames} frames in the air, ` +
    `${Math.round(r.fps)} fps, rotation ${r.info?.rotation}°, ${(r.ms / 1000).toFixed(1)} s`,
);
