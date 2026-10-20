"use client";

import { useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";

export type StoreInfoData = {
  name: string;
  description: string;
  address: { line: string; neighborhood: string | null; reference: string | null; city: string; mapsQuery: string };
  /** CNPJ já formatado; CPF de loja pessoa física nunca vem para cá. */
  cnpj: string | null;
  since: string;
  open: boolean;
  stateLabel: string;
  hours: { day: string; text: string; today: boolean }[];
  delivery: { offers: boolean; byNetwork: boolean; areas: { name: string; fee: string; time: string }[] };
  offersPickup: boolean;
  minOrder: string | null;
  payments: { pix: boolean; card: boolean; cash: boolean };
};

const TABS = [
  { key: "sobre", label: "Sobre" },
  { key: "horario", label: "Horário" },
  { key: "pagamento", label: "Pagamento" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

/**
 * "Ver mais" da loja: painel com Sobre, Horário e Pagamento. No celular sobe de
 * baixo; no computador abre na lateral. É um <dialog> nativo: Esc fecha e o foco
 * fica preso dentro dele enquanto está aberto.
 */
export function StoreInfo({ info }: { info: StoreInfoData }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<TabKey>("sobre");

  const openOn = (key: TabKey) => {
    setTab(key);
    dialog.current?.showModal();
  };
  const moveTab = (step: number) => {
    const index = (TABS.findIndex((item) => item.key === tab) + step + TABS.length) % TABS.length;
    setTab(TABS[index].key);
    document.getElementById(`aba-${TABS[index].key}`)?.focus();
  };

  const todayHours = info.hours.find((row) => row.today)?.text ?? "Fechada";
  const paymentNames = [info.payments.pix && "Pix", info.payments.card && "Cartão", info.payments.cash && "Dinheiro"].filter(Boolean).join(", ");
  const tiles: { key: TabKey; icon: IconName; title: string; text: string; main?: boolean }[] = [
    { key: "sobre", icon: "info", title: "Ver mais", text: "Endereço e entrega", main: true },
    { key: "horario", icon: "clock", title: "Horários", text: todayHours === "Fechada" ? "Hoje: fechada" : `Hoje ${todayHours}` },
    { key: "pagamento", icon: "card", title: "Pagamento", text: paymentNames || "A combinar" },
  ];

  return (
    <>
      <div className="grid grid-cols-3 gap-2" data-testid="store-info-tiles">
        {tiles.map((tile) => (
          <button key={tile.key} type="button" onClick={() => openOn(tile.key)}
            className={`group flex min-h-11 flex-col items-center gap-1.5 rounded-2xl px-2 py-3 text-center transition hover:-translate-y-0.5 hover:shadow-md ${
              tile.main ? "bg-brand-darker text-white shadow-sm" : "bg-peach text-coffee ring-1 ring-brand/20"
            }`}>
            <span className={`grid size-10 place-items-center rounded-full ${tile.main ? "bg-white/20 text-white" : "bg-white text-brand-dark"}`}>
              <Icon name={tile.icon} size={20} />
            </span>
            <span className="text-sm leading-tight font-bold">{tile.title}</span>
            <span className={`line-clamp-2 text-xs leading-tight ${tile.main ? "text-white" : "text-coffee-soft"}`}>{tile.text}</span>
          </button>
        ))}
      </div>

      <dialog
        ref={dialog}
        aria-labelledby="store-info-title"
        data-testid="store-info"
        onClick={(event) => { if (event.target === dialog.current) dialog.current.close(); }}
        className="fixed inset-x-0 top-auto bottom-0 m-0 flex max-h-[88dvh] w-full max-w-none flex-col rounded-t-3xl bg-cream p-0 text-coffee shadow-2xl backdrop:bg-coffee/50 not-open:hidden sm:inset-y-0 sm:right-0 sm:left-auto sm:h-dvh sm:max-h-none sm:max-w-md sm:rounded-tr-none sm:rounded-bl-3xl"
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-5">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-coffee-soft">Sobre a loja</p>
            <h2 id="store-info-title" className="truncate text-2xl">{info.name}</h2>
            <p className={`mt-1 inline-block rounded-full px-3 py-0.5 text-xs font-bold ${info.open ? "bg-success text-white" : "bg-coffee text-peach"}`}>
              {info.stateLabel}
            </p>
          </div>
          <button type="button" onClick={() => dialog.current?.close()} aria-label="Fechar"
            className="grid size-11 shrink-0 place-items-center rounded-full bg-white text-brand-dark ring-1 ring-peach hover:ring-brand">
            <Icon name="close" size={20} strokeWidth={2.5} />
          </button>
        </div>

        <div role="tablist" aria-label="Informações da loja" className="mt-4 flex border-b border-peach px-5"
          onKeyDown={(event) => {
            if (event.key === "ArrowRight") moveTab(1);
            if (event.key === "ArrowLeft") moveTab(-1);
          }}>
          {TABS.map((item) => {
            const selected = item.key === tab;
            return (
              <button key={item.key} id={`aba-${item.key}`} type="button" role="tab" aria-selected={selected} aria-controls={`painel-${item.key}`}
                tabIndex={selected ? 0 : -1} onClick={() => setTab(item.key)}
                className={`-mb-px min-h-11 flex-1 border-b-2 px-2 font-bold transition-colors ${selected ? "border-brand-dark text-brand-dark" : "border-transparent text-coffee-soft hover:text-coffee"}`}>
                {item.label}
              </button>
            );
          })}
        </div>

        <div id={`painel-${tab}`} role="tabpanel" aria-labelledby={`aba-${tab}`} tabIndex={0} className="flex-1 overflow-y-auto px-5 py-5">
          {tab === "sobre" && <About info={info} />}
          {tab === "horario" && <Hours info={info} />}
          {tab === "pagamento" && <Payment info={info} />}
          <p className="mt-6 border-t border-peach pt-4 text-center text-xs text-coffee-soft">
            O Chegô é gratuito para quem pede. Os preços do cardápio são definidos pela própria loja.
          </p>
        </div>
      </dialog>
    </>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-5 last:mb-0">
      <h3 className="mb-2 text-lg">{title}</h3>
      {children}
    </section>
  );
}

function About({ info }: { info: StoreInfoData }) {
  const [expanded, setExpanded] = useState(false);
  const long = info.description.length > 160;
  return (
    <>
      {info.description && (
        <Block title="Descrição">
          <p className={`text-coffee-soft ${long && !expanded ? "line-clamp-3" : ""}`}>{info.description}</p>
          {long && (
            <button type="button" onClick={() => setExpanded(!expanded)} className="mt-1 min-h-11 font-bold text-brand-dark hover:underline">
              {expanded ? "Ver menos" : "Ver mais"}
            </button>
          )}
        </Block>
      )}

      <Block title="Endereço">
        <div className="flex gap-3 rounded-2xl bg-white p-3 ring-1 ring-peach">
          <Icon name="pin" size={22} className="mt-0.5 shrink-0 text-brand-dark" />
          <div className="min-w-0 text-sm">
            <p className="font-semibold">{info.address.line}</p>
            {info.address.neighborhood && <p className="text-coffee-soft">{info.address.neighborhood}</p>}
            <p className="text-coffee-soft">{info.address.city}</p>
            {info.address.reference && <p className="mt-1 text-coffee-soft">Referência: {info.address.reference}</p>}
            <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(info.address.mapsQuery)}`} target="_blank" rel="noopener noreferrer"
              className="mt-1 inline-flex min-h-11 items-center font-bold text-brand-dark hover:underline">
              Ver no mapa
            </a>
          </div>
        </div>
      </Block>

      <Block title="Entrega e retirada">
        <ul className="flex flex-col gap-2 text-sm">
          {info.delivery.offers && (
            <Feature icon="bike">
              Entrega {info.delivery.byNetwork ? "pelos entregadores do Chegô" : "pela própria loja"}
            </Feature>
          )}
          {info.offersPickup && <Feature icon="store">Retirada no balcão, sem taxa de entrega</Feature>}
          {info.minOrder && <Feature icon="info">Pedido mínimo de {info.minOrder}</Feature>}
        </ul>
        {info.delivery.offers && info.delivery.areas.length > 0 && (
          <details className="mt-3 rounded-2xl bg-white ring-1 ring-peach">
            <summary className="flex min-h-11 cursor-pointer items-center px-3 font-semibold">Onde entrega ({info.delivery.areas.length} bairros)</summary>
            <ul className="px-3 pb-2 text-sm">
              {info.delivery.areas.map((area) => (
                <li key={area.name} className="flex justify-between gap-3 border-t border-cream py-1.5">
                  <span>{area.name}</span>
                  <span className="shrink-0 text-coffee-soft">{area.fee} · {area.time}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </Block>

      <Block title="Outras informações">
        <dl className="text-sm">
          {info.cnpj && <div className="flex justify-between gap-3 py-1"><dt className="text-coffee-soft">CNPJ</dt><dd className="tabular-nums">{info.cnpj}</dd></div>}
          <div className="flex justify-between gap-3 py-1"><dt className="text-coffee-soft">No Chegô desde</dt><dd>{info.since}</dd></div>
        </dl>
      </Block>
    </>
  );
}

function Hours({ info }: { info: StoreInfoData }) {
  return (
    <Block title="Horário de funcionamento">
      <ul className="overflow-hidden rounded-2xl bg-white ring-1 ring-peach">
        {info.hours.map((row) => (
          <li key={row.day} data-testid={row.today ? "hours-today" : undefined}
            className={`flex justify-between gap-3 border-b border-cream px-3 py-2.5 text-sm last:border-0 ${row.today ? "bg-peach font-bold" : ""}`}>
            <span className="capitalize">{row.day}{row.today && <span className="ml-2 text-xs font-bold text-brand-darker">hoje</span>}</span>
            <span className={`text-right ${row.text === "Fechada" ? "text-coffee-soft" : ""}`}>{row.text}</span>
          </li>
        ))}
      </ul>
    </Block>
  );
}

function Payment({ info }: { info: StoreInfoData }) {
  const methods: { key: keyof StoreInfoData["payments"]; icon: IconName; title: string; text: string }[] = [
    { key: "pix", icon: "pix", title: "Pix", text: "A chave Pix da loja aparece no pedido depois que ela aceitar." },
    { key: "card", icon: "card", title: "Cartão na entrega", text: "Crédito ou débito na maquininha da loja." },
    { key: "cash", icon: "cash", title: "Dinheiro", text: info.delivery.byNetwork ? "Na retirada no balcão." : "Na entrega ou na retirada. Avise se precisar de troco." },
  ];
  const accepted = methods.filter((method) => info.payments[method.key]);
  return (
    <>
      <Block title="Formas de pagamento">
        <p className="mb-3 text-sm text-coffee-soft">Você paga direto para a loja. O Chegô não cobra nada de quem pede.</p>
        {accepted.length === 0 ? (
          <p className="text-sm">A loja ainda não informou como recebe.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {accepted.map((method) => (
              <li key={method.key} data-testid="payment-method" className="flex items-start gap-3 rounded-2xl bg-white p-3 ring-1 ring-peach">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-peach text-brand-darker"><Icon name={method.icon} size={20} /></span>
                <span className="text-sm">
                  <strong className="block text-base">{method.title}</strong>
                  <span className="text-coffee-soft">{method.text}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Block>
      {info.minOrder && (
        <Block title="Pedido mínimo">
          <p className="text-sm">{info.minOrder}, sem contar a taxa de entrega.</p>
        </Block>
      )}
    </>
  );
}

function Feature({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <li className="flex items-center gap-2">
      <Icon name={icon} size={18} className="shrink-0 text-brand-dark" />
      <span>{children}</span>
    </li>
  );
}
