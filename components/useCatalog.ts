"use client";

import { useMemo } from "react";

import { useHub } from "@/components/HubStore";
import { resolveCatalog, type Catalog } from "@/lib/catalog";

/**
 * The proposal price sheet as the team has it: spreadsheet defaults with every
 * Settings edit applied. Recomputed only when an edit lands.
 */
export function useCatalog(): Catalog {
  const { ws } = useHub();
  return useMemo(() => resolveCatalog(ws.catalog), [ws.catalog]);
}
