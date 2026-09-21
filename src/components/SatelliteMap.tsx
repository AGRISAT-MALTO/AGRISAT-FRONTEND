import { useCallback, useEffect, useRef, useState } from "react";
import { GoogleMap, useJsApiLoader } from "@react-google-maps/api";
import AutomaticParcelOverlays from "./AutomaticParcelOverlays";
import SimpleFieldOverlays from "./SimpleFieldOverlays";
import MicroParcelOverlays from "./MicroParcelOverlays";
import MicroParcelPanel from "./MicroParcelPanel";
import Sentinel2TileLayer from "./Sentinel2TileLayer";
import CoordinateInput from "./CoordinateInput";
import ParcelOverlays from "./ParcelOverlays";
import ParcelCasePanel, { type AnalysisResultData, type CulturePanelTab } from "./ParcelCasePanel";
import VegetationChartsPanel from "./VegetationChartsPanel";
import VegetationLegend from "./VegetationLegend";
import CropLegend from "./CropLegend";
import DateMonthStrip from "./DateMonthStrip";
import ZoningOverlay from "./ZoningOverlay";
import { useNavigate } from "react-router-dom";
import { BarChart3, Wheat, Trash2 } from "lucide-react";
import brocheIconUrl from "@/img/broche.png";
import { getDetectedBarleySegments, searchAutomaticParcels, type AutomaticParcelSearchResult } from "@/lib/automatic-parcels";
import { runSimpleAnalysis } from "@/lib/barley-detect-simple";
import { runMicroParcelsAnalysis, type MicroParcelFeature } from "@/lib/micro-parcels";
import { usePersistedAnalyses } from "@/hooks/usePersistedAnalyses";
import type { BarleyDetectionConfig } from "@/lib/barley-detection";
import { useParcelles, type Parcelle } from "@/hooks/useParcelles";
import { cropColor } from "@/lib/crop-colors";
import { resolveCropName } from "@/lib/map-tooltip";
import { computeSurfaceHa } from "@/lib/geo";
import { computeParcelZoning, type ZoningResult } from "@/lib/zoning";

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

const DEFAULT_CENTER = { lat: -19.848219, lng: 47.011882 };
const DEFAULT_ZOOM = 4;
const TARGET_ZOOM = 16;
const ANALYSIS_VIEWPORT_PADDING = 1.25;
const LIBRARIES: ("geometry")[] = ["geometry"];

const mapContainerStyle = { width: "100%", height: "100%" };

type DrawnParcel = {
  points: Array<{ lat: number; lng: number }>;
  center: { lat: number; lng: number };
  ownerName: string;
  notes: string;
};

