import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PrinterControls } from "@/components/merchant/PrinterControls";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Button } from "@/components/ui/Button";
import { Field, inputClass } from "@/components/ui/Field";
import { formatDateTime } from "@/lib/format";
import { getMerchantContext } from "@/lib/merchant/context";
import { listPrinters, recentJobs, type PrinterRow } from "@/lib/printing/jobs";
import { PRINT_KIND_LABELS } from "@/lib/printing/receipt";
import { deletePrinter, savePrinter } from "./actions";

export const metadata: Metadata = { title: "Impressoras" };

const card = "flex flex-col gap-3 rounded-card bg-white p-4 ring-1 ring-peach";
const SECTORS = { caixa: "Caixa", cozinha: "Cozinha", expedicao: "Expedição", geral: "Uso geral" } as const;
const ENCODINGS = { cp860: "Português (CP860), a mais comum", cp850: "Europa ocidental (CP850)", ascii: "Sem acentos (para qualquer impressora)" } as const;
const JOB_STATUS = {
  pending: { text: "Aguardando", tone: "text-coffee-soft" },
  sending: { text: "Enviando", tone: "text-coffee" },
  sent: { text: "Enviado", tone: "text-success" },
  failed: { text: "Falhou", tone: "text-danger" },
  unknown: { text: "Resultado desconhecido", tone: "text-danger" },
} as const;

export default function PrintersPage() {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
      <Printers />
    </Suspense>
  );
}

async function Printers() {
  const { membership, store } = await getMerchantContext(["owner", "attendant"]);
  const owner = membership.role === "owner";
  const [printers, jobs] = await Promise.all([listPrinters(store.id), recentJobs(store.id, { limit: 40 })]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <header>
        <h1 className="text-3xl">Impressoras</h1>
        <p className="text-coffee-soft">
          Mini impressoras térmicas Bluetooth (58 mm ou 80 mm) ligadas a um celular Android, pelo Chrome. Cada impressora tem o seu setor,
          o tipo de cupom e as vias. No computador, use “Imprimir” na página do pedido (impressão pelo navegador).
        </p>
      </header>

      {printers.length === 0 && (
        <p className="rounded-card bg-white p-4 text-coffee-soft ring-1 ring-peach">
          Nenhuma impressora cadastrada. {owner ? "Cadastre a primeira abaixo." : "Peça ao dono da loja para cadastrar."}
        </p>
      )}

      {printers.map((printer) => (
        <section key={printer.id} className={card} data-testid="printer" aria-label={printer.name}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-xl">{printer.name} {printer.is_default && <span className="ml-1 rounded-full bg-peach px-2 py-0.5 align-middle text-xs font-bold text-brand-darker">padrão</span>}</h2>
              <p className="text-sm text-coffee-soft">
                {SECTORS[printer.sector]} · {PRINT_KIND_LABELS[printer.print_kind]} · {printer.paper_width_mm} mm · {printer.copies} via{printer.copies > 1 ? "s" : ""}
                {printer.auto_print ? " · impressão automática ligada" : " · só manual"}
              </p>
            </div>
          </div>
          <PrinterControls printer={{ id: printer.id, name: printer.name, deviceId: printer.device_id, deviceLabel: printer.device_label }} />
          {owner && (
            <details>
              <summary className="min-h-11 cursor-pointer content-center text-sm font-semibold text-brand-dark">Editar configuração</summary>
              <PrinterForm printer={printer} />
              <form action={deletePrinter} className="mt-3">
                <input type="hidden" name="id" value={printer.id} />
                <Button type="submit" variant="secondary" className="min-h-11 px-4 text-sm">Remover impressora</Button>
              </form>
            </details>
          )}
          <PrinterHistory jobs={jobs.filter((job) => job.printer_id === printer.id).slice(0, 8)} />
        </section>
      ))}

      {owner && (
        <section className={card}>
          <h2 className="text-xl">Nova impressora</h2>
          <PrinterForm printer={null} />
        </section>
      )}

      <section className={card}>
        <h2 className="text-xl">Como conectar e resolver problemas</h2>
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li>Ligue a impressora e pareie com o celular em <strong>Configurações → Bluetooth</strong> do Android (a senha costuma ser 0000 ou 1234).</li>
          <li>No Chrome do celular, abra o painel da loja, toque em <strong>Conectar pelo Bluetooth</strong> e escolha a impressora na lista.</li>
          <li>Permita <strong>Dispositivos próximos</strong> para o Chrome, se o Android perguntar. Não é preciso dar acesso à localização.</li>
          <li>Toque em <strong>Imprimir teste</strong>. Se os acentos saírem trocados, mude a tabela de caracteres (CP860, CP850 ou sem acentos).</li>
        </ol>
        <ul className="list-disc space-y-1 pl-5 text-sm text-coffee-soft">
          <li><strong>Não aparece na lista:</strong> confira se a impressora está pareada no Android e ligada. Ela só aparece depois de pareada.</li>
          <li><strong>Não conecta:</strong> impressora desligada, fora de alcance, sem bateria ou conectada em outro celular (desconecte lá).</li>
          <li><strong>Impressão automática:</strong> só funciona com o Chegô aberto na tela deste celular (o Android pausa o que fica em segundo plano). A tela fica acesa sozinha enquanto ela estiver ligada.</li>
          <li><strong>“Enviado”</strong> quer dizer que o cupom chegou à impressora pelo Bluetooth. Essas impressoras não avisam se o papel acabou: confira a bobina e use <strong>Reimprimir</strong> se precisar.</li>
          <li><strong>“Resultado desconhecido”:</strong> o celular fechou ou perdeu a conexão no meio do envio. Confira se saiu e reimprima.</li>
          <li>Uma impressora fica ligada a um celular por vez. Para usar em outro, toque em <strong>Conectar neste celular</strong> nele.</li>
        </ul>
      </section>
    </div>
  );
}

