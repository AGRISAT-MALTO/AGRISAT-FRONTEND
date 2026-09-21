import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GoogleMap, useJsApiLoader } from "@react-google-maps/api";
import AutomaticParcelOverlays from "./AutomaticParcelOverlays";
import SimpleFieldOverlays from "./SimpleFieldOverlays";
import Sentinel2TileLayer from "./Sentinel2TileLayer";
import CoordinateInput from "./CoordinateInput";
import ParcelOverlays from "./ParcelOverlays";
import PolygonDrawer from "./PolygonDrawer";
import ParcelOutlineEditor from "./ParcelOutlineEditor";
import ParcelCasePanel, { type AnalysisResultData, type CulturePanelTab } from "./ParcelCasePanel";
import VegetationChartsPanel from "./VegetationChartsPanel";
import VegetationLegend from "./VegetationLegend";
import DateMonthStrip from "./DateMonthStrip";
import ZoningOverlay from "./ZoningOverlay";
import ZoneCropsOverlay from "./ZoneCropsOverlay";
import { fetchZoneCrops, tracedParcelsForCrops, type ZoneCropsResult } from "@/lib/zone-crops";
import FtwParcelsOverlay from "./FtwParcelsOverlay";
import { useNavigate } from "react-router-dom";
import { BarChart3 } from "lucide-react";
import brocheIconUrl from "@/img/broche.png";
import {
  searchAutomaticParcels,
  tracedParcelsWithinRadius,
  type AutomaticParcelSearchResult,
} from "@/lib/automatic-parcels";
import { runSimpleAnalysis, type SimpleAnalysisResult } from "@/lib/barley-detect-simple";
import type { BarleyDetectionConfig } from "@/lib/barley-detection";
import { useParcelles, type Parcelle } from "@/hooks/useParcelles";
import { useViewportParcelTracing } from "@/hooks/useViewportParcelTracing";
import { vegetationColor } from "@/lib/vegetation-color";
import { computeSurfaceHa } from "@/lib/geo";
import { computeParcelZoning, type ZoningResult } from "@/lib/zoning";
import {
  OUTLINE_CORRECTION_SOURCE,
  applyOutlineCorrections,
  isOutlineCorrection,
  sameParcel,
  type LatLng,
  type OutlineStyle,
} from "@/lib/outline-corrections";

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

const DEFAULT_CENTER = { lat: -19.848219, lng: 47.011882 };
const DEFAULT_ZOOM = 4;
const TARGET_ZOOM = 16;
const ANALYSIS_VIEWPORT_PADDING = 1.25;
// Délimitation automatique des parcelles visibles à l'écran (modèle JECAM sur
// image THR, /api/zone-parcels) : lancée à l'ouverture et à chaque arrêt de la
// carte, zone par zone, sans passer par une analyse. Fields of The World reste
// désactivé : cette délimitation l'a remplacé.
const VHR_PARCELS_ENABLED = true;
const LIBRARIES: ("geometry")[] = ["geometry"];

const mapContainerStyle = { width: "100%", height: "100%" };

type DrawnParcel = {
  points: Array<{ lat: number; lng: number }>;
  center: { lat: number; lng: number };
  ownerName: string;
  notes: string;
};

const mapOptions: google.maps.MapOptions = {
  mapTypeId: "satellite",
  disableDefaultUI: true,
  zoomControl: true,
  zoomControlOptions: { position: 6 /* LEFT_BOTTOM */ },
  mapTypeControl: false,
  streetViewControl: false,
  fullscreenControl: false,
};

