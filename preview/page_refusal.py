"""What to tell the user when a page has no readable 5-line staff.

Jianpu leads with 「暂不支持简谱」. A chart or other non-score leads with
「这不像五线谱」. Neither message uses staff-pairing jargon, and neither
invents a second copy of the same sentence.
"""
from __future__ import annotations

JIANPU = "暂不支持简谱。请改上传端正清晰的印刷体五线谱。"
NOT_STAFF = "这不像五线谱。柱状图、照片和其他非谱面不能识别。"
UNCLEAR = "暂只支持端正清晰的印刷体五线谱。"


def _run_lengths(cells: list[bool]) -> list[int]:
    runs: list[int] = []
    run = 0
    for dark in cells:
        if dark:
            run += 1
        elif run:
            runs.append(run)
            run = 0
    if run:
        runs.append(run)
    return runs


def refusal_for_dark(dark: list[list[bool]]) -> str:
    """`dark[y][x]` is True for ink. The grid is already coarse."""
    if not dark or not dark[0]:
        return NOT_STAFF
    height = len(dark)
    width = len(dark[0])
    long_need = max(8, int(width * 0.55))
    short_lo = max(2, int(width * 0.03))
    short_hi = max(short_lo + 1, int(width * 0.45))
    tall_need = max(4, int(height * 0.28))

    long_rows = 0
    thin_rows = 0
    for y, row in enumerate(dark):
        runs = _run_lengths(row)
        if any(run >= long_need for run in runs):
            long_rows += 1
            continue
        short = [run for run in runs if short_lo <= run <= short_hi]
        if not short:
            continue
        neighbors = 0
        if y > 0:
            neighbors += sum(dark[y - 1])
        if y + 1 < height:
            neighbors += sum(dark[y + 1])
        # An underline is a thin stroke. A filled bar is dark on the next row too.
        if neighbors < sum(row):
            thin_rows += 1

    tall_cols = 0
    for x in range(width):
        column = [dark[y][x] for y in range(height)]
        if any(run >= tall_need for run in _run_lengths(column)):
            tall_cols += 1

    if long_rows >= 5:
        return UNCLEAR
    if tall_cols >= 3 and thin_rows <= tall_cols:
        return NOT_STAFF
    if thin_rows >= 4 and tall_cols <= 2:
        return JIANPU
    if tall_cols >= 3:
        return NOT_STAFF
    if thin_rows >= 4:
        return JIANPU
    return NOT_STAFF if long_rows == 0 and thin_rows == 0 else UNCLEAR
