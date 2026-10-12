import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { computeSurfaceHa } from "@/lib/geo";
import type { Parcelle, TimeSeriesPointS2, TimeSeriesPointS1, TimeSeriesPointRain } from "@/hooks/useParcelles";
import type { ZoningResult } from "@/lib/zoning";
import ZoningTabContent from "./ZoningTabContent";

type AnalysisStage = "loading" | "percentage" | "verdict" | "error";

export type CulturePanelTab = "vegetation" | "zoning";

export interface AnalysisResultData {
  percentage: number | null;
  is_barley: boolean;
  verdict: string;
  analysis_available?: boolean;
  details: string;
  culture_detected: string | null;
  confidence: number | null;
  cnn_prob_barley?: number;
  cnn_prob_non_barley?: number;
  cnn_available?: boolean;
  saison: string | null;
  soil_type: string | null;
  risk_factors: string[];
  recommendations: string | null;
  anomaly_level: string;
  data_source?: string;
  radar_analysis?: string | null;
  spectral_analysis?: string | null;
  time_series_s2?: TimeSeriesPointS2[];
  time_series_s1?: TimeSeriesPointS1[];
  time_series_rain?: TimeSeriesPointRain[];
  estimated_planting_date?: string | null;
  estimated_harvest_date?: string | null;
  days_since_planting?: number | null;
  growth_stage?: string | null;
  planting_confidence?: number;
  // New fields
  evi?: number | null;
  savi?: number | null;
  ndwi?: number | null;
  ndre?: number | null;
  spectral_bands?: Record<string, number | null> | null;
  agro_score?: number | null;
  agro_breakdown?: { ndvi_score: number; cycle_score: number; radar_score: number; ndvi_trend_score: number };
  agro_details?: string;
  hybrid_score?: number | null;
  warnings?: string[];
  boundary_source?: string;
}

interface ParcelCasePanelCommonProps {
  onClose: () => void;
  onResult?: (result: AnalysisResultData | null) => void;
  className?: string;
  activeTab: CulturePanelTab;
  onTabChange: (tab: CulturePanelTab) => void;
  zoningResult: ZoningResult | null;
  zoningLoading: boolean;
  zoningError: string;
}

/** Dessine + lance une nouvelle analyse (appelle /api/analyze-parcel puis sauvegarde). */
interface AnalyzeModeProps extends ParcelCasePanelCommonProps {
  mode: "analyze";
  polygon: Array<{ lat: number; lng: number }>;
  center: { lat: number; lng: number };
  zoom: number;
  onSave: (parcelle: Omit<Parcelle, "id" | "created_at">) => Promise<Parcelle | null>;
  ownerName: string;
  notes: string;
}

/** Réaffiche une parcelle déjà en base — aucun nouvel appel réseau, données déjà connues. */
interface ViewModeProps extends ParcelCasePanelCommonProps {
  mode: "view";
  parcelle: Parcelle;
}

type ParcelCasePanelProps = AnalyzeModeProps | ViewModeProps;

const ANALYSIS_URL = `${import.meta.env.VITE_API_URL ?? "http://localhost:3001"}/api/analyze-parcel`;

function resultFromParcelle(p: Parcelle): AnalysisResultData {
  const culture = p.culture_detected?.toLowerCase().trim() ?? "";
  const isBarley = culture.includes("orge") && !culture.includes("non");
  const analysisAvailable = Boolean(
    p.verdict?.trim()
    || culture
    || p.ndvi_percentage != null
    || p.confidence != null
    || p.hybrid_score != null
    || p.evi != null
    || p.savi != null
    || p.ndwi != null
    || p.ndre != null
    || p.time_series_s2.length > 0,
  );
  return {
    percentage: p.ndvi_percentage,
    is_barley: isBarley,
    analysis_available: analysisAvailable,
    verdict: p.verdict ?? "",
    details: p.details ?? "",
    culture_detected: p.culture_detected,
    confidence: p.confidence,
    cnn_prob_barley: p.cnn_prob_barley ?? undefined,
    cnn_prob_non_barley: p.cnn_prob_non_barley ?? undefined,
    cnn_available: p.cnn_prob_barley != null,
    saison: p.saison,
    soil_type: p.soil_type,
    risk_factors: p.risk_factors,
    recommendations: p.recommendations,
    anomaly_level: "",
    data_source: p.data_source ?? undefined,
    time_series_s2: p.time_series_s2,
    time_series_s1: p.time_series_s1,
    time_series_rain: p.time_series_rain,
    estimated_planting_date: p.estimated_planting_date,
    estimated_harvest_date: p.estimated_harvest_date,
    days_since_planting: p.days_since_planting,
    growth_stage: p.growth_stage,
    planting_confidence: p.planting_confidence ?? undefined,
    evi: p.evi,
    savi: p.savi,
    ndwi: p.ndwi,
    ndre: p.ndre,
    spectral_bands: p.spectral_bands,
    agro_score: p.agro_score,
    hybrid_score: p.hybrid_score,
  };
}

