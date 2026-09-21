import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DEFAULT_BARLEY_DETECTION_CONFIG, type BarleyDetectionConfig } from "@/lib/barley-detection";
import { getDetectedBarleySegments, type AutomaticParcelSearchResult } from "@/lib/automatic-parcels";
import { isWaterLabel } from "@/lib/crop-colors";
import type { SimpleAnalysisResult } from "@/lib/barley-detect-simple";
import type { MicroParcelsResult } from "@/lib/micro-parcels";
import { LocateFixed, MapPinned, Radar, ThermometerSun, Grid3X3, Trash2 } from "lucide-react";

interface CoordinateInputProps {
  onNavigate: (lat: number, lng: number, radiusKm: number) => void;
  onSearch: (lat: number, lng: number, radiusKm: number, config: BarleyDetectionConfig) => Promise<void>;
  search: AutomaticParcelSearchResult | null;
  isSearching: boolean;
  searchError: string;
  onSearchSimple: (lat: number, lng: number, radiusKm: number, confidenceThreshold: number, gddConfig: BarleyDetectionConfig) => Promise<void>;
  simpleResult: SimpleAnalysisResult | null;
  isSearchingSimple: boolean;
  simpleSearchError: string;
  onSearchMicro: (lat: number, lng: number, radiusM: number, confidenceThreshold: number, gddConfig: BarleyDetectionConfig) => Promise<void>;
  microResult: MicroParcelsResult | null;
  isSearchingMicro: boolean;
  microSearchError: string;
  onClearSimple?: () => void;
  onClearMicro?: () => void;
  pickedLocation: { lat: number; lng: number } | null;
  /** Replie le panneau (sans empêcher une réouverture manuelle) quand il passe à true — utilisé
   * pour éviter le chevauchement avec le panneau d'analyse de parcelle dockée à droite. */
  forceCollapse?: boolean;
}

