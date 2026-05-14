import { useCallback } from "react";
import { ROUTES } from "../lib/routes";

export function useNavigation({
  navigate,
  nodeId,
}: {
  navigate: (to: string) => void;
  nodeId: string | null;
}) {
  const navigateToNode = useCallback(
    (id: string) => {
      navigate(`${ROUTES.ATLAS}?id=${id}`);
    },
    [navigate],
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

  return { navigateToNode, handleViewChange };
}
