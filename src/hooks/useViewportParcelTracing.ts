import { useCallback, useRef, useState } from "react";
import {
  ZoneParcelsHttpError,
  fetchZoneCoverage,
  fetchZoneParcels,
  type ZoneCoverageSummary,
  type ZoneParcelsResult,
} from "@/lib/zone-parcels";
import {
  MAX_ANALYSIS_TILES,
  MIN_TRACING_ZOOM,
  TILE_RADIUS_M,
  featuresInTile,
  mergeTileResults,
  tilesForBounds,
  tilesForCircle,
  type TraceTile,
} from "@/lib/viewport-tiles";
import { tracedParcelsWithinRadius } from "@/lib/automatic-parcels";

/**
 * Trace automatiquement les parcelles visibles à l'écran, sans analyse.
 *
 * À chaque arrêt de la carte (événement « idle »), l'écran est découpé en
 * zones fixes (voir viewport-tiles.ts) et les zones pas encore tracées sont
 * envoyées une par une au service de traçage, le centre de l'écran d'abord.
 * Une seule requête à la fois : le modèle tourne sur CPU et plusieurs
 * traçages simultanés ne vont pas plus vite. Les zones tracées restent
 * affichées quand on se déplace ; celles qui sortent de l'écran avant leur
 * tour sont abandonnées.
 *
 * Avant une analyse, `prepareAnalysisZone` exige que tous les carrés du cercle
 * d'analyse soient tracés (ils passent devant ceux de l'écran et ne sont jamais
 * abandonnés), puis cherche carré par carré les champs que le modèle n'a pas
 * tracés (complément Sentinel-2, /api/zone-coverage).
 */

export interface TracingProgress {
  done: number;
  total: number;
}

export interface ZonePreparationProgress extends TracingProgress {
  phase: "tracing" | "coverage";
}

export interface ZoneCoverageTotals {
  tiles: number;
  /** Carrés que le service de traçage a refusés : leurs parcelles manquent. */
  failedTiles: number;
  /** Carrés tracés dont la recherche de parcelles non tracées a échoué. */
  uncheckedTiles: number;
  tracedParcels: number;
  complementParcels: number;
  agriculturalAreaHa: number;
  untracedAreaHaBefore: number;
  untracedAreaHaAfter: number;
  coverageBefore: number | null;
  coverageAfter: number | null;
}

export interface PreparedZone {
  result: ZoneParcelsResult | null;
  coverage: ZoneCoverageTotals;
  warnings: string[];
}

type TileWaiter = {
  keys: string[];
  resolve: () => void;
  reject: (error: Error) => void;
  onProgress?: (done: number, total: number) => void;
};

function sumCoverage(tiles: TraceTile[], failed: number, unchecked: number, summaries: ZoneCoverageSummary[], tracedParcels: number): ZoneCoverageTotals {
  const agricultural = summaries.reduce((sum, s) => sum + s.agricultural_area_ha, 0);
  const before = summaries.reduce((sum, s) => sum + s.untraced_area_ha_before, 0);
  const after = summaries.reduce((sum, s) => sum + s.untraced_area_ha_after, 0);
  const round = (value: number) => Math.round(value * 100) / 100;
  return {
    tiles: tiles.length,
    failedTiles: failed,
    uncheckedTiles: unchecked,
    tracedParcels,
    complementParcels: summaries.reduce((sum, s) => sum + s.complement_parcels, 0),
    agriculturalAreaHa: round(agricultural),
    untracedAreaHaBefore: round(before),
    untracedAreaHaAfter: round(after),
    coverageBefore: agricultural > 0 ? Math.round((1 - before / agricultural) * 1000) / 1000 : null,
    coverageAfter: agricultural > 0 ? Math.round((1 - after / agricultural) * 1000) / 1000 : null,
  };
}

