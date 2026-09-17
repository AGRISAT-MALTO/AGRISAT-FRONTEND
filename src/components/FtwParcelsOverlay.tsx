import { useEffect, useRef } from "react";
import {
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
 * (environ 78 % bien tracés) et à une planche maraîchère de 0,05 ha (environ 5 %).
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

/** Champ oublié par le modèle, ajouté d'après Sentinel-2 : contour à 10 m près. */
const COMPLEMENT_STYLE = { stroke: "#22d3ee", weight: 1.4, opacity: 0.9 } as const;

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

  useEffect(() => {
    if (!map) return;

    polygonsRef.current.forEach((polygon) => polygon.setMap(null));
    polygonsRef.current = [];

    (result?.geojson.features ?? []).forEach((feature) => {
      const style = feature.properties.source === "S2-COMPLEMENT"
        ? COMPLEMENT_STYLE
        : STYLE[fiabilite(feature.properties.area_ha)];

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

        // Pas d'infobulle au survol : seule la mise en évidence du contour.
        polygon.addListener("mouseover", () => {
          polygon.setOptions({ fillOpacity: 0.22, strokeWeight: style.weight + 1 });
        });
        polygon.addListener("mouseout", () => {
          polygon.setOptions({ fillOpacity: 0.04, strokeWeight: style.weight });
        });
        if (onSelect) polygon.addListener("click", () => onSelect(feature));

        polygonsRef.current.push(polygon);
      });
    });

    return () => {
      polygonsRef.current.forEach((polygon) => polygon.setMap(null));
      polygonsRef.current = [];
    };
  }, [map, result, onSelect]);

  return null;
}
