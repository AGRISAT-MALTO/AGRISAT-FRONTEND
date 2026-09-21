/** Infobulle carte compacte : pastille couleur + nom du produit + une ligne méta. */

export function cleanCropLabel(raw?: string | null): string {
  if (!raw) return "Culture non identifiée";
  return (
    raw
      .replace(/\s*\(estimé\)\s*/gi, "")
      .replace(/\s*\(analyse multi-cultures\)\s*/gi, "")
      .replace(/\s*\(orge probable\)\s*/gi, "")
      .trim() || "Culture non identifiée"
  );
}

const GENERIC_LABELS = new Set([
  "autre végétation",
  "autre culture",
  "culture non identifiée",
  "inconnu",
  "non-orge",
  "non orge",
]);

/** Anciens libellés génériques stockés en base → libellé précis actuel.
 * Les parcelles analysées avant la précision (ex. « Maraîchage / légumes »)
 * gardent l'ancien texte en base ; on les normalise à l'affichage sans
 * toucher aux données, avec le NDVI en repli si le libellé est inconnu. */
const LEGACY_LABELS: Record<string, string> = {
  "maraîchage": "Maraîchage (tomate, oignon, chou, carotte)",
  "maraichage": "Maraîchage (tomate, oignon, chou, carotte)",
  "maraîchage / légumes": "Maraîchage (tomate, oignon, chou, carotte)",
  "maraichage / legumes": "Maraîchage (tomate, oignon, chou, carotte)",
  "céréale": "Blé (céréale — orge possible, voir degrés-jours)",
  "cereale": "Blé (céréale — orge possible, voir degrés-jours)",
  "céréale (blé / orge)": "Blé (céréale — orge possible, voir degrés-jours)",
  "cereale (ble / orge)": "Blé (céréale — orge possible, voir degrés-jours)",
  "blé / orge": "Blé (céréale — orge possible, voir degrés-jours)",
  "ble / orge": "Blé (céréale — orge possible, voir degrés-jours)",
  "maïs / culture dense": "Maïs",
  "mais / culture dense": "Maïs",
};

/** Remplace les vieux libellés génériques par un vrai nom de produit déduit du NDVI. */
export function resolveCropName(rawLabel: string | null | undefined, ndviPercentOrRatio?: number | null): string {
  const cleaned = cleanCropLabel(rawLabel);
  const legacy = LEGACY_LABELS[cleaned.toLowerCase()];
  if (legacy) return legacy;
  const ndvi = ndviPercentOrRatio == null
    ? null
    : ndviPercentOrRatio > 2
      ? ndviPercentOrRatio / 100
      : ndviPercentOrRatio;
  // Ancienne parcelle « Riz » sur plan d'eau : NDWI élevé sans végétation
  // (NDVI < 0.15) = eau libre → zone vide, aucun résultat de culture.
  if (cleaned.toLowerCase() === "riz") {
    if (ndvi != null && ndvi < 0.15) return "Zone en eau — vide";
    return "Riz";
  }
  if (!GENERIC_LABELS.has(cleaned.toLowerCase())) return cleaned;
  if (ndvi == null) return "Culture indéterminée";
  if (ndvi >= 0.72) return "Maïs / culture dense";
  if (ndvi >= 0.42) return "Blé (céréale — orge possible, voir degrés-jours)";
  if (ndvi >= 0.35) return "Maraîchage (tomate, oignon, chou, carotte)";
  if (ndvi >= 0.25) return "Haricot / arachide";
  if (ndvi >= 0.15) return "Friche / pâturage";
  return "Sol nu / labour";
}

export function createCropTooltip(title: string, meta?: string, accent = "#10b981"): HTMLDivElement {
  const el = document.createElement("div");
  el.style.cssText =
    "font-family:'Space Grotesk',system-ui,sans-serif;min-width:0;max-width:230px;" +
    "padding:7px 10px;border-radius:10px;background:rgba(10,18,14,0.92);color:#f1f5f3;" +
    "box-shadow:0 6px 20px rgba(0,0,0,0.35);border:none;outline:none;margin:0;";

  const titleRow = document.createElement("div");
  titleRow.style.cssText =
    "display:flex;align-items:center;gap:7px;font-size:13px;font-weight:700;" +
    "line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";

  const dot = document.createElement("span");
  dot.style.cssText =
    `width:8px;height:8px;border-radius:9999px;background:${accent};flex-shrink:0;` +
    `box-shadow:0 0 0 3px ${accent}33;`;

  const label = document.createElement("span");
  label.style.cssText = "overflow:hidden;text-overflow:ellipsis;border:none;outline:none;";
  label.textContent = title;

  titleRow.append(dot, label);
  el.append(titleRow);

  if (meta) {
    const metaEl = document.createElement("div");
    metaEl.style.cssText =
      "margin-top:3px;font-size:11px;font-weight:500;color:#b6c4bd;" +
      "line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border:none;outline:none;";
    metaEl.textContent = meta;
    el.append(metaEl);
  }

  return el;
}

/** Etiquette flottante sans aucun cadre blanc (remplace InfoWindow Google qui impose son fond blanc). */
let floatingEl: HTMLDivElement | null = null;

function getFloatingEl(): HTMLDivElement {
  if (!floatingEl) {
    floatingEl = document.createElement("div");
    floatingEl.style.cssText =
      "position:fixed;z-index:10000;pointer-events:none;display:none;" +
      "margin:0;padding:0;border:none;outline:none;background:transparent;box-shadow:none;";
    document.body.appendChild(floatingEl);
  }
  return floatingEl;
}

export function showFloatingCropTooltip(clientX: number, clientY: number, title: string, meta?: string, accent = "#10b981"): void {
  const host = getFloatingEl();
  host.innerHTML = "";
  host.appendChild(createCropTooltip(title, meta, accent));
  host.style.display = "block";
  moveFloatingCropTooltip(clientX, clientY);
}

export function moveFloatingCropTooltip(clientX: number, clientY: number): void {
  if (!floatingEl || floatingEl.style.display === "none") return;
  const offsetX = 14;
  const offsetY = 14;
  const rect = floatingEl.getBoundingClientRect();
  let left = clientX + offsetX;
  let top = clientY + offsetY;
  if (left + rect.width > window.innerWidth - 8) left = clientX - rect.width - offsetX;
  if (top + rect.height > window.innerHeight - 8) top = clientY - rect.height - offsetY;
  floatingEl.style.left = `${left}px`;
  floatingEl.style.top = `${top}px`;
}

export function hideFloatingCropTooltip(): void {
  if (floatingEl) floatingEl.style.display = "none";
}

/** Position curseur depuis un event Google Maps (PolyMouseEvent.domEvent) avec repli. */
export function cursorFromMapEvent(event: google.maps.PolyMouseEvent): { x: number; y: number } | null {
  const dom = (event as unknown as { domEvent?: MouseEvent }).domEvent;
  if (dom && typeof dom.clientX === "number" && typeof dom.clientY === "number") {
    return { x: dom.clientX, y: dom.clientY };
  }
  return null;
}
