// Ponte com a impressora Bluetooth, no navegador do celular (só no cliente).
//
// Usa a Web Serial API do Chrome para Android, que fala com impressoras Bluetooth Classic
// já pareadas pelo perfil serial (SPP/RFCOMM). Não é Web Bluetooth (que só fala BLE).
// O Chrome lembra a permissão de cada impressora no aparelho: depois da primeira vez,
// reconectar não precisa de toque (navigator.serial.getPorts()).
//
// Nada daqui vai para o banco: a conexão é do aparelho. O servidor só sabe em qual
// aparelho (deviceId) cada impressora foi conectada.

/** UUID do perfil serial do Bluetooth (SPP), o que as mini impressoras térmicas usam. */
export const SPP_UUID = "00001101-0000-1000-8000-00805f9b34fb";

type SerialPortLike = {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readonly writable: WritableStream<Uint8Array> | null;
  getInfo(): { bluetoothServiceClassId?: string | number };
};
type SerialLike = {
  requestPort(options: { filters?: { bluetoothServiceClassId: string }[]; allowedBluetoothServiceClassIds?: string[] }): Promise<SerialPortLike>;
  getPorts(): Promise<SerialPortLike[]>;
};

export type PrinterState =
  | { state: "unsupported"; message: string }
  | { state: "disconnected" }
  | { state: "connecting" }
  | { state: "connected" }
  | { state: "printing" }
  | { state: "error"; message: string };

const DEVICE_KEY = "chego.aparelho";
const PORTS_KEY = "chego.impressoras.portas";

const serial = (): SerialLike | null =>
  typeof navigator !== "undefined" && "serial" in navigator ? (navigator as unknown as { serial: SerialLike }).serial : null;

/** Este navegador consegue falar com impressora Bluetooth? (Chrome para Android recente.) */
export function printingSupport(): { ok: true } | { ok: false; message: string } {
  if (typeof window === "undefined") return { ok: false, message: "Abra no celular." };
  if (!window.isSecureContext) return { ok: false, message: "A impressão Bluetooth só funciona no endereço seguro (https) do Chegô." };
  if (!serial()) {
    return { ok: false, message: "Este navegador não fala com impressora Bluetooth. Use o Chrome atualizado num celular Android (ou a impressão pelo navegador no computador)." };
  }
  return { ok: true };
}

const read = <T,>(key: string, fallback: T): T => {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};
const write = (key: string, value: unknown) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Sem armazenamento (aba anônima): a conexão vale até fechar a aba.
  }
};

/** Identificador deste aparelho (aleatório, guardado nele mesmo). */
export function deviceId(): string {
  let id = read<string | null>(DEVICE_KEY, null);
  if (!id || !/^[a-f0-9-]{36}$/.test(id)) {
    id = crypto.randomUUID();
    write(DEVICE_KEY, id);
  }
  return id;
}

/** Nome curto do aparelho para a loja reconhecer (ex.: "SM-A145M"), tirado do navegador. */
export function deviceLabel(): string {
  const model = navigator.userAgent.match(/Android [\d.]+; ([^;)]+)/)?.[1]?.trim();
  return (model && model !== "K" ? model : /Android/.test(navigator.userAgent) ? "Celular Android" : "Este aparelho").slice(0, 60);
}

// ------------------------------------------------------------------ estado

const ports = new Map<string, SerialPortLike>();
const states = new Map<string, PrinterState>();
const listeners = new Set<() => void>();

function setState(printerId: string, state: PrinterState) {
  states.set(printerId, state);
  for (const listener of listeners) listener();
}

