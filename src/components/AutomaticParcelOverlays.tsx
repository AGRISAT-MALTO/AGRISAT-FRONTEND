import { useEffect, useRef } from "react";
import { getDetectedBarleySegments, type AutomaticParcel } from "@/lib/automatic-parcels";

interface AutomaticParcelOverlaysProps {
  map: google.maps.Map | null;
  parcels: AutomaticParcel[];
}

export const SOURCE_LABELS: Record<string, string> = {
  "osm": "Contour OSM (réel)",
  "database": "Parcelle enregistrée",
  "field-boundary-model": "Modèle IA (U-Net)",
  "jecam-vhr": "Parcelle tracée (JECAM-VHR)",
  "gee-watershed-segmentation": "Watershed (GEE)",
  "satellite-search-cell": "Fenêtre satellite (sans contour)",
};

export default function AutomaticParcelOverlays({ map, parcels }: AutomaticParcelOverlaysProps) {
  const polygonsRef = useRef<google.maps.Polygon[]>([]);
  useEffect(() => {
    if (!map) return;

    polygonsRef.current.forEach((polygon) => polygon.setMap(null));
    polygonsRef.current = [];

    // Contour réel de chaque parcelle candidate (parcelle tracée JECAM-VHR, Overpass, base,
    // modèle IA, watershed...), indépendamment du résultat de la classification orge — sans ça, le
    // contour tracé par le modèle n'apparaît jamais si la confiance orge est < 70%.
    parcels.forEach((parcel) => {
      const path = cleanPolygonPath(parcel.coordinates);
      if (path.length < 3) return;

      const boundaryPolygon = new google.maps.Polygon({
        paths: path,
        strokeColor: "#38bdf8",
        strokeWeight: 2,
        strokeOpacity: 0.9,
        fillColor: "#38bdf8",
        fillOpacity: 0.05,
        zIndex: 10,
        map,
      });
      // Pas d'infobulle au survol : seule la surbrillance signale la parcelle.
      boundaryPolygon.addListener("mouseover", () => {
        boundaryPolygon.setOptions({ fillOpacity: 0.18, strokeWeight: 3 });
      });
      boundaryPolygon.addListener("mouseout", () => {
        boundaryPolygon.setOptions({ fillOpacity: 0.05, strokeWeight: 2 });
      });
      polygonsRef.current.push(boundaryPolygon);
    });

    const barleySegments = parcels.flatMap(getDetectedBarleySegments);
    console.info(`[MAP] Parcelles d'orge affichées : ${barleySegments.length}`);

    barleySegments.forEach((segment) => {
      const path = cleanPolygonPath(segment.coordinates);
      if (path.length < 3) return;

      const polygon = new google.maps.Polygon({
        paths: path,
        strokeColor: "#fbbf24",
        strokeWeight: 4,
        strokeOpacity: 1,
        fillColor: "#facc15",
        fillOpacity: 0.2,
        zIndex: 20,
        map,
      });
      polygon.addListener("mouseover", () => {
        polygon.setOptions({ fillOpacity: 0.42, strokeWeight: 5 });
      });
      polygon.addListener("mouseout", () => {
        polygon.setOptions({ fillOpacity: 0.2, strokeWeight: 4 });
      });
      polygonsRef.current.push(polygon);
    });

    return () => {
      polygonsRef.current.forEach((polygon) => polygon.setMap(null));
      polygonsRef.current = [];
    };
  }, [map, parcels]);

  return null;
}

function cleanPolygonPath(points: Array<{ lat: number; lng: number }>): Array<{ lat: number; lng: number }> {
  const path = points.filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
  const cleaned: Array<{ lat: number; lng: number }> = [];

  path.forEach((point) => {
    const previous = cleaned.at(-1);
    if (!previous || previous.lat !== point.lat || previous.lng !== point.lng) {
      cleaned.push(point);
    }
  });

  const first = cleaned[0];
  const last = cleaned.at(-1);
  if (first && last && first.lat === last.lat && first.lng === last.lng) {
    cleaned.pop();
  }

  return cleaned;
}
