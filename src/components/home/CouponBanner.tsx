"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { DISMISSED_COUPONS_COOKIE } from "@/lib/coupons/cookie";
import type { VisibleCoupon } from "@/lib/coupons/visible";

/**
 * Faixa fininha de cupons no topo do início: uma linha só, para não disputar espaço com
 * as lojas. Só cupons reais e válidos para o cliente (ver lib/coupons/visible.ts). Com
 * mais de um, setas para passar; o X esconde a faixa (lembrado num cookie, para a página
 * não "pular" na próxima visita).
 */
export function CouponBanner({ coupons }: { coupons: VisibleCoupon[] }) {
  const [index, setIndex] = useState(0);
  const [copied, setCopied] = useState(false);
  const [closed, setClosed] = useState(false);
  if (coupons.length === 0 || closed) return null;

  const coupon = coupons[index % coupons.length];
  const go = (step: number) => {
    setIndex((index + step + coupons.length) % coupons.length);
    setCopied(false);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(coupon.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Sem acesso à área de transferência: o código continua visível para copiar à mão.
    }
  };
  const close = () => {
    const ids = coupons.map((item) => item.id).join(".");
    document.cookie = `${DISMISSED_COUPONS_COOKIE}=${ids}; path=/; max-age=${60 * 60 * 24 * 7}; samesite=lax`;
    setClosed(true);
  };
  // Área de toque de 44px, mesmo com a faixa fininha.
  const round = "grid size-11 shrink-0 place-items-center rounded-full hover:bg-white/15";

  return (
    <section
      aria-label="Cupons"
      data-testid="coupon-banner"
      className="flex h-11 items-center gap-1 rounded-full bg-gradient-to-r from-brand-darker to-brand-dark pl-3 text-sm text-white shadow-sm"
    >
      <Icon name="ticket" size={18} className="hidden shrink-0 sm:block" />
      {coupons.length > 1 && (
        <button type="button" onClick={() => go(-1)} aria-label="Cupom anterior" className={`${round} hidden sm:grid`}>
          <Icon name="chevronLeft" size={16} strokeWidth={2.5} />
        </button>
      )}

      <p className="min-w-0 flex-1 truncate text-xs sm:text-sm" aria-live="polite" title={[coupon.benefit, ...coupon.conditions].join(" · ")}>
        <strong data-testid="coupon-code" className="mr-1.5 rounded bg-white px-1.5 py-0.5 font-mono text-xs font-bold tracking-wide text-brand-darker">{coupon.code}</strong>
        <strong>{coupon.benefit}</strong>
        {coupon.conditions.length > 0 && <span className="hidden md:inline" data-testid="coupon-conditions"> · {coupon.conditions.join(" · ")}</span>}
      </p>

      {coupons.length > 1 && (
        <>
          <span className="hidden shrink-0 text-xs tabular-nums sm:inline" data-testid="coupon-position">{(index % coupons.length) + 1}/{coupons.length}</span>
          <button type="button" onClick={() => go(1)} aria-label="Próximo cupom" className={round}>
            <Icon name="chevronRight" size={16} strokeWidth={2.5} />
          </button>
        </>
      )}
      <button type="button" onClick={copy} aria-label={copied ? "Copiado!" : `Copiar cupom ${coupon.code}`}
        className="group inline-flex h-11 shrink-0 items-center">
        <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-white px-3 text-xs font-bold text-brand-darker group-hover:bg-cream">
          <Icon name={copied ? "check" : "copy"} size={14} strokeWidth={2.5} />
          <span aria-live="polite">{copied ? "Copiado!" : "Copiar"}</span>
        </span>
      </button>
      <Link href={coupon.href} className="hidden h-8 shrink-0 items-center rounded-full px-3 text-xs font-bold ring-1 ring-white/70 hover:bg-white/15 sm:inline-flex">
        Ver ofertas
      </Link>
      <button type="button" onClick={close} aria-label="Fechar cupons" className={round}>
        <Icon name="close" size={14} strokeWidth={2.5} />
      </button>
    </section>
  );
}
