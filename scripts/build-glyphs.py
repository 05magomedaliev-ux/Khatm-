#!/usr/bin/env python3
"""Собирает контуры букв Lora для карточки итогов дня (apps/server/src/services/daycard/glyphs.ts).

Текст рисуется контурами, поэтому карточке не нужны шрифты на сервере.
Запуск: python3 scripts/build-glyphs.py путь/к/Lora-Variable.ttf
"""
import json
import sys
from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

CHARS = [chr(c) for c in list(range(0x20, 0x7F)) + list(range(0x400, 0x500))] + list("«»—–…№%’“”ёЁ")
OUT = Path(__file__).resolve().parent.parent / "apps/server/src/services/daycard/glyphs.ts"


def extract(source: str, weight: int) -> tuple[int, dict]:
    font = instancer.instantiateVariableFont(TTFont(source), {"wght": weight})
    cmap = font.getBestCmap()
    glyphs = font.getGlyphSet()
    result = {}
    for char in dict.fromkeys(CHARS):
        name = cmap.get(ord(char))
        if not name:
            continue
        pen = SVGPathPen(glyphs, ntos=lambda v: str(round(v)))
        glyphs[name].draw(pen)
        result[char] = [round(glyphs[name].width), pen.getCommands()]
    return font["head"].unitsPerEm, result


def main() -> None:
    upem, regular = extract(sys.argv[1], 400)
    _, semibold = extract(sys.argv[1], 600)
    data = {"upem": upem, "regular": regular, "semibold": semibold}
    body = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    OUT.write_text(
        "// Создано scripts/build-glyphs.py из шрифта Lora (SIL Open Font License 1.1). Вручную не менять.\n"
        "export const GLYPHS: {\n  upem: number;\n  regular: Record<string, [number, string]>;\n"
        "  semibold: Record<string, [number, string]>;\n} = "
        + body + ";\n",
        encoding="utf-8",
    )
    print(OUT, OUT.stat().st_size, len(regular))


main()
