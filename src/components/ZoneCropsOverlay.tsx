import { useEffect, useRef } from "react";
import {
  CEREAL_COLORS,
  cropColor,
  cropLabel,
  isCereale,
  type ZoneCropFeature,
  type ZoneCropsResult,
} from "@/lib/zone-crops";

/**
 * Affiche sur la carte les parcelles d'une zone d'analyse, colorees par culture.
 *
 * Les contours proviennent de la base terrain JECAM/CIRAD ; la couleur vient de
 * la prediction du modele. L'opacite du remplissage suit la confiance : une
 * parcelle pale est une parcelle dont le modele n'est pas sur, ce qui evite de
 * donner la meme force visuelle a une prediction sure et a une incertaine.
 */

interface ZoneCropsOverlayProps {
  map: google.maps.Map | null;
  result: ZoneCropsResult | null;
  /** Masquer les predictions sous ce seuil plutot que de les colorer. */
  minConfidence?: number;
  onSelect?: (feature: ZoneCropFeature) => void;
}

/** Anneaux exterieurs d'un Polygon ou MultiPolygon GeoJSON. */
function outerRings(geometry: ZoneCropFeature["geometry"]): number[][][] {
  if (geometry.type === "Polygon") {
    return [(geometry.coordinates as number[][][])[0]];
  }
  return (geometry.coordinates as number[][][][])
    .map((polygon) => polygon[0])
    .filter(Boolean);
}

export default function ZoneCropsOverlay({
  map,
  result,
  minConfidence = 0,
  onSelect,
}: ZoneCropsOverlayProps) {
  const polygonsRef = useRef<google.maps.Polygon[]>([]);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);

  useEffect(() => {
    if (!map) return;

    polygonsRef.current.forEach((polygon) => polygon.setMap(null));
    polygonsRef.current = [];
    if (!infoWindowRef.current) infoWindowRef.current = new google.maps.InfoWindow();

    (result?.geojson.features ?? []).forEach((feature) => {
      const { crop_pred, crop_jecam, confidence, area_ha, year_jecam, parcel_id, distance_m } =
        feature.properties;
      if (confidence != null && confidence < minConfidence) return;

      // Une cereale a paille connue de JECAM prime sur la prediction : le
      // modele la classe en "Autres" faute d'exemples, mais le releve terrain,
      // lui, est certain. Ces parcelles sont les references de la campagne
      // orge, elles doivent etre reperables immediatement.
      const cereale = isCereale(crop_jecam);
      const color = cereale ? CEREAL_COLORS[crop_jecam] : cropColor(crop_pred);
      // Une prediction a 0,4 ne doit pas s'afficher aussi fort qu'une a 0,95.
      // Une cereale certifiee au sol s'affiche a pleine intensite.
      const fillOpacity = cereale
        ? 0.7
        : 0.18 + 0.42 * Math.min(Math.max(confidence ?? 0, 0), 1);

      outerRings(feature.geometry).forEach((ring) => {
        if (!ring || ring.length < 3) return;
        const path = ring.map(([lng, lat]) => ({ lat, lng }));

        const polygon = new google.maps.Polygon({
          paths: path,
          strokeColor: color,
          strokeWeight: cereale ? 4 : 2,
          strokeOpacity: 1,
          fillColor: color,
          fillOpacity,
          zIndex: cereale ? 30 : 15, // au-dessus des autres parcelles
          map,
        });

        polygon.addListener("mouseover", (event: google.maps.PolyMouseEvent) => {
          polygon.setOptions({ fillOpacity: Math.min(fillOpacity + 0.25, 0.9), strokeWeight: 3 });

          const content = document.createElement("div");
          content.style.cssText =
            "font-family:'Space Grotesk',sans-serif;color:#333;min-width:200px;padding:4px";

          const title = document.createElement("strong");
          title.textContent = cereale
            ? `${cropLabel(crop_jecam)} — relevé au sol`
            : `${cropLabel(crop_pred)} — ${Math.round((confidence ?? 0) * 100)}%`;

          const details = document.createElement("div");
          details.style.cssText =
            "font-size:11px;color:#666;margin-top:4px;line-height:1.6";
          details.innerHTML = [
            `Parcelle ${parcel_id} · ${area_ha != null ? `${area_ha} ha` : "surface ?"}`,
            `Relevé terrain : ${cropLabel(crop_jecam)}${year_jecam ? ` (${year_jecam})` : ""}`,
            `À ${distance_m} m du point`,
          ].join("<br/>");

          content.append(title, details);
          infoWindowRef.current?.setContent(content);
          if (event.latLng) infoWindowRef.current?.setPosition(event.latLng);
          infoWindowRef.current?.open(map);
        });

        polygon.addListener("mouseout", () => {
          polygon.setOptions({ fillOpacity, strokeWeight: 2 });
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
  }, [map, result, minConfidence, onSelect]);

  return null;
}
