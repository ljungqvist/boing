"""Pose of the library's videos from several models, in MediaPipe's 33-point layout, for comparing them.

Usage: pose_sources.py <source> [jump-id-prefix]
  mp-heavy-full   MediaPipe heavy, VIDEO mode, full resolution, all 33 points      (.venv)
  rtm-halpe       RTMPose-x body with feet (Halpe26), per image                     (venv-rtm)
  rtmw            RTMW-x whole body (COCO-WholeBody 133), per image                 (venv-rtm)
Videos: the 2026-10-21 front clips (60 fps, whole clip) → pose/2026-10-21/<id>_front_<source>.json;
the 2026-10-19 side clips (every 240 fps frame of the native window; MediaPipe: every 4th = 60 fps)
→ pose/2026-10-19/side/<id>/<source>.json. Times: front on the app frame clock, side on the clip's real
time (frame / 240). Skips files that exist.
"""
import json
import os
import sys
import time

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cut import frame_pts  # noqa: E402

LIB = os.environ.get("BOING_LIBRARY") or os.path.expanduser("~/boing-data/library")
MODELS = os.path.expanduser("~/boing-data/models")
source = sys.argv[1]
prefix = sys.argv[2] if len(sys.argv) > 2 else ""

# Halpe26 / COCO-WholeBody → MediaPipe 33 (MediaPipe: odd = left). Body 0–16 is COCO order in both.
BODY = {0: 0, 1: 2, 2: 5, 3: 7, 4: 8, 5: 11, 6: 12, 7: 13, 8: 14, 9: 15, 10: 16, 11: 23, 12: 24, 13: 25, 14: 26, 15: 27, 16: 28}
WB_FEET = {19: 29, 22: 30, 17: 31, 20: 32}
FEET = {"rtm-halpe": {24: 29, 25: 30, 20: 31, 21: 32}, "rtmw": WB_FEET, "rtmw-l": WB_FEET, "rtmw-m": WB_FEET}
# rtmlib modes: rtmw = performance (RTMW-x 384×288), rtmw-l = balanced (RTMW-l 256×192), rtmw-m = lightweight (RTMW-m).
MODE = {"rtm-halpe": "performance", "rtmw": "performance", "rtmw-l": "balanced", "rtmw-m": "lightweight"}


def make_model():
    if source == "mp-heavy-full":
        import mediapipe as mp
        from mediapipe.tasks.python import BaseOptions, vision
        opts = vision.PoseLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=os.path.join(MODELS, "pose_landmarker_heavy.task")),
            running_mode=vision.RunningMode.VIDEO, num_poses=1)
        lmk = vision.PoseLandmarker.create_from_options(opts)
        state = {"ms": -1}

        def run(bgr, t):
            ms = max(int(round(t * 1000)), state["ms"] + 1)
            state["ms"] = ms
            r = lmk.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)), ms)
            if not r.pose_landmarks:
                return None
            return [[round(p.x, 5), round(p.y, 5), round(p.z, 5), round(p.visibility, 3)] for p in r.pose_landmarks[0]]
        return run
    from rtmlib import BodyWithFeet, PoseTracker, Wholebody
    sol = BodyWithFeet if source == "rtm-halpe" else Wholebody
    tracker = PoseTracker(sol, det_frequency=8, tracking=False, mode=MODE[source], backend="onnxruntime", device="cpu")
    table = {**BODY, **FEET[source]}

    def run(bgr, t):
        H, W = bgr.shape[:2]
        kps, scores = tracker(bgr)
        if kps is None or len(kps) == 0:
            return None
        k = max(range(len(kps)), key=lambda i: float(np.ptp(kps[i][:, 0]) * np.ptp(kps[i][:, 1])))
        p, s = kps[k], scores[k]
        lm = [[0.0, 0.0, 0.0, 0.0] for _ in range(33)]
        for h, m in table.items():
            lm[m] = [round(float(p[h, 0]) / W, 5), round(float(p[h, 1]) / H, 5), 0.0, round(float(min(1.0, s[h])), 3)]
        return lm
    return run


lib = json.load(open(os.path.join(LIB, "jumps.json")))
t_start = time.time()
for j in lib["jumps"]:
    if not j["id"].startswith(prefix):
        continue
    if j["date"] == "2026-10-21":
        clip = next(c for c in j["clips"] if c["role"] == "app-front")
        out = os.path.join(LIB, f"pose/2026-10-21/{j['id']}_front_{source}.json")
        if os.path.exists(out):
            continue
        path = os.path.join(LIB, clip["file"])
        pts, _ = frame_pts(path)
        cap = cv2.VideoCapture(path)
        W, H = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        run = make_model()
        frames = []
        for t in pts:
            ok, bgr = cap.read()
            if not ok:
                break
            frames.append({"t": round(t + clip["clipStart"], 6), "lm": run(bgr, t)})
        json.dump({"width": W, "height": H, "fps": 60, "frames": frames, "model": source, "clock": "app frame clock"}, open(out, "w"))
        print(f"{j['id']} front {len(frames)} frames, {time.time() - t_start:.0f} s", flush=True)
    elif j["date"] == "2026-10-19":
        # Front (30 fps): the app's clip, the frames of its logged re-measurement.
        front = next((c for c in j["clips"] if c["role"] == "app-front"), None)
        logged = next((p for p in j.get("pose", []) if p["role"] == "front-heavy-app"), None)
        out_f = os.path.join(LIB, f"pose/2026-10-19/{j['id']}_front_{source}.json")
        if front and logged and not os.path.exists(out_f):
            v = json.load(open(os.path.join(LIB, logged["file"])))
            path = os.path.join(LIB, front["file"])
            pts, _ = frame_pts(path)
            want = {min(range(len(pts)), key=lambda i: abs(pts[i] + front["clipStart"] - f["t"])): f["t"] for f in v["frames"]}
            cap = cv2.VideoCapture(path)
            W, H = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            run = make_model()
            frames = []
            for k in range(max(want) + 1):
                ok, bgr = cap.read()
                if not ok:
                    break
                if k in want:
                    frames.append({"t": want[k], "lm": run(bgr, want[k])})
            json.dump({"width": W, "height": H, "fps": 30, "frames": frames, "model": source, "clock": "app frame clock"}, open(out_f, "w"))
            print(f"{j['id']} front {len(frames)} frames, {time.time() - t_start:.0f} s", flush=True)
        clip = next((c for c in j["clips"] if c["role"] == "side-240"), None)
        out = os.path.join(LIB, f"pose/2026-10-19/side/{j['id']}/{source}.json")
        if not clip or os.path.exists(out):
            continue
        tr = j["truth"]
        k0, k1 = int((tr["takeoffT"] - 1.1) * 240), int((tr["landingT"] + 0.9) * 240)
        every = 4 if source.startswith("mp-") else 1  # VIDEO mode needs the real stream rate
        cap = cv2.VideoCapture(os.path.join(LIB, clip["file"]))
        W, H = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        cap.set(cv2.CAP_PROP_POS_FRAMES, k0)
        run = make_model()
        frames = []
        for k in range(k0, k1 + 1):
            ok, bgr = cap.read()
            if not ok:
                break
            if (k - k0) % every:
                continue
            frames.append({"k": k, "t": round(k / 240, 6), "lm": run(bgr, k / 240)})
        os.makedirs(os.path.dirname(out), exist_ok=True)
        json.dump({"width": W, "height": H, "fps": 240 // every, "frames": frames, "model": source, "clock": "side clip real time"}, open(out, "w"))
        print(f"{j['id']} side {len(frames)} frames, {time.time() - t_start:.0f} s", flush=True)
