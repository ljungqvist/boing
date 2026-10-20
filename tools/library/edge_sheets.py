"""Foot crops frame by frame around detected takeoff/landing frames, for checking them by eye.

Usage: edge_sheets.py <video> <coarse_pose.json> <edges.json> <vid> <out_dir> [span]
One image per jump: row pairs for takeoff (k-span..k+span-1) and landing, each tile labelled with
the frame index; the detected frame is framed in green.
"""
import json
import sys

import cv2
import numpy as np

video, coarse, edges, vid, out_dir = sys.argv[1:6]
span = int(sys.argv[6]) if len(sys.argv) > 6 else 5
d = json.load(open(coarse))
ts, W, H = d['timeScale'], d['width'], d['height']
fr = [(f['t'] * ts, f['lm']) for f in d['frames'] if f['lm']]
cap = cv2.VideoCapture(video)


def frame(k):
    cap.set(cv2.CAP_PROP_POS_FRAMES, k)
    ok, bgr = cap.read()
    return bgr if ok else None


for e in [e for e in json.load(open(edges)) if e['vid'] == vid]:
    before = [lm for t, lm in fr if e['tOff'] - 0.6 < t < e['tOff'] - 0.2]
    after = [lm for t, lm in fr if e['tOn'] + 0.1 < t < e['tOn'] + 0.4]
    xs = [lm[i][0] for lm in before + after for i in (29, 30, 31, 32)]
    ys = [lm[i][1] for lm in before for i in (29, 30, 31, 32)]
    x0, x1 = max(0, int((min(xs) - 0.05) * W)), min(W, int((max(xs) + 0.05) * W))
    fl = np.percentile(ys, 95)
    y0, y1 = int((fl - 0.05) * H), int((fl + 0.02) * H)
    rows = []
    for k0 in (e['kOff'], e['kOn']):
        tiles = []
        for k in range(k0 - span, k0 + span):
            bgr = frame(k)
            crop = bgr[y0:y1, x0:x1].copy()
            crop = cv2.resize(crop, None, fx=0.75, fy=0.75, interpolation=cv2.INTER_AREA)
            cv2.putText(crop, str(k), (4, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 255, 255), 2)
            if k == k0:
                cv2.rectangle(crop, (0, 0), (crop.shape[1] - 1, crop.shape[0] - 1), (0, 255, 0), 3)
            tiles.append(crop)
        half = len(tiles) // 2
        rows.append(np.hstack(tiles[:half]))
        rows.append(np.hstack(tiles[half:]))
    sep = np.full((6, rows[0].shape[1], 3), 255, np.uint8)
    img = np.vstack([rows[0], rows[1], sep, rows[2], rows[3]])
    cv2.imwrite(f"{out_dir}/check_{vid}_{e['n']}.jpg", img)
    print(f"{vid} #{e['n']} off k{e['kOff']} on k{e['kOn']} -> {out_dir}/check_{vid}_{e['n']}.jpg")
