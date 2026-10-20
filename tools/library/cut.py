"""Cut a stretch of a video without re-encoding (every original frame kept) and check it.

The cut starts at the keyframe at or before `first` (stream copy can only start on a keyframe), so
the clip may begin a few frames early. Metadata is dropped (no GPS location); the capture frame rate
of slow-motion files is written back. Returns the original frame index of the clip's frame 0, found by
comparing decoded frames, so frame numbers in the clip map exactly onto the original.

Usage as a script: cut.py <src> <first_frame> <last_frame> <out.mp4>
"""
import json
import subprocess
import sys

import cv2
import numpy as np


def frame_pts(src):
    """Presentation times (s) of all video frames, in display order."""
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time,flags",
                          "-of", "csv=p=0", src], capture_output=True, text=True, check=True).stdout
    rows = [line.split(",") for line in out.split()]
    pts = sorted((float(p), "K" in f) for p, f in rows)
    return [p for p, _ in pts], [k for _, k in pts]


def capture_fps(src):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format_tags=com.android.capture.fps", "-of", "json", src],
                         capture_output=True, text=True, check=True).stdout
    v = json.loads(out).get("format", {}).get("tags", {}).get("com.android.capture.fps")
    return float(v) if v else None


def _read(cap, k):
    cap.set(cv2.CAP_PROP_POS_FRAMES, k)
    ok, bgr = cap.read()
    return bgr if ok else None


def cut(src, first, last, out):
    pts, key = frame_pts(src)
    kf = max(i for i in range(first + 1) if key[i])
    n = last - kf + 1
    cfps = capture_fps(src)
    cmd = ["ffmpeg", "-v", "error", "-y", "-ss", f"{pts[kf]:.6f}", "-i", src, "-map", "0:v:0", "-frames:v", str(n),
           "-c", "copy", "-map_metadata", "-1", "-movflags", "+use_metadata_tags"]
    if cfps:
        cmd += ["-metadata", f"com.android.capture.fps={cfps:.6f}"]
    if subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name", "-of",
                       "csv=p=0", src], capture_output=True, text=True).stdout.strip() == "hevc":
        cmd += ["-tag:v", "hvc1"]
    subprocess.run(cmd + [out], check=True)

    # Which original frame is the clip's frame 0? Compare decoded frames (lossless copy: identical pixels).
    a, b = cv2.VideoCapture(src), cv2.VideoCapture(out)
    f0 = _read(b, 0)
    offset = None
    for k in range(max(0, kf - 3), kf + 4):
        g = _read(a, k)
        if g is not None and np.array_equal(g, f0):
            offset = k
            break
    if offset is None:
        raise RuntimeError(f"{out}: first frame matches no original frame near {kf}")
    m = int(b.get(cv2.CAP_PROP_FRAME_COUNT))
    # Spot checks across the clip, incl. the requested range's ends.
    for i in sorted({0, first - offset, (m - 1) // 2, last - offset, m - 1}):
        if not 0 <= i < m:
            continue
        if not np.array_equal(_read(a, offset + i), _read(b, i)):
            raise RuntimeError(f"{out}: frame {i} differs from original {offset + i}")
    if offset + m - 1 < last:
        raise RuntimeError(f"{out}: ends at original frame {offset + m - 1}, wanted {last}")
    return {"frameOffset": offset, "frames": m, "captureFps": cfps}


if __name__ == "__main__":
    src, first, last, out = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
    print(json.dumps(cut(src, first, last, out)))
