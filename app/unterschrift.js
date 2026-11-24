// Unterschriftsfeld für Finger, Stift und Maus (iPad im Studio).
// Ändert sich die Größe des Felds (z. B. iPad gedreht), wird die Unterschrift gelöscht –
// sonst wäre sie verzerrt. Dann erscheint „Bitte erneut unterschreiben“.

const LINIE = 2.5;
const MIN_PUNKTE = 30;
const MIN_BREITE = 40;
const MIN_HOEHE = 15;

export function unterschriftsFeld(ziel, { beiGroessenwechsel } = {}) {
  ziel.innerHTML = "";
  const leinwand = document.createElement("canvas");
  leinwand.setAttribute("aria-label", "Unterschriftsfeld: mit Finger oder Stift unterschreiben");
  leinwand.setAttribute("role", "img");
  leinwand.style.touchAction = "none";
  ziel.append(leinwand);
  const ctx = leinwand.getContext("2d");

  let punkte = 0;
  let box = null;           // gezeichnete Ausdehnung in CSS-Pixeln
  let zeichnet = false;
  let breite = 0;

  function einrichten() {
    const r = ziel.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    breite = Math.round(r.width);
    const hoehe = Math.round(r.height);
    leinwand.width = Math.max(1, breite * dpr);
    leinwand.height = Math.max(1, hoehe * dpr);
    leinwand.style.width = `${breite}px`;
    leinwand.style.height = `${hoehe}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineWidth = LINIE;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0b1f3a";  // dunkles Blau, wie Kugelschreiber
    punkte = 0;
    box = null;
  }

  const lage = (e) => {
    const r = leinwand.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const merken = ({ x, y }) => {
    punkte += 1;
    box = box ? { x1: Math.min(box.x1, x), y1: Math.min(box.y1, y), x2: Math.max(box.x2, x), y2: Math.max(box.y2, y) }
      : { x1: x, y1: y, x2: x, y2: y };
  };

  leinwand.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    leinwand.setPointerCapture?.(e.pointerId);
    zeichnet = true;
    const p = lage(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    merken(p);
  });
  leinwand.addEventListener("pointermove", (e) => {
    if (!zeichnet) return;
    e.preventDefault();
    const liste = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const x of liste.length ? liste : [e]) {
      const p = lage(x);
      ctx.lineTo(p.x, p.y);
      merken(p);
    }
    ctx.stroke();
  });
  const ende = () => { zeichnet = false; };
  leinwand.addEventListener("pointerup", ende);
  leinwand.addEventListener("pointercancel", ende);

  einrichten();
  if ("ResizeObserver" in window) {
    new ResizeObserver(() => {
      if (Math.round(ziel.getBoundingClientRect().width) === breite) return;
      const hatteStriche = punkte > 0;
      einrichten();
      if (hatteStriche) beiGroessenwechsel?.();
    }).observe(ziel);
  }

  return {
    leer: () => punkte < MIN_PUNKTE || !box || box.x2 - box.x1 < MIN_BREITE || box.y2 - box.y1 < MIN_HOEHE,
    png: () => new Promise((ok, nein) => leinwand.toBlob((b) => (b ? ok(b) : nein(new Error("Unterschrift konnte nicht gespeichert werden."))), "image/png")),
    loeschen: () => einrichten(),
  };
}
