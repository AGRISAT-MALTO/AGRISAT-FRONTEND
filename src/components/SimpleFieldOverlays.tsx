import { useEffect, useRef } from "react";
import type { SimpleAnalysisResult } from "@/lib/barley-detect-simple";
import { cursorFromMapEvent, hideFloatingCropTooltip, moveFloatingCropTooltip, resolveCropName, showFloatingCropTooltip } from "@/lib/map-tooltip";
import { cropColor, isWaterLabel } from "@/lib/crop-colors";

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
      // Eau = vide : aucun polygone affiché (anciennes analyses en base).
      if (isWaterLabel(feature.properties.class) || isWaterLabel(feature.properties.culture)) return;
      const ring = feature.geometry.coordinates[0];
      if (!ring || ring.length < 3) return;
      const path = ring.map(([lng, lat]) => ({ lat, lng }));
      // Couleur de la culture détectée (vert orge, jaune maïs, rouge maraîchage...).
      const cropName = resolveCropName(feature.properties.culture, feature.properties.meanNDVI);
      const color = cropColor(feature.properties.class ?? cropName);

      const polygon = new google.maps.Polygon({
        paths: path,
        strokeColor: color,
        strokeWeight: 4,
        strokeOpacity: 1,
        fillColor: color,
        fillOpacity: 0.2,
        zIndex: 20,
        map,
      });
      polygon.addListener("mouseover", (event: google.maps.PolyMouseEvent) => {
        polygon.setOptions({ fillOpacity: 0.42, strokeWeight: 5 });
        const { confidence, areaHa, alternatives } = feature.properties;
        const cursor = cursorFromMapEvent(event);
        if (cursor) {
          const detail = Array.isArray(alternatives) && alternatives.length > 0
            ? `${Math.round(confidence * 100)}% · ${areaHa} ha · probables : ${alternatives.join(", ")}`
            : `${Math.round(confidence * 100)}% · ${areaHa} ha`;
          showFloatingCropTooltip(
            cursor.x,
            cursor.y,
            cropName,
            detail,
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
      polygonsRef.current.push(polygon);
    });

    return () => {
      polygonsRef.current.forEach((polygon) => polygon.setMap(null));
      polygonsRef.current = [];
      hideFloatingCropTooltip();
    };
  }, [map, result]);

  return null;
}
