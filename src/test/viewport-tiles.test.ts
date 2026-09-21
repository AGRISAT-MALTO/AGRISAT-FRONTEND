import { describe, expect, it } from "vitest";
import {
  MAX_TILES_PER_VIEW,
  TILE_RADIUS_M,
  TILE_SIZE_M,
  featuresInTile,
  mergeTileResults,
  tilesForBounds,
  tilesForCircle,
} from "@/lib/viewport-tiles";
import type { ZoneParcelFeature, ZoneParcelsResult } from "@/lib/zone-parcels";

const CENTER = { lat: -19.848219, lng: 47.011882 };
const VIEW = { south: -19.86, north: -19.836, west: 46.99, east: 47.03 };

function square(lat: number, lng: number, areaHa = 1): ZoneParcelFeature {
  const d = 0.0002;
  return {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [[[lng - d, lat - d], [lng + d, lat - d], [lng + d, lat + d], [lng - d, lat + d]]],
    },
    properties: { confidence: 80, area_ha: areaHa, distance_m: 0, source: "JECAM-VHR" },
  };
}

function tileResult(features: ZoneParcelFeature[]): ZoneParcelsResult {
  return {
    query: { latitude: 0, longitude: 0, radius_m: TILE_RADIUS_M, min_confidence: 0, min_area_ha: 0 },
    summary: {
      n_parcels: features.length, area_ha_total: 0, truncated: false, by_size: [], quality: {},
      outside_coverage: false,
    },
    attribution: "Esri",
    warnings: ["Aucune parcelle detectee dans ce rayon.", "Contours traces automatiquement"],
    geojson: { type: "FeatureCollection", features },
  };
}

describe("découpage de l'écran en zones de traçage", () => {
  it("couvre toute la vue", () => {
    const tiles = tilesForBounds(VIEW, CENTER);
    for (const [lat, lng] of [[VIEW.south, VIEW.west], [VIEW.north, VIEW.east], [CENTER.lat, CENTER.lng]]) {
      expect(tiles.some((t) => lat >= t.south && lat < t.north && lng >= t.west && lng < t.east)).toBe(true);
    }
  });

  it("donne les mêmes zones quel que soit le cadrage", () => {
    const shifted = { ...VIEW, west: VIEW.west + 0.001, east: VIEW.east + 0.001 };
    const keys = new Set(tilesForBounds(VIEW, CENTER).map((t) => t.key));
    const common = tilesForBounds(shifted, CENTER).filter((t) => keys.has(t.key));
    expect(common.length).toBeGreaterThan(0);
  });

  it("commence par le centre de l'écran et plafonne le nombre de zones", () => {
    const tiles = tilesForBounds(VIEW, CENTER, 3);
    expect(tiles).toHaveLength(3);
    const first = tiles[0];
    expect(CENTER.lat >= first.south && CENTER.lat < first.north).toBe(true);
    expect(CENTER.lng >= first.west && CENTER.lng < first.east).toBe(true);
  });

  it("couvre toute la zone d'analyse, sans plafond, en commençant par son centre", () => {
    const radiusM = 5_000;
    const tiles = tilesForCircle(CENTER, radiusM);
    expect(tiles.length).toBeGreaterThan(MAX_TILES_PER_VIEW);
    const first = tiles[0];
    expect(CENTER.lat >= first.south && CENTER.lat < first.north).toBe(true);
    expect(CENTER.lng >= first.west && CENTER.lng < first.east).toBe(true);
    // Points au bord du cercle, aux quatre points cardinaux.
    const latDelta = (radiusM - 1) / 110_574;
    const lngDelta = (radiusM - 1) / (111_320 * Math.cos((CENTER.lat * Math.PI) / 180));
    const edges = [
      [CENTER.lat + latDelta, CENTER.lng], [CENTER.lat - latDelta, CENTER.lng],
      [CENTER.lat, CENTER.lng + lngDelta], [CENTER.lat, CENTER.lng - lngDelta],
    ];
    for (const [lat, lng] of edges) {
      expect(tiles.some((t) => lat >= t.south && lat < t.north && lng >= t.west && lng < t.east)).toBe(true);
    }
    // Aucun carré hors du cercle : moins que le carré englobant.
    expect(tiles.length).toBeLessThan(tilesForBounds(
      { south: CENTER.lat - latDelta, north: CENTER.lat + latDelta, west: CENTER.lng - lngDelta, east: CENTER.lng + lngDelta },
      CENTER, Infinity).length);
  });

  it("trace chaque zone avec un cercle qui la contient entièrement", () => {
    expect(Math.hypot(TILE_SIZE_M, TILE_SIZE_M) / 2).toBeLessThan(TILE_RADIUS_M);
  });

  it("ne garde une parcelle à cheval sur deux zones qu'une seule fois", () => {
    const [a, b] = tilesForBounds(VIEW, CENTER).filter((t, _, all) => t.south === all[0].south);
    const shared = square(a.center.lat, a.center.lng);
    expect(featuresInTile([shared], a)).toHaveLength(1);
    expect(featuresInTile([shared], b)).toHaveLength(0);
  });

  it("réunit les zones et retire les avertissements propres à un cercle", () => {
    const merged = mergeTileResults([
      tileResult([square(0, 0, 0.05), square(0, 0.01, 2)]),
      tileResult([square(0, 0.02, 0.3)]),
    ]);
    expect(merged?.summary.n_parcels).toBe(3);
    expect(merged?.summary.area_ha_total).toBe(2.35);
    expect(merged?.summary.by_size.map((r) => r.n_parcels)).toEqual([1, 1, 0, 1]);
    expect(merged?.warnings).toEqual(["Contours traces automatiquement"]);
    expect(mergeTileResults([])).toBeNull();
  });
});
