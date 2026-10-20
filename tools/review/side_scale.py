"""Apparent body size before takeoff vs after landing in the app's (front) re-measured poses: drift towards the camera grows it."""
import json
import numpy as np
s = json.load(open('/Users/pl/code/boing-data/uploads/2026-10-19_233836/session.json'))
P = [0, 11, 12, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32]
for l in sorted(s['logs'], key=lambda l: l['tOff']):
    if 'pose' not in l: continue
    p = l['pose']; W, H = p['width'], p['height']
    tOff = l['tOff'] + l['offset']  # re-measured takeoff
    tOn = tOff + (8 * l['hFlight'] / 9.81) ** 0.5
    def size(a, b):
        out = []
        for r in p['frames']:
            t = r[0] + p['t0']
            if a < t < b and len(r) > 1:
                g = lambda k, c: r[1 + 3 * P.index(k) + c]
                sh = np.hypot((g(11, 0) - g(12, 0)) * W, (g(11, 1) - g(12, 1)) * H)
                hp = np.hypot((g(23, 0) - g(24, 0)) * W, (g(23, 1) - g(24, 1)) * H)
                out.append((sh, hp))
        return np.median(np.array(out), axis=0)
    # standing frames: just before the countermovement is unreliable, so compare 0.2-0.5 s after landing with ~0.6-0.3 s before takeoff
    b = size(tOff - 0.9, tOff - 0.5); a = size(tOn + 0.25, tOn + 0.6)
    print(f"{l['tOff'] - 2139000:.2f}  h {l['h']*100:5.1f} hF {l['hFlight']*100:5.1f} ratio {l['h']/l['hFlight']:.2f}  "
          f"shoulders {b[0]:.0f}->{a[0]:.0f} ({100*(a[0]/b[0]-1):+.1f}%)  hips {b[1]:.0f}->{a[1]:.0f} ({100*(a[1]/b[1]-1):+.1f}%)")
