/**
 * Découpage de la carte en zones fixes pour le traçage automatique des
 * parcelles visibles à l'écran.
 *
 * Le service de traçage (modèle JECAM, /api/zone-parcels) accepte un cercle
 * d'au plus 1 km de rayon et met 30 à 60 s par cercle. Pour couvrir tout
 * l'écran, on pave la carte en carrés de 1,2 km, toujours les mêmes quelle que
 * soit la position de la vue : un carré déjà tracé n'est jamais recalculé, et
 * le backend peut mettre chaque carré en cache sous une clé stable.
 *
 * Chaque carré est tracé avec un cercle de 1 km centré sur lui, qui déborde de
 * ses bords : une parcelle à cheval sur deux carrés est tracée entière par les
 * deux. On ne garde alors dans chaque carré que les parcelles dont le centre
 * tombe dedans, ce qui évite les doublons.
 */

import type { ZoneParcelFeature, ZoneParcelsResult } from "@/lib/zone-parcels";

export const TILE_SIZE_M = 1_200;
/** Rayon envoyé au service : couvre le carré entier (demi-diagonale ≈ 849 m). */
export const TILE_RADIUS_M = 1_000;
/** En dessous, l'écran couvre trop de carrés pour un traçage raisonnable. */
export const MIN_TRACING_ZOOM = 15;
export const MAX_TILES_PER_VIEW = 24;

const M_PER_DEG_LAT = 110_574;
const M_PER_DEG_LNG_EQUATOR = 111_320;
const LAT_STEP = TILE_SIZE_M / M_PER_DEG_LAT;

type LatLng = { lat: number; lng: number };

export interface MapBounds {
  south: number;
  north: number;
  west: number;
  east: number;
}

export interface TraceTile extends MapBounds {
  key: string;
  center: LatLng;
}

function longitudeScale(lat: number): number {
  return Math.max(Math.abs(Math.cos((lat * Math.PI) / 180)), 0.1);
}

/** Largeur d'un carré en degrés de longitude, fixée par la latitude de sa rangée. */
function lngStep(row: number): number {
  const rowCenterLat = (row + 0.5) * LAT_STEP;
  return TILE_SIZE_M / (M_PER_DEG_LNG_EQUATOR * longitudeScale(rowCenterLat));
}

function tileAt(row: number, col: number): TraceTile {
  const step = lngStep(row);
  const south = row * LAT_STEP;
  const west = col * step;
  return {
    key: `${row}:${col}`,
    south,
    north: south + LAT_STEP,
    west,
    east: west + step,
    center: { lat: south + LAT_STEP / 2, lng: west + step / 2 },
  };
}

function distanceM(a: LatLng, b: LatLng): number {
  const east = (b.lng - a.lng) * M_PER_DEG_LNG_EQUATOR * longitudeScale(a.lat);
  const north = (b.lat - a.lat) * M_PER_DEG_LAT;
  return Math.hypot(east, north);
}

/**
 * Carrés qui recoupent la vue, du plus proche au plus éloigné du centre, pour
 * que le milieu de l'écran apparaisse en premier.
 */
export function tilesForBounds(
  bounds: MapBounds,
  viewCenter: LatLng,
  maxTiles = MAX_TILES_PER_VIEW,
): TraceTile[] {
  const tiles: TraceTile[] = [];
  const firstRow = Math.floor(bounds.south / LAT_STEP);
  const lastRow = Math.floor(bounds.north / LAT_STEP);
  for (let row = firstRow; row <= lastRow; row += 1) {
    const step = lngStep(row);
    const lastCol = Math.floor(bounds.east / step);
    for (let col = Math.floor(bounds.west / step); col <= lastCol; col += 1) {
      tiles.push(tileAt(row, col));
    }
  }
  return tiles
    .sort((a, b) => distanceM(viewCenter, a.center) - distanceM(viewCenter, b.center))
    .slice(0, maxTiles);
}

/**
 * Au-delà, préparer la zone avant l'analyse (traçage de 30 à 60 s par carré, un seul à la fois
 * car le modèle sature le CPU) prendrait plus d'une demi-heure.
 */
