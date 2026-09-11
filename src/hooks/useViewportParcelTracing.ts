import { useCallback, useRef, useState } from "react";
import { ZoneParcelsHttpError, fetchZoneParcels, type ZoneParcelsResult } from "@/lib/zone-parcels";
import {
  MIN_TRACING_ZOOM,
  TILE_RADIUS_M,
  featuresInTile,
  mergeTileResults,
  tilesForBounds,
  type TraceTile,
} from "@/lib/viewport-tiles";

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
 */

export interface TracingProgress {
  done: number;
  total: number;
}

export function useViewportParcelTracing() {
  const tileResultsRef = useRef(new Map<string, ZoneParcelsResult>());
  const failedTilesRef = useRef(new Set<string>());
  const queueRef = useRef<TraceTile[]>([]);
  const inflightKeyRef = useRef<string | null>(null);
  const visibleKeysRef = useRef<string[]>([]);
  const [result, setResult] = useState<ZoneParcelsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<TracingProgress | null>(null);
  const [zoomTooLow, setZoomTooLow] = useState(false);

  const refreshProgress = useCallback(() => {
    const keys = visibleKeysRef.current;
    const done = keys.filter((key) => tileResultsRef.current.has(key) || failedTilesRef.current.has(key)).length;
    setProgress(keys.length > 0 ? { done, total: keys.length } : null);
  }, []);

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
        setResult(mergeTileResults([...tileResultsRef.current.values()]));
        setError(null);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "La délimitation automatique a échoué.");
        // Service injoignable ou en panne : inutile d'insister sur les autres
        // zones, on réessaiera au prochain déplacement de la carte. Une zone
        // refusée (400), elle, ne sera pas redemandée.
        const serviceDown = !(err instanceof ZoneParcelsHttpError) || err.status >= 500;
        if (serviceDown) queueRef.current = [];
        else failedTilesRef.current.add(tile.key);
      })
      .finally(() => {
        inflightKeyRef.current = null;
        refreshProgress();
        traceNextTile();
      });
  }, [refreshProgress]);

  const onViewportIdle = useCallback((map: google.maps.Map) => {
    const bounds = map.getBounds();
    const center = map.getCenter();
    const zoom = map.getZoom();
    if (!bounds || !center || zoom === undefined) return;

    if (zoom < MIN_TRACING_ZOOM) {
      setZoomTooLow(true);
      visibleKeysRef.current = [];
      queueRef.current = [];
      refreshProgress();
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
    queueRef.current = tiles.filter((tile) =>
      !tileResultsRef.current.has(tile.key)
      && !failedTilesRef.current.has(tile.key)
      && tile.key !== inflightKeyRef.current);
    refreshProgress();
    traceNextTile();
  }, [refreshProgress, traceNextTile]);

  return { result, loading, error, progress, zoomTooLow, onViewportIdle };
}
