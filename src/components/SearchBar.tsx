import { Link } from "wouter";
import { NavBar, type NavBarProps } from "./NavBar";
import type { RefObject } from "react";

const BASE = import.meta.env.BASE_URL;

export interface Props extends NavBarProps {
  inputRef: RefObject<HTMLInputElement | null>;
  query: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  ready: boolean;
  isSearching: boolean;
}

export function SearchBar({
  inputRef,
  query,
  onChange,
  ready,
  isSearching,
  onNavPage,
  activePage,
}: Props) {
  return (
    <header className="search-header shrink-0 px-4 pt-3 pb-2 border-b">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        {/* Home icon — row 1 left on mobile, row 1 left on desktop */}
        <Link to="/" className="order-1 shrink-0" title="Home">
          <img
            src={`${BASE}icon-SMALL.png`}
            alt="Home"
            width="28"
            height="28"
            className="w-7 h-7 object-cover rounded-[30%]"
          />
        </Link>
        <NavBar activePage={activePage} onNavPage={onNavPage} />

        {/* Search — row 2 full-width on mobile, row 1 between home and nav on desktop */}
        <div className="order-3 sm:order-2 w-full sm:w-auto sm:flex-1 sm:max-w-[760px] relative min-w-0">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none text-gray"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle cx={11} cy={11} r={8} />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            ref={inputRef}
            type="search"
            aria-label="Search the Atlas"
            value={query}
            onChange={onChange}
            placeholder={
              ready ? "Search the Atlas or type /hints for query help" : "Loading index…"
            }
            disabled={!ready}
            className="search-input w-full pl-9 pr-4 py-2 text-sm rounded border disabled:opacity-40 disabled:cursor-wait"
          />
          {isSearching && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs animate-pulse mono text-gray">
              searching…
            </span>
          )}
        </div>
      </div>
    </header>
  );
}
