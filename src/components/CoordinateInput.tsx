import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DEFAULT_BARLEY_DETECTION_CONFIG, type BarleyDetectionConfig } from "@/lib/barley-detection";
import { getDetectedBarleySegments, type AutomaticParcelSearchResult } from "@/lib/automatic-parcels";
import type { SimpleAnalysisResult } from "@/lib/barley-detect-simple";
import { LocateFixed, Navigation, Radar, ThermometerSun } from "lucide-react";

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
  pickedLocation: { lat: number; lng: number } | null;
  /** Replie le panneau (sans empêcher une réouverture manuelle) quand il passe à true — utilisé
   * pour éviter le chevauchement avec le panneau d'analyse de parcelle dockée à droite. */
  forceCollapse?: boolean;
  openSignal?: number;
}

export default function CoordinateInput({
  onNavigate, onSearch, search, isSearching, searchError,
  onSearchSimple, simpleResult, isSearchingSimple, simpleSearchError,
  pickedLocation, forceCollapse, openSignal = 0,
}: CoordinateInputProps) {
  const [lat, setLat] = useState("-19.848219");
  const [lng, setLng] = useState("47.011882");
  const [radiusValue, setRadiusValue] = useState("50");
  const [radiusUnit, setRadiusUnit] = useState<"m" | "km">("m");
  const [baseTemperature, setBaseTemperature] = useState(String(DEFAULT_BARLEY_DETECTION_CONFIG.baseTemperature));
  const [threshold, setThreshold] = useState(String(DEFAULT_BARLEY_DETECTION_CONFIG.threshold));
  const [periodDays, setPeriodDays] = useState("130");
  const [simpleConfidencePercent, setSimpleConfidencePercent] = useState("70");
  const [expanded, setExpanded] = useState(true);
  const [validationError, setValidationError] = useState("");
  const [isLocating, setIsLocating] = useState(false);
  const [locationError, setLocationError] = useState("");

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
    if (openSignal > 0) setExpanded(true);
  }, [openSignal]);

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
        const radiusNum = toRadiusKm(radiusValue, radiusUnit);
        onNavigate(latNum, lngNum, Number.isFinite(radiusNum) ? radiusNum : 10);
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const latNum = Number(lat);
    const lngNum = Number(lng);
    const radiusInput = Number(radiusValue);
    const radiusNum = radiusUnit === "m" ? radiusInput / 1000 : radiusInput;
    const config = {
      baseTemperature: Number(baseTemperature),
      threshold: Number(threshold),
      periodDays: Number(periodDays),
    };

    if (!Number.isFinite(latNum) || latNum < -90 || latNum > 90 || !Number.isFinite(lngNum) || lngNum < -180 || lngNum > 180) {
      setValidationError("Saisissez une latitude et une longitude valides.");
      return;
    }
    if (!Number.isFinite(radiusInput) || radiusInput <= 0 || !Number.isFinite(radiusNum) || radiusNum < 0.05 || radiusNum > 20) {
      setValidationError("Le rayon doit être compris entre 50 m et 20 km.");
      return;
    }
    if (!Number.isFinite(config.baseTemperature) || config.baseTemperature < -20 || config.baseTemperature > 30) {
      setValidationError("Tbase doit être compris entre -20 et 30 °C.");
      return;
    }
    if (!Number.isFinite(config.threshold) || config.threshold < DEFAULT_BARLEY_DETECTION_CONFIG.threshold || config.threshold > 10000) {
      setValidationError("Le seuil nécessaire doit être compris entre 2 000 et 10 000 °C.");
      return;
    }
    if (!Number.isInteger(config.periodDays) || config.periodDays < 1 || config.periodDays > 730) {
      setValidationError("La période doit être comprise entre 1 et 730 jours.");
      return;
    }

    setValidationError("");
    onNavigate(latNum, lngNum, radiusNum);
    await onSearch(latNum, lngNum, radiusNum, config);
  };

  const handleSimpleSearch = async () => {
    const latNum = Number(lat);
    const lngNum = Number(lng);
    const radiusInput = Number(radiusValue);
    const radiusNum = radiusUnit === "m" ? radiusInput / 1000 : radiusInput;

    if (!Number.isFinite(latNum) || latNum < -90 || latNum > 90 || !Number.isFinite(lngNum) || lngNum < -180 || lngNum > 180) {
      setValidationError("Saisissez une latitude et une longitude valides.");
      return;
    }
    if (!Number.isFinite(radiusInput) || radiusInput <= 0 || !Number.isFinite(radiusNum) || radiusNum < 0.05 || radiusNum > 20) {
      setValidationError("Le rayon doit être compris entre 50 m et 20 km.");
      return;
    }
    const confidencePercentNum = Number(simpleConfidencePercent);
    if (!Number.isFinite(confidencePercentNum) || confidencePercentNum < 50 || confidencePercentNum > 95) {
      setValidationError("Le seuil de confiance doit être compris entre 50 % et 95 %.");
      return;
    }
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
      setValidationError("Le seuil nécessaire doit être compris entre 2 000 et 10 000 °C.");
      return;
    }
    if (!Number.isInteger(gddConfig.periodDays) || gddConfig.periodDays < 1 || gddConfig.periodDays > 730) {
      setValidationError("La période doit être comprise entre 1 et 730 jours.");
      return;
    }

    setValidationError("");
    onNavigate(latNum, lngNum, radiusNum);
    await onSearchSimple(latNum, lngNum, radiusNum * 1000, confidencePercentNum / 100, gddConfig);
  };

  if (!expanded) {
    return null;
  }

  return (
    <div className="absolute top-4 right-4 bottom-24 sm:bottom-auto z-[800] w-[min(20rem,calc(100vw-2rem))] max-h-none overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 text-slate-900 shadow-xl sm:max-h-[calc(100vh-2rem)]">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Radar className="h-4 w-4 text-emerald-600" />
          <span className="text-sm font-semibold text-slate-800">Recherche automatique</span>
        </div>
        <button
          onClick={() => setExpanded(false)}
          aria-label="Fermer le formulaire"
          className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-800"
        >
          ✕
        </button>
      </div>
      <form onSubmit={handleSubmit} className="space-y-2">
        {locationError && <p className="text-xs text-red-600">{locationError}</p>}
        <Input
          type="number"
          step="any"
          placeholder="Latitude (ex. -18.8792)"
          value={lat}
          onChange={(e) => setLat(e.target.value)}
          className="h-9 border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400"
        />
        <Input
          type="number"
          step="any"
          placeholder="Longitude (ex. 47.5079)"
          value={lng}
          onChange={(e) => setLng(e.target.value)}
          className="h-9 border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400"
        />
        <label className="block text-xs text-slate-600">
          Rayon terrain réel
          <div className="mt-1 flex gap-1">
            <Input
              type="number"
              min={radiusUnit === "m" ? "50" : "0.05"}
              max={radiusUnit === "m" ? "20000" : "20"}
              step={radiusUnit === "m" ? "10" : "0.05"}
              value={radiusValue}
              onChange={(e) => setRadiusValue(e.target.value)}
              className="h-9 flex-1 border-slate-200 bg-white text-sm text-slate-900"
            />
            <select
              value={radiusUnit}
              onChange={(e) => setRadiusUnit(e.target.value as "m" | "km")}
              className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-900"
            >
              <option value="m">m</option>
              <option value="km">km</option>
            </select>
          </div>
          <span className="mt-1 block text-[11px] text-slate-500">Distance au sol, indépendante du zoom · 50 m à 20 km</span>
        </label>
        <div className="space-y-2 rounded-xl border border-emerald-100 bg-emerald-50/70 p-2.5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-800">
            <ThermometerSun className="h-3.5 w-3.5 text-emerald-600" />
            Paramètres degrés-jours
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px] text-slate-600">
              Tbase (°C)
              <Input type="number" min="-20" max="30" step="0.1" value={baseTemperature} onChange={(e) => setBaseTemperature(e.target.value)} className="mt-1 h-8 border-slate-200 bg-white text-xs text-slate-900" />
            </label>
            <label className="text-[11px] text-slate-600">
              Seuil nécessaire (°C)
              <Input type="number" min={DEFAULT_BARLEY_DETECTION_CONFIG.threshold} max="10000" step="1" value={threshold} onChange={(e) => setThreshold(e.target.value)} className="mt-1 h-8 border-slate-200 bg-white text-xs text-slate-900" />
            </label>
          </div>
          <label className="block text-[11px] text-slate-600">
            Période de culture (jours)
            <Input type="number" min="1" max="730" step="1" value={periodDays} onChange={(e) => setPeriodDays(e.target.value)} className="mt-1 h-8 border-slate-200 bg-white text-xs text-slate-900" />
          </label>
        </div>
        {validationError && <p className="text-xs text-red-600">{validationError}</p>}
        {searchError && <p className="text-xs text-red-600">{searchError}</p>}
        <Button type="submit" size="sm" className="w-full gap-2 bg-emerald-600 text-white hover:bg-emerald-700" disabled={isSearching}>
          {isSearching
            ? <span key="icon" className="w-3.5 h-3.5 rounded-full border-2 border-primary-foreground/40 border-t-primary-foreground animate-spin" />
            : <Navigation key="icon" className="w-4 h-4" />}
          <span key="label">{isSearching ? "Analyse HF + satellite..." : "Lancer l’analyse automatique"}</span>
        </Button>
      </form>
      {simpleSearchError && <p className="mt-2 text-xs text-destructive">{simpleSearchError}</p>}
      {simpleResult && (
        <div className="mt-3 rounded-lg border border-cyan-400/60 bg-cyan-400/10 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-foreground">Analyse Sentinel-2</p>
            <span className="text-xs font-mono text-muted-foreground">{(simpleResult.radiusM / 1000).toFixed(2)} km</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-center">
              <div className="rounded-md bg-white p-2">
              <p className="text-lg font-semibold text-foreground">{simpleResult.candidatesFound}</p>
              <p className="text-[10px] text-muted-foreground">candidats</p>
            </div>
            <div className="rounded-md bg-cyan-300/30 dark:bg-cyan-400/15 p-2">
              <p className="text-lg font-semibold text-cyan-700 dark:text-cyan-300">{simpleResult.features.length}</p>
              <p className="text-[10px] text-cyan-800 dark:text-cyan-400">orge détectée</p>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Image Sentinel-2 : {simpleResult.imageDate ?? "—"} ({simpleResult.imageAgeDays ?? "?"} j) · nuages {simpleResult.cloudPercentage ?? "?"}% · seuil de confiance {Math.round(simpleResult.confidenceThreshold * 100)}%
          </p>
          <p className="text-[11px] text-muted-foreground">
            Degrés-jours : {simpleResult.gddCumulative ?? "?"}/{simpleResult.gddThreshold} °C
            {simpleResult.gddCumulative != null && (simpleResult.gddCumulative >= simpleResult.gddThreshold
              ? " · présence confirmée"
              : " · présence probable (CNN seul)")}
          </p>
          {simpleResult.warnings.length > 0 && (
            <div className="rounded-md bg-amber-100/80 dark:bg-amber-500/15 px-2 py-1.5 space-y-0.5">
              {simpleResult.warnings.map((warning, index) => (
                <p key={index} className="text-[11px] text-amber-900 dark:text-amber-300">{warning}</p>
              ))}
            </div>
          )}
          <p className="text-[11px] text-cyan-800 dark:text-cyan-400">Cyan : parcelles déjà tracées (JECAM-VHR) classées par le modèle HF sur image Sentinel-2. Le fond de carte affiche l'image Sentinel-2 exacte utilisée, uniquement sur cette zone.</p>
        </div>
      )}
    </div>
  );
}

function toRadiusKm(value: string, unit: "m" | "km"): number {
  const numericValue = Number(value);
  return unit === "m" ? numericValue / 1000 : numericValue;
}
