import { useEffect, useRef } from "react";
import {
  CEREAL_COLORS,
  cropColor,
  isCereale,
  type ZoneCropFeature,
  type ZoneCropsResult,
} from "@/lib/zone-crops";
import { pointInRing, ringCentroid, type LatLng, type OutlineStyle } from "@/lib/outline-corrections";

/**
 * Affiche sur la carte les parcelles d'une zone d'analyse, colorees par culture.
 *
 * Les contours proviennent de la base terrain JECAM/CIRAD ou, quand le tracage
 * automatique a couvert la zone, des parcelles tracees a l'ecran ; la couleur
 * vient de la prediction du modele. L'opacite du remplissage suit la confiance :
 * une parcelle pale est une parcelle dont le modele n'est pas sur, ce qui evite
 * de donner la meme force visuelle a une prediction sure et a une incertaine.
 *
 * Deux rendus, selon `granularity` :
 *  - "parcelle" : remplie, c'est la culture d'un champ identifie ;
 *  - "bloc" : ilot JECAM de plus de 2 ha qu'aucune parcelle ne decoupe encore.
 *    Dessine en contour seul : le remplir reviendrait a affirmer que tout ce
 *    qu'il recouvre - maisons, routes, friches - porte cette culture.
 */

interface ZoneCropsOverlayProps {
  map: google.maps.Map | null;
  result: ZoneCropsResult | null;
  /** Masquer les predictions sous ce seuil plutot que de les colorer. */
  minConfidence?: number;
  /** Clic sur une parcelle : l'anneau cliqué (sans le point de fermeture GeoJSON) et son style. */
  onSelect?: (feature: ZoneCropFeature, points: LatLng[], style: OutlineStyle) => void;
  /** Contour en cours d'édition : les parcelles dont le centre y tombe ne sont pas dessinées. */
  hideWithin?: LatLng[] | null;
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
  hideWithin,
}: ZoneCropsOverlayProps) {
  const polygonsRef = useRef<google.maps.Polygon[]>([]);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!map) return;

    polygonsRef.current.forEach((polygon) => polygon.setMap(null));
    polygonsRef.current = [];

    (result?.geojson.features ?? []).forEach((feature) => {
      const { crop_pred, crop_jecam, confidence, granularity } = feature.properties;
      if (confidence != null && confidence < minConfidence) return;

      const bloc = granularity === "bloc";

      // Une cereale a paille connue de JECAM prime sur la prediction : le
      // modele la classe en "Autres" faute d'exemples, mais le releve terrain,
      // lui, est certain. Ces parcelles sont les references de la campagne
      // orge, elles doivent etre reperables immediatement.
      const cereale = isCereale(crop_jecam);
      const color = cereale ? CEREAL_COLORS[crop_jecam] : cropColor(crop_pred);
      // Une prediction a 0,4 ne doit pas s'afficher aussi fort qu'une a 0,95.
      // Une cereale certifiee au sol s'affiche a pleine intensite.
      // Un ilot non decoupe ne se remplit pas du tout.
      const fillOpacity = bloc
        ? 0
        : cereale
          ? 0.7
          : 0.18 + 0.42 * Math.min(Math.max(confidence ?? 0, 0), 1);
      const strokeWeight = bloc ? 1 : cereale ? 4 : 2;
      const strokeOpacity = bloc ? 0.5 : 1;

      outerRings(feature.geometry).forEach((ring) => {
        if (!ring || ring.length < 3) return;
        const path = ring.map(([lng, lat]) => ({ lat, lng }));
        const last = path[path.length - 1];
        if (path.length > 3 && last.lat === path[0].lat && last.lng === path[0].lng) path.pop();
        if (!bloc && hideWithin && pointInRing(ringCentroid(path), hideWithin)) return;
        const outlineStyle: OutlineStyle = { strokeColor: color, strokeWeight, strokeOpacity, fillColor: color, fillOpacity };

        const polygon = new google.maps.Polygon({
          paths: path,
          ...outlineStyle,
          // Un ilot passe sous les parcelles : il ne doit jamais masquer le
          // decoupage fin qu'on vient de gagner.
          zIndex: bloc ? 12 : cereale ? 30 : 15,
          clickable: !bloc,
          map,
        });

        // Pas d'infobulle au survol : seule la surbrillance signale la parcelle.
        // Un ilot n'est pas survolable : il n'y a rien a mettre en avant.
        if (!bloc) {
          polygon.addListener("mouseover", () => {
            polygon.setOptions({ fillOpacity: Math.min(fillOpacity + 0.25, 0.9), strokeWeight: strokeWeight + 1 });
          });

          polygon.addListener("mouseout", () => {
            polygon.setOptions({ fillOpacity, strokeWeight });
          });
        }

        if (!bloc) polygon.addListener("click", () => onSelectRef.current?.(feature, path, outlineStyle));

        polygonsRef.current.push(polygon);
      });
    });

    return () => {
      polygonsRef.current.forEach((polygon) => polygon.setMap(null));
      polygonsRef.current = [];
    };
  }, [map, result, minConfidence, hideWithin]);

  return null;
}
