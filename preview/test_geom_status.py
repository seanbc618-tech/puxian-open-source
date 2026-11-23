"""Public status must not leak another user's job, and a missing tempo is not ♩=96."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

PREVIEW = Path(__file__).resolve().parent
sys.path.insert(0, str(PREVIEW))

from events_to_score import events_to_score  # noqa: E402
from page_refusal import JIANPU, NOT_STAFF, refusal_for_dark  # noqa: E402
from tempo_from_dets import infer_tempo  # noqa: E402
import geom_omr_server as server  # noqa: E402


class GeomUserError(Exception):
    status = 422


class TempoTests(unittest.TestCase):
    def test_unmarked_page_does_not_invent_96(self):
        score = events_to_score([{"pitch": 60, "start": 0, "dur": 1}])
        self.assertFalse(score["tempoMarked"])
        self.assertNotEqual(score["bpm"], 96)

    def test_explicit_tempo_stays_written(self):
        score = events_to_score([{"pitch": 60, "start": 0, "dur": 1}], bpm=72)
        self.assertTrue(score["tempoMarked"])
        self.assertEqual(score["bpm"], 72)

    def test_printed_tempo_class_is_kept(self):
        dets = [
            {"cls": "clef_G2"},
            {"cls": "meterSig_4_4"},
            {"cls": "note_quarter", "text": "120"},
            {"cls": "tempo_120"},
        ]
        self.assertEqual(infer_tempo(dets), 120)
        score = events_to_score([{"pitch": 60, "start": 0, "dur": 1}], bpm=infer_tempo(dets))
        self.assertTrue(score["tempoMarked"])
        self.assertEqual(score["bpm"], 120)

    def test_printed_mark_text_is_kept_and_note_numbers_are_not(self):
        self.assertEqual(
            infer_tempo([{"cls": "tempo", "text": "♩ = 120"}]),
            120,
        )
        self.assertIsNone(infer_tempo([
            {"cls": "clef_G2"},
            {"cls": "meterSig_4_4"},
            {"cls": "note_quarter", "text": "♩=120"},
            {"cls": "measure", "attrs": {"bpm": 96}},
        ]))

    def test_low_confidence_tempo_is_not_trusted(self):
        self.assertIsNone(infer_tempo([{"cls": "tempo_120", "conf": 0.2}]))
        self.assertEqual(infer_tempo([{"cls": "tempo_120", "conf": 0.9}]), 120)

    def test_disagreeing_or_missing_tempo_stays_unset(self):
        self.assertIsNone(infer_tempo([{"cls": "tempo_120"}, {"cls": "metronome_96"}]))
        self.assertIsNone(infer_tempo([{"cls": "tempo"}]))
        self.assertIsNone(infer_tempo([]))
        score = events_to_score(
            [{"pitch": 60, "start": 0, "dur": 1}],
            bpm=infer_tempo([{"cls": "note_quarter"}, {"cls": "meterSig_4_4"}]),
        )
        self.assertFalse(score["tempoMarked"])
        self.assertNotEqual(score["bpm"], 96)


class StatusTests(unittest.TestCase):
    def setUp(self):
        self._saved = dict(server._state)
        server._state["job"] = {
            "id": "job-other",
            "token": "owner-token-value",
            "stage": "正在以 1184 像素重跑检测…",
            "started": server._now(),
            "elapsed": 3,
            "error": None,
        }

    def tearDown(self):
        server._state.clear()
        server._state.update(self._saved)

    def test_anonymous_status_has_no_job(self):
        payload = server._public_job(server._state["job"], None)
        self.assertIsNone(payload)
        visible = server._public_job(server._state["job"], "someone-elses-token")
        self.assertIsNone(visible)

    def test_owner_token_sees_only_their_stage(self):
        payload = server._public_job(server._state["job"], "owner-token-value")
        self.assertEqual(payload["id"], "job-other")
        self.assertIn("1184", payload["stage"])
        self.assertNotIn("token", payload)


def _blank(h, w):
    return [[False] * w for _ in range(h)]


class PageRefusalTests(unittest.TestCase):
    def test_numbered_underlines_lead_with_jianpu(self):
        dark = _blank(40, 80)
        for y in (4, 10, 16, 22, 28, 34):
            for x in range(8, 70, 10):
                for dx in range(6):
                    dark[y][x + dx] = True
        text = refusal_for_dark(dark)
        self.assertTrue(text.startswith("暂不支持简谱"))
        self.assertEqual(text, JIANPU)
        self.assertNotIn("谱表定位失败", text)
        self.assertNotIn("无法组成钢琴系统", text)

    def test_tall_bars_are_not_called_jianpu(self):
        dark = _blank(40, 80)
        for x in (8, 18, 28, 38, 48, 58):
            for dx in range(3):
                for y in range(8, 36):
                    dark[y][x + dx] = True
        text = refusal_for_dark(dark)
        self.assertTrue(text.startswith("这不像五线谱"))
        self.assertEqual(text, NOT_STAFF)
        self.assertNotIn("简谱", text)
        self.assertNotIn("识谱失败", text)


class UserErrorTests(unittest.TestCase):
    def test_missing_staff_is_chinese_4xx_not_a_traceback(self):
        exc = GeomUserError("暂只支持端正清晰的印刷体五线谱。手写谱和简谱暂不能识别。")
        body = server._user_facing(exc)
        self.assertIsNotNone(body)
        code, message = body
        self.assertEqual(code, 422)
        self.assertIn("暂只支持端正清晰的印刷体五线谱", message)
        self.assertNotIn("RuntimeError", message)
        self.assertNotIn("Traceback", message)
        self.assertIsNone(server._user_facing(RuntimeError("could not find 5 staff lines")))


if __name__ == "__main__":
    unittest.main()
