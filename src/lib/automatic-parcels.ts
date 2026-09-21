import type { BarleyDetectionConfig } from "@/lib/barley-detection";
import { featureCenter, outerRing } from "@/lib/viewport-tiles";
import type { ZoneParcelsResult } from "@/lib/zone-parcels";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export interface DetectedBarleySegment {
  coordinates: Array<{ lat: number; lng: number }>;
  confidence: number;
  ndvi: number | null;
  area_ha: number;
}

export interface AutomaticParcelAnalysis {
  is_barley?: boolean;
  barley_presence?: "confirmed" | "probable" | "none";
  culture_detected?: string;
  verdict?: string;
  confidence?: number;
  percentage?: number;
  ndre?: number | null;
  spectral_bands?: Record<string, number | null> | null;
  details?: string;
  data_source?: string;
  hf_model_url?: string;
  hf_available?: boolean;
  gdd_cumulative?: number;
  gdd_threshold?: number;
  gdd_base_temperature?: number;
  gdd_start_date?: string;
  gdd_end_date?: string;
  gdd_detected?: boolean;
  gdd_daily_values?: Array<{ date: string; tmax: number; tmin: number; dj: number }>;
  gdd_error?: string | null;
  detected_segments?: DetectedBarleySegment[];
}

export interface AutomaticParcel {
  id: string;
  coordinates: Array<{ lat: number; lng: number }>;
  center: { lat: number; lng: number };
  tags: Record<string, string>;
  analysis: AutomaticParcelAnalysis | null;
  analysis_error: string | null;
}

export interface AutomaticParcelSearchResult {
  center: { lat: number; lng: number };
  radius_km: number;
  base_temperature: number;
  threshold: number;
  period_days: number;
  candidates_found: number;
  analyzed_count: number;
  parcels: AutomaticParcel[];
  notice: string | null;
}

/** Parcelle déjà tracée à l'écran (JECAM-VHR), envoyée au backend pour être classée entière. */
export interface TracedParcelInput {
  coordinates: Array<{ lat: number; lng: number }>;
}

// Marge sur le rayon : une parcelle dont le centre est un peu au-delà peut encore recouper le
// cercle. Le backend fait ensuite le test d'intersection exact.
const TRACED_PARCEL_RADIUS_MARGIN_M = 300;
/**
 * Plafond d'envoi : le backend n'analyse que les 48 plus proches et refuse au-delà de 2 000
 * parcelles (400). Sur un grand rayon, l'écran en compte bien plus.
 */
export const MAX_TRACED_PARCELS_SENT = 500;
const M_PER_DEG_LAT = 110_574;
const M_PER_DEG_LNG_EQUATOR = 111_320;

/**
 * Parcelles déjà tracées dont le centre est à moins de `radiusM` (+ marge) du point recherché,
 * de la plus proche à la plus éloignée, limitées à MAX_TRACED_PARCELS_SENT.
 */
export function tracedParcelsWithinRadius(
  traced: ZoneParcelsResult | null,
  lat: number,
  lng: number,
  radiusM: number,
): TracedParcelInput[] {
  if (!traced) return [];
  const longitudeScale = Math.max(Math.abs(Math.cos((lat * Math.PI) / 180)), 0.1);
  const maxDistanceM = radiusM + TRACED_PARCEL_RADIUS_MARGIN_M;

  return traced.geojson.features
    .flatMap((feature) => {
      const center = featureCenter(feature);
      const ring = outerRing(feature.geometry);
      if (!center || !ring || ring.length < 3) return [];
      const eastM = (center.lng - lng) * M_PER_DEG_LNG_EQUATOR * longitudeScale;
      const northM = (center.lat - lat) * M_PER_DEG_LAT;
      const distanceM = Math.hypot(eastM, northM);
      if (distanceM > maxDistanceM) return [];
      return [{ distanceM, coordinates: ring.map(([pointLng, pointLat]) => ({ lat: pointLat, lng: pointLng })) }];
    })
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, MAX_TRACED_PARCELS_SENT)
    .map(({ coordinates }) => ({ coordinates }));
}

export async function searchAutomaticParcels(
  lat: number,
  lng: number,
  radiusKm: number,
  config: BarleyDetectionConfig,
  tracedParcels: TracedParcelInput[] = [],
): Promise<AutomaticParcelSearchResult> {
  const response = await fetch(`${API_URL}/api/detect-parcels`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lat, lng, radiusKm, ...config, tracedParcels }),
  });
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const message = data && typeof data === "object" && "error" in data && typeof data.error === "string"
      ? data.error
      : `La recherche automatique est indisponible (${response.status}).`;
    throw new Error(message);
  }
  if (!data || typeof data !== "object") throw new Error("La recherche a renvoyé une réponse invalide.");
  return data as AutomaticParcelSearchResult;
}

export function isAutomaticBarleyParcel(parcel: AutomaticParcel): boolean {
  const culture = parcel.analysis?.culture_detected?.toLowerCase() ?? "";
  const confidence = parcel.analysis?.confidence;
  if (typeof confidence === "number" && confidence < 70) return false;
  return parcel.analysis?.is_barley === true || (culture.includes("orge") && !culture.includes("non"));
}

/**
 * Contours d'orge renvoyés par le backend. C'est lui qui décide (classifieur Sentinel-2, ou
 * repli CNN au-dessus de 70 %) : on ne filtre ici que les géométries inexploitables.
 */
export function getDetectedBarleySegments(parcel: AutomaticParcel): DetectedBarleySegment[] {
  const segments = parcel.analysis?.detected_segments;
  if (!Array.isArray(segments)) return [];

  return segments.filter((segment): segment is DetectedBarleySegment => (
    Array.isArray(segment.coordinates)
    && segment.coordinates.length >= 3
    && segment.coordinates.every((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng))
    && Number.isFinite(segment.confidence)
    && Number.isFinite(segment.area_ha)
  ));
}
