import { Wheat } from "lucide-react";
import { cn } from "@/lib/utils";
import { CROP_LEGEND } from "@/lib/crop-colors";

interface CropLegendProps {
  className?: string;
  onCollapse?: () => void;
}

/** Légende carte : une pastille couleur par famille de culture. */
export default function CropLegend({ className, onCollapse }: CropLegendProps) {
  return (
    <div className={cn("z-[800] analysis-popup px-3 py-2.5 flex flex-col gap-1.5 max-w-[240px]", className)}>
      <span className="flex items-center gap-1.5 text-[10px] font-semibold text-foreground tracking-wide">
        <Wheat className="w-3 h-3 text-primary" />
        CULTURES
        {onCollapse && (
          <button
            onClick={onCollapse}
            className="ml-auto w-5 h-5 flex items-center justify-center rounded-full bg-muted text-muted-foreground hover:text-foreground text-[10px]"
            title="Masquer la légende des cultures"
          >
            ✕
          </button>
        )}
      </span>
      <div className="flex flex-col gap-1">
        {CROP_LEGEND.map((entry) => (
          <span key={entry.label} className="flex items-center gap-2 text-[10px] text-muted-foreground leading-tight">
            <span
              className="w-2.5 h-2.5 rounded-sm shrink-0 border border-black/20"
              style={{ backgroundColor: entry.color }}
            />
            <span className="truncate">{entry.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