export default function CoordinateInput({
  onNavigate, onSearch, search, isSearching, searchError,
  onSearchSimple, simpleResult, isSearchingSimple, simpleSearchError,
  onSearchMicro, microResult, isSearchingMicro, microSearchError,
  onClearSimple, onClearMicro,
  pickedLocation, forceCollapse,
}: CoordinateInputProps) {
  const [lat, setLat] = useState("-19.848219");
  const [lng, setLng] = useState("47.011882");
  const [microRadiusValue, setMicroRadiusValue] = useState("150");
  const [microRadiusUnit, setMicroRadiusUnit] = useState<"m" | "km">("m");
  const [baseTemperature, setBaseTemperature] = useState(String(DEFAULT_BARLEY_DETECTION_CONFIG.baseTemperature));
  const [threshold, setThreshold] = useState(String(DEFAULT_BARLEY_DETECTION_CONFIG.threshold));
  const [periodDays, setPeriodDays] = useState("130");
  const [expanded, setExpanded] = useState(true);
  const [validationError, setValidationError] = useState("");
  const [isLocating, setIsLocating] = useState(false);
  const [locationError, setLocationError] = useState("");

  const detectedCultures = simpleResult
    ? Array.from(new Set(simpleResult.features.flatMap((feature) => [
        feature.properties.culture,
        ...(Array.isArray(feature.properties.alternatives) ? feature.properties.alternatives : []),
      ]).filter((label) => !isWaterLabel(label)))).join(" · ")
    : "";

  const microCultures = microResult
    ? Array.from(new Set(microResult.features.map((feature) => feature.properties.culture).filter((label) => !isWaterLabel(label)))).join(" · ")
    : "";

  useEffect(() => {
    if (!pickedLocation) return;
    setLat(pickedLocation.lat.toFixed(6));
    setLng(pickedLocation.lng.toFixed(6));
    setExpanded(true);
  }, [pickedLocation]);

  useEffect(() => {
    if (forceCollapse) setExpanded(false);
  }, [forceCollapse]);

  useEffect(() => {
    if (!search) return;
    const segments = search.parcels.flatMap(getDetectedBarleySegments);
    const isUncertain = search.parcels.some((parcel) => {
      const verdict = parcel.analysis?.verdict?.toUpperCase() ?? "";
      return verdict.includes("INCERTAIN") || verdict.includes("INDÉTERMIN") || verdict.includes("INDETERMIN");
    });

    if (segments.length > 0) {
      toast.success("Orge détectée avec succès", {
        description: `${segments.length} objet(s) d’orge confirmé(s) dans la zone.`,
      });
    } else if (isUncertain) {
      toast.warning("Détection incertaine", {
        description: "Validation terrain recommandée pour confirmer la présence d’orge.",
      });
    } else {
      toast.error("Aucune orge détectée", {
        description: "La zone analysée ne présente pas de culture d’orge.",
      });
    }
  }, [search]);

  const handleUseMyLocation = () => {
    if (!("geolocation" in navigator)) {
      setLocationError("La géolocalisation n’est pas disponible sur cet appareil.");
      return;
    }
    setLocationError("");
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const latNum = position.coords.latitude;
        const lngNum = position.coords.longitude;
        setLat(latNum.toFixed(6));
        setLng(lngNum.toFixed(6));
        setIsLocating(false);
        // Default radius of 10 km when using geolocation
        onNavigate(latNum, lngNum, 10);
      },
      (error) => {
        setIsLocating(false);
        setLocationError(
          error.code === error.PERMISSION_DENIED
            ? "Accès à la position refusé. Autorisez la localisation dans votre navigateur."
            : "Impossible de récupérer votre position."
        );
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  /** Micro-parcelles : découpe fine suivant les clôtures + une analyse par micro-zone (rayon 10 m à 5 km). */
  const handleMicroSearch = async () => {
    const latNum = Number(lat);
    const lngNum = Number(lng);
    if (!Number.isFinite(latNum) || latNum < -90 || latNum > 90 || !Number.isFinite(lngNum) || lngNum < -180 || lngNum > 180) {
      setValidationError("Saisissez une latitude et une longitude valides.");
      return;
    }
    const radiusInput = Number(microRadiusValue);
    const radiusM = microRadiusUnit === "m" ? radiusInput : radiusInput * 1000;
    if (!Number.isFinite(radiusM) || radiusM < 10 || radiusM > 5000) {
      setValidationError("Le rayon micro-parcelles doit être compris entre 10 m et 5 km.");
      return;
    }
    // Default confidence threshold (70%)
    const confidencePercentNum = 70;
    const gddConfig: BarleyDetectionConfig = {
      baseTemperature: Number(baseTemperature),
      threshold: Number(threshold),
      periodDays: Number(periodDays),
    };
    if (!Number.isFinite(gddConfig.baseTemperature) || gddConfig.baseTemperature < -20 || gddConfig.baseTemperature > 30) {
      setValidationError("Tbase doit être compris entre -20 et 30 °C.");
      return;
    }
    if (!Number.isFinite(gddConfig.threshold) || gddConfig.threshold < DEFAULT_BARLEY_DETECTION_CONFIG.threshold || gddConfig.threshold > 10000) {
      setValidationError("Le seuil nécessaire doit être compris entre 2 200 et 10 000 °C.");
      return;
    }
    if (!Number.isInteger(gddConfig.periodDays) || gddConfig.periodDays < 1 || gddConfig.periodDays > 730) {
      setValidationError("La période doit être comprise entre 1 et 730 jours.");
      return;
    }

    setValidationError("");
    onNavigate(latNum, lngNum, radiusM / 1000);
    await onSearchMicro(latNum, lngNum, radiusM, confidencePercentNum / 100, gddConfig);
  };

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="absolute top-4 right-4 z-[800] analysis-popup p-3 hover:scale-105 transition-transform"
        title="Rechercher des parcelles autour d’une coordonnée"
      >
        <MapPinned className="w-5 h-5 text-primary" />
      </button>
    );
  }

  return (
    <div className="absolute top-4 right-4 bottom-24 sm:bottom-auto z-[800] analysis-popup p-4 w-[min(20rem,calc(100vw-2rem))] max-h-none sm:max-h-[calc(100vh-2rem)] overflow-y-auto">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Radar className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">Recherche automatique</span>
        </div>
        <button
          onClick={() => setExpanded(false)}
          className="w-6 h-6 flex items-center justify-center rounded-full bg-muted text-muted-foreground hover:text-foreground text-xs"
        >
          ✕
        </button>
      </div>
      <form className="space-y-2">
        {locationError && <p className="text-xs text-destructive">{locationError}</p>}
        <Input
          type="number"
          step="any"
          placeholder="Latitude (ex. -18.8792)"
          value={lat}
          onChange={(e) => setLat(e.target.value)}
          className="bg-background/50 text-sm h-9"
        />
        <Input
          type="number"
          step="any"
          placeholder="Longitude (ex. 47.5079)"
          value={lng}
          onChange={(e) => setLng(e.target.value)}
          className="bg-background/50 text-sm h-9"
        />
        <label className="block text-xs text-muted-foreground">
          Rayon découpage micro-parcelles
          <div className="mt-1 flex gap-1">
            <Input
              type="number"
              min={microRadiusUnit === "m" ? "10" : "0.01"}
              max={microRadiusUnit === "m" ? "5000" : "5"}
              step={microRadiusUnit === "m" ? "10" : "0.05"}
              value={microRadiusValue}
              onChange={(e) => setMicroRadiusValue(e.target.value)}
              className="bg-background/50 text-sm h-9 flex-1"
            />
            <select
              value={microRadiusUnit}
              onChange={(e) => setMicroRadiusUnit(e.target.value as "m" | "km")}
              className="h-9 rounded-md border border-input bg-background/50 px-2 text-sm text-foreground"
            >
              <option value="m">m</option>
              <option value="km">km</option>
            </select>
          </div>
          <span className="mt-1 block text-[11px]">Découpage HR + confirmation · 10 m à 5 km</span>
        </label>
        <div className="rounded-lg border border-border/70 bg-muted/40 p-2.5 space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
            <ThermometerSun className="w-3.5 h-3.5 text-primary" />
            Paramètres degrés-jours
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px] text-muted-foreground">
              Tbase (°C)
              <Input type="number" min="-20" max="30" step="0.1" value={baseTemperature} onChange={(e) => setBaseTemperature(e.target.value)} className="mt-1 h-8 text-xs bg-background/70" />
            </label>
            <label className="text-[11px] text-muted-foreground">
              Seuil nécessaire (°C)
              <Input type="number" min={DEFAULT_BARLEY_DETECTION_CONFIG.threshold} max="10000" step="1" value={threshold} onChange={(e) => setThreshold(e.target.value)} className="mt-1 h-8 text-xs bg-background/70" />
            </label>
          </div>
          <label className="block text-[11px] text-muted-foreground">
            Période de culture (jours)
            <Input type="number" min="1" max="730" step="1" value={periodDays} onChange={(e) => setPeriodDays(e.target.value)} className="mt-1 h-8 text-xs bg-background/70" />
          </label>
        </div>
        {validationError && <p className="text-xs text-destructive">{validationError}</p>}
        {searchError && <p className="text-xs text-destructive">{searchError}</p>}
        {simpleSearchError && <p className="text-xs text-destructive">{simpleSearchError}</p>}
        {microSearchError && <p className="text-xs text-destructive">{microSearchError}</p>}
        <Button type="button" size="sm" className="w-full gap-2" disabled={isSearchingMicro} onClick={() => void handleMicroSearch()}>
          {isSearchingMicro
            ? <span key="icon" className="w-3.5 h-3.5 rounded-full border-2 border-primary-foreground/40 border-t-primary-foreground animate-spin" />
            : <Grid3X3 key="icon" className="w-4 h-4" />}
          <span key="label">{isSearchingMicro ? "Analyse en cours..." : "Lancer l'analyse"}</span>
        </Button>
      </form>
      {simpleSearchError && <p className="mt-2 text-xs text-destructive">{simpleSearchError}</p>}
      {simpleResult && (
        <div className="mt-3 rounded-lg border border-cyan-400/60 bg-cyan-400/10 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-foreground">Analyse Sentinel-2</p>
            <span className="flex items-center gap-1.5">
              <span className="text-xs font-mono text-muted-foreground">{(simpleResult.radiusM / 1000).toFixed(2)} km</span>
              {onClearSimple && (
                <button
                  type="button"
                  onClick={onClearSimple}
                  className="w-6 h-6 flex items-center justify-center rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  title="Supprimer cette analyse"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="rounded-md bg-background/60 p-2">
              <p className="text-lg font-semibold text-foreground">{simpleResult.candidatesFound}</p>
              <p className="text-[10px] text-muted-foreground">candidats</p>
            </div>
            <div className="rounded-md bg-cyan-300/30 dark:bg-cyan-400/15 p-2">
              <p className="text-lg font-semibold text-cyan-700 dark:text-cyan-300">{simpleResult.features.length}</p>
              <p className="text-[10px] text-cyan-800 dark:text-cyan-400">cultures détectées</p>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Image Sentinel-2 : {simpleResult.imageDate ?? "—"} ({simpleResult.imageAgeDays ?? "?"} j) · nuages {simpleResult.cloudPercentage ?? "?"}% · seuil de confiance {Math.round(simpleResult.confidenceThreshold * 100)}%
          </p>
          <p className="text-[11px] text-muted-foreground">
            Lecture multi-cultures indicative · validation terrain recommandée
          </p>
          {detectedCultures && <p className="text-[11px] font-medium text-cyan-800 dark:text-cyan-300">{detectedCultures}</p>}
          {simpleResult.warnings.length > 0 && (
            <div className="rounded-md bg-amber-100/80 dark:bg-amber-500/15 px-2 py-1.5 space-y-0.5">
              {simpleResult.warnings.map((warning, index) => (
                <p key={index} className="text-[11px] text-amber-900 dark:text-amber-300">{warning}</p>
              ))}
            </div>
          )}
          <p className="text-[11px] text-cyan-800 dark:text-cyan-400">Cyan : segmentation SNIC Sentinel-2 et classification indicative par signatures NDVI/NDRE/NDWI. Le fond affiche l'image Sentinel-2 utilisée.</p>
        </div>
      )}
      {microSearchError && <p className="mt-2 text-xs text-destructive">{microSearchError}</p>}
      {microResult && (
        <div className="mt-3 rounded-lg border border-emerald-400/60 bg-emerald-400/10 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-foreground">Micro-parcelles</p>
            <span className="flex items-center gap-1.5">
              <span className="text-xs font-mono text-muted-foreground">zoom {microResult.imageZoom} · {microResult.segmentation.metersPerPixel} m/px</span>
              {onClearMicro && (
                <button
                  type="button"
                  onClick={onClearMicro}
                  className="w-6 h-6 flex items-center justify-center rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  title="Supprimer ce découpage"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="rounded-md bg-background/60 p-2">
              <p className="text-lg font-semibold text-foreground">{microResult.features.length}</p>
              <p className="text-[10px] text-muted-foreground">micro-zones analysées</p>
            </div>
            <div className="rounded-md bg-emerald-300/30 dark:bg-emerald-400/15 p-2">
              <p className="text-lg font-semibold text-emerald-700 dark:text-emerald-300">
                {microResult.features.reduce((s, f) => s + f.properties.areaHa, 0).toFixed(2)} ha
              </p>
              <p className="text-[10px] text-emerald-800 dark:text-emerald-400">surface totale</p>
            </div>
          </div>
          {microCultures && <p className="text-[11px] font-medium text-emerald-800 dark:text-emerald-300">{microCultures}</p>}
          {microResult.warnings.length > 0 && (
            <div className="rounded-md bg-amber-100/80 dark:bg-amber-500/15 px-2 py-1.5 space-y-0.5">
              {microResult.warnings.map((warning, index) => (
                <p key={index} className="text-[11px] text-amber-900 dark:text-amber-300">{warning}</p>
              ))}
            </div>
          )}
          <p className="text-[11px] text-emerald-800 dark:text-emerald-400">Cliquez sur une micro-zone pour ouvrir sa fiche (culture, surface, indices).</p>
        </div>
      )}
    </div>
  );
}

function toRadiusKm(value: string, unit: "m" | "km"): number {
  const numericValue = Number(value);
  return unit === "m" ? numericValue / 1000 : numericValue;
}
