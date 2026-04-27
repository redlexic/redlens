import { useState, useEffect, useRef } from "react";

/** Load any module-level cached promise (loadGraph, loadAtlas, loadDocs, etc.)
 *  and return the resolved value, or null while loading. */
export function useLoaded<T>(loader: () => Promise<T>): T | null {
  const [data, setData] = useState<T | null>(null);
  const ref = useRef(loader);
  useEffect(() => {
    ref.current().then(setData);
  }, []);
  return data;
}
