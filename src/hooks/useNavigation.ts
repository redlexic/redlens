import { useCallback, startTransition } from "react";
import type { ReportId } from "../types";

export function useNavigation({ navigate, clearSearch, nodeId }: {
  navigate: (to: string) => void;
  clearSearch: () => void;
  nodeId: string | null;
}) {
  const navigateToNode = useCallback((id: string) => {
    navigate(`/atlas?id=${id}`); clearSearch();
  }, [navigate, clearSearch]);

  const navigateToEntity = useCallback((id: string) => {
    clearSearch();
    startTransition(() => { navigate(`/constellations?id=${id}`); });
  }, [navigate, clearSearch]);

  const navigateToReport = useCallback((id: ReportId) => {
    clearSearch();
    startTransition(() => { navigate(`/reports/${id}`); });
  }, [navigate, clearSearch]);

  const handleViewChange = useCallback((v: "annotations" | "history") => {
    const params = new URLSearchParams();
    if (nodeId) params.set("id", nodeId);
    if (v === "history") params.set("view", "history");
    navigate(`/atlas?${params}`);
  }, [navigate, nodeId]);

  return { navigateToNode, navigateToEntity, navigateToReport, handleViewChange };
}
