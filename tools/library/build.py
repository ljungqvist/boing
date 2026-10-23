"""Build the local jump library (~/code/boing-data/library) from the recordings and truths in boing-data.

Idempotent: existing clips are kept (pass --force to cut again). Writes library/jumps.json and the
clips and pose files it refers to; never touches the sources. See docs/jump-library.md.

Usage: .venv/bin/python -I tools/library/build.py [--data ../boing-data] [--force]
"""
import argparse
import json
import os
import re
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cut import cut  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
G = 9.81
POSE_POINTS = [0, 11, 12, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32]


def h_flight(ms):
    return round(G * (ms / 1000) ** 2 / 8 * 100, 2)


def ts_truth(name):
    """TABLE_TRUTH / FLOOR_TRUTH from tools/review/table_truth.ts."""
    src = open(os.path.join(REPO, "tools/review/table_truth.ts")).read()
    block = src.split(f"export const {name}")[1].split("};")[0]
    return {m[0]: (float(m[1]), float(m[2])) for m in re.findall(r'"([^"]+)": \{ off: ([\d.]+), on: ([\d.]+) \}', block)}


def pose_window(frames, t0, t1, scale=1.0):
    out = []
    for f in frames:
        t = f["t"] * scale
        if t0 <= t <= t1:
            out.append({"t": round(t, 6), "lm": f["lm"]})
    return out


def expand_compact(p):
    """The app's compact pose log (diagnostics.compactPose) → PoseFrame list with 33 landmarks."""
    frames = []
    for r in p["frames"]:
        t = r[0] + p["t0"]
        if len(r) == 1:
            frames.append({"t": t, "lm": None})
            continue
        lm = [[0, 0, 0, 0] for _ in range(33)]
        for i, k in enumerate(POSE_POINTS):
            lm[k] = [r[1 + 3 * i], r[2 + 3 * i], 0, r[3 + 3 * i]]
        frames.append({"t": t, "lm": lm})
    return frames


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(obj, f, separators=(",", ":"))


