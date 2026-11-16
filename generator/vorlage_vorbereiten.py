"""Setzt in die Dienstvertragsvorlage die Platzhalter ein.

Aufruf: python3 vorlage_vorbereiten.py <entpackter-ordner>
Ersetzt in word/document.xml und word/header1.xml die Beispieltexte
durch {{platzhalter}}. Jede Ersetzung muss genau einmal passen, sonst Abbruch.
"""
import re
import sys
from pathlib import Path

ordner = Path(sys.argv[1])

# (Datei, Absatz-Nr., alter Text im <w:t>, neuer Text)
ERSETZUNGEN = [
    ("header1.xml", None, "GmbH", "{{gmbh_name}}"),
    ("document.xml", 1, "<w:t>GmbH</w:t>", "<w:t>{{gmbh_name}}</w:t>"),
    ("document.xml", 2, "<w:t>Adresse</w:t>", "<w:t>{{gmbh_strasse}}</w:t>"),
    ("document.xml", 2, "<w:t>Postleitzahl</w:t>", "<w:t>{{gmbh_plz_ort}}</w:t>"),
    ("document.xml", 4, "<w:t>Name</w:t>", "<w:t>{{name}}</w:t>"),
    ("document.xml", 5, "<w:t>Adresse</w:t>", "<w:t>{{strasse}}</w:t>"),
    ("document.xml", 6, "<w:t>Postleitzahl</w:t>", "<w:t>{{plz_ort}}</w:t>"),
    ("document.xml", 8, "<w:t>Datum</w:t>", "<w:t>{{dienstantritt}}</w:t>"),
    ("document.xml", 10, "<w:t>„Datum“</w:t>", "<w:t>{{befristung_ende}}</w:t>"),
    ("document.xml", 13, ">„Studio mit Ortsnamen“</w:t>", ">{{arbeitsort}}</w:t>"),
    ("document.xml", 19, "<w:t>Betrag</w:t>", "<w:t>{{brutto}}</w:t>"),
    ("document.xml", 27, "<w:t>„Beschäftigungsform“</w:t>", "<w:t>{{beschaeftigungsart}}</w:t>"),
    ("document.xml", 27, "<w:t>„Stunden“</w:t>", "<w:t>{{wochenstunden}}</w:t>"),
    ("document.xml", 31, "<w:t>„GmbH bzw. Firmenname“.</w:t>", "<w:t>{{gmbh_name}}.</w:t>"),
]

# Unterschriftsbereich: zwei Spalten, je Unterschrift eigener Ort und eigenes Datum
SCHRIFT = '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="22"/><w:szCs w:val="22"/>'

def zelle(text, fett=False, linie=False, hoehe_leer=False):
    rpr = "<w:rPr>" + ("<w:b/><w:bCs/>" if fett else "") + SCHRIFT + "</w:rPr>"
    rand = ('<w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="000000"/></w:tcBorders>'
            if linie else "")
    inhalt = f'<w:r>{rpr}<w:t xml:space="preserve">{text}</w:t></w:r>' if text else ""
    return (f'<w:tc><w:tcPr><w:tcW w:w="4536" w:type="dxa"/>{rand}</w:tcPr>'
            f'<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr>{inhalt}</w:p></w:tc>')

def zeile(links, rechts, hoehe=None):
    trpr = f'<w:trPr><w:trHeight w:val="{hoehe}"/></w:trPr>' if hoehe else ""
    return f"<w:tr>{trpr}{links}{rechts}</w:tr>"

UNTERSCHRIFTEN = (
    '<w:tbl><w:tblPr><w:tblW w:w="9072" w:type="dxa"/>'
    '<w:tblLayout w:type="fixed"/>'
    '<w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="284" w:type="dxa"/></w:tblCellMar>'
    '</w:tblPr><w:tblGrid><w:gridCol w:w="4536"/><w:gridCol w:w="4536"/></w:tblGrid>'
    + zeile(zelle("Arbeitnehmer:", fett=True), zelle("Arbeitgeber:", fett=True))
    + zeile(zelle(""), zelle(""), hoehe=1134)
    + zeile(zelle("Unterschrift", linie=True), zelle("Unterschrift", linie=True))
    + zeile(zelle("Ort, Datum: {{ort_datum_arbeitnehmer}}"), zelle("Ort, Datum: {{ort_datum_arbeitgeber}}"))
    + "</w:tbl><w:p/>"
)

ABSATZ = re.compile(r"<w:p[ >].*?</w:p>", re.S)

inhalte = {}
for datei in {e[0] for e in ERSETZUNGEN}:
    inhalte[datei] = (ordner / "word" / datei).read_text(encoding="utf-8")

for datei, nr, alt, neu in ERSETZUNGEN:
    xml = inhalte[datei]
    if nr is None:
        treffer = re.findall(r"<w:t[^>]*>" + re.escape(alt) + r"\s*</w:t>", xml)
        if len(treffer) != 1:
            sys.exit(f"Abbruch: {datei} '{alt}' passt {len(treffer)}x")
        xml = xml.replace(treffer[0], treffer[0].replace(alt, neu))
    else:
        absaetze = ABSATZ.findall(xml)
        absatz = absaetze[nr]
        if absatz.count(alt) != 1:
            sys.exit(f"Abbruch: Absatz {nr} '{alt}' passt {absatz.count(alt)}x")
        xml = xml.replace(absatz, absatz.replace(alt, neu), 1)
    inhalte[datei] = xml
    print(f"ok  {datei:13} Absatz {nr}: {alt} -> {neu}")

# Alten Unterschriftsbereich (Absätze 34-39, mit Tabulatoren) durch die Tabelle ersetzen
doc = inhalte["document.xml"]
absaetze = ABSATZ.findall(doc)
texte = ["".join(re.findall(r"<w:t[^>]*>([^<]*)</w:t>", a)) for a in absaetze]
if texte[33].strip() != "Einverstanden:" or not texte[39].startswith("Arbeitgeber:") \
        or not texte[35].startswith("Ort, Datum:"):
    sys.exit("Abbruch: Unterschriftsbereich sieht anders aus als erwartet")
start = doc.index(absaetze[34])
ende = doc.index(absaetze[39]) + len(absaetze[39])
inhalte["document.xml"] = doc[:start] + UNTERSCHRIFTEN + doc[ende:]
print("ok  Unterschriftsbereich als zwei Spalten mit Ort/Datum je Unterschrift")

# Rote Markierungen aus der Beispielvorlage an den Platzhaltern entfernen
LAUF = re.compile(r"<w:r[ >](?:(?!</w:r>).)*\{\{(?:(?!</w:r>).)*</w:r>", re.S)
for datei, xml in inhalte.items():
    xml = LAUF.sub(lambda m: m.group(0).replace('<w:highlight w:val="red"/>', ""), xml)
    inhalte[datei] = xml

for datei, xml in inhalte.items():
    (ordner / "word" / datei).write_text(xml, encoding="utf-8")
