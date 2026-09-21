import { useEffect, useRef } from "react";
import {
  fiabilite,
  type ZoneParcelFeature,
  type ZoneParcelsResult,
} from "@/lib/zone-parcels";
import { pointInRing, ringCentroid, type LatLng, type OutlineStyle } from "@/lib/outline-corrections";

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
  /** Clic sur un contour : l'anneau cliqué (sans le point de fermeture GeoJSON) et son style. */
  onSelect?: (feature: ZoneParcelFeature, points: LatLng[], style: OutlineStyle) => void;
  /** Contour en cours d'édition : les parcelles dont le centre y tombe ne sont pas dessinées. */
  hideWithin?: LatLng[] | null;
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

export default function FtwParcelsOverlay({ map, result, onSelect, hideWithin }: FtwParcelsOverlayProps) {
  const polygonsRef = useRef<google.maps.Polygon[]>([]);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!map) return;

    polygonsRef.current.forEach((polygon) => polygon.setMap(null));
    polygonsRef.current = [];

    (result?.geojson.features ?? []).forEach((feature) => {
      const niveau = fiabilite(feature.properties.area_ha);
      const style = STYLE[niveau];

      outerRings(feature.geometry).forEach((ring) => {
        if (!ring || ring.length < 3) return;
        const points = ring.map(([lng, lat]) => ({ lat, lng }));
        const last = points[points.length - 1];
        if (points.length > 3 && last.lat === points[0].lat && last.lng === points[0].lng) points.pop();
        if (hideWithin && pointInRing(ringCentroid(points), hideWithin)) return;
        const outlineStyle: OutlineStyle = {
          strokeColor: style.stroke,
          strokeWeight: style.weight,
          strokeOpacity: style.opacity,
          fillColor: style.stroke,
          fillOpacity: 0.04,
        };
        const polygon = new google.maps.Polygon({
          paths: points,
          ...outlineStyle,
          zIndex: 10, // sous les parcelles JECAM (15 à 30)
          map,
        });

        // Pas d'infobulle au survol : seule la surbrillance signale la parcelle.
        polygon.addListener("mouseover", () => {
          polygon.setOptions({ fillOpacity: 0.22, strokeWeight: style.weight + 1 });
        });
        polygon.addListener("mouseout", () => {
          polygon.setOptions({ fillOpacity: 0.04, strokeWeight: style.weight });
        });
        polygon.addListener("click", () => onSelectRef.current?.(feature, points, outlineStyle));

        polygonsRef.current.push(polygon);
      });
    });

    return () => {
      polygonsRef.current.forEach((polygon) => polygon.setMap(null));
      polygonsRef.current = [];
    };
  }, [map, result, hideWithin]);

  return null;
}
