"""Horizontal drift (toward/away from the app's front camera) per jump, from the coarse side-view landmarks."""
import json
import numpy as np

OUT = '/Users/pl/code/boing-data/review/side_20261019'
edges = json.load(open(f'{OUT}/edges_redtoe.json'))
cache = {}
for e in edges:
    vid = e['vid']
    if vid not in cache:
        d = json.load(open(f'{OUT}/coarse_{vid}.json'))
        cache[vid] = (d, [(f['t'] * d['timeScale'], f['lm']) for f in d['frames'] if f['lm']])
    d, fr = cache[vid]
    W = d['width']
    def mean(sel, idx):
        return np.mean([np.mean([lm[i][0] for i in idx]) for t, lm in fr if sel(t)]) * W
    feet = (29, 30, 31, 32)
    before = mean(lambda t: e['tOff'] - 0.35 < t < e['tOff'] - 0.05, feet)
    after = mean(lambda t: e['tOn'] + 0.05 < t < e['tOn'] + 0.35, feet)
    footlen = np.mean([np.hypot((lm[31][0] - lm[29][0]) * W, (lm[31][1] - lm[29][1]) * d['height'])
                       for t, lm in fr if e['tOff'] - 0.35 < t < e['tOff'] - 0.05])
    hip_off = mean(lambda t: abs(t - e['tOff']) < 0.02, (23, 24))
    hip_on = mean(lambda t: abs(t - e['tOn']) < 0.02, (23, 24))
    cm_per_px = 25.0 / footlen  # heel-to-toe landmark distance ≈ 25 cm (rough scale)
    # Person faces left in the side view; the app's phone is in front of them: negative = towards it.
    print(f"{vid} #{e['n']}: feet moved {after - before:+5.0f} px ({(after - before) * cm_per_px:+5.1f} cm), "
          f"hips during flight {hip_on - hip_off:+5.0f} px ({(hip_on - hip_off) * cm_per_px:+5.1f} cm)  truth {e['h']*100:.1f} cm")