export function getState(printerId: string): PrinterState {
  const support = printingSupport();
  if (!support.ok) return { state: "unsupported", message: support.message };
  return states.get(printerId) ?? { state: "disconnected" };
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Mensagem para cada falha que o Bluetooth pode dar. */
export function friendlyError(error: unknown): string {
  const name = (error as { name?: string })?.name ?? "";
  const message = (error as { message?: string })?.message ?? "";
  if (name === "NotFoundError") return "Nenhuma impressora escolhida. Confira se ela está pareada nas configurações de Bluetooth do Android e tente de novo.";
  if (name === "SecurityError" || name === "NotAllowedError") return "Sem permissão para usar o Bluetooth. Permita “Dispositivos próximos” para o Chrome nas configurações do Android.";
  if (name === "NetworkError") return "Não deu para conectar: a impressora está desligada, fora de alcance, sem papel ou conectada em outro aparelho.";
  if (name === "InvalidStateError") return "A impressora já está aberta em outra aba ou aplicativo. Feche lá e tente de novo.";
  if (/bluetooth.*(off|disabled|desligado)/i.test(message)) return "O Bluetooth do celular está desligado.";
  return message ? `Falha na impressora: ${message}` : "Falha na impressora.";
}

async function openPort(printerId: string, port: SerialPortLike) {
  // O RFCOMM ignora a velocidade, mas a API exige uma.
  await port.open({ baudRate: 9600 });
  ports.set(printerId, port);
  setState(printerId, { state: "connected" });
}

/** Primeira conexão: o Android mostra as impressoras pareadas para escolher (precisa de um toque). */
export async function connect(printerId: string): Promise<boolean> {
  const api = serial();
  if (!api) return false;
  setState(printerId, { state: "connecting" });
  try {
    const port = await api.requestPort({ filters: [{ bluetoothServiceClassId: SPP_UUID }], allowedBluetoothServiceClassIds: [SPP_UUID] });
    await disconnect(printerId, false);
    await openPort(printerId, port);
    const index = (await api.getPorts()).indexOf(port);
    write(PORTS_KEY, { ...read<Record<string, number>>(PORTS_KEY, {}), [printerId]: index });
    return true;
  } catch (error) {
    setState(printerId, { state: "error", message: friendlyError(error) });
    return false;
  }
}

/** Reconecta sem toque, com a permissão que o Chrome guardou neste aparelho. */
export async function reconnect(printerId: string): Promise<boolean> {
  const api = serial();
  if (!api) return false;
  if (ports.has(printerId)) return true;
  const index = read<Record<string, number>>(PORTS_KEY, {})[printerId];
  if (index === undefined) return false;
  setState(printerId, { state: "connecting" });
  try {
    const port = (await api.getPorts())[index];
    if (!port) throw Object.assign(new Error("A permissão desta impressora sumiu. Toque em Conectar e escolha de novo."), { name: "Lost" });
    await openPort(printerId, port);
    return true;
  } catch (error) {
    setState(printerId, { state: "error", message: (error as { name?: string }).name === "Lost" ? (error as Error).message : friendlyError(error) });
    return false;
  }
}

export async function disconnect(printerId: string, forget = true) {
  const port = ports.get(printerId);
  ports.delete(printerId);
  if (port) await port.close().catch(() => {});
  if (forget) {
    const map = read<Record<string, number>>(PORTS_KEY, {});
    delete map[printerId];
    write(PORTS_KEY, map);
  }
  setState(printerId, { state: "disconnected" });
}

export const isLinkedHere = (printerId: string) => read<Record<string, number>>(PORTS_KEY, {})[printerId] !== undefined;

/**
 * Envia os bytes em pedaços pequenos (as mini impressoras têm pouca memória). Terminar sem
 * erro quer dizer que tudo chegou à impressora pelo Bluetooth, não que o papel saiu: estas
 * impressoras não confirmam a impressão.
 */
export async function print(printerId: string, bytes: Uint8Array): Promise<void> {
  if (!ports.has(printerId) && !(await reconnect(printerId))) {
    throw new Error(getState(printerId).state === "error" ? (getState(printerId) as { message: string }).message : "Impressora desconectada. Toque em Conectar.");
  }
  const port = ports.get(printerId)!;
  if (!port.writable) throw new Error("A impressora não está aceitando dados. Desconecte e conecte de novo.");
  setState(printerId, { state: "printing" });
  const writer = port.writable.getWriter();
  try {
    for (let offset = 0; offset < bytes.length; offset += 256) {
      await writer.write(bytes.slice(offset, offset + 256));
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    writer.releaseLock();
    setState(printerId, { state: "connected" });
  } catch (error) {
    // Perdeu a conexão no meio: na próxima tentativa reconecta do zero.
    try { writer.releaseLock(); } catch { /* já solto */ }
    ports.delete(printerId);
    await port.close().catch(() => {});
    setState(printerId, { state: "error", message: friendlyError(error) });
    throw new Error(friendlyError(error));
  }
}
