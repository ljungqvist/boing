"""Coarse pose (every Nth frame) of a side-view video, to find the jumps. Usage: side_coarse.py <video> <model> <out.json> <every>"""
import sys, json, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from extract_pose import extract
video, model, out, every = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
r = extract(video, model, mode="video", every=every)
json.dump(r, open(out, "w"))
print("done", out, len(r["frames"]), r.get("timeScale"))
