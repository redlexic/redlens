import { useCallback, useMemo } from "react";
import { useSearchParams } from "wouter";

export interface UrlCodec<T> {
  // Return null to omit the param entirely (default value).
  encode: (v: T) => string | null;
  decode: (raw: string | null) => T;
}

export const urlString = (def: string | null = null): UrlCodec<string | null> => ({
  encode: (v) => (v === def || v === null || v === "" ? null : v),
  decode: (raw) => raw ?? def,
});

export const urlInt = (def: number): UrlCodec<number> => ({
  encode: (v) => (v === def ? null : String(v)),
  decode: (raw) => {
    if (raw === null) return def;
    const n = Number(raw);
    return Number.isFinite(n) ? n : def;
  },
});

export const urlBool = (def: boolean): UrlCodec<boolean> => ({
  encode: (v) => (v === def ? null : v ? "1" : "0"),
  decode: (raw) => (raw === null ? def : raw === "1"),
});

// Typed enum: stores one of `allowed` (or `def` as the "no param" state).
// Decoder returns `def` for missing/invalid values so the consumer never has
// to widen the literal back to string.
export const urlEnum = <T extends string>(def: T, allowed: readonly T[]): UrlCodec<T> => ({
  encode: (v) => (v === def ? null : v),
  decode: (raw) => (raw && (allowed as readonly string[]).includes(raw) ? (raw as T) : def),
});

export const urlStringSet = (def: ReadonlySet<string> = new Set()): UrlCodec<Set<string>> => {
  const defKey = [...def].sort().join(",");
  return {
    encode: (v) => {
      const key = [...v].sort().join(",");
      if (key === defKey) return null;
      return key === "" ? "" : key;
    },
    decode: (raw) => {
      if (raw === null) return new Set(def);
      return new Set(raw ? raw.split(",").filter(Boolean) : []);
    },
  };
};

// Reads/writes a single URL search param without disturbing the others.
// Default behavior: replace history entry (filter toggles shouldn't pollute back/forward).
// Pass { push: true } when the change is a true navigation.
export function useUrlState<T>(
  key: string,
  codec: UrlCodec<T>,
  opts: { push?: boolean } = {},
): readonly [T, (next: T | ((prev: T) => T)) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get(key);
  const value = useMemo(() => codec.decode(raw), [raw, codec]);

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setParams(
        (prev) => {
          const np = new URLSearchParams(prev);
          const current = codec.decode(np.get(key));
          const resolved = typeof next === "function" ? (next as (p: T) => T)(current) : next;
          const encoded = codec.encode(resolved);
          if (encoded === null) np.delete(key);
          else np.set(key, encoded);
          return np;
        },
        { replace: !opts.push },
      );
    },
    [key, codec, setParams, opts.push],
  );

  return [value, set] as const;
}