function PrinterForm({ printer }: { printer: PrinterRow | null }) {
  return (
    <ActionForm action={savePrinter} resetOnSuccess={printer === null} className="mt-2 grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="id" value={printer?.id ?? ""} />
      <Field label="Nome da impressora" name="name" required maxLength={60} defaultValue={printer?.name ?? ""} placeholder="Ex.: Impressora do Caixa" />
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        Setor
        <select name="sector" defaultValue={printer?.sector ?? "caixa"} className={inputClass}>
          {Object.entries(SECTORS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        Tipo de cupom
        <select name="kind" defaultValue={printer?.print_kind ?? "completo"} className={inputClass}>
          <option value="completo">Pedido completo</option>
          <option value="cozinha">Comanda da cozinha (sem valores)</option>
          <option value="comprovante">Comprovante do cliente</option>
        </select>
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        Largura do papel
        <select name="width" defaultValue={String(printer?.paper_width_mm ?? 58)} className={inputClass}>
          <option value="58">58 mm</option>
          <option value="80">80 mm</option>
        </select>
      </label>
      <Field label="Vias" name="copies" type="number" min={1} max={5} defaultValue={printer?.copies ?? 1} />
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        Tabela de caracteres (acentos)
        <select name="encoding" defaultValue={printer?.encoding ?? "cp860"} className={inputClass}>
          {Object.entries(ENCODINGS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </label>
      <label className="flex min-h-11 items-center gap-3 text-sm font-semibold">
        <input type="checkbox" name="autoPrint" defaultChecked={printer?.auto_print ?? false} className="size-5 accent-brand-dark" />
        Imprimir sozinha quando chegar pedido novo
      </label>
      <label className="flex min-h-11 items-center gap-3 text-sm font-semibold">
        <input type="checkbox" name="isDefault" defaultChecked={printer?.is_default ?? false} className="size-5 accent-brand-dark" />
        Impressora padrão
      </label>
      <SubmitButton className="self-start sm:col-span-2">{printer ? "Salvar impressora" : "Cadastrar impressora"}</SubmitButton>
    </ActionForm>
  );
}

function PrinterHistory({ jobs }: { jobs: Awaited<ReturnType<typeof recentJobs>> }) {
  if (jobs.length === 0) return <p className="text-sm text-coffee-soft">Nenhuma impressão ainda.</p>;
  return (
    <details>
      <summary className="min-h-11 cursor-pointer content-center text-sm font-semibold text-brand-dark">Histórico ({jobs.length})</summary>
      <ul className="divide-y divide-cream text-sm" data-testid="print-history">
        {jobs.map((job) => (
          <li key={job.id} className="py-2">
            <span className="font-semibold">{job.order_code ? <Link href={`/lojista/pedidos/${job.order_id}`} className="underline">{job.order_code}</Link> : "Teste"}</span>
            {" · "}{PRINT_KIND_LABELS[job.kind]}{job.reprint && job.kind !== "teste" ? " (reimpressão)" : ""}
            {" · "}<span className={`font-semibold ${JOB_STATUS[job.status].tone}`}>{JOB_STATUS[job.status].text}</span>
            <span className="block text-xs text-coffee-soft">{formatDateTime(job.created_at)}{job.error ? ` · ${job.error}` : ""}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
