import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import type { SimpleAnalysisResult } from "@/lib/barley-detect-simple";
import type { MicroParcelsResult } from "@/lib/micro-parcels";

// Cache module : survit au démontage de SatelliteMap (navigation SPA vers /dashboard et retour).
let cachedSimple: SimpleAnalysisResult | null = null;
let cachedMicro: MicroParcelsResult | null = null;

export function usePersistedAnalyses() {
  const [simpleResult, setSimpleRaw] = useState<SimpleAnalysisResult | null>(cachedSimple);
  const [microResult, setMicroRaw] = useState<MicroParcelsResult | null>(cachedMicro);

  const setSimpleResult: Dispatch<SetStateAction<SimpleAnalysisResult | null>> = useCallback(
    (action) => {
      setSimpleRaw((prev) => {
        const next =
          typeof action === "function"
            ? (action as (p: SimpleAnalysisResult | null) => SimpleAnalysisResult | null)(prev)
            : action;
        cachedSimple = next;
        return next;
      });
    },
    [],
  );

  const setMicroResult: Dispatch<SetStateAction<MicroParcelsResult | null>> = useCallback(
    (action) => {
      setMicroRaw((prev) => {
        const next =
          typeof action === "function"
            ? (action as (p: MicroParcelsResult | null) => MicroParcelsResult | null)(prev)
            : action;
        cachedMicro = next;
        return next;
      });
    },
    [],
  );

  return { simpleResult, setSimpleResult, microResult, setMicroResult };
}
