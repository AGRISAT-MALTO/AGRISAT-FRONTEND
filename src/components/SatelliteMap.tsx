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
import { toast } from "sonner";
import { BarChart3, Eye, EyeOff, Loader2, LocateFixed, Minus, Pencil, Plus, Radar, Waypoints } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  zoomControl: false,
  mapTypeControl: false,
  streetViewControl: false,
  fullscreenControl: false,
};

export default function SatelliteMap() {
  const mapRef = useRef<google.maps.Map | null>(null);
  const searchAreaRef = useRef<google.maps.Circle | null>(null);
  const cursorMarkerRef = useRef<google.maps.Marker | null>(null);
  // Marqueur « ma position » : posé par le bouton au-dessus du zoom, déplacé à chaque nouvelle mesure.
  const userMarkerRef = useRef<google.maps.Marker | null>(null);
  const [isLocatingMe, setIsLocatingMe] = useState(false);
  const [showCityNames, setShowCityNames] = useState(false);
  const [editParcelMode, setEditParcelMode] = useState(false);
  const [startDrawingSignal, setStartDrawingSignal] = useState(0);
  const [openAnalysisSignal, setOpenAnalysisSignal] = useState(0);
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

  useEffect(() => {
    mapRef.current?.setMapTypeId(showCityNames ? "hybrid" : "satellite");
  }, [showCityNames]);

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

  // Bouton « afficher ma position » : géolocalisation du navigateur, marqueur bleu
  // sur la carte puis recentrage. Mêmes messages d'erreur que CoordinateInput.
  const handleShowMyPosition = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!("geolocation" in navigator)) {
      toast.error("La géolocalisation n’est pas disponible sur cet appareil.");
      return;
    }
    setIsLocatingMe(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const latlng = { lat: position.coords.latitude, lng: position.coords.longitude };
        if (userMarkerRef.current) {
          userMarkerRef.current.setPosition(latlng);
        } else {
          // Point bleu : halo (précision approximative) + centre plein, lisible sur l'image satellite.
          const dot = "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 26 26">'
            + '<circle cx="13" cy="13" r="10" fill="#2563eb" fill-opacity="0.3"/>'
            + '<circle cx="13" cy="13" r="5" fill="#2563eb" stroke="white" stroke-width="2"/></svg>');
          userMarkerRef.current = new google.maps.Marker({
            position: latlng,
            map,
            zIndex: 998,
            icon: { url: dot },
            title: "Votre position",
          });
        }
        map.panTo(latlng);
        if ((map.getZoom() ?? 0) < 15) map.setZoom(16);
        setIsLocatingMe(false);
      },
      (error) => {
        setIsLocatingMe(false);
        toast.error(
          error.code === error.PERMISSION_DENIED
            ? "Accès à la position refusé. Autorisez la localisation dans votre navigateur."
            : "Impossible de récupérer votre position."
        );
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
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
    if (!editParcelMode || points.length < 3 || drawingRef.current) return;
    setEditParcelMode(false);
    setDrawnParcel(null);
    setSelectedParcelle(null);
    setAnalysisResult(null);
    setEditingOutline({ points, style });
  }, [editParcelMode]);

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
    <div className="relative w-full h-full flex overflow-hidden bg-transparent">
      <aside className="absolute left-2 top-4 z-[850] flex h-fit w-12 flex-col items-center gap-2 rounded-2xl border border-slate-200/80 bg-slate-50/95 px-1 py-3 shadow-lg shadow-slate-900/5 backdrop-blur-sm">
        <img src="/logo-1.png" alt="AgriSat" title="AgriSat" className="mb-2 h-10 w-10 rounded-xl object-contain" />
        <button
          type="button"
          onClick={() => setEditParcelMode((active) => !active)}
          aria-pressed={editParcelMode}
          title="Modifier une parcelle : activez puis sélectionnez son contour"
          aria-label="Modifier une parcelle"
          className={`flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${editParcelMode ? "bg-emerald-100 text-emerald-800" : "text-slate-600 hover:bg-white hover:text-slate-900"}`}
        >
          <Pencil className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={() => {
            setEditParcelMode(false);
            setEditingOutline(null);
            setStartDrawingSignal((signal) => signal + 1);
          }}
          title="Tracer une parcelle"
          aria-label="Tracer une parcelle"
          className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-600 transition-colors hover:bg-white hover:text-slate-900"
        >
          <Waypoints className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={() => navigate("/dashboard")}
          title="Tableau de bord"
          aria-label="Tableau de bord"
          className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-600 transition-colors hover:bg-white hover:text-slate-900"
        >
          <BarChart3 className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={() => setOpenAnalysisSignal((signal) => signal + 1)}
          title="Afficher le formulaire d’analyse de zone"
          aria-label="Afficher le formulaire d’analyse de zone"
          className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-600 transition-colors hover:bg-white hover:text-slate-900"
        >
          <Radar className="h-5 w-5" />
        </button>
        <div className="my-1 h-px w-full bg-slate-200" />
        <button
          type="button"
          onClick={() => setShowCityNames((visible) => !visible)}
          aria-pressed={showCityNames}
          title={showCityNames ? "Masquer le nom des villes" : "Afficher le nom des villes"}
          aria-label={showCityNames ? "Masquer le nom des villes" : "Afficher le nom des villes"}
          className={`flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${showCityNames ? "bg-emerald-100 text-emerald-800" : "text-slate-600 hover:bg-white hover:text-slate-900"}`}
        >
          {showCityNames ? <Eye className="h-5 w-5" /> : <EyeOff className="h-5 w-5" />}
        </button>
        <button
          type="button"
          onClick={handleShowMyPosition}
          disabled={isLocatingMe}
          title="Afficher ma position"
          aria-label="Afficher ma position"
          className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-600 transition-colors hover:bg-white hover:text-slate-900 disabled:opacity-50"
        >
          {isLocatingMe ? <Loader2 className="h-5 w-5 animate-spin" /> : <LocateFixed className="h-5 w-5" />}
        </button>
      </aside>
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

          {/* Commandes de zoom */}
          <div className="absolute bottom-12 left-3 z-[800] flex flex-col items-center gap-1.5">
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-md">
              <button
                type="button"
                onClick={() => {
                  const map = mapRef.current;
                  if (map) map.setZoom((map.getZoom() ?? DEFAULT_ZOOM) + 1);
                }}
                title="Zoom avant"
                aria-label="Zoom avant"
                className="flex h-9 w-9 items-center justify-center text-gray-900 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Plus className="h-5 w-5" />
              </button>
              <div className="h-px bg-gray-200" />
              <button
                type="button"
                onClick={() => {
                  const map = mapRef.current;
                  if (map) map.setZoom((map.getZoom() ?? DEFAULT_ZOOM) - 1);
                }}
                title="Zoom arrière"
                aria-label="Zoom arrière"
                className="flex h-9 w-9 items-center justify-center text-gray-900 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Minus className="h-5 w-5" />
              </button>
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
              startSignal={startDrawingSignal}
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
            openSignal={openAnalysisSignal}
          />

          {caseActive && analysisResult && (
            <VegetationLegend percentage={selectedNdvi} className="absolute top-16 right-4 sm:top-24" />
          )}

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
