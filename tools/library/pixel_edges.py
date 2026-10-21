"""Takeoff/landing from the pixels around the feet (no colour assumptions), on the 2026-10-19 library jumps.

The pose only locates the feet. A patch just above the floor around them is compared with the same
patch standing before takeoff (for the takeoff) and standing after landing (for the landing): mean
absolute grey difference. In the air the patch shows the floor/background instead of the foot. The
edge is where the difference crosses `theta` × its in-air level (linear between frames).

Sets: "front-30": the app's own clip and logged pose (30 fps, real); "side-<fps>-b<blur>": the side
clip thinned like tools/library/side_sims.py, with that simulation's pose.
Usage: pixel_edges.py [theta,...] > results.json
"""
import json
import os
import sys

import cv2
import numpy as np

LIB = os.environ.get("BOING_LIBRARY") or os.path.expanduser("~/code/boing-data/library")
G = 9.81
thetas = [float(x) for x in (sys.argv[1] if len(sys.argv) > 1 else "0.3,0.5").split(",")]
views = sys.argv[2].split(",") if len(sys.argv) > 2 else ["front", "side"]


def quad_vertex(t, y):
    t0 = float(np.mean(t))  # centred: app-clock times are ~10⁶ s
    a, b, _ = np.polyfit(np.asarray(t) - t0, y, 2)
    return t0 - b / (2 * a) if a < 0 else np.nan


