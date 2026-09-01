import { Crosshair } from "lucide-react";
import { cn } from "@/lib/utils";

interface VegetationLegendProps {
  percentage: number | null;
  className?: string;
}

const TICKS = [100, 75, 50, 25, 0];

const GRADIENT =
  "linear-gradient(to top, hsl(var(--vegetation-none)), hsl(var(--vegetation-low)), hsl(var(--vegetation-medium)), hsl(var(--vegetation-high)))";

export default function VegetationLegend({ percentage, className }: VegetationLegendProps) {
  const clamped = percentage != null ? Math.min(100, Math.max(0, percentage)) : null;

  return (
    <div className={cn("z-[800] analysis-popup px-3 py-3 flex flex-col items-center gap-2", className)}>
      <span className="flex items-center gap-1 text-[10px] font-semibold text-foreground tracking-wide">
        <Crosshair className="w-3 h-3 text-primary" />
        NDVI
      </span>
      <div className="flex items-stretch gap-2">
        <div className="flex flex-col justify-between h-36 text-[9px] text-muted-foreground">
          {TICKS.map((tick) => (
            <span key={tick}>{tick}%</span>
          ))}
        </div>
        <div className="relative w-3 h-36 rounded-full overflow-hidden" style={{ background: GRADIENT }}>
          {clamped != null && (
            <div
              className="absolute left-1/2 w-4 h-4 -translate-x-1/2 rounded-full border-2 border-white shadow-md bg-foreground"
              style={{ bottom: `calc(${clamped}% - 8px)` }}
              title={`NDVI actuel : ${clamped}%`}
            />
          )}
        </div>
      </div>
    </div>
  );
}
