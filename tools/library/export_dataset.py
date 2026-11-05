"""Writes ~/boing-data/dataset.json: a manifest of every kept clip with what we know about it.

For training / evaluating a new model. It only lists files (paths relative to boing-data), it copies
nothing, so erasing a recording ID stays complete. Sessions are left out when their recording ID is in
erase-log.jsonl or their decisions file's `expires` date (session date + 2 years, the consent's limit)
has passed. Clips of sessions without a decisions file are listed with verdict "undecided".

Usage: python3 -I tools/library/export_dataset.py [--data ~/boing-data] [--today YYYY-MM-DD]
"""
import argparse
import datetime
import glob
import json
import os


def export(data, today):
    erased = set()
    try:
        erased = {json.loads(x)["phone"] for x in open(os.path.join(data, "erase-log.jsonl")) if x.strip()}
    except OSError:
        pass
    library = {}
    try:
        for j in json.load(open(os.path.join(data, "library/jumps.json")))["jumps"]:
            for c in j.get("clips", []):
                library[os.path.basename(c.get("source", ""))] = j["id"]
    except OSError:
        pass
    clips, skipped = [], []
    for up in sorted(glob.glob(os.path.join(data, "uploads", "[0-9]*_*"))):
        session = os.path.basename(up)
        tail = session.rsplit("_", 1)[1]
        phone = tail if len(tail) == 12 and all(c in "0123456789abcdef" for c in tail) else None  # old sessions have none
        if phone in erased:
            skipped.append({"session": session, "why": "erased"})
            continue
        try:
            sess = json.load(open(os.path.join(up, "session.json")))
        except (OSError, ValueError):
            sess = {}
        try:
            dec = json.load(open(os.path.join(data, "decisions", session + ".json")))
        except (OSError, ValueError):
            dec = {}
        date = session[:10]
        expires = dec.get("expires") or f"{int(date[:4]) + 2}{date[4:]}"
        if expires < today:
            skipped.append({"session": session, "why": f"expired {expires}"})
            continue
        logs = {l.get("clip"): l for l in sess.get("logs", [])}
        for f in sorted(os.listdir(up)):
            if not f.endswith(".mp4"):
                continue
            d = dec.get("clips", {}).get(f, {})
            clips.append({"session": session, "phone": phone, "date": date, "expires": expires, "file": f"uploads/{session}/{f}",
                          "device": sess.get("device"), "camera": sess.get("camera"), "fps": sess.get("camera frame rate"),
                          "verdict": d.get("verdict", "undecided"), "tags": d.get("tags", []), "eyeCm": d.get("eyeCm"),
                          "marks": d.get("marks"), "app": d.get("app"), "appLog": logs.get(f),
                          "libraryId": library.get(f)})
    return {"generated": today, "clips": clips, "skipped": skipped}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=os.path.expanduser("~/boing-data"))
    ap.add_argument("--today", default=datetime.date.today().isoformat())
    a = ap.parse_args()
    out = export(os.path.abspath(a.data), a.today)
    with open(os.path.join(a.data, "dataset.json"), "w") as f:
        json.dump(out, f, indent=1, ensure_ascii=False)
    print(f"{len(out['clips'])} clips, {len(out['skipped'])} sessions left out")
