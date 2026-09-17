import { useEffect, useRef } from "react";
import type { SimpleAnalysisResult } from "@/lib/barley-detect-simple";

interface SimpleFieldOverlaysProps {
  map: google.maps.Map | null;
  result: SimpleAnalysisResult | null;
}

export default function SimpleFieldOverlays({ map, result }: SimpleFieldOverlaysProps) {
  const polygonsRef = useRef<google.maps.Polygon[]>([]);

  useEffect(() => {
    if (!map) return;

    polygonsRef.current.forEach((polygon) => polygon.setMap(null));
    polygonsRef.current = [];

    (result?.features ?? []).forEach((feature) => {
      const ring = feature.geometry.coordinates[0];
      if (!ring || ring.length < 3) return;
      const path = ring.map(([lng, lat]) => ({ lat, lng }));

      const polygon = new google.maps.Polygon({
        paths: path,
        strokeColor: "#22d3ee",
        strokeWeight: 4,
        strokeOpacity: 1,
        fillColor: "#22d3ee",
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
  }, [map, result]);

  return null;
}
