"""Erzeugt supabase/functions/mappe/schrift.js: DejaVu Sans (normal, fett), gekürzt auf die Zeichen,
die in Namen und Adressen vorkommen (Latein mit allen Erweiterungen, Griechisch, Kyrillisch, Satzzeichen).

Die Schrift liegt als Base64-Text im Code, weil das Hochladen der Edge Function nur Textdateien annimmt.

Aufruf (braucht Python mit fonttools: pip install fonttools):
    mkdir -p /tmp/dejavu && cd /tmp/dejavu && npm pack dejavu-fonts-ttf@2.37.3 && tar xzf dejavu-fonts-ttf-2.37.3.tgz
    python3 generator/schrift_kuerzen.py /tmp/dejavu/package/ttf
"""
import base64
import io
import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

QUELLE = "dejavu-fonts-ttf@2.37.3 (npm)"
BEREICHE = ("U+0020-007E,U+00A0-024F,U+0300-036F,U+0370-03FF,U+0400-04FF,U+1E00-1EFF,"
            "U+2000-206F,U+20AC,U+2122,U+2190-2193,U+2713,U+2714,U+2717")
ZIEL = Path(__file__).resolve().parent.parent / "supabase" / "functions" / "mappe" / "schrift.js"


def kuerzen(datei: Path) -> bytes:
    optionen = subset.Options()
    optionen.layout_features = ["*"]
    optionen.drop_tables += ["FFTM"]
    schrift = TTFont(str(datei))
    s = subset.Subsetter(options=optionen)
    s.populate(unicodes=subset.parse_unicodes(BEREICHE))
    s.subset(schrift)
    puffer = io.BytesIO()
    schrift.save(puffer)
    return puffer.getvalue()


def main() -> None:
    ordner = Path(sys.argv[1])
    normal = base64.b64encode(kuerzen(ordner / "DejaVuSans.ttf")).decode()
    fett = base64.b64encode(kuerzen(ordner / "DejaVuSans-Bold.ttf")).decode()
    ZIEL.write_text(f"""// Gekürzte Schrift DejaVu Sans (normal und fett) für die PDFs der Mappe. NICHT VON HAND ÄNDERN.
// Erzeugt mit generator/schrift_kuerzen.py aus {QUELLE}.
// Zeichenbereiche: {BEREICHE}
// Lizenz: siehe LICENSE-DejaVu.txt (Bitstream Vera / DejaVu, freie Weitergabe und Einbettung erlaubt).
const bytes = (b64) => Uint8Array.from(atob(b64), (z) => z.charCodeAt(0));
export const DEJAVU_NORMAL = bytes("{normal}");
export const DEJAVU_FETT = bytes("{fett}");
""", encoding="utf-8")
    print(f"{ZIEL}: {ZIEL.stat().st_size} Bytes")


if __name__ == "__main__":
    main()
