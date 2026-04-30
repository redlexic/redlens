import { useCallback, startTransition } from "react";
import type { ReportId } from "../types";
import { ROUTES } from "../lib/routes";

export function useNavigation({
  navigate,
  clearSearch,
  nodeId,
}: {
  navigate: (to: string) => void;
  clearSearch: () => void;
  nodeId: string | null;
}) {
  const navigateToNode = useCallback(
    (id: string) => {
      navigate(`${ROUTES.ATLAS}?id=${id}`);
      clearSearch();
    },
    [navigate, clearSearch],
  );

  const navigateToEntity = useCallback(
    (id: string) => {
      clearSearch();
      startTransition(() => {
        navigate(`${ROUTES.CONSTELLATIONS}?id=${id}`);
      });
    },
    [navigate, clearSearch],
  );

  const navigateToReport = useCallback(
    (id: ReportId) => {
      clearSearch();
      startTransition(() => {
        navigate(`${ROUTES.REPORTS}/${id}`);
      });
    },
    [navigate, clearSearch],
  );

  const handleViewChange = useCallback(
    (v: "annotations" | "glossary" | "history") => {
      const params = new URLSearchParams();
      if (nodeId) params.set("id", nodeId);
      if (v !== "annotations") params.set("view", v);
      navigate(`/atlas?${params}`);
    },
    [navigate, nodeId],
  );

  return { navigateToNode, navigateToEntity, navigateToReport, handleViewChange };
}
