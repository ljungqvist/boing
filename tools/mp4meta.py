"""Read the capture frame rate that Android writes into MP4 metadata.

Slow-motion recordings are stored at a playback rate (e.g. 30 fps) but captured
faster (e.g. 120 or 240 fps); `com.android.capture.fps` holds the capture rate.
"""
import struct


def _boxes(b, off, end):
    while off + 8 <= end:
        size, typ = struct.unpack(">I4s", b[off:off + 8])
        hdr = 8
        if size == 1:
            size = struct.unpack(">Q", b[off + 8:off + 16])[0]
            hdr = 16
        elif size == 0:
            size = end - off
        if size < hdr:
            return
        yield typ, off + hdr, off + size
        off += size


def _find(b, off, end, path):
    """Return (start, end) of the payload at a box path like [b"moov", b"meta"]."""
    for typ, ds, e in _boxes(b, off, end):
        if typ == path[0]:
            return (ds, e) if len(path) == 1 else _find(b, ds, e, path[1:])
    return None


def mdta_metadata(path):
    """Key/value pairs from the moov/meta (mdta) box; empty if absent."""
    with open(path, "rb") as f:
        b = f.read()
    # Android writes moov/meta; ffmpeg (-movflags use_metadata_tags) writes moov/udta/meta.
    meta = _find(b, 0, len(b), [b"moov", b"meta"]) or _find(b, 0, len(b), [b"moov", b"udta", b"meta"])
    if not meta:
        return {}
    ds, e = meta
    if b[ds + 4:ds + 8] != b"hdlr":  # full-box variant with version/flags
        ds += 4
    keys, values = [], {}
    for typ, s, end in _boxes(b, ds, e):
        if typ == b"keys":
            n = struct.unpack(">I", b[s + 4:s + 8])[0]
            o = s + 8
            for _ in range(n):
                sz = struct.unpack(">I", b[o:o + 4])[0]
                keys.append(b[o + 8:o + sz].decode("utf-8", "replace"))
                o += sz
        elif typ == b"ilst":
            for item, s2, e2 in _boxes(b, s, end):
                idx = struct.unpack(">I", item)[0]
                for t3, d3, e3 in _boxes(b, s2, e2):
                    if t3 != b"data" or not 0 < idx <= len(keys):
                        continue
                    code = struct.unpack(">I", b[d3:d3 + 4])[0] & 0xFFFFFF
                    raw = b[d3 + 8:e3]
                    if code == 23 and len(raw) == 4:
                        val = struct.unpack(">f", raw)[0]
                    elif code in (21, 22, 67):
                        val = int.from_bytes(raw, "big")
                    else:
                        val = raw.decode("utf-8", "replace")
                    values[keys[idx - 1]] = val
    return values


def capture_fps(path):
    """Capture frame rate from Android metadata, or None."""
    v = mdta_metadata(path).get("com.android.capture.fps")
    if isinstance(v, str):  # ffmpeg writes it back as text
        try:
            v = float(v)
        except ValueError:
            return None
    return float(v) if isinstance(v, (int, float)) and v > 0 else None
