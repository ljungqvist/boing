"""Takeoff/landing at 240 fps from the lowest red (sock toe) pixel in a crop around the feet."""
import json, sys
import cv2, numpy as np

DATA = '/Users/pl/code/boing-data'
OUT = DATA + '/review/side_20261019'
JUMPS = {
    '233859': [(5.39, 5.77), (20.98, 21.41), (38.03, 38.43), (47.24, 47.59), (64.86, 65.08)],
    '234100': [(5.29, 5.69), (23.36, 23.76), (41.67, 42.07), (59.27, 59.52), (76.17, 76.58), (80.91, 81.31), (101.42, 101.82)],
}
CAP_FPS = 240.0
res = []
for vid, jumps in JUMPS.items():
    d = json.load(open(f'{OUT}/coarse_{vid}.json'))
    ts = d['timeScale']
    W, H = d['width'], d['height']
    fr = [(f['t'] * ts, f['lm']) for f in d['frames'] if f['lm']]
    cap = cv2.VideoCapture(f'{DATA}/own/20261019_{vid}.mp4')
    for n, (a, b) in enumerate(jumps, 1):
        before = [lm for t, lm in fr if a - 0.6 < t < a - 0.2]
        xs = [lm[i][0] for lm in before for i in (29, 30, 31, 32)]
        ys = [lm[i][1] for lm in before for i in (29, 30, 31, 32)]
        x0, x1 = max(0, int((min(xs) - 0.2) * W)), min(W, int((max(xs) + 0.2) * W))
        fl = np.percentile(ys, 95)
        y0, y1 = int((fl - 0.12) * H), int((fl + 0.03) * H)
        k0 = int((a - 0.5) / ts * d['fps'])
        k1 = int((b + 0.4) / ts * d['fps'])
        cap.set(cv2.CAP_PROP_POS_FRAMES, k0)
        rows = []
        for k in range(k0, k1):
            ok, bgr = cap.read()
            if not ok: break
            t = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000 * ts
            hsv = cv2.cvtColor(bgr[y0:y1, x0:x1], cv2.COLOR_BGR2HSV)
            h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
            red = ((h < 8) | (h > 172)) & (s > 150) & (v > 90)
            cnt = red.sum(axis=1)
            idx = np.nonzero(cnt >= 4)[0]
            rows.append((k, t, (y0 + idx.max()) if len(idx) else np.nan))
        rows = np.array(rows, float)
        T, Y = rows[:, 1], rows[:, 2]
        base = np.nanmedian(Y[T < a - 0.25])  # standing (y down)
        after = np.nanmedian(Y[T > b + 0.2])
        up = Y < min(base, after) - 6  # px at 1920
        # longest run of "up" frames
        best, cur, start = (0, 0, 0), 0, 0
        for i, u in enumerate(up):
            if u:
                if cur == 0: start = i
                cur += 1
                if cur > best[0]: best = (cur, start, i)
            else: cur = 0
        _, i0, i1 = best
        tOff, tOn = T[i0], T[i1 + 1]  # first frame up, first frame down again
        fl_t = tOn - tOff
        res.append(dict(vid=vid, n=n, tOff=round(tOff, 4), tOn=round(tOn, 4), flight=round(fl_t, 4),
                        h=round(9.81 * fl_t ** 2 / 8, 4), base=float(base), after=float(after),
                        kOff=int(rows[i0, 0]), kOn=int(rows[i1 + 1, 0]), lift=float(base - np.nanmin(Y))))
        print(f"{vid} #{n}: off {tOff:7.3f} (k {int(rows[i0,0])})  on {tOn:7.3f} (k {int(rows[i1+1,0])})  "
              f"flight {fl_t*1000:5.1f} ms  h {9.81*fl_t**2/8*100:5.1f} cm  floor {base:.0f}/{after:.0f}  lift {base-np.nanmin(Y):.0f}px", flush=True)
        np.save(f'{OUT}/redtoe_{vid}_{n}.npy', rows)
json.dump(res, open(f'{OUT}/edges_redtoe.json', 'w'), indent=1)
