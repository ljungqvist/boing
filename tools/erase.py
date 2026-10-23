"""Deletes everything a phone sent, after its owner withdrew consent and asked for deletion (GDPR).

Usage: python3 -I tools/erase.py [--data ~/boing-data] <recording ID>

The recording ID is the phone's 12 hex character ID (mobile/src/logic/consent.ts); upload folders are
named <session>_<ID>. Removes from boing-data:
  inbox/*_<ID>, uploads/*_<ID>          the sessions as fetched from Kapsi
  review/**/*_<ID>*                     triage's working files for those sessions
  library/sources/*.json with phone=ID  the library's sources
  library jumps with phone=ID           their entries in jumps.json, clips (and .cut.json) and poses
and appends what it removed to erase-log.jsonl. No rebuild needed: jumps.json is edited in place.
Run by tools/gwb/poll.sh for every request in Kapsi's erase-requests.jsonl.
"""
import argparse
import datetime
import glob
import json
import os
import re
import shutil
import sys


def _remove(path, data, out):
    if os.path.isdir(path) and not os.path.islink(path):
        shutil.rmtree(path)
    elif os.path.lexists(path):
        os.remove(path)
    else:
        return
    out.append(os.path.relpath(path, data))


def erase(data, phone):
    """Deletes the phone's data under `data`; returns the removed paths, relative to `data`."""
    if not re.fullmatch(r"[0-9a-f]{12}", phone):
        raise ValueError(f"not a recording ID: {phone!r}")
    out = []
    for d in ("inbox", "uploads"):
        for p in sorted(glob.glob(os.path.join(data, d, f"*_{phone}"))):
            _remove(p, data, out)
    for p in sorted(glob.glob(os.path.join(data, "review", "**", f"*_{phone}*"), recursive=True), key=len):
        _remove(p, data, out)

    lib = os.path.join(data, "library")
    for p in sorted(glob.glob(os.path.join(lib, "sources", "*.json"))):
        try:
            mine = json.load(open(p)).get("phone") == phone
        except (OSError, ValueError):
            mine = False
        if mine:
            _remove(p, data, out)

    jumps_file = os.path.join(lib, "jumps.json")
    if os.path.exists(jumps_file):
        lib_json = json.load(open(jumps_file))
        keep = []
        for j in lib_json.get("jumps", []):
            if j.get("phone") != phone:
                keep.append(j)
                continue
            for f in [c["file"] for c in j.get("clips", [])] + [p["file"] for p in j.get("pose", [])]:
                _remove(os.path.join(lib, f), data, out)
                _remove(os.path.join(lib, f + ".cut.json"), data, out)
            out.append(f"library/jumps.json#{j['id']}")
        if len(keep) != len(lib_json.get("jumps", [])):
            lib_json["jumps"] = keep
            tmp = jumps_file + ".tmp"
            with open(tmp, "w") as f:
                json.dump(lib_json, f, indent=1, ensure_ascii=False)
            os.replace(tmp, jumps_file)

    with open(os.path.join(data, "erase-log.jsonl"), "a") as f:
        at = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        f.write(json.dumps({"phone": phone, "at": at, "deleted": out}) + "\n")
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=os.path.expanduser("~/boing-data"))
    ap.add_argument("phone")
    a = ap.parse_args()
    try:
        removed = erase(os.path.abspath(a.data), a.phone)
    except ValueError as e:
        sys.exit(str(e))
    print(f"{a.phone}: removed {len(removed)}")
    for p in removed:
        print(f"  {p}")
