"""Tests for reading-order system concatenation in geom_from_dets.

The detector is not invoked. Grouping and stitching are unit-tested, and
page reconstruction uses frozen detection fixtures so a real grand-staff
page still shares time 0 across both hands, and a multi-system single-staff
page is read in order.
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

from PIL import Image

PREVIEW = Path(__file__).resolve().parent
sys.path.insert(0, str(PREVIEW))

from events_to_score import events_to_score, score_to_events  # noqa: E402
from geom_from_dets import (  # noqa: E402
    _apply_written_accidentals,
    _attach_dots,
    _boundary_pitches,
    _complete_dotted_quarter_chords,
    _group_and_time,
    _merge_shared_stem_unisons,
    _propagate_shared_stem_dots,
    _read_shared_quarter_stems,
    _read_shared_stem_flags,
    _staffs_in_clipped_braces,
    align_stacked_sixteenth_rests,
    assign_symbol_to_staff,
    events_for_page,
    find_staff_systems,
    group_staves_into_systems,
    recover_missing_beamed_noteheads,
    stitch_system_events,
    _apply_printed_tuplets,
    _recover_incomplete_tuplet_heads,
)

ROOT = PREVIEW.parent
REF = ROOT / "eval/reference"
FIXTURES = PREVIEW / "testdata"


def _staff(mid, top, bot, spacing, clef):
    return {
        "mid": mid,
        "top": top,
        "bot": bot,
        "spacing": spacing,
        "clef": clef,
        "lines": [top, top + spacing, mid, bot - spacing, bot],
    }


def _ev(pitch, start, dur, clef="G2"):
    return {"pitch": int(pitch), "start": float(start), "dur": float(dur), "clef": clef}


class GroupStavesTests(unittest.TestCase):
    def test_ten_treble_staves_are_ten_systems(self):
        # Geometry taken from xiaoxingxing_treble.png (10 single-staff systems).
        staves = []
        top = 253.0
        h, gap, sp = 61.0, 122.0, 15.25
        for i in range(10):
            t = top + i * (h + gap)
            staves.append(_staff(t + h / 2, t, t + h, sp, "G2"))
        groups = group_staves_into_systems(staves)
        self.assertEqual(len(groups), 10)
        self.assertTrue(all(len(g) == 1 for g in groups))

    def test_close_treble_bass_pair_is_one_grand_staff(self):
        # Geometry taken from c_major_simple.png.
        staves = [
            _staff(121.0, 103.0, 139.0, 9.0, "G2"),
            _staff(211.0, 193.0, 229.0, 9.0, "F4"),
        ]
        groups = group_staves_into_systems(staves)
        self.assertEqual(len(groups), 1)
        self.assertEqual([s["clef"] for s in groups[0]], ["G2", "F4"])

    def test_two_grand_staff_systems_are_paired_then_separated(self):
        staves = [
            _staff(100, 82, 118, 9.0, "G2"),
            _staff(190, 172, 208, 9.0, "F4"),
            _staff(400, 382, 418, 9.0, "G2"),
            _staff(490, 472, 508, 9.0, "F4"),
        ]
        groups = group_staves_into_systems(staves)
        self.assertEqual(len(groups), 2)
        self.assertEqual([s["clef"] for s in groups[0]], ["G2", "F4"])
        self.assertEqual([s["clef"] for s in groups[1]], ["G2", "F4"])

    def test_two_close_treble_staves_are_not_forced_into_piano(self):
        staves = [
            _staff(100, 70, 130, 15.0, "G2"),
            _staff(250, 220, 280, 15.0, "G2"),
        ]
        groups = group_staves_into_systems(staves)
        self.assertEqual(len(groups), 2)


class StitchTests(unittest.TestCase):
    def test_successive_one_bar_systems_start_four_beats_apart(self):
        # Bar 1 of xiaoxingxing, then a second system of eighths.
        s1 = [
            _ev(61, 0.0, 0.5), _ev(63, 0.5, 0.5),
            _ev(61, 1.0, 0.5), _ev(63, 1.5, 0.5),
            _ev(68, 2.0, 0.5), _ev(70, 2.5, 0.5),
            _ev(68, 3.0, 0.5), _ev(70, 3.5, 0.5),
        ]
        s2 = [_ev(65, 0.0, 0.5), _ev(68, 0.5, 0.5)]
        out = stitch_system_events([s1, s2])
        self.assertEqual(out[0]["start"], 0.0)
        self.assertEqual(out[7]["start"], 3.5)
        self.assertEqual([(e["pitch"], e["start"]) for e in out[8:]], [(65, 4.0), (68, 4.5)])

    def test_missed_trailing_rest_still_advances_to_next_barline(self):
        s1 = [_ev(60, 0.0, 1.0), _ev(62, 1.0, 1.0), _ev(64, 2.0, 1.0)]  # ends 3.0
        s2 = [_ev(67, 0.0, 1.0)]
        out = stitch_system_events([s1, s2])
        self.assertEqual(out[-1]["pitch"], 67)
        self.assertEqual(out[-1]["start"], 4.0)

    def test_grand_staff_pair_keeps_shared_onset(self):
        # One system already timed together, then a second system.
        sys1 = [_ev(60, 0.0, 4.0, "G2"), _ev(48, 0.0, 4.0, "F4")]
        sys2 = [_ev(64, 0.0, 2.0, "G2"), _ev(52, 0.0, 2.0, "F4")]
        out = stitch_system_events([sys1, sys2])
        first = [(e["pitch"], e["start"], e["clef"]) for e in out if e["start"] == 0.0]
        second = [(e["pitch"], e["start"], e["clef"]) for e in out if e["start"] == 4.0]
        self.assertEqual(sorted(first), [(48, 0.0, "F4"), (60, 0.0, "G2")])
        self.assertEqual(sorted(second), [(52, 4.0, "F4"), (64, 4.0, "G2")])


class CMajorFixtureTests(unittest.TestCase):
    def test_grand_staff_page_still_shares_time_and_keeps_13_events(self):
        img = REF / "c_major_simple.png"
        dets = FIXTURES / "c_major_simple.dets_v7_768.json"
        self.assertTrue(img.is_file(), img)
        self.assertTrue(dets.is_file(), dets)
        evs = events_for_page(img, dets, key=None)
        slim = [{"pitch": e["pitch"], "start": e["start"], "dur": e["dur"]} for e in evs]
        expected = [
            {"pitch": 48, "start": 0.0, "dur": 4.0},
            {"pitch": 60, "start": 0.0, "dur": 4.0},
            {"pitch": 52, "start": 4.0, "dur": 2.0},
            {"pitch": 64, "start": 4.0, "dur": 2.0},
            {"pitch": 55, "start": 6.0, "dur": 2.0},
            {"pitch": 67, "start": 6.0, "dur": 2.0},
            {"pitch": 48, "start": 8.0, "dur": 4.0},
            {"pitch": 60, "start": 8.0, "dur": 1.0},
            {"pitch": 64, "start": 9.0, "dur": 1.0},
            {"pitch": 67, "start": 10.0, "dur": 1.0},
            {"pitch": 72, "start": 11.0, "dur": 1.0},
            {"pitch": 36, "start": 12.0, "dur": 4.0},
            {"pitch": 72, "start": 12.0, "dur": 4.0},
        ]
        self.assertEqual(slim, expected)
        bass = [e for e in evs if e.get("clef") in ("F4", "F", "bass")]
        treble = [e for e in evs if e.get("clef") not in ("F4", "F", "bass")]
        self.assertEqual(len(bass), 5)
        self.assertEqual(len(treble), 8)
        # Hands at t=0 still overlap; they must not be concatenated.
        self.assertTrue(any(e["pitch"] == 48 and e["start"] == 0.0 for e in bass))
        self.assertTrue(any(e["pitch"] == 60 and e["start"] == 0.0 for e in treble))
        score = events_to_score(evs, title="c_major", key="C")
        self.assertEqual(score.get("staffInstrument"), "piano")
        self.assertTrue(score.get("voice2"))
        self.assertEqual(len(score["measureEnds"]), 4)
        back = [{"pitch": e["pitch"], "start": e["start"], "dur": e["dur"]} for e in score_to_events(score)]
        self.assertEqual(back, expected)

    def test_find_staff_systems_counts(self):
        xx = Image.open(REF / "xiaoxingxing_treble.png")
        staves = find_staff_systems(xx, 0, xx.width)
        self.assertEqual(len(staves), 10)
        for s in staves:
            s["clef"] = "G2"
        self.assertEqual(len(group_staves_into_systems(staves)), 10)

        cm = Image.open(REF / "c_major_simple.png")
        staves2 = find_staff_systems(cm, 0, cm.width)
        self.assertEqual(len(staves2), 2)
        staves2[0]["clef"] = "G2"
        staves2[1]["clef"] = "F4"
        groups = group_staves_into_systems(staves2)
        self.assertEqual(len(groups), 1)
        self.assertEqual(len(groups[0]), 2)


class XiaoxingxingFixtureTests(unittest.TestCase):
    """Full-page single-staff systems, reconstructed from a frozen detection fixture.

    Visual check of xiaoxingxing_treble.png (10 systems, 12 measures because
    systems 2 and 8 contain two bars): beginning, a middle system, and the end.
    """

    @classmethod
    def setUpClass(cls):
        img = REF / "xiaoxingxing_treble.png"
        dets = FIXTURES / "xiaoxingxing_treble.dets_v7_1376.json"
        if not img.is_file() or not dets.is_file():
            raise unittest.SkipTest("xiaoxingxing fixture missing")
        cls.evs = events_for_page(img, dets, key=None)
        cls.score = events_to_score(cls.evs, title="xiaoxingxing", key="Db")

    def _bar(self, start):
        return [
            {"pitch": e["pitch"], "start": e["start"], "dur": e["dur"]}
            for e in self.evs
            if start - 1e-9 <= e["start"] < start + 4 - 1e-9
        ]

    def test_does_not_stack_systems_or_force_piano(self):
        self.assertGreaterEqual(max(e["start"] for e in self.evs), 44.0)
        self.assertEqual(self.score["measureEnds"], [4.0 * i for i in range(1, 13)])
        self.assertFalse(self.score.get("voice2"))
        self.assertNotEqual(self.score.get("staffInstrument"), "piano")
        self.assertEqual(self.score.get("key"), "Db")
        self.assertEqual(self.score.get("clef"), "treble")

    def test_beginning_matches_frozen_bar1(self):
        # Sean-authorized frozen truth: Db4 Eb4 Db4 Eb4 Ab4 Bb4 Ab4 Bb4
        expected = [
            {"pitch": 61, "start": 0.0, "dur": 0.5},
            {"pitch": 63, "start": 0.5, "dur": 0.5},
            {"pitch": 61, "start": 1.0, "dur": 0.5},
            {"pitch": 63, "start": 1.5, "dur": 0.5},
            {"pitch": 68, "start": 2.0, "dur": 0.5},
            {"pitch": 70, "start": 2.5, "dur": 0.5},
            {"pitch": 68, "start": 3.0, "dur": 0.5},
            {"pitch": 70, "start": 3.5, "dur": 0.5},
        ]
        self.assertEqual(self._bar(0.0), expected)

    def test_middle_system5_matches_image(self):
        # System 5 is measure 6 (system 2 has two bars). Image: F4 Gb4 F4 Gb4
        # Eb4 quarter, Eb4 eighth, F4 eighth.
        expected = [
            {"pitch": 65, "start": 20.0, "dur": 0.5},
            {"pitch": 66, "start": 20.5, "dur": 0.5},
            {"pitch": 65, "start": 21.0, "dur": 0.5},
            {"pitch": 66, "start": 21.5, "dur": 0.5},
            {"pitch": 63, "start": 22.0, "dur": 1.0},
            {"pitch": 63, "start": 23.0, "dur": 0.5},
            {"pitch": 65, "start": 23.5, "dur": 0.5},
        ]
        self.assertEqual(self._bar(20.0), expected)

    def test_ending_system10_matches_image(self):
        # Last system is measure 12. Image: Eb4 F4 Eb4 F4 Db4 quarter,
        # Db4 eighth, Eb4 eighth.
        expected = [
            {"pitch": 63, "start": 44.0, "dur": 0.5},
            {"pitch": 65, "start": 44.5, "dur": 0.5},
            {"pitch": 63, "start": 45.0, "dur": 0.5},
            {"pitch": 65, "start": 45.5, "dur": 0.5},
            {"pitch": 61, "start": 46.0, "dur": 1.0},
            {"pitch": 61, "start": 47.0, "dur": 0.5},
            {"pitch": 63, "start": 47.5, "dur": 0.5},
        ]
        self.assertEqual(self._bar(44.0), expected)



class PolyphonyTimingTests(unittest.TestCase):
    """Two voices on one staff must share time, not sum their durations.

    Typical piano left hand: a 16th rest stacked with a held tenor, then the
    bass after the rest. Timing those symbols one after another doubled each
    system (a 3-bar grand-staff page became 6 bars of bass tail).
    """

    def _item(self, cls, cx, cy, dur, pitch=None, is_rest=False, box=None):
        if box is None:
            box = [cx - 6, cy - 6, cx + 6, cy + 6]
        rec = {"cls": cls, "cx": cx, "cy": cy, "box": box, "dur": dur, "dot": False}
        if is_rest:
            rec["is_rest"] = True
        else:
            rec["pitch"] = int(pitch)
        return rec

    def test_rest_stacked_with_held_note_does_not_delay_the_other_voice(self):
        # rest_16th and half note at nearly the same x, then a dotted eighth.
        items = [
            self._item("rest_16th", 194, 387, 0.25, is_rest=True),
            self._item("note_half", 196, 427, 2.0, pitch=60),
            self._item("note_eighth", 225, 414, 0.75, pitch=52),
        ]
        evs = _group_and_time(items, curves=[], spacing=14.0)
        by_pitch = {e["pitch"]: e for e in evs}
        self.assertEqual(by_pitch[60]["start"], 0.0)
        self.assertEqual(by_pitch[60]["dur"], 2.0)
        self.assertEqual(by_pitch[52]["start"], 0.25)
        self.assertEqual(by_pitch[52]["dur"], 0.75)
        end = max(e["start"] + e["dur"] for e in evs)
        self.assertAlmostEqual(end, 2.0, places=6)

    def test_two_half_measures_of_stacked_voices_fill_one_bar(self):
        # Two of the prelude's half-measure shapes, including a tie.
        items = [
            self._item("rest_16th", 194, 387, 0.25, is_rest=True),
            self._item("note_half", 196, 427, 2.0, pitch=60),
            self._item("note_eighth", 225, 414, 0.75, pitch=52, box=[219, 408, 231, 420]),
            self._item("note_quarter", 302, 414, 1.0, pitch=52, box=[296, 408, 308, 420]),
            self._item("rest_16th", 423, 387, 0.25, is_rest=True),
            self._item("note_half", 425, 427, 2.0, pitch=60),
            self._item("note_eighth", 454, 414, 0.75, pitch=52, box=[448, 408, 460, 420]),
            self._item("note_quarter", 531, 414, 1.0, pitch=52, box=[525, 408, 537, 420]),
        ]
        curves = [
            {"box": [248, 391, 301, 403], "cy": 397, "cx": 275},
            {"box": [477, 391, 530, 403], "cy": 397, "cx": 504},
        ]
        evs = _group_and_time(items, curves=curves, spacing=14.0)
        tenors = [e for e in evs if e["pitch"] == 60]
        basses = [e for e in evs if e["pitch"] == 52]
        self.assertEqual([(e["start"], e["dur"]) for e in tenors], [(0.0, 2.0), (2.0, 2.0)])
        # Bass starts after each 16th rest, not after the sounding tenor.
        # (Tie merging is a separate detector/geometry concern.)
        self.assertTrue(all(e["start"] < 4.0 for e in basses))
        self.assertAlmostEqual(basses[0]["start"], 0.25, places=6)
        self.assertAlmostEqual(basses[len(basses)//2]["start"], 2.25, places=6)
        end = max(e["start"] + e["dur"] for e in evs)
        self.assertAlmostEqual(end, 4.0, places=6)

    def test_lone_rest_still_advances_time(self):
        items = [
            self._item("rest_16th", 100, 300, 0.25, is_rest=True),
            self._item("note_16th", 140, 320, 0.25, pitch=67),
            self._item("note_16th", 180, 300, 0.25, pitch=72),
        ]
        evs = _group_and_time(items, curves=[], spacing=14.0)
        self.assertEqual(
            [(e["pitch"], e["start"], e["dur"]) for e in evs],
            [(67, 0.25, 0.25), (72, 0.50, 0.25)],
        )


    def test_gap_rest_goes_to_bass_even_if_slightly_nearer_the_treble(self):
        # Geometry from Bach p.1 system 2 (measures 4-6): 16th rests sit in
        # the gap, 75px from the treble mid vs 81px from the bass mid.
        treble = _staff(670.0, 642.0, 697.0, 13.75, "G2")
        bass = _staff(826.0, 798.0, 854.0, 14.0, "F4")
        staves = [treble, bass]
        rest_cy = 744.8
        self.assertLess(abs(rest_cy - treble["mid"]), abs(rest_cy - bass["mid"]))
        self.assertIs(assign_symbol_to_staff(rest_cy, True, staves), bass)
        # Notes still follow nearest mid: a low treble 16th stays treble.
        self.assertIs(assign_symbol_to_staff(691.3, False, staves), treble)
        self.assertIs(assign_symbol_to_staff(785.2, False, staves), bass)
        # A rest actually on the treble staff stays treble.
        self.assertIs(assign_symbol_to_staff(671.5, True, staves), treble)




    def test_aligned_eighth_and_sixteenth_rests_use_the_sixteenth(self):
        """Stacked rest: treble 16th classed as eighth, bass correctly 16th.

        Seven sixteenths follow, so an eighth rest would overfill the
        half-bar (0.5 + 1.75 = 2.25). The eighth is a dropped flag.
        First treble note must start on the second 16th pulse, with the tenor.
        """
        treble = _staff(305.0, 277.5, 333.0, 13.88, "G2")
        bass = _staff(468.0, 441.0, 496.0, 13.75, "F4")
        xs = [237.0, 269.9, 302.1, 327.4, 360.0, 393.2, 420.0]
        pitches = [67, 72, 76, 67, 72, 76, 67]
        tr_items = [self._item("rest_eighth", 193.4, 306.5, 0.5, is_rest=True)]
        tr_items.extend(
            self._item("note_16th", x, 300.0, 0.25, pitch=p) for x, p in zip(xs, pitches)
        )
        ba_items = [
            self._item("rest_16th", 193.9, 387.1, 0.25, is_rest=True),
            self._item("note_half", 195.9, 427.4, 2.0, pitch=60),
            self._item("note_eighth", 224.9, 413.7, 0.75, pitch=64),
        ]
        by_staff = {id(treble): tr_items, id(bass): ba_items}
        align_stacked_sixteenth_rests([treble, bass], by_staff)
        self.assertEqual(tr_items[0]["dur"], 0.25)
        self.assertEqual(ba_items[0]["dur"], 0.25)
        tr_evs = _group_and_time(tr_items, curves=[], spacing=14.0)
        ba_evs = _group_and_time(ba_items, curves=[], spacing=14.0)
        self.assertEqual(tr_evs[0]["pitch"], 67)
        self.assertAlmostEqual(tr_evs[0]["start"], 0.25, places=6)
        self.assertAlmostEqual(next(e["start"] for e in ba_evs if e["pitch"] == 64), 0.25, places=6)
        self.assertAlmostEqual(next(e["start"] for e in ba_evs if e["pitch"] == 60), 0.0, places=6)

    def test_stacked_eighth_rest_that_fills_a_half_bar_is_kept(self):
        """A genuine eighth rest may sit in the same column as a 16th rest.

        Six sixteenths follow: eighth + 1.5 = 2.0, so the half-bar is already
        full. Shrinking the rest would leave the measure short and push later
        systems out of place. The first treble note starts on the third 16th.
        """
        treble = _staff(305.0, 277.5, 333.0, 13.88, "G2")
        bass = _staff(468.0, 441.0, 496.0, 13.75, "F4")
        xs = [237.0, 269.9, 302.1, 327.4, 360.0, 393.2]
        pitches = [67, 72, 76, 67, 72, 76]
        tr_items = [self._item("rest_eighth", 193.4, 306.5, 0.5, is_rest=True)]
        tr_items.extend(
            self._item("note_16th", x, 300.0, 0.25, pitch=p) for x, p in zip(xs, pitches)
        )
        ba_items = [
            self._item("rest_16th", 193.9, 387.1, 0.25, is_rest=True),
            self._item("note_half", 195.9, 427.4, 2.0, pitch=60),
            self._item("note_eighth", 224.9, 413.7, 0.75, pitch=64),
        ]
        align_stacked_sixteenth_rests(
            [treble, bass], {id(treble): tr_items, id(bass): ba_items}
        )
        self.assertEqual(tr_items[0]["dur"], 0.5)
        self.assertEqual(ba_items[0]["dur"], 0.25)
        tr_evs = _group_and_time(tr_items, curves=[], spacing=14.0)
        self.assertEqual(tr_evs[0]["pitch"], 67)
        self.assertAlmostEqual(tr_evs[0]["start"], 0.5, places=6)
        self.assertAlmostEqual(tr_evs[-1]["start"] + tr_evs[-1]["dur"], 2.0, places=6)

    def test_genuine_eighth_rest_before_eighths_is_not_shrunk(self):
        """An eighth rest followed by eighths must not be forced to a 16th
        just because the other hand has a 16th rest at a nearby x.
        """
        treble = _staff(305.0, 277.5, 333.0, 13.88, "G2")
        bass = _staff(468.0, 441.0, 496.0, 13.75, "F4")
        tr_items = [
            self._item("rest_eighth", 193.4, 306.5, 0.5, is_rest=True),
            self._item("note_eighth", 237.0, 319.7, 0.5, pitch=67),
            self._item("note_eighth", 269.9, 299.2, 0.5, pitch=72),
        ]
        ba_items = [
            self._item("rest_16th", 193.9, 387.1, 0.25, is_rest=True),
            self._item("note_16th", 224.9, 413.7, 0.25, pitch=64),
        ]
        align_stacked_sixteenth_rests([treble, bass], {id(treble): tr_items, id(bass): ba_items})
        self.assertEqual(tr_items[0]["dur"], 0.5)
        self.assertEqual(ba_items[0]["dur"], 0.25)


class RecoverBeamedNoteheadTests(unittest.TestCase):
    """A mid-beam notehead present in the ink, but missing from detections."""

    def _ellipse_image(self, heads):
        spacing = 14.0
        top, mid, bot = 40.0, 68.0, 96.0
        img = Image.new("L", (220, 150), 255)
        px = img.load()
        for y in (40, 54, 68, 82, 96):
            for x in range(10, 210):
                px[x, y] = 30
        for cx, cy in heads:
            for dy in range(-6, 7):
                for dx in range(-8, 9):
                    if (dx / 8.0) ** 2 + (dy / 6.0) ** 2 <= 1.0:
                        px[int(cx + dx), int(round(cy) + dy)] = 0
        for y in range(110, 118):
            for x in range(36, 168):
                px[x, y] = 0
        return img, spacing, top, mid, bot

    def _note(self, cx, cy, pitch, pos):
        return {
            "cls": "note_16th",
            "box": [cx - 8, cy - 6, cx + 8, cy + 6],
            "cx": float(cx),
            "cy": float(cy),
            "conf": 1.0,
            "pos": pos,
            "pitch": pitch,
            "dur": 0.25,
            "dot": False,
        }

    def test_fills_double_wide_gap_on_a_sixteenth_beam(self):
        spacing = 14.0
        mid = 68.0
        y_e5 = mid - 3 * (spacing / 2.0)
        y_g4 = mid - (-2) * (spacing / 2.0)
        y_c5 = mid - 1 * (spacing / 2.0)
        img, spacing, top, mid, bot = self._ellipse_image(
            [(40, y_e5), (80, y_g4), (120, y_c5), (160, y_e5)]
        )
        staff = _staff(mid, top, bot, spacing, "G2")
        beam = {"cls": "beam", "box": [36, 110, 168, 118], "cx": 102.0, "cy": 114.0, "conf": 1.0}
        items = [
            self._note(40, y_e5, 76, 3),
            self._note(80, y_g4, 67, -2),
            self._note(160, y_e5, 76, 3),
        ]
        recover_missing_beamed_noteheads(img.convert("RGB"), [beam], {id(staff): items}, [staff], "C")
        rec = [n for n in items if n.get("recovered")]
        self.assertEqual(len(rec), 1, items)
        self.assertEqual(rec[0]["dur"], 0.25)
        self.assertEqual(rec[0]["pitch"], 72)
        self.assertAlmostEqual(rec[0]["cx"], 120.0, delta=12)

    def test_complete_beam_is_not_given_an_extra_note(self):
        spacing = 14.0
        mid = 68.0
        y_e5 = mid - 3 * (spacing / 2.0)
        y_g4 = mid - (-2) * (spacing / 2.0)
        y_c5 = mid - 1 * (spacing / 2.0)
        img, spacing, top, mid, bot = self._ellipse_image(
            [(40, y_e5), (80, y_g4), (120, y_c5), (160, y_e5)]
        )
        staff = _staff(mid, top, bot, spacing, "G2")
        beam = {"cls": "beam", "box": [36, 110, 168, 118], "cx": 102.0, "cy": 114.0, "conf": 1.0}
        items = [
            self._note(40, y_e5, 76, 3),
            self._note(80, y_g4, 67, -2),
            self._note(120, y_c5, 72, 1),
            self._note(160, y_e5, 76, 3),
        ]
        recover_missing_beamed_noteheads(img.convert("RGB"), [beam], {id(staff): items}, [staff], "C")
        self.assertFalse(any(n.get("recovered") for n in items))
        self.assertEqual(len(items), 4)



class DottedTieTests(unittest.TestCase):
    def _note(self, cx, box, dur, pitch=60):
        return {
            "cx": cx,
            "cy": 40.0,
            "box": box,
            "dur": dur,
            "pitch": pitch,
        }

    def test_tie_starting_on_augmentation_dot_extends_the_note(self):
        # Dotted quarter (1.5) tied to a quarter should become 2.5, even
        # when the tie curve starts at the dot instead of the first head.
        left = self._note(20, [10, 34, 30, 46], 1.0)
        right = self._note(70, [60, 34, 80, 46], 1.0)
        dots = [{"cx": 38.0, "cy": 40.0, "box": [34, 36, 42, 44]}]
        curves = [{"box": [36, 36, 62, 44], "cy": 40.0, "cx": 49.0}]
        _attach_dots([left, right], dots, spacing=14.0)
        self.assertTrue(left.get("dot"))
        self.assertEqual(left["dur"], 1.5)
        events = _group_and_time([left, right], curves, spacing=14.0)
        self.assertEqual(len(events), 1, events)
        self.assertEqual(events[0]["pitch"], 60)
        self.assertEqual(events[0]["start"], 0.0)
        self.assertEqual(events[0]["dur"], 2.5)

    def test_tie_without_a_dot_still_extends_the_note(self):
        left = self._note(20, [10, 34, 30, 46], 1.0)
        right = self._note(70, [60, 34, 80, 46], 1.0)
        curves = [{"box": [28, 36, 62, 44], "cy": 40.0, "cx": 45.0}]
        events = _group_and_time([left, right], curves, spacing=14.0)
        self.assertEqual(len(events), 1, events)
        self.assertEqual(events[0]["dur"], 2.0)



class PrintedTupletTests(unittest.TestCase):
    """Printed 3-tuplets are a general engraving mark, not a titled example."""

    def setUp(self):
        self.staff = _staff(40, 20, 60, 10, "G2")
        self.staff["lines"] = [20, 30, 40, 50, 60]

    def _eighth(self, cx, cy=40.0, pitch=72):
        return {
            "cls": "note_eighth",
            "cx": cx,
            "cy": cy,
            "box": [cx - 5, cy - 4, cx + 5, cy + 4],
            "dur": 0.5,
            "pitch": pitch,
            "dot": False,
        }

    def _mark(self, cls, cx, cy, w=6, h=6):
        return {
            "cls": cls,
            "cx": cx,
            "cy": cy,
            "box": [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2],
            "conf": 0.99,
        }

    def test_three_eighths_under_a_printed_3_occupy_one_beat(self):
        notes = [self._eighth(20, pitch=67), self._eighth(40, pitch=71), self._eighth(60, pitch=74)]
        marks = [
            self._mark("spanEnd_tl", 15, 8),
            self._mark("spanEnd_tr", 65, 8),
            self._mark("tupletNum", 40, 8, w=8, h=10),
        ]
        _apply_printed_tuplets(notes, marks, self.staff)
        for n in notes:
            self.assertAlmostEqual(n["dur"], 1.0 / 3.0, places=9)
        evs = _group_and_time(notes, [], spacing=10.0)
        self.assertEqual([e["pitch"] for e in evs], [67, 71, 74])
        self.assertAlmostEqual(evs[0]["start"], 0.0, places=9)
        self.assertAlmostEqual(evs[1]["start"], 1.0 / 3.0, places=9)
        self.assertAlmostEqual(evs[2]["start"], 2.0 / 3.0, places=9)
        end = evs[2]["start"] + evs[2]["dur"]
        self.assertAlmostEqual(end, 1.0, places=9)

    def test_three_eighths_without_a_numeral_stay_ordinary_eighths(self):
        notes = [self._eighth(20), self._eighth(40), self._eighth(60)]
        _apply_printed_tuplets(notes, [], self.staff)
        for n in notes:
            self.assertEqual(n["dur"], 0.5)
        evs = _group_and_time(notes, [], spacing=10.0)
        self.assertEqual([e["start"] for e in evs], [0.0, 0.5, 1.0])

    def test_ordinary_two_note_beam_is_not_filled_or_scaled(self):
        notes = [self._eighth(20), self._eighth(60)]
        marks = [self._mark("tuplet_3", 40, 40, w=10, h=8)]
        _recover_incomplete_tuplet_heads(notes, marks, self.staff, "C")
        _apply_printed_tuplets(notes, marks, self.staff)
        self.assertEqual(len(notes), 2)
        for n in notes:
            self.assertEqual(n["dur"], 0.5)

    def test_missed_head_under_a_printed_3_is_restored_then_scaled(self):
        notes = [self._eighth(20, pitch=67), self._eighth(60, pitch=74)]
        marks = [
            self._mark("spanEnd_tl", 15, 8),
            self._mark("spanEnd_tr", 65, 8),
            self._mark("tupletNum", 40, 8, w=8, h=10),
            self._mark("tuplet_3", 40, 40, w=10, h=8),
        ]
        _recover_incomplete_tuplet_heads(notes, marks, self.staff, "C")
        self.assertEqual(len(notes), 3)
        mid = sorted(notes, key=lambda n: n["cx"])[1]
        self.assertTrue(mid.get("recovered"))
        # Mid staff line in treble, key C, is B4 (MIDI 71).
        self.assertEqual(mid["pitch"], 71)
        _apply_printed_tuplets(notes, marks, self.staff)
        for n in notes:
            self.assertAlmostEqual(n["dur"], 1.0 / 3.0, places=9)

    def test_tuplet_3_above_the_staff_is_a_numeral_not_a_head(self):
        notes = [self._eighth(20, pitch=67), self._eighth(40, pitch=71), self._eighth(60, pitch=74)]
        marks = [
            self._mark("spanEnd_tl", 15, 8),
            self._mark("spanEnd_tr", 65, 8),
            self._mark("tuplet_3", 40, 8, w=8, h=10),
        ]
        _recover_incomplete_tuplet_heads(notes, marks, self.staff, "C")
        self.assertEqual(len(notes), 3)
        _apply_printed_tuplets(notes, marks, self.staff)
        for n in notes:
            self.assertAlmostEqual(n["dur"], 1.0 / 3.0, places=9)

    def test_numeral_without_brackets_still_scales_the_nearest_trio(self):
        notes = [self._eighth(20, pitch=67), self._eighth(40, pitch=71), self._eighth(60, pitch=74)]
        marks = [self._mark("tupletNum", 40, 8, w=8, h=10)]
        _apply_printed_tuplets(notes, marks, self.staff)
        for n in notes:
            self.assertAlmostEqual(n["dur"], 1.0 / 3.0, places=9)

class ClippedBraceTests(unittest.TestCase):
    def test_lone_staff_in_a_brace_cut_by_the_page_edge_is_skipped(self):
        complete_upper = _staff(40, 20, 60, 10, "G2")
        complete_lower = _staff(100, 80, 120, 10, "F4")
        visible = _staff(200, 180, 220, 10, "G2")
        dets = [
            {"cls": "grpSym_brace", "xyxy": [0, 18, 8, 122]},  # complete pair, in page
            {"cls": "grpSym_brace", "xyxy": [0, 170, 8, 239]},  # only the lower staff, runs off the bottom
        ]
        clipped = _staffs_in_clipped_braces(dets, [visible, complete_upper, complete_lower], 240)
        self.assertEqual(clipped, {id(visible)})

    def test_complete_grand_staff_kept_even_if_the_brace_is_clipped(self):
        upper = _staff(40, 20, 60, 10, "G2")
        lower = _staff(100, 80, 120, 10, "F4")
        dets = [{"cls": "grpSym_brace", "xyxy": [0, 0, 8, 122]}]  # top is on the edge
        clipped = _staffs_in_clipped_braces(dets, [upper, lower], 200)
        self.assertEqual(clipped, set())



class MultiSegmentTieTests(unittest.TestCase):
    """Ties can have more than two printed segments on the same staff."""

    def _note(self, cx, dur, pitch=71, cls="note_16th"):
        return {
            "cls": cls,
            "cx": cx,
            "cy": 40.0,
            "box": [cx - 10, 34, cx + 10, 46],
            "dur": dur,
            "pitch": pitch,
        }

    def test_three_segment_tie_is_one_event(self):
        # 16th + quarter + 16th of the same pitch, each pair joined by a curve.
        first = self._note(20, 0.25)
        middle = self._note(70, 1.0, cls="note_quarter")
        last = self._note(130, 0.25)
        curves = [
            {"box": [28, 36, 62, 44], "cy": 40.0, "cx": 45.0},
            {"box": [78, 36, 122, 44], "cy": 40.0, "cx": 100.0},
        ]
        events = _group_and_time([first, middle, last], curves, spacing=14.0)
        self.assertEqual(len(events), 1, events)
        self.assertEqual(events[0]["pitch"], 71)
        self.assertEqual(events[0]["start"], 0.0)
        self.assertEqual(events[0]["dur"], 1.5)

    def test_displaced_head_shares_the_stem_column(self):
        # A second on the opposite side of the stem must not start a new beat.
        stem_left = self._note(40, 1.0, pitch=67, cls="note_quarter")
        stem_right = self._note(40, 1.0, pitch=71, cls="note_quarter")
        displaced = self._note(58, 1.0, pitch=72, cls="note_quarter")
        displaced["column_x"] = 40.0
        later = self._note(100, 1.0, pitch=74, cls="note_quarter")
        events = _group_and_time([stem_left, stem_right, displaced, later], [], spacing=14.0)
        self.assertEqual(
            [(e["pitch"], e["start"], e["dur"]) for e in events],
            [(67, 0.0, 1.0), (71, 0.0, 1.0), (72, 0.0, 1.0), (74, 1.0, 1.0)],
        )


class BoundaryTieTests(unittest.TestCase):
    def test_stacked_boundary_curves_follow_vertical_order(self):
        # Three open curves at the end of a line sit beside a three-note chord.
        # Even if each curve is slightly nearer a neighbor, assign by y order.
        chord = [
            {"pitch": 79, "cy": 20.0, "box": [10, 14, 30, 26], "cx": 20.0},
            {"pitch": 76, "cy": 40.0, "box": [10, 34, 30, 46], "cx": 20.0},
            {"pitch": 71, "cy": 60.0, "box": [10, 54, 30, 66], "cx": 20.0},
        ]
        curves = [
            {"cy": 22.0, "cx": 42.0, "box": [32, 18, 52, 26]},
            {"cy": 41.0, "cx": 42.0, "box": [32, 37, 52, 45]},
            {"cy": 59.0, "cx": 42.0, "box": [32, 55, 52, 63]},
        ]
        self.assertEqual(_boundary_pitches(chord, curves, spacing=14.0, incoming=False), [71, 76, 79])

    def test_group_and_time_records_outgoing_ties(self):
        notes = [
            {"cx": 20, "cy": 20.0, "box": [10, 14, 30, 26], "dur": 1.0, "pitch": 79},
            {"cx": 20, "cy": 40.0, "box": [10, 34, 30, 46], "dur": 1.0, "pitch": 71},
        ]
        curves = [
            {"cy": 20.0, "cx": 42.0, "box": [32, 16, 52, 24]},
            {"cy": 40.0, "cx": 42.0, "box": [32, 36, 52, 44]},
        ]
        boundary = {}
        events = _group_and_time(notes, curves, spacing=14.0, boundary=boundary)
        self.assertEqual(len(events), 2)
        self.assertEqual(boundary["duration"], 1.0)
        self.assertEqual(boundary["tiesIn"], [])
        self.assertEqual(boundary["tiesOut"], [71, 79])


class SharedStemInkTests(unittest.TestCase):
    """Shared-stem rules are general engraving, not titled examples."""

    def _blank(self, w=160, h=160):
        return Image.new("L", (w, h), 255)

    def _fill_rect(self, img, x0, y0, x1, y1, value=0):
        px = img.load()
        for y in range(int(y0), int(y1) + 1):
            for x in range(int(x0), int(x1) + 1):
                px[x, y] = value

    def _ellipse(self, img, cx, cy, rx=8, ry=6, value=0):
        px = img.load()
        for dy in range(-ry, ry + 1):
            for dx in range(-rx, rx + 1):
                if (dx / rx) ** 2 + (dy / ry) ** 2 <= 1.0:
                    px[int(cx + dx), int(cy + dy)] = value

    def _note(self, cls, cx, cy, pitch, dur, box=None):
        if box is None:
            box = [cx - 8, cy - 6, cx + 8, cy + 6]
        return {
            "cls": cls,
            "cx": float(cx),
            "cy": float(cy),
            "box": [float(v) for v in box],
            "pitch": pitch,
            "dur": dur,
            "dot": False,
        }

    def test_displaced_unison_heads_on_one_stem_merge(self):
        # Two same-pitch eighths sit on opposite sides of a down-stem chord
        # that already has another eighth on the stem. Keep one head.
        img = self._blank()
        stem_x = 40
        self._fill_rect(img, stem_x - 1, 40, stem_x + 1, 110)
        self._ellipse(img, 32, 50)   # left of stem, G4
        self._ellipse(img, 48, 50)   # displaced unison, also G4
        self._ellipse(img, 32, 80)   # left of stem, D4
        items = [
            self._note("note_eighth", 32, 50, 67, 0.5, [24, 44, 40, 56]),
            self._note("note_eighth", 48, 50, 67, 0.5, [40, 44, 56, 56]),
            self._note("note_eighth", 32, 80, 62, 0.5, [24, 74, 40, 86]),
        ]
        _merge_shared_stem_unisons(img.convert("RGB"), items)
        pitches = sorted(n["pitch"] for n in items if not n.get("is_rest"))
        self.assertEqual(pitches, [62, 67], items)

    def test_shared_quarter_stem_promotes_a_mislabeled_eighth(self):
        # Three heads share an unflagged stem. Two are quarters; the lowest
        # is labeled an eighth but the ink is the same stroke.
        img = self._blank()
        stem_x = 48
        self._fill_rect(img, stem_x, 30, stem_x + 1, 110)
        self._ellipse(img, 40, 40)
        self._ellipse(img, 40, 70)
        self._ellipse(img, 40, 100)
        items = [
            self._note("note_quarter", 40, 40, 76, 1.0, [32, 34, 48, 46]),
            self._note("note_quarter", 40, 70, 71, 1.0, [32, 64, 48, 76]),
            self._note("note_eighth", 40, 100, 67, 0.5, [32, 94, 48, 106]),
        ]
        _read_shared_quarter_stems(img.convert("RGB"), items)
        self.assertEqual(items[2]["dur"], 1.0, items[2])

    def test_augmentation_dot_applies_to_every_head_on_a_shared_flag(self):
        lower = self._note("note_eighth", 40, 80, 67, 0.5)
        upper = self._note("note_eighth", 40, 50, 74, 0.75)
        upper["dot_box"] = [52, 44, 60, 52]
        _propagate_shared_stem_dots([[lower, upper]])
        self.assertEqual(lower["dur"], 0.75)
        self.assertEqual(upper["dur"], 0.75)

    def test_flag_box_attaches_to_printed_stem_axis_not_box_left(self):
        # A thick stem can make the detector box start at the outer ink
        # edge. Attachment must use the printed axis, or a displaced head
        # on the far side is treated as the next beat.
        img = self._blank()
        stem_left, stem_right = 50, 54  # 5-pixel-wide stroke
        flag_top, flag_bottom = 20, 50
        self._fill_rect(img, stem_left, flag_top, stem_right, 140)
        self._ellipse(img, 42, 80)
        self._ellipse(img, 42, 110)
        self._ellipse(img, 62, 95)
        flags = [{
            "cls": "flag",
            "box": [float(stem_left), float(flag_top), 80.0, float(flag_bottom)],
            "cx": 65.0,
            "cy": 35.0,
        }]
        left_upper = self._note("note_16th", 42, 80, 79, 0.25, [34, 74, stem_left, 86])
        left_lower = self._note("note_16th", 42, 110, 71, 0.25, [34, 104, stem_left, 116])
        displaced = self._note("note_16th", 62, 95, 76, 0.25, [stem_right, 89, 70, 101])
        notes = [left_upper, left_lower, displaced]
        shared = _read_shared_stem_flags(img.convert("RGB"), flags, notes)
        self.assertTrue(shared, "expected a shared flagged stem")
        attached = shared[0]
        self.assertEqual(sorted(n["pitch"] for n in attached), [71, 76, 79], attached)
        self.assertEqual(displaced.get("column_x"), left_upper["cx"], displaced)


class ExtraBoundaryCurveTests(unittest.TestCase):
    """Optional extra curves stay inert unless the caller supplies them."""

    def test_extra_boundary_curves_are_optional_and_merged(self):
        notes = [
            {"cx": 20, "cy": 40.0, "box": [10, 34, 30, 46], "dur": 1.0, "pitch": 71},
        ]
        missed = [{"cy": 40.0, "cx": 42.0, "box": [32, 36, 52, 44]}]
        default = {}
        events = _group_and_time(notes, [], spacing=14.0, boundary=default)
        self.assertEqual(len(events), 1)
        self.assertEqual(default["tiesOut"], [])
        empty = {}
        _group_and_time(notes, [], spacing=14.0, boundary=empty, extra_boundary_curves=())
        self.assertEqual(empty, default)
        recovered = {}
        _group_and_time(
            notes, [], spacing=14.0, boundary=recovered, extra_boundary_curves=missed,
        )
        self.assertEqual(recovered["tiesOut"], [71])
        self.assertEqual(recovered["tiesIn"], [])

    def test_corroborated_curve_can_tie_but_neighbor_staff_marks_cannot(self):
        first = {"cx": 20, "cy": 40.0, "box": [10, 34, 30, 46], "dur": 1.0, "pitch": 71}
        second = {"cx": 80, "cy": 40.0, "box": [70, 34, 90, 46], "dur": 1.0, "pitch": 71}
        local = [{"cy": 40.0, "cx": 50.0, "box": [28, 36, 72, 44]}]
        # Same mark, slightly expanded localization.
        corroborated = [{"cy": 40.0, "cx": 50.0, "box": [26, 35, 74, 45]}]
        # A mark from the staff above should not invent a local tie.
        neighbor = [{"cy": 8.0, "cx": 50.0, "box": [20, 2, 80, 14]}]
        events = _group_and_time([first, second], local, spacing=14.0)
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["dur"], 2.0)
        same = _group_and_time(
            [first, second], local, spacing=14.0, extra_boundary_curves=corroborated,
        )
        self.assertEqual(len(same), 1)
        self.assertEqual(same[0]["dur"], 2.0)
        # Without the crop curve, the neighbor-staff mark alone must not tie.
        isolated = _group_and_time(
            [first, second], [], spacing=14.0, extra_boundary_curves=neighbor,
        )
        self.assertEqual(len(isolated), 2)


class WrittenAccidentalTests(unittest.TestCase):
    """A written accidental lasts until the next barline, on that staff position."""

    def test_sharp_applies_until_the_barline_then_resets(self):
        staff = _staff(40, 12, 68, 14, "G2")
        first = {
            "cls": "note_quarter", "cx": 40, "cy": 40, "pos": 0,
            "box": [32, 34, 48, 46], "pitch": 71, "dur": 1.0, "dot": False,
        }
        later_same_bar = {
            "cls": "note_quarter", "cx": 80, "cy": 40, "pos": 0,
            "box": [72, 34, 88, 46], "pitch": 71, "dur": 1.0, "dot": False,
        }
        after_bar = {
            "cls": "note_quarter", "cx": 140, "cy": 40, "pos": 0,
            "box": [132, 34, 148, 46], "pitch": 71, "dur": 1.0, "dot": False,
        }
        other_pos = {
            "cls": "note_quarter", "cx": 60, "cy": 54, "pos": -1,
            "box": [52, 48, 68, 60], "pitch": 69, "dur": 1.0, "dot": False,
        }
        items = [first, later_same_bar, after_bar, other_pos]
        marks = [{
            "cls": "accid_sharp", "cx": 22, "cy": 40, "alter": 1,
            "box": [14, 28, 28, 52],
        }]
        _apply_written_accidentals(items, staff, marks, barlines=[110])
        self.assertEqual(first["pitch"], 72)
        self.assertEqual(later_same_bar["pitch"], 72)
        self.assertEqual(after_bar["pitch"], 71)
        self.assertEqual(other_pos["pitch"], 69)


class SharedStemInkExtraTests(SharedStemInkTests):
    def test_down_stem_attaches_a_displaced_head_on_the_opposite_side(self):
        img = self._blank()
        stem_x = 50
        # Down-stem flag box sits below the heads.
        self._fill_rect(img, stem_x - 1, 40, stem_x + 1, 130)
        self._ellipse(img, 58, 50)
        self._ellipse(img, 58, 80)
        self._ellipse(img, 42, 65)
        flags = [{
            "cls": "flag",
            "box": [40.0, 110.0, 70.0, 130.0],
            "cx": 55.0,
            "cy": 120.0,
        }]
        right_upper = self._note("note_eighth", 58, 50, 76, 0.5, [stem_x, 44, 66, 56])
        right_lower = self._note("note_eighth", 58, 80, 71, 0.5, [stem_x, 74, 66, 86])
        displaced = self._note("note_eighth", 42, 65, 74, 0.5, [34, 59, stem_x, 71])
        notes = [right_upper, right_lower, displaced]
        shared = _read_shared_stem_flags(img.convert("RGB"), flags, notes)
        self.assertTrue(shared, "expected a shared down-stem flag")
        attached = shared[0]
        self.assertEqual(sorted(n["pitch"] for n in attached), [71, 74, 76], attached)
        self.assertEqual(displaced.get("column_x"), right_upper["cx"], displaced)
        self.assertEqual(displaced.get("tie_left"), 34)

    def test_dotted_quarter_duration_is_shared_on_the_stem(self):
        img = self._blank()
        stem_x = 48
        self._fill_rect(img, stem_x - 1, 30, stem_x + 1, 110)
        self._ellipse(img, 40, 40)
        self._ellipse(img, 40, 80)
        dotted = self._note("note_quarter", 40, 40, 76, 1.5, [32, 34, stem_x, 46])
        dotted["dot_box"] = [52, 34, 60, 42]
        plain = self._note("note_quarter", 40, 80, 67, 1.0, [32, 74, stem_x, 86])
        _complete_dotted_quarter_chords(img.convert("RGB"), [dotted, plain])
        self.assertEqual(plain["dur"], 1.5)

    def test_tie_reaches_a_displaced_head_via_tie_left(self):
        left = {"cx": 20, "cy": 40.0, "box": [10, 34, 30, 46], "dur": 1.0, "pitch": 71}
        right = {
            "cx": 80, "cy": 40.0, "box": [70, 34, 90, 46],
            "dur": 1.0, "pitch": 71, "tie_left": 58,
        }
        # Curve ends short of the displaced head's left edge, but reaches
        # the left side of the shared chord.
        curve = [{"cy": 40.0, "cx": 44.0, "box": [28, 36, 52, 44]}]
        without = _group_and_time(
            [left, {k: v for k, v in right.items() if k != "tie_left"}],
            curve, spacing=14.0,
        )
        self.assertEqual(len(without), 2)
        with_hint = _group_and_time([left, right], curve, spacing=14.0)
        self.assertEqual(len(with_hint), 1)
        self.assertEqual(with_hint[0]["dur"], 2.0)

    def test_eighths_above_a_quarter_share_the_stem_column(self):
        img = self._blank()
        stem_x = 48
        self._fill_rect(img, stem_x - 1, 20, stem_x + 1, 110)
        self._ellipse(img, 40, 30)
        self._ellipse(img, 40, 55)
        self._ellipse(img, 40, 90)
        items = [
            self._note("note_eighth", 40, 30, 79, 0.5, [32, 24, stem_x, 36]),
            self._note("note_eighth", 40, 55, 76, 0.5, [32, 49, stem_x, 61]),
            self._note("note_quarter", 40, 90, 67, 1.0, [32, 84, stem_x, 96]),
        ]
        groups = _read_shared_quarter_stems(img.convert("RGB"), items)
        self.assertTrue(groups)
        self.assertEqual(items[0]["dur"], 1.0)
        self.assertEqual(items[1]["dur"], 1.0)
        self.assertEqual(items[0].get("column_x"), items[2]["cx"])


if __name__ == "__main__":
    unittest.main()
