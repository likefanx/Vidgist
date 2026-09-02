"""Focused tests for the public local-bridge input boundary."""
from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("vidgist_native_host.py")
SPEC = importlib.util.spec_from_file_location("vidgist_native_host", MODULE_PATH)
bridge = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(bridge)


class VideoUrlValidationTests(unittest.TestCase):
    def test_accepts_supported_video_urls_and_preserves_order(self) -> None:
        values = [
            "https://www.bilibili.com/video/BV1abcD12345/?p=2",
            "https://www.youtube.com/watch?v=abcdefghijk",
            "https://youtu.be/abcdefghijk?t=20",
        ]
        self.assertEqual(bridge.valid_video_urls(values), values)

    def test_rejects_non_video_and_deduplicates(self) -> None:
        valid = "https://www.bilibili.com/video/BV1abcD12345/"
        self.assertEqual(
            bridge.valid_video_urls(["https://www.bilibili.com/", "https://www.youtube.com/@channel", valid, valid, "not-a-url"]),
            [valid],
        )

    def test_rejects_non_list_payloads(self) -> None:
        self.assertEqual(bridge.valid_video_urls("https://www.youtube.com/watch?v=abcdefghijk"), [])


if __name__ == "__main__":
    unittest.main()
