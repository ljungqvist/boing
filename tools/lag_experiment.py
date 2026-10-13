"""Pose-lag experiments: forward VIDEO mode with stretched timestamps, and a reversed pass.
Usage: exp_pose.py <video> <model> <out_prefix> [t_from t_to]"""
import json, sys
import cv2, mediapipe as mp
from mediapipe.tasks.python import BaseOptions, vision

video, model, out = sys.argv[1:4]
t_from, t_to = (float(sys.argv[4]), float(sys.argv[5])) if len(sys.argv) > 5 else (-1, 1e9)
cap = cv2.VideoCapture(video)
W, H = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
frames = []
while True:
    ok, bgr = cap.read()
    if not ok: break
    t = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000
    if t_from <= t <= t_to: frames.append((t, cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)))

def run(order, stretch):
    opts = vision.PoseLandmarkerOptions(base_options=BaseOptions(model_asset_path=model),
                                        running_mode=vision.RunningMode.VIDEO, num_poses=1)
    res = {}
    with vision.PoseLandmarker.create_from_options(opts) as lmk:
        last = -1
        t_end = frames[-1][0]
        for t, rgb in order:
            tt = (t - frames[0][0]) if order is frames else (t_end - t)   # increasing in processing order
            ms = max(int(round(tt * 1000 * stretch)), last + 1); last = ms
            r = lmk.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), ms)
            res[t] = [[round(p.x, 5), round(p.y, 5), round(p.z, 5), round(p.visibility, 3)] for p in r.pose_landmarks[0]] if r.pose_landmarks else None
    return [{"t": round(t, 6), "lm": res[t]} for t, _ in frames]

variants = {"fwd": (frames, 1), "fwd_x10": (frames, 10), "fwd_x100": (frames, 100), "rev": (frames[::-1], 1)}
for name, (order, k) in variants.items():
    fr = run(order, k)
    json.dump({"width": W, "height": H, "fps": 30, "frames": fr}, open(f"{out}_{name}.json", "w"))
    print(name, "frames with pose:", sum(1 for f in fr if f["lm"]), flush=True)
