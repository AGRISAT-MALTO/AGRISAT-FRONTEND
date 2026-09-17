import { useEffect, useRef } from "react";
import { getDetectedBarleySegments, type AutomaticParcel } from "@/lib/automatic-parcels";

interface AutomaticParcelOverlaysProps {
  map: google.maps.Map | null;
  parcels: AutomaticParcel[];
}

export default function AutomaticParcelOverlays({ map, parcels }: AutomaticParcelOverlaysProps) {
  const polygonsRef = useRef<google.maps.Polygon[]>([]);

  useEffect(() => {
    if (!map) return;

    polygonsRef.current.forEach((polygon) => polygon.setMap(null));
    polygonsRef.current = [];

    // Seules les parcelles identifiées comme orge sont affichées : les parcelles analysées
    // « non orge » ne sont plus dessinées.
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
      // Pas d'infobulle au survol : seule la mise en évidence du contour.
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