export default function SatelliteMap() {
  const mapRef = useRef<google.maps.Map | null>(null);
  const searchAreaRef = useRef<google.maps.Circle | null>(null);
  const cursorMarkerRef = useRef<google.maps.Marker | null>(null);
  const drawnPolygonRef = useRef<google.maps.Polygon | null>(null);
  const [located, setLocated] = useState(false);
  const [pinMarker, setPinMarker] = useState<google.maps.Marker | null>(null);
  const [pickedLocation, setPickedLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [searchResult, setSearchResult] = useState<AutomaticParcelSearchResult | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [simpleResult, setSimpleResult] = useState<SimpleAnalysisResult | null>(null);
  const [isSearchingSimple, setIsSearchingSimple] = useState(false);
  const [simpleSearchError, setSimpleSearchError] = useState("");
  const [drawnParcel, setDrawnParcel] = useState<DrawnParcel | null>(null);
  // Contour tracé automatiquement en cours de correction, avant analyse et enregistrement.
  const [editingOutline, setEditingOutline] = useState<{ points: LatLng[]; style: OutlineStyle } | null>(null);
  // Pendant un dessin manuel, un clic sur un contour tracé ne doit pas ouvrir l'édition.
  const drawingRef = useRef(false);
  const handleDrawingChange = useCallback((drawing: boolean) => {
    drawingRef.current = drawing;
  }, []);
  const [selectedParcelle, setSelectedParcelle] = useState<Parcelle | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResultData | null>(null);
  const [selectedMonthIndex, setSelectedMonthIndex] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<CulturePanelTab>("vegetation");
  const [zoningResult, setZoningResult] = useState<ZoningResult | null>(null);
  const [zoningLoading, setZoningLoading] = useState(false);
  const [zoningError, setZoningError] = useState("");
  // Cultures de la zone, rendues par parcelle : contours des parcelles tracées à
  // l'écran, culture prédite par le modèle LTAE sur séries Sentinel-2 (JECAM).
  // Indépendant des détections d'orge existantes.
  const [zoneCrops, setZoneCrops] = useState<ZoneCropsResult | null>(null);
  // Zone dont les cultures sont affichées : gardée pour recalculer le découpage
  // quand le traçage automatique livre de nouvelles parcelles.
  const [zoneCropsQuery, setZoneCropsQuery] =
    useState<{ lat: number; lng: number; radiusM: number } | null>(null);
  // Délimitation automatique de TOUTES les parcelles de l'écran : exhaustive,
  // là où JECAM n'est qu'un échantillon d'environ 2 %.
  const { result: rawTracedParcels, onViewportIdle, traceZone } = useViewportParcelTracing();
  const caseActive = drawnParcel !== null || selectedParcelle !== null;
  const monthlyPoints = analysisResult?.time_series_s2 ?? [];
  const pointsByMonth = new Map(monthlyPoints.map((p) => [p.date, p]));
  // La bande de dates couvre toujours les 12 mois de l'année du dernier point de données.
  const stripYear = monthlyPoints.length > 0
    ? Number(monthlyPoints[monthlyPoints.length - 1].date.slice(0, 4))
    : new Date().getFullYear();
  const months = Array.from({ length: 12 }, (_, i) => `${stripYear}-${String(i + 1).padStart(2, "0")}`);
  const lastDataMonthIndex = monthlyPoints.length > 0
    ? months.indexOf(monthlyPoints[monthlyPoints.length - 1].date)
    : -1;
  // La bande de dates commence sur le mois le plus récent tant que l'utilisateur n'a rien choisi.
  const effectiveMonthIndex = selectedMonthIndex ?? (lastDataMonthIndex >= 0 ? lastDataMonthIndex : months.length - 1);
  const selectedNdvi = pointsByMonth.get(months[effectiveMonthIndex])?.ndvi ?? analysisResult?.percentage ?? null;
  const navigate = useNavigate();
  const { parcelles, addParcelle, deleteParcelle } = useParcelles();
  // Contours corrigés à la main : ils remplacent les parcelles tracées qu'ils recouvrent
  // (même couleur, nouvelle forme) au lieu d'être dessinés comme parcelles enregistrées.
  const outlineCorrections = useMemo(() => parcelles.filter(isOutlineCorrection), [parcelles]);
  const savedParcelles = useMemo(() => parcelles.filter((p) => !isOutlineCorrection(p)), [parcelles]);
  // Le rechargement périodique des parcelles recrée le tableau : on ne recalcule le
  // traçage corrigé (et donc la carte des cultures) que si les corrections changent.
  const correctionsKey = outlineCorrections.map((c) => c.id).join(",");
  const tracedParcels = useMemo(
    () => applyOutlineCorrections(rawTracedParcels, outlineCorrections),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rawTracedParcels, correctionsKey],
  );

  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: GOOGLE_MAPS_API_KEY,
    libraries: LIBRARIES,
  });

  const placeCursorMarker = useCallback((map: google.maps.Map, latlng: google.maps.LatLngLiteral) => {
    if (cursorMarkerRef.current) {
      cursorMarkerRef.current.setPosition(latlng);
    } else {
      const marker = new google.maps.Marker({
        position: latlng,
        map,
        draggable: true,
        cursor: "grab",
        zIndex: 999,
        icon: {
          url: brocheIconUrl,
          scaledSize: new google.maps.Size(40, 40),
          anchor: new google.maps.Point(20, 40),
        },
        title: "Glissez ou touchez la carte pour choisir un point GPS",
      });
      marker.addListener("dragend", () => {
        const pos = marker.getPosition();
        if (pos) setPickedLocation({ lat: pos.lat(), lng: pos.lng() });
      });
      cursorMarkerRef.current = marker;
    }
    setPickedLocation(latlng);
  }, []);

  const onMapLoad = useCallback((map: google.maps.Map) => {
    mapRef.current = map;

    map.addListener("click", (e: google.maps.MapMouseEvent) => {
      if (!e.latLng) return;
      placeCursorMarker(map, { lat: e.latLng.lat(), lng: e.latLng.lng() });
    });

    // Ouvre toujours sur le point par défaut (aligné avec CoordinateInput) plutôt que sur la
    // géolocalisation du navigateur ou un centre générique.
    map.panTo(DEFAULT_CENTER);
    map.setZoom(TARGET_ZOOM);
    placeCursorMarker(map, DEFAULT_CENTER);
    if (VHR_PARCELS_ENABLED) map.addListener("idle", () => onViewportIdle(map));
    setLocated(true);
  }, [onViewportIdle, placeCursorMarker]);

  const handleNavigate = useCallback((lat: number, lng: number, radiusKm: number) => {
    if (!mapRef.current) return;
    const map = mapRef.current;
    const latlng = { lat, lng };
    const bounds = boundsForRadius(lat, lng, radiusKm);
    map.fitBounds(bounds);

    if (pinMarker) pinMarker.setMap(null);
    const marker = new google.maps.Marker({
      position: latlng,
      map,
      animation: google.maps.Animation.DROP,
      title: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
    });
    setPinMarker(marker);

    searchAreaRef.current?.setMap(null);
    searchAreaRef.current = new google.maps.Circle({
      center: latlng,
      radius: radiusKm * 1000,
      strokeColor: "#ffffff",
      strokeOpacity: 0.55,
      strokeWeight: 2,
      fillOpacity: 0,
      map,
    });

    // L'écran ne couvre pas toujours toute la zone (zoom trop faible, plafond de
    // carrés par vue) : on trace explicitement chaque parcelle du cercle.
    if (VHR_PARCELS_ENABLED) traceZone(lat, lng, radiusKm * 1000);
  }, [pinMarker, traceZone]);

  // Les parcelles déjà tracées servent de découpage : la culture est rendue
  // parcelle par parcelle au lieu de colorier des îlots JECAM de plusieurs
  // dizaines d'hectares. Sans traçage sur la zone, on retombe sur les contours
  // JECAM, et les îlots trop gros ne sont dessinés qu'en contour.
  const loadZoneCrops = useCallback((lat: number, lng: number, radiusM: number) => {
    setZoneCrops(null);
    setZoneCropsQuery({ lat, lng, radiusM });
  }, []);

  // Le traçage avance carré par carré (~35 s chacun) : on redemande la carte des
  // cultures à chaque nouveau carré, ce qui l'affine progressivement au lieu de
  // la figer sur l'état du traçage au lancement de l'analyse.
  useEffect(() => {
    if (!zoneCropsQuery) return;
    const { lat, lng, radiusM } = zoneCropsQuery;
    const controller = new AbortController();
    fetchZoneCrops(lat, lng, radiusM, {
      minConfidence: 0,
      parcels: tracedParcelsForCrops(tracedParcels, lat, lng, radiusM),
      signal: controller.signal,
    })
      .then(setZoneCrops)
      .catch((error) => {
        // Pas de panneau récapitulatif : un échec laisse simplement la carte sans parcelles colorées.
        if (!controller.signal.aborted) console.warn("[MAP] Cultures de la zone indisponibles :", error);
      });
    return () => controller.abort();
  }, [zoneCropsQuery, tracedParcels]);

  const handleAutomaticSearch = useCallback(async (lat: number, lng: number, radiusKm: number, config: BarleyDetectionConfig) => {
    setIsSearching(true);
    setSearchError("");
    setSearchResult(null);
    void loadZoneCrops(lat, lng, radiusKm * 1000);
    try {
      // L'analyse classe les parcelles déjà tracées à l'écran (orge ou non) plutôt que de
      // re-segmenter l'image.
      const traced = tracedParcelsWithinRadius(tracedParcels, lat, lng, radiusKm * 1000);
      const result = await searchAutomaticParcels(lat, lng, radiusKm, config, traced);
      setSearchResult(result);
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : "La recherche automatique a échoué.");
    } finally {
      setIsSearching(false);
    }
  }, [loadZoneCrops, tracedParcels]);

  const handleSimpleSearch = useCallback(async (lat: number, lng: number, radiusM: number, confidenceThreshold: number, gddConfig: BarleyDetectionConfig) => {
    setIsSearchingSimple(true);
    setSimpleSearchError("");
    setSimpleResult(null);
    void loadZoneCrops(lat, lng, radiusM);
    try {
      const tracedParcelInputs = tracedParcelsWithinRadius(tracedParcels, lat, lng, radiusM);
      const result = await runSimpleAnalysis(lat, lng, radiusM, { confidenceThreshold, ...gddConfig, tracedParcels: tracedParcelInputs });
      setSimpleResult(result);
    } catch (error) {
      setSimpleSearchError(error instanceof Error ? error.message : "L'analyse Sentinel-2 a échoué.");
    } finally {
      setIsSearchingSimple(false);
    }
  }, [loadZoneCrops, tracedParcels]);

  const handlePolygonComplete = useCallback((points: Array<{ lat: number; lng: number }>, ownerName: string, notes: string) => {
    const map = mapRef.current;
    if (!map) return;
    const bounds = new google.maps.LatLngBounds();
    points.forEach((point) => bounds.extend(point));
    map.fitBounds(bounds);
    setSelectedParcelle(null);
    setSelectedMonthIndex(null);
    setActiveTab("vegetation");
    setZoningResult(null);
    setZoningError("");
    setDrawnParcel({ points, center: polygonCenter(points), ownerName, notes });
  }, []);

  // Clic sur une parcelle tracée automatiquement : son contour passe en édition, dans sa
  // couleur, puis sa nouvelle forme est enregistrée telle quelle en base, sans analyse.
  const handleEditTracedOutline = useCallback((_feature: unknown, points: LatLng[], style: OutlineStyle) => {
    if (points.length < 3 || drawingRef.current) return;
    setDrawnParcel(null);
    setSelectedParcelle(null);
    setAnalysisResult(null);
    setEditingOutline({ points, style });
  }, []);

  // Parcelle déjà corrigée qu'on retouche : la nouvelle forme remplace l'ancienne en base.
  const previousCorrections = useMemo(
    () => (editingOutline ? outlineCorrections.filter((c) => sameParcel(c.coordinates, editingOutline.points)) : []),
    [editingOutline, outlineCorrections],
  );

  const handleOutlineSave = useCallback(async (points: LatLng[], ownerName: string, notes: string) => {
    const center = polygonCenter(points);
    await addParcelle({
      label: ownerName,
      coordinates: points,
      center_lat: center.lat,
      center_lng: center.lng,
      surface_ha: Math.round(computeSurfaceHa(points) * 100) / 100,
      culture_declared: "",
      culture_detected: null,
      ndvi_percentage: null,
      ndre: null,
      spectral_bands: null,
      confidence: null,
      verdict: null,
      details: null,
      saison: null,
      soil_type: null,
      risk_factors: [],
      recommendations: null,
      data_source: OUTLINE_CORRECTION_SOURCE,
      owner_name: ownerName,
      notes,
      time_series_s2: [],
      time_series_s1: [],
      time_series_rain: [],
      estimated_planting_date: null,
      estimated_harvest_date: null,
      days_since_planting: null,
      growth_stage: null,
      planting_confidence: null,
      evi: null,
      savi: null,
      ndwi: null,
      agro_score: null,
      hybrid_score: null,
      cnn_prob_barley: null,
      cnn_prob_non_barley: null,
    });
    // La nouvelle forme est enregistrée avant de supprimer l'ancienne : un échec ici
    // laisse au pire un doublon, jamais une parcelle perdue.
    await Promise.all(previousCorrections.map((c) => deleteParcelle(c.id)));
    setEditingOutline(null);
  }, [addParcelle, deleteParcelle, previousCorrections]);

  const handleSelectParcelle = useCallback((parcelle: Parcelle) => {
    setEditingOutline(null);
    setDrawnParcel(null);
    setSelectedMonthIndex(null);
    setActiveTab("vegetation");
    setZoningResult(null);
    setZoningError("");
    setSelectedParcelle(parcelle);
  }, []);

  // Choisir un nouveau point GPS (clic ou glisser le repère) invalide le cas affiché : on
  // referme le panneau « Culture », on masque les graphiques et le contour dessiné disparaît.
  useEffect(() => {
    if (!pickedLocation) return;
    setDrawnParcel(null);
    setSelectedParcelle(null);
    setAnalysisResult(null);
    setSelectedMonthIndex(null);
    setActiveTab("vegetation");
    setZoningResult(null);
    setZoningError("");
  }, [pickedLocation]);

  useEffect(() => {
    drawnPolygonRef.current?.setMap(null);
    drawnPolygonRef.current = null;
    if (!drawnParcel || !mapRef.current) return;
    const color = vegetationColor(selectedNdvi);
    drawnPolygonRef.current = new google.maps.Polygon({
      paths: drawnParcel.points,
      strokeColor: color,
      strokeWeight: 5,
      strokeOpacity: 1,
      fillColor: color,
      fillOpacity: 0.18,
      zIndex: 40,
      map: mapRef.current,
    });
  }, [drawnParcel, selectedNdvi]);

  // Le dock latéral (ParcelCasePanel) et le bandeau de graphiques (VegetationChartsPanel)
  // redimensionnent le conteneur de la carte : Google Maps ne redessine pas ses tuiles tout
  // seul dans ce cas, il faut déclencher un "resize" puis recadrer sur la parcelle.
  const hasCharts = (analysisResult?.time_series_s2?.length ?? 0) > 0;
  const activePolygonPoints = drawnParcel?.points ?? selectedParcelle?.coordinates ?? null;

  const handleTabChange = useCallback((tab: CulturePanelTab) => {
    setActiveTab(tab);
    if (tab !== "zoning" || zoningResult || zoningLoading || !activePolygonPoints) return;
    setZoningError("");
    setZoningLoading(true);
    computeParcelZoning(activePolygonPoints)
      .then((result) => setZoningResult(result))
      .catch((error) => setZoningError(error instanceof Error ? error.message : "Erreur inconnue"))
      .finally(() => setZoningLoading(false));
  }, [activePolygonPoints, zoningResult, zoningLoading]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const timer = setTimeout(() => {
      google.maps.event.trigger(map, "resize");
      if (activePolygonPoints) {
        const bounds = new google.maps.LatLngBounds();
        activePolygonPoints.forEach((point) => bounds.extend(point));
        map.fitBounds(bounds);
      }
    }, 120);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawnParcel, selectedParcelle, hasCharts]);

  useEffect(() => () => {
    searchAreaRef.current?.setMap(null);
    drawnPolygonRef.current?.setMap(null);
  }, []);

  if (!isLoaded) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="relative w-16 h-16">
            <div className="absolute inset-0 rounded-full border-2 border-muted" />
            <div className="absolute inset-0 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          </div>
          <span className="text-foreground font-medium">Chargement de Google Maps...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full flex overflow-hidden">
      <div className="relative flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
        <div className="relative flex-1 min-h-0 overflow-hidden">
          <GoogleMap
            mapContainerStyle={mapContainerStyle}
            center={DEFAULT_CENTER}
            zoom={DEFAULT_ZOOM}
            options={mapOptions}
            onLoad={onMapLoad}
          />

          {!located && (
            <div className="absolute inset-0 z-[900] flex items-center justify-center bg-background/80 backdrop-blur-sm">
              <div className="flex flex-col items-center gap-4">
                <div className="relative w-16 h-16">
                  <div className="absolute inset-0 rounded-full border-2 border-muted" />
                  <div className="absolute inset-0 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                </div>
                <span className="text-foreground font-medium">Localisation en cours...</span>
                <span className="text-muted-foreground text-sm">Chargement de la carte</span>
              </div>
            </div>
          )}

          {/* Brand */}
          <div className="absolute top-4 left-4 z-[800] analysis-popup px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-primary animate-pulse" />
              <div>
                <h1 className="text-sm font-semibold text-foreground">AgriSat</h1>
                <p className="text-xs text-muted-foreground">Détection IA des cultures</p>
              </div>
            </div>
          </div>

          {/* Fond Sentinel-2 : uniquement l'image exacte de l'analyse en cours, sur la zone recherchée (pas de fond permanent) */}
          {simpleResult?.imageTimestampMs != null && (
            <Sentinel2TileLayer map={mapRef.current} imageTimestampMs={simpleResult.imageTimestampMs} />
          )}

          {/* Parcelles enregistrées dans la base de données — cliquables pour rouvrir leur fiche */}
          <ParcelOverlays map={mapRef.current} parcelles={savedParcelles} onSelect={handleSelectParcelle} />

          {/* Parcels discovered from the GPS search */}
          <AutomaticParcelOverlays map={mapRef.current} parcels={searchResult?.parcels ?? []} />

          {/* Orge détectée par la pipeline Sentinel-2 (parcelles tracées JECAM-VHR classées par le CNN) */}
          <SimpleFieldOverlays map={mapRef.current} result={simpleResult} />

          {/* Toutes les parcelles de l'écran, délimitées automatiquement (modèle JECAM sur image THR) */}
          {VHR_PARCELS_ENABLED && (
            <FtwParcelsOverlay
              map={mapRef.current}
              result={tracedParcels}
              onSelect={handleEditTracedOutline}
              hideWithin={editingOutline?.points}
            />
          )}

          {/* Parcelles JECAM/CIRAD colorées par culture prédite (modèle LTAE) */}
          <ZoneCropsOverlay
            map={mapRef.current}
            result={zoneCrops}
            onSelect={handleEditTracedOutline}
            hideWithin={editingOutline?.points}
          />

          {editingOutline ? (
            <ParcelOutlineEditor
              map={mapRef.current}
              initialPoints={editingOutline.points}
              style={editingOutline.style}
              initialOwnerName={previousCorrections[0]?.owner_name}
              initialNotes={previousCorrections[0]?.notes}
              onSave={handleOutlineSave}
              onCancel={() => setEditingOutline(null)}
            />
          ) : (
            <PolygonDrawer
              map={mapRef.current}
              onPolygonComplete={handlePolygonComplete}
              onDrawingChange={handleDrawingChange}
            />
          )}

          {/* Automatic GPS search */}
          <CoordinateInput
            onNavigate={handleNavigate}
            onSearch={handleAutomaticSearch}
            search={searchResult}
            isSearching={isSearching}
            searchError={searchError}
            onSearchSimple={handleSimpleSearch}
            simpleResult={simpleResult}
            isSearchingSimple={isSearchingSimple}
            simpleSearchError={simpleSearchError}
            pickedLocation={pickedLocation}
            forceCollapse={caseActive}
          />

          {caseActive && analysisResult && (
            <VegetationLegend percentage={selectedNdvi} className="absolute top-16 right-4 sm:top-24" />
          )}

          {/* Dashboard link */}
          <button
            onClick={() => navigate("/dashboard")}
            className="absolute bottom-8 left-20 z-[850] analysis-popup px-4 py-3 flex items-center gap-2 hover:scale-105 transition-transform"
          >
            <BarChart3 className="w-4 h-4 text-primary" />
            <span className="text-sm text-foreground font-medium">Tableau de bord</span>
          </button>

          {/* Zones VRA (onglet "Proche en zone") : raster NDVI classé, superposé sur la carte */}
          <ZoningOverlay map={mapRef.current} result={activeTab === "zoning" ? zoningResult : null} />
        </div>

        {caseActive && hasCharts && activeTab === "vegetation" && (
          <DateMonthStrip
            months={months}
            selectedIndex={effectiveMonthIndex}
            onSelect={setSelectedMonthIndex}
            className="mx-3 mb-2 shrink-0"
          />
        )}

        {caseActive && hasCharts && activeTab === "vegetation" && (
          <VegetationChartsPanel
            timeSeriesS2={analysisResult?.time_series_s2 ?? []}
            timeSeriesRain={analysisResult?.time_series_rain ?? []}
            cropLabel={analysisResult?.culture_detected}
            surfaceHa={
              drawnParcel
                ? Math.round(computeSurfaceHa(drawnParcel.points) * 100) / 100
                : selectedParcelle?.surface_ha ?? null
            }
            className="h-[260px] shrink-0"
          />
        )}
      </div>

      {drawnParcel && (
        <ParcelCasePanel
          mode="analyze"
          polygon={drawnParcel.points}
          center={drawnParcel.center}
          zoom={mapRef.current?.getZoom() ?? TARGET_ZOOM}
          onClose={() => {
            setDrawnParcel(null);
            setAnalysisResult(null);
            setSelectedMonthIndex(null);
            setActiveTab("vegetation");
            setZoningResult(null);
            setZoningError("");
          }}
          onSave={addParcelle}
          ownerName={drawnParcel.ownerName}
          notes={drawnParcel.notes}
          onResult={setAnalysisResult}
          activeTab={activeTab}
          onTabChange={handleTabChange}
          zoningResult={zoningResult}
          zoningLoading={zoningLoading}
          zoningError={zoningError}
          className="w-[320px] max-w-[85vw] h-full shrink-0"
        />
      )}

      {selectedParcelle && (
        <ParcelCasePanel
          mode="view"
          parcelle={selectedParcelle}
          onClose={() => {
            setSelectedParcelle(null);
            setAnalysisResult(null);
            setSelectedMonthIndex(null);
            setActiveTab("vegetation");
            setZoningResult(null);
            setZoningError("");
          }}
          onResult={setAnalysisResult}
          activeTab={activeTab}
          onTabChange={handleTabChange}
          zoningResult={zoningResult}
          zoningLoading={zoningLoading}
          zoningError={zoningError}
          className="w-[320px] max-w-[85vw] h-full shrink-0"
        />
      )}
    </div>
  );
}

function polygonCenter(points: Array<{ lat: number; lng: number }>): { lat: number; lng: number } {
  return {
    lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length,
    lng: points.reduce((sum, point) => sum + point.lng, 0) / points.length,
  };
}

function boundsForRadius(lat: number, lng: number, radiusKm: number): google.maps.LatLngBoundsLiteral {
  const viewportRadiusKm = radiusKm * ANALYSIS_VIEWPORT_PADDING;
  const latDelta = viewportRadiusKm / 110.574;
  const longitudeScale = Math.max(Math.abs(Math.cos((lat * Math.PI) / 180)), 0.1);
  const lngDelta = viewportRadiusKm / (111.32 * longitudeScale);
  return {
    north: lat + latDelta,
    south: lat - latDelta,
    east: lng + lngDelta,
    west: lng - lngDelta,
  };
}
