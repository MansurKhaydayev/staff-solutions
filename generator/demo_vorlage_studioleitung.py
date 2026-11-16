"""Leitet aus der Servicekraft-Vorlage eine DEMO-Vorlage für die Studioleitung ab.

Aufruf: python3 demo_vorlage_studioleitung.py <servicekraft.docx> <ausgabe.docx>
Die Studioleitung bekommt ebenfalls einen Arbeiterdienstvertrag; nur die
Tätigkeiten unterscheiden sich. Eine Leiterzulage steht NICHT im Vertrag,
sondern in einer eigenen Einzelvereinbarung. Die Texte sind erfunden.
"""
import sys
import zipfile

quelle, ziel = sys.argv[1:3]

with zipfile.ZipFile(quelle) as z:
    dateien = {n: z.read(n) for n in z.namelist()}

def ersetzen(xml, alt, neu):
    if xml.count(alt) != 1:
        sys.exit(f"Abbruch: '{alt}' kommt {xml.count(alt)}x vor")
    return xml.replace(alt, neu)

doc = dateien["word/document.xml"].decode("utf-8")
doc = ersetzen(
    doc,
    "Betreuung und Beratung der Kunden bzw. Mitglieder sowie Ansprechperson für deren Anliegen und Fragen",
    "Leitung des Studios, Dienstplanung und Einschulung neuer Mitarbeiter sowie "
    "Betreuung und Beratung der Mitglieder",
)
dateien["word/document.xml"] = doc.encode("utf-8")

with zipfile.ZipFile(ziel, "w", zipfile.ZIP_DEFLATED) as z:
    for name, inhalt in dateien.items():
        z.writestr(name, inhalt)
print("Demo-Vorlage erstellt:", ziel)