const mapOptions: google.maps.MapOptions = {
  mapTypeId: "hybrid",
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
  // Analyses persistées en session : conservées quand on va au dashboard et retour.
  const { simpleResult, setSimpleResult, microResult, setMicroResult } = usePersistedAnalyses();
  const [isSearchingSimple, setIsSearchingSimple] = useState(false);
  const [simpleSearchError, setSimpleSearchError] = useState("");
  // Micro-parcelles : découpage fin suivant les clôtures + analyse par micro-zone.
  const [isSearchingMicro, setIsSearchingMicro] = useState(false);
  const [microSearchError, setMicroSearchError] = useState("");
  const [selectedMicro, setSelectedMicro] = useState<MicroParcelFeature | null>(null);
  const [drawnParcel, setDrawnParcel] = useState<DrawnParcel | null>(null);
  const [selectedParcelle, setSelectedParcelle] = useState<Parcelle | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResultData | null>(null);
  const [selectedMonthIndex, setSelectedMonthIndex] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<CulturePanelTab>("vegetation");
  const [zoningResult, setZoningResult] = useState<ZoningResult | null>(null);
  const [zoningLoading, setZoningLoading] = useState(false);
  const [zoningError, setZoningError] = useState("");
  // Panneaux repliables comme le panneau d'analyse (CoordinateInput) :
  // légende des cultures (haut gauche) et bouton tableau de bord (bas gauche).
  const [legendExpanded, setLegendExpanded] = useState(true);
  const [dashboardExpanded, setDashboardExpanded] = useState(true);
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
  const { parcelles, addParcelle, deleteParcelle, refetch } = useParcelles();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Au (re)montage de la carte (retour du dashboard en SPA : le composant a été
  // démonté), recharge immédiate : les suppressions du dashboard s'appliquent
  // sans attendre l'intervalle de 30 s.
  useEffect(() => {
    void refetch();
  }, [refetch]);

  const handleDeleteParcelle = useCallback(async (id: string) => {
    setDeletingId(id);
    try {
      await deleteParcelle(id);
      setSelectedParcelle((prev) => (prev?.id === id ? null : prev));
    } finally {
      setDeletingId(null);
    }
  }, [deleteParcelle]);

  const handleDeleteMicro = useCallback((feature: MicroParcelFeature) => {
    // Micro-zone de session (non persistée individuellement) : la retirer du
    // résultat affiché ; le registre garde la trace horodatée côté backend.
    setMicroResult((prev) => {
      if (!prev) return prev;
      const ring = feature.geometry.coordinates[0] ?? [];
      const key = (c: number[]) => `${c[0].toFixed(6)},${c[1].toFixed(6)}`;
      const target = ring.map(key).join("|");
      return {
        ...prev,
        features: prev.features.filter((f) => (f.geometry.coordinates[0] ?? []).map(key).join("|") !== target),
      };
    });
    setSelectedMicro(null);
  }, []);
  const displayedBarleySegmentCount = searchResult?.parcels.reduce(
    (total, parcel) => total + getDetectedBarleySegments(parcel).length,
    0,
  ) ?? 0;

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
    setLocated(true);
  }, [placeCursorMarker]);

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
  }, [pinMarker]);

  const handleAutomaticSearch = useCallback(async (lat: number, lng: number, radiusKm: number, config: BarleyDetectionConfig) => {
    setIsSearching(true);
    setSearchError("");
    setSearchResult(null);
    try {
      const result = await searchAutomaticParcels(lat, lng, radiusKm, config);
      setSearchResult(result);
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : "La recherche automatique a échoué.");
    } finally {
      setIsSearching(false);
    }
  }, []);

  const handleSimpleSearch = useCallback(async (lat: number, lng: number, radiusM: number, confidenceThreshold: number, gddConfig: BarleyDetectionConfig) => {
    setIsSearchingSimple(true);
    setSimpleSearchError("");
    setSimpleResult(null);
    try {
      const result = await runSimpleAnalysis(lat, lng, radiusM, { confidenceThreshold, ...gddConfig });
      setSimpleResult(result);
    } catch (error) {
      setSimpleSearchError(error instanceof Error ? error.message : "L'analyse Sentinel-2 a échoué.");
    } finally {
      setIsSearchingSimple(false);
    }
  }, []);

  const handleMicroSearch = useCallback(async (lat: number, lng: number, radiusM: number, confidenceThreshold: number, gddConfig: BarleyDetectionConfig, sources: Record<string, boolean>) => {
    setIsSearchingMicro(true);
    setMicroSearchError("");
    setMicroResult(null);
    setSelectedMicro(null);
    try {
      const result = await runMicroParcelsAnalysis(lat, lng, radiusM, { confidenceThreshold, ...gddConfig, sources });
      setMicroResult(result);
    } catch (error) {
      setMicroSearchError(error instanceof Error ? error.message : "L'analyse micro-parcelles a échoué.");
    } finally {
      setIsSearchingMicro(false);
    }
  }, []);

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

  const handleSelectParcelle = useCallback((parcelle: Parcelle) => {
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
    // Contour dessiné : couleur de la culture analysée si connue, sinon NDVI en repli.
    const cropName = analysisResult?.culture_detected
      ? resolveCropName(analysisResult.culture_detected, selectedNdvi)
      : null;
    const color = cropName ? cropColor(cropName) : "#9ca3af";
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
  }, [drawnParcel, selectedNdvi, analysisResult?.culture_detected]);

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

          {/* Fond Sentinel-2 : uniquement l'image exacte de l'analyse en cours, sur la zone recherchée (pas de fond permanent) */}
          {simpleResult?.imageTimestampMs != null && (
            <Sentinel2TileLayer map={mapRef.current} imageTimestampMs={simpleResult.imageTimestampMs} />
          )}

          {/* Parcelles enregistrées dans la base de données — cliquables pour rouvrir leur fiche */}
          <ParcelOverlays map={mapRef.current} parcelles={parcelles} onSelect={handleSelectParcelle} />

          {/* Parcels discovered from the GPS search */}
          <AutomaticParcelOverlays map={mapRef.current} parcels={searchResult?.parcels ?? []} />

          {/* Orge détectée par la pipeline Sentinel-2 (segmentation SNIC) */}
          <SimpleFieldOverlays map={mapRef.current} result={simpleResult} />

          {/* Micro-parcelles : découpage fin suivant les clôtures, une analyse par micro-zone */}
          <MicroParcelOverlays map={mapRef.current} result={microResult} onSelect={setSelectedMicro} />

          {/* Recherche et analyse affichées dans le panneau à droite */}
          <CoordinateInput
            onNavigate={handleNavigate}
            onClearSimple={() => setSimpleResult(null)}
            onClearMicro={() => { setMicroResult(null); setSelectedMicro(null); }}
            onSearch={handleAutomaticSearch}
            search={searchResult}
            isSearching={isSearching}
            searchError={searchError}
            onSearchSimple={handleSimpleSearch}
            simpleResult={simpleResult}
            isSearchingSimple={isSearchingSimple}
            simpleSearchError={simpleSearchError}
            onSearchMicro={handleMicroSearch}
            microResult={microResult}
            isSearchingMicro={isSearchingMicro}
            microSearchError={microSearchError}
            pickedLocation={pickedLocation}
            forceCollapse={caseActive}
          />

          {caseActive && analysisResult && (
            <VegetationLegend percentage={selectedNdvi} className="absolute top-16 right-4 sm:top-24" />
          )}

          {/* Légende : une couleur par famille de culture (repliable comme le panneau d'analyse) */}
          {legendExpanded ? (
            <CropLegend className="absolute top-4 left-4 hidden sm:flex" onCollapse={() => setLegendExpanded(false)} />
          ) : (
            <button
              onClick={() => setLegendExpanded(true)}
              className="absolute top-4 left-4 z-[800] analysis-popup p-3 hover:scale-105 transition-transform hidden sm:block"
              title="Afficher la légende des cultures"
            >
              <Wheat className="w-5 h-5 text-primary" />
            </button>
          )}

          {/* Dashboard link (repliable comme le panneau d'analyse) */}
          {dashboardExpanded ? (
            <div className="absolute bottom-8 left-20 z-[850] analysis-popup px-4 py-3 flex items-center gap-2">
              <button
                onClick={() => navigate("/dashboard")}
                className="flex items-center gap-2 hover:scale-105 transition-transform"
              >
                <BarChart3 className="w-4 h-4 text-primary" />
                <span className="text-sm text-foreground font-medium">Tableau de bord</span>
              </button>
              <button
                onClick={() => setDashboardExpanded(false)}
                className="w-5 h-5 flex items-center justify-center rounded-full bg-muted text-muted-foreground hover:text-foreground text-[10px]"
                title="Masquer le bouton tableau de bord"
              >
                ✕
              </button>
            </div>
          ) : (
            <button
              onClick={() => setDashboardExpanded(true)}
              className="absolute bottom-8 left-20 z-[850] analysis-popup p-3 hover:scale-105 transition-transform"
              title="Afficher le bouton tableau de bord"
            >
              <BarChart3 className="w-5 h-5 text-primary" />
            </button>
          )}

          {searchResult && (
            <div className="absolute bottom-8 left-4 right-32 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 sm:max-w-lg z-[800] analysis-popup px-4 py-2.5 animate-fade-in">
              <p className="text-xs text-muted-foreground">
                <span className="inline-block w-2.5 h-2.5 rounded-sm border-2 border-yellow-400 mr-2 align-middle" />
                {displayedBarleySegmentCount} contour(s) d’orge détecté(s) · {searchResult.candidates_found} zone(s) analysée(s)
              </p>
            </div>
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
          onDiscard={() => {
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
          onDelete={handleDeleteParcelle}
          deleting={deletingId === selectedParcelle.id}
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

      {selectedMicro && (
        <MicroParcelPanel
          feature={selectedMicro}
          onDelete={handleDeleteMicro}
          onClose={() => setSelectedMicro(null)}
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
