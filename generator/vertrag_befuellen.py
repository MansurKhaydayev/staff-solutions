"""Befüllt eine Vorlage mit {{platzhaltern}} und meldet fehlende oder übrige Felder.

Aufruf: python3 vertrag_befuellen.py <vorlage.docx> <daten.json> <ausgabe.docx>
Funktioniert wie später der Generator in der App: Jeder Platzhalter muss
ausgefüllt sein, sonst wird kein Vertrag erzeugt.
"""
import json
import re
import sys
import zipfile
from xml.sax.saxutils import escape

vorlage, daten_pfad, ausgabe = sys.argv[1:4]
daten = json.load(open(daten_pfad, encoding="utf-8"))
PLATZHALTER = re.compile(r"\{\{([a-z_]+)\}\}")

gefunden, fehlend = set(), set()

def befuellen(xml: str) -> str:
    def ersetzen(m):
        feld = m.group(1)
        gefunden.add(feld)
        wert = daten.get(feld)
        if wert in (None, ""):
            fehlend.add(feld)
            return m.group(0)
        return escape(str(wert))
    return PLATZHALTER.sub(ersetzen, xml)

with zipfile.ZipFile(vorlage) as zin:
    dateien = {n: zin.read(n) for n in zin.namelist()}

for name in dateien:
    if name.startswith("word/") and name.endswith(".xml"):
        dateien[name] = befuellen(dateien[name].decode("utf-8")).encode("utf-8")

if fehlend:
    sys.exit("Abbruch, folgende Felder fehlen: " + ", ".join(sorted(fehlend)))

with zipfile.ZipFile(ausgabe, "w", zipfile.ZIP_DEFLATED) as zout:
    for name, inhalt in dateien.items():
        zout.writestr(name, inhalt)

print("Befüllt:", ", ".join(sorted(gefunden)))
unbenutzt = set(daten) - gefunden
if unbenutzt:
    print("Nicht in der Vorlage verwendet:", ", ".join(sorted(unbenutzt)))
