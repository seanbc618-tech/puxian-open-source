"""Turn geom_from_dets events into a product Score dict (and MusicXML).

Does not change pitches or durations: it only groups chords, inserts rests for
gaps, and optionally splits voices by staff/clef. Used by the local preview
server so the editor sees the same events the offline eval already allExact'd.
"""
from __future__ import annotations

from typing import Any

KEY_FIFTHS = {
    "C": 0, "G": 1, "D": 2, "A": 3, "E": 4, "B": 5, "F#": 6,
    "F": -1, "Bb": -2, "Eb": -3, "Ab": -4, "Db": -5, "Gb": -6,
}

# Snap only to a fine grid already used by geom (32nd notes), not to eighths.
GRID = 32


def _q(x: float) -> float:
    return round(float(x) * GRID) / GRID


def assign_voices(events: list[dict]) -> list[list[dict]]:
    """Put overlapping different-duration notes on separate voices so that
    every event keeps its own start and duration. Same-onset, same-duration
    notes stay together as chords.
    """
    voices: list[list[dict]] = []
    for ev in sorted(events, key=lambda e: (_q(e["start"]), -_q(e["dur"]), int(e["pitch"]))):
        ev = dict(ev, start=_q(ev["start"]), dur=_q(ev["dur"]), pitch=int(ev["pitch"]))
        placed = False
        for voice in voices:
            same = [
                e for e in voice
                if abs(e["start"] - ev["start"]) <= 1e-9 and abs(e["dur"] - ev["dur"]) <= 1e-9
            ]
            if same:
                voice.append(ev)
                placed = True
                break
            last_end = max(e["start"] + e["dur"] for e in voice)
            if last_end <= ev["start"] + 1e-9:
                voice.append(ev)
                placed = True
                break
        if not placed:
            voices.append([ev])
    return voices


def events_to_voice(events: list[dict]) -> list[dict]:
    """Sequential ScoreNote list (empty pitches = rest) from one monophonic-or-chord voice."""
    if not events:
        return []
    groups: list[list[dict]] = []
    for ev in sorted(events, key=lambda e: (_q(e["start"]), int(e["pitch"]))):
        start = _q(ev["start"])
        dur = _q(ev["dur"])
        if not groups or abs(_q(groups[-1][0]["start"]) - start) > 1e-9:
            groups.append([dict(ev, start=start, dur=dur)])
        else:
            # Same onset in one voice must share duration (enforced by assign_voices).
            groups[-1].append(dict(ev, start=start, dur=dur))
    notes: list[dict] = []
    cursor = 0.0
    for group in groups:
        start = _q(group[0]["start"])
        if start > cursor + 1e-9:
            notes.append({"pitches": [], "dur": _q(start - cursor)})
            cursor = start
        dur = _q(group[0]["dur"])
        pitches = sorted({int(e["pitch"]) for e in group})
        notes.append({"pitches": pitches, "dur": dur})
        cursor = start + dur
    return notes


def infer_measure_ends(events: list[dict], beats: int = 4, beat_unit: int = 4) -> list[float]:
    bar = beats * (4 / beat_unit)
    if not events:
        return [bar]
    last = max(_q(e["start"]) + _q(e["dur"]) for e in events)
    n = max(1, int(round(last / bar + 1e-9)))
    if n * bar < last - 1e-9:
        n += 1
    return [_q(bar * i) for i in range(1, n + 1)]


def events_to_score(
    events: list[dict],
    *,
    title: str = "几何识谱草稿",
    key: str = "C",
    beats: int = 4,
    beat_unit: int = 4,
    bpm: int | None = None,
) -> dict[str, Any]:
    bass_tagged = [e for e in events if e.get("clef") in ("F4", "F", "bass")]
    treble_tagged = [e for e in events if e.get("clef", "G2") not in ("F4", "F", "bass")]
    if not treble_tagged and not bass_tagged:
        treble_tagged = list(events)
        bass_tagged = []
    if not treble_tagged and bass_tagged:
        streams = assign_voices(bass_tagged)
        clef = "bass"
        tonic = 3
    else:
        # Keep tagged staves in separate streams first, then split polyphony.
        streams = assign_voices(treble_tagged)
        if bass_tagged:
            streams.extend(assign_voices(bass_tagged))
        clef = "treble"
        tonic = 4
    rendered = [events_to_voice(s) for s in streams if s]
    if not rendered:
        rendered = [[]]
    all_ev = list(events)
    # No tempo mark was read from the page. 88 matches a new blank score and is
    # only a playback number; tempoMarked tells the client not to engrave ♩=.
    marked = bpm is not None
    score: dict[str, Any] = {
        "title": title,
        "bpm": int(bpm) if marked else 88,
        "tempoMarked": marked,
        "beats": int(beats),
        "beatUnit": int(beat_unit),
        "key": key if key in KEY_FIFTHS else "C",
        "mode": "major",
        "clef": clef,
        "tonicOctave": tonic,
        "notes": rendered[0],
        "measureEnds": infer_measure_ends(all_ev, beats, beat_unit),
    }
    if len(rendered) > 1:
        score["voice2"] = rendered[1]
        score["staffInstrument"] = "piano"
    if len(rendered) > 2:
        score["extraVoices"] = rendered[2:]
    return score


