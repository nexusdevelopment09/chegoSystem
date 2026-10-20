"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icon";

type Props = {
  /** Nome acessível da faixa (ex.: "Mais pedidos"). */
  label: string;
  children: ReactNode;
  /** Classes da lista (gap, alinhamento). */
  listClassName?: string;
  /** Setas menores e mais coladas, para faixas de chips. */
  compact?: boolean;
  /** No celular, deixa os itens irem até a borda da tela (a faixa ocupa a largura toda). */
  bleed?: boolean;
};

/**
 * Faixa horizontal com setas: a direita avança, a esquerda volta, e cada uma some do
 * lado em que não há mais nada. Também rola com o dedo, o trackpad e o teclado (a
 * faixa recebe foco e as setas do teclado rolam). Nunca anda sozinha. Os itens podem
 * sangrar até a borda da tela no celular sem criar rolagem lateral na página.
 */
export function HScroller({ label, children, listClassName = "gap-3", compact = false, bleed = true }: Props) {
  const list = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });

  const measure = useCallback(() => {
    const element = list.current;
    if (!element) return;
    const max = element.scrollWidth - element.clientWidth;
    setEdges({ start: element.scrollLeft <= 2, end: element.scrollLeft >= max - 2 });
  }, []);

  useEffect(() => {
    const element = list.current;
    if (!element) return;
    // O item escolhido (filtro ativo) começa à vista, mesmo que esteja no fim da faixa.
    const active = element.querySelector<HTMLElement>('[aria-current="true"], [aria-current="page"]');
    if (active) {
      const box = element.getBoundingClientRect();
      const item = active.getBoundingClientRect();
      if (item.left < box.left || item.right > box.right) {
        element.scrollLeft += item.left - box.left - (box.width - item.width) / 2;
      }
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    element.addEventListener("scroll", measure, { passive: true });
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", measure);
    };
  }, [measure]);

  const move = (direction: 1 | -1) => {
    const element = list.current;
    if (!element) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    element.scrollBy({ left: direction * Math.max(element.clientWidth * 0.85, 160), behavior: reduce ? "auto" : "smooth" });
  };

  const arrow = (direction: 1 | -1) => {
    const hidden = direction === 1 ? edges.end : edges.start;
    return (
      <button
        type="button"
        onClick={() => move(direction)}
        aria-label={direction === 1 ? `Avançar: ${label}` : `Voltar: ${label}`}
        disabled={hidden}
        tabIndex={hidden ? -1 : 0}
        className={`absolute top-1/2 z-10 hidden -translate-y-1/2 place-items-center rounded-full bg-white text-brand-dark shadow-md ring-1 ring-peach transition-opacity hover:ring-brand disabled:pointer-events-none disabled:opacity-0 sm:grid ${
          compact ? "size-9" : "size-10"
        } ${direction === 1 ? "right-0 translate-x-1/3" : "left-0 -translate-x-1/3"}`}
      >
        <Icon name={direction === 1 ? "chevronRight" : "chevronLeft"} size={compact ? 18 : 20} strokeWidth={2.5} />
      </button>
    );
  };

  return (
    <div className="relative">
      {arrow(-1)}
      <ul
        ref={list}
        tabIndex={0}
        aria-label={label}
        className={`scrollbar-none flex snap-x snap-mandatory overflow-x-auto py-1 ${bleed ? "-mx-4 scroll-px-4 px-4 sm:mx-0 sm:scroll-px-0 sm:px-0" : ""} ${listClassName}`}
      >
        {children}
      </ul>
      {/* Sombra nas pontas: avisa que há mais itens fora da área visível. */}
      <span aria-hidden="true" className={`pointer-events-none absolute inset-y-0 left-0 hidden w-8 bg-gradient-to-r from-cream to-transparent transition-opacity sm:block ${edges.start ? "opacity-0" : "opacity-100"}`} />
      <span aria-hidden="true" className={`pointer-events-none absolute inset-y-0 right-0 hidden w-8 bg-gradient-to-l from-cream to-transparent transition-opacity sm:block ${edges.end ? "opacity-0" : "opacity-100"}`} />
      {arrow(1)}
    </div>
  );
}
