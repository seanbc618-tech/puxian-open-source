"""Offline reconstruction from copisteria detections + staff-line geometry.

Does not change the official copisteria sequence-model path or product defaults.
Pitch comes from notehead y vs ink staff lines (clef + key applied).
Duration comes from detector class plus adjacent dots_1.
Onset is left-to-right chord order, including rests as time advances
(no attack). A rest stacked with a note at the same x is a second voice
at that onset, not extra duration. Same-pitch notes linked by a curve
are tie continuations (no new attack; duration is extended). Staves
that form one musical system (a piano grand staff: treble immediately
above bass) share a
local start time of 0. Successive systems on a page are concatenated
in reading order, each starting at the next barline at or after the
previous system ends. They must not be overlaid on the same timeline
or forced into a piano grand staff.
"""
from __future__ import annotations

import json
from pathlib import Path

from page_refusal import refusal_for_dark

import numpy as np
from PIL import Image

DUR_CLASS = {
    "note_32nd": 0.125,
    "note_16th": 0.25,
    "note_eighth": 0.5,
    "note_quarter": 1.0,
    "note_half": 2.0,
    "note_whole": 4.0,
}

REST_CLASS = {
    "rest_32nd": 0.125,
    "rest_16th": 0.25,
    "rest_eighth": 0.5,
    "rest_8th": 0.5,
    "rest_quarter": 1.0,
    "rest_half": 2.0,
    "rest_whole": 4.0,
}

LETTERS = ["C", "D", "E", "F", "G", "A", "B"]
STEP = dict(C=0, D=2, E=4, F=5, G=7, A=9, B=11)
KEY_ALTER = {
    "C": {},
    "G": {"F": 1},
    "D": {"F": 1, "C": 1},
    "A": {"F": 1, "C": 1, "G": 1},
    "E": {"F": 1, "C": 1, "G": 1, "D": 1},
    "B": {"F": 1, "C": 1, "G": 1, "D": 1, "A": 1},
    "F#": {"F": 1, "C": 1, "G": 1, "D": 1, "A": 1, "E": 1},
    "F": {"B": -1},
    "Bb": {"B": -1, "E": -1},
    "Eb": {"B": -1, "E": -1, "A": -1},
    "Ab": {"B": -1, "E": -1, "A": -1, "D": -1},
    "Db": {"B": -1, "E": -1, "A": -1, "D": -1, "G": -1},
    "Gb": {"B": -1, "E": -1, "A": -1, "D": -1, "G": -1, "C": -1},
}

class GeomUserError(Exception):
    """Expected refusal. `args[0]` is Chinese text for the user, never a traceback."""

    status = 422


KEY_FROM_SIG = {
    "keySig_1s": "G",
    "keySig_2s": "D",
    "keySig_3s": "A",
    "keySig_4s": "E",
    "keySig_5s": "B",
    "keySig_6s": "F#",
    "keySig_1f": "F",
    "keySig_2f": "Bb",
    "keySig_3f": "Eb",
    "keySig_4f": "Ab",
    "keySig_5f": "Db",
    "keySig_6f": "Gb",
}
# middle-line letter and octave for standard clefs
CLEF_MID = {
    "G2": ("B", 4),
    "G": ("B", 4),
    "treble": ("B", 4),
    "F4": ("D", 3),
    "F": ("D", 3),
    "bass": ("D", 3),
}


def _xy(d):
    if "xyxy" in d:
        return [float(x) for x in d["xyxy"]]
    x, y, w, h = d["bbox"]
    return [float(x), float(y), float(x + w), float(y + h)]


def load_dets(path: Path) -> list[dict]:
    raw = json.loads(Path(path).read_text())
    return raw if isinstance(raw, list) else raw.get("dets") or raw


def infer_key(dets: list[dict], default: str = "C") -> str:
    for d in dets:
        cls = str(d.get("cls", ""))
        if cls in KEY_FROM_SIG:
            return KEY_FROM_SIG[cls]
    return default


def _band_midpoints(ys: list[int]) -> list[float]:
    if not ys:
        return []
    bands = []
    s = prev = ys[0]
    for y in ys[1:]:
        if y <= prev + 2:
            prev = y
        else:
            bands.append((s + prev) / 2.0)
            s = prev = y
    bands.append((s + prev) / 2.0)
    return bands


def _ink_band_rows(image: Image.Image, x0: float, x1: float, min_frac: float = 0.35):
    """Fallback: dark-row ink fraction (older path)."""
    a = np.array(image.convert("L"))
    x0i, x1i = max(0, int(x0)), min(a.shape[1], int(np.ceil(x1)))
    if x1i <= x0i:
        x0i, x1i = 0, a.shape[1]
    ink = (a[:, x0i:x1i] < 160).mean(axis=1)
    cands = [y for y, f in enumerate(ink) if f >= min_frac]
    if len(cands) < 5:
        cands = [y for y, f in enumerate(ink) if f >= 0.2]
    bands = []
    if cands:
        s = prev = cands[0]
        for y in cands[1:]:
            if y <= prev + 2:
                prev = y
            else:
                bands.append(((s + prev) / 2.0, float(ink[s:prev + 1].max())))
                s = prev = y
        bands.append(((s + prev) / 2.0, float(ink[s:prev + 1].max())))
    strong = [b for b in bands if b[1] >= 0.7]
    pool = strong if len(strong) >= 5 else bands
    ys = sorted(pool, key=lambda b: b[0])
    best = None
    for i in range(max(0, len(ys) - 4)):
        five = ys[i:i + 5]
        yv = [b[0] for b in five]
        sp = np.diff(yv)
        if sp.min() <= 0:
            continue
        cv = float(sp.std() / sp.mean())
        mean_frac = float(np.mean([b[1] for b in five]))
        score = (cv, -mean_frac)
        if best is None or score < best[0]:
            best = (score, yv, float(sp.mean()))
    if not best:
        return []
    return [best[1]]


