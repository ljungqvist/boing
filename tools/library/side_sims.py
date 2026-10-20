"""Side view through the native re-measurement: the 2026-10-19 side clips (240 fps) thinned to 30 and 60 fps
at every phase, sharp and with motion blur, heavy model (tools/review/simulate_native.py).

Writes library/pose/2026-10-19/side/<jump id>/b<blur>/heavy_e<every>_p<phase>.json; the window is the
native one (takeoff − 1.1 s to landing + 0.9 s, clip real time = frame / 240).
Usage: side_sims.py [jobs]   (runs `jobs` simulations in parallel, default 3; skips finished ones)
"""
import json
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

import cv2

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
LIB = os.environ.get("BOING_LIBRARY") or os.path.expanduser("~/code/boing-data/library")
PY = next(p for p in (os.path.join(REPO, ".venv/bin/python"), os.path.expanduser("~/code/boing/.venv/bin/python")) if os.path.exists(p))
MODELS = os.path.expanduser("~/code/boing-data/models")
jobs = int(sys.argv[1]) if len(sys.argv) > 1 else 3

lib = json.load(open(os.path.join(LIB, "jumps.json")))
tasks = []
for j in lib["jumps"]:
    side = next((c for c in j["clips"] if c["role"] == "side-240"), None)
    if not side:
        continue
    clip = os.path.join(LIB, side["file"])
    fps = cv2.VideoCapture(clip).get(cv2.CAP_PROP_FPS)
    scale = fps / side["captureFps"]
    t = j["truth"]
    for blur in (1, 4, 8):
        out = os.path.join(LIB, f"pose/2026-10-19/side/{j['id']}/b{blur}")
        if os.path.exists(os.path.join(out, "heavy_e4_p3.json")):
            continue
        os.makedirs(out, exist_ok=True)
        win = os.path.join(out, "windows.json")
        json.dump([[t["takeoffT"] - 1.1, t["landingT"] + 0.9]], open(win, "w"))
        tasks.append([PY, "-I", os.path.join(REPO, "tools/review/simulate_native.py"), clip, f"{scale:.8f}", out, win,
                      "heavy", "8:all,4:all", str(blur)])


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True, env={**os.environ, "BOING_MODELS": MODELS})
    print(("ok   " if r.returncode == 0 else "FAIL ") + cmd[6], r.stderr[-300:] if r.returncode else "", flush=True)


print(len(tasks), "simulations", flush=True)
with ThreadPoolExecutor(jobs) as ex:
    list(ex.map(run, tasks))
