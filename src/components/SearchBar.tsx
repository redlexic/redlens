import { Link } from "./Link";
import { NavBar, type NavBarProps } from "./NavBar";
import { SCOPE_CONFIG, type SearchScope } from "../lib/routes";
import { detectMode } from "../hooks/useSearchInput";
import type { RefObject } from "react";

const BASE = import.meta.env.BASE_URL;

const MODE_LABEL: Record<string, string> = { broad: "broad", phrase: "phrase", strict: "strict", fuzzy: "fuzzy" };

interface Props extends NavBarProps {
  inputRef: RefObject<HTMLInputElement | null>;
  query: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClear: () => void;
  onCycleMode: () => void;
  ready: boolean;
  scope: SearchScope;
}

export function SearchBar({
  inputRef,
  query,
  onChange,
  onClear,
  onCycleMode,
  ready,
  activePage,
  scope,
}: Props) {
  const cfg = SCOPE_CONFIG[scope];
  const disabled = scope === "atlas" && !ready;
  const mode = detectMode(query);
  const placeholder = disabled ? "Loading index…" : cfg.placeholder;

  return (
    <header
      className="search-header shrink-0 px-4 pt-3 pb-2 border-b sticky top-0 z-20"
      style={{ background: "var(--bg)" }}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        <Link to="/" className="order-1 shrink-0" title="Home">
          <img
            src={`${BASE}icon-SMALL.png`}
            alt="Home"
            width="28"
            height="28"
            className="w-7 h-7 object-cover rounded-[30%]"
          />
        </Link>
        <NavBar activePage={activePage} />

        <div
          className={`search-input-wrap order-3 sm:order-2 w-full sm:w-auto sm:flex-1 sm:max-w-[616px] flex items-center rounded border min-w-0${disabled ? " opacity-40 cursor-wait" : ""}`}
          data-scope={scope}
        >
          <svg
            className="shrink-0 ml-3 w-4 h-4 pointer-events-none"
            style={{ color: "var(--gray)" }}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle cx={11} cy={11} r={8} />
            <path d="m21 21-4.35-4.35" />
          </svg>

          {scope !== "atlas" && (
            <span className="scope-chip ml-2 shrink-0" aria-hidden="true">
              {cfg.label}
            </span>
          )}

          <input
            ref={inputRef}
            type="search"
            aria-label={`Filter ${cfg.label}`}
            value={query}
            onChange={onChange}
            placeholder={placeholder}
            disabled={disabled}
            className="search-input flex-1 min-w-0 px-2 py-2 text-sm"
          />

          {scope === "atlas" && (
            <button
              type="button"
              onClick={onCycleMode}
              aria-label={`Search mode: ${mode}. Click to cycle.`}
              className="shrink-0 px-2 py-0.5 text-xs mono rounded"
              style={{ color: mode === "broad" ? "var(--gray)" : "var(--accent)" }}
            >
              MODE {MODE_LABEL[mode]}
            </button>
          )}

          {query ? (
            <button
              type="button"
              onClick={onClear}
              aria-label="Clear search"
              className="mr-2 shrink-0 w-5 h-5 flex items-center justify-center rounded text-lg leading-none"
              style={{ color: "var(--gray)" }}
            >
              ×
            </button>
          ) : null}
        </div>
      </div>
    </header>
  );
}
