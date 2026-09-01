import { useEffect, useRef } from "react";
import type { Parcelle } from "@/hooks/useParcelles";

export type BarleyStatus = "confirmed" | "uncertain" | "non-barley";

const STATUS_COLORS: Record<BarleyStatus, string> = {
  confirmed: "#fbbf24", // jaune — orge confirmée
  uncertain: "#1e3a8a", // bleu marine — orge incertaine
  "non-barley": "#ef4444", // rouge — non-orge
};

// Orge confirmée -> jaune ; non-orge -> rouge ; incertain -> bleu marine.
// culture_detected (classification CNN nette : "Orge" / "Non-orge") fait foi en priorité.
// Le verdict texte agrège CNN+agro et peut dire "INDÉTERMINÉ" par simple désaccord avec le
// score agro même quand le CNN est très confiant sur son verdict ("Non-orge" à 90%) — il ne
// doit donc pas écraser une classification CNN déjà nette, seulement servir de repli quand
// culture_detected est absent (CNN indisponible).
export function getBarleyStatus(parcelle: Parcelle): BarleyStatus {
  const culture = parcelle.culture_detected?.toLowerCase().trim() ?? "";
  const isNonOrge = culture.includes("orge") && culture.includes("non");
  if (isNonOrge) return "non-barley";
  if (culture.includes("orge")) return "confirmed";

  const verdict = parcelle.verdict?.toUpperCase() ?? "";
  if (verdict.includes("INCERTAIN") || verdict.includes("INDÉTERMIN") || verdict.includes("INDETERMIN")) {
    return "uncertain";
  }
  if (verdict.includes("NON-ORGE") || verdict.includes("NON ORGE")) return "non-barley";
  if (verdict.includes("ORGE")) return "confirmed";
  return "uncertain";
}

interface ParcelOverlaysProps {
  map: google.maps.Map | null;
  parcelles: Parcelle[];
  /** Appelé au clic sur une parcelle — ouvre son panneau de détail avec les données déjà en base. */
  onSelect?: (parcelle: Parcelle) => void;
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
      const path = parcelle.coordinates.map((c) => ({ lat: c.lat, lng: c.lng }));
      const color = STATUS_COLORS[getBarleyStatus(parcelle)];

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

      // Pas d'étiquette ni d'infobulle au survol : le clic sur le contour ouvre directement
      // le panneau de détail existant (ParcelCasePanel), déjà fonctionnel.
      polygon.addListener("mouseover", () => {
        polygon.setOptions({ fillOpacity: 0.42, strokeWeight: 5 });
      });

      polygon.addListener("mouseout", () => {
        polygon.setOptions({ fillOpacity: 0.2, strokeWeight: 4 });
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
