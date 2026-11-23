#!/usr/bin/env python3
"""Draw the 1200×630 Open Graph image for 谱线.

Original artwork: a cream sheet, a five-line staff, and a short phrase of
note heads. CJK type is rasterized at generation time from a local Noto
Sans CJK SC face; the font file is not copied into the repository.
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

WIDTH, HEIGHT = 1200, 630
SOFT = (250, 248, 244)
CREAM = (247, 243, 234)
INK = (28, 25, 22)
MUTED = (111, 103, 94)
STAFF = (184, 174, 158)
ACCENT = (164, 72, 37)

FONT_REGULAR = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
FONT_BOLD = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
SC = 2

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "og-image.png"


def cjk(path: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(path, size=size, index=SC)


def note(draw: ImageDraw.ImageDraw, cx: float, cy: float, stem_up: bool) -> None:
    rx, ry = 18, 13
    draw.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=INK)
    stem_x = cx + (rx - 3) if stem_up else cx - (rx - 3)
    stem_y = cy - 78 if stem_up else cy + 70
    draw.line([(stem_x, cy), (stem_x, stem_y)], fill=INK, width=4)


def main() -> None:
    img = Image.new("RGB", (WIDTH, HEIGHT), SOFT)
    margin = 36
    shadow = Image.new("L", (WIDTH, HEIGHT), 0)
    ImageDraw.Draw(shadow).rounded_rectangle(
        [margin + 6, margin + 10, WIDTH - margin + 6, HEIGHT - margin + 10],
        radius=28,
        fill=40,
    )
    img.paste((28, 25, 22), mask=shadow.filter(ImageFilter.GaussianBlur(14)))

    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle(
        [margin, margin, WIDTH - margin, HEIGHT - margin],
        radius=28,
        fill=CREAM,
    )
    draw.rectangle([margin, margin + 28, margin + 8, HEIGHT - margin - 28], fill=ACCENT)

    draw.text((88, 72), "谱线", font=cjk(FONT_BOLD, 108), fill=INK)
    draw.text((92, 196), "让旋律，落在纸上。", font=cjk(FONT_REGULAR, 36), fill=MUTED)

    staff_left, staff_right = 88, 1110
    staff_top = 310
    gap = 26
    for i in range(5):
        y = staff_top + i * gap
        draw.line([(staff_left, y), (staff_right, y)], fill=STAFF, width=3)

    def y_of(pos: float) -> float:
        return staff_top + pos * gap

    # A short rising-then-falling phrase on the staff (original placement).
    phrase = [
        (200, 5.0, True),
        (310, 5.0, True),
        (420, 3.0, True),
        (530, 3.0, True),
        (640, 2.5, True),
        (750, 2.5, True),
        (860, 3.0, False),
    ]
    for cx, pos, stem_up in phrase:
        if pos >= 5:
            y = y_of(5)
            draw.line([(cx - 28, y), (cx + 28, y)], fill=STAFF, width=3)
        note(draw, cx, y_of(pos), stem_up)

    draw.text(
        (88, 540),
        "简谱 · 五线谱 · 和弦谱 · 六线谱 · 卷帘跟奏",
        font=cjk(FONT_REGULAR, 28),
        fill=MUTED,
    )

    OUT.parent.mkdir(parents=True, exist_ok=True)
    img.save(OUT, "PNG", optimize=True)
    print(f"wrote {OUT} {WIDTH}x{HEIGHT}")


if __name__ == "__main__":
    main()
