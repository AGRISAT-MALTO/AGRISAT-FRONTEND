/**
 * Contours de parcelles corrigés à la main après le traçage automatique.
 *
 * Une correction est enregistrée comme une parcelle ordinaire (table
 * `parcelles`, sans analyse), reconnue à sa `data_source`. Elle n'est pas
 * dessinée comme parcelle enregistrée : elle remplace, dans le résultat du
 * traçage, la ou les parcelles qu'elle recouvre. Elle reprend leurs propriétés
 * (surface d'origine comprise), donc garde la couleur attribuée
 * automatiquement, et c'est sa forme qui part ensuite vers la carte des
 * cultures et les analyses.
 */

import { computeSurfaceHa } from "@/lib/geo";
import type { Parcelle } from "@/hooks/useParcelles";
import type { ZoneParcelFeature, ZoneParcelsResult } from "@/lib/zone-parcels";

export type LatLng = { lat: number; lng: number };

/** Style d'affichage d'une parcelle, repris tel quel par l'éditeur de contour. */
export interface OutlineStyle {
  strokeColor: string;
  strokeWeight: number;
  strokeOpacity: number;
  fillColor: string;
  fillOpacity: number;
}

export const OUTLINE_CORRECTION_SOURCE = "Tracé automatique corrigé";
export const OUTLINE_SUPPRESSION_SOURCE = "Tracé automatique supprimé";

export function isOutlineCorrection(parcelle: Pick<Parcelle, "data_source">): boolean {
  return parcelle.data_source === OUTLINE_CORRECTION_SOURCE;
}

export function isOutlineSuppression(parcelle: Pick<Parcelle, "data_source">): boolean {
  return parcelle.data_source === OUTLINE_SUPPRESSION_SOURCE;
}

export function canDeleteParcelle(parcelle: Pick<Parcelle, "data_source">): boolean {
  return !isOutlineCorrection(parcelle) && !isOutlineSuppression(parcelle);
}

export function ringCentroid(points: LatLng[]): LatLng {
  return {
    lat: points.reduce((sum, p) => sum + p.lat, 0) / points.length,
    lng: points.reduce((sum, p) => sum + p.lng, 0) / points.length,
  };
}

/** Point dans un polygone (lancer de rayon), en degrés : suffisant à l'échelle d'une parcelle. */
export function pointInRing(point: LatLng, ring: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if ((a.lat > point.lat) !== (b.lat > point.lat)
      && point.lng < ((b.lng - a.lng) * (point.lat - a.lat)) / (b.lat - a.lat) + a.lng) {
      inside = !inside;
    }
  }
  return inside;
}

/** Deux contours désignent la même parcelle si le centre de l'un tombe dans l'autre. */
export function sameParcel(a: LatLng[], b: LatLng[]): boolean {
  if (a.length < 3 || b.length < 3) return false;
  return pointInRing(ringCentroid(a), b) || pointInRing(ringCentroid(b), a);
}

function outerRing(feature: ZoneParcelFeature): LatLng[] | null {
  const { geometry } = feature;
  const ring = geometry.type === "Polygon"
    ? (geometry.coordinates as number[][][])[0]
    : (geometry.coordinates as number[][][][])[0]?.[0];
  if (!ring || ring.length < 3) return null;
  return ring.map(([lng, lat]) => ({ lat, lng }));
}

function correctionFeature(correction: Parcelle, properties: ZoneParcelFeature["properties"] | undefined): ZoneParcelFeature {
  const ring = correction.coordinates.map((p) => [p.lng, p.lat]);
  ring.push(ring[0]);
  return {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [ring] },
    properties: properties ?? {
      confidence: 0,
      area_ha: correction.surface_ha ?? computeSurfaceHa(correction.coordinates),
      distance_m: 0,
      source: "JECAM-VHR",
    },
  };
}

export function applyOutlineCorrections(
  result: ZoneParcelsResult | null,
  overrides: Parcelle[],
): ZoneParcelsResult | null {
  if (!result || overrides.length === 0) return result;

  const corrections = overrides.filter(isOutlineCorrection);
  const suppressions = overrides.filter(isOutlineSuppression);
  if (corrections.length === 0 && suppressions.length === 0) return result;
  const visibleCorrections = corrections.filter(
    (correction) => !suppressions.some((suppression) => sameParcel(suppression.coordinates, correction.coordinates)),
  );

  const inherited = new Map<string, ZoneParcelFeature["properties"]>();
  const kept = result.geojson.features.filter((feature) => {
    const ring = outerRing(feature);
    if (ring && suppressions.some((suppression) => sameParcel(suppression.coordinates, ring))) return false;
    const match = ring && corrections.find((correction) => sameParcel(correction.coordinates, ring));
    if (!match) return true;
    if (!inherited.has(match.id)) inherited.set(match.id, feature.properties);
    return false;
  });

  const features = [...kept, ...visibleCorrections.map((c) => correctionFeature(c, inherited.get(c.id)))];
  return { ...result, geojson: { ...result.geojson, features } };
}
