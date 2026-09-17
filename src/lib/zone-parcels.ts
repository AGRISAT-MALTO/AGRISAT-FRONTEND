/**
 * Délimitation automatique des parcelles d'une zone d'analyse.
 *
 * Appelle /api/zone-parcels, qui trace les parcelles avec le modèle JECAM
 * (Delineate Anything ré-entraîné sur les contours du CIRAD, image Esri à
 * ~1,2 m). Calcul à la demande : ~30 s pour 800 m, rayon plafonné à 1 km.
 *
 * Fiabilité mesurée sur 831 parcelles JECAM de test, avec la chaîne du service :
 *   ≥ 0,5 ha : ~78 % bien tracées · 0,1-0,5 ha : 25-46 % · < 0,1 ha : 5 %
 *
 * La réponse porte `attribution` (Esri, Delineate Anything AGPL-3.0) et
 * `warnings` : afficher les deux.
 */

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export interface ZoneParcelProperties {
  /** Identifiant d'une parcelle tracée par le modèle JECAM (ou complémentaire Sentinel-2). */
  parcel_id?: string;
  /** Identifiant d'une parcelle Fields of The World (source désactivée). */
  ftw_id?: string;
  /** Score du modèle, de 0 à 100 ; absent pour une parcelle complémentaire Sentinel-2. */
  confidence: number | null;
  area_ha: number;
  distance_m: number;
  /** S2-COMPLEMENT : champ oublié par le modèle JECAM, délimité sur Sentinel-2 (pixels de 10 m). */
  source: "JECAM-VHR" | "FTW" | "S2-COMPLEMENT";
  /** Part du champ Sentinel-2 que les contours JECAM ne couvraient pas. */
  untraced_share?: number;
  /** "mix" : zone précalculée sur 5 dates d'image ; absent ou "simple" : une image. */
  trace_mode?: "simple" | "mix";
}

export interface ZoneParcelFeature {
  type: "Feature";
  geometry: {
    type: "Polygon" | "MultiPolygon";
    coordinates: number[][][] | number[][][][];
  };
  properties: ZoneParcelProperties;
}

export interface ZoneParcelsResult {
  query: {
    latitude: number;
    longitude: number;
    radius_m: number;
    min_confidence: number;
    min_area_ha: number;
  };
  summary: {
    n_parcels: number;
    area_ha_total: number;
    truncated: boolean;
    by_size: Array<{ range: string; n_parcels: number }>;
    quality: Record<string, number | string>;
    outside_coverage: boolean;
  };
  attribution: string;
  warnings: string[];
  geojson: { type: "FeatureCollection"; features: ZoneParcelFeature[] };
}

export type Fiabilite = "fiable" | "incertaine" | "faible";

/**
 * Fiabilité attendue d'un contour selon la surface de la parcelle.
 * Seuils tirés de la mesure contre JECAM, pas d'une estimation.
 */
export function fiabilite(areaHa: number): Fiabilite {
  if (areaHa >= 0.5) return "fiable";
  if (areaHa >= 0.1) return "incertaine";
  return "faible";
}

export const FIABILITE_LIBELLE: Record<Fiabilite, string> = {
  fiable: "Contour fiable (environ 78 % bien tracés)",
  incertaine: "Contour incertain (25-46 % bien tracés)",
  faible: "Contour peu fiable (5 % bien tracés sous 0,1 ha)",
};

/** Mêmes seuils, taux mesurés en mode mix (5 dates d'image, zones précalculées). */
export const FIABILITE_LIBELLE_MIX: Record<Fiabilite, string> = {
  fiable: "Contour fiable (environ 74 % bien tracés)",
  incertaine: "Contour incertain (29-43 % bien tracés)",
  faible: "Contour peu fiable (10 % bien tracés sous 0,1 ha)",
};

export function libelleFiabilite(niveau: Fiabilite, mode?: ZoneParcelProperties["trace_mode"]): string {
  return (mode === "mix" ? FIABILITE_LIBELLE_MIX : FIABILITE_LIBELLE)[niveau];
}

/** Réponse d'erreur du backend : `status` distingue une zone refusée (4xx) d'une panne (5xx). */
export class ZoneParcelsHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function fetchZoneParcels(
  lat: number,
  lng: number,
  radiusM: number,
  options: { minConfidence?: number; minAreaHa?: number; signal?: AbortSignal } = {},
): Promise<ZoneParcelsResult> {
  const response = await fetch(`${API_URL}/api/zone-parcels`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: options.signal,
    body: JSON.stringify({
      latitude: lat,
      longitude: lng,
      radius_m: radiusM,
      min_confidence: options.minConfidence ?? 0,
      min_area_ha: options.minAreaHa ?? 0,
    }),
  });

  if (!response.ok) {
    let detail = `Erreur ${response.status}`;
    try {
      const payload = await response.json();
      if (payload?.detail) detail = payload.detail;
    } catch {
      /* corps non JSON : on garde le code HTTP */
    }
    throw new ZoneParcelsHttpError(detail, response.status);
  }
  return (await response.json()) as ZoneParcelsResult;
}

/** Couverture agricole d'un carré : surfaces en hectares, parts de 0 à 1 (null sans champ cultivé). */
export interface ZoneCoverageSummary {
  agricultural_area_ha: number;
  untraced_area_ha_before: number;
  untraced_area_ha_after: number;
  coverage_before: number | null;
  coverage_after: number | null;
  complement_parcels: number;
  complement_area_ha: number;
  sentinel2_fields: number;
  traced_parcels: number;
}

export interface ZoneCoverageResult {
  coverage: ZoneCoverageSummary;
  warnings: string[];
  geojson: { type: "FeatureCollection"; features: ZoneParcelFeature[] };
}

/**
 * Parcelles pas encore tracées d'un carré (champs Sentinel-2 non couverts par les contours
 * fournis), à appeler une fois le carré tracé. `bounds` : seules les parcelles dont le centre
 * tombe dans le carré sont renvoyées, pour ne pas les dupliquer entre carrés voisins.
 */
export async function fetchZoneCoverage(
  center: { lat: number; lng: number },
  radiusM: number,
  bounds: { south: number; north: number; west: number; east: number },
  tracedParcels: Array<{ coordinates: Array<{ lat: number; lng: number }> }>,
): Promise<ZoneCoverageResult> {
  const response = await fetch(`${API_URL}/api/zone-coverage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ latitude: center.lat, longitude: center.lng, radiusM, bounds, tracedParcels }),
  });
  if (!response.ok) {
    let detail = `Erreur ${response.status}`;
    try {
      const payload = await response.json();
      if (payload?.detail) detail = payload.detail;
      else if (payload?.error) detail = payload.error;
    } catch {
      /* corps non JSON : on garde le code HTTP */
    }
    throw new ZoneParcelsHttpError(detail, response.status);
  }
  return (await response.json()) as ZoneCoverageResult;
}

export async function fetchAllZoneParcels(): Promise<ZoneParcelsResult> {
  const response = await fetch(`${API_URL}/api/all-parcels`);
  if (!response.ok) {
    throw new Error(`Erreur ${response.status}`);
  }
  return (await response.json()) as ZoneParcelsResult;
}