/** Le verdict (score hybride CNN+Agro, seuils orge confirmée/probable/incertain) fait foi en
 * priorité pour l'affichage "Culture" : is_barley/culture_detected reflètent le CNN seul et
 * peuvent contredire un verdict hybride qui a basculé grâce au score agro. */
function isBarleyFromVerdict(result: Pick<AnalysisResultData, "verdict" | "is_barley">): boolean {
  const v = result.verdict?.toUpperCase() ?? "";
  if (v.includes("NON-ORGE") || v.includes("NON ORGE")) return false;
  if (v.includes("ORGE")) return true;
  return result.is_barley;
}

function growthStageEmoji(stage: string | null | undefined): string {
  if (!stage) return "🌱";
  const s = stage.toLowerCase();
  if (s.includes("semis")) return "🌱";
  if (s.includes("levée")) return "🌿";
  if (s.includes("tallage")) return "🌾";
  if (s.includes("montaison")) return "📈";
  if (s.includes("épiaison")) return "🌾";
  if (s.includes("maturation")) return "🟡";
  if (s.includes("récolte")) return "✂️";
  return "🌱";
}

function scoreColor(score: number): string {
  if (score >= 70) return "text-emerald-400";
  if (score >= 40) return "text-amber-400";
  return "text-red-400";
}

/**
 * Les analyses faites avec le classifieur Sentinel-2 (backend, barley_s2_classifier) mettent la
 * probabilité d'orge dans hybrid_score ; les plus anciennes y ont 0,6 × CNN + 0,4 × Agro.
 */
function usesS2Classifier(result: AnalysisResultData): boolean {
  return result.data_source?.includes("Classifieur orge Sentinel-2") ?? false;
}

function InfoRow({ label, value, valueClassName }: { label: string; value: ReactNode; valueClassName?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-medium text-foreground text-right", valueClassName)}>{value}</span>
    </div>
  );
}

