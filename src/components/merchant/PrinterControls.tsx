"use client";

import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, useTransition } from "react";
import { bindPrinterToDevice, requestPrint } from "@/app/lojista/impressoras/actions";
import { connect, deviceId, deviceLabel, disconnect, getState, isLinkedHere, printingSupport, reconnect, subscribe, type PrinterState } from "@/lib/printing/bridge";
import { printNow } from "./PrintStation";

const noop = () => () => {};
const STATE_TEXT: Record<PrinterState["state"], string> = {
  unsupported: "Não dá para conectar neste navegador",
  disconnected: "Desconectada",
  connecting: "Conectando...",
  connected: "Conectada",
  printing: "Imprimindo...",
  error: "Erro",
};

function useStatus(printerId: string) {
  const key = useSyncExternalStore(subscribe, () => JSON.stringify(getState(printerId)), () => JSON.stringify({ state: "disconnected" }));
  return JSON.parse(key) as PrinterState;
}

/** Espera a estação de impressão terminar a volta que acabou de ser pedida. */
const waitForStation = () => new Promise<void>((resolve) => {
  const done = () => { window.removeEventListener("chego:print-done", done); resolve(); };
  window.addEventListener("chego:print-done", done);
  setTimeout(done, 15_000);
});

/** Estado real da conexão neste aparelho e as ações: conectar, reconectar, desconectar e teste. */
export function PrinterControls({ printer }: { printer: { id: string; name: string; deviceId: string | null; deviceLabel: string | null } }) {
  const router = useRouter();
  const status = useStatus(printer.id);
  const here = useSyncExternalStore(noop, deviceId, () => null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const support = useSyncExternalStore(noop, () => JSON.stringify(printingSupport()), () => JSON.stringify({ ok: true }));
  const supported = (JSON.parse(support) as { ok: boolean }).ok;
  const elsewhere = printer.deviceId !== null && here !== null && printer.deviceId !== here;
  const linked = useSyncExternalStore(noop, () => isLinkedHere(printer.id), () => false);

  const onConnect = () => start(async () => {
    setMessage(null);
    const ok = await connect(printer.id);
    if (!ok) return;
    const saved = await bindPrinterToDevice({ printerId: printer.id, deviceId: deviceId(), deviceLabel: deviceLabel() });
    setMessage(saved.error ? { ok: false, text: saved.error } : { ok: true, text: "Conectada neste celular. Faça um teste." });
    router.refresh();
  });

  const onTest = () => start(async () => {
    setMessage(null);
    const result = await requestPrint({ printerId: printer.id, kind: "teste" });
    if (result.error) return setMessage({ ok: false, text: result.error });
    const finished = waitForStation();
    printNow();
    await finished;
    router.refresh();
    const after = getState(printer.id);
    setMessage(after.state === "error"
      ? { ok: false, text: `Falha no envio: ${after.message}` }
      : { ok: true, text: "Teste enviado para a impressora. Ela não confirma se o papel saiu: confira a bobina." });
  });

  return (
    <div className="flex flex-col gap-2" data-testid="printer-controls">
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold ${
          status.state === "connected" || status.state === "printing" ? "bg-success text-white"
            : status.state === "error" || status.state === "unsupported" ? "bg-danger text-white" : "bg-cream text-coffee"}`} data-testid="printer-state">
          {STATE_TEXT[status.state]}
        </span>
        <span className="text-coffee-soft">
          {printer.deviceId === null ? "Ainda não conectada em nenhum celular"
            : elsewhere ? `Conectada em outro aparelho (${printer.deviceLabel ?? "sem nome"})`
            : `Neste aparelho (${printer.deviceLabel ?? "este celular"})`}
        </span>
      </p>
      {(status.state === "error" || status.state === "unsupported") && <p role="alert" className="text-sm font-semibold text-danger">{status.message}</p>}
      {supported && (
        <div className="flex flex-wrap gap-2">
          {status.state === "connected" || status.state === "printing" ? (
            <button type="button" onClick={() => void disconnect(printer.id)} className="min-h-11 rounded-full px-4 text-sm font-bold ring-1 ring-peach hover:ring-brand">Desconectar</button>
          ) : (
            <>
              <button type="button" onClick={onConnect} disabled={pending} className="min-h-11 rounded-full bg-brand-dark px-4 text-sm font-bold text-white disabled:opacity-60">
                {elsewhere ? "Conectar neste celular" : "Conectar pelo Bluetooth"}
              </button>
              {linked && !elsewhere && (
                <button type="button" onClick={() => void reconnect(printer.id)} className="min-h-11 rounded-full px-4 text-sm font-bold ring-1 ring-peach hover:ring-brand">Reconectar</button>
              )}
            </>
          )}
          <button type="button" onClick={onTest} disabled={pending || printer.deviceId === null} className="min-h-11 rounded-full px-4 text-sm font-bold text-brand-dark ring-1 ring-brand-dark disabled:opacity-50">
            Imprimir teste
          </button>
        </div>
      )}
      {message && <p role="status" className={`text-sm font-semibold ${message.ok ? "text-success" : "text-danger"}`}>{message.text}</p>}
    </div>
  );
}

/** Reimprimir um pedido (na impressora escolhida, no tipo de cupom escolhido). */
export function ReprintButton({ orderId, printers }: { orderId: string; printers: { id: string; name: string; isDefault: boolean }[] }) {
  const router = useRouter();
  const [printerId, setPrinterId] = useState(printers.find((printer) => printer.isDefault)?.id ?? printers[0]?.id ?? "");
  const [kind, setKind] = useState<"completo" | "cozinha" | "comprovante">("completo");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  if (printers.length === 0) return null;

  const onPrint = () => start(async () => {
    setMessage(null);
    const result = await requestPrint({ orderId, printerId, kind });
    if (result.error) return setMessage({ ok: false, text: result.error });
    const finished = waitForStation();
    printNow();
    await finished;
    router.refresh();
    setMessage({ ok: true, text: "Enviado para a fila de impressão. O resultado aparece no histórico da impressora." });
  });

  return (
    <div className="flex flex-col gap-2 rounded-2xl bg-cream p-3" data-testid="reprint">
      <p className="text-sm font-semibold">Imprimir na impressora Bluetooth</p>
      <div className="flex flex-wrap items-end gap-2">
        {printers.length > 1 && (
          <label className="flex flex-col text-xs font-semibold">
            Impressora
            <select value={printerId} onChange={(event) => setPrinterId(event.target.value)} className="min-h-11 rounded-xl bg-white px-2 ring-1 ring-peach">
              {printers.map((printer) => <option key={printer.id} value={printer.id}>{printer.name}</option>)}
            </select>
          </label>
        )}
        <label className="flex flex-col text-xs font-semibold">
          Cupom
          <select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)} className="min-h-11 rounded-xl bg-white px-2 ring-1 ring-peach">
            <option value="completo">Pedido completo</option>
            <option value="cozinha">Comanda da cozinha</option>
            <option value="comprovante">Comprovante do cliente</option>
          </select>
        </label>
        <button type="button" onClick={onPrint} disabled={pending} className="min-h-11 rounded-full bg-brand-dark px-4 text-sm font-bold text-white disabled:opacity-60">
          {pending ? "Imprimindo..." : "Imprimir"}
        </button>
      </div>
      {message && <p role="status" className={`text-sm font-semibold ${message.ok ? "text-success" : "text-danger"}`}>{message.text}</p>}
    </div>
  );
}
