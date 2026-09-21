import { useEffect, useRef } from "react";
import { getDetectedBarleySegments, type AutomaticParcel } from "@/lib/automatic-parcels";
import { cursorFromMapEvent, hideFloatingCropTooltip, moveFloatingCropTooltip, resolveCropName, showFloatingCropTooltip } from "@/lib/map-tooltip";
import { CROP_COLORS, cropColor, isWaterLabel } from "@/lib/crop-colors";

interface AutomaticParcelOverlaysProps {
  map: google.maps.Map | null;
  parcels: AutomaticParcel[];
}

export const SOURCE_LABELS: Record<string, string> = {
  "osm": "Contour OSM (réel)",
  "database": "Parcelle enregistrée",
  "field-boundary-model": "Modèle IA (U-Net)",
  "gee-watershed-segmentation": "Watershed (GEE)",
  "gee-snic-segmentation": "SNIC (GEE)",
  "satellite-search-cell": "Fenêtre satellite (sans contour)",
};

/** Nom de culture affiché au survol : étiquette d'analyse si présente, sinon verdict, sinon "Culture non identifiée". */
function automaticCultureLabel(parcel: AutomaticParcel): string {
  const detected = parcel.analysis?.culture_detected?.trim();
  if (detected) return detected;
  const verdict = parcel.analysis?.verdict?.toUpperCase() ?? "";
  if (verdict.includes("NON-ORGE") || verdict.includes("NON ORGE")) return "Non-orge";
  if (verdict.includes("ORGE")) return "Orge";
  return "Culture non identifiée";
}

export default function AutomaticParcelOverlays({ map, parcels }: AutomaticParcelOverlaysProps) {
  const polygonsRef = useRef<google.maps.Polygon[]>([]);

  useEffect(() => {
    if (!map) return;

    polygonsRef.current.forEach((polygon) => polygon.setMap(null));
    polygonsRef.current = [];

    // Contour réel de chaque parcelle candidate (Overpass, base, modèle IA, watershed,
    // SNIC...), indépendamment du résultat de la classification orge — sans ça, le
    // contour tracé par le modèle n'apparaît jamais si la confiance orge est < 70%.
    parcels.forEach((parcel) => {
      // Eau = vide : aucun contour affiché (analyse détaillée vide).
      if (isWaterLabel(parcel.analysis?.culture_detected) || isWaterLabel(parcel.analysis?.verdict)) return;
      const path = cleanPolygonPath(parcel.coordinates);
      if (path.length < 3) return;
      // Couleur de la culture analysée si disponible, sinon bleu neutre (contour seul).
      const cropName = parcel.analysis ? resolveCropName(automaticCultureLabel(parcel), parcel.analysis?.percentage) : null;
      const color = cropName ? cropColor(cropName) : "#38bdf8";

      const boundaryPolygon = new google.maps.Polygon({
        paths: path,
        strokeColor: color,
        strokeWeight: 2,
        strokeOpacity: 0.9,
        fillColor: color,
        fillOpacity: 0.05,
        zIndex: 10,
        map,
      });
      boundaryPolygon.addListener("mouseover", (event: google.maps.PolyMouseEvent) => {
        boundaryPolygon.setOptions({ fillOpacity: 0.18, strokeWeight: 3 });
        const cursor = cursorFromMapEvent(event);
        if (cursor) {
          showFloatingCropTooltip(
            cursor.x,
            cursor.y,
            cropName ?? "Contour détecté",
            SOURCE_LABELS[parcel.tags.source ?? ""] ?? "Contour détecté",
            color,
          );
        }
      });
      boundaryPolygon.addListener("mousemove", (event: google.maps.PolyMouseEvent) => {
        const cursor = cursorFromMapEvent(event);
        if (cursor) moveFloatingCropTooltip(cursor.x, cursor.y);
      });
      boundaryPolygon.addListener("mouseout", () => {
        boundaryPolygon.setOptions({ fillOpacity: 0.05, strokeWeight: 2 });
        hideFloatingCropTooltip();
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
        strokeColor: CROP_COLORS.orge,
        strokeWeight: 4,
        strokeOpacity: 1,
        fillColor: CROP_COLORS.orge,
        fillOpacity: 0.2,
        zIndex: 20,
        map,
      });
      polygon.addListener("mouseover", (event: google.maps.PolyMouseEvent) => {
        polygon.setOptions({ fillOpacity: 0.42, strokeWeight: 5 });
        const cursor = cursorFromMapEvent(event);
        if (cursor) {
          showFloatingCropTooltip(
            cursor.x,
            cursor.y,
            "Orge",
            `${segment.confidence}% · ${segment.area_ha} ha`,
            CROP_COLORS.orge,
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
