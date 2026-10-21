"""RTMPose "body with feet" (Halpe26: big toe, small toe, heel) on the 2026-10-19 library jumps, written in
MediaPipe's 33-point layout so findJumps runs unchanged: "foot index" (31/32) = big toe tip.

Runs in its own venv (rtmlib + onnxruntime): ~/code/boing-data/venv-rtm/bin/python rtm_pose.py [mode]
- front: the frames of the app's logged re-measurement (app clip, same times) → pose/2026-10-19/<id>_front_rtm.json
- side: every 240 fps frame of the native window (takeoff − 1.1 s … landing + 0.9 s) →
  pose/2026-10-19/side/<id>/rtm240.json (per image, no tracking: thinning afterwards equals running at
  30/60 fps)
"""
import json
import os
import sys
import time

import cv2
import numpy as np
from rtmlib import BodyWithFeet, PoseTracker

LIB = os.environ.get("BOING_LIBRARY") or os.path.expanduser("~/code/boing-data/library")
mode = sys.argv[1] if len(sys.argv) > 1 else "performance"
# The person detector only every 8th frame (box from the last pose in between); pose on every frame.
new_model = lambda: PoseTracker(BodyWithFeet, det_frequency=8, tracking=False, mode=mode, backend="onnxruntime", device="cpu")
model = None

# Halpe26 → MediaPipe 33 (left/right as in MediaPipe: odd = left).
# Halpe: 5 L shoulder, 6 R shoulder … 11 L hip, 12 R hip, 20 L big toe, 21 R big toe, 24 L heel, 25 R heel.
MAP = {0: 0, 5: 11, 6: 12, 7: 13, 8: 14, 9: 15, 10: 16, 11: 23, 12: 24, 13: 25, 14: 26, 15: 27, 16: 28,
       24: 29, 25: 30, 20: 31, 21: 32, 3: 7, 4: 8}


def pose(bgr):
    H, W = bgr.shape[:2]
    kps, scores = model(bgr)
    if kps is None or len(kps) == 0:
        return None
    # The largest person (by keypoint spread).
    k = int(np.argmax([np.ptp(p[:, 1]) * np.ptp(p[:, 0]) for p in kps]))
    p, s = kps[k], scores[k]
    lm = [[0.0, 0.0, 0.0, 0.0] for _ in range(33)]
    for h, m in MAP.items():
        lm[m] = [round(float(p[h, 0]) / W, 5), round(float(p[h, 1]) / H, 5), 0.0, round(float(min(1.0, s[h])), 3)]
    return lm


lib = json.load(open(os.path.join(LIB, "jumps.json")))
t_start = time.time()
for j in lib["jumps"]:
    if j["date"] != "2026-10-19":
        continue
    # Front: same frames as the app's re-measurement.
    front = next((c for c in j["clips"] if c["role"] == "app-front"), None)
    logged = next((p for p in j.get("pose", []) if p["role"] == "front-heavy-app"), None)
    out = os.path.join(LIB, f"pose/2026-10-19/{j['id']}_front_rtm.json")
    if front and logged and not os.path.exists(out):
        model = new_model()
        v = json.load(open(os.path.join(LIB, logged["file"])))
        cap = cv2.VideoCapture(os.path.join(LIB, front["file"]))
        fps = cap.get(cv2.CAP_PROP_FPS)
        W, H = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        frames = []
        for f in v["frames"]:
            cap.set(cv2.CAP_PROP_POS_FRAMES, int(round((f["t"] - front["clipStart"]) * fps)))
            ok, bgr = cap.read()
            frames.append({"t": f["t"], "lm": pose(bgr) if ok else None})
        json.dump({"width": W, "height": H, "fps": v["fps"], "frames": frames, "model": f"rtmpose-{mode} halpe26 (detector every 8th frame)"}, open(out, "w"))
        print(f"{j['id']} front {len(frames)} frames, {time.time() - t_start:.0f} s", flush=True)
    # Side: every frame of the native window at 240 fps.
    side = next((c for c in j["clips"] if c["role"] == "side-240"), None)
    out = os.path.join(LIB, f"pose/2026-10-19/side/{j['id']}/rtm240.json")
    if side and not os.path.exists(out):
        model = new_model()
        tr = j["truth"]
        k0, k1 = int((tr["takeoffT"] - 1.1) * 240), int((tr["landingT"] + 0.9) * 240)
        cap = cv2.VideoCapture(os.path.join(LIB, side["file"]))
        W, H = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        cap.set(cv2.CAP_PROP_POS_FRAMES, k0)
        frames = []
        for k in range(k0, k1 + 1):
            ok, bgr = cap.read()
            if not ok:
                break
            frames.append({"k": k, "t": round(k / 240, 6), "lm": pose(bgr)})
        os.makedirs(os.path.dirname(out), exist_ok=True)
        json.dump({"width": W, "height": H, "fps": 240, "frames": frames, "model": f"rtmpose-{mode} halpe26 (detector every 8th frame)"}, open(out, "w"))
        print(f"{j['id']} side {len(frames)} frames, {time.time() - t_start:.0f} s", flush=True)
