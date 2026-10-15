"""Contact sheet of a crop around the feet, for marking takeoff and landing by eye.

Usage: contact_sheet.py <video> <time_scale> <t_from> <t_to> <x0> <x1> <y0> <y1> <out.png> [scale] [cols]
Times are real seconds (file seconds × time_scale); crop in normalised image coordinates.
Each tile is labelled with the frame index and real time (ms).
"""
import sys

import cv2
import numpy as np

video, scale, t0, t1, x0, x1, y0, y1, out = sys.argv[1:10]
scale, t0, t1, x0, x1, y0, y1 = map(float, (scale, t0, t1, x0, x1, y0, y1))
zoom = float(sys.argv[10]) if len(sys.argv) > 10 else 0.5
cols = int(sys.argv[11]) if len(sys.argv) > 11 else 6
cap = cv2.VideoCapture(video)
W, H = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
tiles = []
k = -1
while True:
    if not cap.grab():
        break
    k += 1
    t = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0 * scale
    if t < t0:
        continue
    if t > t1:
        break
    _, bgr = cap.retrieve()
    crop = bgr[int(y0 * H):int(y1 * H), int(x0 * W):int(x1 * W)]
    crop = cv2.resize(crop, None, fx=zoom, fy=zoom, interpolation=cv2.INTER_AREA)
    cv2.putText(crop, f"{k} {t * 1000:.1f}", (4, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 255, 255), 2)
    tiles.append(crop)
if not tiles:
    sys.exit("no frames")
h, w = tiles[0].shape[:2]
rows = -(-len(tiles) // cols)
sheet = np.zeros((rows * (h + 4), cols * (w + 4), 3), np.uint8)
for i, tile in enumerate(tiles):
    r, c = divmod(i, cols)
    sheet[r * (h + 4):r * (h + 4) + h, c * (w + 4):c * (w + 4) + w] = tile
cv2.imwrite(out, sheet)
print(len(tiles), "frames", out)
