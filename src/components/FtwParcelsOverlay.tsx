import { useEffect, useRef } from "react";
import {
  FIABILITE_LIBELLE,
  fiabilite,
  type ZoneParcelFeature,
  type ZoneParcelsResult,
} from "@/lib/zone-parcels";

/**
 * Contours des parcelles délimitées automatiquement (modèle JECAM sur image
 * THR ; Fields of The World auparavant, d'où le nom du composant).
 *
 * Tracés en contour, remplissage quasi transparent : ils doivent laisser voir
 * l'image satellite et les parcelles JECAM colorées par culture, affichées
 * au-dessus. La couleur du trait dit la fiabilité attendue selon la surface,
 * pour que l'utilisateur ne donne pas le même crédit à un champ de 2 ha
 * (85 % bien tracés) et à une planche maraîchère de 0,05 ha (0 %).
 */

interface FtwParcelsOverlayProps {
  map: google.maps.Map | null;
  result: ZoneParcelsResult | null;
  onSelect?: (feature: ZoneParcelFeature) => void;
}

const STYLE = {
  fiable: { stroke: "#ffffff", weight: 1.6, opacity: 0.95 },
  incertaine: { stroke: "#ffd166", weight: 1.2, opacity: 0.8 },
  faible: { stroke: "#ffd166", weight: 0.8, opacity: 0.45 },
} as const;

function outerRings(geometry: ZoneParcelFeature["geometry"]): number[][][] {
  if (geometry.type === "Polygon") return [(geometry.coordinates as number[][][])[0]];
  if (geometry.type === "MultiPolygon") {
    return (geometry.coordinates as number[][][][]).map((polygon) => polygon[0]).filter(Boolean);
  }
  // Autre type (ex. GeometryCollection) : rien à dessiner plutôt que planter.
  return [];
}

export default function FtwParcelsOverlay({ map, result, onSelect }: FtwParcelsOverlayProps) {
  const polygonsRef = useRef<google.maps.Polygon[]>([]);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);

  useEffect(() => {
    if (!map) return;

    polygonsRef.current.forEach((polygon) => polygon.setMap(null));
    polygonsRef.current = [];
    if (!infoWindowRef.current) infoWindowRef.current = new google.maps.InfoWindow();

    (result?.geojson.features ?? []).forEach((feature) => {
      const { area_ha, confidence, parcel_id, ftw_id } = feature.properties;
      const niveau = fiabilite(area_ha);
      const style = STYLE[niveau];

      outerRings(feature.geometry).forEach((ring) => {
        if (!ring || ring.length < 3) return;
        const polygon = new google.maps.Polygon({
          paths: ring.map(([lng, lat]) => ({ lat, lng })),
          strokeColor: style.stroke,
          strokeWeight: style.weight,
          strokeOpacity: style.opacity,
          fillColor: style.stroke,
          fillOpacity: 0.04,
          zIndex: 10, // sous les parcelles JECAM (15 à 30)
          map,
        });

        polygon.addListener("mouseover", (event: google.maps.PolyMouseEvent) => {
          polygon.setOptions({ fillOpacity: 0.22, strokeWeight: style.weight + 1 });
          const content = document.createElement("div");
          content.style.cssText =
            "font-family:'Space Grotesk',sans-serif;color:#333;min-width:200px;padding:4px";
          const title = document.createElement("strong");
          title.textContent = `Parcelle détectée — ${area_ha.toFixed(2)} ha`;
          const details = document.createElement("div");
          details.style.cssText = "font-size:11px;color:#666;margin-top:4px;line-height:1.6";
          details.innerHTML = [
            FIABILITE_LIBELLE[niveau],
            `Score du modèle : ${Math.round(confidence)} / 100`,
            `Réf. ${parcel_id ?? ftw_id ?? "-"}`,
          ].join("<br/>");
          content.append(title, details);
          infoWindowRef.current?.setContent(content);
          if (event.latLng) infoWindowRef.current?.setPosition(event.latLng);
          infoWindowRef.current?.open(map);
        });
        polygon.addListener("mouseout", () => {
          polygon.setOptions({ fillOpacity: 0.04, strokeWeight: style.weight });
          infoWindowRef.current?.close();
        });
        if (onSelect) polygon.addListener("click", () => onSelect(feature));

        polygonsRef.current.push(polygon);
      });
    });

    return () => {
      polygonsRef.current.forEach((polygon) => polygon.setMap(null));
      polygonsRef.current = [];
      infoWindowRef.current?.close();
    };
  }, [map, result, onSelect]);

  return null;
}
