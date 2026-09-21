import { useMemo, useState } from "react";
import { AreaChart, Area, Bar, ComposedChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { cn } from "@/lib/utils";
import { resolveCropName } from "@/lib/map-tooltip";
import { formatMonthLabel } from "@/lib/dates";
import type { TimeSeriesPointS2, TimeSeriesPointRain } from "@/hooks/useParcelles";

interface VegetationChartsPanelProps {
  timeSeriesS2: TimeSeriesPointS2[];
  timeSeriesRain: TimeSeriesPointRain[];
  cropLabel?: string | null;
  surfaceHa?: number | null;
  className?: string;
}

const TOOLTIP_STYLE = { backgroundColor: "#182420", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#e5e7eb", fontSize: 12 };
const GRID_STROKE = "rgba(255,255,255,0.08)";
const TICK_STYLE = { fontSize: 11, fill: "#94a3b8" };
const LEGEND_STYLE = { fontSize: 11, color: "#94a3b8" };

type RainRange = "3m" | "1y" | "3y" | "all";

const RAIN_RANGES: { key: RainRange; label: string; months: number | null }[] = [
  { key: "3m", label: "3 Mois", months: 3 },
  { key: "1y", label: "1 An", months: 12 },
  { key: "3y", label: "3 Ans", months: 36 },
  { key: "all", label: "Tout", months: null },
];

export default function VegetationChartsPanel({ timeSeriesS2, timeSeriesRain, cropLabel, surfaceHa, className }: VegetationChartsPanelProps) {
  const [rainRange, setRainRange] = useState<RainRange>("3m");

  const rainByDate = new Map(timeSeriesRain.map((p) => [p.date, p.precipitation_mm]));

  const vegetationData = timeSeriesS2.map((p) => ({
    label: formatMonthLabel(p.date),
    NDVI: p.ndvi,
  }));

  const combinedData = useMemo(() => {
    const points = timeSeriesS2.map((p) => ({
      label: formatMonthLabel(p.date),
      Pluie: rainByDate.get(p.date) ?? null,
      NDVI: p.ndvi,
    }));
    const months = RAIN_RANGES.find((r) => r.key === rainRange)?.months ?? null;
    return months == null ? points : points.slice(-months);
  }, [timeSeriesS2, rainByDate, rainRange]);

  return (
    <div className={cn("z-[800] flex gap-3 px-3 pb-3", className)}>
      <div className="analysis-popup flex-1 min-w-0 flex px-4 py-3 gap-4">
        <div className="w-28 shrink-0 flex flex-col gap-2">
          <h3 className="text-xs font-semibold text-foreground tracking-wide">VÉGÉTATION</h3>
          <div className="rounded-md bg-muted/50 px-2.5 py-2">
            <p className="text-[10px] text-muted-foreground">Culture</p>
            <p className="text-xs font-medium text-foreground truncate">{resolveCropName(cropLabel) || "—"}</p>
          </div>
          <div className="rounded-md bg-muted/50 px-2.5 py-2">
            <p className="text-[10px] text-muted-foreground">Superficie</p>
            <p className="text-xs font-medium text-foreground">{surfaceHa != null ? `${surfaceHa} ha` : "—"}</p>
          </div>
          <p className="text-[10px] text-muted-foreground mt-auto leading-tight">Sentinel-2 · moyenne mensuelle</p>
        </div>
        <div className="flex-1 min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={vegetationData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
              <XAxis dataKey="label" tick={TICK_STYLE} />
              <YAxis domain={[0, 100]} tick={TICK_STYLE} unit="%" />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [v != null ? `${v}%` : "—", "NDVI (Sentinel-2)"]} />
              <Area type="monotone" dataKey="NDVI" stroke="#10b981" fill="#10b981" fillOpacity={0.15} strokeWidth={2} connectNulls />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="analysis-popup flex-1 min-w-0 flex flex-col px-4 py-3">
        <div className="flex items-center justify-between mb-0.5 shrink-0 gap-2">
          <h3 className="text-xs font-semibold text-foreground tracking-wide">PLUIE (MM) &amp; NDVI</h3>
          <div className="flex items-center gap-0.5 shrink-0">
            {RAIN_RANGES.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => setRainRange(r.key)}
                className={cn(
                  "px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors",
                  rainRange === r.key
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted"
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground mb-1 shrink-0">Sources : Open-Meteo (pluie) · Sentinel-2 (NDVI)</p>
        <div className="flex-1 min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={combinedData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
              <XAxis dataKey="label" tick={TICK_STYLE} />
              <YAxis yAxisId="rain" tick={TICK_STYLE} unit="mm" />
              <YAxis yAxisId="ndvi" orientation="right" domain={[0, 100]} tick={TICK_STYLE} unit="%" />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Legend wrapperStyle={LEGEND_STYLE} />
              <Bar yAxisId="rain" dataKey="Pluie" fill="#3b82f6" radius={[3, 3, 0, 0]} name="Pluie (mm)" />
              <Line yAxisId="ndvi" type="monotone" dataKey="NDVI" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} connectNulls name="NDVI (Sentinel-2)" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
