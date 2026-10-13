"""Convert a video to .y4m, the format Chrome's fake camera reads.

Usage: .venv/bin/python -I tools/make_y4m.py in.mp4 out.y4m [--width 640] [--seconds N]
"""
import argparse

import cv2


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--width", type=int, default=640)
    ap.add_argument("--seconds", type=float, default=0)
    args = ap.parse_args()

    cap = cv2.VideoCapture(args.src)
    fps = cap.get(cv2.CAP_PROP_FPS)
    w0, h0 = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    w = args.width // 2 * 2
    h = int(h0 * w / w0) // 2 * 2
    num, den = round(fps * 1000), 1000
    with open(args.dst, "wb") as out:
        out.write(f"YUV4MPEG2 W{w} H{h} F{num}:{den} Ip A1:1 C420jpeg\n".encode())
        n = 0
        while True:
            ok, bgr = cap.read()
            if not ok or (args.seconds and n >= args.seconds * fps):
                break
            yuv = cv2.cvtColor(cv2.resize(bgr, (w, h), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2YUV_I420)
            out.write(b"FRAME\n")
            out.write(yuv.tobytes())
            n += 1
    print(f"{n} frames, {w}x{h}, {fps:.2f} fps -> {args.dst}")


if __name__ == "__main__":
    main()
