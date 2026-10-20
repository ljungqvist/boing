"""Summary of pixel_edges.py output: per set (fps/blur) and threshold."""
import json
import statistics as st
import sys
from collections import defaultdict

R = json.load(open(sys.argv[1]))
g = defaultdict(list)
for r in R:
    g[(r["set"].split("/")[0], r["theta"])].append(r)
for k in sorted(g):
    rs = [r for r in g[k] if r["ok"]]
    if not rs:
        print(k, "0 ok")
        continue
    e = [(r["hShown"] - r["truth"]) * 100 for r in rs]
    ef = [(r["hFlight"] - r["truth"]) * 100 for r in rs]
    do = [r["dOff"] * 1000 for r in rs]
    dn = [r["dOn"] * 1000 for r in rs]
    print(f"{k[0]:16} θ {k[1]:.1f}  {len(rs)}/{len(g[k])}  shown {st.mean(e):+.1f} ± {st.pstdev(e):.1f} worst {max(e, key=abs):+.1f}"
          f" | flight {st.mean(ef):+.1f} ± {st.pstdev(ef):.1f} | takeoff {st.mean(do):+.0f} ± {st.pstdev(do):.0f}, landing {st.mean(dn):+.0f} ± {st.pstdev(dn):.0f} ms")
