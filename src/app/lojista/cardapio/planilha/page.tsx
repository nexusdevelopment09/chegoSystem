import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { buttonClass } from "@/components/ui/Button";
import { Field, fileInputClass, inputClass } from "@/components/ui/Field";
import { withUser } from "@/lib/db";
import { getMerchantContext } from "@/lib/merchant/context";
import { adjustPrices, importMenuCsv } from "../actions";

export const metadata: Metadata = { title: "Planilha e reajuste" };

export default function SpreadsheetPage() {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
      <Spreadsheet />
    </Suspense>
  );
}

async function Spreadsheet() {
  const { profile, store } = await getMerchantContext(["owner", "attendant"]);
  const sections = await withUser(profile.id, (tx) => tx<{ id: string; name: string }[]>`
    select id, name from product_sections where store_id = ${store.id} order by sort_order`);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <Link href="/lojista/cardapio" className="font-semibold text-brand-dark underline">← Cardápio</Link>
      <h1 className="text-3xl">Planilha e reajuste de preços</h1>

      <section className="flex flex-col gap-3 rounded-card bg-white p-4 ring-1 ring-peach">
        <h2 className="text-xl">Baixar o cardápio em planilha</h2>
        <p className="text-sm text-coffee-soft">
          Abre no Excel ou no Google Planilhas. Colunas: seção, nome, descrição, preço, disponível e estoque.
        </p>
        <a href="/lojista/cardapio/exportar" className={buttonClass("secondary", "self-start")} download>Baixar planilha (CSV)</a>
      </section>

      <section className="flex flex-col gap-3 rounded-card bg-white p-4 ring-1 ring-peach">
        <h2 className="text-xl">Enviar planilha</h2>
        <p className="text-sm text-coffee-soft">
          Produto com o mesmo nome é atualizado; nome novo é criado. Se alguma linha tiver problema, nada é alterado e a gente mostra a linha.
          Fotos e opções continuam sendo editadas pelo painel.
        </p>
        <ActionForm action={importMenuCsv} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            Arquivo CSV
            <input type="file" name="file" accept=".csv,text/csv" required className={fileInputClass} />
          </label>
          <SubmitButton className="self-start">Importar planilha</SubmitButton>
        </ActionForm>
      </section>

      <section className="flex flex-col gap-3 rounded-card bg-white p-4 ring-1 ring-peach">
        <h2 className="text-xl">Reajuste de preços em lote</h2>
        <ActionForm action={adjustPrices} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            Onde aplicar
            <select name="sectionId" defaultValue="" className={inputClass}>
              <option value="">No cardápio todo</option>
              {sections.map((section) => <option key={section.id} value={section.id}>Só na seção {section.name}</option>)}
            </select>
          </label>
          <Field label="Percentual" name="percent" required inputMode="decimal" placeholder="5" hint="Use 5 para aumentar 5%, ou -10 para baixar 10%." />
          <SubmitButton className="self-start">Aplicar reajuste</SubmitButton>
        </ActionForm>
      </section>
    </div>
  );
}
