"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const RECENT_KEY = "chego_recent_searches";

function readRecent(): string[] {
  try {
    return JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

/** Search field with suggestions while typing and the latest searches. */
export function SearchBox({ initial = "" }: { initial?: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [focused, setFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const request = useRef(0);

  useEffect(() => {
    const term = value.trim();
    if (term.length < 2) return;
    const current = ++request.current;
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/busca/sugestoes?q=${encodeURIComponent(term)}`);
        const data = (await response.json()) as { suggestions: string[] };
        if (current === request.current) setSuggestions(data.suggestions);
      } catch {
        // No connection: just no suggestions.
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [value]);

  function search(term: string) {
    const clean = term.trim();
    if (!clean) return;
    const next = [clean, ...readRecent().filter((item) => item !== clean)].slice(0, 5);
    try {
      window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      // Ignore: recent searches are a convenience.
    }
    setFocused(false);
    router.push(`/busca?q=${encodeURIComponent(clean)}`);
  }

  const typing = value.trim().length >= 2;
  const list = typing ? suggestions : recent;

  return (
    <form
      role="search"
      className="relative"
      onSubmit={(event) => {
        event.preventDefault();
        search(value);
      }}
    >
      <input
        type="search"
        name="q"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onFocus={() => {
          setRecent(readRecent());
          setFocused(true);
        }}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        placeholder="Buscar loja ou produto"
        aria-label="Buscar loja ou produto"
        autoComplete="off"
        maxLength={60}
        className="min-h-12 w-full rounded-full border-2 border-peach bg-white px-5 text-base focus:border-brand-dark focus:outline-none"
      />
      {focused && list.length > 0 && (
        <ul className="absolute inset-x-0 top-14 z-10 overflow-hidden rounded-card bg-white shadow-lg ring-1 ring-peach">
          {!typing && <li className="px-5 pt-3 text-xs font-bold uppercase text-coffee-soft">Buscas recentes</li>}
          {list.map((item) => (
            <li key={item}>
              <button type="button" className="flex min-h-11 w-full items-center px-5 text-left hover:bg-cream" onMouseDown={() => search(item)}>
                {item}
              </button>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
