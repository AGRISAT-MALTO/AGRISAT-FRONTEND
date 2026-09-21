import { describe, expect, it } from "vitest";
import { tracedParcelsForCrops } from "@/lib/zone-crops";
import type { ZoneParcelFeature, ZoneParcelsResult } from "@/lib/zone-parcels";

function tracedSquare(centerLat: number, centerLng: number, halfDeg = 0.0002): ZoneParcelFeature {
  return {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [[
        [centerLng - halfDeg, centerLat - halfDeg],
        [centerLng + halfDeg, centerLat - halfDeg],
        [centerLng + halfDeg, centerLat + halfDeg],
        [centerLng - halfDeg, centerLat + halfDeg],
      ]],
    },
    properties: { parcel_id: "P1", confidence: 80, area_ha: 0.2, distance_m: 0, source: "JECAM-VHR" },
  };
}

function tracedResult(features: ZoneParcelFeature[]): ZoneParcelsResult {
  return {
    query: { latitude: 0, longitude: 0, radius_m: 1000, min_confidence: 0, min_area_ha: 0 },
    summary: { n_parcels: features.length, area_ha_total: 0, truncated: false, by_size: [], quality: {}, outside_coverage: false },
    attribution: "",
    warnings: [],
    geojson: { type: "FeatureCollection", features },
  };
}

describe("parcelles tracées envoyées au découpage des cultures", () => {
  it("garde celles de la zone et écarte les lointaines", () => {
    const near = tracedSquare(-19.848, 47.012);
    const far = tracedSquare(-19.9, 47.1);
    const parcels = tracedParcelsForCrops(tracedResult([near, far]), -19.848, 47.012, 500);
    expect(parcels).toHaveLength(1);
    expect(parcels[0].properties.parcel_id).toBe("P1");
  });

  it("garde une parcelle juste au-delà du cercle : un îlot à cheval sur le bord doit rester découpable", () => {
    // 350 m au nord du centre, pour un rayon demandé de 200 m.
    const debord = tracedSquare(-19.848 + 350 / 111_132, 47.012);
    expect(tracedParcelsForCrops(tracedResult([debord]), -19.848, 47.012, 200)).toHaveLength(1);
  });

  it("arrondit les coordonnées au millionième de degré pour alléger la requête", () => {
    const parcelle = tracedSquare(-19.8481234567891, 47.0123456789123);
    const [envoyee] = tracedParcelsForCrops(tracedResult([parcelle]), -19.848, 47.012, 500);
    const ring = (envoyee.geometry.coordinates as number[][][])[0];
    for (const [lng, lat] of ring) {
      expect(String(lng).split(".")[1]?.length ?? 0).toBeLessThanOrEqual(6);
      expect(String(lat).split(".")[1]?.length ?? 0).toBeLessThanOrEqual(6);
    }
    // L'arrondi reste sous le mètre : le contour ne bouge pas à l'écran.
    expect(ring[0][1]).toBeCloseTo(-19.8481234567891 - 0.0002, 5);
  });

  it("n'envoie que le nécessaire : contour, identifiant, surface, source", () => {
    const [envoyee] = tracedParcelsForCrops(tracedResult([tracedSquare(-19.848, 47.012)]), -19.848, 47.012, 500);
    expect(Object.keys(envoyee.properties).sort()).toEqual(["area_ha", "parcel_id", "source"]);
  });

  it("sans traçage, ne renvoie rien : le service retombe alors sur les contours JECAM", () => {
    expect(tracedParcelsForCrops(null, -19.848, 47.012, 500)).toEqual([]);
  });
});
