import { updateStoreState } from "@/app/lojista/actions";
import { Button } from "@/components/ui/Button";
import type { MerchantStore } from "@/lib/merchant/context";

const small = "min-h-11 px-4 text-sm";

function Toggle({ kind, value, label, active }: { kind: string; value: string | number; label: string; active: boolean }) {
  return (
    <form action={updateStoreState}>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="value" value={value} />
      <Button type="submit" variant={active ? "primary" : "secondary"} className={small} aria-pressed={active}>
        {label}
      </Button>
    </form>
  );
}

/** Abrir/fechar agora, pausar por um tempo e o tempo extra de "movimento alto": um toque cada. */
export function StoreControls({ store }: { store: MerchantStore }) {
  const paused = store.availability.state === "paused";
  return (
    <section className="flex flex-col gap-3 rounded-card bg-white p-4 ring-1 ring-peach" aria-label="Situação da loja">
      <p>
        Agora a loja está{" "}
        <strong data-testid="merchant-store-state" className={store.availability.state === "open" ? "text-success" : "text-danger"}>
          {store.availability.state === "open" ? "aberta" : paused ? "pausada" : "fechada"}
        </strong>
        {store.availability.state !== "open" && <span className="text-coffee-soft"> · {store.availability.label}</span>}
        {store.busyExtraMinutes > 0 && <span className="font-semibold text-brand-darker"> · movimento alto (+{store.busyExtraMinutes} min)</span>}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">Abertura:</span>
        <Toggle kind="manual" value="auto" label="Seguir os horários" active={store.manualState === "auto"} />
        <Toggle kind="manual" value="open" label="Abrir agora" active={store.manualState === "open"} />
        <Toggle kind="manual" value="closed" label="Fechar agora" active={store.manualState === "closed"} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">Pausar:</span>
        {[15, 30, 60].map((minutes) => (
          <Toggle key={minutes} kind="pause" value={minutes} label={`${minutes} min`} active={false} />
        ))}
        {paused && <Toggle kind="pause" value={0} label="Voltar agora" active />}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">Movimento alto:</span>
        {[0, 15, 30, 45].map((minutes) => (
          <Toggle key={minutes} kind="busy" value={minutes} label={minutes === 0 ? "Normal" : `+${minutes} min`} active={store.busyExtraMinutes === minutes} />
        ))}
      </div>
    </section>
  );
}
