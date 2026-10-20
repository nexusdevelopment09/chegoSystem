"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/ui/Icon";
import { deviceId, getState, isLinkedHere, print, reconnect, subscribe } from "@/lib/printing/bridge";

export type StationPrinter = { id: string; name: string; deviceId: string | null; autoPrint: boolean };

const POLL_MS = 8_000;
const noop = () => () => {};
/** Pede para a estação olhar a fila agora (depois de "Imprimir" ou "Teste"). */
export const printNow = () => window.dispatchEvent(new Event("chego:print-now"));

function bytesOf(base64: string): Uint8Array {
  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function finish(jobId: string, ok: boolean, error?: string) {
  await fetch("/api/impressao", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "finish", jobId, ok, error: error?.slice(0, 300) }),
  }).catch(() => {});
}

/**
 * Estação de impressão: roda no painel da loja do celular onde a impressora foi conectada.
 * Reconecta sozinha, olha a fila de tempos em tempos (e na hora, quando alguém toca em
 * Imprimir), imprime e conta o resultado. Com impressão automática, mantém a tela acesa:
 * o Android pausa abas em segundo plano, então a impressão automática só acontece com o
 * Chegô aberto na tela deste celular.
 */
export function PrintStation({ printers }: { printers: StationPrinter[] }) {
  const device = useSyncExternalStore(noop, deviceId, () => null);
  useSyncExternalStore(subscribe, () => JSON.stringify(printers.map((printer) => getState(printer.id))), () => "");
  const mine = device ? printers.filter((printer) => printer.deviceId === device) : [];
  const ids = mine.map((printer) => printer.id).join(",");
  const auto = mine.some((printer) => printer.autoPrint);
  const [last, setLast] = useState<{ ok: boolean; text: string } | null>(null);
  const busy = useRef(false);

  // Olha a fila e imprime o que for deste aparelho. Chamado só por timer e por evento.
  async function run() {
    if (busy.current || !device || !ids) return;
    busy.current = true;
    try {
      const response = await fetch("/api/impressao", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "claim", deviceId: device }),
      });
      if (!response.ok) return;
      const { jobs } = (await response.json()) as { jobs: { id: string; printerId: string; printerName: string; orderCode: string | null; bytes: string }[] };
      for (const job of jobs) {
        const what = job.orderCode ? `Pedido ${job.orderCode}` : "Teste";
        try {
          await print(job.printerId, bytesOf(job.bytes));
          await finish(job.id, true);
          setLast({ ok: true, text: `${what} enviado para ${job.printerName}` });
        } catch (error) {
          await finish(job.id, false, (error as Error).message);
          setLast({ ok: false, text: `${what}: ${(error as Error).message}` });
        }
      }
    } catch {
      // Sem internet agora: tenta de novo na próxima volta.
    } finally {
      busy.current = false;
      window.dispatchEvent(new Event("chego:print-done"));
    }
  }
  const runRef = useRef(run);
  useEffect(() => { runRef.current = run; });

  // Ao abrir o painel, reconecta as impressoras deste aparelho (sem precisar de toque).
  useEffect(() => {
    for (const id of ids ? ids.split(",") : []) if (isLinkedHere(id)) void reconnect(id);
  }, [ids]);

  useEffect(() => {
    if (!ids) return;
    const first = window.setTimeout(() => void runRef.current(), 0);
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void runRef.current(); }, POLL_MS);
    const now = () => void runRef.current();
    window.addEventListener("chego:print-now", now);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
      window.removeEventListener("chego:print-now", now);
    };
  }, [ids]);

  // Tela acesa enquanto houver impressão automática neste aparelho.
  useEffect(() => {
    if (!auto || !("wakeLock" in navigator)) return;
    let lock: { release(): Promise<void> } | null = null;
    const request = async () => {
      try {
        lock = await (navigator as unknown as { wakeLock: { request(type: "screen"): Promise<{ release(): Promise<void> }> } }).wakeLock.request("screen");
      } catch {
        // Sem permissão (economia de bateria): segue sem manter a tela acesa.
      }
    };
    const again = () => { if (document.visibilityState === "visible") void request(); };
    void request();
    document.addEventListener("visibilitychange", again);
    return () => {
      document.removeEventListener("visibilitychange", again);
      void lock?.release().catch(() => {});
    };
  }, [auto]);

  if (mine.length === 0) return null;
  const states = mine.map((printer) => ({ printer, state: getState(printer.id) }));
  const problem = states.find(({ state }) => state.state === "error" || state.state === "disconnected" || state.state === "unsupported");
  const label = problem
    ? `${problem.printer.name}: ${problem.state.state === "disconnected" ? "desconectada" : "erro"}`
    : states.some(({ state }) => state.state === "printing") ? "Imprimindo..." : `${mine.length === 1 ? mine[0].name : `${mine.length} impressoras`}: conectada${mine.length > 1 ? "s" : ""}`;

  return (
    <div className="fixed bottom-3 right-3 z-40 flex max-w-[calc(100vw-1.5rem)] flex-col items-end gap-1 print:hidden" data-testid="print-station">
      {last && (
        <p role="status" className={`max-w-xs rounded-xl px-3 py-2 text-xs font-semibold text-white shadow-lg ${last.ok ? "bg-success" : "bg-danger"}`}>{last.text}</p>
      )}
      <Link href="/lojista/impressoras"
        className={`inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-bold shadow-lg ring-1 ${problem ? "bg-danger text-white ring-danger" : "bg-white text-coffee ring-peach"}`}>
        <Icon name="store" size={16} />
        <span className="truncate">{label}</span>
        {auto && !problem && <span className="rounded-full bg-success px-2 py-0.5 text-xs text-white">automática</span>}
      </Link>
    </div>
  );
}
