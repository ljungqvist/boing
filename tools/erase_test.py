"""Tests for tools/erase.py. Run: python3 -I tools/erase_test.py"""
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from erase import erase  # noqa: E402

P, Q = "0123456789ab", "ba9876543210"


def touch(root, rel, text="x"):
    path = os.path.join(root, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(text)


def jump(jid, phone=None):
    j = {"id": jid, "clips": [{"file": f"clips/d/{jid}.mp4"}], "pose": [{"file": f"pose/d/{jid}.json"}]}
    if phone:
        j["phone"] = phone
    return j


class EraseTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        d = self.d = self.tmp.name
        for phone in (P, Q):
            touch(d, f"inbox/2026-10-24_101500_{phone}/session.json")
            touch(d, f"uploads/2026-10-24_101500_{phone}/clip.mp4")
            touch(d, f"review/triage/2026-10-24_101500_{phone}/frame-1.png")
            touch(d, f"library/sources/2026-10-24_101500_{phone}.json", json.dumps({"phone": phone}))
            for jid in (f"u-{phone}-1",):
                touch(d, f"library/clips/d/{jid}.mp4")
                touch(d, f"library/clips/d/{jid}.mp4.cut.json")
                touch(d, f"library/pose/d/{jid}.json")
        touch(d, "uploads/2026-10-19_233836/clip.mp4")  # own session without an ID
        touch(d, "library/jumps.json", json.dumps({"version": 1, "jumps": [jump("own-1"), jump(f"u-{P}-1", P), jump(f"u-{Q}-1", Q)]}))
        touch(d, "library/clips/d/own-1.mp4")

    def tearDown(self):
        self.tmp.cleanup()

    def exists(self, rel):
        return os.path.exists(os.path.join(self.d, rel))

    def test_removes_only_that_phone(self):
        removed = erase(self.d, P)
        for rel in (f"inbox/2026-10-24_101500_{P}", f"uploads/2026-10-24_101500_{P}",
                    f"review/triage/2026-10-24_101500_{P}", f"library/sources/2026-10-24_101500_{P}.json",
                    f"library/clips/d/u-{P}-1.mp4", f"library/clips/d/u-{P}-1.mp4.cut.json", f"library/pose/d/u-{P}-1.json"):
            self.assertFalse(self.exists(rel), rel)
            self.assertIn(rel, removed)
        for rel in (f"inbox/2026-10-24_101500_{Q}", f"uploads/2026-10-24_101500_{Q}", f"library/sources/2026-10-24_101500_{Q}.json",
                    f"library/clips/d/u-{Q}-1.mp4", "uploads/2026-10-19_233836/clip.mp4", "library/clips/d/own-1.mp4"):
            self.assertTrue(self.exists(rel), rel)
        ids = [j["id"] for j in json.load(open(os.path.join(self.d, "library/jumps.json")))["jumps"]]
        self.assertEqual(ids, ["own-1", f"u-{Q}-1"])

    def test_logs_and_is_idempotent(self):
        erase(self.d, P)
        self.assertEqual(erase(self.d, P), [])
        lines = [json.loads(x) for x in open(os.path.join(self.d, "erase-log.jsonl"))]
        self.assertEqual([x["phone"] for x in lines], [P, P])
        self.assertTrue(lines[0]["deleted"])
        self.assertEqual(lines[1]["deleted"], [])

    def test_rejects_bad_ids(self):
        for bad in ("", "abc", "*", "../x", "0123456789AB"):
            with self.assertRaises(ValueError):
                erase(self.d, bad)


if __name__ == "__main__":
    unittest.main()
