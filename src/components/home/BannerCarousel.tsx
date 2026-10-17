"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "@/components/ui/Icon";
import { WideImage } from "@/components/ui/WideImage";

export type CarouselBanner = { id: string; title: string; imageUrl: string; linkUrl: string | null };

const INTERVAL_MS = 4500;

/**
 * Banners da página inicial. Avançam sozinhos a cada 4,5 s e voltam ao começo no fim.
 *
 * A faixa é uma rolagem horizontal comum com encaixe (scroll-snap): deslizar com o dedo,
 * arrastar no touchpad e as setas do teclado funcionam como em qualquer página. Por cima
 * disso vêm o avanço automático, as setas e os indicadores.
 *
 * O avanço para enquanto a pessoa está com o mouse em cima, com o foco dentro, tocando
 * na faixa, depois de apertar "pausar", com a aba escondida ou com a faixa fora da tela.
 * Com "reduzir movimento" ligado no aparelho, nada anda sozinho.
 */
export function BannerCarousel({ banners }: { banners: CarouselBanner[] }) {
  const track = useRef<HTMLDivElement>(null);
  const region = useRef<HTMLElement>(null);
  /** Para onde o carrossel está rolando agora por conta própria (setas, indicadores, avanço). */
  const heading = useRef<number | null>(null);
  // Posições de rolagem em que a faixa para. Com banners largos é uma por banner; quando
  // vários cabem na tela (desktop), as últimas se juntam, e se todos cabem sobra uma só.
  const [stops, setStops] = useState<number[]>(() => banners.map((_, index) => index));
  const [current, setCurrent] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [touching, setTouching] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const [onScreen, setOnScreen] = useState(true);
  // Começa como "reduzir movimento" até o navegador dizer o contrário: o servidor e a
  // primeira pintura no navegador ficam iguais, e nada anda antes da hora.
  const [reducedMotion, setReducedMotion] = useState(true);

  const measure = useCallback(() => {
    const element = track.current;
    if (!element) return;
    const max = element.scrollWidth - element.clientWidth;
    const slides = Array.from(element.children) as HTMLElement[];
    const positions = slides.map((slide) => Math.min(Math.max(slide.offsetLeft - slides[0].offsetLeft, 0), max));
    const unique = positions.filter((value, index) => index === 0 || value - positions[index - 1] > 4);
    setStops(unique.length > 0 ? unique : [0]);
  }, []);

  useEffect(() => {
    const element = track.current;
    if (!element) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [measure]);

  // Qual posição está na tela, conforme a pessoa (ou o avanço automático) rola.
  useEffect(() => {
    const element = track.current;
    if (!element) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const left = element.scrollLeft;
        // Durante uma rolagem pedida pelo próprio carrossel, as posições do meio do caminho
        // não contam: senão um "anterior" ainda animando seria lido como o banner de antes.
        if (heading.current !== null) {
          if (Math.abs(stops[heading.current] - left) <= 2) heading.current = null;
          return;
        }
        let nearest = 0;
        stops.forEach((stop, index) => {
          if (Math.abs(stop - left) < Math.abs(stops[nearest] - left)) nearest = index;
        });
        setCurrent(nearest);
      });
    };
    // Rolagens animadas interrompidas podem parar no encaixe errado: no fim, confere.
    const onScrollEnd = () => {
      const target = heading.current;
      heading.current = null;
      if (target !== null && Math.abs(stops[target] - element.scrollLeft) > 2) element.scrollTo({ left: stops[target] });
    };
    // A pessoa assumiu a rolagem: vale o que ela fizer.
    const userTookOver = () => { heading.current = null; };
    element.addEventListener("scroll", onScroll, { passive: true });
    element.addEventListener("scrollend", onScrollEnd);
    element.addEventListener("touchstart", userTookOver, { passive: true });
    element.addEventListener("wheel", userTookOver, { passive: true });
    return () => {
      element.removeEventListener("scroll", onScroll);
      element.removeEventListener("scrollend", onScrollEnd);
      element.removeEventListener("touchstart", userTookOver);
      element.removeEventListener("wheel", userTookOver);
      cancelAnimationFrame(frame);
    };
  }, [stops]);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  // Não anda com a aba escondida nem com a faixa fora da tela.
  useEffect(() => {
    const element = region.current;
    if (!element) return;
    let inView = true;
    const update = () => setOnScreen(inView && document.visibilityState === "visible");
    const observer = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      update();
    });
    observer.observe(element);
    document.addEventListener("visibilitychange", update);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  const goTo = useCallback(
    (index: number) => {
      const element = track.current;
      if (!element || stops.length === 0) return;
      const target = (index + stops.length) % stops.length;
      heading.current = target;
      element.scrollTo({ left: stops[target], behavior: reducedMotion ? "auto" : "smooth" });
      setCurrent(target);
      // Navegadores sem o evento "scrollend": depois de um tempo, volta a ler a rolagem.
      window.setTimeout(() => {
        if (heading.current === target) heading.current = null;
      }, 1200);
    },
    [stops, reducedMotion],
  );

  const movable = stops.length > 1;
  const autoplay = movable && !reducedMotion;
  const running = autoplay && !userPaused && !hovered && !focused && !touching && onScreen;

  // Um único timer por vez: recomeça a cada troca de banner e some quando algo pausa.
  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(() => goTo(current + 1), INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [running, current, goTo]);

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      goTo(current + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      goTo(current - 1);
    }
  }

  if (banners.length === 0) return null;

  return (
    <section
      ref={region}
      aria-roledescription="carrossel"
      aria-label="Promoções"
      className="relative"
      // Só mouse de verdade: no celular um toque simula "mouse em cima" e nunca sai.
      onPointerEnter={(event) => { if (event.pointerType === "mouse") setHovered(true); }}
      onPointerLeave={(event) => { if (event.pointerType === "mouse") setHovered(false); }}
      // Só foco de teclado pausa: tocar num indicador não pode deixar a faixa parada.
      onFocus={(event) => setFocused(event.target.matches(":focus-visible"))}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
      onKeyDown={onKeyDown}
    >
      <div
        ref={track}
        // Enquanto anda sozinho, leitores de tela não anunciam cada troca; parado, anunciam.
        aria-live={running ? "off" : "polite"}
        className="scrollbar-none -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-4 px-4 sm:mx-0 sm:scroll-px-0 sm:px-0"
        onTouchStart={() => setTouching(true)}
        onTouchEnd={() => setTouching(false)}
        onTouchCancel={() => setTouching(false)}
      >
        {banners.map((banner, index) => {
          const image = (
            <WideImage
              url={banner.imageUrl}
              alt={banner.title}
              width={1200}
              height={500}
              priority={index === 0}
              className="aspect-[12/5] w-full rounded-card shadow-sm"
            />
          );
          return (
            <div
              key={banner.id}
              role="group"
              aria-roledescription="banner"
              aria-label={`${index + 1} de ${banners.length}`}
              className="w-[88%] shrink-0 snap-start sm:w-[calc((100%-0.75rem)/2)]"
            >
              {banner.linkUrl ? (
                <Link href={banner.linkUrl} className="block rounded-card">{image}</Link>
              ) : (
                image
              )}
            </div>
          );
        })}
      </div>

      {movable && (
        <>
          {/* Controles embaixo da faixa, nunca por cima do texto dos banners. */}
          <div className="mt-1 flex items-center justify-center gap-1">
            <button
              type="button"
              onClick={() => goTo(current - 1)}
              aria-label="Banner anterior"
              className="flex size-11 items-center justify-center rounded-full text-coffee transition hover:bg-peach"
            >
              <Icon name="chevronLeft" />
            </button>
            {stops.map((_, index) => (
              <button
                key={index}
                type="button"
                onClick={() => goTo(index)}
                aria-label={`Ir para o banner ${index + 1}`}
                aria-current={index === current ? "true" : undefined}
                className="flex size-11 items-center justify-center"
              >
                <span
                  aria-hidden="true"
                  className={`block h-2 rounded-full transition-all duration-300 ${index === current ? "w-6 bg-brand-dark" : "w-2 bg-coffee-soft/40"}`}
                />
              </button>
            ))}
            <button
              type="button"
              onClick={() => goTo(current + 1)}
              aria-label="Próximo banner"
              className="flex size-11 items-center justify-center rounded-full text-coffee transition hover:bg-peach"
            >
              <Icon name="chevronRight" />
            </button>
            {autoplay && (
              <button
                type="button"
                onClick={() => setUserPaused((paused) => !paused)}
                aria-label={userPaused ? "Continuar a passar os banners" : "Pausar os banners"}
                className="ml-1 flex size-11 items-center justify-center rounded-full text-coffee-soft transition hover:bg-peach hover:text-coffee"
              >
                <Icon name={userPaused ? "play" : "pause"} size={18} />
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
