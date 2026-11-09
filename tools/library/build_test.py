"""Library source tests. Run: .venv/bin/python -I tools/library/build_test.py"""
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build import Builder  # noqa: E402


class ReviewedSourcesTest(unittest.TestCase):
    def test_reviewed_reference_survives_source_reload_without_becoming_flight_truth(self):
        with tempfile.TemporaryDirectory() as data:
            sources = os.path.join(data, "library", "sources")
            os.makedirs(sources)
            entry = {"id": "demo-1", "clips": [], "tags": ["manual-apex-estimate"],
                     "reference": {"method": "manual takeoff-to-apex", "metric": "takeoff-to-apex",
                                   "valueCm": 31.5, "approxTakeoffT": 1.5625,
                                   "rangeCm": [24, 40]}}
            with open(os.path.join(sources, "demo.json"), "w") as f:
                json.dump({"kind": "reviewed", "jumps": [entry]}, f)
            for _ in range(2):
                builder = Builder(data, False)
                builder.sources()
                self.assertEqual(len(builder.jumps), 1)
                self.assertEqual(builder.jumps[0]["reference"]["valueCm"], 31.5)
                self.assertEqual(builder.jumps[0]["reference"]["metric"], "takeoff-to-apex")
                self.assertNotIn("truth", builder.jumps[0])

    def test_reviewed_source_cannot_duplicate_an_existing_jump(self):
        with tempfile.TemporaryDirectory() as data:
            sources = os.path.join(data, "library", "sources")
            os.makedirs(sources)
            with open(os.path.join(sources, "demo.json"), "w") as f:
                json.dump({"kind": "reviewed", "jumps": [{"id": "existing"}]}, f)
            builder = Builder(data, False)
            builder.jumps = [{"id": "existing"}]
            with self.assertRaisesRegex(ValueError, "duplicate jump id: existing"):
                builder.sources()

    def test_later_upload_cannot_duplicate_a_reviewed_jump(self):
        with tempfile.TemporaryDirectory() as data:
            sources = os.path.join(data, "library", "sources")
            upload = os.path.join(data, "uploads", "session")
            os.makedirs(sources)
            os.makedirs(upload)
            # A missing original clip legitimately keeps its previous library entry.
            with open(os.path.join(data, "library", "jumps.json"), "w") as f:
                json.dump({"jumps": [{"id": "demo-1", "clips": []}]}, f)
            with open(os.path.join(upload, "session.json"), "w") as f:
                json.dump({"logs": [{"clip": "gone.mp4", "tOff": 1}]}, f)
            with open(os.path.join(sources, "a-reviewed.json"), "w") as f:
                json.dump({"kind": "reviewed", "jumps": [{"id": "demo-1"}]}, f)
            with open(os.path.join(sources, "z-upload.json"), "w") as f:
                json.dump({"upload": "uploads/session", "id": "demo-", "date": "2026-11-09",
                           "marks": {"gone.mp4": [10, 20]}}, f)
            with self.assertRaisesRegex(ValueError, "duplicate jump id: demo-1"):
                Builder(data, False).sources()


if __name__ == "__main__":
    unittest.main()
