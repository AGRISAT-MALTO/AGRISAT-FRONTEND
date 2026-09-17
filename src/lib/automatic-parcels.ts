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

export type CultivationStatus = "vide" | "en_levee" | "residuelle" | "cultivee" | "indetermine";

/** État de culture de la parcelle sur la dernière image Sentinel-2 sans nuages (60 derniers jours). */
export interface ParcelCultivation {
  status: CultivationStatus;
  label: string;
  /** NDVI moyen de la parcelle, de -1 à 1. */
  ndvi: number | null;
  image_date: string | null;
  cloud_percentage: number | null;
  /** Dernier mois (AAAA-MM) où la parcelle était nue, avant la période récente. */
  previous_bare_month: string | null;
  previous_bare_ndvi: number | null;
  /** Vide auparavant, végétation aujourd'hui. */
  newly_cultivated: boolean;
}

export interface AutomaticParcelAnalysis {
  cultivation?: ParcelCultivation;
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
  /** Cycle depuis le semis estimé compatible avec une orge encore au champ. */
  gdd_detected?: boolean;
  gdd_cycle_reason?: string | null;
  gdd_error?: string | null;
  exclusions?: string[];
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
  maxParcels = MAX_TRACED_PARCELS_SENT,
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
    .slice(0, maxParcels)
    .map(({ coordinates }) => ({ coordinates }));
}

export async function searchAutomaticParcels(
  lat: number,
  lng: number,
  radiusKm: number,
  config: BarleyDetectionConfig,
  tracedParcels: TracedParcelInput[] = [],
  options: { tracedOnly?: boolean } = {},
): Promise<AutomaticParcelSearchResult> {
  const response = await fetch(`${API_URL}/api/detect-parcels`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lat, lng, radiusKm, ...config, tracedParcels, tracedOnly: options.tracedOnly ?? false }),
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

/**
 * Parcelles envoyées par requête : le backend en analyse au plus 48 par appel, en ~7 s chacune
 * sur 4 à la fois, dans un budget de 180 s.
 */
export const ANALYSIS_BATCH_SIZE = 40;

/**
 * Analyse orge de toutes les parcelles d'une zone déjà entièrement tracée, par lots. Les
 * parcelles restées sans analyse (délai dépassé, service lent) sont renvoyées une seconde fois.
 */
export async function analyzeZoneParcels(
  lat: number,
  lng: number,
  radiusKm: number,
  config: BarleyDetectionConfig,
  parcels: TracedParcelInput[],
  onProgress?: (done: number, total: number) => void,
  search: typeof searchAutomaticParcels = searchAutomaticParcels,
): Promise<AutomaticParcelSearchResult> {
  const byId = new Map<string, AutomaticParcel>();
  let notice: string | null = null;

  const runBatches = async (inputs: TracedParcelInput[]) => {
    for (let start = 0; start < inputs.length; start += ANALYSIS_BATCH_SIZE) {
      onProgress?.(Math.min(start, inputs.length), inputs.length);
      const result = await search(lat, lng, radiusKm, config, inputs.slice(start, start + ANALYSIS_BATCH_SIZE), { tracedOnly: true });
      notice ??= result.notice;
      for (const parcel of result.parcels) {
        const previous = byId.get(parcel.id);
        if (!previous || (previous.analysis === null && parcel.analysis !== null)) byId.set(parcel.id, parcel);
      }
    }
    onProgress?.(inputs.length, inputs.length);
  };

  await runBatches(parcels);
  const unanalysed = [...byId.values()].filter((parcel) => parcel.analysis === null);
  if (unanalysed.length > 0) await runBatches(unanalysed.map(({ coordinates }) => ({ coordinates })));

  const merged = [...byId.values()];
  return {
    center: { lat, lng },
    radius_km: radiusKm,
    base_temperature: config.baseTemperature,
    threshold: config.threshold,
    period_days: config.periodDays,
    candidates_found: merged.length,
    analyzed_count: merged.filter((parcel) => parcel.analysis !== null).length,
    parcels: merged,
    notice,
  };
}

/** Parcelle vide un des mois précédents et portant aujourd'hui de la végétation (image récente). */
export function isNewlyCultivated(parcel: AutomaticParcel): boolean {
  return parcel.analysis?.cultivation?.newly_cultivated === true;
}

export function isAutomaticBarleyParcel(parcel: AutomaticParcel): boolean {
  const culture = parcel.analysis?.culture_detected?.toLowerCase() ?? "";
  const confidence = parcel.analysis?.confidence;
  if (typeof confidence === "number" && confidence < 70) return false;
  return parcel.analysis?.is_barley === true || (culture.includes("orge") && !culture.includes("non"));
}

export function getDetectedBarleySegments(parcel: AutomaticParcel): DetectedBarleySegment[] {
  const segments = parcel.analysis?.detected_segments;
  if (!Array.isArray(segments)) return [];

  return segments.filter((segment): segment is DetectedBarleySegment => (
    Array.isArray(segment.coordinates)
    && segment.coordinates.length >= 3
    && segment.coordinates.every((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng))
    && Number.isFinite(segment.confidence)
    && segment.confidence >= 70
    && Number.isFinite(segment.area_ha)
  ));
}
