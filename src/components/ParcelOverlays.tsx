import { useEffect, useRef } from "react";
import type { Parcelle } from "@/hooks/useParcelles";

const htmlEntities: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => htmlEntities[character]);
}

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
  const labelsRef = useRef<google.maps.Marker[]>([]);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!map) return;

    // Clean old polygons and labels
    polygonsRef.current.forEach((p) => p.setMap(null));
    polygonsRef.current = [];
    labelsRef.current.forEach((m) => m.setMap(null));
    labelsRef.current = [];

    if (!infoWindowRef.current) {
      infoWindowRef.current = new google.maps.InfoWindow();
    }

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

      const labelText = parcelle.owner_name?.trim() || parcelle.culture_detected || parcelle.culture_declared || "Parcelle";

      const labelMarker = new google.maps.Marker({
        position: { lat: parcelle.center_lat, lng: parcelle.center_lng },
        map,
        clickable: false,
        zIndex: 30,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 0,
        },
        label: {
          text: labelText,
          color: "#111827",
          fontSize: "12px",
          fontWeight: "700",
          className: "parcel-map-label",
        },
      });
      labelsRef.current.push(labelMarker);

      polygon.addListener("mouseover", (e: google.maps.PolyMouseEvent) => {
        polygon.setOptions({ fillOpacity: 0.42, strokeWeight: 5 });
        const owner = escapeHtml(parcelle.owner_name || "Orge détectée");
        const note = escapeHtml(parcelle.notes || "Contour d’orge détecté automatiquement.");
        const culture = escapeHtml(parcelle.culture_detected || "Orge");
        const content = `
          <div style="font-family:'Space Grotesk',sans-serif;color:#333;min-width:180px;padding:4px">
            <div style="font-weight:600;font-size:14px;margin-bottom:6px">${owner}</div>
            <div style="font-size:12px;color:#666;margin-bottom:4px">${note}</div>
            <div style="font-size:12px;color:#555;margin-bottom:4px">Confiance : ${parcelle.confidence ?? "—"}%</div>
            <div style="font-size:11px;color:#999">${culture} · NDVI: ${parcelle.ndvi_percentage ?? "—"}%</div>
          </div>
        `;
        infoWindowRef.current!.setContent(content);
        if (e.latLng) {
          infoWindowRef.current!.setPosition(e.latLng);
          infoWindowRef.current!.open(map);
        }
      });

      polygon.addListener("mouseout", () => {
        polygon.setOptions({ fillOpacity: 0.2, strokeWeight: 4 });
        infoWindowRef.current?.close();
      });

      polygon.addListener("click", () => {
        infoWindowRef.current?.close();
        onSelectRef.current?.(parcelle);
      });

      polygonsRef.current.push(polygon);
    });

    return () => {
      polygonsRef.current.forEach((p) => p.setMap(null));
      polygonsRef.current = [];
      labelsRef.current.forEach((m) => m.setMap(null));
      labelsRef.current = [];
    };
  }, [map, parcelles]);

  return null;
}
