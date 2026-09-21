import { useEffect, useRef } from "react";
import type { Parcelle } from "@/hooks/useParcelles";
import { cursorFromMapEvent, hideFloatingCropTooltip, moveFloatingCropTooltip, resolveCropName, showFloatingCropTooltip } from "@/lib/map-tooltip";
import { cropColor, isWaterLabel } from "@/lib/crop-colors";

export type BarleyStatus = "confirmed" | "uncertain" | "non-barley";

// Orge confirmée -> jaune ; non-orge -> rouge ; incertain -> orange (repli pour d'anciennes
// analyses enregistrées avant le passage à deux catégories uniquement).
// Le verdict (score hybride CNN+agro, seuils orge confirmée/non-orge) fait foi en priorité :
// culture_detected est l'étiquette CNN brute et peut contredire un verdict hybride qui a
// basculé grâce au score agro. Il ne sert de repli que si le verdict est absent (CNN et
// verdict hybride indisponibles).
export function getBarleyStatus(parcelle: Parcelle): BarleyStatus {
  const verdict = parcelle.verdict?.toUpperCase() ?? "";
  if (verdict.includes("INCERTAIN") || verdict.includes("INDÉTERMIN") || verdict.includes("INDETERMIN")) {
    return "uncertain";
  }
  if (verdict.includes("NON-ORGE") || verdict.includes("NON ORGE")) return "non-barley";
  if (verdict.includes("ORGE")) return "confirmed";

  const culture = parcelle.culture_detected?.toLowerCase().trim() ?? "";
  const isNonOrge = culture.includes("orge") && culture.includes("non");
  if (isNonOrge) return "non-barley";
  if (culture.includes("orge")) return "confirmed";

  return "uncertain";
}

interface ParcelOverlaysProps {
  map: google.maps.Map | null;
  parcelles: Parcelle[];
  /** Appelé au clic sur une parcelle — ouvre son panneau de détail avec les données déjà en base. */
  onSelect?: (parcelle: Parcelle) => void;
}

/** Nom de culture affiché au survol : étiquette CNN si présente, sinon verdict hybride, sinon culture déclarée. */
function parcelCultureLabel(parcelle: Parcelle): string {
  const detected = parcelle.culture_detected?.trim();
  if (detected) return detected;
  const verdict = parcelle.verdict?.toUpperCase() ?? "";
  if (verdict.includes("NON-ORGE") || verdict.includes("NON ORGE")) return "Non-orge";
  if (verdict.includes("ORGE")) return "Orge";
  const declared = parcelle.culture_declared?.trim();
  if (declared) return declared;
  return "Culture non identifiée";
}

export default function ParcelOverlays({ map, parcelles, onSelect }: ParcelOverlaysProps) {
  const polygonsRef = useRef<google.maps.Polygon[]>([]);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!map) return;

    polygonsRef.current.forEach((p) => p.setMap(null));
    polygonsRef.current = [];

    parcelles.forEach((parcelle) => {
      // Eau = vide : aucun polygone affiché (anciennes parcelles en base).
      if (isWaterLabel(parcelle.culture_detected) || isWaterLabel(parcelle.verdict)) return;
      const path = parcelle.coordinates.map((c) => ({ lat: c.lat, lng: c.lng }));
      // Une couleur par famille de culture (vert orge, jaune maïs...) à partir
      // du libellé résolu (normalise les anciennes valeurs stockées en base).
      const cropName = resolveCropName(parcelCultureLabel(parcelle), parcelle.ndvi_percentage);
      const color = cropColor(cropName);

      const polygon = new google.maps.Polygon({
        paths: path,
        strokeColor: color,
        strokeWeight: 4,
        strokeOpacity: 0.98,
        fillColor: color,
        fillOpacity: 0.2,
        zIndex: 10,
        map,
      });

      // Survol : étiquette flottante sans cadre blanc, avec le vrai nom du produit.
      polygon.addListener("mouseover", (event: google.maps.PolyMouseEvent) => {
        polygon.setOptions({ fillOpacity: 0.42, strokeWeight: 5 });
        const meta = typeof parcelle.confidence === "number"
          ? `${Math.round(parcelle.confidence)}%${typeof parcelle.surface_ha === "number" ? ` · ${parcelle.surface_ha} ha` : ""}`
          : typeof parcelle.surface_ha === "number" ? `${parcelle.surface_ha} ha` : undefined;
        const cursor = cursorFromMapEvent(event);
        if (cursor) {
          showFloatingCropTooltip(
            cursor.x,
            cursor.y,
            cropName,
            meta,
            color,
          );
        }
      });

      polygon.addListener("mousemove", (event: google.maps.PolyMouseEvent) => {
        const cursor = cursorFromMapEvent(event);
        if (cursor) moveFloatingCropTooltip(cursor.x, cursor.y);
      });

      polygon.addListener("mouseout", () => {
        polygon.setOptions({ fillOpacity: 0.2, strokeWeight: 4 });
        hideFloatingCropTooltip();
      });

      polygon.addListener("click", () => {
        onSelectRef.current?.(parcelle);
      });

      polygonsRef.current.push(polygon);
    });

    return () => {
      polygonsRef.current.forEach((p) => p.setMap(null));
      polygonsRef.current = [];
    };
  }, [map, parcelles]);

  return null;
}