def _coarse_dark(image: Image.Image, x0: float, x1: float, gw: int = 120, gh: int = 96) -> list[list[bool]]:
    """Downsample to a small ink grid so a refusal does not depend on the title."""
    a = np.asarray(image.convert("L"))
    x0i, x1i = max(0, int(x0)), min(a.shape[1], int(np.ceil(x1)))
    if x1i <= x0i:
        x0i, x1i = 0, a.shape[1]
    crop = a[:, x0i:x1i]
    h, w = crop.shape
    grid: list[list[bool]] = []
    for gy in range(gh):
        y0 = h * gy // gh
        y1 = max(y0 + 1, h * (gy + 1) // gh)
        row: list[bool] = []
        for gx in range(gw):
            xa = w * gx // gw
            xb = max(xa + 1, w * (gx + 1) // gw)
            block = crop[y0:y1, xa:xb]
            row.append(bool(block.size) and int(block.min()) < 170)
        grid.append(row)
    return grid


def find_staff_systems(image: Image.Image, x0: float, x1: float) -> list[dict]:
    """Find one or more 5-line staves via row-median local minima.

    Staff lines span the width, so the row median is dark; short ledgers
    and sparse noteheads do not move the median. Anti-aliased engraved
    lines (median ~190 on a white page) are still darker than the background.
    """
    a = np.array(image.convert("L"))
    x0i, x1i = max(0, int(x0)), min(a.shape[1], int(np.ceil(x1)))
    if x1i <= x0i:
        x0i, x1i = 0, a.shape[1]
    sl = a[:, x0i:x1i]
    med = np.median(sl, axis=1)
    bg = float(np.median(sl))
    delta = max(10.0, 0.04 * bg)
    minima = [
        y for y in range(1, len(med) - 1)
        if med[y] <= med[y - 1] and med[y] <= med[y + 1] and med[y] < bg - delta
    ]
    bands = _band_midpoints(minima)
    h = a.shape[0]
    raw = []
    for i in range(max(0, len(bands) - 4)):
        five = bands[i:i + 5]
        sp = np.diff(five)
        if sp.min() <= 2:
            continue
        if sp.max() > max(40.0, h / 3.0):
            continue
        mean_sp = float(sp.mean())
        cv = float(sp.std() / mean_sp)
        if cv > 0.25:
            continue
        dark = float(np.mean([med[int(np.clip(round(y), 0, len(med) - 1))] for y in five]))
        raw.append((cv, dark, five, mean_sp))
    raw.sort(key=lambda c: (c[0], c[1]))
    picked = []
    for cv, dark, five, sp in raw:
        mid = five[2]
        if any(abs(mid - p["mid"]) < 2.5 * p["spacing"] for p in picked):
            continue
        if any(not (five[4] < p["top"] - 0.5 * p["spacing"] or five[0] > p["bot"] + 0.5 * p["spacing"]) for p in picked):
            continue
        picked.append({
            "lines": [float(y) for y in five],
            "spacing": float(sp),
            "mid": float(mid),
            "top": float(five[0]),
            "bot": float(five[4]),
        })
    if not picked:
        for yv in _ink_band_rows(image, x0, x1):
            sp = float(np.mean(np.diff(yv)))
            picked.append({
                "lines": [float(y) for y in yv],
                "spacing": sp,
                "mid": float(yv[2]),
                "top": float(yv[0]),
                "bot": float(yv[4]),
            })
    if not picked:
        raise GeomUserError(refusal_for_dark(_coarse_dark(image, x0, x1)))
    picked.sort(key=lambda s: s["mid"])
    return picked


def find_staff_lines(image: Image.Image, x0: float, x1: float, min_frac: float = 0.35):
    """Compatibility wrapper: first (top) staff's five lines and spacing."""
    del min_frac
    systems = find_staff_systems(image, x0, x1)
    return systems[0]["lines"], systems[0]["spacing"]


def pos_from_cy(cy: float, lines: list[float]) -> int:
    mid = lines[2]
    spacing = (lines[4] - lines[0]) / 4.0
    return int(round((mid - cy) / (spacing / 2.0)))


def midi_from_pos(pos: int, key: str = "G", clef: str = "G2") -> int:
    mid_letter, mid_oct = CLEF_MID.get(clef, ("B", 4))
    total = LETTERS.index(mid_letter) + mid_oct * 7 + pos
    octv, li = divmod(total, 7)
    letter = LETTERS[li]
    alter = KEY_ALTER.get(key, {}).get(letter, 0)
    return (octv + 1) * 12 + STEP[letter] + alter


def _is_barline(cls: str) -> bool:
    c = cls.lower()
    return "barline" in c or c.startswith("barline")



def _add_measure_boundary_barlines(barlines, measures, image_width, spacing):
    """Use a high-confidence measure box edge as a barline when the detector missed it."""
    existing = [float(b["cx"]) for b in barlines]
    min_width = max(80.0, spacing * 5)
    min_height = spacing * 3
    proximity = max(24.0, spacing * 1.6)
    for measure in measures:
        if float(measure.get("conf") or 0) < 0.8:
            continue
        left, top, right, bottom = measure["box"]
        if (right - left) < min_width or (bottom - top) < min_height:
            continue
        for x in (left, right):
            if x < 8 or x > image_width - 8:
                continue
            if any(abs(x - cx) <= proximity for cx in existing):
                continue
            barlines.append({
                "cls": "barLine_single",
                "box": [x - 1.0, top, x + 1.0, bottom],
                "cx": float(x),
                "cy": (top + bottom) / 2.0,
                "conf": float(measure.get("conf") or 0),
                "from_measure": True,
            })
            existing.append(float(x))


def _apply_written_accidentals(items, staff, accidentals, barlines):
    """Apply a detected accidental to its staff position until the next barline."""
    spacing = staff["spacing"]
    marks = sorted(accidentals, key=lambda mark: mark["cx"])
    notes = sorted((item for item in items if not item.get("is_rest")), key=lambda note: note["cx"])
    attached = {}
    for mark in marks:
        y = mark["cy"]
        if mark["cls"] in ("accid_flat", "accid_dflat"):
            y += spacing / 2
        pos = pos_from_cy(y, staff["lines"])
        head = next((
            note for note in notes
            if note["pos"] == pos
            and -0.25 * spacing <= note["box"][0] - mark["box"][2] <= 2 * spacing
            and not any(mark["cx"] < x < note["cx"] for x in barlines)
        ), None)
        if head is not None:
            attached[id(head)] = mark["alter"]
    active = {}
    bars = iter(sorted(barlines))
    edge = next(bars, float("inf"))
    for note in notes:
        while note["cx"] > edge:
            active.clear()
            edge = next(bars, float("inf"))
        pos = note["pos"]
        if id(note) in attached:
            active[pos] = attached[id(note)]
        if pos in active:
            note["pitch"] = midi_from_pos(pos, "C", staff["clef"]) + active[pos]


def _assign_clefs(systems: list[dict], dets: list[dict]) -> None:
    clefs = []
    for d in dets:
        cls = str(d.get("cls", ""))
        if not cls.startswith("clef_"):
            continue
        box = _xy(d)
        cy = (box[1] + box[3]) / 2.0
        kind = cls.split("_", 1)[1]  # G2, F4, ...
        if kind not in CLEF_MID:
            kind = "G2" if kind.startswith("G") else ("F4" if kind.startswith("F") else "G2")
        clefs.append((cy, kind))
    for s in systems:
        if clefs:
            s["clef"] = min(clefs, key=lambda c: abs(c[0] - s["mid"]))[1]
        else:
            s["clef"] = "G2"


def _nearest_staff(cy: float, systems: list[dict]):
    return min(systems, key=lambda s: abs(cy - s["mid"]))


def _staffs_in_clipped_braces(dets, staves, image_height):
    """Identify lone staves whose enclosing piano brace runs off the image."""
    clipped = set()
    for detection in dets:
        if detection.get("cls") != "grpSym_brace":
            continue
        _, top, _, bottom = _xy(detection)
        if top > 0 and bottom < image_height - 1:
            continue
        enclosed = [staff for staff in staves if top <= staff["mid"] <= bottom]
        if len(enclosed) == 1:
            clipped.add(id(enclosed[0]))
    return clipped


def assign_symbol_to_staff(cy: float, is_rest: bool, staves: list[dict]) -> dict:
    """Pick the staff a symbol belongs to.

    Midpoint-nearest is the default. A rest that sits in the open gap of a
    piano grand staff (more than two spaces below the treble) belongs to
    the bass, even when it is a few pixels closer to the treble midpoint.
    Those left-hand 16th rests are written in the gap; giving them to the
    treble leaves the bass without the stacked rest, and the tenor and
    bass are then timed in series.
    """
    staff = _nearest_staff(cy, staves)
    if not is_rest or len(staves) < 2:
        return staff
    for group in group_staves_into_systems(staves):
        if len(group) != 2:
            continue
        tr, ba = group[0], group[1]
        if _clef_kind(tr.get("clef")) != "G" or _clef_kind(ba.get("clef")) != "F":
            continue
        if tr["bot"] < cy < ba["top"] and cy > tr["bot"] + 2 * float(tr.get("spacing") or 1.0):
            return ba
    return staff


def _attach_dots(items: list[dict], dots: list[dict], spacing: float) -> None:
    used = set()
    for n in items:
        best = None
        for i, d in enumerate(dots):
            if i in used:
                continue
            dx = d["cx"] - n["box"][2]
            dy = abs(d["cy"] - n["cy"])
            if 0 <= dx <= max(28, spacing * 1.6) and dy <= max(12, spacing * 0.8):
                score = dx + 2 * dy
                if best is None or score < best[0]:
                    best = (score, i)
        if best is not None:
            used.add(best[1])
            n["dot"] = True
            n["dot_box"] = dots[best[1]]["box"]
            n["dur"] = n["dur"] * 1.5


def _read_shared_stem_flags(image, flags, notes):
    """Read the printed flags on a stem shared by multiple noteheads."""
    if not flags:
        return []
    shared_stems = []
    ink = np.asarray(image.convert("L")) < 160
    for flag in flags:
        left, top, right, bottom = (round(v) for v in flag["box"])
        width = right - left
        if width < 6 or not (0 <= left < right <= image.width and 0 <= top < bottom <= image.height):
            continue
        # The detector box can begin at the outside edge of a thick
        # stroke. Locate the printed axis before testing head attachment.
        stroke = np.flatnonzero(ink[top + 1:bottom - 1, left:left + width // 2].all(axis=0))
        stem_x = left + round(float(np.mean(stroke))) if stroke.size else left
        for upward in (True, False):
            attached = []
            for note in notes:
                if note["cls"] not in ("note_32nd", "note_16th", "note_eighth"):
                    continue
                head_y = round(note["cy"])
                edge = note["box"][2 if upward else 0]
                if abs(edge - stem_x) > 3:
                    continue
                if upward and head_y > top and note["cx"] < stem_x:
                    stem = ink[top + 1:head_y, max(0, stem_x - 1):stem_x + 2]
                elif not upward and head_y < top and note["cx"] > stem_x:
                    stem = ink[head_y:bottom - 1, max(0, stem_x - 1):stem_x + 2]
                else:
                    continue
                if stem.size and stem.any(axis=1).all():
                    attached.append(note)
            if len(attached) < 2:
                continue
            column_x = attached[0]["cx"]
            for note in notes:
                if note["cls"] not in ("note_32nd", "note_16th", "note_eighth"):
                    continue
                head_y = round(note["cy"])
                if upward and note["cx"] > stem_x and abs(note["box"][0] - stem_x) <= 3:
                    start, end = top + 1, head_y
                elif not upward and note["cx"] < stem_x and abs(note["box"][2] - stem_x) <= 3:
                    start, end = head_y, bottom - 1
                else:
                    continue
                stem = ink[start:end, max(0, stem_x - 1):stem_x + 2]
                if stem.size and stem.any(axis=1).all():
                    note["column_x"] = column_x
                    attached.append(note)
            tie_left = min(note["box"][0] for note in attached)
            for note in attached:
                note["tie_left"] = tie_left
            shared_stems.append(attached)
            if len({note["cls"] for note in attached}) == 1:
                continue
            # Ignore ink that enters a slice at the headward edge of the
            # flag box. It can belong to a head or a ledger line. Down
            # stems have that edge at the top of the box; up stems have
            # it at the bottom. A leftover sliver there looks like an
            # extra hook and used to make the sample counts disagree,
            # so mixed labels on one stem kept their detector durations.
            crossings = []
            for fraction in (0.35, 0.42, 0.5):
                column = ink[top:bottom, left + round(width * fraction)]
                if column.size and not upward and column[0]:
                    gaps = np.flatnonzero(~column)
                    column = column[gaps[0]:] if gaps.size else column[:0]
                elif column.size and upward and column[-1]:
                    gaps = np.flatnonzero(~column)
                    column = column[: gaps[-1] + 1] if gaps.size else column[:0]
                crossings.append(len(_band_midpoints(np.flatnonzero(column).tolist())))
            if len(set(crossings)) != 1 or crossings[0] not in (1, 2, 3):
                continue
            duration = 1 / (2 ** crossings[0])
            for note in attached:
                note["dur"] = duration
    return shared_stems


def _read_shared_quarter_stems(image, notes, flags=None):
    """Resolve mixed head labels when a quarter-note chord has a common stem."""
    ink = np.asarray(image.convert("L")) < 160
    groups = []
    flags = list(flags or ())

    def flag_on_stem(note):
        """True when a detected flag sits on this head's stem, not merely nearby."""
        left, right = float(note["box"][0]), float(note["box"][2])
        cy = float(note["cy"])
        for flag in flags:
            box = flag["box"]
            fx = flag.get("cx", (box[0] + box[2]) / 2)
            # A flag is drawn at the stem, so its x must meet a stem edge.
            if min(abs(fx - right), abs(fx - left), abs(box[0] - right), abs(box[2] - left)) > 18:
                continue
            if box[3] < cy - 160 or box[1] > cy + 160:
                continue
            return True
        return False

    def stem_meets(note, stem, tol=3):
        return min(abs(note["box"][edge] - stem) for edge in (0, 2)) <= tol

    def stroke_connects(a, b, stem):
        y0, y1 = sorted((round(a["cy"]), round(b["cy"])))
        column = ink[y0:y1 + 1, max(0, stem - 1):stem + 2]
        return bool(column.size and column.any(axis=1).all())

    def attach_shorts(anchor, classes):
        """Return short heads that share either stem edge with the anchor.

        Try both sides and keep the most populous stroke. A down-stem lives
        on the left edge; returning the first non-empty right-edge hit would
        miss the real chord.
        """
        best = []
        for edge in (2, 0):
            mid = round(anchor["box"][edge])
            for stem in range(max(1, mid - 4), min(ink.shape[1] - 1, mid + 1)):
                attached = [
                    note for note in notes
                    if note is not anchor
                    and note["cls"] in classes
                    and stem_meets(note, stem)
                    and stroke_connects(note, anchor, stem)
                ]
                if len(attached) > len(best):
                    best = attached
        return best

    def attach_eighths(anchor):
        """Return connected upper eighths; do not mutate until the caller accepts."""
        # Keep the two-eighth threshold for the no-quarter recovery path.
        attached = [
            note for note in attach_shorts(anchor, ("note_eighth",))
            if note["cy"] < anchor["cy"]
        ]
        return attached if len(attached) >= 2 else []

    def promote_quarter_stem(anchor, attached):
        for note in attached:
            note["dur"] = 1.0
            note["column_x"] = anchor["cx"]

    # A labeled quarter on an unflagged stem is the duration of every
    # flagless head on that stroke, above or below, on either side of
    # the stem. Mixed labels on one stem are detector errors, not mixed
    # printed values. Flagged shorts are left alone.
    short_classes = ("note_eighth", "note_16th", "note_32nd")
    for anchor in (note for note in notes if note["cls"] == "note_quarter"):
        if flag_on_stem(anchor):
            continue
        attached = [note for note in attach_shorts(anchor, short_classes) if not flag_on_stem(note)]
        if attached:
            promote_quarter_stem(anchor, attached)
            groups.append([anchor, *attached])

    # The detector sometimes labels a flagless bass head as a 16th or eighth.
    # The printed cue is the stem: several heads share one unflagged stroke.
    # Those heads are still quarters, so they can anchor the same recovery
    # used for an explicitly labelled quarter. A flagged 16th/eighth stem is
    # left alone.
    recovered = {id(note) for group in groups for note in group}
    for anchor in notes:
        if id(anchor) in recovered:
            continue
        if anchor["cls"] not in ("note_16th", "note_eighth"):
            continue
        if flag_on_stem(anchor):
            continue
        attached = attach_eighths(anchor)
        if not attached:
            continue
        if any(flag_on_stem(note) for note in attached):
            continue
        anchor["dur"] = 1.0
        promote_quarter_stem(anchor, attached)
        groups.append([anchor, *attached])
        recovered.add(id(anchor))
        recovered.update(id(note) for note in attached)
    for head in notes:
        if head["cls"] not in ("note_16th", "note_eighth"):
            continue
        right = round(head["box"][2])
        center = round(head["cy"])
        for left in range(max(0, right - 4), min(ink.shape[1] - 1, right)):
            attached = [
                anchor for anchor in notes
                if anchor["cls"] == "note_quarter"
                and abs(anchor["box"][2] - head["box"][2]) <= 3
                and abs(anchor["cx"] - head["cx"]) <= 3
                and ink[min(round(anchor["cy"]), center):
                        max(round(anchor["cy"]), center) + 1, left:left + 2].any(axis=1).all()
            ]
            if len(attached) >= 2:
                head["dur"] = DUR_CLASS["note_quarter"]
                break

    # An adjacent second can put a head on the opposite side of the stem.
    # Require the same uninterrupted stroke through the displaced head and
    # at least two quarter heads whose right edges meet it.
    quarters = [n for n in notes if n["cls"] == "note_quarter"]
    for head in notes:
        if head["cls"] != "note_eighth" or head["dur"] != DUR_CLASS["note_eighth"]:
            continue
        for edge in (0, 2):
            stem = round(head["box"][edge])
            attached = [
                n for n in quarters
                if min(abs(n["box"][edge] - stem) for edge in (0, 2)) <= 3
                and ink[min(round(n["cy"]), round(head["cy"])):
                        max(round(n["cy"]), round(head["cy"])) + 1,
                        max(0, stem - 2):stem + 2].any(axis=1).all()
            ]
            if len(attached) >= 2:
                head["dur"] = DUR_CLASS["note_quarter"]
                head["column_x"] = attached[0]["cx"]
                break
    return groups


def _merge_shared_stem_unisons(image, items):
    """Keep a displaced unison's head on the side shared by the other tones."""
    ink = np.asarray(image.convert("L")) < 128
    filled = {"note_quarter", "note_eighth", "note_16th", "note_32nd"}
    heads = sorted((n for n in items if not n.get("is_rest")), key=lambda n: n["cx"])
    removed = set()
    last_by_pitch = {}
    for right in heads:
        left = last_by_pitch.get(right["pitch"])
        last_by_pitch[right["pitch"]] = right
        if left is None or abs(left["box"][2] - right["box"][0]) > 3:
            continue
        if left["cls"] != right["cls"] and not {left["cls"], right["cls"]} <= filled:
            continue
        seam = round((left["box"][2] + right["box"][0]) / 2)
        for head, duplicate, edge in ((left, right, 2), (right, left, 0)):
            same_stem = [
                n for n in heads
                if n is not duplicate and (n["cls"] == head["cls"] or n["cls"] in filled)
                and abs(n["box"][edge] - seam) <= 3
                and ink[min(round(n["cy"]), round(head["cy"])):
                        max(round(n["cy"]), round(head["cy"])),
                        max(0, seam - 3):seam + 4].any(axis=1).all()
            ]
            if head not in same_stem or len(same_stem) < 2:
                continue
            duration = max(n["dur"] for n in [duplicate, *same_stem])
            for note in same_stem:
                note["dur"] = duration
            if "dot_box" in duplicate:
                head["dot_box"] = duplicate["dot_box"]
            removed.add(id(duplicate))
            last_by_pitch[head["pitch"]] = head
            break
    items[:] = [item for item in items if id(item) not in removed]


def _complete_dotted_quarter_chords(image, notes):
    """Restore a shared duration when a dot sits between adjacent staff steps."""
    ink = np.asarray(image.convert("L")) < 128
    quarters = [note for note in notes if note["cls"] == "note_quarter"]
    dotted = [note for note in quarters if "dot_box" in note]
    for note in quarters:
        if note["dur"] != 1.0:
            continue
        for edge in (0, 2):
            stem = round(note["box"][edge])
            if any(
                abs(head["box"][edge] - stem) <= 3
                and ink[min(round(head["cy"]), round(note["cy"])):
                        max(round(head["cy"]), round(note["cy"])),
                        max(0, stem - 3):stem + 4].any(axis=1).all()
                for head in dotted
            ):
                note["dur"] = 1.5
                break


def _boundary_pitches(chord, curves, spacing, incoming):
    """Assign each open curve to its nearest head in the boundary chord."""
    assignments = []
    for curve in sorted(curves, key=lambda c: c["cy"]):
        candidates = []
        for head in chord:
            if head.get("is_rest"):
                continue
            left, top, right, bottom = head["box"]
            edge_gap = (left - curve["box"][2]) if incoming else (curve["box"][0] - right)
            vertical_gap = abs(curve["cy"] - head["cy"])
            extends_outward = curve["cx"] < left if incoming else curve["cx"] > right
            if extends_outward and abs(edge_gap) <= spacing and vertical_gap <= spacing * 1.4:
                candidates.append((vertical_gap, abs(edge_gap), head["pitch"]))
        if candidates:
            assignments.append(candidates)
    # Adjacent chord tones have stacked curves. Match their vertical order
    # when the detector returned one compatible curve per head.
    pitches = sorted({pitch for candidates in assignments for _, _, pitch in candidates}, reverse=True)
    if len(assignments) == len(pitches) and all(
        any(candidate[2] == pitch for candidate in candidates)
        for pitch, candidates in zip(pitches, assignments)
    ):
        return sorted(pitches)
    return sorted({min(candidates)[2] for candidates in assignments})


def _propagate_shared_stem_dots(shared_stems):
    """An augmentation dot belongs to every head that shares the flagged stem."""
    for stem in shared_stems:
        dotted_values = {note["dur"] for note in stem if "dot_box" in note}
        for note in stem:
            if "dot_box" not in note and note["dur"] * 1.5 in dotted_values:
                note["dur"] *= 1.5



def _curve_horizontally_spans(curve: dict, left: dict, right: dict) -> bool:
    """True when a curve starts at the left head (or its dot) and reaches the right head."""
    dot = left.get("dot_box")
    starts_at_dot = dot is not None and (
        curve["box"][0] <= dot[2] and curve["box"][2] >= dot[0]
    )
    if curve["box"][0] > left["box"][2] + 12 and not starts_at_dot:
        return False
    right_edge = right.get("tie_left", right["box"][0])
    if curve["box"][2] < right_edge - 12:
        return False
    return True


def _stacked_tie_pitches(
    left_chord: list[dict],
    right_chord: list[dict],
    curves: list[dict],
    spacing: float,
) -> set[int]:
    """Assign a stack of mid-line ties by vertical order, not box-center distance.

    A downward-bowing tie has its detection center closer to the neighbor
    below, so a pairwise cy test can drop the upper pitch even when the
    printed arc clearly starts on that head. When the detector returned one
    spanning curve per continued pitch, the top curve belongs to the top
    pitch. If the counts differ, invent nothing.
    """
    lefts = [note for note in left_chord if not note.get("is_rest")]
    rights = [note for note in right_chord if not note.get("is_rest")]
    left_by_pitch: dict[int, list[dict]] = {}
    right_by_pitch: dict[int, list[dict]] = {}
    for note in lefts:
        left_by_pitch.setdefault(int(note["pitch"]), []).append(note)
    for note in rights:
        right_by_pitch.setdefault(int(note["pitch"]), []).append(note)
    common = [
        (pitch, left_by_pitch[pitch][0], right_by_pitch[pitch][0])
        for pitch in left_by_pitch
        if pitch in right_by_pitch
        and len(left_by_pitch[pitch]) == 1
        and len(right_by_pitch[pitch]) == 1
    ]
    if len(common) < 2:
        return set()

    def spanning_for(members):
        ys = [head["cy"] for _, left, right in members for head in (left, right)]
        y_lo, y_hi = min(ys) - spacing * 2, max(ys) + spacing * 2
        return [
            curve for curve in curves
            if y_lo <= curve["cy"] <= y_hi
            and any(_curve_horizontally_spans(curve, left, right) for _, left, right in members)
        ]

    members = sorted(common, key=lambda item: min(item[1]["cy"], item[2]["cy"]))
    spanning = spanning_for(members)
    # If the highest remaining curve sits below the second-highest pitch, it
    # cannot belong to the top note. Drop that pitch rather than invent a tie
    # when an extra lower curve happens to make the counts match.
    while len(members) >= 2 and spanning:
        second_cy = min(members[1][1]["cy"], members[1][2]["cy"])
        top_curve_cy = min(curve["cy"] for curve in spanning)
        if top_curve_cy <= second_cy:
            break
        members = members[1:]
        spanning = spanning_for(members)
    if len(members) < 2 or len(spanning) != len(members):
        return set()
    return {pitch for pitch, _, _ in members}


def _group_and_time(
    items: list[dict],
    curves: list[dict],
    spacing: float,
    boundary: dict | None = None,
    extra_boundary_curves: tuple = (),
) -> list[dict]:
    items = sorted(items, key=lambda n: (n.get("column_x", n["cx"]), n["cy"]))
    x_tol = max(18.0, spacing * 1.2)
    chords: list[list[dict]] = []
    # A rest and a note at nearly the same x are two voices at one onset,
    # not a serial "rest then note". Isolating rests used to put a held
    # tenor after a 16th rest, then the bass, and double the staff's length.
    # A displaced second may sit on the opposite side of a shared stem;
    # group it by the stem column rather than the head's own x.

    def col_x(note: dict) -> float:
        return float(note.get("column_x", note["cx"]))

    for n in items:
        if (
            not chords
            or abs(col_x(n) - float(np.mean([col_x(m) for m in chords[-1]]))) > x_tol
        ):
            chords.append([n])
        else:
            chords[-1].append(n)

    # Use both localizations of a curve when the expanded view corroborates
    # one already detected in the tight crop. The expanded view can also see
    # slurs that the tight crop cut away, for example a ledger-line arc just
    # below the seam. Those may form in-line ties when they sit next to this
    # staff's noteheads. Marks from the neighboring staff stay far in y and
    # must not invent local ties.
    # Tight-crop curves keep their own localizations for in-line ties.
    # Corroborating expanded boxes are used only for tiesIn/tiesOut, so a
    # slightly shifted center cannot newly grab a neighboring pitch. A mark
    # that the tight crop missed (ledger slurs below a seam, a stacked arc
    # the larger view separates) may form an in-line tie if it sits next to
    # this staff, but only for the nearest pitch.
    tie_curves = list(curves)
    note_heads = [n for n in items if not n.get("is_rest")]
    exclusive_ids: set[int] = set()
    for extra in extra_boundary_curves:
        left, top, right, bottom = extra["box"]
        area = (right - left) * (bottom - top)
        overlaps_tight = any(
            max(0, min(right, box[2]) - max(left, box[0]))
            * max(0, min(bottom, box[3]) - max(top, box[1])) > area / 2
            for box in (curve["box"] for curve in curves)
        )
        close_to_staff = any(
            abs(float(extra["cy"]) - float(n["cy"])) <= spacing * 1.4 for n in note_heads
        )
        if not overlaps_tight and close_to_staff:
            rec = dict(extra)
            tie_curves.append(rec)
            exclusive_ids.add(id(rec))

    def _chord_of(note: dict) -> list[dict]:
        for chord in chords:
            if note in chord:
                return [item for item in chord if not item.get("is_rest")]
        return [note]

    def linked(a: dict, b: dict) -> bool:
        if a.get("is_rest") or b.get("is_rest"):
            return False
        if a["pitch"] != b["pitch"]:
            return False
        left, right = (a, b) if a["cx"] <= b["cx"] else (b, a)
        neighbors = [
            head for head in _chord_of(left) + _chord_of(right)
            if int(head["pitch"]) != int(a["pitch"])
        ]
        for c in tie_curves:
            if not _curve_horizontally_spans(c, left, right):
                continue
            if abs(c["cy"] - left["cy"]) <= spacing * 1.4 and abs(c["cy"] - right["cy"]) <= spacing * 1.4:
                if id(c) in exclusive_ids and any(
                    abs(c["cy"] - float(head["cy"])) < min(
                        abs(c["cy"] - float(left["cy"])),
                        abs(c["cy"] - float(right["cy"])),
                    )
                    for head in neighbors
                ):
                    continue
                return True
        return False

    events = []
    previous = []
    t = 0.0
    end = 0.0
    for ch in chords:
        durs = [n["dur"] for n in ch]
        # Rest + note at one x: the rest belongs to the other voice, so the
        # cursor advances by the rest (or the shortest symbol), not the held
        # note. Same-voice chords (all notes, or a lone rest) still use max.
        # Advance by the printed values even if every head is a tie
        # continuation; a later segment can still extend the same event.
        if any(n.get("is_rest") for n in ch) and any(not n.get("is_rest") for n in ch):
            adv = min(durs)
        else:
            adv = max(durs)
        current = []
        stacked = _stacked_tie_pitches([prior for prior, _ in previous], ch, tie_curves, spacing)
        for note in ch:
            if note.get("is_rest"):
                continue
            event = next(
                (
                    event
                    for prior, event in previous
                    if event["start"] + event["dur"] == t
                    and (
                        linked(prior, note)
                        or (prior["pitch"] == note["pitch"] and int(note["pitch"]) in stacked)
                    )
                ),
                None,
            )
            if event is None:
                event = {"pitch": int(note["pitch"]), "start": float(t), "dur": float(note["dur"])}
                events.append(event)
            else:
                event["dur"] += note["dur"]
            current.append((note, event))
        previous = current
        end = max(end, t + max(n["dur"] for n in ch))
        t += adv
    events.sort(key=lambda e: (e["start"], e["pitch"]))
    if boundary is not None:
        def boundary_pitches(chord, incoming):
            primary = _boundary_pitches(chord, curves, spacing, incoming)
            extra = _boundary_pitches(chord, extra_boundary_curves, spacing, incoming)
            return sorted(set(primary).union(extra))

        boundary.update(
            duration=end,
            tiesIn=boundary_pitches(chords[0], incoming=True) if chords else [],
            tiesOut=boundary_pitches(chords[-1], incoming=False) if chords else [],
        )
    return events



def _clef_kind(clef: str | None) -> str:
    c = (clef or "G2").upper()
    if c.startswith("F") or c in {"BASS"}:
        return "F"
    return "G"


def group_staves_into_systems(staves: list[dict]) -> list[list[dict]]:
    """Cluster 5-line staves into musical systems, top to bottom.

    A piano grand staff is a treble staff immediately above a bass staff
    with a small gap (a few staff-heights). Two treble staves, or staves
    separated by a large gap, are successive systems and must be read
    in order rather than overlaid in time. Clefs are the discriminator:
    inter-system gaps on tightly engraved single-staff pages can be in
    the same range as an intra-grand-staff gap.
    """
    if not staves:
        return []
    ordered = sorted(staves, key=lambda s: s["mid"])
    systems: list[list[dict]] = []
    i = 0
    while i < len(ordered):
        cur = ordered[i]
        if i + 1 < len(ordered):
            nxt = ordered[i + 1]
            gap = nxt["top"] - cur["bot"]
            staff_h = max(cur["bot"] - cur["top"], 4.0 * float(cur.get("spacing") or 1.0))
            close = gap <= 3.5 * staff_h
            if (
                close
                and _clef_kind(cur.get("clef")) == "G"
                and _clef_kind(nxt.get("clef")) == "F"
            ):
                systems.append([cur, nxt])
                i += 2
                continue
        systems.append([cur])
        i += 1
    return systems


def stitch_system_events(system_event_lists: list[list[dict]], bar: float = 4.0) -> list[dict]:
    """Concatenate successive systems in reading order.

    Events in one system (including a grand-staff pair that already shares
    a local start of 0) keep their relative times. The next system starts
    at the next barline at or after the previous system's end, so a missed
    trailing rest does not shift the following system early. Mid-bar system
    breaks are rare in the page images this path serves.
    """
    all_events: list[dict] = []
    offset = 0.0
    bar = float(bar) if bar and bar > 0 else 4.0
    for evs in system_event_lists:
        if not evs:
            continue
        shifted = []
        for e in evs:
            ne = dict(e)
            ne["start"] = float(e["start"]) + offset
            shifted.append(ne)
        all_events.extend(shifted)
        end = max(float(e["start"]) + float(e["dur"]) for e in shifted)
        local = end - offset
        n_bars = max(1, int(round(local / bar + 1e-9)))
        if n_bars * bar < local - 1e-9:
            n_bars += 1
        offset += n_bars * bar
    all_events.sort(key=lambda e: (e["start"], e["pitch"]))
    return all_events



def align_stacked_sixteenth_rests(group: list[dict], by_staff: dict[int, list[dict]]) -> None:
    """Correct a 16th rest that was classed as an eighth, when an eighth would overfill.

    On a piano grand staff the two hands often share a stacked rest at the
    same x. The detector sometimes drops the second flag of a 16th rest and
    reports it as an eighth. If the partner is a 16th and the following
    notes on that staff are sixteenths whose lengths plus an eighth would
    overfill a half-bar (more than 2.0), treat the longer rest as a 16th.
    A genuine eighth rest followed by sixteenths that already fill the
    half-bar (eighth + 1.5 = 2.0), or followed by longer notes, is left
    alone. Different voices may start together and still have different
    rest lengths. This does not key off a title or filename.
    """
    if len(group) != 2:
        return
    tr, ba = group[0], group[1]
    if _clef_kind(tr.get("clef")) != "G" or _clef_kind(ba.get("clef")) != "F":
        return
    spacing = float(tr.get("spacing") or ba.get("spacing") or 14.0)
    x_tol = max(18.0, spacing * 1.2)
    rests_a = [n for n in by_staff.get(id(tr), []) if n.get("is_rest")]
    rests_b = [n for n in by_staff.get(id(ba), []) if n.get("is_rest")]
    used: set[int] = set()
    for ra in rests_a:
        partner = None
        best = None
        for rb in rests_b:
            if id(rb) in used:
                continue
            dx = abs(float(ra["cx"]) - float(rb["cx"]))
            if dx <= x_tol and (best is None or dx < best):
                partner = rb
                best = dx
        if partner is None:
            continue
        used.add(id(partner))
        durs = {float(ra["dur"]), float(partner["dur"])}
        if durs != {0.25, 0.5}:
            continue
        longer = ra if float(ra["dur"]) > float(partner["dur"]) else partner
        staff_items = by_staff[id(tr)] if longer is ra else by_staff[id(ba)]
        next_rest_x = [
            float(n["cx"])
            for n in staff_items
            if n.get("is_rest") and float(n["cx"]) > float(longer["cx"]) + 1
        ]
        limit = min(next_rest_x) if next_rest_x else float("inf")
        following = [
            n
            for n in staff_items
            if not n.get("is_rest")
            and float(longer["cx"]) < float(n["cx"]) < limit
            and "dur" in n
        ]
        if not following:
            continue
        following_dur = sum(float(n["dur"]) for n in following)
        # Eighth + following notes should not run past a half-bar. If they
        # would, the "eighth" is a 16th with a dropped flag. If they fill
        # exactly (or fall short, e.g. a missed note still to recover),
        # keep the eighth.
        if following_dur <= 1.5 + 1e-9:
            continue
        if all(float(n["dur"]) <= 0.25 for n in following):
            longer["dur"] = 0.25
            if longer.get("cls") in {"rest_eighth", "rest_8th"}:
                longer["cls"] = "rest_16th"



def _beam_staff(beam: dict, systems: list[dict]) -> dict | None:
    """Staff a beam belongs to, including a stems-down beam just below it."""
    if not systems:
        return None
    cy = float(beam["cy"])
    for i, s in enumerate(systems):
        top_allow = s["top"] - 3 * s["spacing"]
        bot_allow = s["bot"] + 4 * s["spacing"]
        nxt_top = systems[i + 1]["top"] if i + 1 < len(systems) else float("inf")
        if top_allow <= cy <= min(bot_allow, nxt_top - 2):
            return s
    return min(systems, key=lambda s: abs(s["mid"] - cy))


def _filled_notehead_at(gray: Image.Image, x: float, y: float, spacing: float) -> bool:
    """True if a compact filled notehead is centered near (x, y)."""
    w, h = gray.size
    px = gray.load()
    half_w = max(4, int(round(spacing * 0.55)))
    half_h = max(3, int(round(spacing * 0.45)))
    xi, yi = int(round(x)), int(round(y))
    if not (half_w <= xi < w - half_w and half_h <= yi < h - half_h):
        return False
    dark = 0
    total = 0
    for dy in range(-half_h, half_h + 1):
        for dx in range(-half_w, half_w + 1):
            total += 1
            if px[xi + dx, yi + dy] < 80:
                dark += 1
    core = [px[xi + dx, yi + dy] for dy in range(-2, 3) for dx in range(-2, 3)]
    # A filled head is a dark blob. A bare stem or staff line is a thin
    # dark run and fails the fill fraction. A beam is dark far to both
    # sides of the candidate x; a notehead is not.
    if (dark / total) < 0.35 or (sum(core) / len(core)) >= 40:
        return False
    wing = max(8, int(round(spacing * 1.6)))
    if 0 <= xi - wing < w and 0 <= xi + wing < w:
        if px[xi - wing, yi] < 80 and px[xi + wing, yi] < 80:
            return False
    return True


def recover_missing_beamed_noteheads(
    image: Image.Image,
    beams: list[dict],
    by_staff: dict[int, list[dict]],
    systems: list[dict],
    key: str,
) -> None:
    """Add a 16th when a beam has a clear filled notehead in a gap.

    Detectors sometimes skip a mid-beam notehead while still reporting
    the beam and its neighbors. Filling that hole from ink + beam
    geometry is assembly, not a model change. Only a double-wide gap
    between two 16ths on the same beam, with a compact dark head on a
    staff position, is accepted. This does not key off a title or filename.
    """
    if not beams or not systems:
        return
    gray = image.convert("L")
    for beam in beams:
        staff = _beam_staff(beam, systems)
        if staff is None:
            continue
        items = by_staff.get(id(staff))
        if not items:
            continue
        spacing = float(staff["spacing"])
        bx0, bx1 = float(beam["box"][0]), float(beam["box"][2])
        pad = max(10.0, spacing * 0.8)
        notes = [
            n
            for n in items
            if not n.get("is_rest")
            and float(n.get("dur") or 0) <= 0.25 + 1e-9
            and (bx0 - pad) <= float(n["cx"]) <= (bx1 + pad)
        ]
        notes.sort(key=lambda n: n["cx"])
        if len(notes) < 2:
            continue
        gaps = [float(notes[i + 1]["cx"]) - float(notes[i]["cx"]) for i in range(len(notes) - 1)]
        added = 0
        for i, gap in enumerate(gaps):
            if added >= 2:
                break
            others = gaps[:i] + gaps[i + 1 :]
            if others:
                ref = float(np.median(np.array(others, dtype=float)))
                if gap < 1.6 * max(ref, spacing * 0.8):
                    continue
            elif gap < spacing * 3.0:
                # A lone pair is usually a two-note beam, not a missing mid note.
                continue
            mid_x = (float(notes[i]["cx"]) + float(notes[i + 1]["cx"])) / 2.0
            near = spacing * 0.9 if not others else max(ref, spacing) * 0.45
            if any(abs(float(n["cx"]) - mid_x) < near for n in notes):
                continue
            best = None
            # Scan a little around the midpoint; the hole is about one
            # note wide, so the head should sit near the center.
            xs = [mid_x + k * (spacing * 0.25) for k in (-1, -0.5, 0, 0.5, 1)]
            beam_y0, beam_y1 = float(beam["box"][1]), float(beam["box"][3])
            for pos in range(-10, 11):
                y = staff["lines"][2] - pos * (spacing / 2.0)
                # A stems-down beam is a wide dark bar; do not treat it as a head.
                if beam_y0 - spacing * 0.6 <= y <= beam_y1 + spacing * 0.3:
                    continue
                for x in xs:
                    if not _filled_notehead_at(gray, x, y, spacing):
                        continue
                    if any(
                        abs(float(n["cy"]) - y) < spacing * 0.4
                        and abs(float(n["cx"]) - x) < spacing * 1.2
                        for n in notes
                    ):
                        continue
                    # Prefer the x closest to the gap midpoint.
                    score = abs(x - mid_x)
                    if best is None or score < best[0]:
                        best = (score, pos, x, y)
            if best is None:
                continue
            _, pos, x, y = best
            rec = {
                "cls": "note_16th",
                "box": [x - spacing * 0.65, y - spacing * 0.5, x + spacing * 0.65, y + spacing * 0.5],
                "cx": float(x),
                "cy": float(y),
                "conf": 0.0,
                "pos": int(pos),
                "pitch": midi_from_pos(int(pos), key, staff.get("clef") or "G2"),
                "dur": 0.25,
                "dot": False,
                "recovered": True,
            }
            items.append(rec)
            notes.append(rec)
            notes.sort(key=lambda n: n["cx"])
            added += 1


def _pair_tuplet_brackets(marks: list[dict], spacing: float) -> list[tuple[dict, dict]]:
    """Pair a left tuplet-bracket end with the nearest right end to its right."""
    lefts = [m for m in marks if m["cls"] == "spanEnd_tl"]
    rights = [m for m in marks if m["cls"] == "spanEnd_tr"]
    used: set[int] = set()
    pairs: list[tuple[dict, dict]] = []
    for tl in sorted(lefts, key=lambda m: m["cx"]):
        best = None
        for i, tr in enumerate(rights):
            if i in used or tr["cx"] <= tl["cx"]:
                continue
            if abs(tr["cy"] - tl["cy"]) > spacing * 2.0:
                continue
            dx = tr["cx"] - tl["cx"]
            if best is None or dx < best[0]:
                best = (dx, i, tr)
        if best is not None:
            used.add(best[1])
            pairs.append((tl, best[2]))
    return pairs

def _tuplet_numerals(marks: list[dict], staff: dict, spacing: float) -> list[dict]:
    """Printed tuplet numbers, not a tuplet_3 sitting on a notehead."""
    top = float(staff["top"])
    nums: list[dict] = []
    for m in marks:
        cls = m["cls"]
        if cls == "tupletNum":
            nums.append(m)
        elif cls == "tuplet_3" and m["cy"] <= top - 0.2 * spacing:
            nums.append(m)
    return nums

def _notes_in_span(items: list[dict], x0: float, x1: float, pad: float) -> list[dict]:
    notes = [
        n
        for n in items
        if not n.get("is_rest") and (x0 - pad) <= float(n["cx"]) <= (x1 + pad)
    ]
    notes.sort(key=lambda n: n["cx"])
    return notes

def _recover_incomplete_tuplet_heads(
    items: list[dict],
    marks: list[dict],
    staff: dict,
    key: str,
) -> None:
    """If a 3-tuplet bracket only has two heads, promote a mid-span leftover."""
    spacing = float(staff["spacing"])
    pad = max(6.0, spacing * 0.4)
    numerals = _tuplet_numerals(marks, staff, spacing)
    if not numerals:
        return
    leftovers = [
        m
        for m in marks
        if m["cls"] == "tuplet_3" and m not in numerals
    ]
    top, bot = float(staff["top"]), float(staff["bot"])
    for tl, tr in _pair_tuplet_brackets(marks, spacing):
        x0, x1 = float(tl["box"][0]), float(tr["box"][2])
        if not any(x0 - pad <= n["cx"] <= x1 + pad for n in numerals):
            continue
        notes = _notes_in_span(items, x0, x1, pad)
        if len(notes) != 2:
            continue
        left, right = notes
        mid_x = (left["cx"] + right["cx"]) / 2.0
        best = None
        for m in leftovers:
            if not (left["cx"] + pad <= m["cx"] <= right["cx"] - pad):
                continue
            if m["cy"] < top - spacing or m["cy"] > bot + 4 * spacing:
                continue
            if m["cy"] <= min(tl["cy"], tr["cy"]) + spacing * 0.4:
                continue
            score = abs(m["cx"] - mid_x)
            if best is None or score < best[0]:
                best = (score, m)
        if best is None:
            continue
        m = best[1]
        leftovers.remove(m)
        pos = pos_from_cy(m["cy"], staff["lines"])
        cls = left["cls"] if left.get("cls") == right.get("cls") else "note_eighth"
        dur = DUR_CLASS.get(cls, 0.5)
        items.append(
            {
                "cls": cls,
                "box": list(m["box"]),
                "cx": float(m["cx"]),
                "cy": float(m["cy"]),
                "conf": float(m.get("conf") or 0),
                "pos": int(pos),
                "pitch": midi_from_pos(int(pos), key, staff.get("clef") or "G2"),
                "dur": float(dur),
                "dot": False,
                "recovered": True,
            }
        )

def _apply_printed_tuplets(items: list[dict], marks: list[dict], staff: dict) -> None:
    """Scale a group of three notes under a printed 3 (3:2)."""
    if not items or not marks:
        return
    spacing = float(staff["spacing"])
    pad = max(6.0, spacing * 0.4)
    numerals = _tuplet_numerals(marks, staff, spacing)
    if not numerals:
        return
    used: set[int] = set()

    def scale(notes: list[dict]) -> None:
        if len(notes) != 3:
            return
        for n in notes:
            if id(n) in used:
                return
        for n in notes:
            n["dur"] = float(n["dur"]) * 2.0 / 3.0
            n["tuplet"] = (3, 2)
            used.add(id(n))

    for tl, tr in _pair_tuplet_brackets(marks, spacing):
        x0, x1 = float(tl["box"][0]), float(tr["box"][2])
        if not any(x0 - pad <= n["cx"] <= x1 + pad for n in numerals):
            continue
        scale(_notes_in_span(items, x0, x1, pad))

    for num in numerals:
        remaining = [n for n in items if not n.get("is_rest") and id(n) not in used]
        if not remaining:
            continue
        remaining.sort(key=lambda n: abs(n["cx"] - num["cx"]))
        under = [n for n in remaining if abs(n["cx"] - num["cx"]) <= spacing * 1.6]
        if not under:
            continue
        seed = min(under, key=lambda n: abs(n["cx"] - num["cx"]))
        cluster = sorted(remaining, key=lambda n: n["cx"])
        if seed not in cluster:
            continue
        i = cluster.index(seed)
        cands = []
        for a in range(max(0, i - 2), i + 1):
            b = a + 3
            if b <= len(cluster):
                trio = cluster[a:b]
                if seed in trio:
                    width = trio[-1]["cx"] - trio[0]["cx"]
                    cands.append((width, trio))
        if not cands:
            continue
        cands.sort(key=lambda t: t[0])
        trio = cands[0][1]
        if trio[-1]["cx"] - trio[0]["cx"] > spacing * 8.0:
            continue
        scale(trio)



def _keep_staff_note(note: dict, staff: dict) -> bool:
    """Keep noteheads that belong to this staff, including high piano ledgers.

    A6 sits about 4.5 staff-spaces above a treble top line (F5), so a 4-space
    cutoff drops printed G6/A6. Crop leftovers from the staff above almost
    always touch the top edge of a tight line crop (the L13 E7 speck at y≈5).
    Bass ledgers stay generous.
    """
    spacing = float(staff.get("spacing") or 1.0)
    top = float(staff["top"])
    bot = float(staff["bot"])
    cy = float(note["cy"])
    y0 = float(note["box"][1])
    if cy > bot + 12 * spacing:
        return False
    # About E7 on a G clef; higher than that is not a normal ledger of this staff.
    if cy < top - 7 * spacing:
        return False
    # Clipped remnant of the previous staff, sitting on the crop's top edge.
    if cy < top - 4 * spacing and y0 < 0.5 * spacing:
        return False
    return True


def events_from_dets(
    image: Image.Image,
    dets: list[dict],
    bar_x0: float,
    bar_x1: float,
    key: str | None = "G",
    staff_x0: float | None = None,
    staff_x1: float | None = None,
    line_boundary: dict | None = None,
    boundary_dets: tuple = (),
) -> list[dict]:
    sx0 = bar_x0 if staff_x0 is None else staff_x0
    sx1 = bar_x1 if staff_x1 is None else staff_x1
    if sx1 - sx0 <= 80:
        sx0, sx1 = 0, image.width
    systems = find_staff_systems(image, sx0, sx1)
    _assign_clefs(systems, dets)
    clipped = _staffs_in_clipped_braces(dets, systems, image.height)
    if key is None:
        key = infer_key(dets)

    notes, rests, dots, curves, barlines, beams, tuplet_marks, flags, measures = [], [], [], [], [], [], [], [], []
    accidental_alters = {f"accid_{kind}": alter for kind, alter in (
        ("sharp", 1), ("flat", -1), ("natural", 0), ("dsharp", 2), ("dflat", -2)
    )}
    accidentals = []
    extra_boundary_curves = []
    for detection in boundary_dets:
        box = _xy(detection)
        extra_boundary_curves.append({
            "box": box, "cx": (box[0] + box[2]) / 2, "cy": (box[1] + box[3]) / 2,
        })
    for d in dets:
        cls = str(d.get("cls", ""))
        box = _xy(d)
        cx, cy = (box[0] + box[2]) / 2.0, (box[1] + box[3]) / 2.0
        rec = {"cls": cls, "box": box, "cx": cx, "cy": cy, "conf": float(d.get("conf") or 0)}
        if cls in DUR_CLASS:
            notes.append(rec)
        elif cls in REST_CLASS:
            rec["is_rest"] = True
            rec["dur"] = REST_CLASS[cls]
            rec["dot"] = False
            rests.append(rec)
        elif cls.startswith("dots"):
            dots.append(rec)
        elif cls == "curve":
            curves.append(rec)
        elif _is_barline(cls):
            barlines.append(rec)
        elif cls == "measure":
            measures.append(rec)
        elif cls == "beam":
            beams.append(rec)
        elif cls == "flag":
            flags.append(rec)
        elif cls in accidental_alters:
            accidentals.append(dict(rec, alter=accidental_alters[cls]))
        elif cls in {"tupletNum", "tuplet_3", "spanEnd_tl", "spanEnd_tr"}:
            tuplet_marks.append(rec)

    _add_measure_boundary_barlines(
        barlines, measures, image.width,
        systems[0]["spacing"] if systems else 15.0,
    )

    lefts = [b["cx"] for b in barlines if b["cx"] <= bar_x0 + 20]
    rights = [b["cx"] for b in barlines if b["cx"] >= bar_x1 - 20]
    x_lo = max(lefts) if lefts else bar_x0
    x_hi = min(rights) if rights else bar_x1

    by_staff: dict[int, list[dict]] = {id(s): [] for s in systems}
    for n in notes + rests:
        if not (x_lo - 2 <= n["cx"] <= x_hi + 2):
            continue
        staff = assign_symbol_to_staff(n["cy"], bool(n.get("is_rest")), systems)
        if not _keep_staff_note(n, staff):
            continue
        if n.get("is_rest"):
            by_staff[id(staff)].append(n)
            continue
        n["pos"] = pos_from_cy(n["cy"], staff["lines"])
        n["pitch"] = midi_from_pos(n["pos"], key, staff["clef"])
        n["dur"] = DUR_CLASS[n["cls"]]
        n["dot"] = False
        by_staff[id(staff)].append(n)

    recover_missing_beamed_noteheads(image, beams, by_staff, systems, key or "C")

    shared_stems = _read_shared_stem_flags(
        image, flags, [note for items in by_staff.values() for note in items]
    )
    for items in by_staff.values():
        shared_stems.extend(_read_shared_quarter_stems(image, items, flags))

    system_event_lists: list[list[dict]] = []
    for group in group_staves_into_systems(systems):
        if len(group) == 1 and id(group[0]) in clipped:
            continue
        align_stacked_sixteenth_rests(group, by_staff)
        sys_events: list[dict] = []
        for s in group:
            items = by_staff[id(s)]
            if not items:
                continue
            _recover_incomplete_tuplet_heads(items, tuplet_marks, s, key or "C")
            _apply_written_accidentals(
                items, s,
                [mark for mark in accidentals if _nearest_staff(mark["cy"], systems) is s],
                [bar["cx"] for bar in barlines
                 if bar["box"][1] <= s["mid"] <= bar["box"][3]],
            )
            _attach_dots(items, dots, s["spacing"])
            _propagate_shared_stem_dots(shared_stems)
            _merge_shared_stem_unisons(image, items)
            _complete_dotted_quarter_chords(image, items)
            _apply_printed_tuplets(items, tuplet_marks, s)
            evs = _group_and_time(
                items,
                curves,
                s["spacing"],
                boundary=(line_boundary if len(systems) == 1 else None),
                extra_boundary_curves=extra_boundary_curves,
            )
            clef = s.get("clef") or "G2"
            for e in evs:
                e["clef"] = clef
            sys_events.extend(evs)
        if sys_events:
            sys_events.sort(key=lambda e: (e["start"], e["pitch"]))
            system_event_lists.append(sys_events)
    return stitch_system_events(system_event_lists)


def events_for_user_crop(image_path: Path, dets_path: Path, bar_box: list, key: str | None = "G"):
    im = Image.open(image_path).convert("RGB")
    dets = load_dets(dets_path)
    x0, x1 = bar_box[0], bar_box[2]
    return events_from_dets(im, dets, x0, x1, key=key, staff_x0=0, staff_x1=im.width)



# How far a second, curve-only detector view reaches past a tight line cut.
# Two staff-spaces covers the ledger slurs that the seam cuts through, without
# reaching the body of the next staff on the pages this path serves.
LINE_BOUNDARY_EXPAND_SPACES = 2.0
# Long stacks of single staves are read as engraved lines. Short piano excerpts
# (a grand staff or two) stay on the full-page detection path.
ENGRAVED_LINE_MIN_STAVES = 8


def engraved_line_boxes(image: Image.Image, staves: list[dict]) -> list[tuple[int, int, int, int]]:
    """Place cuts in the lightest strip between adjacent staff bodies."""
    ink_mask = np.asarray(image.convert("L")) < 230
    ink = np.count_nonzero(ink_mask, axis=1)

    def seam(top, bottom, spacing):
        if bottom <= top:
            return top
        radius = max(1, round(spacing / 3))

        def cut_cost(y):
            # A thin stem can have less ink than nearby disconnected markings.
            # Prefer cuts that leave vertical strokes intact.
            strip = ink_mask[max(0, y - radius):y + radius + 1]
            crossing = np.count_nonzero(np.all(strip, axis=0))
            strip_ink = int(ink[max(0, y - 1):y + 2].sum())
            return crossing, strip_ink, abs(y - (top + bottom) / 2)

        return min(range(top, bottom), key=cut_cost)

    first = staves[0]
    upper_margin = max(0, int(first["top"] - 8 * first["spacing"]))
    bounds = [seam(upper_margin, int(first["top"]), first["spacing"])]
    bounds.extend(
        seam(int(a["bot"]) + 1, int(b["top"]), min(a["spacing"], b["spacing"]))
        for a, b in zip(staves, staves[1:])
    )
    bounds.append(image.height)
    return [(0, top, image.width, bottom) for top, bottom in zip(bounds, bounds[1:])]


def expand_line_box(box: tuple[int, int, int, int], spacing: float, image_size: tuple[int, int], spaces: float = LINE_BOUNDARY_EXPAND_SPACES) -> tuple[int, int, int, int]:
    """Grow a tight line cut so slurs at the seam stay inside a second view."""
    left, top, right, bottom = box
    pad = max(1, int(round(spaces * spacing)))
    width, height = image_size
    return (
        max(0, int(left)),
        max(0, int(top)),
        min(int(width), int(right)),
        min(int(height), int(bottom) + pad),
    )


def page_uses_engraved_line_reads(image: Image.Image, dets: list[dict] | None = None) -> bool:
    """True when the page is a stack of single staves, not a piano grand staff.

    Frozen-detection unit tests keep calling events_for_page without live
    detection, so this is only used by the live product path.
    """
    systems = find_staff_systems(image, 0, image.width)
    if len(systems) < 2:
        return False
    if dets:
        _assign_clefs(systems, dets)
        groups = group_staves_into_systems(systems)
        return len(groups) >= 2 and all(len(group) == 1 for group in groups)
    return len(systems) >= ENGRAVED_LINE_MIN_STAVES


def join_engraved_line_events(lines: list[dict], bar: float = 4.0) -> list[dict]:
    """Join successive single-staff lines, extending only printed end ties.

    Offsets snap to the next barline, like stitch_system_events, so a missed
    trailing rest does not shift later lines. A pitch is joined across the
    cut only when the earlier line's tiesOut and the next line's tiesIn both
    name it; this does not invent a slur.
    """
    all_events: list[dict] = []
    offset = 0.0
    bar = float(bar) if bar and bar > 0 else 4.0
    ties_out: list[int] = []
    for line in lines:
        evs = [dict(event) for event in line.get("events") or []]
        shared = set(ties_out).intersection(line.get("tiesIn") or [])
        ending = {
            event["pitch"]: event
            for event in all_events
            if event["pitch"] in shared
            and abs(float(event["start"]) + float(event["dur"]) - offset) <= 1e-9
        }
        for event in evs:
            prior = ending.pop(event["pitch"], None) if abs(float(event["start"])) <= 1e-9 else None
            if prior is not None:
                prior["dur"] = float(prior["dur"]) + float(event["dur"])
            else:
                new_event = dict(event)
                new_event["start"] = offset + float(event["start"])
                all_events.append(new_event)
        local = float(line.get("duration") or 0.0)
        if evs:
            local = max(local, max(float(e["start"]) + float(e["dur"]) for e in evs))
        if local > 0:
            n_bars = max(1, int(round(local / bar + 1e-9)))
            if n_bars * bar < local - 1e-9:
                n_bars += 1
            offset += n_bars * bar
        ties_out = list(line.get("tiesOut") or [])
    all_events.sort(key=lambda e: (e["start"], e["pitch"]))
    return all_events


def _ensure_copisteria() -> None:
    try:
        import copisteria  # noqa: F401
        return
    except ImportError:
        pass
    try:
        from copisteria_focus import ensure_copisteria_on_path
        ensure_copisteria_on_path()
    except Exception:
        import copisteria  # noqa: F401


def _load_page_detector():
    try:
        from geom_omr_server import load_detector
        detector = load_detector()
        if detector is not None:
            return detector
    except Exception:
        pass
    _ensure_copisteria()
    from copisteria.detect import Detector
    from copisteria.paths import DETECTOR
    return Detector(DETECTOR, device="cpu")


def _detections_on_view(detector, view: Image.Image, size: int, source_width: int | None = None) -> list[dict]:
    arr, scale = detector.prepare(view, size)
    detections = detector.run_array(arr, scale)
    if source_width is None:
        return detections
    return [
        det for det in detections
        if (det["xyxy"][0] + det["xyxy"][2]) / 2 < source_width
    ]


def detect_line_symbols(crop: Image.Image, spacing: float, detector) -> list[dict]:
    """Official per-line sizing: a 2048 pass, then the spacing-based size."""
    _ensure_copisteria()
    from copisteria.detect import IMGSZ_MIN, TARGET_SP, imgsz_for, measure_space, staff_space

    width_at_minimum = round(IMGSZ_MIN * spacing / TARGET_SP)
    padding = width_at_minimum - crop.width if width_at_minimum > max(crop.size) else 0
    from PIL import ImageOps
    view = ImageOps.expand(crop, (0, 0, padding, 0), fill="white") if padding else crop
    first = _detections_on_view(detector, view, 2048, crop.width if padding else None)
    used = staff_space(spacing, measure_space(first))
    size = imgsz_for(used, max(crop.size))
    if size == 2048:
        return first
    return _detections_on_view(detector, view, size, crop.width if padding else None)


def boundary_dets_for_line(
    page: Image.Image,
    box: tuple[int, int, int, int],
    spacing: float,
    detector,
    padding: int = 0,
) -> list[dict]:
    """Second, slightly larger view: curves only, including ink past the cut."""
    _ensure_copisteria()
    from copisteria.detect import imgsz_for
    from PIL import ImageOps

    context_box = expand_line_box(box, spacing, (page.width, page.height))
    context = page.crop(context_box)
    if padding:
        context = ImageOps.expand(context, (0, 0, padding, 0), fill="white")
    size = imgsz_for(spacing / 1.3, max(context.size))
    return [
        det for det in _detections_on_view(detector, context, size, context_box[2] - context_box[0])
        if det.get("cls") == "curve"
    ]


def events_for_engraved_page(image: Image.Image, key: str | None = None, detector=None) -> list[dict]:
    """Read a stack of single staves as separate lines, with expanded slur views."""
    staves = find_staff_systems(image, 0, image.width)
    if not staves:
        return events_from_dets(image, [], 0, image.width, key=key, staff_x0=0, staff_x1=image.width)
    boxes = engraved_line_boxes(image, staves)
    detector = detector or _load_page_detector()
    lines = []
    total = len(boxes)
    for index, (staff, box) in enumerate(zip(staves, boxes), 1):
        try:
            from geom_omr_server import _set_job
            _set_job(stage=f"正在识别第 {index}/{total} 行并扩边检测连音…")
        except Exception:
            pass
        crop = image.crop(box)
        detections = detect_line_symbols(crop, staff["spacing"], detector)
        from copisteria.detect import IMGSZ_MIN, TARGET_SP
        width_at_minimum = round(IMGSZ_MIN * staff["spacing"] / TARGET_SP)
        padding = width_at_minimum - crop.width if width_at_minimum > max(crop.size) else 0
        boundary_dets = boundary_dets_for_line(image, box, staff["spacing"], detector, padding)
        boundary: dict = {}
        events = events_from_dets(
            crop, detections, 0, crop.width, key=key, line_boundary=boundary,
            boundary_dets=boundary_dets,
        )
        lines.append({
            "events": events,
            "duration": boundary.get("duration") or 0.0,
            "tiesIn": boundary.get("tiesIn") or [],
            "tiesOut": boundary.get("tiesOut") or [],
        })
    return join_engraved_line_events(lines)


def events_for_page(
    image_path: Path,
    dets_path: Path,
    key: str | None = None,
    *,
    live_detect: bool = False,
    detector=None,
):
    im = Image.open(image_path).convert("RGB")
    dets = load_dets(dets_path) if dets_path else []
    if live_detect and page_uses_engraved_line_reads(im, dets or None):
        return events_for_engraved_page(im, key=key, detector=detector)
    return events_from_dets(im, dets, 0, im.width, key=key, staff_x0=0, staff_x1=im.width)


if __name__ == "__main__":
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from copisteria_focus import compare, events_from_json, events_from_musicxml, slim_score

    focus = Path(__file__).resolve().parents[1]
    work = focus / "results/copisteria-28m-fullline/work-inputs"
    # .../eval-omr/eval/focus-2026-11-16/scripts/this.py → parents[3]=eval-omr
    root = Path(__file__).resolve().parents[3]

    def midi_name(p):
        n = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
        return f"{n[p % 12]}{p // 12 - 1}"

    def find_dets(stem):
        c = list(work.glob(f"{stem}.dets_*.json"))
        return c[0] if c else None

    def report(label, truth, pred):
        sc = slim_score(compare(truth, pred))
        print(f"{label:42s} {sc['exact']}/{sc['truthN']} allExact={sc['allExact']} "
              f"predN={sc['predN']} extra={sc['extra']}")
        if not sc["allExact"]:
            print("  pred ", [(midi_name(e["pitch"]), round(e["start"], 3), round(e["dur"], 3)) for e in pred])
            print("  truth", [(midi_name(e["pitch"]), e["start"], e["dur"]) for e in truth])
            if sc.get("missingEvents"):
                print("  miss ", [(midi_name(e["pitch"]), e["start"], e["dur"]) for e in sc["missingEvents"]])
            if sc.get("extraEvents"):
                print("  extra", [(midi_name(e["pitch"]), e["start"], e["dur"]) for e in sc["extraEvents"]])
            if sc.get("wrongDur"):
                print("  wdur ", [((midi_name(w["truth"]["pitch"]), w["truth"]["start"], w["truth"]["dur"]),
                                  (midi_name(w["pred"]["pitch"]), w["pred"]["start"], w["pred"]["dur"]))
                                 for w in sc["wrongDur"]])
        return sc

    # engraved / full-page samples
    pages = [
        ("single-staff-bench", events_from_json(focus / "truth/single-staff-bench.json"), None),
        ("c_major_simple", events_from_musicxml(root / "eval/reference/c_major_simple.musicxml"), None),
        ("dev-ode-to-joy", events_from_musicxml(focus / "truth/dev-ode-to-joy.musicxml"), None),
        ("xiaoxingxing-system1", events_from_json(focus / "truth/xiaoxingxing-treble-bar1.json"), None),
    ]
    for stem, truth, key in pages:
        img = work / f"{stem}.png"
        dp = find_dets(stem)
        if not img.exists() or not dp:
            print(f"MISSING {stem}")
            continue
        pred = events_for_page(img, dp, key=key)
        report(stem, truth, pred)

    user = json.loads((focus / "truth/user-25line-bars-1-13-25.json").read_text())

    def evs(b):
        return [{"pitch": e["pitch"], "start": float(e["start"]), "dur": float(e["dur"])}
                for e in b["events"] if e.get("pitch") is not None]

    for b in user["bars"]:
        truth = evs(b)
        for var in ("include-frozen-box", "staff-sp3", "staff-sp4", "midgap"):
            stem = f"user-line{b['line']}-{var}"
            img = work / f"{stem}.png"
            dp = find_dets(stem)
            if not img.exists() or not dp:
                print(f"MISSING {stem}")
                continue
            pred = events_for_user_crop(img, dp, b["box"], key=None)
            report(f"L{b['line']} {var}", truth, pred)