class Builder:
    def __init__(self, data, force):
        self.data, self.lib, self.force = data, os.path.join(data, "library"), force
        self.jumps = []
        # The last build's entries: kept as they are when an entry's source video is gone (deleted after
        # its clip was cut, the original being on the server only), instead of failing.
        old = os.path.join(self.lib, "jumps.json")
        self.previous = {j["id"]: j for j in json.load(open(old))["jumps"]} if os.path.exists(old) else {}

    def rel(self, path):
        return os.path.relpath(path, self.lib)

    def cut(self, src, first, last, out):
        meta = out + ".cut.json"
        if os.path.exists(out) and os.path.exists(meta) and not self.force:
            return json.load(open(meta))
        os.makedirs(os.path.dirname(out), exist_ok=True)
        info = cut(src, first, last, out)
        info["source"] = os.path.relpath(src, self.data)
        json.dump(info, open(meta, "w"))
        print(f"  cut {self.rel(out)}: {info['frames']} frames from original frame {info['frameOffset']}", flush=True)
        return info

    def copy(self, src, out):
        if not os.path.exists(out) or self.force:
            os.makedirs(os.path.dirname(out), exist_ok=True)
            shutil.copy2(src, out)
        return self.rel(out)

    # 2026-10-19: native app (front) + 240 fps side view, truth from the sock toes.
    def session_20261019(self):
        print("2026-10-19 side-view session", flush=True)
        rev = os.path.join(self.data, "review/side_20261019")
        edges = json.load(open(os.path.join(rev, "edges_redtoe.json")))
        sess = json.load(open(os.path.join(self.data, "uploads/2026-10-19_233836/session.json")))
        offsets = {"233859": 2139520.22, "234100": 2139640.86}  # side real time → app frame clock (±0.05 s)
        tags = {
            ("233859", 1): ["clean"], ("233859", 2): ["toe-plateau", "rejected-poor-fit"],
            ("233859", 3): ["lost-to-rotation"], ("233859", 4): ["clean"], ("233859", 5): ["small-hop"],
            ("234100", 1): ["clean"], ("234100", 2): ["drift-towards-camera"], ("234100", 3): ["clean"],
            ("234100", 4): ["small-hop"], ("234100", 5): ["lost-to-rotation"],
            ("234100", 6): ["toe-plateau", "rejected-poor-fit"], ("234100", 7): ["clean"],
        }
        cap = 240.0
        for e in edges:
            vid, n = e["vid"], e["n"]
            jid = f"2026-10-19-{'a' if vid == '233859' else 'b'}{n}"
            src = os.path.join(self.data, f"own/20261019_{vid}.mp4")
            first, last = int(e["kOff"] - 3.0 * cap), int(e["kOn"] + 2.0 * cap)
            info = self.cut(src, first, last, os.path.join(self.lib, f"clips/2026-10-19/{jid}_side240.mp4"))
            off_f, on_f = e["kOff"] - info["frameOffset"], e["kOn"] - info["frameOffset"]
            flight_ms = (e["kOn"] - e["kOff"]) / cap * 1000
            entry = {
                "id": jid, "person": "p1", "date": "2026-10-19", "session": "2026-10-19 side-view reference",
                "setup": {"view": "front (app) + side (reference)", "camera": "phone on the floor, leaning back 10–21°",
                          "floor": "wood (glossy)", "footwear": "socks (red toes)", "arms": "hands on hips",
                          "light": "evening, indoor lamps"},
                "devices": {"app": "Samsung Galaxy S22 (SM-S901B), front camera, 30 fps",
                            "reference": "user's phone (probably Galaxy S24+), back camera, 240 fps slow motion, floor level, side-on"},
                "clips": [{"role": "side-240", "file": self.rel(os.path.join(self.lib, f"clips/2026-10-19/{jid}_side240.mp4")),
                           "captureFps": cap, "frameOffset": info["frameOffset"], "frames": info["frames"],
                           "source": info["source"], "time": "real seconds = frame index / 240"}],
                "truth": {"method": "lowest red sock-toe pixel at 240 fps (first frame ≥ 6 px above the floor line, first frame back on it), checked by eye on foot crops",
                          "precision": "±2 frames (±8 ms) per edge; both edges read ≈1–1.5 frames late (flight time unbiased to ±1 frame); the far foot is hidden behind the near one",
                          "clip": "side-240", "takeoffFrame": off_f, "landingFrame": on_f,
                          "takeoffT": round(off_f / cap, 5), "landingT": round(on_f / cap, 5),
                          "flightMs": round(flight_ms, 1), "heightCm": h_flight(flight_ms)},
                "tags": tags[(vid, n)],
            }
            # The app's view of the same jump: live candidate, re-measurement, clip, logged pose.
            t_app = e["tOff"] + offsets[vid]
            log = min(sess["logs"], key=lambda l: abs(l["tOff"] - t_app))
            if abs(log["tOff"] - t_app) < 0.5:
                app = {k: log.get(k) for k in ("tOff", "hLive", "framesLive", "flagsLive", "fpsLive", "refined", "reason",
                                                 "h", "hFlight", "frames", "g", "offset", "flags", "error", "clipStart", "window", "video", "ms")
                       if k in log}
                if log.get("clip"):
                    entry["clips"].append({"role": "app-front", "file": self.copy(
                        os.path.join(self.data, "uploads/2026-10-19_233836", log["clip"]),
                        os.path.join(self.lib, "clips/2026-10-19", log["clip"])),
                        "clipStart": log["clipStart"], "time": "app frame clock = clip seconds + clipStart (approximate)"})
                if log.get("pose"):
                    p = log["pose"]
                    pose_file = os.path.join(self.lib, f"pose/2026-10-19/{jid}_front_heavy.json")
                    write_json(pose_file, {"width": p["width"], "height": p["height"], "fps": log.get("fps", 30),
                                           "frames": expand_compact(p), "model": "heavy", "source": "app re-measurement (logged)"})
                    entry["pose"] = [{"role": "front-heavy-app", "file": self.rel(pose_file), "clock": "app frame clock"}]
                    # Clock mapping from the flight midpoints (both methods widen the flight about symmetrically).
                    mid_app = log["tOff"] + log["offset"] + (8 * log["hFlight"] / G) ** 0.5 / 2
                    mid_side = (off_f + on_f) / 2 / cap
                    entry["clock"] = {"appMinusSide": round(mid_app - mid_side, 4), "precision": "±0.02 s",
                                      "note": "app frame clock = side-240 clip real time + appMinusSide"}
                else:
                    # Live takeoff only (≈ 0.25 s late against the recording, see the re-measured jumps).
                    entry["clock"] = {"appMinusSide": round(offsets[vid] - 0.25 + info["frameOffset"] / cap, 3),
                                      "precision": "±0.1 s (from the live takeoff)",
                                      "note": "app frame clock = side-240 clip real time + appMinusSide"}
                reject = ("not-parabola", "few-frames", "g-implausible", "out-of-view", "inconsistent", "poor-fit")
                if log.get("h") is not None:
                    shown = None if log.get("error") else round(log["h"] * 100, 1)
                else:
                    shown = None if any(f in reject for f in log.get("flagsLive") or []) else round(log["hLive"] * 100, 1)
                app["shownCm"] = shown
                app["note"] = "heights in metres as logged; shownCm = what the app showed (before the 2026-10-20 flight-time cap)"
                entry["app"] = app
            self.jumps.append(entry)

    # 2026-10-21: native app, front camera at 60 fps (Galaxy S24+), hand-marked from the app's own clips.
    def session_20261021(self):
        print("2026-10-21 front 60 fps session", flush=True)
        spec = json.load(open(os.path.join(self.data, "review/front_20261021/marks.json")))
        self.from_marks({**spec, "id": "2026-10-21-f", "date": "2026-10-21", "person": "p1", "phone": None,
                         "session": "2026-10-21 native front 60 fps",
                         "setup": {"view": "front", "camera": "phone on the floor, front camera", "floor": "wood",
                                   "footwear": "socks (green)", "arms": "hands on hips", "light": "morning, indoor"},
                         "devices": {"app": "Samsung Galaxy S24+ (SM-S926B), front camera, 60 fps, 1080×1920"}})

    # Uploads added by triage (boing-uploads skill): library/sources/<session>.json, same form as
    # from_marks() takes. Data, not code, so gwb's triage can add jumps and tools/erase.py remove them.
    def sources(self):
        d = os.path.join(self.lib, "sources")
        for f in sorted(os.listdir(d)) if os.path.isdir(d) else []:
            if f.endswith(".json"):
                print(f"source {f}", flush=True)
                self.from_marks(json.load(open(os.path.join(d, f))))

    def from_marks(self, spec):
        """Jumps from an app upload with hand-marked edges.

        spec: upload (folder relative to boing-data), id (jump id prefix), date, person, phone (recording
        ID or None), session, setup, devices, marks {clip: [first frame in the air, first frame back on
        the floor]}, optional tags {clip: [...]}, fps (default 60), method, precision.
        """
        from cut import frame_pts
        up = os.path.join(self.data, spec["upload"])
        sess = json.load(open(os.path.join(up, "session.json")))
        marks, date, fps = spec["marks"], spec["date"], spec.get("fps", 60)
        logs = sorted((l for l in sess["logs"] if l.get("clip") in marks), key=lambda l: l["tOff"])
        for n, log in enumerate(logs, 1):
            jid = f"{spec['id']}{n}"
            src = os.path.join(up, log["clip"])
            if not os.path.exists(src) and jid in self.previous:
                self.jumps.append(self.previous[jid])
                continue
            pts, _ = frame_pts(src)
            air, contact = marks[log["clip"]]
            clip_file = os.path.join(self.lib, f"clips/{date}/{jid}_front{fps}.mp4")
            info = self.cut(src, max(0, air - 3 * fps), len(pts) - 1, clip_file)
            off_t = (pts[air - 1] + pts[air]) / 2  # clip seconds
            on_t = (pts[contact - 1] + pts[contact]) / 2
            flight_ms = (on_t - off_t) * 1000
            pose_file = os.path.join(self.lib, f"pose/{date}/{jid}_front_heavy.json")
            p = log["pose"]
            write_json(pose_file, {"width": p["width"], "height": p["height"], "fps": log.get("fps", fps),
                                   "frames": expand_compact(p), "model": "heavy", "source": "app re-measurement (logged)"})
            rejected = bool(log.get("error"))
            entry = {
                "id": jid, "person": spec["person"], "date": date, "session": spec["session"],
                "setup": spec["setup"], "devices": spec["devices"],
                "clips": [{"role": "app-front", "file": self.rel(clip_file),
                           "frameOffset": info["frameOffset"], "frames": info["frames"], "source": info["source"],
                           "clipStart": log["clipStart"] + pts[info["frameOffset"]],
                           "time": "app frame clock = clip seconds + clipStart"}],
                "pose": [{"role": "front-heavy-app", "file": self.rel(pose_file), "clock": "app frame clock"}],
                "truth": {"method": spec.get("method", f"hand-marked from {fps} fps foot crops of the app's clip (front view): last frame on the floor / first in the air, last in the air / first on the floor, edges halfway"),
                          "precision": spec.get("precision", f"±1 frame (≈{round(1000 / fps)} ms) per edge"),
                          "takeoffT": round(off_t + log["clipStart"], 5), "landingT": round(on_t + log["clipStart"], 5),
                          "clockNote": "app frame clock (original clip pts + clipStart)",
                          "takeoffFrame": air - info["frameOffset"], "landingFrame": contact - info["frameOffset"],
                          "flightMs": round(flight_ms, 1), "heightCm": h_flight(flight_ms)},
                "app": {**{k: log.get(k) for k in ("tOff", "hLive", "framesLive", "flagsLive", "fpsLive", "h", "hRise", "hFlight",
                                                   "frames", "g", "offset", "flags", "error", "clipStart", "window", "video", "camera", "ms")},
                        "shownCm": None if rejected else round(log["h"] * 100, 1)},
                "tags": spec.get("tags", {}).get(log["clip"]) or (["rejected-poor-fit"] if rejected else ["clean"]),
            }
            if spec.get("phone"):
                entry["phone"] = spec["phone"]
            self.jumps.append(entry)

    # Pose-only sessions whose videos were deleted: landmarks of the whole video + hand-marked truth.
    def pose_only_video(self, vid_id, date, setup, device, precision, tags=None):
        man = {e["id"]: e for e in json.load(open(os.path.join(REPO, "testdata/videos.json")))}[vid_id]
        lm = json.load(open(os.path.join(self.data, f"landmarks/{vid_id}.json")))
        ts = lm.get("timeScale", 1.0)
        ref = man["reference"]
        print(f"{vid_id} (pose only)", flush=True)
        for n, (t_off, fl) in enumerate(zip(ref["times_s"], ref["flight_ms"]), 1):
            jid = f"{date}-{vid_id.split('_')[-1]}-{n}"
            pose_file = os.path.join(self.lib, f"pose/{date}/{jid}_heavy.json")
            frames = pose_window(lm["frames"], t_off - 3, t_off + fl / 1000 + 2, ts)
            write_json(pose_file, {"width": lm["width"], "height": lm["height"], "fps": lm["fps"] / ts, "frames": frames,
                                   "model": "heavy", "source": f"landmarks/{vid_id}.json (every frame, real time = file time × {ts:.6f})"})
            self.jumps.append({
                "id": jid, "person": "p1", "date": date, "session": vid_id,
                "setup": setup, "devices": {"camera": device},
                "clips": [], "videoDeleted": man["file"],
                "pose": [{"role": "front-heavy-full-rate", "file": self.rel(pose_file), "clock": "real seconds of the video"}],
                "truth": {"method": ref["method"], "precision": precision, "takeoffT": t_off, "landingT": round(t_off + fl / 1000, 4),
                          "flightMs": fl, "heightCm": h_flight(fl)},
                "tags": (tags or {}).get(n, ["clean"]),
            })

    # 2026-10-15 native sessions (table, floor): the app's re-measured windows + hand-marked truth.
    def native_20261015(self):
        print("2026-10-15 table/floor (pose only)", flush=True)
        truth = {**ts_truth("TABLE_TRUTH"), **ts_truth("FLOOR_TRUTH")}
        for kind in ("table", "floor"):
            d = os.path.join(self.data, "review", kind)
            for f in sorted(os.listdir(d)):
                if not f.endswith(".json"):
                    continue
                v = json.load(open(os.path.join(d, f)))
                log = v["log"]
                tr = truth.get(log["clip"])
                jid = f"2026-10-15-{kind}-{log['clip'].split('_')[1][:6]}"
                pose_file = os.path.join(self.lib, f"pose/2026-10-15/{jid}_heavy.json")
                write_json(pose_file, {"width": v["width"], "height": v["height"], "fps": v["fps"], "frames": v["frames"],
                                       "model": "heavy", "source": f"review/{kind}/{f} (app re-measurement window)"})
                entry = {
                    "id": jid, "person": "p1", "date": "2026-10-15", "session": f"2026-10-15 native {kind}",
                    "setup": {"view": "front", "camera": "phone on a table" if kind == "table" else "phone on the floor, leaning back 18°",
                              "floor": "wood", "footwear": "barefoot", "arms": "hands on hips"},
                    "devices": {"app": "user's phone (probably Galaxy S24+), front camera, 60 fps, 1080×1920"},
                    "clips": [], "videoDeleted": f"uploads (2026-10-15) {log['clip']}",
                    "pose": [{"role": "front-heavy-app", "file": self.rel(pose_file), "clock": "app frame clock"}],
                    "app": {k: log.get(k) for k in ("tOff", "hLive", "h", "hFlight", "frames", "g", "offset", "flags", "error", "clipStart")},
                    "tags": [],
                }
                if tr:
                    off, on = tr
                    entry["truth"] = {"method": "hand-marked from feet crops of the 60 fps clip (last foot off, first foot down)",
                                      "precision": "±10 ms per edge", "takeoffT": round(off + log["clipStart"], 4),
                                      "landingT": round(on + log["clipStart"], 4), "clockNote": "app frame clock (clip time + clipStart)",
                                      "flightMs": round((on - off) * 1000, 1), "heightCm": h_flight((on - off) * 1000)}
                    entry["tags"] = ["clean"] if not log.get("error") else [f"app-{log.get('error')}"]
                else:
                    entry["tags"] = ["no-truth", "feet-out-of-view"]
                self.jumps.append(entry)

    # Videos kept whole, with a reference value from another device (not frame-exact).
    def reference_videos(self):
        print("reference-only videos", flush=True)
        man = {e["id"]: e for e in json.load(open(os.path.join(REPO, "testdata/videos.json")))}
        items = [
            ("own-VID-20261013-WA0000", "p1", {1: 17.35}, "My Jump app (flight time)", [22.25], "cm"),
            ("yt-3u1uz8ghdk0", "public", None, "contact mat (flight time)", None, "cm"),
            ("yt-O-aTakZ5gwk", "public", {1: 3.5}, "force plate (takeoff velocity); 18.16 in, second digit could be 6 (16.16)", [46.1], "cm"),
        ]
        for vid_id, person, times, method, values, unit in items:
            e = man[vid_id]
            src = os.path.join(self.data, e["file"])
            if not os.path.exists(src):
                print(f"  missing {src}", flush=True)
                continue
            clip = self.copy(src, os.path.join(self.lib, "clips/reference", os.path.basename(e["file"])))
            lm = os.path.join(self.data, f"landmarks/{vid_id}.json")
            pose = [{"role": "heavy-full-rate", "file": self.copy(lm, os.path.join(self.lib, "pose/reference", f"{vid_id}_heavy.json")),
                     "clock": "file seconds (× timeScale if present)"}] if os.path.exists(lm) else []
            ref = e.get("reference") or {}
            if vid_id == "yt-3u1uz8ghdk0":
                times = dict(enumerate(ref["times_s"], 1))
                values = [h_flight(ms) for ms in ref["flight_ms"]]
            for n, t in times.items():
                entry = {
                    "id": f"{vid_id}-{n}", "person": person, "date": None, "session": vid_id, "source": e.get("source"),
                    "setup": {"view": e.get("view"), "arms": e.get("arms"), "notes": e.get("notes")},
                    "clips": [{"role": "video", "file": clip}], "pose": pose,
                    "reference": {"method": method, "valueCm": values[n - 1], "approxTakeoffT": t,
                                  "precision": "device value, not frame-exact"},
                    "tags": ["reference-only"],
                }
                if vid_id == "yt-3u1uz8ghdk0":
                    entry["reference"]["flightMs"] = ref["flight_ms"][n - 1]
                    entry["tags"].append("frame-times-wrong (25 fps converted to 30)")
                self.jumps.append(entry)

    def derived(self):
        """Native simulations made from the deleted 240/120 fps videos (thinned frames, blur), by path."""
        out = []
        for d in sorted(os.listdir(os.path.join(self.data, "review"))):
            if d.startswith("sim_") and os.path.isdir(os.path.join(self.data, "review", d)):
                out.append({"dir": f"../review/{d}", "truth": "TRUTH_020914" if "020914" in d else "TRUTH_174441",
                            "note": "files <model>_e<every>_p<phase>.json; see tools/review/simulate_native.py, simeval.ts"})
        return out

    def run(self):
        self.session_20261019()
        self.session_20261021()
        tags_020914 = {5: ["drift-towards-camera"]}
        self.pose_only_video("own-20261014_020914", "2026-10-14",
                             {"view": "front", "camera": "phone on the floor, tilted up", "floor": "tiles", "footwear": "socks", "arms": "hands on hips"},
                             "Samsung Galaxy S24+, back camera, 240 fps slow motion",
                             "±1–2 frames at 240 fps (4–8 ms) per edge", tags_020914)
        self.pose_only_video("own-20261013_174441", "2026-10-13",
                             {"view": "front", "camera": "phone on the floor, tilted up", "floor": "wood", "footwear": "socks", "arms": "hands on hips"},
                             "user's phone, slow motion 120 fps", "±1 frame at 120 fps (8 ms) per edge")
        self.pose_only_video("own-20261013_174604", "2026-10-13",
                             {"view": "front", "camera": "phone on the floor, tilted up", "floor": "wood", "footwear": "socks", "arms": "hands on hips"},
                             "user's phone, 4K 60 fps", "±1 frame at 60 fps (17 ms) per edge")
        self.native_20261015()
        self.reference_videos()
        self.sources()
        lib = {"version": 1, "description": "Boing jump library: reference jumps with truth. Local only, never in git. See docs/jump-library.md.",
               "people": {"p1": "the app's author", "public": "public video (source URL in the entry)",
                          "u-<recording ID>": "someone who sent recordings from the app with consent (entry has phone)"},
               "jumps": self.jumps, "derived": self.derived()}
        with open(os.path.join(self.lib, "jumps.json"), "w") as f:
            json.dump(lib, f, indent=1, ensure_ascii=False)
        print(f"{len(self.jumps)} jumps → {os.path.join(self.lib, 'jumps.json')}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=os.path.expanduser("~/code/boing-data"))
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    Builder(os.path.abspath(a.data), a.force).run()
