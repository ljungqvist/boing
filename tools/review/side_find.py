"""Airborne runs in a coarse side-view pose file (side_coarse.py output). Usage: side_find.py <coarse.json>"""
import json, sys, numpy as np
d = json.load(open(sys.argv[1])); H = d['height']; ts = d.get('timeScale', 1)
T, Y, HIP = [], [], []
for f in d['frames']:
    if not f['lm']: continue
    lm = f['lm']
    feet = [lm[i][1] for i in (29, 30, 31, 32)]
    T.append(f['t'] * ts); Y.append(max(feet) * H); HIP.append((lm[23][1] + lm[24][1]) / 2 * H)
T, Y, HIP = map(np.array, (T, Y, HIP))
print('frames with pose', len(T), 'of', len(d['frames']), 'real dur', T[-1])
# floor: rolling percentile of lowest foot point (y grows down)
floor = np.array([np.percentile(Y[max(0, i-120):i+120], 80) for i in range(len(Y))])
air = Y < floor - 25  # px at 1920 high
runs = []; i = 0
while i < len(air):
    if air[i]:
        j = i
        while j + 1 < len(air) and air[j+1]: j += 1
        if T[j] - T[i] > 0.15: runs.append((T[i], T[j], floor[i] - Y[i:j+1].min()))
        i = j + 1
    else: i += 1
for a, b, h in runs:
    print(f"air {a:7.2f}-{b:7.2f}s  dur {1000*(b-a):4.0f} ms  feet up {h:4.0f}px  hcoarse {9.81*(b-a+1/60)**2/8*100:4.1f} cm")
