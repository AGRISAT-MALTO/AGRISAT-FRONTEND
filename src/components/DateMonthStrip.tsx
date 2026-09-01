import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMonthLabelLong } from "@/lib/dates";

interface DateMonthStripProps {
  /** Libellés mensuels réels ("YYYY-MM") issus de time_series_s2, dans l'ordre chronologique. */
  months: string[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  className?: string;
}

export default function DateMonthStrip({ months, selectedIndex, onSelect, className }: DateMonthStripProps) {
  if (months.length === 0) return null;

  return (
    <div className={cn("z-[800] analysis-popup flex items-center gap-1 px-2 py-1.5", className)}>
      <button
        onClick={() => onSelect(Math.max(0, selectedIndex - 1))}
        disabled={selectedIndex <= 0}
        className="w-6 h-6 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-30 disabled:pointer-events-none shrink-0"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>

      <div className="flex-1 flex items-center gap-1 overflow-x-auto">
        {months.map((month, index) => (
          <button
            key={month}
            onClick={() => onSelect(index)}
            className={cn(
              "shrink-0 px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors",
              index === selectedIndex
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {formatMonthLabelLong(month)}
          </button>
        ))}
      </div>

      <button
        onClick={() => onSelect(Math.min(months.length - 1, selectedIndex + 1))}
        disabled={selectedIndex >= months.length - 1}
        className="w-6 h-6 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-30 disabled:pointer-events-none shrink-0"
      >
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}
