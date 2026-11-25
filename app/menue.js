// Menü auf schmalen Bildschirmen (iPad hoch, Handy): die Navigation klappt hinter dem Knopf „Menü“ auf.
// Auf breiten Bildschirmen ist die Seitenleiste immer sichtbar, der Knopf ist dort ausgeblendet.
export function menueEinrichten() {
  const kopf = document.querySelector(".kopf");
  const knopf = document.querySelector("#menue-knopf");
  if (!kopf || !knopf) return;
  const setze = (offen) => {
    kopf.classList.toggle("menue-offen", offen);
    knopf.setAttribute("aria-expanded", String(offen));
  };
  knopf.addEventListener("click", () => setze(!kopf.classList.contains("menue-offen")));
  kopf.addEventListener("click", (e) => { if (e.target.closest(".navigation a")) setze(false); });
  window.addEventListener("hashchange", () => setze(false));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") setze(false); });
}
