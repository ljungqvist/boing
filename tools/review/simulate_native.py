"""Native live re-measurement, offline: a fresh VIDEO-mode landmarker per jump window, frames
thinned to a lower rate (every Nth frame, each phase), bitmaps subsampled like the Android decoder.

Usage: simulate_native.py <video> <time_scale> <out_dir> <windows.json> <models,...> <every:phases,...> [blur]
[mode] "image": IMAGE running mode instead of VIDEO.
blur N: each kept frame is the mean of the N source frames centred on it (motion blur of a longer exposure).
windows.json: [[from, to], ...] in real seconds (file seconds × time_scale).
Writes <out_dir>/<model>_e<every>_p<phase>.json: {"width", "height", "windows": [{"from", "to", "frames"}]}.
"""
import json
import os
import sys
import time

import cv2
import mediapipe as mp
from mediapipe.tasks.python import BaseOptions, vision

video, scale, out_dir, windows_path, models, plans = sys.argv[1:7]
blur = int(sys.argv[7]) if len(sys.argv) > 7 else 1
image_mode = len(sys.argv) > 8 and sys.argv[8] == "image"  # every frame on its own (no tracking/smoothing)
scale = float(scale)
windows = json.load(open(windows_path))
models = models.split(",")
configs = []  # (model, every, phase)
for p in plans.split(","):
    every, phases = p.split(":")
    for ph in (range(int(every)) if phases == "all" else [int(x) for x in phases.split("/")]):
        for m in models:
            configs.append((m, int(every), ph))
model_dir = os.environ.get("BOING_MODELS") or os.path.join(os.path.dirname(os.path.abspath(video)), "..", "models")
os.makedirs(out_dir, exist_ok=True)

cap = cv2.VideoCapture(video)
W, H = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
step = max(1, -(-max(W, H) // 1280))  # Android decoder: integer subsampling to <= 1280 px
results = {c: [] for c in configs}
active = {}  # config -> (landmarker, last_ms, frames)


def open_landmarker(model):
    opts = vision.PoseLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=os.path.join(model_dir, f"pose_landmarker_{model}.task")),
        running_mode=vision.RunningMode.IMAGE if image_mode else vision.RunningMode.VIDEO, num_poses=1)
    return vision.PoseLandmarker.create_from_options(opts)


k = -1
wi = 0
import collections
import numpy as np
recent = collections.deque(maxlen=blur)  # (k, t, rgb) of the last decoded frames
t_start = time.time()
while wi < len(windows):
    if not cap.grab():
        break
    k += 1
    t = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0 * scale
    lo, hi = windows[wi]
    if t < lo:
        continue
    if t > hi:
        for c, (lmk, _, frames) in active.items():
            lmk.close()
            results[c].append({"from": lo, "to": hi, "frames": frames})
        active = {}
        recent.clear()
        wi += 1
        print(f"window {wi}/{len(windows)} done, {time.time() - t_start:.0f} s", flush=True)
        continue
    if blur > 1:
        ok, bgr = cap.retrieve()
        recent.append((k, t, cv2.cvtColor(bgr[::step, ::step], cv2.COLOR_BGR2RGB).astype(np.float32)))
        # The frame centred in the buffer is the one whose exposure the buffer spans.
        if len(recent) < blur:
            continue
        kc, tc, _ = recent[blur // 2]
        todo = [c for c in configs if (kc % c[1]) == c[2]]
        if not todo:
            continue
        rgb = (sum(r for _, _, r in recent) / blur).astype(np.uint8)
        t = sum(x for _, x, _ in recent) / blur  # mid-exposure time
    else:
        todo = [c for c in configs if (k % c[1]) == c[2]]
        if not todo:
            continue
        ok, bgr = cap.retrieve()
        rgb = cv2.cvtColor(bgr[::step, ::step], cv2.COLOR_BGR2RGB)
    image = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))
    for c in todo:
        if c not in active:
            active[c] = (open_landmarker(c[0]), -1, [])
        lmk, last, frames = active[c]
        ms = max(int(round(t * 1000)), last + 1)
        r = lmk.detect(image) if image_mode else lmk.detect_for_video(image, ms)
        lm = [[round(p.x, 5), round(p.y, 5), round(p.z, 5), round(p.visibility, 3)] for p in r.pose_landmarks[0]] if r.pose_landmarks else None
        frames.append({"t": round(t, 6), "lm": lm})
        active[c] = (lmk, ms, frames)

for c, (lmk, _, frames) in active.items():
    lmk.close()
    results[c].append({"from": windows[wi][0], "to": windows[wi][1], "frames": frames})
for (m, e, ph), wins in results.items():
    with open(os.path.join(out_dir, f"{m}_e{e}_p{ph}.json"), "w") as f:
        json.dump({"width": W // step, "height": H // step, "windows": wins}, f, separators=(",", ":"))
print("done", time.time() - t_start)