def score_to_events(score: dict) -> list[dict]:
    ev: list[dict] = []
    voices = [score.get("notes") or []]
    if score.get("voice2") is not None:
        voices.append(score["voice2"])
    for extra in score.get("extraVoices") or []:
        voices.append(extra)
    for voice in voices:
        t = 0.0
        for note in voice:
            dur = _q(note["dur"])
            for pitch in note.get("pitches") or []:
                ev.append({"pitch": int(pitch), "start": _q(t), "dur": dur})
            t += dur
    ev.sort(key=lambda e: (e["start"], e["pitch"]))
    return ev


def events_to_musicxml(events: list[dict], score: dict) -> str:
    """Minimal MusicXML for the same events (backup / interop). The preview
    prefers the Score JSON so import cannot drop onsets or durs."""
    divisions = GRID // 4  # quarter = 8 when GRID=32
    if divisions < 1:
        divisions = 1
    key = score.get("key") or "C"
    fifths = KEY_FIFTHS.get(key, 0)
    beats = int(score.get("beats") or 4)
    beat_unit = int(score.get("beatUnit") or 4)
    bar = beats * (4 / beat_unit)
    title = score.get("title") or "geom"

    def step_alter_oct(midi: int):
        names = [
            ("C", 0), ("C", 1), ("D", 0), ("D", 1), ("E", 0), ("F", 0),
            ("F", 1), ("G", 0), ("G", 1), ("A", 0), ("A", 1), ("B", 0),
        ]
        step, alter = names[midi % 12]
        octv = midi // 12 - 1
        return step, alter, octv

    def dur_div(dur: float) -> int:
        return max(1, int(round(_q(dur) * divisions)))

    parts: dict[str, list[dict]] = {"P1": []}
    # one part, optional second staff
    treble = [e for e in events if e.get("clef", "G2") not in ("F4", "F", "bass")]
    bass = [e for e in events if e.get("clef") in ("F4", "F", "bass")]
    if not treble and not bass:
        treble = list(events)
    staves = 2 if treble and bass else 1

    def voice_events(evs, staff, voice):
        out = []
        for e in evs:
            out.append({**e, "staff": staff, "voice": voice})
        return out

    all_tagged = voice_events(treble, 1, 1) + voice_events(bass, 2, 2)
    last = max((_q(e["start"]) + _q(e["dur"]) for e in all_tagged), default=bar)
    n_bars = max(1, int(round(last / bar + 1e-9)))
    if n_bars * bar < last - 1e-9:
        n_bars += 1

    measures = []
    for b in range(n_bars):
        start_b = _q(b * bar)
        end_b = _q((b + 1) * bar)
        in_bar = [e for e in all_tagged if start_b - 1e-9 <= _q(e["start"]) < end_b - 1e-9]
        attrs = ""
        if b == 0:
            clef_xml = "<clef number=\"1\"><sign>G</sign><line>2</line></clef>"
            if staves == 2:
                clef_xml += "<clef number=\"2\"><sign>F</sign><line>4</line></clef>"
            attrs = (
                f"<attributes><divisions>{divisions}</divisions>"
                f"<key><fifths>{fifths}</fifths><mode>major</mode></key>"
                f"<time><beats>{beats}</beats><beat-type>{beat_unit}</beat-type></time>"
                f"<staves>{staves}</staves>{clef_xml}</attributes>"
            )
        # per staff sequential notes
        body = []
        for staff in range(1, staves + 1):
            staff_ev = [e for e in in_bar if e["staff"] == staff]
            groups: list[list[dict]] = []
            for ev in sorted(staff_ev, key=lambda e: (_q(e["start"]), e["pitch"])):
                if not groups or abs(_q(groups[-1][0]["start"]) - _q(ev["start"])) > 1e-9:
                    groups.append([ev])
                else:
                    groups[-1].append(ev)
            cursor = start_b
            if staff > 1:
                body.append(f"<backup><duration>{dur_div(bar)}</duration></backup>")
            for group in groups:
                gs = _q(group[0]["start"])
                if gs > cursor + 1e-9:
                    d = dur_div(gs - cursor)
                    body.append(
                        f"<note><rest/><duration>{d}</duration><voice>{staff}</voice>"
                        f"<staff>{staff}</staff></note>"
                    )
                    cursor = gs
                dur = max(_q(e["dur"]) for e in group)
                # clip at bar end for MusicXML only; Score JSON keeps in-bar geom durs
                if gs + dur > end_b + 1e-9:
                    dur = _q(end_b - gs)
                d = dur_div(dur)
                for i, ev in enumerate(group):
                    step, alter, octv = step_alter_oct(int(ev["pitch"]))
                    acc = f"<alter>{alter}</alter>" if alter else ""
                    chord = "<chord/>" if i else ""
                    body.append(
                        f"<note>{chord}<pitch><step>{step}</step>{acc}<octave>{octv}</octave></pitch>"
                        f"<duration>{d}</duration><voice>{staff}</voice><staff>{staff}</staff></note>"
                    )
                cursor = gs + dur
            if cursor < end_b - 1e-9:
                d = dur_div(end_b - cursor)
                body.append(
                    f"<note><rest/><duration>{d}</duration><voice>{staff}</voice>"
                    f"<staff>{staff}</staff></note>"
                )
        measures.append(f"<measure number=\"{b + 1}\">{attrs}{''.join(body)}</measure>")

    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<score-partwise version="3.1">'
        f"<work><work-title>{title}</work-title></work>"
        "<part-list><score-part id=\"P1\"><part-name>Music</part-name></score-part></part-list>"
        f"<part id=\"P1\">{''.join(measures)}</part></score-partwise>"
    )
