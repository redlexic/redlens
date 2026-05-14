import { useCallback } from "react";
import { ROUTES } from "../lib/routes";

// Read ?split= from the live URL at click time. The comparison pane param has
// to ride along on every atlas-internal navigation so the split stays open as
// the user moves between docs.
function currentSplit(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("split");
}

export function useNavigation({
  navigate,
  nodeId,
}: {
  navigate: (to: string) => void;
  nodeId: string | null;
}) {
  const navigateToNode = useCallback(
    (id: string) => {
      const params = new URLSearchParams();
      params.set("id", id);
      const split = currentSplit();
      if (split) params.set("split", split);
      navigate(`${ROUTES.ATLAS}?${params}`);
    },
    [navigate],
  );

  const handleViewChange = useCallback(
    (v: "annotations" | "glossary" | "history") => {
      const params = new URLSearchParams();
      if (nodeId) params.set("id", nodeId);
      if (v !== "annotations") params.set("view", v);
      const split = currentSplit();
      if (split) params.set("split", split);
      navigate(`${ROUTES.ATLAS}?${params}`);
    },
    [navigate, nodeId],
  );

  return { navigateToNode, handleViewChange };
}