export default function ParcelCasePanel(props: ParcelCasePanelProps) {
  const { onClose, onResult, className, activeTab, onTabChange, zoningResult, zoningLoading, zoningError } = props;
  const polygon = props.mode === "analyze" ? props.polygon : props.parcelle.coordinates;
  const center = props.mode === "analyze" ? props.center : { lat: props.parcelle.center_lat, lng: props.parcelle.center_lng };
  const ownerName = props.mode === "analyze" ? props.ownerName : props.parcelle.owner_name;

  const [stage, setStage] = useState<AnalysisStage>(props.mode === "view" ? "verdict" : "loading");
  const [result, setResult] = useState<AnalysisResultData | null>(props.mode === "view" ? resultFromParcelle(props.parcelle) : null);
  const [displayPct, setDisplayPct] = useState<number | null>(props.mode === "view" ? props.parcelle.ndvi_percentage : null);
  const [errorMsg, setErrorMsg] = useState("");
  const [savedId, setSavedId] = useState<string | null>(props.mode === "view" ? props.parcelle.id : null);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  useEffect(() => {
    if (props.mode !== "analyze") return;
    const { polygon, center, zoom, ownerName, notes, onSave } = props;
    let cancelled = false;

    async function analyze() {
      try {
        const resp = await fetch(ANALYSIS_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lat: center.lat, lng: center.lng, zoom, polygon }),
        });

        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ error: "Erreur réseau" }));
          throw new Error(err.error || `Erreur ${resp.status}`);
        }

        const data: AnalysisResultData = await resp.json();
        if (cancelled) return;

        setResult(data);
        onResultRef.current?.(data);
        setStage("percentage");

        const surface = computeSurfaceHa(polygon);
        const saved = await onSave({
          label: ownerName || "",
          coordinates: polygon,
          center_lat: center.lat,
          center_lng: center.lng,
          surface_ha: Math.round(surface * 100) / 100,
          culture_declared: "Orge",
          culture_detected: data.culture_detected,
          ndvi_percentage: data.percentage,
          confidence: data.confidence,
          verdict: data.verdict,
          details: data.details,
          saison: data.saison,
          soil_type: data.soil_type,
          risk_factors: data.risk_factors,
          recommendations: data.recommendations,
          data_source: data.data_source ?? null,
          owner_name: ownerName || "",
          notes: notes || "",
          time_series_s2: data.time_series_s2 || [],
          time_series_s1: data.time_series_s1 || [],
          time_series_rain: data.time_series_rain || [],
          estimated_planting_date: data.estimated_planting_date || null,
          estimated_harvest_date: data.estimated_harvest_date || null,
          days_since_planting: data.days_since_planting ?? null,
          growth_stage: data.growth_stage || null,
          planting_confidence: data.planting_confidence ?? null,
          evi: data.evi ?? null,
          savi: data.savi ?? null,
          ndwi: data.ndwi ?? null,
          ndre: data.ndre ?? null,
          spectral_bands: data.spectral_bands ?? null,
          agro_score: data.agro_score ?? null,
          hybrid_score: data.hybrid_score ?? null,
          cnn_prob_barley: data.cnn_prob_barley ?? null,
          cnn_prob_non_barley: data.cnn_prob_non_barley ?? null,
        });
        if (!cancelled && saved) setSavedId(saved.id);

        setTimeout(() => {
          if (!cancelled) setStage("verdict");
        }, 1800);
      } catch (e) {
        if (cancelled) return;
        setErrorMsg(e instanceof Error ? e.message : "Erreur inconnue");
        setStage("error");
      }
    }

    analyze();
    return () => {
      cancelled = true;
      onResultRef.current?.(null);
    };
    // Ce panneau est démonté/remonté à chaque nouvelle parcelle dessinée (voir SatelliteMap :
    // `{drawnParcel && <ParcelCasePanel .../>}`), donc une seule analyse par montage suffit —
    // pas besoin de relancer l'effet si le composant venait à re-render avec les mêmes props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (props.mode === "view") onResultRef.current?.(resultFromParcelle(props.parcelle));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.mode === "view" ? props.parcelle.id : null]);

  useEffect(() => {
    if (stage === "percentage" && result) {
      let current = 0;
      const target = result.percentage;
      if (target == null) {
        setDisplayPct(null);
        return;
      }
      const step = Math.max(1, Math.floor(target / 30));
      const interval = setInterval(() => {
        current = Math.min(current + step, target);
        setDisplayPct(current);
        if (current >= target) clearInterval(interval);
      }, 40);
      return () => clearInterval(interval);
    }
  }, [stage, result]);

  const barColor = (pct: number) =>
    pct >= 70 ? "bg-vegetation-high" : pct >= 40 ? "bg-vegetation-medium" : pct >= 20 ? "bg-vegetation-low" : "bg-vegetation-none";

  const surfaceHa = props.mode === "view" && props.parcelle.surface_ha != null
    ? props.parcelle.surface_ha
    : Math.round(computeSurfaceHa(polygon) * 100) / 100;
  const headerDate = props.mode === "view" ? new Date(props.parcelle.created_at) : new Date();

  return (
    <motion.div
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 24 }}
      transition={{ type: "spring", damping: 28, stiffness: 320 }}
      className={cn("analysis-popup flex flex-col overflow-hidden", className)}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 pt-3 pb-2.5 border-b border-border shrink-0">
        <button
          onClick={onClose}
          className="w-6 h-6 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
          title="Fermer la fiche"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">
            {result?.analysis_available === false
              ? "Parcelle enregistrée"
              : result
                ? `Culture : ${isBarleyFromVerdict(result) ? "Orge" : "Non-orge"}`
                : "Analyse de parcelle"}
          </p>
          <p className="text-xs text-muted-foreground mono mt-0.5">
            {surfaceHa} ha · {polygon.length} pts · {headerDate.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })}
          </p>
        </div>
      </div>

      {/* Nav : bascule entre la vue "Végétation Index" (Végétation + Pluie + Culture orge)
          et "Proche en zone" (zoning VRA, pixel par pixel, superposé sur la carte). */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-border shrink-0">
        <button
          type="button"
          onClick={() => onTabChange("vegetation")}
          className={cn(
            "flex-1 px-2 py-1.5 rounded-md text-[11px] font-medium transition-colors",
            activeTab === "vegetation" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
          )}
        >
          Végétation Index
        </button>
        <button
          type="button"
          onClick={() => onTabChange("zoning")}
          className={cn(
            "flex-1 px-2 py-1.5 rounded-md text-[11px] font-medium transition-colors",
            activeTab === "zoning" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
          )}
        >
          Proche en zone
        </button>
      </div>

      {activeTab === "zoning" ? (
        <div className="flex-1 overflow-y-auto px-3 pt-4 pb-3.5">
          <ZoningTabContent
            loading={zoningLoading}
            error={zoningError}
            result={zoningResult}
            parcelLabel={savedId ? savedId.slice(0, 8) : "en cours…"}
            ownerName={ownerName}
            surfaceHa={surfaceHa}
            center={center}
            cultureDetected={result?.culture_detected ?? null}
          />
        </div>
      ) : (
      <div className="flex-1 overflow-y-auto px-3 py-2.5 space-y-2.5">
        <div className="grid grid-cols-2 gap-1.5 text-xs">
          <div className="rounded-md bg-muted/50 px-2 py-1.5">
            <p className="text-[10px] text-muted-foreground">Agriculteur</p>
            <p className="text-foreground font-medium truncate">{ownerName || "—"}</p>
          </div>
          <div className="rounded-md bg-muted/50 px-2 py-1.5">
            <p className="text-[10px] text-muted-foreground">ID parcelle</p>
            <p className="text-foreground font-medium mono truncate">{savedId ? savedId.slice(0, 8) : "en cours…"}</p>
          </div>
        </div>

        {result?.percentage != null && (
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground">Indice affiché :</span>
            <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-primary text-primary-foreground">NDVI (Sentinel-2)</span>
          </div>
        )}

        <div className="text-xs text-muted-foreground mono">
          {center.lat.toFixed(5)}, {center.lng.toFixed(5)}
        </div>
        {result?.boundary_source && (
          <p className="text-xs text-muted-foreground leading-relaxed">{result.boundary_source}</p>
        )}

        {result?.warnings && result.warnings.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-amber-500">Analyse partielle</p>
            <ul className="space-y-0.5 text-xs text-muted-foreground leading-relaxed list-disc list-inside">
              {result.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        <AnimatePresence mode="wait">
          {stage === "loading" && (
            <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-2.5 py-5">
              <div className="relative w-10 h-10">
                <div className="absolute inset-0 rounded-full border-2 border-muted" />
                <div className="absolute inset-0 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              </div>
              <span className="text-sm text-muted-foreground">Analyse satellite de la parcelle...</span>
              <span className="text-xs text-muted-foreground">Sentinel-2 + Sentinel-1 + Pluie</span>
            </motion.div>
          )}

          {stage === "error" && (
            <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center gap-2 py-5">
              <span className="text-destructive text-sm font-medium">Erreur d'analyse</span>
              <span className="text-xs text-muted-foreground text-center">{errorMsg}</span>
            </motion.div>
          )}

          {stage === "percentage" && result && (
            <motion.div key="percentage" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="flex flex-col items-center gap-2.5 py-3">
              <span className="text-3xl font-bold text-primary mono">{displayPct != null ? `${displayPct}%` : "—"}</span>
              {result.percentage != null && (
                <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
                  <motion.div className={`h-full rounded-full ${barColor(result.percentage)}`} initial={{ width: 0 }} animate={{ width: `${result.percentage}%` }} transition={{ duration: 1, ease: "easeOut" }} />
                </div>
              )}
              <span className="text-xs text-muted-foreground">
                NDVI · {usesS2Classifier(result) ? "Probabilité d'orge" : "Score hybride"} : {result.hybrid_score ?? "—"}%
              </span>
            </motion.div>
          )}

          {stage === "verdict" && result && (
            <motion.div key="verdict" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-3">
              {result.analysis_available === false ? (
                <div className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
                  Parcelle enregistrée. Aucune analyse de culture n’a été effectuée.
                  {savedId && <p className="mt-2 text-accent font-medium">Sauvegardé en base de données</p>}
                </div>
              ) : (
                <>
              {/* NDVI + Hybrid Score */}
              <div className="flex items-center gap-4">
                <div>
                  <span className="text-xl font-bold text-primary mono">{result.percentage != null ? `${result.percentage}%` : "—"}</span>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">NDVI</p>
                </div>
                {result.hybrid_score != null && (
                  <div>
                    <span className={cn("text-xl font-bold mono", scoreColor(result.hybrid_score))}>{result.hybrid_score}%</span>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">
                      {usesS2Classifier(result) ? "Orge (S2)" : "Hybride"}
                    </p>
                  </div>
                )}
                {result.percentage != null && (
                  <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className={cn("h-full rounded-full", barColor(result.percentage))} style={{ width: `${result.percentage}%` }} />
                  </div>
                )}
              </div>

              {/* Verdict */}
              {(() => {
                const verdictUpper = result.verdict.toUpperCase();
                const isBarley = isBarleyFromVerdict(result);
                const isUncertain =
                  !isBarley ||
                  verdictUpper.includes("INCERTAIN") ||
                  verdictUpper.includes("IND\u00C9TERMIN") ||
                  verdictUpper.includes("INDETERMIN");
                const withoutIcon = result.verdict.replace(/^\p{Extended_Pictographic}\uFE0F?\s*/u, "");
                const label = isUncertain ? withoutIcon.replace(/\s*\([^)]*\)\s*$/u, "") : withoutIcon;

                if (!isUncertain) {
                  return (
                    <motion.span initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.15 }}
                      className="self-start px-2.5 py-0.5 rounded-full text-xs font-semibold bg-vegetation-high/15 text-vegetation-high animate-glow-pulse-green">
                      {label}
                    </motion.span>
                  );
                }

                return (
                  <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.15 }}
                    className="relative isolate self-start overflow-hidden rounded-full p-[1.5px]">
                    <div
                      className={cn(
                        "absolute inset-[-60%] animate-[spin_3s_linear_infinite]",
                        isBarley ? "text-amber-500" : "text-destructive",
                      )}
                      style={{ background: "conic-gradient(from 0deg, transparent, currentColor, transparent 30%)" }}
                    />
                    <span className={cn(
                      "relative z-10 block px-2.5 py-0.5 rounded-full text-xs font-semibold",
                      isBarley ? "bg-amber-500/15 text-amber-600" : "bg-destructive/15 text-destructive",
                    )}>
                      {label}
                    </span>
                  </motion.div>
                );
              })()}

              {/* Score Breakdown */}
              {result.agro_breakdown && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}
                  className="space-y-1.5 pt-2.5 border-t border-border/60">
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                    {usesS2Classifier(result) ? "Scores indicatifs (hors verdict)" : "Décomposition du score"}
                  </p>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    <InfoRow label="CNN" value={`${result.cnn_prob_barley?.toFixed(1) ?? "—"}%`} />
                    <InfoRow label="Agro" value={`${result.agro_score ?? "—"}%`} />
                    <InfoRow label="NDVI" value={`${result.agro_breakdown.ndvi_score}%`} />
                    <InfoRow label="Cycle" value={`${result.agro_breakdown.cycle_score}%`} />
                    <InfoRow label="Radar" value={`${result.agro_breakdown.radar_score}%`} />
                    <InfoRow label="Tendance" value={`${result.agro_breakdown.ndvi_trend_score}%`} />
                  </div>
                  <p className="text-[10px] text-muted-foreground italic">
                    {usesS2Classifier(result)
                      ? "Verdict donné par le NDVI Sentinel-2 calibré sur le terrain ; CNN et Agro ne départageaient pas l'orge."
                      : "= 0.6×CNN + 0.4×Agro"}
                  </p>
                </motion.div>
              )}

              {/* Planting Detection Info */}
              {result.estimated_planting_date && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}
                  className="pt-2.5 border-t border-border/60 space-y-1">
                  <p className="text-sm font-medium text-foreground">
                    {growthStageEmoji(result.growth_stage)} {result.growth_stage}
                    {result.days_since_planting != null ? ` · Planté il y a ${result.days_since_planting} j` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Semis estimé : {new Date(result.estimated_planting_date).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
                    {result.planting_confidence ? ` (confiance ${result.planting_confidence}%)` : ""}
                  </p>
                  {result.estimated_harvest_date && (
                    <p className="text-xs text-muted-foreground">
                      Récolte estimée : {new Date(result.estimated_harvest_date).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
                    </p>
                  )}
                </motion.div>
              )}

              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}
                className="pt-2.5 border-t border-border/60 space-y-1.5 text-xs">
                <InfoRow
                  label="Culture"
                  value={isBarleyFromVerdict(result) ? "Orge" : "Non-orge"}
                  valueClassName={isBarleyFromVerdict(result) ? "text-vegetation-high" : "text-destructive"}
                />

                <InfoRow label="Saison" value={result.saison} />
                <InfoRow label="Confiance" value={`${result.confidence}%`} />
                {result.soil_type && result.soil_type !== "Non déterminé" && (
                  <InfoRow label="Sol" value={result.soil_type} />
                )}
                {result.radar_analysis && <InfoRow label="Radar" value={result.radar_analysis} />}
                {result.spectral_analysis && <InfoRow label="Spectral" value={result.spectral_analysis} />}
                {savedId && (
                  <p className="text-accent font-medium pt-1">Sauvegardé en base de données</p>
                )}
              </motion.div>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      )}
    </motion.div>
  );
}
