"""Read a printed tempo from detector records.

The geometric draft must not invent ♩=96. A tempo is written only when one
detection says the number explicitly (class ``tempo_120`` / ``metronome_96``,
or a tempo-like box whose text is ``♩=120`` or whose bpm/qpm attribute is an
integer). Note classes, meter signatures, and bare numbers on other symbols
are ignored. Two different numbers are treated as unreadable.
"""
from __future__ import annotations

import re

_CLASS_TEMPO = re.compile(r"^(?:tempo|metronome|qpm)[_-]?(\d{2,3})$", re.I)
_TEXT_TEMPO = re.compile(r"(?:♩|[qQ])\s*=\s*(\d{2,3})\b")
_PREFIXES = ("tempo", "metronome", "qpm")
_ATTR_KEYS = {"bpm", "qpm", "tempo", "metronome"}


def _in_range(value: int) -> int | None:
    if 36 <= value <= 220:
        return value
    return None


def _number(value: object) -> int | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)) and float(value) == int(value):
        return _in_range(int(value))
    if isinstance(value, str):
        text = value.strip()
        marked = _TEXT_TEMPO.findall(text)
        raw = marked or re.findall(r"\b(\d{2,3})\b", text)
        nums = [n for n in (_in_range(int(item)) for item in raw) if n is not None]
        if len(set(nums)) == 1:
            return nums[0]
    return None


def infer_tempo(dets: list[dict] | None) -> int | None:
    found: list[int] = []
    for det in dets or []:
        if not isinstance(det, dict):
            continue
        conf = det.get("conf")
        if isinstance(conf, (int, float)) and not isinstance(conf, bool) and conf < 0.5:
            continue
        cls = str(det.get("cls") or "").replace(" ", "")
        coded = _CLASS_TEMPO.match(cls)
        if coded:
            number = _in_range(int(coded.group(1)))
            if number is not None:
                found.append(number)
            continue
        if not cls.lower().startswith(_PREFIXES):
            continue
        for bag_name in ("attrs", "attr"):
            bag = det.get(bag_name)
            if not isinstance(bag, dict):
                continue
            for key, val in bag.items():
                if str(key).lower() in _ATTR_KEYS:
                    number = _number(val)
                    if number is not None:
                        found.append(number)
        for key in ("text", "label", "content"):
            raw = det.get(key)
            if isinstance(raw, str):
                number = _number(raw)
                if number is not None:
                    found.append(number)
    if len(set(found)) != 1:
        return None
    return found[0]
