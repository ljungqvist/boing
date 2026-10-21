"""Foot crops of a native app session (front view) around each re-measured jump's takeoff and landing,
for marking them by eye. Usage: front_sheets.py <upload_dir> <out_dir> [before after]
One image per jump: takeoff frames (top) and landing frames (bottom), labelled with the clip frame index.
"""
import json
import os
import sys

import cv2
import numpy as np

up, out = sys.argv[1], sys.argv[2]
nb, na = (int(sys.argv[3]), int(sys.argv[4])) if len(sys.argv) > 4 else (7, 5)
POINTS = [0, 11, 12, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32]
os.makedirs(out, exist_ok=True)
sess = json.load(open(os.path.join(up, "session.json")))
for l in sorted((l for l in sess["logs"] if l.get("clip") and l.get("pose")), key=lambda l: l["tOff"]):
    cap = cv2.VideoCapture(os.path.join(up, l["clip"]))
    fps = cap.get(cv2.CAP_PROP_FPS)
    W, H = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    t_off = l["tOff"] + l["offset"] - l["clipStart"]
    t_on = t_off + (8 * l["hFlight"] / 9.81) ** 0.5
    # Feet region from the logged pose (normalised), standing before the jump.
    p = l["pose"]
    feet = [r for r in p["frames"] if len(r) > 1 and r[0] + p["t0"] - l["clipStart"] < t_off - 0.3]
    xs = [r[1 + 3 * POINTS.index(k)] for r in feet for k in (29, 30, 31, 32)]
    ys = [r[2 + 3 * POINTS.index(k)] for r in feet for k in (29, 30, 31, 32)]
    x0, x1 = max(0, int((min(xs) - 0.06) * W)), min(W, int((max(xs) + 0.06) * W))
    yb = np.percentile(ys, 90)
    y0, y1 = max(0, int((yb - 0.08) * H)), min(H, int((yb + 0.04) * H))
    rows = []
    for t, (a, b) in ((t_off, (nb, na)), (t_on, (na, nb))):
        k0 = int(round(t * fps))
        tiles = []
        for k in range(k0 - a, k0 + b):
            cap.set(cv2.CAP_PROP_POS_FRAMES, k)
            ok, bgr = cap.read()
            if not ok:
                continue
            c = cv2.resize(bgr[y0:y1, x0:x1], None, fx=0.6, fy=0.6, interpolation=cv2.INTER_AREA)
            cv2.putText(c, str(k), (4, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 255, 255), 2)
            if k == k0:
                cv2.rectangle(c, (0, 0), (c.shape[1] - 1, c.shape[0] - 1), (0, 255, 0), 2)
            tiles.append(c)
        rows.append(np.hstack(tiles[:6]))
        rows.append(np.hstack(tiles[6:12]) if len(tiles) >= 12 else np.hstack(tiles[6:] + [np.zeros_like(tiles[0])] * (12 - len(tiles))))
    sep = np.full((6, rows[0].shape[1], 3), 255, np.uint8)
    name = f"{out}/{l['clip'].split('_')[1][:6]}.jpg"
    cv2.imwrite(name, np.vstack([rows[0], rows[1], sep, rows[2], rows[3]]))
    print(f"{name}: app takeoff frame {int(round(t_off * fps))}, landing {int(round(t_on * fps))} (fps {fps:.2f}, flight {1000 * (t_on - t_off):.0f} ms)")
