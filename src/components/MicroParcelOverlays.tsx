import { useEffect, useRef } from "react";
import type { MicroParcelFeature, MicroParcelsResult } from "@/lib/micro-parcels";
import { cursorFromMapEvent, hideFloatingCropTooltip, moveFloatingCropTooltip, resolveCropName, showFloatingCropTooltip } from "@/lib/map-tooltip";
import { cropColor, isWaterLabel } from "@/lib/crop-colors";

interface MicroParcelOverlaysProps {
  map: google.maps.Map | null;
  result: MicroParcelsResult | null;
  /** Appelé au clic sur une micro-parcelle — ouvre sa fiche d'analyse. */
  onSelect?: (feature: MicroParcelFeature) => void;
}

/** Micro-parcelles : un polygone par zone clôturée, couleur = culture détectée, clic = fiche. */
export default function MicroParcelOverlays({ map, result, onSelect }: MicroParcelOverlaysProps) {
  const polygonsRef = useRef<google.maps.Polygon[]>([]);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

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
      const cropName = resolveCropName(feature.properties.culture, feature.properties.meanNDVI);
      const color = cropColor(feature.properties.class ?? cropName);

      const polygon = new google.maps.Polygon({
        paths: path,
        strokeColor: color,
        strokeWeight: 3,
        strokeOpacity: 1,
        fillColor: color,
        fillOpacity: 0.22,
        zIndex: 30,
        map,
      });
      polygon.addListener("mouseover", (event: google.maps.PolyMouseEvent) => {
        polygon.setOptions({ fillOpacity: 0.45, strokeWeight: 4 });
        const { confidence, areaHa, alternatives, confirmation } = feature.properties;
        const cursor = cursorFromMapEvent(event);
        if (cursor) {
          const detail = `${Math.round(confidence * 100)}% · ${areaHa} ha · ${confirmation}`
            + (Array.isArray(alternatives) && alternatives.length > 0 ? ` · probables : ${alternatives.join(", ")}` : "");
          showFloatingCropTooltip(cursor.x, cursor.y, cropName, detail, color);
        }
      });
      polygon.addListener("mousemove", (event: google.maps.PolyMouseEvent) => {
        const cursor = cursorFromMapEvent(event);
        if (cursor) moveFloatingCropTooltip(cursor.x, cursor.y);
      });
      polygon.addListener("mouseout", () => {
        polygon.setOptions({ fillOpacity: 0.22, strokeWeight: 3 });
        hideFloatingCropTooltip();
      });
      polygon.addListener("click", () => {
        onSelectRef.current?.(feature);
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