export function useViewportParcelTracing() {
  const tileResultsRef = useRef(new Map<string, ZoneParcelsResult>());
  const failedTilesRef = useRef(new Set<string>());
  const complementsRef = useRef(new Map<string, ZoneParcelsResult["geojson"]["features"]>());
  const coverageRef = useRef(new Map<string, ZoneCoverageSummary>());
  const queueRef = useRef<TraceTile[]>([]);
  const requiredRef = useRef<TraceTile[]>([]);
  const waitersRef = useRef<TileWaiter[]>([]);
  const inflightKeyRef = useRef<string | null>(null);
  const visibleKeysRef = useRef<string[]>([]);
  const [result, setResult] = useState<ZoneParcelsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<TracingProgress | null>(null);
  const [zoomTooLow, setZoomTooLow] = useState(false);

  const isSettled = useCallback((key: string) => tileResultsRef.current.has(key) || failedTilesRef.current.has(key), []);

  /** Parcelles tracées, complétées par les champs Sentinel-2 trouvés dans chaque carré. */
  const mergedResult = useCallback(() => mergeTileResults([...tileResultsRef.current.entries()].map(([key, tileResult]) => {
    const complements = complementsRef.current.get(key) ?? [];
    return { ...tileResult, geojson: { ...tileResult.geojson, features: [...tileResult.geojson.features, ...complements] } };
  })), []);

  const refreshProgress = useCallback(() => {
    const keys = visibleKeysRef.current;
    const done = keys.filter(isSettled).length;
    setProgress(keys.length > 0 ? { done, total: keys.length } : null);
  }, [isSettled]);

  const settleWaiters = useCallback(() => {
    waitersRef.current = waitersRef.current.filter((waiter) => {
      const done = waiter.keys.filter(isSettled).length;
      waiter.onProgress?.(done, waiter.keys.length);
      if (done < waiter.keys.length) return true;
      waiter.resolve();
      return false;
    });
    requiredRef.current = requiredRef.current.filter((tile) => !isSettled(tile.key));
  }, [isSettled]);

  const pendingRequiredTiles = useCallback(
    () => requiredRef.current.filter((tile) => !isSettled(tile.key) && tile.key !== inflightKeyRef.current),
    [isSettled],
  );

  const traceNextTile = useCallback(() => {
    if (inflightKeyRef.current) return;
    const tile = queueRef.current.shift();
    if (!tile) {
      setLoading(false);
      return;
    }
    inflightKeyRef.current = tile.key;
    setLoading(true);
    fetchZoneParcels(tile.center.lat, tile.center.lng, TILE_RADIUS_M)
      .then((tileResult) => {
        const features = featuresInTile(tileResult.geojson.features, tile);
        tileResultsRef.current.set(tile.key, { ...tileResult, geojson: { ...tileResult.geojson, features } });
        setResult(mergedResult());
        setError(null);
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : "La délimitation automatique a échoué.";
        setError(message);
        // Service injoignable ou en panne : inutile d'insister sur les autres
        // zones, on réessaiera au prochain déplacement de la carte. Une zone
        // refusée (400), elle, ne sera pas redemandée.
        const serviceDown = !(err instanceof ZoneParcelsHttpError) || err.status >= 500;
        if (serviceDown) {
          queueRef.current = [];
          requiredRef.current = [];
          const waiters = waitersRef.current;
          waitersRef.current = [];
          waiters.forEach((waiter) => waiter.reject(new Error(`Traçage de la zone interrompu : ${message}`)));
        } else {
          failedTilesRef.current.add(tile.key);
        }
      })
      .finally(() => {
        inflightKeyRef.current = null;
        refreshProgress();
        settleWaiters();
        traceNextTile();
      });
  }, [mergedResult, refreshProgress, settleWaiters]);

  const onViewportIdle = useCallback((map: google.maps.Map) => {
    const bounds = map.getBounds();
    const center = map.getCenter();
    const zoom = map.getZoom();
    if (!bounds || !center || zoom === undefined) return;

    // Les carrés exigés par une analyse en cours passent toujours en premier, quel que soit le cadrage.
    const required = pendingRequiredTiles();
    if (zoom < MIN_TRACING_ZOOM) {
      setZoomTooLow(true);
      visibleKeysRef.current = [];
      queueRef.current = required;
      refreshProgress();
      traceNextTile();
      return;
    }
    setZoomTooLow(false);

    const northEast = bounds.getNorthEast();
    const southWest = bounds.getSouthWest();
    const tiles = tilesForBounds(
      { south: southWest.lat(), north: northEast.lat(), west: southWest.lng(), east: northEast.lng() },
      { lat: center.lat(), lng: center.lng() },
    );
    visibleKeysRef.current = tiles.map((tile) => tile.key);
    const requiredKeys = new Set(required.map((tile) => tile.key));
    queueRef.current = [
      ...required,
      ...tiles.filter((tile) => !isSettled(tile.key) && tile.key !== inflightKeyRef.current && !requiredKeys.has(tile.key)),
    ];
    refreshProgress();
    traceNextTile();
  }, [isSettled, pendingRequiredTiles, refreshProgress, traceNextTile]);

  /** Résout quand tous les carrés sont tracés (ou refusés) ; rejette si le service tombe. */
  const ensureTilesTraced = useCallback((tiles: TraceTile[], onProgress?: (done: number, total: number) => void) => {
    const pending = tiles.filter((tile) => !isSettled(tile.key));
    onProgress?.(tiles.length - pending.length, tiles.length);
    if (pending.length === 0) return Promise.resolve();

    return new Promise<void>((resolve, reject) => {
      const requiredKeys = new Set(requiredRef.current.map((tile) => tile.key));
      requiredRef.current = [...requiredRef.current, ...pending.filter((tile) => !requiredKeys.has(tile.key))];
      waitersRef.current.push({ keys: tiles.map((tile) => tile.key), resolve, reject, onProgress });
      const required = pendingRequiredTiles();
      const keys = new Set(required.map((tile) => tile.key));
      queueRef.current = [...required, ...queueRef.current.filter((tile) => !keys.has(tile.key))];
      traceNextTile();
    });
  }, [isSettled, pendingRequiredTiles, traceNextTile]);

  /**
   * Trace tous les carrés du cercle d'analyse, puis y cherche les champs non tracés et les
   * ajoute comme parcelles complémentaires : à la fin, la zone ne compte plus de parcelle
   * cultivée sans contour, au-delà du reste mesuré dans `coverage.untracedAreaHaAfter`.
   */
  const prepareAnalysisZone = useCallback(async (
    center: { lat: number; lng: number },
    radiusM: number,
    onProgress?: (progress: ZonePreparationProgress) => void,
  ): Promise<PreparedZone> => {
    const tiles = tilesForCircle(center, radiusM);
    if (tiles.length > MAX_ANALYSIS_TILES) {
      throw new Error(
        `Zone trop grande : ${tiles.length} carrés de 1,2 km à tracer (30 à 60 s chacun). `
        + `Réduisez le rayon pour rester sous ${MAX_ANALYSIS_TILES} carrés (environ 3 km).`,
      );
    }

    await ensureTilesTraced(tiles, (done, total) => onProgress?.({ phase: "tracing", done, total }));

    const traced = tiles.filter((tile) => tileResultsRef.current.has(tile.key));
    const warnings: string[] = [];
    let unchecked = 0;
    for (const [index, tile] of traced.entries()) {
      onProgress?.({ phase: "coverage", done: index, total: traced.length });
      if (coverageRef.current.has(tile.key)) continue;
      try {
        // Contours connus autour du carré, compléments des carrés voisins compris, pour ne
        // jamais ajouter deux fois le même champ.
        const known = tracedParcelsWithinRadius(mergedResult(), tile.center.lat, tile.center.lng, TILE_RADIUS_M, 2_000);
        const coverage = await fetchZoneCoverage(tile.center, TILE_RADIUS_M, tile, known);
        complementsRef.current.set(tile.key, coverage.geojson.features);
        coverageRef.current.set(tile.key, coverage.coverage);
        coverage.warnings.forEach((warning) => { if (!warnings.includes(warning)) warnings.push(warning); });
        setResult(mergedResult());
      } catch (err) {
        unchecked += 1;
        const message = err instanceof Error ? err.message : "Recherche des parcelles non tracées impossible.";
        if (!warnings.includes(message)) warnings.push(message);
      }
    }
    onProgress?.({ phase: "coverage", done: traced.length, total: traced.length });

    const failed = tiles.length - traced.length;
    if (failed > 0) warnings.push(`${failed} carré(s) refusé(s) par le service de traçage : leurs parcelles ne sont pas analysées.`);
    if (unchecked > 0) warnings.push(`${unchecked} carré(s) sans recherche de parcelles non tracées.`);

    const result = mergedResult();
    const summaries = traced.flatMap((tile) => coverageRef.current.get(tile.key) ?? []);
    const tracedCount = tracedParcelsWithinRadius(result, center.lat, center.lng, radiusM, Number.POSITIVE_INFINITY).length;
    return { result, coverage: sumCoverage(tiles, failed, unchecked, summaries, tracedCount), warnings };
  }, [ensureTilesTraced, mergedResult]);

  return { result, loading, error, progress, zoomTooLow, onViewportIdle, prepareAnalysisZone };
}
