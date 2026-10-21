"""Per-frame toe/heel/hip heights (px, up positive) of logged re-measured poses around takeoff."""
import json, sys
s = json.load(open('/Users/pl/code/boing-data/uploads/2026-10-19_233836/session.json'))
P = [0, 11, 12, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32]
for want in map(float, sys.argv[1:]):
    l = min(s['logs'], key=lambda l: abs(l['tOff'] - 2139000 - want))
    p = l['pose']; H = p['height']; W = p['width']
    print(f"--- {want}  t0 {p['t0'] - 2139000:.2f}")
    for r in p['frames']:
        t = r[0] + p['t0'] - l['tOff']
        if not -0.45 < t < 0.75 or len(r) == 1: continue
        g = lambda k, c: r[1 + 3 * P.index(k) + c]
        row = [f"{t:+.3f}"]
        for k in (31, 32, 29, 30):
            row.append(f"{(1 - g(k, 1)) * H:6.1f}/{g(k, 2):.2f}")
        row.append(f"hip {(1 - (g(23, 1) + g(24, 1)) / 2) * H:6.1f}")
        row.append(f"toeX {g(31, 0) * W:5.0f} {g(32, 0) * W:5.0f}")
        print('  '.join(row))