class Frames:
    """Frames of a video by index, cropped at read time to `region` (x0, x1, y0, y1) to save memory;
    sequential reads with a cache; optional blur (mean of N)."""

    def __init__(self, path, region):
        self.cap = cv2.VideoCapture(path)
        self.region = region
        self.next = 0
        self.cache = {}

    def get(self, k):
        if k in self.cache:
            return self.cache[k]
        if k < self.next or k > self.next + 400:
            self.cap.set(cv2.CAP_PROP_POS_FRAMES, k)
            self.next = k
        x0, x1, y0, y1 = self.region
        while self.next <= k:
            ok, bgr = self.cap.read()
            self.cache[self.next] = cv2.cvtColor(bgr[y0:y1, x0:x1], cv2.COLOR_BGR2GRAY) if ok else None
            self.next += 1
        if len(self.cache) > 1500:
            for key in sorted(self.cache)[:500]:
                self.cache.pop(key)
        return self.cache[k]

    def blurred(self, k, n):
        if n <= 1:
            return self.get(k).astype(np.float32)
        fs = [self.get(i).astype(np.float32) for i in range(k - n // 2, k - n // 2 + n)]
        return sum(fs) / n


def feet_region(lm_lists, W, H, pad=0.08):
    """A generous region around the feet over all given frames (pixels)."""
    xs = [lm[i][0] for lms in lm_lists for lm in lms if lm for i in (29, 30, 31, 32) if lm[i][3] > 0.3]
    ys = [lm[i][1] for lms in lm_lists for lm in lms if lm for i in (29, 30, 31, 32) if lm[i][3] > 0.3]
    return (max(0, int((min(xs) - pad) * W)), min(W, int((max(xs) + pad) * W)),
            max(0, int((min(ys) - pad) * H)), min(H, int((max(ys) + pad) * H)))


def foot_box(lms, W, H, pad=0.03):
    xs = [lm[i][0] for lm in lms for i in (29, 30, 31, 32) if lm[i][3] > 0.3]
    ys = [lm[i][1] for lm in lms for i in (29, 30, 31, 32) if lm[i][3] > 0.3]
    if not xs:
        return None
    y_bot = np.percentile(ys, 90)
    return (max(0, int((min(xs) - pad) * W)), min(W, int((max(xs) + pad) * W)),
            max(0, int((y_bot - 0.035) * H)), min(H, int((y_bot + 0.03) * H)))


def edges(frames_t, imgs, lms, t_off0, t_on0, W, H, theta, region):
    """frames_t: times; imgs(i) → grey image of frame i; lms: landmarks per frame (or None)."""
    pre = [i for i, t in enumerate(frames_t) if t_off0 - 0.35 <= t <= t_off0 - 0.12 and lms[i]]
    post = [i for i, t in enumerate(frames_t) if t_on0 + 0.12 <= t <= t_on0 + 0.35 and lms[i]]
    if len(pre) < 2 or len(post) < 2:
        return None
    bp, ba = foot_box([lms[i] for i in pre], W, H), foot_box([lms[i] for i in post], W, H)
    if not bp or not ba:
        return None
    rx, ry = region[0], region[2]
    bp = (bp[0] - rx, bp[1] - rx, bp[2] - ry, bp[3] - ry)
    ba = (ba[0] - rx, ba[1] - rx, ba[2] - ry, ba[3] - ry)
    crop = lambda img, b: cv2.GaussianBlur(img[max(0, b[2]):b[3], max(0, b[0]):b[1]].astype(np.float32), (5, 5), 0)
    ref_p = np.median([crop(imgs(i), bp) for i in pre], axis=0)
    ref_a = np.median([crop(imgs(i), ba) for i in post], axis=0)
    mid = (t_off0 + t_on0) / 2
    sel = [i for i, t in enumerate(frames_t) if t_off0 - 0.25 <= t <= t_on0 + 0.25]
    sp = {i: float(np.mean(np.abs(crop(imgs(i), bp) - ref_p))) for i in sel}
    sa = {i: float(np.mean(np.abs(crop(imgs(i), ba) - ref_a))) for i in sel}
    inner = [i for i in sel if abs(frames_t[i] - mid) <= (t_on0 - t_off0) * 0.25]
    if not inner:
        return None
    lp, la = np.median([sp[i] for i in inner]), np.median([sa[i] for i in inner])
    # Takeoff: last crossing upwards before mid-flight; landing: first crossing downwards after it.
    up = [i for i in sel if frames_t[i] <= mid]
    tOff = None
    for a, b in zip(up[::-1][1:], up[::-1]):
        if sp[a] < theta * lp <= sp[b]:
            tOff = frames_t[a] + (theta * lp - sp[a]) / (sp[b] - sp[a]) * (frames_t[b] - frames_t[a])
            break
    down = [i for i in sel if frames_t[i] >= mid]
    tOn = None
    for a, b in zip(down, down[1:]):
        if sa[a] >= theta * la > sa[b]:
            tOn = frames_t[a] + (sa[a] - theta * la) / (sa[a] - sa[b]) * (frames_t[b] - frames_t[a])
            break
    return tOff, tOn


def hip_apex(frames_t, lms, t_off, t_on):
    idx = [i for i, t in enumerate(frames_t) if t_off < t < t_on and lms[i]]
    if len(idx) < 4:
        return np.nan
    t = np.array([frames_t[i] for i in idx])
    y = np.array([-(lms[i][23][1] + lms[i][24][1]) / 2 for i in idx])
    return quad_vertex(t, y)


lib = json.load(open(os.path.join(LIB, "jumps.json")))
out = []
for j in lib["jumps"]:
    if j["date"] != "2026-10-19":
        continue
    tr = j["truth"]
    shift = j["clock"]["appMinusSide"]
    # Front: the app's clip with its logged pose (app clock); truth moved onto the app clock.
    front = next((c for c in j["clips"] if c["role"] == "app-front"), None)
    pose = next((p for p in j.get("pose", []) if p["role"] == "front-heavy-app"), None)
    jobs = []
    if front and pose and "front" in views:
        v = json.load(open(os.path.join(LIB, pose["file"])))
        probe = cv2.VideoCapture(os.path.join(LIB, front["file"]))
        fps = probe.get(cv2.CAP_PROP_FPS)
        W, H = int(probe.get(cv2.CAP_PROP_FRAME_WIDTH)), int(probe.get(cv2.CAP_PROP_FRAME_HEIGHT))
        region = feet_region([[f["lm"] for f in v["frames"]]], W, H)
        cap = Frames(os.path.join(LIB, front["file"]), region)
        # Logged pose frame times (app clock) → clip frame index.
        idx = [int(round((f["t"] - front["clipStart"]) * fps)) for f in v["frames"]]
        jobs.append(("front-30", [f["t"] for f in v["frames"]], lambda i, idx=idx, cap=cap: cap.get(idx[i]).astype(np.float32),
                     [f["lm"] for f in v["frames"]], W, H, tr["takeoffT"] + shift, tr["landingT"] + shift, region))
    side = next((c for c in j["clips"] if c["role"] == "side-240"), None)
    sdir = os.path.join(LIB, f"pose/2026-10-19/side/{j['id']}")
    if side and os.path.isdir(sdir) and "side" in views:
        probe = cv2.VideoCapture(os.path.join(LIB, side["file"]))
        W, H = int(probe.get(cv2.CAP_PROP_FRAME_WIDTH)), int(probe.get(cv2.CAP_PROP_FRAME_HEIGHT))
        ref = json.load(open(os.path.join(sdir, "b1", "heavy_e8_p0.json")))["windows"][0]["frames"]
        region = feet_region([[x["lm"] for x in ref]], W, H)
        cap = Frames(os.path.join(LIB, side["file"]), region)
        for b in sorted(x for x in os.listdir(sdir) if x.startswith("b")):
            n = int(b[1:])
            for f in sorted(x for x in os.listdir(os.path.join(sdir, b)) if x.startswith("heavy_")):
                every = int(f.split("_e")[1].split("_")[0])
                d = json.load(open(os.path.join(sdir, b, f)))
                fr = d["windows"][0]["frames"]
                ks = [int(round(x["t"] * 240)) for x in fr]
                jobs.append((f"side-{240 // every}-b{n}/{f}", [x["t"] for x in fr],
                             lambda i, ks=ks, cap=cap, n=n: cap.blurred(ks[i], n), [x["lm"] for x in fr], W, H,
                             tr["takeoffT"], tr["landingT"], region))
    for name, ts, imgs, lms, W, H, off, on, region in jobs:
        # Starting edges: the truth ± noise isn't allowed; use the pose's own toe flight (crude).
        toe = [(-(lm[31][1] + lm[32][1]) / 2 if lm else np.nan) for lm in lms]
        base = np.nanmedian([y for t, y in zip(ts, toe) if t < off - 0.3]) if any(t < off - 0.3 for t in ts) else np.nan
        air = [t for t, y in zip(ts, toe) if np.isfinite(y) and y - base > 0.02 and off - 0.3 < t < on + 0.3]
        if not air:
            continue
        t0, t1 = min(air), max(air)
        for th in thetas:
            e = edges(ts, imgs, lms, t0, t1, W, H, th, region)
            if not e or e[0] is None or e[1] is None:
                out.append({"id": j["id"], "set": name, "theta": th, "ok": False})
                continue
            tOff, tOn = e
            apex = hip_apex(ts, lms, tOff, tOn)
            hF = G * (tOn - tOff) ** 2 / 8
            hR = G / 2 * (apex - tOff) ** 2 if np.isfinite(apex) else np.nan
            out.append({"id": j["id"], "set": name, "theta": th, "ok": True, "dOff": tOff - off, "dOn": tOn - on,
                        "hFlight": hF, "hRise": hR, "hShown": min(hF, hR) if np.isfinite(hR) else hF, "truth": tr["heightCm"] / 100})
    print(j["id"], file=sys.stderr, flush=True)
json.dump(out, sys.stdout)