export const MAX_ANALYSIS_TILES = 30;

/** Distance entre un point et le point le plus proche d'un carré (0 s'il est dedans). */
function distanceToTileM(point: LatLng, tile: MapBounds): number {
  const nearest = {
    lat: Math.min(Math.max(point.lat, tile.south), tile.north),
    lng: Math.min(Math.max(point.lng, tile.west), tile.east),
  };
  return distanceM(point, nearest);
}

/**
 * Tous les carrés qui recoupent un cercle d'analyse, du plus proche au plus éloigné du centre :
 * ce sont les carrés à tracer pour qu'aucune parcelle du cercle ne reste sans contour.
 */
export function tilesForCircle(center: LatLng, radiusM: number): TraceTile[] {
  const latDelta = radiusM / M_PER_DEG_LAT;
  const lngDelta = radiusM / (M_PER_DEG_LNG_EQUATOR * longitudeScale(center.lat));
  const bounds = { south: center.lat - latDelta, north: center.lat + latDelta, west: center.lng - lngDelta, east: center.lng + lngDelta };
  return tilesForBounds(bounds, center, Number.POSITIVE_INFINITY).filter((tile) => distanceToTileM(center, tile) <= radiusM);
}

export function outerRing(geometry: ZoneParcelFeature["geometry"]): number[][] | null {
  if (geometry.type === "Polygon") return (geometry.coordinates as number[][][])[0] ?? null;
  if (geometry.type === "MultiPolygon") return (geometry.coordinates as number[][][][])[0]?.[0] ?? null;
  return null;
}

export function featureCenter(feature: ZoneParcelFeature): LatLng | null {
  const ring = outerRing(feature.geometry);
  if (!ring || ring.length === 0) return null;
  return {
    lat: ring.reduce((sum, [, lat]) => sum + lat, 0) / ring.length,
    lng: ring.reduce((sum, [lng]) => sum + lng, 0) / ring.length,
  };
}

/** Parcelles dont le centre tombe dans le carré (bords sud et ouest inclus). */
export function featuresInTile(features: ZoneParcelFeature[], tile: MapBounds): ZoneParcelFeature[] {
  return features.filter((feature) => {
    const center = featureCenter(feature);
    return center !== null
      && center.lat >= tile.south && center.lat < tile.north
      && center.lng >= tile.west && center.lng < tile.east;
  });
}

const SIZE_RANGES: Array<[number, number, string]> = [
  [0, 0.1, "< 0,1 ha"],
  [0.1, 0.5, "0,1-0,5 ha"],
  [0.5, 1, "0,5-1 ha"],
  [1, Infinity, "> 1 ha"],
];

// Avertissements propres à un cercle isolé, sans objet une fois les carrés réunis.
const PER_TILE_WARNINGS = ["Aucune parcelle detectee", "Rayon ramene"];

/** Réunit les carrés tracés en un seul résultat, au format de /api/zone-parcels. */
export function mergeTileResults(results: ZoneParcelsResult[]): ZoneParcelsResult | null {
  if (results.length === 0) return null;
  const features = results.flatMap((result) => result.geojson.features);
  const areas = features.map((feature) => feature.properties.area_ha);
  const warnings = [...new Set(results.flatMap((result) => result.warnings))]
    .filter((warning) => !PER_TILE_WARNINGS.some((prefix) => warning.startsWith(prefix)));

  return {
    query: results[0].query,
    summary: {
      n_parcels: features.length,
      area_ha_total: Math.round(areas.reduce((sum, area) => sum + area, 0) * 100) / 100,
      truncated: false,
      by_size: SIZE_RANGES.map(([low, high, range]) => ({
        range,
        n_parcels: areas.filter((area) => area >= low && area < high).length,
      })),
      quality: {},
      outside_coverage: false,
    },
    attribution: results.find((result) => result.attribution)?.attribution ?? "",
    warnings,
    geojson: { type: "FeatureCollection", features },
  };
}
