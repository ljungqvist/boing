"""ViTPose++ huge (Hugging Face transformers, COCO 17 points) on the library's videos, written in
MediaPipe's 33-point layout (no feet beyond the ankles; heels/toes left empty). The person box comes
from the full-resolution MediaPipe pose of the same frames (pose_sources.py mp-heavy-full).

Usage (venv-vit): vitpose_source.py [model id]  → pose/2026-10-21/<id>_front_vitpose.json,
pose/2026-10-19/side/<id>/vitpose.json (side: every 4th 240 fps frame = 60 fps, as the MediaPipe file).
"""
import json
import os
import sys
import time

import cv2
import numpy as np
import torch
from PIL import Image
from transformers import AutoProcessor, VitPoseForPoseEstimation

LIB = os.environ.get("BOING_LIBRARY") or os.path.expanduser("~/boing-data/library")
MODEL = sys.argv[1] if len(sys.argv) > 1 else "usyd-community/vitpose-plus-huge"
dev = "mps" if torch.backends.mps.is_available() else "cpu"
proc = AutoProcessor.from_pretrained(MODEL)
model = VitPoseForPoseEstimation.from_pretrained(MODEL).to(dev).eval()
BODY = {0: 0, 1: 2, 2: 5, 3: 7, 4: 8, 5: 11, 6: 12, 7: 13, 8: 14, 9: 15, 10: 16, 11: 23, 12: 24, 13: 25, 14: 26, 15: 27, 16: 28}


def box_of(lm, W, H, pad=0.12):
    pts = [(p[0] * W, p[1] * H) for p in lm if p[3] > 0.3]
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    w, h = max(xs) - min(xs), max(ys) - min(ys)
    x0, y0 = max(0, min(xs) - pad * w), max(0, min(ys) - pad * h)
    return [x0, y0, min(W, max(xs) + pad * w) - x0, min(H, max(ys) + pad * h) - y0]  # COCO xywh


@torch.no_grad()
def pose(bgr, box):
    H, W = bgr.shape[:2]
    img = Image.fromarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
    inputs = proc(img, boxes=[[box]], return_tensors="pt").to(dev)
    kw = {"dataset_index": torch.tensor([0], device=dev)} if "plus" in MODEL else {}
    out = model(**inputs, **kw)
    r = proc.post_process_pose_estimation(out, boxes=[[box]])[0][0]
    kp, sc = r["keypoints"].cpu().numpy(), r["scores"].cpu().numpy()
    lm = [[0.0, 0.0, 0.0, 0.0] for _ in range(33)]
    for h, m in BODY.items():
        lm[m] = [round(float(kp[h, 0]) / W, 5), round(float(kp[h, 1]) / H, 5), 0.0, round(float(min(1.0, sc[h])), 3)]
    return lm


def run(video, guide, out, frame_ids, times, extra):
    g = json.load(open(guide))["frames"]
    cap = cv2.VideoCapture(video)
    frames, want = [], dict(zip(frame_ids, range(len(frame_ids))))
    k, last = -1, max(frame_ids)
    while k < last:
        ok, bgr = cap.read()
        k += 1
        if not ok:
            break
        if k not in want:
            continue
        i = want[k]
        lm_g = g[i]["lm"]
        lm = pose(bgr, box_of(lm_g, bgr.shape[1], bgr.shape[0])) if lm_g else None
        frames.append({**({"k": extra[i]} if extra else {}), "t": times[i], "lm": lm})
    W, H = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    json.dump({"width": W, "height": H, "fps": 60, "frames": frames, "model": MODEL}, open(out, "w"))


t0 = time.time()
lib = json.load(open(os.path.join(LIB, "jumps.json")))
for j in lib["jumps"]:
    if j["date"] == "2026-10-21":
        out = os.path.join(LIB, f"pose/2026-10-21/{j['id']}_front_vitpose.json")
        guide = os.path.join(LIB, f"pose/2026-10-21/{j['id']}_front_mp-heavy-full.json")
        if os.path.exists(out) or not os.path.exists(guide):
            continue
        gf = json.load(open(guide))["frames"]
        clip = next(c for c in j["clips"] if c["role"] == "app-front")
        run(os.path.join(LIB, clip["file"]), guide, out, list(range(len(gf))), [f["t"] for f in gf], None)
        print(j["id"], "front", f"{time.time() - t0:.0f} s", flush=True)
    elif j["date"] == "2026-10-19":
        out = os.path.join(LIB, f"pose/2026-10-19/side/{j['id']}/vitpose.json")
        guide = os.path.join(LIB, f"pose/2026-10-19/side/{j['id']}/mp-heavy-full.json")
        if os.path.exists(out) or not os.path.exists(guide):
            continue
        gf = json.load(open(guide))["frames"]
        clip = next(c for c in j["clips"] if c["role"] == "side-240")
        # The guide's frames are clip frames k (every 4th); reading from 0 keeps indices exact.
        run(os.path.join(LIB, clip["file"]), guide, out, [f["k"] for f in gf], [f["t"] for f in gf], [f["k"] for f in gf])
        print(j["id"], "side", f"{time.time() - t0:.0f} s", flush=True)
